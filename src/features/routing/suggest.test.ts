import { expect, test } from "bun:test";
import type { DetectedHarness, ModelCatalog } from "../agent/api";
import type { Team } from "../teams/api";
import { autocompleteRoutes } from "./suggest";

const harnesses = [
  { capabilities: { harness_id: "codex", transport: "acp" }, runnable: true },
  { capabilities: { harness_id: "offline", transport: "acp" }, runnable: false },
] as DetectedHarness[];
const catalogs: Record<string, ModelCatalog> = { codex: { models: [{ id: "model-1", name: "Model 1" }], currentModel: null, status: "ready", note: null } };
const teams = [{ id: "t1", name: "cheap", role: "orchestrator", isDefault: true, steps: [{ harness: "codex", model: null, effort: null }] }] as Team[];

test("[ADR-0012.D1] filters available harnesses, cached models and teams", () => {
  expect(autocompleteRoutes("@codex/m", harnesses, catalogs, teams)).toEqual([{ value: "@codex/model-1", availability: "Available" }]);
  expect(autocompleteRoutes("team:", harnesses, catalogs, teams)).toEqual([{ value: "@team:cheap", availability: "First step available" }]);
  expect(autocompleteRoutes("offline", harnesses, catalogs, teams)).toEqual([]);
});

test("[ADR-0012.D1] reports first-step availability without assuming fallback status", () => {
  const offlineTeam = { ...teams[0], name: "mixed", steps: [{ harness: "offline", model: null, effort: null }, { harness: "codex", model: null, effort: null }] };
  expect(autocompleteRoutes("@team:mix", harnesses, catalogs, [offlineTeam])).toEqual([{ value: "@team:mixed", availability: "First step unavailable" }]);
});
