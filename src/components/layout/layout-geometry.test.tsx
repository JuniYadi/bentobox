import { describe, expect, test } from "bun:test";
import { geometry, regionWidthCss, regionWidths, storedFraction } from "./geometry";

describe("[ADR-0016.D2] shell region geometry", () => {
  test("uses frame widths at 1440", () => {
    expect(regionWidths(1440)).toEqual({ left: 256, right: 360, chat: 720 });
  });

  test("clamps and collapses on narrow windows", () => {
    expect(regionWidths(1024).left).toBe(200);
    expect(regionWidths(1024).right).toBe(0);
  });

  test("scales then clamps at wide windows", () => {
    expect(regionWidths(1920).left).toBeCloseTo(341.3333333);
    expect(regionWidths(3840).left).toBe(geometry.left.max);
  });

  test("stored fractions survive window changes within clamps", () => {
    const prefs = { leftFraction: 0.25, rightFraction: 0.3, rightCollapsed: false };
    expect(regionWidths(1280, prefs).left).toBe(320);
    expect(regionWidths(1920, prefs).left).toBe(geometry.left.max);
    expect(regionWidths(1920, prefs).right).toBe(576);
  });

  test("generates the actual clamped CSS widths", () => {
    expect(regionWidthCss("left", null)).toBe("clamp(200px, calc(256 * var(--fw)), 420px)");
    expect(regionWidthCss("right", null)).toBe("clamp(280px, calc(360 * var(--fw)), 640px)");
    expect(regionWidthCss("left", 0.25)).toBe("clamp(200px, calc(0.25 * 100vw), 420px)");
  });

  test("rejects corrupt fractions and retains valid fractions", () => {
    for (const value of ["5", "NaN", "-1", "abc", "", "  "]) expect(storedFraction(value)).toBeNull();
    expect(storedFraction(null)).toBeNull();
    expect(storedFraction("0.25")).toBe(0.25);
  });
});
