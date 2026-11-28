import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { GeneratedTeamDiff, Team } from "./api";
import type { TeamsSectionController } from "./TeamsSection";

const invokedCommands: Array<{ cmd: string; args?: unknown }> = [];

let mockTeamsList: Team[] = [
  {
    id: "team-1",
    name: "frontier",
    role: "orchestrator",
    isDefault: true,
    steps: [
      { harness: "claude", model: "opus-5.5", effort: "high" },
      { harness: "codex", model: "gpt-6.1", effort: null },
    ],
  },
];

mock.module("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: unknown) => {
    invokedCommands.push({ cmd, args });
    if (cmd === "teams_list") {
      return Promise.resolve([...mockTeamsList]);
    }
    if (cmd === "list_detected_harnesses") {
      return Promise.resolve([
        {
          capabilities: {
            harness_id: "claude",
            display_name: "Claude Code",
            executable: "claude",
            transport: "acp",
            transport_args: [],
            binary_version: "1.0.0",
            models: ["opus-5.5", "sonnet-5.5"],
            effort_levels: null,
            features: {},
            known_limitations: [],
          },
          executable_path: "/usr/local/bin/claude",
          runnable: true,
          launch_note: null,
        },
      ]);
    }
    if (cmd === "auth_status") {
      return Promise.resolve({
        state: "authenticated",
        auth_method: "claude.ai",
      });
    }
    if (cmd === "agent_list_models") {
      return Promise.resolve({
        models: [
          { id: "opus-5.5", name: "Claude 3.5 Opus" },
          { id: "sonnet-5.5", name: "Claude 3.5 Sonnet" },
        ],
        currentModel: "opus-5.5",
        status: "ready",
        note: null,
      });
    }
    if (cmd === "settings_get") {
      return Promise.resolve(null);
    }
    if (cmd === "settings_set") {
      return Promise.resolve();
    }
    if (cmd === "teams_generate_preview") {
      const diffs: GeneratedTeamDiff[] = [
        {
          action: "add",
          team: {
            id: "team-gen",
            name: "cheaper",
            role: "sub_agents",
            isDefault: false,
            steps: [{ harness: "omp", model: "haiku-5.5", effort: "medium" }],
          },
          summary: "omp haiku-5.5 fallback",
          warnings: ["No cost metadata available; ranking by observed order."],
        },
      ];
      return Promise.resolve(diffs);
    }
    if (cmd === "teams_apply_generated") {
      if (args && typeof args === "object" && "teams" in args) {
        const teams = args.teams as Team[];
        mockTeamsList = [...mockTeamsList, ...teams];
        return Promise.resolve(teams);
      }
      return Promise.reject(new Error("missing teams argument"));
    }
    if (cmd === "teams_upsert") {
      if (args && typeof args === "object" && "team" in args) {
        const team = args.team as Team;
        const saved = team.id ? team : { ...team, id: `created-${mockTeamsList.length + 1}` };
        mockTeamsList = [...mockTeamsList.filter((t) => t.id !== saved.id), saved];
        return Promise.resolve(saved);
      }
      return Promise.reject(new Error("missing team argument"));
    }
    return Promise.resolve();
  },
}));

// Dynamic import to bind mock.module
const { TeamsSection } = await import("./TeamsSection");

describe("[ADR-0011.D1] TeamsSection rendering", () => {
  test("renders teams, fallback chain, role caption and honest quota", () => {
    const mockTeam: Team = {
      id: "team-1",
      name: "frontier",
      role: "orchestrator",
      isDefault: true,
      steps: [
        { harness: "claude", model: "opus-5.5", effort: "high" },
        { harness: "codex", model: "gpt-6.1", effort: null },
      ],
    };

    const mockSub = {
      harness: {
        capabilities: {
          harness_id: "claude",
          display_name: "Claude Code",
          executable: "claude",
          transport: "acp" as const,
          transport_args: [],
          binary_version: "1.0.0",
          models: ["opus-5.5"],
          effort_levels: null,
          features: {
            session_lifecycle: true,
            events: true,
            tool_permissions: true,
            cancellation: true,
            resume_history: true,
            usage_context: true,
          },
          known_limitations: [],
        },
        executable_path: "/usr/local/bin/claude",
        runnable: true,
        launch_note: null,
      },
      auth: { state: "authenticated" as const, auth_method: "claude.ai" },
      models: ["opus-5.5", "sonnet-5.5"],
    };

    const html = renderToStaticMarkup(
      <TeamsSection
        initialTeams={[mockTeam]}
        initialSubscriptions={[mockSub]}
        initialDefaultEffort="medium"
        initialUnavailableAction="ask"
      />
    );

    // Team name and default badge
    expect(html).toContain('value="frontier"');
    expect(html).toContain("Default");

    // Honest role caption
    expect(html).toContain("Read-only planning and delegation · fallback order");

    // Honest fallback explanation
    expect(html).toContain(
      "The next step is tried when a step is not runnable, signed out, times out during start-up, or exits before producing output; quota is not detected."
    );

    // Honest role default caption
    expect(html).toContain(
      "Defaults are stored and editable here; they are not silently applied to sessions that have no team."
    );

    // Honest quota and subscription details
    expect(html).toContain("quota Unavailable");
    expect(html).toContain("claude.ai");
    expect(html).toContain("Signed in");

    // Routing defaults
    expect(html).toContain("Default effort");
    expect(html).toContain("Stored only and not applied to runs yet.");
    expect(html).toContain("Unavailable harness action");
  });

  test("New team button is disabled with explanatory title when no subscriptions exist", () => {
    const html = renderToStaticMarkup(
      <TeamsSection initialTeams={[]} initialSubscriptions={[]} />
    );
    expect(html).toContain("disabled");
    expect(html).toContain("At least one detected subscription is required to create a team");
  });

  test("creates team with first unused team-N name", async () => {
    let controller!: TeamsSectionController;
    const sub = {
      harness: {
        capabilities: {
          harness_id: "claude",
          display_name: "Claude Code",
          executable: "claude",
          transport: "acp" as const,
          transport_args: [],
          binary_version: "1.0.0",
          models: ["opus-5.5"],
          effort_levels: null,
          features: {
            session_lifecycle: true,
            events: true,
            tool_permissions: true,
            cancellation: true,
            resume_history: true,
            usage_context: true,
          },
          known_limitations: [],
        },
        executable_path: "/usr/local/bin/claude",
        runnable: true,
        launch_note: null,
      },
      auth: null,
      models: [],
    };

    // team-1 and team-3 exist, so unused is team-2
    const team1: Team = {
      id: "t1",
      name: "team-1",
      role: "orchestrator",
      isDefault: true,
      steps: [{ harness: "claude", model: null, effort: null }],
    };
    const team3: Team = {
      id: "t3",
      name: "team-3",
      role: "sub_agents",
      isDefault: false,
      steps: [{ harness: "claude", model: null, effort: null }],
    };

    mockTeamsList = [team1, team3];
    const startIndex = invokedCommands.length;

    renderToStaticMarkup(
      <TeamsSection
        initialTeams={[team1, team3]}
        initialSubscriptions={[sub]}
        onStateReady={(c) => {
          controller = c;
        }}
      />
    );

    await controller.createTeam();

    const upsertCalls = invokedCommands
      .slice(startIndex)
      .filter((c) => c.cmd === "teams_upsert");
    expect(upsertCalls).toHaveLength(1);
    const createdTeam = (upsertCalls[0].args as { team: Team }).team;
    expect(createdTeam.name).toBe("team-2");
  });
});

describe("[ADR-0011.D2] TeamsSection generation workflow", () => {
  test("Generate shows preview without calling apply until Apply is clicked", async () => {
    let controller!: TeamsSectionController;
    const startIndex = invokedCommands.length;

    renderToStaticMarkup(
      <TeamsSection
        initialTeams={[]}
        initialSubscriptions={[]}
        onStateReady={(c) => {
          controller = c;
        }}
      />
    );

    expect(controller).toBeDefined();

    // 1. Generate preview
    await controller.generatePreview();

    // Verify preview API was called
    const generateCalls = invokedCommands
      .slice(startIndex)
      .filter((c) => c.cmd === "teams_generate_preview");
    expect(generateCalls).toHaveLength(1);

    // Crucial: teams_apply_generated must NOT have been called yet
    const applyCallsBefore = invokedCommands
      .slice(startIndex)
      .filter((c) => c.cmd === "teams_apply_generated");
    expect(applyCallsBefore).toHaveLength(0);

    // Preview state contains diffs and warnings
    const preview = controller.getPreview();
    expect(preview).not.toBeNull();
    expect(preview).toHaveLength(1);
    expect(preview?.[0].team.name).toBe("cheaper");
    expect(preview?.[0].warnings[0]).toContain("No cost metadata available");

    // 2. Click Apply
    await controller.applyPreview();

    // Crucial: teams_apply_generated is called upon explicit apply
    const applyCallsAfter = invokedCommands
      .slice(startIndex)
      .filter((c) => c.cmd === "teams_apply_generated");
    expect(applyCallsAfter).toHaveLength(1);

    // Preview is cleared after apply
    expect(controller.getPreview()).toBeNull();
  });

  test("after Apply, existing custom teams stay and list shows all teams", async () => {
    let controller!: TeamsSectionController;

    const existing1: Team = {
      id: "t1",
      name: "frontier",
      role: "orchestrator",
      isDefault: true,
      steps: [{ harness: "claude", model: "opus-5.5", effort: "high" }],
    };
    const existing2: Team = {
      id: "t2",
      name: "custom-review",
      role: "review",
      isDefault: true,
      steps: [{ harness: "codex", model: "gpt-6.1", effort: null }],
    };

    // Initialize backend store with two existing teams
    mockTeamsList = [existing1, existing2];

    const previewDiff: GeneratedTeamDiff = {
      action: "add",
      team: {
        id: "t3-gen",
        name: "cheaper",
        role: "sub_agents",
        isDefault: false,
        steps: [{ harness: "omp", model: "haiku-5.5", effort: "medium" }],
      },
      summary: "omp haiku-5.5",
      warnings: [],
    };

    renderToStaticMarkup(
      <TeamsSection
        initialTeams={[existing1, existing2]}
        initialSubscriptions={[]}
        initialPreview={[previewDiff]}
        onStateReady={(c) => {
          controller = c;
        }}
      />
    );

    // Apply preview: calls teamsApplyGenerated then refetches teamsList()
    await controller.applyPreview();

    // Backend store now holds all 3 teams
    expect(mockTeamsList).toHaveLength(3);
    const names = mockTeamsList.map((t) => t.name);
    expect(names).toContain("frontier");
    expect(names).toContain("custom-review");
    expect(names).toContain("cheaper");
  });

  test("Discard clears preview with no apply call", async () => {
    let controller!: TeamsSectionController;
    const startIndex = invokedCommands.length;

    renderToStaticMarkup(
      <TeamsSection
        initialTeams={[]}
        initialSubscriptions={[]}
        onStateReady={(c) => {
          controller = c;
        }}
      />
    );

    // Generate preview
    await controller.generatePreview();
    expect(controller.getPreview()).not.toBeNull();

    // Discard preview
    controller.discardPreview();
    expect(controller.getPreview()).toBeNull();

    // Verify teams_apply_generated was NEVER called
    const applyCalls = invokedCommands
      .slice(startIndex)
      .filter((c) => c.cmd === "teams_apply_generated");
    expect(applyCalls).toHaveLength(0);
  });
});
