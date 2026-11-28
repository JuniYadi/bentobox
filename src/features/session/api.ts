import { invoke } from "@tauri-apps/api/core";
import { Plan, PlanTask } from "./types";
import { runnerStart } from "../runner/api";

/** @adr ADR-0010.D1 */
export function proposePlan(sessionId: number, tasks: PlanTask[]): Promise<Plan> {
  return invoke("session_propose_plan", { sessionId, tasks });
}

/** @adr ADR-0018.D1 */
export async function startDirectRun(sessionId: number, tasks: PlanTask[]): Promise<Plan> {
  const proposed = await proposePlan(sessionId, tasks);
  const approved = await approvePlan(sessionId, proposed.revision);
  await runnerStart(sessionId);
  return approved;
}

/** @adr ADR-0010.D1 */
export function revisePlan(sessionId: number, tasks: PlanTask[]): Promise<Plan> {
  return invoke("session_revise_plan", { sessionId, tasks });
}

/** @adr ADR-0010.D1 */
export function approvePlan(sessionId: number, expectedRevision: number): Promise<Plan> {
  return invoke("session_approve_plan", { sessionId, expectedRevision });
}

/** @adr ADR-0010.D1 */
export function rejectPlan(sessionId: number): Promise<Plan> {
  return invoke("session_reject_plan", { sessionId });
}

/** @adr ADR-0010.D1 */
export function transitionPlanTask(sessionId: number, taskId: string, next: string): Promise<Plan> {
  return invoke("session_task_transition", { sessionId, taskId, next });
}

/** @adr ADR-0010.D1 */
export function getPlan(sessionId: number): Promise<Plan | null> {
  return invoke("session_get_plan", { sessionId });
}

/** @adr ADR-0010.D1 */
export function cancelPlan(sessionId: number): Promise<Plan> {
  return invoke("session_cancel_plan", { sessionId });
}

/** @adr ADR-0010.D1 */
export function acceptPlan(sessionId: number): Promise<Plan> {
  return invoke("session_accept_plan", { sessionId });
}

/** @adr ADR-0010.D1 */
export interface SessionSummary {
  id: number;
  title: string;
  workspacePath: string;
  optInWorktree: boolean;
  conciseReplies: boolean;
  model: string | null;
  createdAt: string;
}

/** @adr ADR-0010.D1 */
export function createSession(title: string, projectId: number, optInWorktree: boolean, workspacePath?: string): Promise<SessionSummary> {
  return invoke("session_create", { title, projectId, workspacePath: workspacePath ?? null, optInWorktree });
}

/** @adr ADR-0010.D1 */
export function listSessions(): Promise<SessionSummary[]> {
  return invoke("session_list");
}

/** @adr ADR-0010.D1 */
export function setSessionWorktree(id: number, enabled: boolean): Promise<SessionSummary> {
  return invoke("session_set_worktree", { id, enabled });
}

/** @adr ADR-0020.D2 */
export function sessionSetConcise(sessionId: number, enabled: boolean): Promise<void> {
  return invoke("session_set_concise", { sessionId, enabled });
}

/** @adr ADR-0021.D2 */
export function sessionSetModel(sessionId: number, modelId: string | null): Promise<void> {
  return invoke("session_set_model", { sessionId, modelId });
}
