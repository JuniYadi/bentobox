import { describe, expect, mock, test } from "bun:test";
import type { DetectedHarness } from "./api";

const invoked: Array<{ cmd: string; args: unknown }> = [];

mock.module("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: unknown) => {
    invoked.push({ cmd, args });
    if (cmd === "agent_list_models") {
      return Promise.resolve({
        models: [{ id: "sonnet", name: "Sonnet" }],
        currentModel: "sonnet",
        status: "ready",
        note: null,
      });
    }
    return Promise.resolve();
  },
}));
// Exception: dynamic import is required after mock.module to bind the mocked Tauri modules.
const { agentListModels } = await import("./api");
describe("[ADR-0001.D1] detected harness registry type", () => {
  test("DetectedHarness includes runnable and launch_note fields", () => {
    const harness: DetectedHarness = {
      capabilities: {
        harness_id: "omp",
        display_name: "Oh My Pi",
        executable: "omp",
        transport: "acp",
        transport_args: ["acp"],
        binary_version: "19.2.1",
        models: null,
        effort_levels: null,
        features: {
          session_lifecycle: true,
          events: true,
          tool_permissions: true,
          cancellation: true,
          resume_history: null,
          usage_context: true,
        },
        known_limitations: [],
      },
      executable_path: "/opt/homebrew/bin/omp",
      runnable: true,
      launch_note: null,
    };

    expect(harness.runnable).toBe(true);
    expect(harness.launch_note).toBeNull();
  });

  test("DetectedHarness supports adapter launch notes", () => {
    const claude: DetectedHarness = {
      capabilities: {
        harness_id: "claude",
        display_name: "Claude Code",
        executable: "claude",
        transport: "acp",
        transport_args: [],
        binary_version: null,
        models: null,
        effort_levels: null,
        features: {
          session_lifecycle: true,
          events: true,
          tool_permissions: true,
          cancellation: true,
          resume_history: null,
          usage_context: true,
        },
        known_limitations: [],
      },
      executable_path: "npx",
      runnable: false,
      launch_note: "downloads the adapter with npx on first use",
    };

    expect(claude.runnable).toBe(false);
    expect(claude.launch_note).toBe("downloads the adapter with npx on first use");
  });
});

describe("[ADR-0021.D1] agentListModels", () => {
  test("invokes agent_list_models with harness and refresh", async () => {
    const before = invoked.length;
    const result = await agentListModels("omp", true);
    expect(invoked.slice(before)).toEqual([
      { cmd: "agent_list_models", args: { harness: "omp", refresh: true } },
    ]);
    expect(result.status).toBe("ready");
    expect(result.models).toEqual([{ id: "sonnet", name: "Sonnet" }]);
  });
});
