import { describe, expect, mock, test } from "bun:test";

const invoked: Array<{ cmd: string; args: unknown }> = [];
const listeners: Array<{ event: string; handler: (event: unknown) => void }> = [];

mock.module("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: unknown) => {
    invoked.push({ cmd, args });
    if (cmd === "runner_start") return Promise.resolve(["task-1"]);
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
const { runnerStart, runnerStop, runnerRespondPermission, runnerSteer, onRunnerEvent } = await import("./api");

describe("[ADR-0017.D3] runner api wrappers", () => {
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

  test("runnerSteer invokes runner_steer with prompt text", async () => {
    await runnerSteer(42, "task-1", "focus on edge cases");
    expect(invoked[invoked.length - 1]).toEqual({
      cmd: "runner_steer",
      args: { sessionId: 42, taskId: "task-1", text: "focus on edge cases" },
    });
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
