import { invoke } from "@tauri-apps/api/core";

/** @adr ADR-0011.D1 */
export type TeamRole = "orchestrator" | "sub_agents" | "review";

/** @adr ADR-0011.D1 */
export interface TeamStep {
  harness: string;
  model: string | null;
  effort: "low" | "medium" | "high" | null;
}

/** @adr ADR-0011.D1 */
export interface Team {
  id: string;
  name: string;
  role: TeamRole;
  isDefault: boolean;
  steps: TeamStep[];
}

/** @adr ADR-0011.D2 */
export interface GenerateTeamsRules {
  goal: "cheapest" | "balanced" | "best_quality";
  preferSubscriptions: boolean;
  preferLocalSubagents: boolean;
  noFrontierSubagents: boolean;
  maxDepth: number;
}

/** @adr ADR-0011.D2 */
export interface GeneratedTeamDiff {
  action: "add" | "update";
  team: Team;
  summary: string;
  warnings: string[];
}

/** @adr ADR-0011.D1 */
export function teamsList(): Promise<Team[]> {
  return invoke("teams_list");
}

/** @adr ADR-0011.D1 */
export function teamsUpsert(team: Team): Promise<Team> {
  return invoke("teams_upsert", { team });
}

/** @adr ADR-0011.D1 */
export function teamsDelete(id: string): Promise<void> {
  return invoke("teams_delete", { id });
}

/** @adr ADR-0011.D1 */
export function teamsSetDefault(id: string): Promise<void> {
  return invoke("teams_set_default", { id });
}

/** @adr ADR-0011.D2 */
export function teamsGeneratePreview(rules: GenerateTeamsRules): Promise<GeneratedTeamDiff[]> {
  return invoke("teams_generate_preview", { rules });
}

/** @adr ADR-0011.D2 */
export function teamsApplyGenerated(teams: Team[]): Promise<Team[]> {
  return invoke("teams_apply_generated", { teams });
}
