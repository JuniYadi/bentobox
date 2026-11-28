import { describe, expect, mock, test } from "bun:test";
import type { GenerateTeamsRules, Team } from "./api";

const invoked: Array<{ cmd: string; args?: unknown }> = [];

mock.module("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: unknown) => {
    invoked.push({ cmd, args });
    if (cmd === "teams_list") {
      return Promise.resolve([
        {
          id: "team-1",
          name: "frontier",
          role: "orchestrator",
          isDefault: true,
          steps: [{ harness: "claude", model: "opus-5.5", effort: "high" }],
        },
      ]);
    }
    if (cmd === "teams_upsert") {
      if (args && typeof args === "object" && "team" in args) {
        return Promise.resolve(args.team);
      }
      return Promise.reject(new Error("missing team payload"));
    }
    if (cmd === "teams_generate_preview") {
      return Promise.resolve([
        {
          action: "add",
          team: {
            id: "gen-1",
            name: "cheaper",
            role: "sub_agents",
            isDefault: false,
            steps: [{ harness: "omp", model: "haiku-5.5", effort: "medium" }],
          },
          summary: "omp haiku-5.5",
          warnings: ["local execution preferred"],
        },
      ]);
    }
    if (cmd === "teams_apply_generated") {
      if (args && typeof args === "object" && "teams" in args) {
        return Promise.resolve(args.teams);
      }
      return Promise.reject(new Error("missing teams payload"));
    }
    return Promise.resolve();
  },
}));

// Exception: dynamic import is required after mock.module to bind the mocked Tauri modules.
const {
  teamsList,
  teamsUpsert,
  teamsDelete,
  teamsSetDefault,
  teamsGeneratePreview,
  teamsApplyGenerated,
} = await import("./api");

describe("[ADR-0011.D1] teams crud api", () => {
  test("teamsList invokes teams_list without arguments", async () => {
    const list = await teamsList();
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe("frontier");
    expect(invoked[invoked.length - 1]).toEqual({ cmd: "teams_list", args: undefined });
  });

  test("teamsUpsert invokes teams_upsert with team argument", async () => {
    const team: Team = {
      id: "team-1",
      name: "frontier",
      role: "orchestrator",
      isDefault: true,
      steps: [{ harness: "claude", model: "opus-5.5", effort: "high" }],
    };
    const saved = await teamsUpsert(team);
    expect(saved).toEqual(team);
    expect(invoked[invoked.length - 1]).toEqual({ cmd: "teams_upsert", args: { team } });
  });

  test("teamsDelete invokes teams_delete with id", async () => {
    await teamsDelete("team-1");
    expect(invoked[invoked.length - 1]).toEqual({ cmd: "teams_delete", args: { id: "team-1" } });
  });

  test("teamsSetDefault invokes teams_set_default with id", async () => {
    await teamsSetDefault("team-1");
    expect(invoked[invoked.length - 1]).toEqual({ cmd: "teams_set_default", args: { id: "team-1" } });
  });
});

describe("[ADR-0011.D2] teams generation api", () => {
  test("teamsGeneratePreview invokes teams_generate_preview with rules", async () => {
    const rules: GenerateTeamsRules = {
      goal: "balanced",
      preferSubscriptions: true,
      preferLocalSubagents: true,
      noFrontierSubagents: false,
      maxDepth: 3,
    };
    const diffs = await teamsGeneratePreview(rules);
    expect(diffs).toHaveLength(1);
    expect(diffs[0].action).toBe("add");
    expect(invoked[invoked.length - 1]).toEqual({
      cmd: "teams_generate_preview",
      args: { rules },
    });
  });

  test("teamsApplyGenerated invokes teams_apply_generated with teams payload", async () => {
    const teams: Team[] = [
      {
        id: "gen-1",
        name: "cheaper",
        role: "sub_agents",
        isDefault: false,
        steps: [{ harness: "omp", model: "haiku-5.5", effort: "medium" }],
      },
    ];
    const applied = await teamsApplyGenerated(teams);
    expect(applied).toEqual(teams);
    expect(invoked[invoked.length - 1]).toEqual({
      cmd: "teams_apply_generated",
      args: { teams },
    });
  });
});
