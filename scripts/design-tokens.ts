import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const aliases: Record<string, string> = {
  background: "bg",
  foreground: "fg",
  card: "surface",
  popover: "surface-elevated",
  primary: "accent",
  "primary-foreground": "accent-fg",
  secondary: "surface",
  muted: "surface-elevated",
  "muted-foreground": "fg-muted",
  accent: "surface-elevated",
  border: "border",
  input: "input",
  ring: "ring",
  destructive: "danger",
};

function parseFrontmatter(markdown: string): Record<string, Record<string, string>> {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) throw new Error("DESIGN.md is missing YAML frontmatter");
  const parsed = Bun.YAML.parse(match[1]);
  if (!parsed || typeof parsed !== "object") throw new Error("Invalid DESIGN.md frontmatter");
  return parsed as Record<string, Record<string, string>>;
}

/** @adr ADR-0016.D1 */
export function generateTokens(markdown: string): string {
  const data = parseFrontmatter(markdown);
  const colors = data.colors;
  if (!colors || !data.typography || !data.radii || !data.spacing || !data.motion) throw new Error("DESIGN.md is missing required token sections");
  const lines = ["/* generated from DESIGN.md by scripts/design-tokens.ts; do not edit */", ":root {"];
  for (const [name, value] of Object.entries(colors)) lines.push(`  --color-${name}: ${value};`);
  for (const [name, value] of Object.entries(data.typography)) lines.push(`  --${name.startsWith("font-") ? `design-${name}` : name}: ${value};`);
  for (const [name, value] of Object.entries(data.radii)) lines.push(`  --radius-${name}: ${value};`);
  for (const [name, value] of Object.entries(data.spacing)) lines.push(`  --space-${name}: ${value};`);
  for (const [name, value] of Object.entries(data.motion)) lines.push(`  --motion-${name}: ${value};`);
  lines.push(
    "  --radius: var(--radius-lg);",
    "  --fw: calc(100vw / 1440);",
    "  --sidebar: var(--color-surface);",
    "  --sidebar-foreground: var(--color-fg);",
    "  --sidebar-primary: var(--color-accent);",
    "  --sidebar-primary-foreground: var(--color-accent-fg);",
    "  --sidebar-accent: var(--color-surface-elevated);",
    "  --sidebar-accent-foreground: var(--color-fg);",
    "  --sidebar-border: var(--color-border);",
    "  --sidebar-ring: var(--color-ring);",
  );
  for (const [name, source] of Object.entries(aliases)) lines.push(`  --${name}: var(--color-${source});`);
  lines.push("}", "", "@theme inline {");
  const themeNames = ["background", "foreground", "card", "popover", "primary", "primary-foreground", "secondary", "muted", "muted-foreground", "accent", "border", "input", "ring", "destructive", "sidebar", "sidebar-foreground", "sidebar-primary", "sidebar-primary-foreground", "sidebar-accent", "sidebar-accent-foreground", "sidebar-border", "sidebar-ring"];
  for (const name of themeNames) lines.push(`  --color-${name}: var(--${name});`);
  for (const name of Object.keys(colors)) {
    if (!themeNames.includes(name)) lines.push(`  --color-${name}: var(--color-${name});`);
  }
  lines.push("  --radius-sm: var(--radius-sm);", "  --radius-md: var(--radius-md);", "  --radius-lg: var(--radius-lg);", "  --font-sans: var(--design-font-sans);", "  --font-mono: var(--design-font-mono);", "}", "");
  return lines.join("\n");
}

if (import.meta.main) {
  const outputPath = resolve(root, "src/styles/tokens.css");
  const generated = generateTokens(await readFile(resolve(root, "DESIGN.md"), "utf8"));
  if (process.argv.includes("--check")) {
    const current = await readFile(outputPath, "utf8").catch(() => "");
    if (current !== generated) {
      console.error("src/styles/tokens.css is out of date; run bun run tokens");
      process.exitCode = 1;
    }
  } else {
    await writeFile(outputPath, generated);
  }
}
