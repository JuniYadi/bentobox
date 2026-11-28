import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ORCHESTRATOR_UNAVAILABLE_REASON,
  PlanCard,
  showsPlanCard,
} from "./PlanCard";
import type { Plan, PlanTask } from "./types";

const pixelWidth =
  /(?:width\s*:\s*[^,;}]*\b\d+(?:\.\d+)?px|(?:min-|max-)?w-\[[^\]]*\b\d+(?:\.\d+)?px[^\]]*\]|\[(?:width|min-width|max-width):[^\]]*\b\d+(?:\.\d+)?px[^\]]*\])/;

function makeTask(overrides: Partial<PlanTask> = {}): PlanTask {
  return {
    id: "task-1",
    title: "Scaffold module",
    team: "core",
    harness: "omp",
    worktree: true,
    files: ["src/index.ts"],
    dependencies: [],
    estimated_tokens: 1200,
    status: "queued",
    ...overrides,
  };
}

function makePlan(overrides: Partial<Plan> = {}): Plan {
  return {
    session_id: 1,
    revision: 3,
    phase: "Plan",
    approved: false,
    estimated_tokens: 4200,
    tasks_started: false,
    tasks: [makeTask()],
    ...overrides,
  };
}

function findButtonWithText(node: React.ReactNode, text: string): React.ReactElement<any> | null {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findButtonWithText(child, text);
      if (found) return found;
    }
    return null;
  }
  const element = node as React.ReactElement<any>;
  if (element.props) {
    if (element.props.children === text) return element;
    if (typeof element.props.children === "object" || Array.isArray(element.props.children)) {
      const found = findButtonWithText(element.props.children, text);
      if (found) return found;
    }
  }
  return null;
}

describe("[ADR-0016.D3] plan approval card", () => {
  test("Approve handler is bound to the displayed revision", () => {
    const plan = makePlan({ revision: 9 });

    const captured: { revision: number | null } = { revision: null };
    const tree = PlanCard({
      plan,
      onApprove: (rev) => {
        captured.revision = rev;
      },
    });

    const approveButton = findButtonWithText(tree, "Approve & build");
    expect(approveButton).not.toBeNull();
    approveButton?.props.onClick?.();
    expect(captured.revision).toBe(9);

    const html = renderToStaticMarkup(
      <PlanCard plan={plan} onApprove={() => {}} />
    );
    expect(html).toContain('data-revision="9"');
  });

  test("unknown estimate renders unknown not 0 (both total and per task)", () => {
    const plan = makePlan({
      estimated_tokens: null,
      tasks: [
        makeTask({ id: "t1", estimated_tokens: null, title: "Task 1" }),
        makeTask({ id: "t2", estimated_tokens: null, title: "Task 2" }),
      ],
    });

    const html = renderToStaticMarkup(
      <PlanCard plan={plan} onApprove={() => {}} />
    );

    expect(html).toContain("est. unknown tokens");
    expect(html).toContain('est. <span class="text-foreground">unknown</span> tokens');
    expect(html).not.toMatch(/est\.\s*<span[^>]*>0<\/span>\s*tokens/);
    expect(html).not.toContain("0 tokens");
  });

  test("renders real estimate values when tokens are known", () => {
    const plan = makePlan({
      estimated_tokens: 50000,
      tasks: [
        makeTask({ id: "t1", estimated_tokens: 25000 }),
      ],
    });

    const html = renderToStaticMarkup(
      <PlanCard plan={plan} onApprove={() => {}} />
    );

    expect(html).toContain("50,000");
    expect(html).toContain("25,000");
  });

  test("maps dependencies to displayed task numbers with after #n", () => {
    const plan = makePlan({
      tasks: [
        makeTask({ id: "setup-db", title: "Setup database", dependencies: [] }),
        makeTask({ id: "build-api", title: "Build API", dependencies: ["setup-db"] }),
        makeTask({
          id: "build-ui",
          title: "Build UI",
          dependencies: ["setup-db", "build-api"],
        }),
      ],
    });

    const html = renderToStaticMarkup(
      <PlanCard plan={plan} onApprove={() => {}} />
    );

    expect(html).toContain("after #1");
    expect(html).toContain("after #1, after #2");
    expect(html).not.toContain("after #setup-db");
    expect(html).not.toContain("after #build-api");
  });

  test("Revise button is disabled with visible orchestrator unavailable reason", () => {
    const html = renderToStaticMarkup(
      <PlanCard plan={makePlan()} onApprove={() => {}} />
    );

    expect(html).toContain("Revise");
    expect(html).toMatch(/<button[^>]*\bdisabled=""[^>]*>Revise<\/button>/);
    expect(html).toContain("plan-card-revise-reason");
    expect(html).toContain("Orchestrator execution isn&#x27;t available yet. Your text will remain here.");
    expect(ORCHESTRATOR_UNAVAILABLE_REASON).toBe(
      "Orchestrator execution isn't available yet. Your text will remain here."
    );
  });

  test("Approve & build is enabled only when plan.phase is Plan and not approved", () => {
    const enabledPlan = makePlan({ phase: "Plan", approved: false });
    const enabledHtml = renderToStaticMarkup(<PlanCard plan={enabledPlan} onApprove={() => {}} />);
    const enabledTree = PlanCard({ plan: enabledPlan, onApprove: () => {} });
    const enabledButton = findButtonWithText(enabledTree, "Approve & build");
    expect(enabledButton?.props.disabled).toBe(false);
    expect(enabledHtml).not.toMatch(/<button[^>]*\bdisabled=""[^>]*>Approve &amp; build<\/button>/);

    const approvedPlan = makePlan({ phase: "Plan", approved: true });
    const approvedHtml = renderToStaticMarkup(<PlanCard plan={approvedPlan} onApprove={() => {}} />);
    const approvedTree = PlanCard({ plan: approvedPlan, onApprove: () => {} });
    const approvedButton = findButtonWithText(approvedTree, "Approve & build");
    expect(approvedButton?.props.disabled).toBe(true);
    expect(approvedHtml).toMatch(/<button[^>]*\bdisabled=""[^>]*>Approve &amp; build<\/button>/);

    const approvePhasePlan = makePlan({ phase: "Approve", approved: false });
    const approvePhaseHtml = renderToStaticMarkup(<PlanCard plan={approvePhasePlan} onApprove={() => {}} />);
    const approvePhaseTree = PlanCard({ plan: approvePhasePlan, onApprove: () => {} });
    const approvePhaseButton = findButtonWithText(approvePhaseTree, "Approve & build");
    expect(approvePhaseButton?.props.disabled).toBe(true);
    expect(approvePhaseHtml).toMatch(/<button[^>]*\bdisabled=""[^>]*>Approve &amp; build<\/button>/);

    const busyPlan = makePlan({ phase: "Plan", approved: false });
    const busyHtml = renderToStaticMarkup(<PlanCard plan={busyPlan} busy onApprove={() => {}} />);
    const busyTree = PlanCard({ plan: busyPlan, busy: true, onApprove: () => {} });
    const busyButton = findButtonWithText(busyTree, "Approve & build");
    expect(busyButton?.props.disabled).toBe(true);
    expect(busyHtml).toMatch(/<button[^>]*\bdisabled=""[^>]*>Approve &amp; build<\/button>/);
  });

  test("showsPlanCard is truthy only in Plan or Approve phases", () => {
    expect(showsPlanCard(null)).toBe(false);
    expect(showsPlanCard(undefined)).toBe(false);
    expect(showsPlanCard(makePlan({ phase: "Plan" }))).toBe(true);
    expect(showsPlanCard(makePlan({ phase: "Approve" }))).toBe(true);
    expect(showsPlanCard(makePlan({ phase: "Build" }))).toBe(false);
    expect(showsPlanCard(makePlan({ phase: "Review" }))).toBe(false);
    expect(showsPlanCard(makePlan({ phase: "Rejected" }))).toBe(false);
    expect(showsPlanCard(makePlan({ phase: "Cancelled" }))).toBe(false);
    expect(showsPlanCard(makePlan({ phase: "Closed" }))).toBe(false);
  });


  test("source code follows design typography and colour rules", async () => {
    const source = await readFile(new URL("./PlanCard.tsx", import.meta.url), "utf8");

    expect(source).not.toMatch(/#[\da-f]{3,8}\b/i);
    expect(source).not.toContain("style={{");
    expect(pixelWidth.test(source)).toBe(false);
    expect(source).not.toMatch(/\bfont-(?:bold|semibold)\b/);
    expect(source).not.toMatch(/text-\[11px\]/);
    const monoElements = [...source.matchAll(/<([\w.]+)\b[^>]*className="[^"]*\bfont-mono\b[^"]*"[^>]*>([\s\S]*?)<\/\1>/g)];
    expect(source.match(/\bfont-mono\b/g)?.length ?? 0).toBe(monoElements.length);
    expect(monoElements.map((match) => match[2].trim())).toEqual(['{task.files.join(", ")}']);
    expect(source).not.toMatch(/<span\b[^>]*className="[^"]*\btext-(?:warning|success|destructive|danger)\b/);
    expect(source).not.toMatch(/<b\b|<strong\b/);
    expect(source).toContain("/** @adr ADR-0016.D3 */");
  });
});
