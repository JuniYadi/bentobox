import { describe, expect, test } from "bun:test";
import type { DetectedHarness } from "../agent/api";
import type { Plan } from "./types";
import {
  buildOneTaskPlan,
  getComposerHarnessOptions,
  sendState,
} from "./composer";

const sampleHarnesses: DetectedHarness[] = [
  {
    capabilities: {
      harness_id: "omp",
      display_name: "Oh My Pi",
      executable: "omp",
      transport: "acp",
      transport_args: ["acp"],
      binary_version: "19.2.1",
      models: null,
      effort_levels: null,
      features: {
        session_lifecycle: true,
        events: true,
        tool_permissions: true,
        cancellation: true,
        resume_history: null,
        usage_context: true,
      },
      known_limitations: [],
    },
    executable_path: "/opt/homebrew/bin/omp",
    runnable: true,
    launch_note: null,
  },
  {
    capabilities: {
      harness_id: "claude",
      display_name: "Claude Code",
      executable: "claude",
      transport: "acp",
      transport_args: [],
      binary_version: null,
      models: null,
      effort_levels: null,
      features: {
        session_lifecycle: true,
        events: true,
        tool_permissions: true,
        cancellation: true,
        resume_history: null,
        usage_context: true,
      },
      known_limitations: [],
    },
    executable_path: "npx",
    runnable: false,
    launch_note: "downloads the adapter with npx on first use",
  },
  {
    capabilities: {
      harness_id: "pi",
      display_name: "Pi Native",
      executable: "pi",
      transport: "native_process",
      transport_args: [],
      binary_version: "1.0.0",
      models: null,
      effort_levels: null,
      features: {
        session_lifecycle: false,
        events: false,
        tool_permissions: false,
        cancellation: false,
        resume_history: null,
        usage_context: false,
      },
      known_limitations: [],
    },
    executable_path: "/usr/local/bin/pi",
    runnable: false,
    launch_note: null,
  },
];

describe("[ADR-0017.D4] buildOneTaskPlan shape", () => {
  test("creates a one-task plan with a unique id, trimmed title, empty team, chosen harness, and worktree setting", () => {
    const tasks = buildOneTaskPlan("  Implement ADR-0017 frontend  ", "omp", true, "abc123");
    expect(tasks).toEqual([
      {
        id: "task-abc123",
        title: "Implement ADR-0017 frontend",
        team: "",
        harness: "omp",
        worktree: true,
        files: [],
        dependencies: [],
        estimated_tokens: null,
        status: "queued",
      },
    ]);
  });

  test("respects false for worktree isolation", () => {
    const tasks = buildOneTaskPlan("Refactor helper", "codex", false, "fixed");
    expect(tasks[0].worktree).toBe(false);
    expect(tasks[0].harness).toBe("codex");
  });

  test("[ADR-0017.D4] distinct suffixes produce distinct workspace-safe task IDs", () => {
    const first = buildOneTaskPlan("First", "omp", true, "abc123")[0].id;
    const second = buildOneTaskPlan("Second", "omp", true, "abc124")[0].id;
    expect(first).not.toBe(second);
    expect(first).toMatch(/^[A-Za-z0-9_][A-Za-z0-9_-]*$/);
    expect(second).toMatch(/^[A-Za-z0-9_][A-Za-z0-9_-]*$/);
  });
});

describe("[ADR-0017.D4] composer send disabled reasons", () => {
  const basePlan: Plan = {
    session_id: 1,
    revision: 1,
    phase: "Plan",
    approved: false,
    estimated_tokens: null,
    tasks_started: false,
    tasks: [],
  };

  test("disabled when plan is in progress (Plan, Approve, Build, Review)", () => {
    for (const phase of ["Plan", "Approve", "Build", "Review"] as const) {
      const state = sendState({
        text: "Add new feature",
        harness: "omp",
        plan: { ...basePlan, phase },
      });
      expect(state.enabled).toBe(false);
      expect(state.reason).toContain(`Plan in progress (${phase})`);
    }
  });

  test("[ADR-0018.D1] permits follow-ups to a running or review single-task chat but requires a harness", () => {
    const task = buildOneTaskPlan("First", "omp", false, "one")[0];
    for (const status of ["running", "review"] as const) {
      const plan = { ...basePlan, phase: status === "running" ? "Build" as const : "Review" as const, tasks: [{ ...task, status }] };
      expect(sendState({ text: "Follow up", harness: "omp", plan }).enabled).toBe(true);
      expect(sendState({ text: "Follow up", harness: null, plan }).enabled).toBe(false);
    }
  });

  test("disabled when harness is not selected", () => {
    const state = sendState({
      text: "Investigate crash",
      harness: null,
      plan: null,
    });
    expect(state.enabled).toBe(false);
    expect(state.reason).toBe("Select an ACP harness to run this goal.");
  });

  test("disabled when prompt text is empty or whitespace", () => {
    const state = sendState({
      text: "   ",
      harness: "omp",
      plan: null,
    });
    expect(state.enabled).toBe(false);
    expect(state.reason).toBe("Describe a goal for the agent.");
  });

  test("enabled when text is non-empty, harness is selected, and plan is null or closed/cancelled", () => {
    const freshState = sendState({
      text: "Write tests",
      harness: "omp",
      plan: null,
    });
    expect(freshState.enabled).toBe(true);
    expect(freshState.reason).toBeNull();

    for (const phase of ["Rejected", "Closed", "Cancelled"] as const) {
      const state = sendState({
        text: "Write tests",
        harness: "omp",
        plan: { ...basePlan, phase },
      });
      expect(state.enabled).toBe(true);
      expect(state.reason).toBeNull();
    }
  });
});

describe("[ADR-0017.D4] harness list filtering by transport and runnable", () => {
  test("filters out non-acp harnesses and exposes runnable flag and launch notes", () => {
    const options = getComposerHarnessOptions(sampleHarnesses);
    expect(options.length).toBe(2);
    expect(options.map((o) => o.harnessId)).toEqual(["omp", "claude"]);

    const omp = options.find((o) => o.harnessId === "omp")!;
    expect(omp.runnable).toBe(true);
    expect(omp.disabledReason).toBeNull();
    expect(omp.launchNote).toBeNull();

    const claude = options.find((o) => o.harnessId === "claude")!;
    expect(claude.runnable).toBe(false);
    expect(claude.disabledReason).toBe("downloads the adapter with npx on first use");
    expect(claude.launchNote).toBe("downloads the adapter with npx on first use");
  });
});

test("[ADR-0018.D1] a multi-task plan awaiting approval blocks direct send", () => {
  const first = buildOneTaskPlan("First", "omp", false, "first")[0];
  const second = buildOneTaskPlan("Second", "omp", false, "second")[0];
  const plan: Plan = { session_id: 1, revision: 1, phase: "Plan", approved: false, estimated_tokens: null, tasks_started: false, tasks: [first, second] };
  const state = sendState({ text: "Another message", harness: "omp", plan });
  expect(state.enabled).toBe(false);
  expect(state.reason).toContain("Plan in progress");
});
