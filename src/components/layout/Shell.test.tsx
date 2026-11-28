import { describe, expect, mock, test } from "bun:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import App, { Chat, TopBar, applyRecentTitles, nextStateAfterCreate, withSessionTitle } from "../../App";
import { StatusBar, QuotaIndicators } from "./StatusBar";
import { TooltipProvider } from "../ui/tooltip";
import { Button } from "../ui/button";
import { DropdownMenuItem } from "../ui/dropdown-menu";
import { PlanCard } from "../../features/session/PlanCard";
import type { DbEvent } from "../../../src-tauri/src/db/api";

function findElement(node: React.ReactNode, predicate: (element: React.ReactElement<any>) => boolean): React.ReactElement<any> | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findElement(child, predicate);
      if (found) return found;
    }
    return null;
  }
  if (!React.isValidElement(node)) return null;
  const element = node as React.ReactElement<any>;
  return predicate(element) ? element : findElement(element.props.children, predicate);
}

describe("[ADR-0016.D2] session composer", () => {
  test("retains the supplied draft and makes unavailable execution explicit", () => {
    const html = renderToStaticMarkup(<TooltipProvider><Chat session={null} plan={null} busy={false} onApprove={() => {}} onOpenAgent={() => {}} onToggleWorktree={() => {}} onCreateSession={() => {}} prompt="Investigate issue #42" onPromptChange={() => {}} error={null} loading={false} /></TooltipProvider>);
    expect(html).toContain("Investigate issue #42");
    expect(html).toContain("disabled");
    expect(html).toContain("Select an ACP harness to run this goal.");
  });

  test("does not highlight a phase when there is no plan", () => {
    const html = renderToStaticMarkup(<TooltipProvider><TopBar session={null} plan={null} collapsed={false} onToggle={() => {}} /></TooltipProvider>);
    expect(html).not.toContain('aria-current="step"');
  });

  test("shows the actual worktree branch or a non-monospace fallback", () => {
    const session = { id: 1, title: "Session", workspacePath: "/repo", optInWorktree: true, conciseReplies: false, model: null, subAgents: [] };
    const render = (worktreeBranch?: string) => renderToStaticMarkup(<TooltipProvider><TopBar session={{ ...session, worktreeBranch }} plan={null} collapsed={false} onToggle={() => {}} /></TooltipProvider>);
    expect(render()).toContain("Worktree on");
    expect(render()).not.toContain('class="font-mono">Worktree on');
    expect(render("feature/test")).toContain('class="font-mono">feature/test');
  });

  test("creating a session retains the current composer draft", () => {
    const previous = { sessions: [{ id: 1, title: "Existing", workspacePath: "/repo", optInWorktree: false, conciseReplies: false, model: null, subAgents: [] }], prompt: "Keep this draft" };
    const created = { id: 2, title: "New session", workspacePath: "/repo", optInWorktree: false, conciseReplies: false, model: null, subAgents: [] };
    const next = nextStateAfterCreate(previous, created);
    expect(next.prompt).toBe("Keep this draft");
    expect(next.sessions).toEqual([...previous.sessions, created]);
  });

  test("[ADR-0018.D5] updates only the session named by a generated-title event", () => {
    const sessions = [{ id: 1, title: "First message", phase: "Build" }, { id: 2, title: "Other", phase: null }];
    expect(withSessionTitle(sessions, 1, "Generated title")).toEqual([{ ...sessions[0], title: "Generated title" }, sessions[1]]);
  });

  test("[ADR-0018.D5] a title event wins over a refresh that began before it", () => {
    const stale = [{ id: 1, title: "First message" }, { id: 2, title: "Other" }];
    const updates = new Map([[1, { sequence: 2, title: "Generated title" }]]);
    expect(applyRecentTitles(stale, updates, 1)).toEqual([{ id: 1, title: "Generated title" }, stale[1]]);
    expect(applyRecentTitles(stale, updates, 2)).toEqual(stale);
  });
});

describe("[ADR-0016.D3] plan in the shell", () => {
  test("renders the plan composer placeholder and sends the displayed revision", () => {
    const session = { id: 1, title: "Session", workspacePath: "/repo", optInWorktree: false, conciseReplies: false, model: null, subAgents: [] };
    const task = { id: "t1", title: "First task", team: "", harness: "omp", worktree: false, files: [], dependencies: [], estimated_tokens: null, status: "queued" as const };
    const plan = { session_id: 1, revision: 17, phase: "Plan" as const, approved: false, estimated_tokens: null, tasks_started: false, tasks: [task, { ...task, id: "t2" }] };
    const onApprove = mock((_revision: number) => {});
    const props = { session, plan, busy: false, onApprove, onOpenAgent: () => {}, onToggleWorktree: () => {}, onCreateSession: () => {}, prompt: "", onPromptChange: () => {}, error: null, loading: false };
    const html = renderToStaticMarkup(<TooltipProvider><Chat {...props} /></TooltipProvider>);
    expect(html).toContain('placeholder="Reply to revise the plan, or approve above…"');
    expect(html).toContain('data-revision="17"');
    const card = findElement(Chat(props), (element) => element.type === PlanCard);
    expect(card).not.toBeNull();
    const button = findElement(PlanCard(card!.props), (element) => element.props.children === "Approve & build");
    expect(button).not.toBeNull();
    button!.props.onClick();
    expect(onApprove).toHaveBeenCalledTimes(1);
    expect(onApprove).toHaveBeenCalledWith(17);
  });

  test("[ADR-0018.D1] single task does not show a PlanCard", () => {
    const session = { id: 1, title: "Session", workspacePath: "/repo", optInWorktree: false, conciseReplies: false, model: null, subAgents: [] };
    const plan = { session_id: 1, revision: 2, phase: "Plan" as const, approved: false, estimated_tokens: null, tasks_started: false, tasks: [{ id: "t1", title: "Implement feature", team: "", harness: "omp", worktree: false, files: [], dependencies: [], estimated_tokens: null, status: "queued" as const }] };
    const html = renderToStaticMarkup(<TooltipProvider><Chat session={session} plan={plan} busy={false} onApprove={() => {}} onOpenAgent={() => {}} onToggleWorktree={() => {}} onCreateSession={() => {}} prompt="" onPromptChange={() => {}} error={null} loading={false} /></TooltipProvider>);
    expect(html).not.toContain("Approve &amp; build");
  });

  test("[ADR-0018.D4] multi-task plans show sub-agents only after tasks start", () => {
    const session = { id: 1, title: "Session", workspacePath: "/repo", optInWorktree: false, conciseReplies: false, model: null, subAgents: [] };
    const task = { id: "t1", title: "Implement feature", team: "", harness: "omp", worktree: true, files: [], dependencies: [], estimated_tokens: null, status: "queued" as const };
    const plan = { session_id: 1, revision: 2, phase: "Build" as const, approved: true, estimated_tokens: null, tasks_started: false, tasks: [task, { ...task, id: "t2", title: "Review feature" }] };
    const render = (tasks_started: boolean) => renderToStaticMarkup(<TooltipProvider><Chat session={session} plan={{ ...plan, tasks_started }} busy={false} onApprove={() => {}} onOpenAgent={() => {}} onToggleWorktree={() => {}} onCreateSession={() => {}} prompt="" onPromptChange={() => {}} error={null} loading={false} /></TooltipProvider>);
    expect(render(false)).not.toContain("Implement feature");
    expect(render(true)).toContain("Implement feature");
  });

  test("does not render an approval card or revision placeholder in Build", () => {
    const session = { id: 1, title: "Session", workspacePath: "/repo", optInWorktree: false, conciseReplies: false, model: null, subAgents: [] };
    const plan = { session_id: 1, revision: 2, phase: "Build" as const, approved: true, estimated_tokens: null, tasks_started: true, tasks: [] };
    const html = renderToStaticMarkup(<TooltipProvider><Chat session={session} plan={plan} busy={false} onApprove={() => {}} onOpenAgent={() => {}} onToggleWorktree={() => {}} onCreateSession={() => {}} prompt="" onPromptChange={() => {}} error={null} loading={false} /></TooltipProvider>);
    expect(html).not.toContain("Approve &amp; build");
    expect(html).not.toContain("Reply to revise the plan");
    expect(html).toContain("Describe the goal");
  });

  test("[ADR-0018.D3] modes and always-allow appear only when advertised", () => {
    const session = { id: 1, title: "Session", workspacePath: "/repo", optInWorktree: false, conciseReplies: false, model: null, subAgents: [] };
    const task = { id: "t1", title: "Work", team: "", harness: "omp", worktree: false, files: [], dependencies: [], estimated_tokens: null, status: "running" as const };
    const plan = { session_id: 1, revision: 1, phase: "Build" as const, approved: true, estimated_tokens: null, tasks_started: true, tasks: [task] };
    const request: DbEvent = { id: 1, session_id: 1, task_id: null, kind: "permission_request", payload: { plan_task_id: "t1", request_id: "r1", operation: "Write" }, created_at: "2026-11-28" };
    const props = { session, plan, busy: false, onApprove: () => {}, onOpenAgent: () => {}, onToggleWorktree: () => {}, onCreateSession: () => {}, prompt: "", onPromptChange: () => {}, error: null, loading: false };
    const render = (events: DbEvent[]) => renderToStaticMarkup(<TooltipProvider><Chat {...props} events={events} /></TooltipProvider>);
    expect(render([request])).not.toContain("Always allow");
    expect(render([request])).not.toContain("Mode:");
    const events: DbEvent[] = [{ ...request, payload: { plan_task_id: "t1", request_id: "r1", allow_always: true } }, { ...request, id: 2, kind: "session_modes", payload: { plan_task_id: "t1", available: [{ id: "auto", name: "Automatic" }], current: "auto" } }];
    const html = render(events);
    expect(html).toContain("Always allow");
    expect(html).toContain("Mode: Automatic");
    expect(html).toContain("Automatic");
  });

  test("[ADR-0018.D3] mode and always-allow controls dispatch their selected values", () => {
    const session = { id: 1, title: "Session", workspacePath: "/repo", optInWorktree: false, conciseReplies: false, model: null, subAgents: [] };
    const task = { id: "t1", title: "Work", team: "", harness: "omp", worktree: false, files: [], dependencies: [], estimated_tokens: null, status: "running" as const };
    const plan = { session_id: 1, revision: 1, phase: "Build" as const, approved: true, estimated_tokens: null, tasks_started: true, tasks: [task] };
    const events: DbEvent[] = [
      { id: 1, session_id: 1, task_id: null, kind: "permission_request", payload: { plan_task_id: "t1", request_id: "req", allow_always: true }, created_at: "2026-11-28" },
      { id: 2, session_id: 1, task_id: null, kind: "session_modes", payload: { plan_task_id: "t1", available: [{ id: "auto", name: "Automatic" }, { id: "default", name: "Default" }], current: "auto" }, created_at: "2026-11-28" },
    ];
    const onMode = mock((_taskId: string, _modeId: string) => {});
    const onPermission = mock((_taskId: string, _requestId: string, _decision: "allow" | "deny" | "allow_always") => {});
    const tree = Chat({ session, plan, events, busy: false, onApprove: () => {}, onOpenAgent: () => {}, onToggleWorktree: () => {}, onCreateSession: () => {}, prompt: "", onPromptChange: () => {}, error: null, loading: false, onMode, onPermission });
    const defaultModeItem = findElement(tree, (element) => element.type === DropdownMenuItem && findElement(element, (child) => child.props?.children === "Default") !== null);
    defaultModeItem!.props.onClick();
    findElement(tree, (element) => element.props.children === "Always allow")!.props.onClick();
    expect(onMode).toHaveBeenCalledWith("t1", "default");
    expect(onPermission).toHaveBeenCalledWith("t1", "req", "allow_always");
  });

  test("[ADR-0018.D4] shows conversation and groups resolved and tool events as activity", () => {
    const session = { id: 1, title: "Session", workspacePath: "/repo", optInWorktree: false, conciseReplies: false, model: null, subAgents: [] };
    const task = { id: "t1", title: "Work", team: "", harness: "omp", worktree: false, files: [], dependencies: [], estimated_tokens: null, status: "running" as const };
    const plan = { session_id: 1, revision: 1, phase: "Build" as const, approved: true, estimated_tokens: null, tasks_started: true, tasks: [task] };
    const event = (id: number, kind: string, payload: Record<string, string>): DbEvent => ({ id, session_id: 1, task_id: null, kind, payload: { plan_task_id: "t1", ...payload }, created_at: "2026-11-28" });
    const events = [event(1, "user_message", { text: "Question" }), event(2, "agent_message", { text: "Answer" }), event(3, "permission_request", { request_id: "done" }), event(4, "permission_resolved", { request_id: "done" }), event(5, "tool_call", { tool: "shell" })];
    const html = renderToStaticMarkup(<TooltipProvider><Chat session={session} plan={plan} events={events} busy={false} onApprove={() => {}} onOpenAgent={() => {}} onToggleWorktree={() => {}} onCreateSession={() => {}} prompt="" onPromptChange={() => {}} error={null} loading={false} /></TooltipProvider>);
    expect(html).toContain("Question");
    expect(html).toContain("Answer");
    expect(html).toContain("Activity (");
    expect(html).toContain("tool_call");
    expect(html).not.toContain("Permission required");
    expect(html).toContain("Open agent");
  });

  test("[ADR-0019.D2] disables worktree isolation for a non-git project", () => {
    const session = { id: 1, title: "Session", workspacePath: "/folder", optInWorktree: false, conciseReplies: false, model: null, subAgents: [] };
    const html = renderToStaticMarkup(<TooltipProvider><Chat session={session} plan={null} nonGit busy={false} onApprove={() => {}} onOpenAgent={() => {}} onToggleWorktree={() => {}} onCreateSession={() => {}} prompt="" onPromptChange={() => {}} error={null} loading={false} /></TooltipProvider>);
    expect(html).toContain("Not a git repository: worktree isolation is unavailable");
    expect(html).toMatch(/role="switch"[^>]*disabled/);
  });
});

describe("[ADR-0016.D2] responsive shell", () => {
  test("fills the viewport and only exposes expanded region separators", () => {
    const oldWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
    const oldStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: () => null } });
    try {
      Object.defineProperty(globalThis, "window", { configurable: true, value: { innerWidth: 1440 } });
      const wide = renderToStaticMarkup(<App />);
      expect(wide).toContain("h-screen w-screen flex-col overflow-hidden");
      expect(wide).toContain('data-region="left"');
      expect(wide).toContain('data-region="content"');
      expect(wide).toContain('data-region="right"');
      expect(wide).toContain('data-region="status"');
      expect(wide).toContain('aria-valuenow="18"');
      expect(wide).toContain('aria-valuemin="14"');
      expect(wide).toContain('aria-valuemax="29"');
      Object.defineProperty(globalThis, "window", { configurable: true, value: { innerWidth: 1024 } });
      const narrow = renderToStaticMarkup(<App />);
      expect(narrow).not.toContain('data-region="right"');
      expect(narrow).not.toContain('aria-label="Resize contextual panel"');
      Object.defineProperty(globalThis, "window", { configurable: true, value: { innerWidth: 1440 } });
      Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: (key: string) => key === "bentobox.leftCollapsed" ? "true" : null } });
      const collapsed = renderToStaticMarkup(<App />);
      expect(collapsed).not.toContain('aria-label="Resize project sidebar"');
      expect(collapsed).toContain('aria-label="Resize contextual panel"');
    } finally {
      if (oldWindow) Object.defineProperty(globalThis, "window", oldWindow); else Reflect.deleteProperty(globalThis, "window");
      if (oldStorage) Object.defineProperty(globalThis, "localStorage", oldStorage); else Reflect.deleteProperty(globalThis, "localStorage");
    }
  });
});

describe("[ADR-0016.D1] frame button dimensions", () => {
  test("uses 32px, 28px and 28px for the default, small and icon variants", () => {
    expect(renderToStaticMarkup(<Button />)).toContain("h-8");
    expect(renderToStaticMarkup(<Button size="sm" />)).toContain("h-7");
    expect(renderToStaticMarkup(<Button size="icon" />)).toContain("size-7");
  });
});

describe("[ADR-0016.D2] session telemetry", () => {
  test("does not invent usage for an unselected session", () => {
    const html = renderToStaticMarkup(<TooltipProvider><StatusBar selectedSessionId={null} /></TooltipProvider>);
    expect(html).not.toContain("1,840 tokens");
    expect(html).toContain("No session");
  });
});
  test("[ADR-0016.D2] collapses identical quota states into a single indicator", () => {
    const identicalStates = [
      { harnessId: "claude", quota: null, reason: "Not implemented" },
      { harnessId: "codex", quota: null, reason: "Not implemented" },
      { harnessId: "omp", quota: null, reason: "Not implemented" },
    ];
    const html = renderToStaticMarkup(<TooltipProvider><QuotaIndicators states={identicalStates} /></TooltipProvider>);
    const matches = html.match(/quota Unavailable/g);
    expect(matches?.length).toBe(1);
    expect(html).not.toContain("claude quota Unavailable");
  });

  test("[ADR-0016.D2] distinguishes differing quota states with harness prefix", () => {
    const mixedStates = [
      { harnessId: "claude", quota: { harness_id: "claude", limit: { status: "available" as const, value: 100 }, remaining: { status: "available" as const, value: 50 } }, reason: "" },
      { harnessId: "omp", quota: null, reason: "Not implemented" },
    ];
    const html = renderToStaticMarkup(<TooltipProvider><QuotaIndicators states={mixedStates} /></TooltipProvider>);
    expect(html).toContain("claude quota 50 remaining");
    expect(html).toContain("omp quota Unavailable");
  });


test("[ADR-0018.D3] mode picker reflects the latest mode change", () => {
  const session = { id: 1, title: "Session", workspacePath: "/repo", optInWorktree: false, conciseReplies: false, model: null, subAgents: [] };
  const task = { id: "t1", title: "Work", team: "", harness: "omp", worktree: false, files: [], dependencies: [], estimated_tokens: null, status: "review" as const };
  const plan = { session_id: 1, revision: 1, phase: "Review" as const, approved: true, estimated_tokens: null, tasks_started: true, tasks: [task] };
  const events: DbEvent[] = [
    { id: 1, session_id: 1, task_id: null, kind: "session_modes", payload: { plan_task_id: "t1", available: [{ id: "auto", name: "Automatic" }, { id: "default", name: "Default" }], current: "auto" }, created_at: "2026-11-28" },
    { id: 2, session_id: 1, task_id: null, kind: "session_mode_changed", payload: { plan_task_id: "t1", current: "default" }, created_at: "2026-11-28" },
  ];
  const tree = Chat({ session, plan, events, busy: false, onApprove: () => {}, onOpenAgent: () => {}, onToggleWorktree: () => {}, onCreateSession: () => {}, prompt: "", onPromptChange: () => {}, error: null, loading: false });
  const modeBtn = findElement(tree, (element) => element.type === Button && findElement(element, (child) => typeof child.props?.children === "string" && child.props.children.includes("Mode: Default")) !== null);
  expect(modeBtn).not.toBeNull();
});

test("[ADR-0018.D4] renders flushed agent messages in order and shows working status", () => {
  const session = { id: 1, title: "Session", workspacePath: "/repo", optInWorktree: false, conciseReplies: false, model: null, subAgents: [] };
  const task = { id: "t1", title: "Work", team: "", harness: "omp", worktree: false, files: [], dependencies: [], estimated_tokens: null, status: "running" as const };
  const plan = { session_id: 1, revision: 1, phase: "Build" as const, approved: true, estimated_tokens: null, tasks_started: true, tasks: [task] };
  const events: DbEvent[] = [
    { id: 1, session_id: 1, task_id: null, kind: "agent_message", payload: { plan_task_id: "t1", text: "Hello " }, created_at: "2026-11-28" },
    { id: 2, session_id: 1, task_id: null, kind: "tool_call", payload: { plan_task_id: "t1", tool: "read" }, created_at: "2026-11-28" },
    { id: 3, session_id: 1, task_id: null, kind: "agent_message", payload: { plan_task_id: "t1", text: "world" }, created_at: "2026-11-28" },
  ];
  const html = renderToStaticMarkup(<TooltipProvider><Chat session={session} plan={plan} events={events} busy={false} onApprove={() => {}} onOpenAgent={() => {}} onToggleWorktree={() => {}} onCreateSession={() => {}} prompt="" onPromptChange={() => {}} error={null} loading={false} /></TooltipProvider>);
  expect(html.indexOf("Hello ")).toBeLessThan(html.indexOf("world"));
  expect(html).toContain("Agent working…");
  expect(html).toContain("Activity (");
});

test("[ADR-0018.D4] keeps agent replies on opposite sides of a user message separate", () => {
  const session = { id: 1, title: "Session", workspacePath: "/repo", optInWorktree: false, conciseReplies: false, model: null, subAgents: [] };
  const task = { id: "t1", title: "Work", team: "", harness: "omp", worktree: false, files: [], dependencies: [], estimated_tokens: null, status: "review" as const };
  const plan = { session_id: 1, revision: 1, phase: "Review" as const, approved: true, estimated_tokens: null, tasks_started: true, tasks: [task] };
  const event = (id: number, kind: string, text: string): DbEvent => ({ id, session_id: 1, task_id: null, kind, payload: { plan_task_id: "t1", text }, created_at: "2026-11-28" });
  const events = [event(1, "agent_message", "First reply"), event(2, "user_message", "Follow up"), event(3, "agent_message", "Second reply")];
  const html = renderToStaticMarkup(<TooltipProvider><Chat session={session} plan={plan} events={events} busy={false} onApprove={() => {}} onOpenAgent={() => {}} onToggleWorktree={() => {}} onCreateSession={() => {}} prompt="" onPromptChange={() => {}} error={null} loading={false} /></TooltipProvider>);
  expect(html.indexOf("First reply")).toBeLessThan(html.indexOf("Follow up"));
  expect(html.indexOf("Follow up")).toBeLessThan(html.indexOf("Second reply"));
  expect(html).not.toContain("Agent working…");
});

test("[ADR-0018.D2] running and review chats offer Stop, Send and pending permission controls", () => {
  const session = { id: 1, title: "Session", workspacePath: "/repo", optInWorktree: false, conciseReplies: false, model: null, subAgents: [] };
  const onStop = mock((_taskId: string) => {});
  const onPermission = mock((_taskId: string, _requestId: string, _decision: "allow" | "deny" | "allow_always") => {});
  const events: DbEvent[] = [{ id: 1, session_id: 1, task_id: null, kind: "permission_request", payload: { plan_task_id: "t1", request_id: "r1" }, created_at: "2026-11-28" }];
  for (const status of ["running", "review", "completed"] as const) {
    const task = { id: "t1", title: "Work", team: "", harness: "omp", worktree: false, files: [], dependencies: [], estimated_tokens: null, status };
    const plan = { session_id: 1, revision: 1, phase: "Review" as const, approved: true, estimated_tokens: null, tasks_started: true, tasks: [task] };
    const tree = Chat({ session, plan, events, busy: false, onApprove: () => {}, onOpenAgent: () => {}, onToggleWorktree: () => {}, onCreateSession: () => {}, prompt: "Follow up", onPromptChange: () => {}, error: null, loading: false, selectedHarness: "omp", onStop, onPermission });
    const stop = findElement(tree, (element) => element.type === Button && element.props.children === "Stop");
    const allow = findElement(tree, (element) => element.type === Button && element.props.children === "Allow");
    const deny = findElement(tree, (element) => element.type === Button && element.props.children === "Deny");
    expect(!!stop).toBe(status !== "completed");
    if (status !== "completed") {
      stop!.props.onClick();
      expect(allow?.props.disabled).toBe(false);
      expect(deny?.props.disabled).toBe(false);
      allow!.props.onClick();
      deny!.props.onClick();
      expect(findElement(tree, (element) => element.type === Button && element.props.type === "submit")?.props.disabled).toBe(false);
    }
  }
  expect(onStop).toHaveBeenCalledTimes(2);
  expect(onStop).toHaveBeenCalledWith("t1");
  expect(onPermission).toHaveBeenCalledTimes(4);
  expect(onPermission).toHaveBeenCalledWith("t1", "r1", "allow");
  expect(onPermission).toHaveBeenCalledWith("t1", "r1", "deny");
});

test("[ADR-0018.D4] the chat renders no bordered agent message box and no workspace path line", () => {
  const session = { id: 1, title: "Session", workspacePath: "/repo/special/path", optInWorktree: false, conciseReplies: false, model: null, subAgents: [] };
  const task = { id: "t1", title: "Work", team: "", harness: "omp", worktree: false, files: [], dependencies: [], estimated_tokens: null, status: "review" as const };
  const plan = { session_id: 1, revision: 1, phase: "Review" as const, approved: true, estimated_tokens: null, tasks_started: true, tasks: [task] };
  const events: DbEvent[] = [
    { id: 1, session_id: 1, task_id: null, kind: "user_message", payload: { plan_task_id: "t1", text: "User prompt" }, created_at: "2026-11-28" },
    { id: 2, session_id: 1, task_id: null, kind: "agent_message", payload: { plan_task_id: "t1", text: "Agent response" }, created_at: "2026-11-28" },
  ];
  const html = renderToStaticMarkup(
    <TooltipProvider>
      <Chat session={session} plan={plan} events={events} busy={false} onApprove={() => {}} onOpenAgent={() => {}} onToggleWorktree={() => {}} onCreateSession={() => {}} prompt="" onPromptChange={() => {}} error={null} loading={false} />
    </TooltipProvider>
  );

  // Workspace path <p> is removed
  expect(html).not.toContain("/repo/special/path");
  // User message renders in elevated bubble
  expect(html).toContain("User prompt");
  expect(html).toContain('data-chat-role="user"');
  expect(html).toContain("bg-surface-elevated");

  // Agent message renders borderless (no border class on assistant message element)
  expect(html).toContain("Agent response");
  expect(html).toContain('data-chat-role="assistant"');
  const assistantMatch = html.match(/<div[^>]*data-chat-role="assistant"[^>]*class="([^"]*)"/);
  expect(assistantMatch).not.toBeNull();
  expect(assistantMatch![1]).not.toMatch(/\bborder\b/);
});

test("[ADR-0018.D4] Send button has aria-label Send", () => {
  const session = { id: 1, title: "Session", workspacePath: "/repo", optInWorktree: false, conciseReplies: false, model: null, subAgents: [] };
  const task = { id: "t1", title: "Work", team: "", harness: "omp", worktree: false, files: [], dependencies: [], estimated_tokens: null, status: "review" as const };
  const plan = { session_id: 1, revision: 1, phase: "Review" as const, approved: true, estimated_tokens: null, tasks_started: true, tasks: [task] };
  const html = renderToStaticMarkup(
    <TooltipProvider>
      <Chat session={session} plan={plan} busy={false} onApprove={() => {}} onOpenAgent={() => {}} onToggleWorktree={() => {}} onCreateSession={() => {}} prompt="Hello" onPromptChange={() => {}} error={null} loading={false} selectedHarness="omp" />
    </TooltipProvider>
  );
  expect(html).toContain('aria-label="Send"');
});

test("[ADR-0020.D2] Concise toggle does not call sessionSetConcise on render and calls it with next value on toggle", () => {
  const onToggleConcise = mock(() => {});
  const session = { id: 1, title: "Session", workspacePath: "/repo", optInWorktree: false, conciseReplies: false, model: null, subAgents: [] };
  const tree = Chat({
    session,
    plan: null,
    busy: false,
    onApprove: () => {},
    onOpenAgent: () => {},
    onToggleWorktree: () => {},
    onToggleConcise,
    onCreateSession: () => {},
    prompt: "",
    onPromptChange: () => {},
    error: null,
    loading: false,
  });

  // Does not call on render
  expect(onToggleConcise).not.toHaveBeenCalled();

  // Finds concise toggle switch and triggers change
  const conciseSwitch = findElement(tree, (element) => element.props?.checked === false && typeof element.props?.onCheckedChange === "function");
  expect(conciseSwitch).not.toBeNull();
  conciseSwitch!.props.onCheckedChange(true);
  expect(onToggleConcise).toHaveBeenCalledTimes(1);
});

test("[ADR-0021.D2] the disabled reason is visually hidden for the empty prompt", () => {
  const session = { id: 1, title: "Session", workspacePath: "/repo", optInWorktree: false, conciseReplies: false, model: null, subAgents: [] };
  const emptyPromptHtml = renderToStaticMarkup(
    <TooltipProvider>
      <Chat session={session} plan={null} busy={false} onApprove={() => {}} onOpenAgent={() => {}} onToggleWorktree={() => {}} onCreateSession={() => {}} prompt="" onPromptChange={() => {}} error={null} loading={false} selectedHarness="omp" />
    </TooltipProvider>
  );
  expect(emptyPromptHtml).toContain('class="sr-only">Describe a goal for the agent.</p>');

  const noHarnessHtml = renderToStaticMarkup(
    <TooltipProvider>
      <Chat session={session} plan={null} busy={false} onApprove={() => {}} onOpenAgent={() => {}} onToggleWorktree={() => {}} onCreateSession={() => {}} prompt="" onPromptChange={() => {}} error={null} loading={false} selectedHarness={null} />
    </TooltipProvider>
  );
  expect(noHarnessHtml).toContain('class="px-3 text-xs text-muted-foreground">Select an ACP harness to run this goal.</p>');
});

test("[ADR-0018.D4] the status row renders Open agent + Stop for running and review", () => {
  const session = { id: 1, title: "Session", workspacePath: "/repo", optInWorktree: false, conciseReplies: false, model: null, subAgents: [] };
  for (const status of ["running", "review", "completed"] as const) {
    const task = { id: "t1", title: "Work", team: "", harness: "omp", worktree: false, files: [], dependencies: [], estimated_tokens: null, status };
    const plan = { session_id: 1, revision: 1, phase: "Build" as const, approved: true, estimated_tokens: null, tasks_started: true, tasks: [task] };
    const html = renderToStaticMarkup(
      <TooltipProvider>
        <Chat session={session} plan={plan} busy={false} onApprove={() => {}} onOpenAgent={() => {}} onToggleWorktree={() => {}} onCreateSession={() => {}} prompt="" onPromptChange={() => {}} error={null} loading={false} selectedHarness="omp" />
      </TooltipProvider>
    );
    expect(html).toContain("Open agent");
    if (status === "running") {
      expect(html).toContain("Agent working…");
      expect(html).toContain("Stop");
    } else if (status === "review") {
      expect(html).toContain("review");
      expect(html).toContain("Stop");
    } else {
      expect(html).toContain("completed");
      expect(html).not.toContain("Stop");
    }
  }
});

test("[ADR-0021.D2] combined picker renders harness monogram, honest states, and default model", () => {
  const session = { id: 1, title: "Session", workspacePath: "/repo", optInWorktree: false, conciseReplies: false, model: null, subAgents: [] };
  const harnesses = [
    {
      capabilities: {
        harness_id: "omp",
        display_name: "Oh My Pi",
        executable: "omp",
        transport: "acp" as const,
        transport_args: [],
        binary_version: "1.0",
        models: null,
        effort_levels: null,
        features: { session_lifecycle: true, events: true, tool_permissions: true, cancellation: true, resume_history: null, usage_context: true },
        known_limitations: [],
      },
      executable_path: "/bin/omp",
      runnable: true,
      launch_note: null,
    },
  ];

  const readyTree = Chat({
    session,
    plan: null,
    busy: false,
    onApprove: () => {},
    onOpenAgent: () => {},
    onToggleWorktree: () => {},
    onCreateSession: () => {},
    prompt: "",
    onPromptChange: () => {},
    error: null,
    loading: false,
    harnesses,
    selectedHarness: "omp",
    modelCatalog: {
      status: "ready",
      models: [{ id: "sonnet", name: "Sonnet" }],
      currentModel: null,
      note: null,
    },
  });
  const readyHtml = renderToStaticMarkup(<TooltipProvider>{readyTree}</TooltipProvider>);
  expect(readyHtml).toContain("om");
  expect(readyHtml).toContain("Oh My Pi · Default model");
  const defaultModelItem = findElement(readyTree, (element) => element.type === DropdownMenuItem && findElement(element, (child) => child.props?.children === "Default model") !== null);
  expect(defaultModelItem).not.toBeNull();
  const sonnetItem = findElement(readyTree, (element) => element.type === DropdownMenuItem && findElement(element, (child) => child.props?.children === "Sonnet") !== null);
  expect(sonnetItem).not.toBeNull();

  const authTree = Chat({
    session,
    plan: null,
    busy: false,
    onApprove: () => {},
    onOpenAgent: () => {},
    onToggleWorktree: () => {},
    onCreateSession: () => {},
    prompt: "",
    onPromptChange: () => {},
    error: null,
    loading: false,
    harnesses,
    selectedHarness: "omp",
    modelCatalog: {
      status: "auth_required",
      models: [],
      currentModel: null,
      note: "Run claude login",
    },
  });
  const authText = findElement(authTree, (element) => element.props?.children === "Sign in to list models");
  expect(authText).not.toBeNull();
  const noteText = findElement(authTree, (element) => element.props?.children === "Run claude login");
  expect(noteText).not.toBeNull();
});

test("[ADR-0021.D2] harness switch clears session model via callback", () => {
  const session = { id: 1, title: "Session", workspacePath: "/repo", optInWorktree: false, conciseReplies: false, model: "sonnet", subAgents: [] };
  const onSelectHarness = mock((_id: string) => {});
  const harnesses = [
    {
      capabilities: {
        harness_id: "omp",
        display_name: "Oh My Pi",
        executable: "omp",
        transport: "acp" as const,
        transport_args: [],
        binary_version: "1.0",
        models: null,
        effort_levels: null,
        features: { session_lifecycle: true, events: true, tool_permissions: true, cancellation: true, resume_history: null, usage_context: true },
        known_limitations: [],
      },
      executable_path: "/bin/omp",
      runnable: true,
      launch_note: null,
    },
    {
      capabilities: {
        harness_id: "codex",
        display_name: "OpenAI Codex",
        executable: "codex",
        transport: "acp" as const,
        transport_args: [],
        binary_version: "1.0",
        models: null,
        effort_levels: null,
        features: { session_lifecycle: true, events: true, tool_permissions: true, cancellation: true, resume_history: null, usage_context: true },
        known_limitations: [],
      },
      executable_path: "/bin/codex",
      runnable: true,
      launch_note: null,
    },
  ];
  const tree = Chat({
    session,
    plan: null,
    busy: false,
    onApprove: () => {},
    onOpenAgent: () => {},
    onToggleWorktree: () => {},
    onCreateSession: () => {},
    prompt: "",
    onPromptChange: () => {},
    error: null,
    loading: false,
    harnesses,
    selectedHarness: "omp",
    onSelectHarness,
  });
  const codexItem = findElement(tree, (element) => element.type === DropdownMenuItem && findElement(element, (child) => child.props?.children === "OpenAI Codex") !== null);
  expect(codexItem).not.toBeNull();
  codexItem!.props.onClick();
  expect(onSelectHarness).toHaveBeenCalledWith("codex");
});
