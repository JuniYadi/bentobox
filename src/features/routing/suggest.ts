import type { DetectedHarness, ModelCatalog } from "../agent/api";
import type { Team } from "../teams/api";

/** @adr ADR-0012.D1 */
export interface RouteSuggestion { value: string; availability: string }

/** @adr ADR-0012.D1 */
export function autocompleteRoutes(query: string, harnesses: DetectedHarness[], catalogs: Record<string, ModelCatalog | "loading" | "error" | undefined>, teams: Team[]): RouteSuggestion[] {
  const suggestions: RouteSuggestion[] = [];
  for (const harness of harnesses) {
    if (!harness.runnable || harness.capabilities.transport.toLowerCase() !== "acp") continue;
    const id = harness.capabilities.harness_id;
    suggestions.push({ value: `@${id}`, availability: "Available" });
    const catalog = catalogs[id];
    if (catalog && typeof catalog !== "string") {
      for (const model of catalog.models) suggestions.push({ value: `@${id}/${model.id}`, availability: catalog.status === "ready" ? "Available" : catalog.status.replace(/_/g, " ") });
    }
  }
  for (const team of teams) {
    const first = team.steps[0];
    const available = first && harnesses.some((h) => h.capabilities.harness_id === first.harness && h.runnable && h.capabilities.transport.toLowerCase() === "acp");
    suggestions.push({ value: `@team:${team.name}`, availability: available ? "First step available" : "First step unavailable" });
  }
  const needle = query.replace(/^@/, "").toLowerCase();
  return suggestions.filter((item) => item.value.slice(1).toLowerCase().startsWith(needle));
}
