import { invoke } from "@tauri-apps/api/core";

/** @adr ADR-0005.D1 */
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

/** @adr ADR-0005.D1 */
export interface DbEvent {
  id: number;
  session_id: number;
  task_id: number | null;
  kind: string;
  payload: JsonValue;
  created_at: string;
}

/** @adr ADR-0005.D1 */
export function dbCreateSession(state: string): Promise<number> {
  return invoke<number>("db_create_session", { state });
}

/** @adr ADR-0005.D1 */
export function dbCreateTask(sessionId: number, title: string, state: string): Promise<number> {
  return invoke<number>("db_create_task", { sessionId, title, state });
}

/** @adr ADR-0005.D1 */
export function dbAddDependency(sessionId: number, taskId: number, dependsOnId: number): Promise<void> {
  return invoke<void>("db_add_dependency", { sessionId, taskId, dependsOnId });
}

/** @adr ADR-0005.D1 */
export function dbAppendEvent(sessionId: number, taskId: number | null, kind: string, payload: JsonValue): Promise<number> {
  return invoke<number>("db_append_event", { sessionId, taskId, kind, payload });
}

/** @adr ADR-0005.D1 */
export function dbEvents(sessionId: number, afterId: number, limit: number): Promise<DbEvent[]> {
  return invoke<DbEvent[]>("db_events", { sessionId, afterId, limit });
}

/** @adr ADR-0005.D1 */
export function dbSetCapability(key: string, value: JsonValue): Promise<void> {
  return invoke<void>("db_set_capability", { key, value });
}

/** @adr ADR-0005.D1 */
export function dbCapability(key: string): Promise<JsonValue | null> {
  return invoke<JsonValue | null>("db_capability", { key });
}
