import { describe, expect, mock, test } from "bun:test";
import { buildOneTaskPlan } from "../session/composer";

const invoked: Array<{ cmd: string; args: unknown }> = [];
const listeners: Array<{ event: string; handler: (event: unknown) => void }> = [];
let rejectApproval = false;

mock.module("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: unknown) => {
    invoked.push({ cmd, args });
    if (cmd === "runner_start") return Promise.resolve(["task-1"]);
    if (cmd === "session_propose_plan") return Promise.resolve({ revision: 17 });
    if (cmd === "session_approve_plan") return rejectApproval ? Promise.reject(new Error("approval failed")) : Promise.resolve({ revision: 17, approved: true });
    return Promise.resolve();
  },
}));

mock.module("@tauri-apps/api/event", () => ({
  listen: (event: string, handler: (event: unknown) => void) => {
    listeners.push({ event, handler });
    return Promise.resolve(() => {});
  },
}));
// Exception: dynamic import is required after mock.module to bind the mocked Tauri modules.
const { runnerStart, runnerStop, runnerRespondPermission, runnerSend, runnerSetMode, onRunnerEvent, onSessionTitle } = await import("./api");
// Exception: session API must bind the mocked Tauri invoke implementation.
const { startDirectRun } = await import("../session/api");

describe("[ADR-0017.D3] runner api wrappers", () => {
  test("[ADR-0018.D1] direct Send proposes, approves the returned revision, and starts", async () => {
    const tasks = buildOneTaskPlan("Fix it", "omp", false, "direct");
    const before = invoked.length;
    await startDirectRun(42, tasks);
    expect(invoked.slice(before)).toEqual([
      { cmd: "session_propose_plan", args: { sessionId: 42, tasks } },
      { cmd: "session_approve_plan", args: { sessionId: 42, expectedRevision: 17 } },
      { cmd: "runner_start", args: { sessionId: 42 } },
    ]);
  });

  test("[ADR-0018.D1] an approval failure never starts the runner", async () => {
    const before = invoked.length;
    rejectApproval = true;
    try {
      await expect(startDirectRun(42, buildOneTaskPlan("Fix it", "omp", false, "rejected"))).rejects.toThrow("approval failed");
      expect(invoked.slice(before).map((entry) => entry.cmd)).toEqual(["session_propose_plan", "session_approve_plan"]);
    } finally {
      rejectApproval = false;
    }
  });

  test("runnerStart invokes runner_start with camelCase sessionId", async () => {
    const started = await runnerStart(42);
    expect(started).toEqual(["task-1"]);
    expect(invoked[invoked.length - 1]).toEqual({
      cmd: "runner_start",
      args: { sessionId: 42 },
    });
  });

  test("runnerStop invokes runner_stop with sessionId and taskId", async () => {
    await runnerStop(42, "task-1");
    expect(invoked[invoked.length - 1]).toEqual({
      cmd: "runner_stop",
      args: { sessionId: 42, taskId: "task-1" },
    });
  });

  test("runnerRespondPermission invokes runner_respond_permission with decision", async () => {
    await runnerRespondPermission(42, "task-1", "req-99", "allow");
    expect(invoked[invoked.length - 1]).toEqual({
      cmd: "runner_respond_permission",
      args: { sessionId: 42, taskId: "task-1", requestId: "req-99", decision: "allow" },
    });
  });

  test("[ADR-0018.D2] runnerSend invokes runner_send with prompt text", async () => {
    await runnerSend(42, "task-1", "focus on edge cases");
    expect(invoked[invoked.length - 1]).toEqual({ cmd: "runner_send", args: { sessionId: 42, taskId: "task-1", text: "focus on edge cases" } });
  });

  test("[ADR-0018.D3] sends mode and session-scoped permission decision", async () => {
    await runnerSetMode(42, "task-1", "auto");
    expect(invoked[invoked.length - 1]).toEqual({ cmd: "runner_set_mode", args: { sessionId: 42, taskId: "task-1", modeId: "auto" } });
    await runnerRespondPermission(42, "task-1", "req-99", "allow_always");
    expect(invoked[invoked.length - 1]).toEqual({ cmd: "runner_respond_permission", args: { sessionId: 42, taskId: "task-1", requestId: "req-99", decision: "allow_always" } });
  });

  test("[ADR-0018.D5] forwards session title events", async () => {
    const captured: string[] = [];
    await onSessionTitle((payload) => captured.push(`${payload.sessionId}:${payload.title}`));
    listeners.find((listener) => listener.event === "session:title")!.handler({ payload: { sessionId: 42, title: "New title" } });
    expect(captured).toEqual(["42:New title"]);
  });

  test("onRunnerEvent listens for runner:event and passes payload to handler", async () => {
    const captured: Array<{ sessionId: number; eventId: number }> = [];
    const unlisten = await onRunnerEvent((payload) => {
      captured.push(payload);
    });
    expect(typeof unlisten).toBe("function");
    const registered = listeners.find((l) => l.event === "runner:event");
    expect(registered).toBeDefined();
    registered!.handler({ payload: { sessionId: 42, eventId: 101 } });
    expect(captured).toEqual([{ sessionId: 42, eventId: 101 }]);
  });
});
