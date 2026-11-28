import { beforeEach, describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

const calls: string[] = [];
let nextCheck: unknown = null;
let failInstall = false;

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
});

describe("[ADR-0013.D4] updater", () => {
  test("rendering Updates does not contact the update server; only the button does", () => {
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
    expect(calls).toEqual(["download", "installed", "relaunch"]);
  });

  test("a failed install never restarts the app", async () => {
    failInstall = true;
    await expect(installUpdate(fakeUpdate([]) as never, () => {})).rejects.toThrow("signature verification failed");
    expect(calls).toEqual(["download"]);
  });

  test("a download without a content length keeps total unknown", () => {
    const started = applyDownloadEvent({ downloaded: 5, total: 9 }, { event: "Started", data: {} });
    expect(started).toEqual({ downloaded: 0, total: null });
  });
});
