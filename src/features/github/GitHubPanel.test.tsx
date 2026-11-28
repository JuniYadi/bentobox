import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { renderToStaticMarkup } from "react-dom/server";
import { StatusBar } from "../../components/layout/StatusBar";

describe("[ADR-0016.D2] GitHub inspector presentation", () => {
  test("renders explicit unavailable authentication and never seeds fake items", async () => {
    const source = await readFile(new URL("./GitHubPanel.tsx", import.meta.url), "utf8");
    expect(source).toContain("!status.installed || !status.authenticated");
    expect(source).toContain("Run <code>gh auth login</code>");
    expect(source).toContain("setItems([");
    expect(source).not.toContain("1234");
  });

  test("renders issue state as a dot beside plain text with no state-label fill", async () => {
    const source = await readFile(new URL("./GitHubPanel.tsx", import.meta.url), "utf8");
    expect(source).toContain('className="state-label">{item.state}</span>');
    expect(source).toContain('size-2 rounded-full ${item.state.toLowerCase() === "open" ? "bg-success" : "bg-muted-foreground"}');
    expect(source).not.toMatch(/state-label[^\n]*bg-/);
  });

  test("contains no hard-coded hex colors", async () => {
    const source = await readFile(new URL("./GitHubPanel.tsx", import.meta.url), "utf8");
    expect(source).not.toMatch(/#[\da-f]{3,8}\b/i);
  });
});

describe("[ADR-0016.D2] status bar presentation", () => {
  test("renders unavailable quota with its backend reason without inventing zero", async () => {
    const source = await readFile(new URL("../../components/layout/StatusBar.tsx", import.meta.url), "utf8");
    expect(source).toContain('identical ? text : `${state.harnessId} ${text}`');
    expect(source).toContain("quota Unavailable");
    expect(source).not.toContain("quota 0");
    const html = renderToStaticMarkup(<StatusBar selectedSessionId={null} />);
    expect(html).toContain("No session");
  });
});
