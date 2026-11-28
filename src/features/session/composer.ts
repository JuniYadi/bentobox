import type { DetectedHarness, ModelCatalog, ModelOption } from "../agent/api";
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
export function buildOneTaskPlan(text: string, harnessId: string, worktree: boolean, uniqueSuffix: string, model?: string | null): PlanTask[] {
  return [
    {
      id: `task-${uniqueSuffix}`,
      title: text.trim(),
      team: "",
      harness: harnessId,
      ...(model !== undefined ? { model } : {}),
      worktree,
      files: [],
      dependencies: [],
      estimated_tokens: null,
      status: "queued",
    },
  ];
}

/** @adr ADR-0018.D1 */
export function sendState({ text, harness, plan }: SendStateInput): SendStateResult {
  const inProgressPhases: Plan["phase"][] = ["Plan", "Approve", "Build", "Review"];
  const task = plan?.tasks.length === 1 ? plan.tasks[0] : null;
  if (plan && inProgressPhases.includes(plan.phase) && !(task && (task.status === "running" || task.status === "review"))) {
    return { enabled: false, reason: `Plan in progress (${plan.phase}). Complete or cancel it before starting a new goal.` };
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
  return harnesses.map((h) => {
    const acp = h.capabilities.transport.toLowerCase() === "acp";
    return {
      harnessId: h.capabilities.harness_id,
      displayName: h.capabilities.display_name,
      runnable: acp && h.runnable,
      disabledReason: !acp ? "offline" : h.runnable ? null : (h.launch_note || "offline"),
      launchNote: h.launch_note,
      harness: h,
    };
  });
}

/** @adr ADR-0021.D2 */
export type ModelPickerStatus = "loading" | "ready" | "unadvertised" | "auth_required" | "unavailable" | "timeout" | "error";

/** @adr ADR-0021.D2 */
export interface ModelPickerState {
  status: ModelPickerStatus;
  message: string | null;
  models: ModelOption[];
  retry: boolean;
  note: string | null;
}

/** @adr ADR-0021.D2 */
export function modelPickerState(
  value: ModelCatalog | "loading" | "error" | undefined | null
): ModelPickerState {
  if (value === undefined || value === null || value === "loading") {
    return { status: "loading", message: "Loading models…", models: [], retry: false, note: null };
  }
  if (value === "error") {
    return { status: "error", message: "Could not load models", models: [], retry: true, note: null };
  }
  if (value.status === "auth_required") {
    return { status: "auth_required", message: "Sign in to list models", models: [], retry: false, note: value.note ?? null };
  }
  if (value.status === "timeout" || value.status === "unavailable") {
    return { status: value.status, message: "Could not load models", models: [], retry: true, note: value.note ?? null };
  }
  if (value.status === "unadvertised" || value.models.length === 0) {
    return { status: "unadvertised", message: "Model selection not advertised by this agent", models: [], retry: false, note: value.note ?? null };
  }
  return { status: "ready", message: null, models: value.models, retry: false, note: value.note ?? null };
}

/** @adr ADR-0021.D2 */
export function harnessMonogram(harnessId: string): string {
  const normalized = harnessId.toLowerCase();
  if (normalized.includes("claude")) return "Cl";
  if (normalized.includes("codex")) return "Cx";
  if (normalized.includes("omp")) return "om";
  if (normalized.includes("pi")) return "pi";
  if (normalized.includes("opencode")) return "Op";
  return harnessId.slice(0, 2);
}

/** @adr ADR-0021.D2 */
export function getModelDisplayName(modelId: string | null | undefined, models: ModelOption[]): string {
  if (!modelId) return "Default model";
  const found = models.find((m) => m.id === modelId);
  return found ? found.name : modelId;
}

/** @adr ADR-0018.D1 */
export function phaseStepState(
  phase: Plan["phase"] | null | undefined,
  step: "Plan" | "Approve" | "Build" | "Review"
): "done" | "current" | "upcoming" {
  const steps = ["Plan", "Approve", "Build", "Review"] as const;
  const stepIndex = steps.indexOf(step);
  const phaseIndex = phase ? steps.indexOf(phase as (typeof steps)[number]) : -1;

  if (phaseIndex === -1) {
    return "upcoming";
  }
  if (stepIndex < phaseIndex) {
    return "done";
  }
  if (stepIndex === phaseIndex) {
    return "current";
  }
  return "upcoming";
}

/** @adr ADR-0020.D2 */
export interface ToggleSessionConciseState<S extends { id: number; conciseReplies: boolean } = { id: number; conciseReplies: boolean }> {
  sessions: S[];
  error: string | null;
}

/** @adr ADR-0020.D2 */
export async function toggleSessionConcise<S extends { id: number; conciseReplies: boolean }>(
  sessionId: number,
  mutateState: (updater: (prev: ToggleSessionConciseState<S>) => ToggleSessionConciseState<S>) => void,
  invokeApi: (sessionId: number, enabled: boolean) => Promise<void>
): Promise<boolean> {
  let previousValue = false;
  let nextValue = true;

  mutateState((prev) => {
    const currentSession = prev.sessions.find((s) => s.id === sessionId);
    previousValue = currentSession?.conciseReplies ?? false;
    nextValue = !previousValue;
    return {
      ...prev,
      sessions: prev.sessions.map((s) => (s.id === sessionId ? { ...s, conciseReplies: nextValue } : s)),
      error: null,
    };
  });

  try {
    await invokeApi(sessionId, nextValue);
    return true;
  } catch (reason) {
    mutateState((prev) => {
      const currentSession = prev.sessions.find((s) => s.id === sessionId);
      // Only roll back if the session still holds the attempted value from this toggle
      if (currentSession && currentSession.conciseReplies === nextValue) {
        return {
          ...prev,
          sessions: prev.sessions.map((s) => (s.id === sessionId ? { ...s, conciseReplies: previousValue } : s)),
          error: `Could not update concise setting: ${String(reason)}`,
        };
      }
      return {
        ...prev,
        error: `Could not update concise setting: ${String(reason)}`,
      };
    });
    return false;
  }
}
