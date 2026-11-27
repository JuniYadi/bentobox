import { describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const pixelWidth = /(?:width\s*:\s*[^,;}]*\b\d+(?:\.\d+)?px|(?:min-|max-)?w-\[[^\]]*\b\d+(?:\.\d+)?px[^\]]*\]|\[(?:width|min-width|max-width):[^\]]*\b\d+(?:\.\d+)?px[^\]]*\])/;

async function componentFiles(path: string): Promise<string[]> {
  const entries = await readdir(path, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const fullPath = join(path, entry.name);
    if (entry.isDirectory()) return componentFiles(fullPath);
    return entry.isFile() && entry.name.endsWith(".tsx") && !entry.name.endsWith(".test.tsx") ? [fullPath] : [];
  }));
  return nested.flat();
}

describe("[ADR-0016.D2] layout sizing", () => {
  test("components do not contain pixel width literals", async () => {
    const files = ["src/App.tsx", ...await componentFiles("src/components/layout")];
    const violations = await Promise.all(files.map(async (file) => {
      const source = await readFile(file, "utf8");
      return pixelWidth.test(source) ? file : null;
    }));
    expect(violations.filter(Boolean)).toEqual([]);
  });

  test("detects pixel width syntax without treating font sizes as widths", () => {
    for (const value of ["w-[200px]", "max-w-[420px]", "width:200px", "[width:200px]", "[min-width:200px]"]) expect(pixelWidth.test(value)).toBe(true);
    expect(pixelWidth.test("text-[11px]")).toBe(false);
    expect(pixelWidth.test("w-(--sidebar-width)")).toBe(false);
  });
});
