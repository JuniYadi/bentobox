import type { DetectedHarness } from "../agent/api";
import type { Plan, PlanTask } from "./types";

/** @adr ADR-0017.D4 */
export interface SendStateInput {
  text: string;
  harness: string | null;
  plan: Plan | null;
}

/** @adr ADR-0017.D4 */
export interface SendStateResult {
  enabled: boolean;
  reason: string | null;
}

/** @adr ADR-0017.D4 */
export interface ComposerHarnessOption {
  harnessId: string;
  displayName: string;
  runnable: boolean;
  disabledReason: string | null;
  launchNote: string | null;
  harness: DetectedHarness;
}

/** @adr ADR-0017.D4 */
export function buildOneTaskPlan(text: string, harnessId: string, worktree: boolean, uniqueSuffix: string): PlanTask[] {
  return [
    {
      id: `task-${uniqueSuffix}`,
      title: text.trim(),
      team: "",
      harness: harnessId,
      worktree,
      files: [],
      dependencies: [],
      estimated_tokens: null,
      status: "queued",
    },
  ];
}

/** @adr ADR-0017.D4 */
export function sendState({ text, harness, plan }: SendStateInput): SendStateResult {
  const inProgressPhases: Plan["phase"][] = ["Plan", "Approve", "Build", "Review"];
  if (plan && inProgressPhases.includes(plan.phase)) {
    return {
      enabled: false,
      reason: `Plan in progress (${plan.phase}). Complete or cancel it before starting a new goal.`,
    };
  }
  if (!harness) {
    return {
      enabled: false,
      reason: "Select an ACP harness to run this goal.",
    };
  }
  if (!text.trim()) {
    return {
      enabled: false,
      reason: "Describe a goal for the agent.",
    };
  }
  return {
    enabled: true,
    reason: null,
  };
}

/** @adr ADR-0017.D4 */
export function getComposerHarnessOptions(harnesses: DetectedHarness[]): ComposerHarnessOption[] {
  return harnesses
    .filter((h) => h.capabilities.transport.toLowerCase() === "acp")
    .map((h) => ({
      harnessId: h.capabilities.harness_id,
      displayName: h.capabilities.display_name,
      runnable: h.runnable,
      disabledReason: h.runnable ? null : (h.launch_note || "Not installed"),
      launchNote: h.launch_note,
      harness: h,
    }));
}
