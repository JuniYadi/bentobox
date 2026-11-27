import { invoke } from "@tauri-apps/api/core";

/** @adr ADR-0007.D1 */
export interface HandoffLineRange {
  start: number;
  end: number;
}

/** @adr ADR-0007.D1 */
export interface HandoffFileReference {
  path: string;
  lines: HandoffLineRange | null;
}

/** @adr ADR-0007.D1 */
export interface Handoff {
  goal: string;
  non_goals: string[];
  files: HandoffFileReference[];
  constraints: string[];
  acceptance_commands: string[];
  worktree_path: string;
}

/** @adr ADR-0007.D1 */
export function renderHandoff(workspaceRoot: string, handoff: Handoff): Promise<string> {
  return invoke<string>("render_handoff", { workspaceRoot, handoff });
}
