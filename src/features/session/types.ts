/** @adr ADR-0010.D1 */
export type SessionPhase = "Plan" | "Approve" | "Build" | "Review" | "Rejected" | "Closed" | "Cancelled";

/**
 * @adr ADR-0010.D1
 * @adr ADR-0016.D3
 */
export interface PlanTask {
  id: string;
  title: string;
  team: string;
  harness: string;
  model?: string | null;
  pinned?: boolean;
  worktree: boolean;
  files: string[];
  dependencies: string[];
  estimated_tokens: number | null;
  status: "queued" | "running" | "review" | "completed" | "failed" | "cancelled";
}

/** @adr ADR-0010.D1 */
export interface Plan {
  session_id: number;
  revision: number;
  phase: SessionPhase;
  approved: boolean;
  estimated_tokens: number | null;
  tasks_started: boolean;
  tasks: PlanTask[];
}

/** @adr ADR-0010.D1 */
export interface SubAgentTask {
  id: string;
  title: string;
  harness: string;
  status: "queued" | "running" | "waiting_approval" | "completed" | "failed";
  worktreePath?: string;
  worktreeBranch?: string;
  handoffSummary?: string;
}

/** @adr ADR-0010.D1 */
export interface Session {
  id: number;
  title: string;
  workspacePath: string;
  optInWorktree: boolean;
  conciseReplies: boolean;
  model: string | null;
  team: string | null;
  subAgents: SubAgentTask[];
}
