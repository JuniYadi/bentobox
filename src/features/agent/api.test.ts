import { describe, expect, test } from "bun:test";
import type { DetectedHarness } from "./api";

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
