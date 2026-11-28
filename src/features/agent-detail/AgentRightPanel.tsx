import { useEffect, useState } from "react";
import type { DbEvent } from "../../../src-tauri/src/db/api";
import type { Plan, PlanTask, Session } from "../session/types";
import type { SessionUsage } from "../usage/api";
import { getSessionUsage } from "../usage/api";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../components/ui/tabs";
import { mappedTaskId, taskEvents } from "./timeline";

/** @adr ADR-0016.D4 */
export interface AgentRightPanelProps {
  session: Session;
  plan: Plan;
  task: PlanTask;
  events: DbEvent[] | null;
  eventsError?: string | null;
  usage?: SessionUsage | null;
}

/** @adr ADR-0016.D4 */
export function AgentRightPanel({
  session,
  plan: _plan,
  task,
  events,
  eventsError,
  usage: propUsage,
}: AgentRightPanelProps) {
  const [fetchedUsage, setFetchedUsage] = useState<SessionUsage | null>(null);
  const [usageError, setUsageError] = useState<string | null>(null);

  useEffect(() => {
    if (propUsage !== undefined) return;
    let active = true;
    getSessionUsage(session.id)
      .then((data) => {
        if (active) {
          setFetchedUsage(data);
          setUsageError(null);
        }
      })
      .catch((error) => {
        if (active) {
          setFetchedUsage(null);
          setUsageError(error instanceof Error ? error.message : String(error));
        }
      });
    return () => {
      active = false;
    };
  }, [session.id, propUsage]);

  const allEvents = events ?? [];
  const usageData = propUsage !== undefined ? propUsage : fetchedUsage;
  const relevantEvents = taskEvents(allEvents, task);
  const numericId = mappedTaskId(allEvents, task);
  const taskUsage = numericId !== null ? usageData?.tasks[numericId] ?? null : null;
  const files: string[] = "files" in task && Array.isArray(task.files) ? task.files : [];

  // Look for diff text in task event payloads
  let recordedDiff: string | null = null;
  for (const event of relevantEvents) {
    if (event.payload && typeof event.payload === "object" && !Array.isArray(event.payload)) {
      if ("diff" in event.payload && typeof event.payload.diff === "string") {
        recordedDiff = event.payload.diff;
        break;
      }
      if ("patch" in event.payload && typeof event.payload.patch === "string") {
        recordedDiff = event.payload.patch;
        break;
      }
    }
  }

  return (
    <aside aria-label="Agent inspector" className="flex h-full w-full flex-col overflow-hidden bg-background text-foreground">
      <Tabs defaultValue="overview" className="flex h-full w-full flex-col">
        <div className="border-b border-border px-3 py-2">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="diff">Diff</TabsTrigger>
            <TabsTrigger value="logs">Logs</TabsTrigger>
          </TabsList>
        </div>

        {/* Overview Tab */}
        <TabsContent value="overview" className="flex-1 overflow-y-auto p-4 text-xs">
          <div className="flex flex-col gap-4">
            {/* Team & Harness - assigned only, no faked fallback chain */}
            <section className="flex flex-col gap-1.5">
              <div className="text-xs font-medium">Team &amp; Harness</div>
              <div className="flex items-center justify-between py-1">
                <span className="text-muted-foreground">Team</span>
                <span>{task.team}</span>
              </div>
              <div className="flex items-center justify-between py-1">
                <span className="text-muted-foreground">Harness</span>
                <span>{task.harness}</span>
              </div>
              <div className="flex items-center justify-between py-1">
                <span className="text-muted-foreground">Status</span>
                <span className="flex items-center gap-1.5">
                  <span
                    className={`size-2 rounded-full ${
                      task.status === "running"
                        ? "bg-success"
                        : task.status === "failed"
                        ? "bg-danger"
                        : task.status === "completed"
                        ? "bg-success"
                        : "bg-muted-foreground"
                    }`}
                  />
                  <span className="capitalize">{task.status}</span>
                </span>
              </div>
            </section>

            {/* Token and cost usage */}
            <section className="flex flex-col gap-1.5">
              <div className="text-xs font-medium">Usage</div>
              {usageError ? (
                <div className="py-1 text-muted-foreground">Could not load usage: {usageError}</div>
              ) : taskUsage ? (
                <div className="flex flex-col gap-1">
                  <div className="flex items-center justify-between py-1">
                    <span className="text-muted-foreground">Input tokens</span>
                    <span>{taskUsage.input_tokens.toLocaleString()}</span>
                  </div>
                  <div className="flex items-center justify-between py-1">
                    <span className="text-muted-foreground">Output tokens</span>
                    <span>{taskUsage.output_tokens.toLocaleString()}</span>
                  </div>
                  {Object.entries(taskUsage.costs).map(([currency, amount]) => (
                    <div key={currency} className="flex items-center justify-between py-1">
                      <span className="text-muted-foreground">Cost ({currency})</span>
                      <span>{amount.toFixed(4)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="py-1 text-muted-foreground">No usage recorded for this task.</div>
              )}
            </section>
            {/* Files touched */}
            <section className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between text-xs font-medium">
                <span>Files touched</span>
                <span className="text-muted-foreground">{files.length}</span>
              </div>
              {files.length === 0 ? (
                <div className="py-1 text-muted-foreground">No files recorded.</div>
              ) : (
                <div className="flex flex-col gap-1 py-1">
                  {files.map((file) => (
                    <div key={file} className="truncate font-mono">
                      {file}
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        </TabsContent>

        {/* Diff Tab */}
        <TabsContent value="diff" forceMount className="flex-1 overflow-y-auto p-4 text-xs">
          {recordedDiff ? (
            <pre className="overflow-x-auto whitespace-pre rounded bg-muted/50 p-2 font-mono text-xs">
              {recordedDiff}
            </pre>
          ) : (
            eventsError ? (
              <div className="py-6 text-center text-muted-foreground">
                {eventsError}
              </div>
            ) : (
              <div className="py-6 text-center text-muted-foreground">
                No diff events recorded for this task.
              </div>
            )
          )}
        </TabsContent>

        {/* Logs Tab */}
        <TabsContent value="logs" forceMount className="flex-1 overflow-y-auto p-4 text-xs">
          {eventsError ? (
            <div className="py-6 text-center text-muted-foreground">
              {eventsError}
            </div>
          ) : relevantEvents.length === 0 ? (
            <div className="py-6 text-center text-muted-foreground">
              No log events recorded for this task.
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {relevantEvents.map((event) => (
                <div key={event.id} className="flex flex-col gap-1 rounded border border-border p-2">
                  <div className="flex items-center justify-between text-muted-foreground">
                    <span className="font-medium text-foreground">{event.kind}</span>
                    <span>{event.created_at}</span>
                  </div>
                  <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-xs text-muted-foreground">
                    {event.kind === "agent_log" && event.payload && typeof event.payload === "object" && !Array.isArray(event.payload) && "text" in event.payload && typeof event.payload.text === "string"
                      ? event.payload.text
                      : JSON.stringify(event.payload, null, 2)}
                  </pre>
                </div>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </aside>
  );
}
