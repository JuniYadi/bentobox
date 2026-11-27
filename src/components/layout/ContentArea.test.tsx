import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ContentArea } from "./ContentArea";
import { SidebarRight } from "./SidebarRight";

describe("[ADR-0009.D1] session composer", () => {
  test("retains the supplied draft and makes unavailable execution explicit", () => {
    const html = renderToStaticMarkup(<ContentArea session={null} onToggleWorktree={() => {}} onCreateSession={() => {}} prompt="Investigate issue #42" onPromptChange={() => {}} emptyMessage="No sessions yet" error={null} />);
    expect(html).toContain("Investigate issue #42");
    expect(html).toContain("disabled");
    expect(html).toContain("Orchestrator execution isn&#x27;t available yet");
    expect(html).toContain("No sessions yet");
  });

  test("does not highlight a phase when there is no plan", () => {
    const html = renderToStaticMarkup(<ContentArea session={null} onToggleWorktree={() => {}} onCreateSession={() => {}} prompt="" onPromptChange={() => {}} emptyMessage="Backend isn't available." error={null} />);
    expect(html).not.toContain('aria-current="step"');
    expect(html).toContain("Backend isn&#x27;t available.");
  });
});

describe("[ADR-0009.D1] session telemetry", () => {
  test("does not invent usage for an unselected session", () => {
    const html = renderToStaticMarkup(<SidebarRight sessionId={null} subAgents={[]} collapsed={false} onToggleCollapse={() => {}} />);
    expect(html).toContain("Unavailable: No session selected");
    expect(html).not.toContain("1,840 tokens");
  });
});
