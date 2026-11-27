/** @adr ADR-0006.D1 */
export type SessionMode = "orchestrator" | "plan" | "build";

/** @adr ADR-0006.D1 */
export interface SubAgentTask {
  id: string;
  title: string;
  harness: string;
  status: "queued" | "running" | "waiting_approval" | "completed" | "failed";
  worktreePath?: string;
  worktreeBranch?: string;
  handoffSummary?: string;
}

/** @adr ADR-0006.D1 */
export interface Session {
  id: string;
  title: string;
  activeMode: SessionMode;
  workspacePath: string;
  optInWorktree: boolean;
  subAgents: SubAgentTask[];
}

/** @adr ADR-0006.D1 */
export const DEFAULT_SESSION_MODE: SessionMode = "orchestrator";
