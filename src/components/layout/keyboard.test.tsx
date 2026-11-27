import { describe, expect, test } from "bun:test";
import { shortcut, resizedFraction } from "./keyboard";

describe("[ADR-0016.D2] shell keyboard controls", () => {
  test("uses physical keys and ignores shifted shortcuts", () => {
    const event = { code: "KeyB", metaKey: true, ctrlKey: false, altKey: false, shiftKey: false };
    expect(shortcut(event, true)).toBe("left");
    expect(shortcut({ ...event, key: "ß" } as typeof event & { key: string }, true)).toBe("left");
    expect(shortcut({ ...event, altKey: true }, true)).toBe("right");
    expect(shortcut({ ...event, code: "KeyK" }, true)).toBe("search");
    expect(shortcut({ ...event, code: "KeyN" }, true)).toBe("new-session");
    expect(shortcut({ ...event, shiftKey: true }, true)).toBeNull();
    expect(shortcut({ ...event, metaKey: false, ctrlKey: true }, false)).toBe("left");
    expect(shortcut({ ...event, metaKey: false }, true)).toBeNull();
  });

  test("resizes from the displayed width with Home, End and shifted arrows", () => {
    expect(resizedFraction("left", "Home", false, 1440, null)).toBe(200 / 1440);
    expect(resizedFraction("left", "End", false, 1440, null)).toBe(420 / 1440);
    expect(resizedFraction("left", "ArrowRight", true, 1440, null)).toBe(256 / 1440 + 0.05);
    expect(resizedFraction("right", "ArrowLeft", false, 1440, null)).toBe(0.26);
    expect(resizedFraction("left", "Enter", false, 1440, null)).toBeNull();
    expect(resizedFraction("right", "ArrowRight", true, 1440, null)).toBe(0.2);
    expect(resizedFraction("left", "ArrowRight", false, 1024, null)).toBe(200 / 1024 + 0.01);
  });
});
