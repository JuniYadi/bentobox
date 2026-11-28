import { useState } from "react";
import { ArrowLeft, ChevronRight, GitBranch } from "lucide-react";
import type { DbEvent, JsonValue } from "../../../src-tauri/src/db/api";
import type { Plan, PlanTask, Session } from "../session/types";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { Textarea } from "../../components/ui/textarea";
import {
  runnerRespondPermission,
  runnerSteer,
  runnerStop,
} from "../runner/api";
import {
  buildTimeline,
  deriveDiffStats,
  deriveTimer,
  disabledAgentControls,
  getPermissionResolution,
  getQueuedSteer,
  isPermissionPending,
  taskEvents,
} from "./timeline";

/** @adr ADR-0017.D2 */
export interface AgentDetailViewProps {
  session: Session & { worktreeBranch?: string | null };
  plan: Plan;
  task: PlanTask;
  onBack: () => void;
  events: DbEvent[] | null;
  eventsError?: string | null;
  eventsTruncated?: boolean;
}

/** @adr ADR-0017.D2 */
export function AgentDetailView({
  session,
  plan: _plan,
  task,
  onBack,
  events,
  eventsError,
  eventsTruncated,
}: AgentDetailViewProps) {
  const [steerText, setSteerText] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const allEvents = events ?? [];
  const timeline = buildTimeline(allEvents, task);
  const diffStats = deriveDiffStats(allEvents, task);
  const timer = deriveTimer(allEvents, task);
  const queuedSteer = getQueuedSteer(allEvents, task);

  let branchName: string | null = null;
  for (const event of taskEvents(allEvents, task)) {
    if (event.payload && typeof event.payload === "object" && !Array.isArray(event.payload) && "branch" in event.payload) {
      const candidate = event.payload.branch;
      if (typeof candidate === "string" && candidate.trim().length > 0) {
        branchName = candidate.trim();
      }
    }
  }

  const projectName = session.workspacePath
    ? session.workspacePath.split("/").filter(Boolean).pop() ?? "project"
    : "project";
  const sessionTitle = session.title || `Session #${session.id}`;
  const agentLabel = `${task.harness || task.team} · ${task.title}`;
  const isRunning = task.status === "running";

  async function handleStop() {
    setActionError(null);
    setBusyAction("stop");
    try {
      await runnerStop(session.id, task.id);
    } catch (err) {
      setActionError(`Could not stop task: ${String(err)}`);
    } finally {
      setBusyAction(null);
    }
  }

  async function handleRespondPermission(requestId: string, decision: "allow" | "deny") {
    setActionError(null);
    setBusyAction(`perm-${requestId}-${decision}`);
    try {
      await runnerRespondPermission(session.id, task.id, requestId, decision);
    } catch (err) {
      setActionError(`Could not respond to permission: ${String(err)}`);
    } finally {
      setBusyAction(null);
    }
  }

  async function handleSteer() {
    const trimmed = steerText.trim();
    if (!trimmed) return;
    setActionError(null);
    setBusyAction("steer");
    try {
      await runnerSteer(session.id, task.id, trimmed);
      setSteerText("");
    } catch (err) {
      setActionError(`Could not steer agent: ${String(err)}`);
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-background text-foreground">
      {/* Header */}
      <header className="flex flex-col gap-2 border-b border-border px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7 shrink-0"
            aria-label="Back to session"
            onClick={onBack}
          >
            <ArrowLeft className="size-4" />
          </Button>

          {/* Breadcrumb: project › session › agent */}
          <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
            <span className="truncate">{projectName}</span>
            <ChevronRight className="size-3 shrink-0" />
            <span className="truncate">{sessionTitle}</span>
            <ChevronRight className="size-3 shrink-0" />
            <span className="truncate font-medium text-foreground">{agentLabel}</span>
          </nav>
        </div>

        {/* Action and status bar */}
        <div className="flex flex-wrap items-center gap-2 pl-9 text-xs">
          {branchName && (
            <Badge variant="outline" className="flex items-center gap-1 font-mono text-xs">
              <GitBranch className="size-3" />
              <span>{branchName}</span>
            </Badge>
          )}

          {diffStats && (
            <span className="font-mono text-xs text-foreground">
              +{diffStats.additions} −{diffStats.deletions}
            </span>
          )}

          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <span
              className={`size-2 rounded-full ${
                task.status === "running"
                  ? "bg-success"
                  : task.status === "failed"
                  ? "bg-danger"
                  : task.status === "completed" || task.status === "review"
                  ? "bg-success"
                  : "bg-muted-foreground"
              }`}
            />
            <span className="capitalize">{task.status}</span>
            {timer && <span className="font-mono text-muted-foreground">({timer})</span>}
          </span>

          <div className="ml-auto flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              {disabledAgentControls.Pause}
            </span>
            {!isRunning && (
              <span className="text-xs text-muted-foreground">
                {disabledAgentControls.Stop}
              </span>
            )}
            <span className="text-xs text-muted-foreground">
              {disabledAgentControls["Take over"]}
            </span>
            <div className="flex items-center gap-1.5">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled
                title={disabledAgentControls.Pause}
                aria-label="Pause"
              >
                Pause
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!isRunning || busyAction === "stop"}
                onClick={() => void handleStop()}
                title={isRunning ? "Stop task" : disabledAgentControls.Stop}
                aria-label="Stop"
              >
                {busyAction === "stop" ? "Stopping…" : "Stop"}
              </Button>
              <Button
                type="button"
                variant="default"
                size="sm"
                disabled
                title={disabledAgentControls["Take over"]}
                aria-label="Take over"
              >
                Take over
              </Button>
            </div>
          </div>
        </div>
      </header>

      {/* Honest limit notice */}
      <div className="border-b border-border bg-muted/20 px-4 py-2 text-xs text-muted-foreground">
        <span>Sub-agents run in their own worktree. BentoBox sets cwd to the worktree and relies on the agent&#39;s permission prompts for filesystem boundaries.</span>
      </div>

      {/* Action error display */}
      {actionError && (
        <div role="alert" className="flex items-center gap-1.5 border-b border-border bg-muted/20 px-4 py-2 text-xs text-foreground">
          <span className="size-2 shrink-0 rounded-full bg-danger" />
          <span>{actionError}</span>
        </div>
      )}

      {/* Main chat / timeline scroll area */}
      <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
        {eventsTruncated && (
          <div role="status" className="flex items-center justify-center gap-1.5 border-b border-border bg-muted/20 px-4 py-2 text-xs text-muted-foreground">
            <span className="size-2 shrink-0 rounded-full bg-warning" />
            <span>Showing the first 5,000 events</span>
          </div>
        )}
        {eventsError ? (
          <div className="flex items-center justify-center gap-2 py-8 text-center text-xs text-muted-foreground" role="alert">
            <span className="size-2 shrink-0 rounded-full bg-danger" />
            <span>{eventsError}</span>
          </div>
        ) : events === null ? (
          <div className="py-8 text-center text-xs text-muted-foreground">
            Loading events…
          </div>
        ) : timeline.length === 0 ? (
          <div className="py-8 text-center text-xs text-muted-foreground">
            No events recorded yet for this agent.
          </div>
        ) : (
          timeline.map((item) => {
            const payload = item.event.payload !== null && typeof item.event.payload === "object" && !Array.isArray(item.event.payload)
              ? (item.event.payload as Record<string, JsonValue>)
              : {};

            if (item.type === "handoff") {
              const handoffData = (payload.handoff && typeof payload.handoff === "object" && !Array.isArray(payload.handoff)
                ? payload.handoff
                : payload) as Record<string, unknown>;
              const goal = typeof handoffData.goal === "string" ? handoffData.goal : null;
              const nonGoals: string[] = Array.isArray(handoffData.non_goals)
                ? handoffData.non_goals.map(String)
                : Array.isArray(handoffData.nonGoals)
                ? handoffData.nonGoals.map(String)
                : [];
              const rawFiles = Array.isArray(handoffData.files) ? handoffData.files : [];
              const files = rawFiles.flatMap((entry) => {
                if (typeof entry === "string") return [{ path: entry, lines: null }];
                if (entry && typeof entry === "object" && !Array.isArray(entry) && "path" in entry && typeof entry.path === "string") {
                  let lines: { start: number; end: number } | null = null;
                  if ("lines" in entry && entry.lines && typeof entry.lines === "object" && !Array.isArray(entry.lines)) {
                    const rawLines = entry.lines as Record<string, unknown>;
                    if (typeof rawLines.start === "number" && typeof rawLines.end === "number") {
                      lines = { start: rawLines.start, end: rawLines.end };
                    }
                  }
                  return [{ path: entry.path, lines }];
                }
                return [];
              });
              const constraints: string[] = Array.isArray(handoffData.constraints)
                ? handoffData.constraints.map(String)
                : typeof handoffData.constraints === "string"
                ? [handoffData.constraints]
                : [];
              const acceptanceCommands: string[] = Array.isArray(handoffData.acceptance_commands)
                ? handoffData.acceptance_commands.map(String)
                : Array.isArray(handoffData.acceptanceCommands)
                ? handoffData.acceptanceCommands.map(String)
                : typeof handoffData.check === "string"
                ? [handoffData.check]
                : [];
              const worktreePath = typeof handoffData.worktree_path === "string"
                ? handoffData.worktree_path
                : typeof handoffData.worktreePath === "string"
                ? handoffData.worktreePath
                : null;

              return (
                <div key={item.event.id} className="flex flex-col gap-2">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">Handoff</span>
                    <span>{item.event.created_at}</span>
                  </div>
                  <Card className="flex flex-col gap-2 p-3 text-xs">
                    <div className="flex items-center justify-between font-medium text-foreground">
                      <span>{task.title}</span>
                      <Badge variant="outline" className="text-xs">
                        Delegated
                      </Badge>
                    </div>
                    {goal && (
                      <div>
                        <span className="text-muted-foreground">Goal: </span>
                        <span>{goal}</span>
                      </div>
                    )}
                    {nonGoals.length > 0 && (
                      <div>
                        <span className="text-muted-foreground">Non-goals: </span>
                        <span>{nonGoals.join(", ")}</span>
                      </div>
                    )}
                    {worktreePath && (
                      <div>
                        <span className="text-muted-foreground">Worktree: </span>
                        <span className="font-mono">{worktreePath}</span>
                      </div>
                    )}
                    {files.length > 0 && (
                      <div>
                        <span className="text-muted-foreground">Files: </span>
                        <span className="font-mono">
                          {files.map((file) => (file.lines ? `${file.path}:${file.lines.start}-${file.lines.end}` : file.path)).join(", ")}
                        </span>
                      </div>
                    )}
                    {constraints.length > 0 && (
                      <div>
                        <span className="text-muted-foreground">Constraints: </span>
                        <span>{constraints.join("; ")}</span>
                      </div>
                    )}
                    {acceptanceCommands.length > 0 && (
                      <div>
                        <span className="text-muted-foreground">Acceptance commands: </span>
                        <span className="font-mono">{acceptanceCommands.join(", ")}</span>
                      </div>
                    )}
                  </Card>
                </div>
              );
            }

            if (item.type === "tool") {
              const toolName = typeof payload.tool === "string" ? payload.tool : item.event.kind;
              const toolTarget = typeof payload.target === "string"
                ? payload.target
                : typeof payload.path === "string"
                ? payload.path
                : typeof payload.file === "string"
                ? payload.file
                : null;
              const output = typeof payload.output === "string" ? payload.output : null;

              return (
                <div key={item.event.id} className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">Agent activity</span>
                    <span>{item.event.created_at}</span>
                  </div>
                  <Card className="flex flex-col gap-2 p-3 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">
                        {toolName} {toolTarget && <span className="font-mono font-normal text-muted-foreground">{toolTarget}</span>}
                      </span>
                    </div>
                    {output && (
                      <pre className="overflow-x-auto rounded bg-muted/50 p-2 text-xs">
                        {output}
                      </pre>
                    )}
                  </Card>
                </div>
              );
            }

            if (item.type === "permission") {
              const requestId = typeof payload.request_id === "string" || typeof payload.request_id === "number"
                ? String(payload.request_id)
                : String(item.event.id);
              const operation = typeof payload.operation === "string" ? payload.operation : "Operation";
              const target = typeof payload.target === "string"
                ? payload.target
                : typeof payload.path === "string"
                ? payload.path
                : typeof payload.file === "string"
                ? payload.file
                : "";

              const resolution = getPermissionResolution(allEvents, requestId);
              const pending = isPermissionPending(allEvents, requestId, task.status);
              const canAllow = payload.can_allow !== false;
              const canDeny = payload.can_deny !== false;
              const allowBusy = busyAction === `perm-${requestId}-allow`;
              const denyBusy = busyAction === `perm-${requestId}-deny`;

              return (
                <Card key={item.event.id} className="flex flex-col gap-2 border-border p-3 text-xs">
                  <div className="flex items-center justify-between gap-1.5 font-medium text-foreground">
                    <div className="flex items-center gap-1.5">
                      <span className="size-2 rounded-full bg-warning" />
                      <span>{resolution ? "PERMISSION RESOLVED" : "PERMISSION REQUIRED"}</span>
                    </div>
                    {resolution && (
                      <Badge variant="outline" className="text-xs capitalize">
                        {resolution}
                      </Badge>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      <span className="size-2 rounded-full bg-warning" />
                      <span>{operation}</span>
                      {target && <span className="font-mono text-muted-foreground">{target}</span>}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled
                        title={disabledAgentControls["View diff"]}
                        aria-label="View diff"
                      >
                        View diff
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={!pending || !canDeny || denyBusy}
                        onClick={() => void handleRespondPermission(requestId, "deny")}
                        title={pending ? (canDeny ? "Deny" : "Agent did not offer a deny option") : disabledAgentControls.Deny}
                        aria-label="Deny"
                      >
                        {denyBusy ? "Denying…" : "Deny"}
                      </Button>
                      <Button
                        type="button"
                        variant="default"
                        size="sm"
                        disabled={!pending || !canAllow || allowBusy}
                        onClick={() => void handleRespondPermission(requestId, "allow")}
                        title={pending ? (canAllow ? "Allow" : "Agent did not offer an allow option") : disabledAgentControls.Allow}
                        aria-label="Allow"
                      >
                        {allowBusy ? "Allowing…" : "Allow"}
                      </Button>
                    </div>
                  </div>
                  <div className="flex flex-col gap-1 text-xs text-muted-foreground">
                    <p>{disabledAgentControls["View diff"]}</p>
                    {!pending && (
                      <>
                        <p>{disabledAgentControls.Allow}</p>
                        <p>{disabledAgentControls.Deny}</p>
                      </>
                    )}
                    {pending && !canAllow && (
                      <p>Agent did not offer an allow option.</p>
                    )}
                    {pending && !canDeny && (
                      <p>Agent did not offer a deny option.</p>
                    )}
                  </div>
                </Card>
              );
            }

            if (item.type === "task_state") {
              const status = typeof payload.status === "string" ? payload.status : "unknown";
              const reason = typeof payload.reason === "string" ? payload.reason : null;
              return (
                <div key={item.event.id} className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">Task state</span>
                    <span>{item.event.created_at}</span>
                  </div>
                  <Card className="flex flex-col gap-1 p-3 text-xs">
                    <div className="flex items-center gap-2">
                      <span
                        className={`size-2 rounded-full ${
                          status === "running"
                            ? "bg-success"
                            : status === "failed"
                            ? "bg-danger"
                            : status === "review" || status === "completed"
                            ? "bg-success"
                            : "bg-muted-foreground"
                        }`}
                      />
                      <span className="font-medium capitalize">{status}</span>
                    </div>
                    {reason && (
                      <div className="text-muted-foreground">
                        <span>Reason: </span>
                        <span>{reason}</span>
                      </div>
                    )}
                  </Card>
                </div>
              );
            }

            if (item.type === "agent_message") {
              const text = typeof payload.text === "string" ? payload.text : "";
              return (
                <div key={item.event.id} className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">Agent message</span>
                    <span>{item.event.created_at}</span>
                  </div>
                  <Card className="flex flex-col gap-1 p-3 text-xs">
                    <p className="whitespace-pre-wrap">{text}</p>
                  </Card>
                </div>
              );
            }

            if (item.type === "agent_thought") {
              const text = typeof payload.text === "string" ? payload.text : "";
              return (
                <div key={item.event.id} className="flex flex-col gap-1 text-xs">
                  <details className="rounded-md border border-border/50 bg-muted/20 p-2 text-muted-foreground">
                    <summary className="cursor-pointer select-none font-medium text-xs text-muted-foreground hover:text-foreground">
                      Thought
                    </summary>
                    <pre className="mt-1.5 whitespace-pre-wrap text-xs text-muted-foreground">
                      {text}
                    </pre>
                  </details>
                </div>
              );
            }

            if (item.type === "steer") {
              const text = typeof payload.text === "string" ? payload.text : "";
              const isQueued = item.event.kind === "steer_queued";
              return (
                <div key={item.event.id} className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">Steering prompt</span>
                    <span>{item.event.created_at}</span>
                  </div>
                  <Card className="flex flex-col gap-2 p-3 text-xs">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-xs">
                        {isQueued ? "Queued" : "Sent"}
                      </Badge>
                    </div>
                    <p className="whitespace-pre-wrap">{text}</p>
                  </Card>
                </div>
              );
            }

            return null;
          })
        )}
      </div>

      {/* Steering Composer */}
      <div className="border-t border-border p-3">
        <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-2">
          {queuedSteer && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Badge variant="outline" className="text-xs">Queued</Badge>
              <span className="truncate">{queuedSteer}</span>
            </div>
          )}
          <Textarea
            disabled={!isRunning || busyAction === "steer"}
            value={steerText}
            onChange={(e) => setSteerText(e.target.value)}
            placeholder={isRunning ? "Steer this agent…" : disabledAgentControls.Steer}
            aria-label="Steer this agent"
            className="min-h-12 resize-none border-0 bg-transparent text-xs shadow-none focus-visible:ring-0"
          />
          <div className="flex items-center justify-between pt-1 text-xs">
            <span className="text-muted-foreground">
              {isRunning ? (queuedSteer ? "Prompt queued for next turn" : "") : disabledAgentControls.Steer}
            </span>
            <Button
              type="button"
              size="sm"
              disabled={!isRunning || !steerText.trim() || busyAction === "steer"}
              onClick={() => void handleSteer()}
              title={isRunning ? "Steer" : disabledAgentControls.Steer}
              aria-label="Steer"
            >
              {busyAction === "steer" ? "Steering…" : "Steer"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
