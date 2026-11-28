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

/** @adr ADR-0018.D3 */
export function runnerRespondPermission(sessionId: number, taskId: string, requestId: string, decision: "allow" | "deny" | "allow_always"): Promise<void> {
  return invoke("runner_respond_permission", { sessionId, taskId, requestId, decision });
}

/** @adr ADR-0018.D2 */
export function runnerSend(sessionId: number, taskId: string, text: string): Promise<void> {
  return invoke("runner_send", { sessionId, taskId, text });
}

/** @adr ADR-0018.D3 */
export function runnerSetMode(sessionId: number, taskId: string, modeId: string): Promise<void> {
  return invoke("runner_set_mode", { sessionId, taskId, modeId });
}

/** @adr ADR-0021.D2 */
export function runnerSetModel(sessionId: number, taskId: string, modelId: string): Promise<void> {
  return invoke("runner_set_model", { sessionId, taskId, modelId });
}

/** @adr ADR-0018.D5 */
export function onSessionTitle(handler: (event: { sessionId: number; title: string }) => void): Promise<() => void> {
  return listen<{ sessionId: number; title: string }>("session:title", (event) => handler(event.payload));
}

/** @adr ADR-0017.D3 */
export function onRunnerEvent(handler: (event: { sessionId: number; eventId: number }) => void): Promise<() => void> {
  return listen<{ sessionId: number; eventId: number }>("runner:event", (event) => handler(event.payload));
}
