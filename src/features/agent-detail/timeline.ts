import type { DbEvent, JsonValue } from "../../../src-tauri/src/db/api";
import { dbEvents } from "../../../src-tauri/src/db/api";
import type { PlanTask } from "../session/types";

/** @adr ADR-0017.D2 */
export type TimelineItemType =
  | "handoff"
  | "tool"
  | "permission"
  | "task_state"
  | "agent_message"
  | "agent_thought";

/** @adr ADR-0017.D2 */
export interface TimelineItem {
  type: TimelineItemType;
  event: DbEvent;
}

/** @adr ADR-0017.D2 */
export const disabledAgentControls = {
  Pause: "ACP protocol does not support pausing agent execution.",
  Stop: "Stop is only available while the task is running or in review.",
  "Take over": "Take over is a separate workflow (ADR-0010) and is not available yet.",
  Allow: "Permission response is only available for pending requests offering allow.",
  Deny: "Permission response is only available for pending requests offering deny.",
} as const;

/** @adr ADR-0018.D4 */
export function isPermissionPending(events: DbEvent[], requestId: string, taskStatus: string): boolean {
  if (taskStatus !== "running" && taskStatus !== "review") return false;
  const isResolved = events.some((event) => {
    if (event.kind !== "permission_resolved") return false;
    const payload = event.payload && typeof event.payload === "object" && !Array.isArray(event.payload)
      ? (event.payload as Record<string, JsonValue>)
      : null;
    return String(payload?.request_id) === requestId;
  });
  return !isResolved;
}

/** @adr ADR-0017.D2 */
export function getPermissionResolution(events: DbEvent[], requestId: string): "allow" | "deny" | "allow_always" | "cancelled" | null {
  for (const event of events) {
    if (event.kind === "permission_resolved") {
      const payload = event.payload && typeof event.payload === "object" && !Array.isArray(event.payload)
        ? (event.payload as Record<string, JsonValue>)
        : null;
      if (String(payload?.request_id) === requestId) {
        const decision = payload?.decision;
        if (decision === "allow" || decision === "deny" || decision === "allow_always" || decision === "cancelled") {
          return decision;
        }
      }
    }
  }
  return null;
}


/**
 * Attributes events to a plan task using the explicit payload IDs.
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

/** @adr ADR-0018.D4 */
export function partitionChatTimeline(events: DbEvent[], task: PlanTask): { chatItems: DbEvent[]; activityItems: DbEvent[] } {
  const chatItems: DbEvent[] = [];
  const activityItems: DbEvent[] = [];
  const relevant = taskEvents(events, task);
  let lastEventWasAgentMessage = false;

  for (const event of relevant) {
    const payload = event.payload && typeof event.payload === "object" && !Array.isArray(event.payload) ? event.payload as Record<string, JsonValue> : {};
    const requestId = String(payload.request_id ?? event.id);
    const chat = typeof payload.parent_tool_call_id !== "string" && (event.kind === "user_message" || event.kind === "agent_message" || (event.kind === "permission_request" && isPermissionPending(relevant, requestId, task.status)));

    if (chat) {
      if (event.kind === "agent_message" && lastEventWasAgentMessage && chatItems.length > 0) {
        const prev = chatItems[chatItems.length - 1];
        const prevPayload = prev.payload && typeof prev.payload === "object" && !Array.isArray(prev.payload) ? prev.payload as Record<string, JsonValue> : {};
        const itemPayload = event.payload && typeof event.payload === "object" && !Array.isArray(event.payload) ? event.payload as Record<string, JsonValue> : {};
        const prevText = typeof prevPayload.text === "string" ? prevPayload.text : "";
        const itemText = typeof itemPayload.text === "string" ? itemPayload.text : "";
        chatItems[chatItems.length - 1] = {
          ...prev,
          payload: {
            ...prevPayload,
            text: `${prevText}${itemText}`,
          },
        };
      } else {
        chatItems.push(event);
      }
      lastEventWasAgentMessage = event.kind === "agent_message";
    } else {
      activityItems.push(event);
      lastEventWasAgentMessage = false;
    }
  }

  return { chatItems, activityItems };
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
 * @adr ADR-0017.D2
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
    } else if (event.kind === "task_state") {
      items.push({ type: "task_state", event });
    } else if (event.kind === "agent_message") {
      items.push({ type: "agent_message", event });
    } else if (event.kind === "agent_thought") {
      items.push({ type: "agent_thought", event });
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

/** @adr ADR-0017.D2 */
export interface IncrementalEventsResult {
  events: DbEvent[];
  truncated: boolean;
}

/** @adr ADR-0017.D2 */
export function mergeEvents(existing: DbEvent[], incoming: DbEvent[], cap = 5000): { events: DbEvent[]; truncated: boolean } {
  const seen = new Set<number>();
  const merged: DbEvent[] = [];
  let truncated = false;

  for (const event of existing) {
    if (!seen.has(event.id)) {
      if (merged.length >= cap) {
        truncated = true;
        break;
      }
      seen.add(event.id);
      merged.push(event);
    }
  }

  for (const event of incoming) {
    if (!seen.has(event.id)) {
      if (merged.length >= cap) {
        truncated = true;
        break;
      }
      seen.add(event.id);
      merged.push(event);
    }
  }

  merged.sort((a, b) => a.id - b.id);
  return { events: merged, truncated };
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

/**
 * Incrementally appends session events after the given afterId.
 * Caps at 5,000 events per session without throwing or dropping loaded events.
 *
 * @adr ADR-0017.D2
 */
export async function fetchIncrementalEvents(
  sessionId: number,
  currentEvents: DbEvent[]
): Promise<IncrementalEventsResult> {
  let { events, truncated } = mergeEvents([], currentEvents);
  if (truncated || events.length >= 5000) {
    return { events, truncated: true };
  }

  const limit = 200;
  const maxEvents = 5000;
  let afterId = events.length > 0 ? events[events.length - 1].id : 0;

  while (events.length < maxEvents) {
    const fetchCount = Math.min(limit, maxEvents - events.length);
    const page = await dbEvents(sessionId, afterId, fetchCount);
    if (page.length === 0) return { events, truncated };

    const merged = mergeEvents(events, page, maxEvents);
    events = merged.events;
    afterId = page[page.length - 1].id;
    if (merged.truncated) {
      return { events, truncated: true };
    }
    if (page.length < fetchCount) return { events, truncated };
  }

  if ((await dbEvents(sessionId, afterId, 1)).length > 0) {
    return { events, truncated: true };
  }
  return { events, truncated };
}
