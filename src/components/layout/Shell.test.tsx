import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import App, { Chat, TopBar, nextStateAfterCreate } from "../../App";
import { StatusBar } from "./StatusBar";
import { TooltipProvider } from "../ui/tooltip";
import { Button } from "../ui/button";

describe("[ADR-0016.D2] session composer", () => {
  test("retains the supplied draft and makes unavailable execution explicit", () => {
    const html = renderToStaticMarkup(<TooltipProvider><Chat session={null} onToggleWorktree={() => {}} onCreateSession={() => {}} prompt="Investigate issue #42" onPromptChange={() => {}} error={null} loading={false} /></TooltipProvider>);
    expect(html).toContain("Investigate issue #42");
    expect(html).toContain("disabled");
    expect(html).toContain("Orchestrator execution isn&#x27;t available yet");
  });

  test("does not highlight a phase when there is no plan", () => {
    const html = renderToStaticMarkup(<TooltipProvider><TopBar session={null} collapsed={false} onToggle={() => {}} /></TooltipProvider>);
    expect(html).not.toContain('aria-current="step"');
  });

  test("shows the actual worktree branch or a non-monospace fallback", () => {
    const session = { id: 1, title: "Session", workspacePath: "/repo", optInWorktree: true, subAgents: [] };
    const render = (worktreeBranch?: string) => renderToStaticMarkup(<TooltipProvider><TopBar session={{ ...session, worktreeBranch }} collapsed={false} onToggle={() => {}} /></TooltipProvider>);
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
