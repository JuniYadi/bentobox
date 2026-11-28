import { beforeEach, describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

const calls: string[] = [];
let nextCheck: unknown = null;
let failInstall = false;
let runningAgents = 0;

mock.module("@tauri-apps/api/core", () => ({
  invoke: (cmd: string) => {
    calls.push(cmd);
    return Promise.resolve(cmd === "runner_running_count" ? runningAgents : undefined);
  },
}));
mock.module("@tauri-apps/plugin-updater", () => ({
  check: () => {
    calls.push("check");
    return Promise.resolve(nextCheck);
  },
}));
mock.module("@tauri-apps/plugin-process", () => ({
  relaunch: () => {
    calls.push("relaunch");
    return Promise.resolve();
  },
}));

// Exception: dynamic import is required after mock.module to bind the mocked plugin modules.
const { applyDownloadEvent, checkForUpdate, installUpdate } = await import("./api");
// Exception: the component imports ./api, so it must load after the mocks too.
const { UpdatesSection } = await import("./UpdatesSection");

function fakeUpdate(events: unknown[]) {
  return {
    version: "0.0.2",
    currentVersion: "0.0.1",
    downloadAndInstall: async (onEvent: (event: unknown) => void) => {
      calls.push("download");
      for (const event of events) onEvent(event);
      if (failInstall) throw new Error("signature verification failed");
      calls.push("installed");
    },
  };
}

beforeEach(() => {
  calls.length = 0;
  nextCheck = null;
  failInstall = false;
  runningAgents = 0;
});

describe("[ADR-0013.D4] updater", () => {
  test("rendering Updates starts in the idle state and sends no request", () => {
    const html = renderToStaticMarkup(<UpdatesSection />);
    expect(html).toContain("Check for updates");
    expect(html).toContain("No check has run yet.");
    expect(calls).toEqual([]);
  });

  test("a null check result means the app is current", async () => {
    expect(await checkForUpdate()).toEqual({ status: "current" });
    expect(calls).toEqual(["check"]);
  });

  test("a found update is returned for the user to confirm, not installed", async () => {
    const update = fakeUpdate([]);
    nextCheck = update;
    expect(await checkForUpdate()).toEqual({ status: "available", update: update as never });
    expect(calls).toEqual(["check"]);
  });

  test("install reports progress from Started/Progress events, then restarts only after a successful install", async () => {
    const seen: Array<{ downloaded: number; total: number | null }> = [];
    const update = fakeUpdate([
      { event: "Started", data: { contentLength: 100 } },
      { event: "Progress", data: { chunkLength: 40 } },
      { event: "Progress", data: { chunkLength: 60 } },
      { event: "Finished" },
    ]);
    await installUpdate(update as never, (progress) => seen.push(progress));
    expect(seen[seen.length - 1]).toEqual({ downloaded: 100, total: 100 });
    expect(calls).toEqual(["runner_running_count", "download", "installed", "relaunch"]);
  });

  test("a failed install never restarts the app", async () => {
    failInstall = true;
    await expect(installUpdate(fakeUpdate([]) as never, () => {})).rejects.toThrow("signature verification failed");
    expect(calls).toEqual(["runner_running_count", "download"]);
  });

  test("install is refused while agent tasks run, before anything is downloaded", async () => {
    runningAgents = 2;
    await expect(installUpdate(fakeUpdate([]) as never, () => {})).rejects.toThrow("2 agent tasks are still running");
    expect(calls).toEqual(["runner_running_count"]);
  });

  test("a download without a content length keeps total unknown", () => {
    const started = applyDownloadEvent({ downloaded: 5, total: 9 }, { event: "Started", data: {} });
    expect(started).toEqual({ downloaded: 0, total: null });
  });
});
