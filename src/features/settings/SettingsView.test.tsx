import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { renderToStaticMarkup } from "react-dom/server";
import { SettingsView, settingsSections } from "./SettingsView";

describe("[ADR-0016.D5] settings view", () => {
  test("navigation contains exactly the data-backed sections", () => {
    expect([...settingsSections]).toEqual(["Harnesses", "GitHub"]);
    const html = renderToStaticMarkup(<SettingsView onClose={() => {}} />);
    const nav = html.match(/<nav\b[^>]*>[\s\S]*?<\/nav>/)?.[0];
    expect(nav).toBeDefined();
    expect(nav?.match(/<button\b/g)).toHaveLength(2);
    expect(nav).toMatch(/>Harnesses<\/button>/);
    expect(nav).toMatch(/>GitHub<\/button>/);
    expect(html).not.toContain("Worktree isolation");
    expect(html).toContain("Installed harnesses");
    expect(html).toContain("Loading harnesses…");
    expect(html).toContain("Back to session");
  });

  test("settings follows typography and status color rules", async () => {
    const source = await readFile(new URL("./SettingsView.tsx", import.meta.url), "utf8");
    expect(source).not.toMatch(/\bfont-(?:semibold|bold|mono)\b/);
    expect(source).not.toMatch(/\btext-\[\d+(?:\.\d+)?(?:px|rem|em)\]/);
    const coloredSpans = source.matchAll(/<span\b([^>]*\btext-(?:warning|success|destructive|danger)\b[^>]*)>([\s\S]*?)<\/span>/g);
    for (const [, attributes, content] of coloredSpans) {
      expect(attributes).toContain('aria-hidden="true"');
      expect(content.trim()).toBe("");
    }
  });

  test("frame widths use the frame token and no pixel widths or inline colors", async () => {
    const source = await readFile(new URL("./SettingsView.tsx", import.meta.url), "utf8");
    expect(source).toContain("w-[clamp(10rem,calc(200*var(--fw)),15rem)]");
    expect(source).toContain("max-w-[calc(880*var(--fw))]");
    expect(source).not.toMatch(/(?:width\s*:\s*[^,;}]*\b\d+(?:\.\d+)?px|(?:min-|max-)?w-\[[^\]]*\b\d+(?:\.\d+)?px[^\]]*\])/);
    expect(source).not.toMatch(/#[\da-f]{3,8}\b/i);
    expect(source).not.toMatch(/style\s*=\s*\{\s*\{/);
  });
});
