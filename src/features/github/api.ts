import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";

/** @adr ADR-0008.D1 */
export interface GhStatus {
  installed: boolean;
  authenticated: boolean;
  username?: string;
  message: string;
}

/** @adr ADR-0008.D1 */
export interface GhIssue {
  number: number;
  title: string;
  state: string;
  url: string;
}

/** @adr ADR-0008.D1 */
export interface GhPullRequest {
  number: number;
  title: string;
  state: string;
  url: string;
  headRefName?: string;
}

/** @adr ADR-0008.D1 */
export async function checkGitHubStatus(): Promise<GhStatus> {
  try {
    return await invoke<GhStatus>("gh_check_status");
  } catch (error) {
    return {
      installed: false,
      authenticated: false,
      message: error instanceof Error ? error.message : "GitHub CLI bridge unavailable",
    };
  }
}

/** @adr ADR-0008.D1 */
export async function listGitHubIssues(): Promise<GhIssue[]> {
  try {
    return await invoke<GhIssue[]>("gh_list_issues");
  } catch (error) {
    console.warn("Failed to fetch GitHub issues:", error);
    return [];
  }
}

/** @adr ADR-0008.D1 */
export async function listGitHubPullRequests(): Promise<GhPullRequest[]> {
  try {
    return await invoke<GhPullRequest[]>("gh_list_prs");
  } catch (error) {
    console.warn("Failed to fetch GitHub PRs:", error);
    return [];
  }
}

/** @adr ADR-0008.D1 */
export async function openGitHubUrl(url: string): Promise<void> {
  try {
    await openUrl(url);
  } catch {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}
