import type { DbEvent, JsonValue } from "../../../src-tauri/src/db/api";
import { dbEvents } from "../../../src-tauri/src/db/api";
import type { PlanTask } from "../session/types";

/** @adr ADR-0016.D4 */
export interface TimelineItem {
  type: "handoff" | "tool" | "permission";
  event: DbEvent;
}

/** @adr ADR-0016.D4 */
export const disabledAgentControls = {
  Pause: "Agent execution controls are not available yet.",
  Stop: "Agent execution controls are not available yet.",
  "Take over": "Agent execution controls are not available yet.",
  Allow: "Permission responses are not available yet.",
  Deny: "Permission responses are not available yet.",
  "View diff": "Permission diff viewing is not available yet.",
  Steer: "Agent steering is not available yet.",
} as const;

/**
 * No producer writes these payload keys yet, and SQL tasks are not linked to
 * plan tasks. Until an agent-execution decision lands, a task may have no
 * attributed events.
 *
 * @adr ADR-0016.D4
 */
export function taskEvents(events: DbEvent[], task: PlanTask): DbEvent[] {
  return events.filter((event) => {
    const payload = event.payload !== null && typeof event.payload === "object" && !Array.isArray(event.payload)
      ? event.payload as Record<string, JsonValue>
      : null;
    return payload?.plan_task_id === task.id || payload?.task_id === task.id;
  });
}

/**
 * Returns a usage task ID only when explicitly recorded and unambiguous.
 *
 * @adr ADR-0016.D4
 */
export function mappedTaskId(events: DbEvent[], task: PlanTask): number | null {
  const ids = new Set<number>();
  for (const event of taskEvents(events, task)) {
    const payload = event.payload !== null && typeof event.payload === "object" && !Array.isArray(event.payload)
      ? event.payload as Record<string, JsonValue>
      : null;
    if (typeof payload?.usage_task_id === "number" && Number.isSafeInteger(payload.usage_task_id)) {
      ids.add(payload.usage_task_id);
    }
  }
  return ids.size === 1 ? ids.values().next().value ?? null : null;
}

/**
 * Builds the timeline from actual events only.
 * Unknown or unrecognised event kinds are omitted.
 *
 * @adr ADR-0016.D4
 */
export function buildTimeline(events: DbEvent[], task: PlanTask): TimelineItem[] {
  const relevant = taskEvents(events, task);
  const items: TimelineItem[] = [];

  for (const event of relevant) {
    if (event.kind === "handoff") {
      items.push({ type: "handoff", event });
    } else if (event.kind === "tool" || event.kind === "tool_call" || event.kind === "tool_activity") {
      items.push({ type: "tool", event });
    } else if (event.kind === "permission_request" || event.kind === "permission") {
      items.push({ type: "permission", event });
    }
  }

  return items;
}

/**
 * Derives diff counts from the latest applied change for each file path.
 * Returns null if no applied file change contains diff information.
 *
 * @adr ADR-0016.D4
 */
export function deriveDiffStats(events: DbEvent[], task: PlanTask): { additions: number; deletions: number } | null {
  const files = new Map<string, { id: number; additions: number; deletions: number }>();
  for (const event of taskEvents(events, task)) {
    if (event.kind !== "file_changed" && event.kind !== "change_applied" && event.kind !== "applied_change") continue;
    const payload = event.payload !== null && typeof event.payload === "object" && !Array.isArray(event.payload)
      ? event.payload as Record<string, JsonValue>
      : null;
    if (!payload || typeof payload.path !== "string") continue;
    const additions = payload.additions ?? payload.diff_additions;
    const deletions = payload.deletions ?? payload.diff_deletions;
    if (typeof additions !== "number" && typeof deletions !== "number") continue;
    const previous = files.get(payload.path);
    if (!previous || event.id > previous.id) {
      files.set(payload.path, {
        id: event.id,
        additions: typeof additions === "number" ? additions : 0,
        deletions: typeof deletions === "number" ? deletions : 0,
      });
    }
  }
  if (files.size === 0) return null;
  let additions = 0;
  let deletions = 0;
  for (const file of files.values()) {
    additions += file.additions;
    deletions += file.deletions;
  }
  return { additions, deletions };
}

/**
 * Derives timer string (e.g. "0:42") from event timestamps or duration payloads.
 * Returns null if timestamps cannot derive a duration.
 *
 * @adr ADR-0016.D4
 */
export function deriveTimer(events: DbEvent[], task: PlanTask): string | null {
  const relevant = taskEvents(events, task);
  if (relevant.length === 0) return null;

  for (const event of relevant) {
    const payload = event.payload !== null && typeof event.payload === "object" && !Array.isArray(event.payload)
      ? (event.payload as Record<string, JsonValue>)
      : null;
    if (typeof payload?.duration_seconds === "number") {
      const minutes = Math.floor(payload.duration_seconds / 60);
      const seconds = Math.floor(payload.duration_seconds % 60);
      return `${minutes}:${seconds.toString().padStart(2, "0")}`;
    }
    if (typeof payload?.timer === "string") {
      return payload.timer;
    }
  }

  const timestamps = relevant
    .map((event) => Date.parse(event.created_at))
    .filter((time) => !Number.isNaN(time));

  if (timestamps.length >= 2) {
    const start = Math.min(...timestamps);
    const end = Math.max(...timestamps);
    const elapsedSeconds = Math.max(0, Math.floor((end - start) / 1000));
    const minutes = Math.floor(elapsedSeconds / 60);
    const seconds = elapsedSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
  }

  return null;
}

/**
 * Fetches session events across pages, rejecting logs exceeding 5,000 events.
 *
 * @adr ADR-0016.D4
 */
export async function loadSessionEvents(sessionId: number): Promise<DbEvent[]> {
  const events: DbEvent[] = [];
  const limit = 200;
  const maxEvents = 5000;
  let afterId = 0;

  while (events.length < maxEvents) {
    const fetchCount = Math.min(limit, maxEvents - events.length);
    const page = await dbEvents(sessionId, afterId, fetchCount);
    if (page.length === 0) return events;
    events.push(...page);
    afterId = page[page.length - 1].id;
    if (page.length < fetchCount) return events;
  }
  if ((await dbEvents(sessionId, afterId, 1)).length > 0) {
    throw new Error("Event log exceeds 5,000 events and was truncated.");
  }
  return events;
}
