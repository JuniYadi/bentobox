import { describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import type { DbEvent } from "../../../src-tauri/src/db/api";
import type { Plan, PlanTask, Session } from "../session/types";
import type { SessionUsage } from "../usage/api";
import {
  AgentDetailView,
  AgentRightPanel,
  SubAgentCard,
  buildTimeline,
  deriveDiffStats,
  deriveTimer,
  disabledAgentControls,
  mappedTaskId,
  taskEvents,
} from "./index";

const sampleTask: PlanTask = {
  id: "task-1",
  title: "Scaffold GitHub bridge",
  team: "cheaper",
  harness: "codex",
  worktree: true,
  files: [],
  dependencies: [],
  estimated_tokens: 1200,
  status: "running",
};

const sampleSession: Session & { worktreeBranch?: string } = {
  id: 42,
  title: "ACP multi-harness sync",
  workspacePath: "/Users/dev/bentobox",
  optInWorktree: true,
  subAgents: [],
  worktreeBranch: "task/gh-bridge",
};

const samplePlan: Plan = {
  session_id: 42,
  revision: 1,
  phase: "Build",
  approved: true,
  estimated_tokens: 1200,
  tasks_started: true,
  tasks: [sampleTask],
};

const sampleEvents: DbEvent[] = [
  {
    id: 1,
    session_id: 42,
    task_id: null,
    kind: "handoff",
    payload: {
      plan_task_id: "task-1",
      goal: "Add a GitHub CLI bridge",
      files: ["src-tauri/src/github/mod.rs"],
      constraints: "Keep changes in this worktree",
      check: "cargo check",
    },
    created_at: "2026-11-28T14:19:00Z",
  },
  {
    id: 2,
    session_id: 42,
    task_id: null,
    kind: "tool_call",
    payload: {
      plan_task_id: "task-1",
      tool: "read_file",
      path: "src-tauri/src/lib.rs",
      output: "file contents",
    },
    created_at: "2026-11-28T14:19:15Z",
  },
  {
    id: 3,
    session_id: 42,
    task_id: null,
    kind: "permission_request",
    payload: {
      plan_task_id: "task-1",
      operation: "Write",
      path: "src-tauri/src/github/mod.rs",
      additions: 84,
      deletions: 1,
    },
    created_at: "2026-11-28T14:19:42Z",
  },
  {
    id: 4,
    session_id: 42,
    task_id: null,
    kind: "tool_call",
    payload: {
      plan_task_id: "other-task",
      tool: "read_file",
      path: "src/App.tsx",
    },
    created_at: "2026-11-28T14:20:00Z",
  },
  {
    id: 5,
    session_id: 42,
    task_id: null,
    kind: "file_changed",
    payload: {
      plan_task_id: "task-1",
      path: "src-tauri/src/github/mod.rs",
      additions: 84,
      deletions: 1,
      branch: "task/gh-bridge",
    },
    created_at: "2026-11-28T14:19:42Z",
  },
];
describe("[ADR-0016.D4] timeline construction", () => {
  test("timeline builds from sample events only (no extras)", () => {
    const emptyTimeline = buildTimeline([], sampleTask);
    expect(emptyTimeline).toEqual([]);

    const timeline = buildTimeline(sampleEvents, sampleTask);
    expect(timeline.length).toBe(3);
    expect(timeline.map((item) => item.type)).toEqual(["handoff", "tool", "permission"]);
    expect(timeline.map((item) => item.event.id)).toEqual([1, 2, 3]);

    // Unknown kinds are ignored
    const unknownEvent: DbEvent = {
      id: 6,
      session_id: 42,
      task_id: null,
      kind: "unknown_custom_event",
      payload: { plan_task_id: "task-1" },
      created_at: "2026-11-28T14:21:00Z",
    };
    const withUnknown = buildTimeline([...sampleEvents, unknownEvent], sampleTask);
    expect(withUnknown.length).toBe(3);
  });

  test("derives task attribution from explicit payload ids only (no numeric fallback)", () => {
    const matched = taskEvents(sampleEvents, sampleTask);
    expect(matched.length).toBe(4);
    expect(
      matched.every((event) => {
        const payload = event.payload as { plan_task_id?: string; task_id?: string };
        return payload.plan_task_id === "task-1" || payload.task_id === "task-1";
      })
    ).toBe(true);

    const numericTask: PlanTask = { ...sampleTask, id: "7" };
    // Numeric event.task_id without payload match is NOT attributed
    const numericEvents: DbEvent[] = [
      { id: 10, session_id: 42, task_id: 7, kind: "tool", payload: {}, created_at: "2026-11-28T14:19:00Z" },
      { id: 11, session_id: 42, task_id: 8, kind: "tool", payload: {}, created_at: "2026-11-28T14:19:00Z" },
    ];
    expect(taskEvents(numericEvents, numericTask)).toEqual([]);
    expect(mappedTaskId(numericEvents, numericTask)).toBeNull();

    // Only explicit usage_task_id in payload maps numeric task ID
    const usageEvents: DbEvent[] = [
      {
        id: 12,
        session_id: 42,
        task_id: null,
        kind: "tool",
        payload: { plan_task_id: "7", usage_task_id: 7 },
        created_at: "2026-11-28T14:19:00Z",
      },
    ];
    expect(taskEvents(usageEvents, numericTask).map((event) => event.id)).toEqual([12]);
    expect(mappedTaskId(usageEvents, numericTask)).toBe(7);

    // Conflicting usage_task_id returns null (unambiguous requirement)
    const conflictingEvents: DbEvent[] = [
      ...usageEvents,
      {
        id: 13,
        session_id: 42,
        task_id: null,
        kind: "tool",
        payload: { plan_task_id: "7", usage_task_id: 9 },
        created_at: "2026-11-28T14:19:05Z",
      },
    ];
    expect(mappedTaskId(conflictingEvents, numericTask)).toBeNull();
  });

  test("derives diff count only from applied changes and takes latest per file path", () => {
    // Permission request additions/deletions must NOT be counted
    const permissionOnly: DbEvent[] = [
      {
        id: 1,
        session_id: 42,
        task_id: null,
        kind: "permission_request",
        payload: { plan_task_id: "task-1", path: "src/main.rs", additions: 50, deletions: 10 },
        created_at: "2026-11-28T14:19:00Z",
      },
    ];
    expect(deriveDiffStats(permissionOnly, sampleTask)).toBeNull();

    // Counts applied change events
    expect(deriveDiffStats(sampleEvents, sampleTask)).toEqual({ additions: 84, deletions: 1 });
    expect(deriveDiffStats([], sampleTask)).toBeNull();

    // When repeated for the same file path, uses the latest event per file path rather than summing
    const repeatedEvents: DbEvent[] = [
      {
        id: 20,
        session_id: 42,
        task_id: null,
        kind: "file_changed",
        payload: { plan_task_id: "task-1", path: "src/file1.ts", additions: 10, deletions: 2 },
        created_at: "2026-11-28T14:19:00Z",
      },
      {
        id: 21,
        session_id: 42,
        task_id: null,
        kind: "change_applied",
        payload: { plan_task_id: "task-1", path: "src/file1.ts", additions: 15, deletions: 3 },
        created_at: "2026-11-28T14:19:10Z",
      },
      {
        id: 22,
        session_id: 42,
        task_id: null,
        kind: "applied_change",
        payload: { plan_task_id: "task-1", path: "src/file2.ts", additions: 5, deletions: 0 },
        created_at: "2026-11-28T14:19:20Z",
      },
    ];
    expect(deriveDiffStats(repeatedEvents, sampleTask)).toEqual({ additions: 20, deletions: 3 });

    expect(deriveTimer(sampleEvents, sampleTask)).toBe("0:42");
    expect(deriveTimer([], sampleTask)).toBeNull();
  });
});

describe("[ADR-0016.D4] disabled agent controls", () => {
  test("every one of Pause, Stop, Take over, Allow, Deny, Steer renders disabled with a visible reason outside attributes", () => {
    const controls = ["Pause", "Stop", "Take over", "Allow", "Deny", "Steer"] as const;

    for (const control of controls) {
      expect(disabledAgentControls[control]).toBeTruthy();
      expect(disabledAgentControls[control].length).toBeGreaterThan(0);
    }

    const html = renderToStaticMarkup(
      <AgentDetailView
        session={sampleSession}
        plan={samplePlan}
        task={sampleTask}
        onBack={() => {}}
        events={sampleEvents}
      />
    );

    // Strip attributes to assert the reason is rendered visibly in text nodes
    const textOnly = html.replace(/<[^>]*>/g, " ");
    for (const control of controls) {
      const reason = disabledAgentControls[control];
      expect(textOnly).toContain(reason);
    }

    // Buttons are disabled
    expect(html).toMatch(/<button[^>]*disabled[^>]*>[^<]*Pause/);
    expect(html).toMatch(/<button[^>]*disabled[^>]*>[^<]*Stop/);
    expect(html).toMatch(/<button[^>]*disabled[^>]*>[^<]*Take over/);
    expect(html).toMatch(/<button[^>]*disabled[^>]*>[^<]*Allow/);
    expect(html).toMatch(/<button[^>]*disabled[^>]*>[^<]*Deny/);
    expect(html).toMatch(/<button[^>]*disabled[^>]*>[^<]*Steer/);
  });
});

describe("[ADR-0016.D4] SubAgentCard presentation", () => {
  test("Open agent link present on SubAgentCard and calls onOpen handler", () => {
    let opened = false;
    const card = (
      <SubAgentCard
        task={sampleTask}
        onOpen={() => {
          opened = true;
        }}
      />
    );
    const html = renderToStaticMarkup(card);

    expect(html).toContain("Open agent");
    expect(html).toContain("Scaffold GitHub bridge");
    expect(html).toContain("cheaper");
    expect(html).toContain("codex");
    expect(html).toContain("running");

    card.props.onOpen();
    expect(opened).toBe(true);
  });
});

describe("[ADR-0016.D4] agent detail navigation and presentation", () => {
  test("breadcrumb and back control rendered", () => {
    const html = renderToStaticMarkup(
      <AgentDetailView
        session={sampleSession}
        plan={samplePlan}
        task={sampleTask}
        onBack={() => {}}
        events={sampleEvents}
      />
    );

    expect(html).toContain('aria-label="Back to session"');
    expect(html).toContain('aria-label="Breadcrumb"');
    expect(html).toContain("bentobox");
    expect(html).toContain("ACP multi-harness sync");
    expect(html).toContain("codex · Scaffold GitHub bridge");
  });

  test("shows branch only when an attributed event payload supplies branch (string), else nothing", () => {
    const withBranch = renderToStaticMarkup(
      <AgentDetailView
        session={sampleSession}
        plan={samplePlan}
        task={sampleTask}
        onBack={() => {}}
        events={sampleEvents}
      />
    );
    expect(withBranch).toContain("task/gh-bridge");

    const withoutBranch = renderToStaticMarkup(
      <AgentDetailView
        session={sampleSession}
        plan={samplePlan}
        task={sampleTask}
        onBack={() => {}}
        events={[]}
      />
    );
    expect(withoutBranch).not.toContain("task/gh-bridge");
    expect(withoutBranch).not.toContain(`task/${sampleTask.id}`);
  });

  test("renders orchestrator handoff following ADR-0007 shape with line ranges and arrays", () => {
    const handoffEvent: DbEvent = {
      id: 50,
      session_id: 42,
      task_id: null,
      kind: "handoff",
      payload: {
        plan_task_id: "task-1",
        goal: "Implement token parsing",
        non_goals: ["Do not refactor lexer"],
        worktree_path: "/worktrees/agent-1",
        files: [
          { path: "src/parser.ts", lines: { start: 15, end: 42 } },
          { path: "src/tokens.ts" },
        ],
        constraints: ["Zero allocation in hot loop"],
        acceptance_commands: ["bun test src/parser.test.ts"],
      },
      created_at: "2026-11-28T14:19:00Z",
    };

    const html = renderToStaticMarkup(
      <AgentDetailView
        session={sampleSession}
        plan={samplePlan}
        task={sampleTask}
        onBack={() => {}}
        events={[handoffEvent]}
      />
    );

    expect(html).toContain("Implement token parsing");
    expect(html).toContain("Do not refactor lexer");
    expect(html).toContain("/worktrees/agent-1");
    expect(html).toContain("src/parser.ts:15-42");
    expect(html).toContain("src/tokens.ts");
    expect(html).toContain("Zero allocation in hot loop");
    expect(html).toContain("bun test src/parser.test.ts");
    expect(html).not.toContain("[object Object]");
  });

  test("uses monospace for branch, timer, and diff counts without hex colors", () => {
    const html = renderToStaticMarkup(
      <AgentDetailView
        session={sampleSession}
        plan={samplePlan}
        task={sampleTask}
        onBack={() => {}}
        events={sampleEvents}
      />
    );

    expect(html).toContain("task/gh-bridge");
    expect(html).toContain("+84 −1");
    expect(html).toContain("(0:42)");
    expect(html).not.toMatch(/#[\da-f]{3,8}\b/i);
  });
});

describe("[ADR-0016.D4] AgentRightPanel tabs", () => {
  test("renders real overview data with structured labels and values", () => {
    const usage: SessionUsage = {
      session_id: 42,
      total: { input_tokens: 1000, output_tokens: 200, costs: {} },
      tasks: {
        1: { input_tokens: 500, output_tokens: 100, costs: { USD: 0.02 } },
      },
      skipped_events: 0,
      reported_events: 1,
    };

    const taskWithFiles = { ...sampleTask, id: "1", files: ["src-tauri/src/github/mod.rs"] };
    const matchingEvents: DbEvent[] = [
      {
        id: 101,
        session_id: 42,
        task_id: 1,
        kind: "tool",
        payload: { plan_task_id: "1", usage_task_id: 1 },
        created_at: "2026-11-28T14:19:00Z",
      },
    ];
    const html = renderToStaticMarkup(
      <AgentRightPanel
        session={sampleSession}
        plan={samplePlan}
        task={taskWithFiles}
        events={matchingEvents}
        usage={usage}
      />
    );

    expect(html).toContain("Team");
    expect(html).toContain("cheaper");
    expect(html).toContain("Harness");
    expect(html).toContain("codex");
    expect(html).toContain("Input tokens");
    expect(html).toContain("500");
    expect(html).toContain("Output tokens");
    expect(html).toContain("100");
    expect(html).toContain("Cost (USD)");
    expect(html).toContain("0.0200");
    expect(html).toContain("Files touched");
    expect(html).toContain("src-tauri/src/github/mod.rs");
  });

  test("renders visible events error instead of empty state when eventsError is provided", () => {
    const errorMsg = "Database connection timed out";
    const detailHtml = renderToStaticMarkup(
      <AgentDetailView
        session={sampleSession}
        plan={samplePlan}
        task={sampleTask}
        onBack={() => {}}
        events={null}
        eventsError={errorMsg}
      />
    );
    expect(detailHtml).toContain(errorMsg);
    expect(detailHtml).not.toContain("No events recorded yet for this agent.");

    const panelHtml = renderToStaticMarkup(
      <AgentRightPanel
        session={sampleSession}
        plan={samplePlan}
        task={sampleTask}
        events={null}
        eventsError={errorMsg}
        usage={null}
      />
    );
    expect(panelHtml).toContain(errorMsg);
    expect(panelHtml).not.toContain("No log events recorded for this task.");
  });

  test("diff tab shows empty state when no diff events are present", () => {
    const html = renderToStaticMarkup(
      <AgentRightPanel
        session={sampleSession}
        plan={samplePlan}
        task={sampleTask}
        events={[]}
        usage={null}
      />
    );

    expect(html).toContain("No diff events recorded for this task.");
  });

  test("diff tab displays recorded diff when provided by an event", () => {
    const diffEvent: DbEvent = {
      id: 99,
      session_id: 42,
      task_id: null,
      kind: "tool",
      payload: {
        plan_task_id: "task-1",
        diff: "diff --git a/src/lib.rs b/src/lib.rs\n+mod github;",
      },
      created_at: "2026-11-28T14:19:30Z",
    };

    const html = renderToStaticMarkup(
      <AgentRightPanel
        session={sampleSession}
        plan={samplePlan}
        task={sampleTask}
        events={[diffEvent]}
        usage={null}
      />
    );

    expect(html).toContain("+mod github;");
  });
});

describe("[ADR-0016.D4] design constraints source scan", () => {
  const pixelWidth = /(?:width\s*:\s*[^,;}]*\b\d+(?:\.\d+)?px|(?:min-|max-)?w-\[[^\]]*\b\d+(?:\.\d+)?px[^\]]*\]|\[(?:width|min-width|max-width):[^\]]*\b\d+(?:\.\d+)?px[^\]]*\])/;
  const statusColorOnText = /\btext-(?:warning|success|destructive|danger)\b/;
  const monoAllowList = [
    /branchName/i,
    /GitBranch/i,
    /diffStats/i,
    /recordedDiff/i,
    /timer/i,
    /worktreePath/i,
    /files/i,
    /acceptanceCommands/i,
    /toolTarget/i,
    /<pre\b/i,
    /target/i,
    /file/i,
  ];

  test("enforces D1 styling rules across agent-detail sources", async () => {
    const dir = new URL(".", import.meta.url).pathname;
    const entries = await readdir(dir, { withFileTypes: true });
    const tsxFiles = entries
      .filter((entry) => entry.isFile() && (entry.name.endsWith(".tsx") || entry.name.endsWith(".ts")) && !entry.name.endsWith(".test.tsx"))
      .map((entry) => join(dir, entry.name));

    for (const file of tsxFiles) {
      const source = await readFile(file, "utf8");

      // No hardcoded hex color literals
      expect(source).not.toMatch(/#[\da-f]{3,8}\b/i);

      // No inline color style values
      expect(source).not.toMatch(/style=\{\{[^}]*(?:color|background)\s*:/i);

      // No pixel width literals
      expect(pixelWidth.test(source)).toBe(false);

      // D1 rule: No font-semibold or font-bold (use font-medium or regular)
      expect(source).not.toMatch(/\bfont-(?:semibold|bold)\b/);

      // D1 rule: No status color directly on text spans/elements (use neutral text + dot/icon)
      expect(source).not.toMatch(statusColorOnText);

      // D1 rule: font-mono only on allowed items (branches, paths, diff counts, timers, code/pre blocks)
      // Disallowed on task IDs, task numbers, token counts, costs, timestamps, file counts
      expect(source).not.toMatch(/task\.id[^<]*font-mono/);
      expect(source).not.toMatch(/created_at[^<]*font-mono/);
      expect(source).not.toMatch(/input_tokens[^<]*font-mono/);
      expect(source).not.toMatch(/output_tokens[^<]*font-mono/);
      expect(source).not.toMatch(/files\.length[^<]*font-mono/);

      const lines = source.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.includes("font-mono")) {
          const context = lines.slice(Math.max(0, i - 1), Math.min(lines.length, i + 3)).join(" ");
          const allowed = monoAllowList.some((pat) => pat.test(context));
          expect(allowed).toBe(true);
        }
      }
    }
  });
});
