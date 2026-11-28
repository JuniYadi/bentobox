import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

/** @adr ADR-0017.D3 */
export function runnerStart(sessionId: number): Promise<string[]> {
  return invoke("runner_start", { sessionId });
}

/** @adr ADR-0017.D3 */
export function runnerStop(sessionId: number, taskId: string): Promise<void> {
  return invoke("runner_stop", { sessionId, taskId });
}

/** @adr ADR-0017.D3 */
export function runnerRespondPermission(sessionId: number, taskId: string, requestId: string, decision: "allow" | "deny"): Promise<void> {
  return invoke("runner_respond_permission", { sessionId, taskId, requestId, decision });
}

/** @adr ADR-0017.D3 */
export function runnerSteer(sessionId: number, taskId: string, text: string): Promise<void> {
  return invoke("runner_steer", { sessionId, taskId, text });
}

/** @adr ADR-0017.D3 */
export function onRunnerEvent(handler: (event: { sessionId: number; eventId: number }) => void): Promise<() => void> {
  return listen<{ sessionId: number; eventId: number }>("runner:event", (event) => handler(event.payload));
}
