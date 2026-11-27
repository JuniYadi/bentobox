import { invoke } from "@tauri-apps/api/core";

/** @adr ADR-0003.D1 */
export interface Worktree {
  path: string;
  branch: string | null;
}

/** @adr ADR-0003.D1 */
export interface CreateWorktreeResult {
  worktree: Worktree;
  warnings: string[];
}

/** @adr ADR-0003.D1 */
export function createWorktree(repoPath: string, taskId: string, baseBranch: string, enabled: boolean): Promise<CreateWorktreeResult | null> {
  return invoke("create_worktree", { repoPath, taskId, baseBranch, enabled });
}

/** @adr ADR-0003.D1 */
export function listWorktrees(repoPath: string, enabled: boolean): Promise<Worktree[]> {
  return invoke("list_worktrees", { repoPath, enabled });
}

/** @adr ADR-0003.D1 */
export function removeWorktree(repoPath: string, taskId: string, force: boolean, enabled: boolean): Promise<void> {
  return invoke("remove_worktree", { repoPath, taskId, force, enabled });
}
