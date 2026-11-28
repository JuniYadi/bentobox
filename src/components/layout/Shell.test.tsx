import { describe, expect, mock, test } from "bun:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import App, { Chat, TopBar, nextStateAfterCreate } from "../../App";
import { StatusBar } from "./StatusBar";
import { TooltipProvider } from "../ui/tooltip";
import { Button } from "../ui/button";
import { PlanCard } from "../../features/session/PlanCard";

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
    expect(html).toContain("Orchestrator execution isn&#x27;t available yet");
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
});

describe("[ADR-0016.D3] plan in the shell", () => {
  test("renders the plan composer placeholder and sends the displayed revision", () => {
    const session = { id: 1, title: "Session", workspacePath: "/repo", optInWorktree: false, subAgents: [] };
    const plan = { session_id: 1, revision: 17, phase: "Plan" as const, approved: false, estimated_tokens: null, tasks_started: false, tasks: [] };
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

  test("shows sub-agents only after tasks start", () => {
    const session = { id: 1, title: "Session", workspacePath: "/repo", optInWorktree: false, subAgents: [] };
    const plan = { session_id: 1, revision: 2, phase: "Build" as const, approved: true, estimated_tokens: null, tasks_started: false, tasks: [{ id: "t1", title: "Implement feature", team: "", harness: "omp", worktree: true, files: [], dependencies: [], estimated_tokens: null, status: "queued" as const }] };
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
