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
  getPermissionResolution,
  isPermissionPending,
  mappedTaskId,
  taskEvents,
  mergeEvents,
} from "./index";
import { partitionChatTimeline } from "./timeline";

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
  conciseReplies: false,
  model: null,
  team: null,
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
test("[ADR-0018.D4] partitions conversation, pending permissions and parent activity", () => {
  const make = (id: number, kind: string, payload: Record<string, string | boolean>): DbEvent => ({ id, session_id: 42, task_id: null, kind, payload: { plan_task_id: sampleTask.id, ...payload }, created_at: "2026-11-28T14:19:00Z" });
  const events = [make(1, "user_message", { text: "hello" }), make(2, "agent_message", { text: "hi" }), make(3, "permission_request", { request_id: "pending" }), make(4, "permission_request", { request_id: "done" }), make(5, "permission_resolved", { request_id: "done" }), make(6, "agent_message", { text: "child", parent_tool_call_id: "parent" }), make(7, "tool_call", { tool: "read" }), make(8, "steer_sent", { text: "old" })];
  const result = partitionChatTimeline(events, sampleTask);
  expect(result.chatItems.map((event) => event.id)).toEqual([1, 2, 3]);
  expect(result.activityItems.map((event) => event.id)).toEqual([4, 5, 6, 7, 8]);
});

test("[ADR-0018.D4] sub-agent messages and thoughts are always activity", () => {
  const event = (id: number, kind: string): DbEvent => ({ id, session_id: 42, task_id: null, kind, payload: { plan_task_id: sampleTask.id, parent_tool_call_id: "parent", text: "nested" }, created_at: "2026-11-28T14:19:00Z" });
  const events = [event(1, "agent_message"), event(2, "agent_thought")];
  const result = partitionChatTimeline(events, sampleTask);
  expect(result.chatItems).toEqual([]);
  expect(result.activityItems).toEqual(events);
});

test("[ADR-0018.D4] consecutive agent_message events merge into one chat item and a tool_call between them keeps them separate", () => {
  const make = (id: number, kind: string, payload: Record<string, string | boolean>): DbEvent => ({
    id,
    session_id: 42,
    task_id: null,
    kind,
    payload: { plan_task_id: sampleTask.id, ...payload },
    created_at: `2026-11-28T14:1${id}:00Z`,
  });

  // Case 1: consecutive agent_message events merge into one item
  const consecutive = [
    make(1, "user_message", { text: "Hello" }),
    make(2, "agent_message", { text: "Part 1 " }),
    make(3, "agent_message", { text: "Part 2" }),
  ];
  const merged = partitionChatTimeline(consecutive, sampleTask);
  expect(merged.chatItems.length).toBe(2);
  expect(merged.chatItems[0].kind).toBe("user_message");
  expect(merged.chatItems[1].id).toBe(2);
  expect(merged.chatItems[1].created_at).toBe("2026-11-28T14:12:00Z");
  const mergedPayload = merged.chatItems[1].payload;
  const mergedText = mergedPayload && typeof mergedPayload === "object" && !Array.isArray(mergedPayload) && "text" in mergedPayload ? mergedPayload.text : null;
  expect(mergedText).toBe("Part 1 Part 2");
  // Case 2: a tool_call between them keeps them separate
  const splitByTool = [
    make(1, "agent_message", { text: "First reply" }),
    make(2, "tool_call", { tool: "read" }),
    make(3, "agent_message", { text: "Second reply" }),
  ];
  const split = partitionChatTimeline(splitByTool, sampleTask);
  expect(split.chatItems.length).toBe(2);
  expect(split.chatItems[0].id).toBe(1);
  const firstPayload = split.chatItems[0].payload;
  const firstText = firstPayload && typeof firstPayload === "object" && !Array.isArray(firstPayload) && "text" in firstPayload ? firstPayload.text : null;
  expect(firstText).toBe("First reply");
  expect(split.chatItems[1].id).toBe(3);
  const secondPayload = split.chatItems[1].payload;
  const secondText = secondPayload && typeof secondPayload === "object" && !Array.isArray(secondPayload) && "text" in secondPayload ? secondPayload.text : null;
  expect(secondText).toBe("Second reply");
});

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
  test("Pause, Stop, Take over, Allow and Deny show disabled reasons when task is not running", () => {
    const controls = ["Pause", "Stop", "Take over", "Allow", "Deny"] as const;

    for (const control of controls) {
      expect(disabledAgentControls[control]).toBeTruthy();
      expect(disabledAgentControls[control].length).toBeGreaterThan(0);
    }

    const completedTask: PlanTask = { ...sampleTask, status: "completed" };
    const html = renderToStaticMarkup(
      <AgentDetailView
        session={sampleSession}
        plan={samplePlan}
        task={completedTask}
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
    expect(html).toMatch(/<button[^>]*\sdisabled=""[^>]*>[^<]*Pause/);
    expect(html).toMatch(/<button[^>]*\sdisabled=""[^>]*>[^<]*Stop/);
    expect(html).toMatch(/<button[^>]*\sdisabled=""[^>]*>[^<]*Take over/);
    expect(html).toMatch(/<button[^>]*\sdisabled=""[^>]*>[^<]*Allow/);
    expect(html).toMatch(/<button[^>]*\sdisabled=""[^>]*>[^<]*Deny/);
  });
});

describe("[ADR-0017.D2] control enablement matrix and permissions", () => {
  test("Stop is enabled when task is running, while Pause and Take over stay disabled", () => {
    const runningHtml = renderToStaticMarkup(
      <AgentDetailView
        session={sampleSession}
        plan={samplePlan}
        task={sampleTask}
        onBack={() => {}}
        events={sampleEvents}
      />
    );

    // Pause and Take over remain disabled with visible reasons
    const textOnly = runningHtml.replace(/<[^>]*>/g, " ");
    expect(textOnly).toContain(disabledAgentControls.Pause);
    expect(textOnly).toContain(disabledAgentControls["Take over"]);
    expect(runningHtml).toMatch(/<button[^>]*\sdisabled=""[^>]*>[^<]*Pause/);
    expect(runningHtml).toMatch(/<button[^>]*\sdisabled=""[^>]*>[^<]*Take over/);

    // Stop is NOT disabled
    expect(runningHtml).not.toMatch(/<button[^>]*\sdisabled=""[^>]*>[^<]*Stop/);

  });

  test("[ADR-0018.D2] Stop is enabled in review and disabled after completion", () => {
    for (const status of ["review", "completed", "failed", "cancelled"] as const) {
      const html = renderToStaticMarkup(<AgentDetailView session={sampleSession} plan={samplePlan} task={{ ...sampleTask, status }} onBack={() => {}} events={[]} />);
      const stop = html.match(/<button[^>]*aria-label="Stop"[^>]*>/)?.[0];
      expect(stop).toBeDefined();
      expect(stop?.includes("disabled=")).toBe(status !== "review");
    }
  });

  test("pending permission derivation correctly tracks resolved requests and running status", () => {
    const events: DbEvent[] = [
      {
        id: 10,
        session_id: 42,
        task_id: null,
        kind: "permission_request",
        payload: { plan_task_id: "task-1", request_id: "req-1", operation: "edit_file" },
        created_at: "2026-11-28T14:19:00Z",
      },
      {
        id: 11,
        session_id: 42,
        task_id: null,
        kind: "permission_request",
        payload: { plan_task_id: "task-1", request_id: "req-2", operation: "run_shell" },
        created_at: "2026-11-28T14:19:10Z",
      },
      {
        id: 12,
        session_id: 42,
        task_id: null,
        kind: "permission_resolved",
        payload: { plan_task_id: "task-1", request_id: "req-1", decision: "allow" },
        created_at: "2026-11-28T14:19:20Z",
      },
    ];

    expect(isPermissionPending(events, "req-1", "running")).toBe(false);
    expect(isPermissionPending(events, "req-2", "running")).toBe(true);
    expect(isPermissionPending(events, "req-2", "review")).toBe(true);
    expect(isPermissionPending(events, "req-2", "failed")).toBe(false);
    expect(isPermissionPending(events, "req-2", "cancelled")).toBe(false);

    expect(getPermissionResolution(events, "req-1")).toBe("allow");
    expect(getPermissionResolution(events, "req-2")).toBeNull();
  });

  test("Allow and Deny are enabled for pending permissions, and resolved permissions render resolution badge", () => {
    const pendingEvents: DbEvent[] = [
      {
        id: 30,
        session_id: 42,
        task_id: null,
        kind: "permission_request",
        payload: {
          plan_task_id: "task-1",
          request_id: "perm-active",
          operation: "write_file",
          target: "src/main.rs",
          can_allow: true,
          can_deny: true,
        },
        created_at: "2026-11-28T14:19:00Z",
      },
    ];

    const pendingHtml = renderToStaticMarkup(
      <AgentDetailView
        session={sampleSession}
        plan={samplePlan}
        task={sampleTask}
        onBack={() => {}}
        events={pendingEvents}
      />
    );

    // Allow and Deny are enabled
    expect(pendingHtml).not.toMatch(/<button[^>]*\sdisabled=""[^>]*>[^<]*Allow/);
    expect(pendingHtml).not.toMatch(/<button[^>]*\sdisabled=""[^>]*>[^<]*Deny/);
    expect(pendingHtml).not.toContain("View diff");

    // Resolved permission
    const resolvedEvents: DbEvent[] = [
      ...pendingEvents,
      {
        id: 31,
        session_id: 42,
        task_id: null,
        kind: "permission_resolved",
        payload: { plan_task_id: "task-1", request_id: "perm-active", decision: "allow" },
        created_at: "2026-11-28T14:19:10Z",
      },
    ];

    const resolvedHtml = renderToStaticMarkup(
      <AgentDetailView
        session={sampleSession}
        plan={samplePlan}
        task={sampleTask}
        onBack={() => {}}
        events={resolvedEvents}
      />
    );
    expect(resolvedHtml).toContain("PERMISSION RESOLVED");
    expect(resolvedHtml).toContain("allow");
  });

  test("disabled reason shows visibly when can_allow or can_deny is false", () => {
    const restrictedEvents: DbEvent[] = [
      {
        id: 32,
        session_id: 42,
        task_id: null,
        kind: "permission_request",
        payload: {
          plan_task_id: "task-1",
          request_id: "perm-no-deny",
          operation: "critical_write",
          can_allow: true,
          can_deny: false,
        },
        created_at: "2026-11-28T14:19:00Z",
      },
    ];

    const html = renderToStaticMarkup(
      <AgentDetailView
        session={sampleSession}
        plan={samplePlan}
        task={sampleTask}
        onBack={() => {}}
        events={restrictedEvents}
      />
    );

    expect(html.replace(/<[^>]*>/g, " ")).toContain("Agent did not offer a deny option.");
    expect(html).toMatch(/<button[^>]*\sdisabled=""[^>]*>[^<]*Deny/);
    expect(html).not.toMatch(/<button[^>]*\sdisabled=""[^>]*>[^<]*Allow/);
  });

  test("timeline renders task_state, agent_message and agent_thought; historical steer stays in Activity", () => {
    const richEvents: DbEvent[] = [
      {
        id: 40,
        session_id: 42,
        task_id: null,
        kind: "task_state",
        payload: { plan_task_id: "task-1", status: "running" },
        created_at: "2026-11-28T14:19:00Z",
      },
      {
        id: 41,
        session_id: 42,
        task_id: null,
        kind: "agent_message",
        payload: { plan_task_id: "task-1", text: "Starting workspace inspection." },
        created_at: "2026-11-28T14:19:02Z",
      },
      {
        id: 42,
        session_id: 42,
        task_id: null,
        kind: "agent_thought",
        payload: { plan_task_id: "task-1", text: "Considering which files to examine." },
        created_at: "2026-11-28T14:19:03Z",
      },
      {
        id: 43,
        session_id: 42,
        task_id: null,
        kind: "steer_queued",
        payload: { plan_task_id: "task-1", text: "Check rustfmt first" },
        created_at: "2026-11-28T14:19:05Z",
      },
    ];

    const timeline = buildTimeline(richEvents, sampleTask);
    expect(timeline.map((item) => item.type)).toEqual([
      "task_state",
      "agent_message",
      "agent_thought",
    ]);


    const html = renderToStaticMarkup(
      <AgentDetailView
        session={sampleSession}
        plan={samplePlan}
        task={sampleTask}
        onBack={() => {}}
        events={richEvents}
      />
    );

    expect(html).toContain("Starting workspace inspection.");
    expect(html).toContain("Considering which files to examine.");
    expect(html).toContain("Thought");
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

  test("renders handoff following ADR-0007 shape with line ranges and arrays", () => {
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
    expect(html).toContain("Handoff");
    expect(html).not.toContain("Orchestrator handoff");
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

  test("renders non-blocking notice when eventsTruncated is true", () => {
    const html = renderToStaticMarkup(
      <AgentDetailView
        session={sampleSession}
        plan={samplePlan}
        task={sampleTask}
        onBack={() => {}}
        events={sampleEvents}
        eventsTruncated={true}
      />
    );
    expect(html).toContain("Showing the first 5,000 events");
    expect(html).toContain("Agent activity");
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
  const statusColorBorder = /\bborder-(?:warning|success|destructive|danger)(?:\/\d+)?\b/;
  const statusColorFillOnText = /<[A-Za-z0-9_.-]+[^>]*\bclassName="[^"]*\bbg-(?:warning|success|destructive|danger)(?:\/\d+)?\b[^"]*"[^>]*>[^<]*[A-Za-z0-9]/;
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

      // D1 rule: No status color border (neutral border + dot)
      expect(source).not.toMatch(statusColorBorder);

      // D1 rule: No status color fill behind text
      expect(source).not.toMatch(statusColorFillOnText);

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

describe("[ADR-0017.D2] event refresh deduplication, ordering, and cap handling", () => {
  test("merging overlapping pages yields no duplicate ids and keeps order", () => {
    const existing: DbEvent[] = [
      { id: 1, session_id: 1, task_id: null, kind: "handoff", payload: {}, created_at: "2026-11-28T14:00:00Z" },
      { id: 2, session_id: 1, task_id: null, kind: "tool", payload: {}, created_at: "2026-11-28T14:01:00Z" },
      { id: 3, session_id: 1, task_id: null, kind: "agent_message", payload: {}, created_at: "2026-11-28T14:02:00Z" },
    ];
    const incoming: DbEvent[] = [
      { id: 2, session_id: 1, task_id: null, kind: "tool", payload: {}, created_at: "2026-11-28T14:01:00Z" },
      { id: 3, session_id: 1, task_id: null, kind: "agent_message", payload: {}, created_at: "2026-11-28T14:02:00Z" },
      { id: 4, session_id: 1, task_id: null, kind: "agent_thought", payload: {}, created_at: "2026-11-28T14:03:00Z" },
    ];

    const result = mergeEvents(existing, incoming);
    expect(result.events.map((e) => e.id)).toEqual([1, 2, 3, 4]);
    expect(result.truncated).toBe(false);
  });

  test("reaching 5,000 cap stops appending, preserves loaded events, and returns truncated flag", () => {
    const existing: DbEvent[] = Array.from({ length: 5000 }, (_, i) => ({
      id: i + 1,
      session_id: 1,
      task_id: null,
      kind: "tool",
      payload: {},
      created_at: "2026-11-28T14:00:00Z",
    }));
    const incoming: DbEvent[] = [
      { id: 5001, session_id: 1, task_id: null, kind: "tool", payload: {}, created_at: "2026-11-28T15:00:00Z" },
    ];

    const result = mergeEvents(existing, incoming, 5000);
    expect(result.events.length).toBe(5000);
    expect(result.truncated).toBe(true);
    expect(result.events[0].id).toBe(1);
    expect(result.events[4999].id).toBe(5000);
  });

  test("serialized pass picking up events that arrived during the first pass", async () => {
    let inFlight = false;
    let pending = false;
    const passCalls: number[] = [];
    let availableEvents: DbEvent[] = [
      { id: 1, session_id: 1, task_id: null, kind: "tool", payload: {}, created_at: "2026-11-28T14:00:00Z" },
    ];
    let loadedEvents: DbEvent[] = [];

    const runPass = async () => {
      if (inFlight) {
        pending = true;
        return;
      }
      inFlight = true;
      try {
        passCalls.push(availableEvents.length);
        // Simulate async merge with available events
        const { promise, resolve } = Promise.withResolvers<void>();
        setTimeout(resolve, 10);
        await promise;
        loadedEvents = mergeEvents(loadedEvents, availableEvents).events;
      } finally {
        inFlight = false;
        if (pending) {
          pending = false;
          await runPass();
        }
      }
    };

    // Pass 1 starts
    const p1 = runPass();
    // Event arrives while pass 1 is in-flight
    availableEvents = [
      ...availableEvents,
      { id: 2, session_id: 1, task_id: null, kind: "tool", payload: {}, created_at: "2026-11-28T14:01:00Z" },
    ];
    const p2 = runPass();

    await Promise.all([p1, p2]);

    expect(passCalls.length).toBe(2);
    expect(loadedEvents.map((e) => e.id)).toEqual([1, 2]);
  });
});

test("[ADR-0018.D4] nested pending permissions remain in Activity", () => {
  const event: DbEvent = { id: 90, session_id: 42, task_id: null, kind: "permission_request", payload: { plan_task_id: sampleTask.id, request_id: "nested", parent_tool_call_id: "parent" }, created_at: "2026-11-28T14:19:00Z" };
  const { chatItems, activityItems } = partitionChatTimeline([event], sampleTask);
  expect(chatItems).toEqual([]);
  expect(activityItems).toEqual([event]);
});

test("[ADR-0018.D3] an always-allow response resolves its permission request", () => {
  const request: DbEvent = { id: 91, session_id: 42, task_id: null, kind: "permission_request", payload: { plan_task_id: sampleTask.id, request_id: "always", allow_always: true }, created_at: "2026-11-28T14:19:00Z" };
  const resolved: DbEvent = { ...request, id: 92, kind: "permission_resolved", payload: { plan_task_id: sampleTask.id, request_id: "always", decision: "allow_always" } };
  expect(getPermissionResolution([request, resolved], "always")).toBe("allow_always");
  expect(isPermissionPending([request, resolved], "always", "running")).toBe(false);
  expect(partitionChatTimeline([request, resolved], sampleTask).activityItems).toEqual([request, resolved]);
});
