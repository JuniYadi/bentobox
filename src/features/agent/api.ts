import { invoke } from "@tauri-apps/api/core";

/** @adr ADR-0001.D1 */
export type TransportKind = "acp" | "native_process";

/** @adr ADR-0001.D1 */
export interface AgentFeatures {
  session_lifecycle: boolean | null;
  events: boolean | null;
  tool_permissions: boolean | null;
  cancellation: boolean | null;
  resume_history: boolean | null;
  usage_context: boolean | null;
}

/** @adr ADR-0001.D1 */
export interface CapabilityDescriptor {
  harness_id: string;
  display_name: string;
  executable: string;
  transport: TransportKind;
  transport_args: string[];
  binary_version: string | null;
  models: string[] | null;
  effort_levels: string[] | null;
  features: AgentFeatures;
  known_limitations: string[];
}

/** @adr ADR-0001.D1 */
export interface DetectedHarness {
  capabilities: CapabilityDescriptor;
  executable_path: string;
  runnable: boolean;
  launch_note: string | null;
}

/** @adr ADR-0001.D1 */
export function listDetectedHarnesses(): Promise<DetectedHarness[]> {
  return invoke<DetectedHarness[]>("list_detected_harnesses");
}

/** @adr ADR-0021.D1 */
export interface ModelOption { id: string; name: string }

/** @adr ADR-0021.D1 */
export interface ModelCatalog {
  models: ModelOption[];
  currentModel: string | null;
  status: "ready" | "unadvertised" | "auth_required" | "unavailable" | "timeout";
  note: string | null;
}

/** @adr ADR-0021.D1 */
export function agentListModels(harness: string, refresh?: boolean): Promise<ModelCatalog> {
  return invoke("agent_list_models", { harness, refresh });
}
