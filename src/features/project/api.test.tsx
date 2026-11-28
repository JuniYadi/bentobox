import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { ProjectSession, sessionGlyph } from "./api";

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
