import { ArrowLeft, ChevronRight, GitBranch } from "lucide-react";
import type { DbEvent, JsonValue } from "../../../src-tauri/src/db/api";
import type { Plan, PlanTask, Session } from "../session/types";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { Textarea } from "../../components/ui/textarea";
import {
  buildTimeline,
  deriveDiffStats,
  deriveTimer,
  disabledAgentControls,
  taskEvents,
} from "./timeline";

/** @adr ADR-0016.D4 */
export interface AgentDetailViewProps {
  session: Session & { worktreeBranch?: string | null };
  plan: Plan;
  task: PlanTask;
  onBack: () => void;
  events: DbEvent[] | null;
  eventsError?: string | null;
}

/** @adr ADR-0016.D4 */
export function AgentDetailView({
  session,
  plan: _plan,
  task,
  onBack,
  events,
  eventsError,
}: AgentDetailViewProps) {
  const allEvents = events ?? [];

  const timeline = buildTimeline(allEvents, task);
  const diffStats = deriveDiffStats(allEvents, task);
  const timer = deriveTimer(allEvents, task);

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
                  : task.status === "completed"
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
                disabled
                title={disabledAgentControls.Stop}
                aria-label="Stop"
              >
                Stop
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

      {/* Main chat / timeline scroll area */}
      <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
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
                    <span className="font-medium text-foreground">Orchestrator handoff</span>
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
                      <pre className="overflow-x-auto rounded bg-muted/50 p-2 font-mono text-xs">
                        {output}
                      </pre>
                    )}
                  </Card>
                </div>
              );
            }

            if (item.type === "permission") {
              const operation = typeof payload.operation === "string" ? payload.operation : "Operation";
              const target = typeof payload.target === "string"
                ? payload.target
                : typeof payload.path === "string"
                ? payload.path
                : typeof payload.file === "string"
                ? payload.file
                : "";

              return (
                <Card key={item.event.id} className="flex flex-col gap-2 border-warning/50 p-3 text-xs">
                  <div className="flex items-center gap-1.5 font-medium text-foreground">
                    <span className="size-2 rounded-full bg-warning" />
                    <span>PERMISSION REQUIRED</span>
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
                        disabled
                        title={disabledAgentControls.Deny}
                        aria-label="Deny"
                      >
                        Deny
                      </Button>
                      <Button
                        type="button"
                        variant="default"
                        size="sm"
                        disabled
                        title={disabledAgentControls.Allow}
                        aria-label="Allow"
                      >
                        Allow
                      </Button>
                    </div>
                  </div>
                  <div className="flex flex-col gap-1 text-xs text-muted-foreground">
                    <p>{disabledAgentControls["View diff"]}</p>
                    <p>{disabledAgentControls.Allow}</p>
                  </div>
                </Card>
              );
            }

            return null;
          })
        )}
      </div>

      {/* Steering Composer */}
      <div className="border-t border-border p-3">
        <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-2">
          <Textarea
            disabled
            placeholder="Steer this agent…"
            aria-label="Steer this agent"
            className="min-h-12 resize-none border-0 bg-transparent text-xs shadow-none focus-visible:ring-0"
          />
          <div className="flex items-center justify-between pt-1 text-xs">
            <span className="text-muted-foreground">{disabledAgentControls.Steer}</span>
            <Button
              type="button"
              size="sm"
              disabled
              title={disabledAgentControls.Steer}
              aria-label="Steer"
            >
              Steer
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
