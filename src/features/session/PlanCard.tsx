import { SquareCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { Plan } from "./types";

/** @adr ADR-0016.D3 */
export const PLAN_COMPOSER_PLACEHOLDER = "Reply to revise the plan, or approve above…";

/** @adr ADR-0016.D3 */
export const ORCHESTRATOR_UNAVAILABLE_REASON =
  "Orchestrator execution isn't available yet. Your text will remain here.";

/** @adr ADR-0016.D3 */
export interface PlanCardProps {
  plan: Plan;
  busy?: boolean;
  error?: string;
  onApprove: (revision: number) => void;
}

/** @adr ADR-0016.D3 */
export function showsPlanCard(plan: Plan | null | undefined): boolean {
  if (!plan) return false;
  return plan.phase === "Plan" || plan.phase === "Approve";
}


/** @adr ADR-0016.D3 */
export function PlanCard({ plan, busy = false, error, onApprove }: PlanCardProps) {
  const taskIdToNumber = new Map<string, number>();
  plan.tasks.forEach((task, index) => {
    taskIdToNumber.set(task.id, index + 1);
  });

  const worktreeCount = plan.tasks.filter((task) => task.worktree).length;
  const totalTokensText =
    plan.estimated_tokens === null ? "unknown" : plan.estimated_tokens.toLocaleString();
  const canApprove = plan.phase === "Plan" && !plan.approved && !busy;

  return (
    <Card className="gap-0 overflow-hidden py-0 border-border bg-card shadow-xs">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2.5 text-xs">
        <SquareCheck className="size-4 shrink-0 text-warning" aria-hidden="true" />
        <span className="font-medium text-foreground">Plan</span>
        <Badge variant="outline" className="text-xs font-normal text-muted-foreground">
          orchestrator · read-only
        </Badge>
      </div>

      <div className="divide-y divide-border">
        {plan.tasks.length === 0 ? (
          <div className="px-3 py-4 text-xs text-muted-foreground">No tasks in plan.</div>
        ) : (
          plan.tasks.map((task, index) => {
            const taskNumber = index + 1;
            const taskEstimateText =
              task.estimated_tokens === null ? "unknown" : task.estimated_tokens.toLocaleString();
            const harnessTeamLabel =
              task.team && task.team !== task.harness
                ? `${task.harness} · ${task.team}`
                : task.harness || task.team || "task";

            return (
              <div
                key={task.id}
                className="flex items-start gap-2 px-3 py-2.5 text-xs"
              >
                <span className="w-5 shrink-0 pt-0.5 text-muted-foreground">
                  {taskNumber}
                </span>

                <div className="min-w-0 flex-1 space-y-1">
                  <div className="text-sm font-medium leading-snug text-foreground">
                    {task.title}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                    <span>{task.worktree ? "worktree" : "no worktree"}</span>
                    {task.files.length > 0 ? (
                      <>
                        <span>·</span>
                        <span className="font-mono">{task.files.join(", ")}</span>
                      </>
                    ) : null}
                    <span>·</span>
                    <span>
                      est. {taskEstimateText} tokens
                    </span>
                    {task.dependencies.length > 0 ? (
                      <>
                        <span>·</span>
                        <span>
                          {task.dependencies
                            .map((depId) => {
                              const num = taskIdToNumber.get(depId);
                              return `after #${num ?? depId}`;
                            })
                            .join(", ")}
                        </span>
                      </>
                    ) : null}
                  </div>
                </div>

                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  disabled
                  aria-disabled="true"
                  title="Harness and team for this task"
                  className="shrink-0 cursor-not-allowed opacity-80"
                >
                  <span>{harnessTeamLabel}</span>
                </Button>
              </div>
            );
          })
        )}
      </div>

      <div className="flex flex-col gap-2 border-t border-border bg-background/50 px-3 py-2.5 text-xs">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-muted-foreground">
            <span>
              {worktreeCount} {worktreeCount === 1 ? "worktree" : "worktrees"}
            </span>
            <span className="mx-1">·</span>
            <span>
              est. <span className="text-foreground">{totalTokensText}</span> tokens
            </span>
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled
              aria-describedby="plan-card-revise-reason"
            >
              Revise
            </Button>
            <Button
              type="button"
              variant="default"
              size="sm"
              disabled={!canApprove}
              onClick={() => onApprove(plan.revision)}
              data-revision={plan.revision}
            >
              Approve & build
            </Button>
          </div>
        </div>

        <p id="plan-card-revise-reason" className="text-right text-xs text-muted-foreground">
          {ORCHESTRATOR_UNAVAILABLE_REASON}
        </p>
      </div>

      {error ? (
        <div className="border-t border-border px-3 py-2 text-xs text-foreground">
          {error}
        </div>
      ) : null}
    </Card>
  );
}
