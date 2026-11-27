import { invoke } from "@tauri-apps/api/core";

/** @adr ADR-0016.D2 */
export interface Project {
  id: number;
  name: string;
  rootPath: string;
  createdAt: string;
}

/** @adr ADR-0016.D2 */
export type ProjectSessionState = "active" | "closed";

/** @adr ADR-0016.D2 */
export interface ProjectSession {
  id: number;
  title: string;
  phase: string | null;
  lastActivityAt: string;
  state: ProjectSessionState;
  taskStatuses: string[];
}

/** @adr ADR-0016.D2 */
export interface ProjectTreeEntry {
  project: Project;
  sessions: ProjectSession[];
}

/** @adr ADR-0016.D2 */
export type SessionGlyph = "needs-approval" | "running" | "planning" | "failed" | "done" | "idle";

/** @adr ADR-0016.D2 */
export function sessionGlyph(summary: ProjectSession): SessionGlyph {
  if (summary.state === "closed" || summary.phase === "Closed") return "done";
  if (summary.phase === "Rejected" || summary.phase === "Cancelled") return "idle";
  if (summary.taskStatuses.includes("failed")) return "failed";
  if (summary.taskStatuses.includes("running")) return "running";
  if (summary.phase === "Approve" || summary.phase === "Review") return "needs-approval";
  if (summary.phase === "Plan" || summary.phase === "Build") return "planning";
  return "idle";
}

/** @adr ADR-0016.D2 */
export function projectAdd(path: string): Promise<Project> {
  return invoke("project_add", { path });
}

/** @adr ADR-0016.D2 */
export function projectList(): Promise<Project[]> {
  return invoke("project_list");
}

/** @adr ADR-0016.D2 */
export function projectRemove(id: number, force = false): Promise<void> {
  return invoke("project_remove", { id, force });
}

/** @adr ADR-0016.D2 */
export function projectSessions(projectId: number): Promise<ProjectSession[]> {
  return invoke("project_sessions", { projectId });
}

/** @adr ADR-0016.D2 */
export function projectUnassignedSessions(): Promise<ProjectSession[]> {
  return invoke("project_unassigned_sessions");
}

/** @adr ADR-0016.D2 */
export function projectTree(): Promise<ProjectTreeEntry[]> {
  return invoke("project_tree");
}
