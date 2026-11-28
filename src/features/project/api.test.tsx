import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import * as core from "@tauri-apps/api/core";
import * as dialog from "@tauri-apps/plugin-dialog";
import { addProjectFromPicker, pickProjectDirectory, sessionGlyph, type ProjectSession } from "./api";

const addedProject = { id: 1, name: "plain", rootPath: "/plain", isGit: false, createdAt: "2026-01-01T00:00:00Z" };

describe("[ADR-0016.D2] session glyphs", () => {
  let directory: string;
  beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), "bentobox-glyph-")); });
  afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

  const summary = (phase: string | null, taskStatuses: string[], state: "active" | "closed" = "active"): ProjectSession => ({ id: 1, title: "Example", phase, taskStatuses, state, lastActivityAt: "2026-01-01T00:00:00Z" });

  test("returns needs-approval for approved plan awaiting tasks", () => {
    expect(sessionGlyph(summary("Approve", ["queued"]))).toBe("needs-approval");
  });
  test("returns running for an active task", () => {
    expect(sessionGlyph(summary("Build", ["running"]))).toBe("running");
  });
  test("returns planning for Build before a task runs", () => {
    expect(sessionGlyph(summary("Build", ["queued"]))).toBe("planning");
    expect(sessionGlyph(summary("Build", []))).toBe("planning");
  });
  test("returns needs-approval for review", () => {
    expect(sessionGlyph(summary("Review", ["completed"]))).toBe("needs-approval");
  });
  test("returns idle for rejected or cancelled plans", () => {
    expect(sessionGlyph(summary("Rejected", []))).toBe("idle");
    expect(sessionGlyph(summary("Cancelled", ["cancelled"]))).toBe("idle");
  });
  test("returns planning for an unapproved plan", () => {
    expect(sessionGlyph(summary("Plan", ["queued"]))).toBe("planning");
  });
  test("returns failed when a task failed", () => {
    expect(sessionGlyph(summary("Review", ["failed"]))).toBe("failed");
  });
  test("returns done for closed sessions", () => {
    expect(sessionGlyph(summary("Closed", ["completed"], "closed"))).toBe("done");
  });
  test("returns idle when no plan or work is active", () => {
    expect(sessionGlyph(summary(null, []))).toBe("idle");
  });
});

describe("[ADR-0019.D1] project folder picker", () => {
  test("opens a single-directory dialog and registers the selected path", async () => {
    const open = spyOn(dialog, "open").mockResolvedValue("/plain");
    const invoke = spyOn(core, "invoke").mockResolvedValue(addedProject);
    try {
      expect(await addProjectFromPicker()).toEqual(addedProject);
      expect(open).toHaveBeenCalledWith({ directory: true, multiple: false });
      expect(invoke).toHaveBeenCalledWith("project_add", { path: "/plain" });
    } finally { open.mockRestore(); invoke.mockRestore(); }
  });

  test("cancelling does not register a project", async () => {
    const open = spyOn(dialog, "open").mockResolvedValue(null);
    const invoke = spyOn(core, "invoke");
    try {
      expect(await pickProjectDirectory()).toBeNull();
      expect(await addProjectFromPicker()).toBeNull();
      expect(invoke).not.toHaveBeenCalled();
    } finally { open.mockRestore(); invoke.mockRestore(); }
  });
});
