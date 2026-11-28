import { invoke } from "@tauri-apps/api/core";
import { Plan, PlanTask } from "./types";

/** @adr ADR-0010.D1 */
export function proposePlan(sessionId: number, tasks: PlanTask[]): Promise<Plan> {
  return invoke("session_propose_plan", { sessionId, tasks });
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
