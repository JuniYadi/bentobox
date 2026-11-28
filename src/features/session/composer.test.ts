import { describe, expect, test } from "bun:test";
import type { DetectedHarness } from "../agent/api";
import type { Plan } from "./types";
import {
  buildOneTaskPlan,
  getComposerHarnessOptions,
  getModelDisplayName,
  harnessMonogram,
  modelPickerState,
  phaseStepState,
  sendState,
  toggleSessionConcise,
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

  test("[ADR-0021.D2] carries optional model parameter on plan task", () => {
    const withModel = buildOneTaskPlan("Task with model", "omp", true, "m1", "sonnet");
    expect(withModel[0].model).toBe("sonnet");

    const withNull = buildOneTaskPlan("Task with default model", "omp", true, "m2", null);
    expect(withNull[0].model).toBeNull();

    const withoutModel = buildOneTaskPlan("Task without model", "omp", true, "m3");
    expect(withoutModel[0].model).toBeUndefined();
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

describe("[ADR-0017.D4] harness list options and runnable states", () => {
  test("includes all detected harnesses, marks non-acp as non-runnable, and exposes launch notes", () => {
    const options = getComposerHarnessOptions(sampleHarnesses);
    expect(options.length).toBe(3);
    expect(options.map((o) => o.harnessId)).toEqual(["omp", "claude", "pi"]);

    const omp = options.find((o) => o.harnessId === "omp")!;
    expect(omp.runnable).toBe(true);
    expect(omp.disabledReason).toBeNull();
    expect(omp.launchNote).toBeNull();

    const claude = options.find((o) => o.harnessId === "claude")!;
    expect(claude.runnable).toBe(false);
    expect(claude.disabledReason).toBe("downloads the adapter with npx on first use");
    expect(claude.launchNote).toBe("downloads the adapter with npx on first use");

    const pi = options.find((o) => o.harnessId === "pi")!;
    expect(pi.runnable).toBe(false);
    expect(pi.disabledReason).toBe("offline");
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

describe("[ADR-0018.D1] phaseStepState", () => {
  test("classifies steps into done, current, or upcoming", () => {
    expect(phaseStepState("Plan", "Plan")).toBe("current");
    expect(phaseStepState("Plan", "Approve")).toBe("upcoming");
    expect(phaseStepState("Build", "Plan")).toBe("done");
    expect(phaseStepState("Build", "Approve")).toBe("done");
    expect(phaseStepState("Build", "Build")).toBe("current");
    expect(phaseStepState("Build", "Review")).toBe("upcoming");
    expect(phaseStepState(null, "Plan")).toBe("upcoming");
    expect(phaseStepState("Rejected", "Plan")).toBe("upcoming");
  });
});

describe("[ADR-0020.D2] toggleSessionConcise", () => {
  test("toggles concise setting optimistically and invokes API once", async () => {
    const calls: Array<{ id: number; enabled: boolean }> = [];
    let state = { sessions: [{ id: 1, conciseReplies: false }], error: null as string | null };
    const mutate = (updater: (prev: typeof state) => typeof state) => {
      state = updater(state);
    };

    const ok = await toggleSessionConcise(
      1,
      mutate,
      async (id, enabled) => {
        calls.push({ id, enabled });
      }
    );

    expect(ok).toBe(true);
    expect(calls).toEqual([{ id: 1, enabled: true }]);
    expect(state.sessions[0].conciseReplies).toBe(true);
    expect(state.error).toBeNull();
  });

  test("rolls back and shows error banner on failure", async () => {
    let state = { sessions: [{ id: 1, conciseReplies: false }], error: null as string | null };
    const mutate = (updater: (prev: typeof state) => typeof state) => {
      state = updater(state);
    };

    const ok = await toggleSessionConcise(
      1,
      mutate,
      async () => {
        throw new Error("backend failed");
      }
    );

    expect(ok).toBe(false);
    expect(state.sessions[0].conciseReplies).toBe(false);
    expect(state.error).toContain("backend failed");
  });

  test("rapid toggle: does not overwrite a newer toggle state on delayed failure", async () => {
    let state = { sessions: [{ id: 1, conciseReplies: false }], error: null as string | null };
    const mutate = (updater: (prev: typeof state) => typeof state) => {
      state = updater(state);
    };

    // First toggle starts (false -> true) and will fail later
    const { promise: firstApiPromise, reject: rejectFirst } = Promise.withResolvers<void>();
    const firstPromise = toggleSessionConcise(
      1,
      mutate,
      () => firstApiPromise
    );
    expect(state.sessions[0].conciseReplies).toBe(true);

    // User toggles again before first completes (true -> false), succeeds
    const secondPromise = toggleSessionConcise(
      1,
      mutate,
      async () => {}
    );
    await secondPromise;
    expect(state.sessions[0].conciseReplies).toBe(false);

    // Now first toggle fails: it should NOT roll back the second toggle's state
    rejectFirst(new Error("first toggle rejected"));
    await firstPromise;

    expect(state.sessions[0].conciseReplies).toBe(false);
    expect(state.error).toContain("first toggle rejected");
  });
});

describe("[ADR-0021.D2] modelPickerState mapping", () => {
  test("maps loading and undefined to loading state", () => {
    expect(modelPickerState(undefined)).toEqual({ status: "loading", message: "Loading models…", models: [], retry: false, note: null });
    expect(modelPickerState("loading")).toEqual({ status: "loading", message: "Loading models…", models: [], retry: false, note: null });
  });

  test("maps error to retryable error state", () => {
    expect(modelPickerState("error")).toEqual({ status: "error", message: "Could not load models", models: [], retry: true, note: null });
  });

  test("maps auth_required with note", () => {
    const state = modelPickerState({ status: "auth_required", models: [], currentModel: null, note: "Login with claude login" });
    expect(state).toEqual({ status: "auth_required", message: "Sign in to list models", models: [], retry: false, note: "Login with claude login" });
  });

  test("maps timeout and unavailable to retryable states with note", () => {
    expect(modelPickerState({ status: "timeout", models: [], currentModel: null, note: "Process timed out" })).toEqual({
      status: "timeout",
      message: "Could not load models",
      models: [],
      retry: true,
      note: "Process timed out",
    });
    expect(modelPickerState({ status: "unavailable", models: [], currentModel: null, note: "Harness not runnable" })).toEqual({
      status: "unavailable",
      message: "Could not load models",
      models: [],
      retry: true,
      note: "Harness not runnable",
    });
  });

  test("maps unadvertised and empty models list without inventing names", () => {
    expect(modelPickerState({ status: "unadvertised", models: [], currentModel: null, note: null })).toEqual({
      status: "unadvertised",
      message: "Model selection not advertised by this agent",
      models: [],
      retry: false,
      note: null,
    });
    expect(modelPickerState({ status: "ready", models: [], currentModel: null, note: null })).toEqual({
      status: "unadvertised",
      message: "Model selection not advertised by this agent",
      models: [],
      retry: false,
      note: null,
    });
  });

  test("maps ready status with advertised models", () => {
    const state = modelPickerState({
      status: "ready",
      models: [{ id: "sonnet", name: "Sonnet" }, { id: "haiku", name: "Haiku" }],
      currentModel: "sonnet",
      note: null,
    });
    expect(state.status).toBe("ready");
    expect(state.message).toBeNull();
    expect(state.retry).toBe(false);
    expect(state.models).toEqual([{ id: "sonnet", name: "Sonnet" }, { id: "haiku", name: "Haiku" }]);
  });
});

describe("[ADR-0021.D2] harnessMonogram and getModelDisplayName", () => {
  test("harnessMonogram returns correct 2-letter badges", () => {
    expect(harnessMonogram("claude")).toBe("Cl");
    expect(harnessMonogram("codex")).toBe("Cx");
    expect(harnessMonogram("omp")).toBe("om");
    expect(harnessMonogram("pi")).toBe("pi");
    expect(harnessMonogram("opencode")).toBe("Op");
    expect(harnessMonogram("custom")).toBe("cu");
  });

  test("getModelDisplayName returns Default model or advertised name without inventing models", () => {
    const models = [{ id: "sonnet", name: "Sonnet" }, { id: "haiku", name: "Haiku" }];
    expect(getModelDisplayName(null, models)).toBe("Default model");
    expect(getModelDisplayName(undefined, models)).toBe("Default model");
    expect(getModelDisplayName("sonnet", models)).toBe("Sonnet");
    expect(getModelDisplayName("raw-id", models)).toBe("raw-id");
  });
});
