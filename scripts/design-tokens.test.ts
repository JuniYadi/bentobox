import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { generateTokens } from "./design-tokens";

const root = resolve(import.meta.dir, "..");
/** @adr ADR-0016.D1 */
export const COMPONENT_SCAN_ROOTS = ["src/components/ui"] as const;

describe("[ADR-0016.D1] design token generation", () => {
  test("generated output equals the committed tokens.css", async () => {
    const design = await readFile(join(root, "DESIGN.md"), "utf8");
    expect(generateTokens(design)).toBe(await readFile(join(root, "src/styles/tokens.css"), "utf8"));
  });

  test("every DESIGN.md color key appears with the same value", async () => {
    const design = await readFile(join(root, "DESIGN.md"), "utf8");
    const frontmatter = design.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1];
    if (!frontmatter) throw new Error("DESIGN.md frontmatter missing");
    const colors = Bun.YAML.parse(frontmatter).colors as Record<string, string>;
    const generated = generateTokens(design);
    for (const [name, value] of Object.entries(colors)) expect(generated).toContain(`--color-${name}: ${value};`);
  });

  test("a changed token in an isolated temporary DESIGN.md changes output", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bentobox-tokens-"));
    try {
      const source = await readFile(join(root, "DESIGN.md"), "utf8");
      const changed = source.replace('bg: "#09090b"', 'bg: "#010203"');
      await writeFile(join(dir, "DESIGN.md"), changed);
      expect(generateTokens(await readFile(join(dir, "DESIGN.md"), "utf8"))).not.toBe(generateTokens(source));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("ui primitives contain no hardcoded hex colors or inline style objects", async () => {
    const files = new Bun.Glob("**/*.{ts,tsx,js,jsx}");
    const violations: string[] = [];
    for (const base of COMPONENT_SCAN_ROOTS) {
      for await (const relative of files.scan({ cwd: join(root, base), onlyFiles: true })) {
        const source = await readFile(join(root, base, relative), "utf8");
        if (/#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})\b/i.test(source)) violations.push(`${base}/${relative}: hex color`);
        if (/style\s*=\s*\{\s*\{[^}]*\b(?:color|background(?:Color)?|width|height|padding|margin)\s*:/s.test(source)) violations.push(`${base}/${relative}: inline styling`);
      }
    }
    expect(violations).toEqual([]);
  });
});
