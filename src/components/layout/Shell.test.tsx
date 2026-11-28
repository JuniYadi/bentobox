import { describe, expect, mock, test } from "bun:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import App, { Chat, TopBar, applyRecentTitles, nextStateAfterCreate, withSessionTitle } from "../../App";
import { StatusBar } from "./StatusBar";
import { TooltipProvider } from "../ui/tooltip";
import { Button } from "../ui/button";
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
    const session = { id: 1, title: "Session", workspacePath: "/repo", optInWorktree: true, subAgents: [] };
    const render = (worktreeBranch?: string) => renderToStaticMarkup(<TooltipProvider><TopBar session={{ ...session, worktreeBranch }} plan={null} collapsed={false} onToggle={() => {}} /></TooltipProvider>);
    expect(render()).toContain("Worktree on");
    expect(render()).not.toContain('class="font-mono">Worktree on');
    expect(render("feature/test")).toContain('class="font-mono">feature/test');
  });

  test("creating a session retains the current composer draft", () => {
    const previous = { sessions: [{ id: 1, title: "Existing", workspacePath: "/repo", optInWorktree: false, subAgents: [] }], prompt: "Keep this draft" };
    const created = { id: 2, title: "New session", workspacePath: "/repo", optInWorktree: false, subAgents: [] };
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
    const session = { id: 1, title: "Session", workspacePath: "/repo", optInWorktree: false, subAgents: [] };
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
    const session = { id: 1, title: "Session", workspacePath: "/repo", optInWorktree: false, subAgents: [] };
    const plan = { session_id: 1, revision: 2, phase: "Plan" as const, approved: false, estimated_tokens: null, tasks_started: false, tasks: [{ id: "t1", title: "Implement feature", team: "", harness: "omp", worktree: false, files: [], dependencies: [], estimated_tokens: null, status: "queued" as const }] };
    const html = renderToStaticMarkup(<TooltipProvider><Chat session={session} plan={plan} busy={false} onApprove={() => {}} onOpenAgent={() => {}} onToggleWorktree={() => {}} onCreateSession={() => {}} prompt="" onPromptChange={() => {}} error={null} loading={false} /></TooltipProvider>);
    expect(html).not.toContain("Approve &amp; build");
  });

  test("[ADR-0018.D4] multi-task plans show sub-agents only after tasks start", () => {
    const session = { id: 1, title: "Session", workspacePath: "/repo", optInWorktree: false, subAgents: [] };
    const task = { id: "t1", title: "Implement feature", team: "", harness: "omp", worktree: true, files: [], dependencies: [], estimated_tokens: null, status: "queued" as const };
    const plan = { session_id: 1, revision: 2, phase: "Build" as const, approved: true, estimated_tokens: null, tasks_started: false, tasks: [task, { ...task, id: "t2", title: "Review feature" }] };
    const render = (tasks_started: boolean) => renderToStaticMarkup(<TooltipProvider><Chat session={session} plan={{ ...plan, tasks_started }} busy={false} onApprove={() => {}} onOpenAgent={() => {}} onToggleWorktree={() => {}} onCreateSession={() => {}} prompt="" onPromptChange={() => {}} error={null} loading={false} /></TooltipProvider>);
    expect(render(false)).not.toContain("Implement feature");
    expect(render(true)).toContain("Implement feature");
  });

  test("does not render an approval card or revision placeholder in Build", () => {
    const session = { id: 1, title: "Session", workspacePath: "/repo", optInWorktree: false, subAgents: [] };
    const plan = { session_id: 1, revision: 2, phase: "Build" as const, approved: true, estimated_tokens: null, tasks_started: true, tasks: [] };
    const html = renderToStaticMarkup(<TooltipProvider><Chat session={session} plan={plan} busy={false} onApprove={() => {}} onOpenAgent={() => {}} onToggleWorktree={() => {}} onCreateSession={() => {}} prompt="" onPromptChange={() => {}} error={null} loading={false} /></TooltipProvider>);
    expect(html).not.toContain("Approve &amp; build");
    expect(html).not.toContain("Reply to revise the plan");
    expect(html).toContain("Describe the goal");
  });

  test("[ADR-0018.D3] modes and always-allow appear only when advertised", () => {
    const session = { id: 1, title: "Session", workspacePath: "/repo", optInWorktree: false, subAgents: [] };
    const task = { id: "t1", title: "Work", team: "", harness: "omp", worktree: false, files: [], dependencies: [], estimated_tokens: null, status: "running" as const };
    const plan = { session_id: 1, revision: 1, phase: "Build" as const, approved: true, estimated_tokens: null, tasks_started: true, tasks: [task] };
    const request: DbEvent = { id: 1, session_id: 1, task_id: null, kind: "permission_request", payload: { plan_task_id: "t1", request_id: "r1", operation: "Write" }, created_at: "2026-11-28" };
    const props = { session, plan, busy: false, onApprove: () => {}, onOpenAgent: () => {}, onToggleWorktree: () => {}, onCreateSession: () => {}, prompt: "", onPromptChange: () => {}, error: null, loading: false };
    const render = (events: DbEvent[]) => renderToStaticMarkup(<TooltipProvider><Chat {...props} events={events} /></TooltipProvider>);
    expect(render([request])).not.toContain("Always allow");
    expect(render([request])).not.toContain('aria-label="Mode"');
    const events: DbEvent[] = [{ ...request, payload: { plan_task_id: "t1", request_id: "r1", allow_always: true } }, { ...request, id: 2, kind: "session_modes", payload: { plan_task_id: "t1", available: [{ id: "auto", name: "Automatic" }], current: "auto" } }];
    const html = render(events);
    expect(html).toContain("Always allow");
    expect(html).toContain('aria-label="Mode"');
    expect(html).toContain("Automatic");
  });

  test("[ADR-0018.D3] mode and always-allow controls dispatch their selected values", () => {
    const session = { id: 1, title: "Session", workspacePath: "/repo", optInWorktree: false, subAgents: [] };
    const task = { id: "t1", title: "Work", team: "", harness: "omp", worktree: false, files: [], dependencies: [], estimated_tokens: null, status: "running" as const };
    const plan = { session_id: 1, revision: 1, phase: "Build" as const, approved: true, estimated_tokens: null, tasks_started: true, tasks: [task] };
    const events: DbEvent[] = [
      { id: 1, session_id: 1, task_id: null, kind: "permission_request", payload: { plan_task_id: "t1", request_id: "req", allow_always: true }, created_at: "2026-11-28" },
      { id: 2, session_id: 1, task_id: null, kind: "session_modes", payload: { plan_task_id: "t1", available: [{ id: "auto", name: "Automatic" }, { id: "default", name: "Default" }], current: "auto" }, created_at: "2026-11-28" },
    ];
    const onMode = mock((_taskId: string, _modeId: string) => {});
    const onPermission = mock((_taskId: string, _requestId: string, _decision: "allow" | "deny" | "allow_always") => {});
    const tree = Chat({ session, plan, events, busy: false, onApprove: () => {}, onOpenAgent: () => {}, onToggleWorktree: () => {}, onCreateSession: () => {}, prompt: "", onPromptChange: () => {}, error: null, loading: false, onMode, onPermission });
    findElement(tree, (element) => element.type === "select" && element.props["aria-label"] === "Mode")!.props.onChange({ target: { value: "default" } });
    findElement(tree, (element) => element.props.children === "Always allow")!.props.onClick();
    expect(onMode).toHaveBeenCalledWith("t1", "default");
    expect(onPermission).toHaveBeenCalledWith("t1", "req", "allow_always");
  });

  test("[ADR-0018.D4] shows conversation and groups resolved and tool events as activity", () => {
    const session = { id: 1, title: "Session", workspacePath: "/repo", optInWorktree: false, subAgents: [] };
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
    const session = { id: 1, title: "Session", workspacePath: "/folder", optInWorktree: false, subAgents: [] };
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

test("[ADR-0018.D3] mode picker reflects the latest mode change", () => {
  const session = { id: 1, title: "Session", workspacePath: "/repo", optInWorktree: false, subAgents: [] };
  const task = { id: "t1", title: "Work", team: "", harness: "omp", worktree: false, files: [], dependencies: [], estimated_tokens: null, status: "review" as const };
  const plan = { session_id: 1, revision: 1, phase: "Review" as const, approved: true, estimated_tokens: null, tasks_started: true, tasks: [task] };
  const events: DbEvent[] = [
    { id: 1, session_id: 1, task_id: null, kind: "session_modes", payload: { plan_task_id: "t1", available: [{ id: "auto", name: "Automatic" }, { id: "default", name: "Default" }], current: "auto" }, created_at: "2026-11-28" },
    { id: 2, session_id: 1, task_id: null, kind: "session_mode_changed", payload: { plan_task_id: "t1", current: "default" }, created_at: "2026-11-28" },
  ];
  const tree = Chat({ session, plan, events, busy: false, onApprove: () => {}, onOpenAgent: () => {}, onToggleWorktree: () => {}, onCreateSession: () => {}, prompt: "", onPromptChange: () => {}, error: null, loading: false });
  expect(findElement(tree, (element) => element.type === "select" && element.props["aria-label"] === "Mode")?.props.value).toBe("default");
});

test("[ADR-0018.D4] renders flushed agent messages in order and shows working status", () => {
  const session = { id: 1, title: "Session", workspacePath: "/repo", optInWorktree: false, subAgents: [] };
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
  const session = { id: 1, title: "Session", workspacePath: "/repo", optInWorktree: false, subAgents: [] };
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
  const session = { id: 1, title: "Session", workspacePath: "/repo", optInWorktree: false, subAgents: [] };
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
