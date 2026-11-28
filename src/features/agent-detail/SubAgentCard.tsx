import type { PlanTask } from "../session/types";
import { Card } from "../../components/ui/card";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";

/** @adr ADR-0016.D4 */
export interface SubAgentCardProps {
  task: PlanTask;
  onOpen: () => void;
}

/** @adr ADR-0016.D4 */
export function SubAgentCard({ task, onOpen }: SubAgentCardProps) {
  return (
    <Card className="flex flex-col gap-2 p-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate font-medium">{task.title}</span>
          <Badge variant="outline" className="text-xs">
            {task.team}
          </Badge>
          <span className="text-xs text-muted-foreground">{task.harness}</span>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
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
          <span>{task.status}</span>
        </div>
      </div>
      <div className="flex items-center justify-between gap-2 pt-1 text-xs">
        <span className="text-muted-foreground">{task.id}</span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 text-xs"
          onClick={onOpen}
        >
          Open agent
        </Button>
      </div>
    </Card>
  );
}
