import React, { useState } from "react";
import {
  Compass,
  FileCode2,
  Hammer,
  Send,
  GitBranch,
  ArrowRight,
  ShieldAlert,
} from "lucide-react";
import { Session, SessionMode } from "../../features/session/types";

/** @adr ADR-0009.D1 */
export interface ContentAreaProps {
  session: Session;
  onModeChange: (mode: SessionMode) => void;
  onToggleWorktree: () => void;
  onDispatchTask: (prompt: string, optInWorktree: boolean) => void;
}

/** @adr ADR-0009.D1 */
export const ContentArea: React.FC<ContentAreaProps> = ({
  session,
  onModeChange,
  onToggleWorktree,
  onDispatchTask,
}) => {
  const [prompt, setPrompt] = useState("");

  const handleSubmit = (e: React.SyntheticEvent) => {
    e.preventDefault();
    if (!prompt.trim()) return;
    onDispatchTask(prompt.trim(), session.optInWorktree);
    setPrompt("");
  };

  return (
    <main
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        background: "#0c0c0c",
        height: "100%",
        boxSizing: "border-box",
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 16px",
          background: "#141414",
          borderBottom: "1px solid #222",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <span style={{ fontWeight: 600, fontSize: "14px", color: "#eee" }}>
            {session.title}
          </span>
          <button
            onClick={onToggleWorktree}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "4px",
              padding: "3px 8px",
              borderRadius: "4px",
              border: session.optInWorktree ? "1px solid #15803d" : "1px solid #333",
              background: session.optInWorktree ? "#14532d" : "#1a1a1a",
              color: session.optInWorktree ? "#86efac" : "#888",
              fontSize: "11px",
              cursor: "pointer",
            }}
            title="Toggle Git Worktree isolation for sub-agent tasks"
          >
            <GitBranch size={12} />
            <span>Worktree: {session.optInWorktree ? "Enabled" : "Off"}</span>
          </button>
        </div>

        <div style={{ display: "flex", background: "#1f1f1f", borderRadius: "6px", padding: "2px", gap: "2px" }}>
          <button
            onClick={() => onModeChange("orchestrator")}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              padding: "4px 10px",
              borderRadius: "4px",
              border: "none",
              background: session.activeMode === "orchestrator" ? "#2563eb" : "transparent",
              color: session.activeMode === "orchestrator" ? "#fff" : "#999",
              fontSize: "12px",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            <Compass size={13} />
            <span>Orchestrator</span>
          </button>
          <button
            onClick={() => onModeChange("plan")}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              padding: "4px 10px",
              borderRadius: "4px",
              border: "none",
              background: session.activeMode === "plan" ? "#ca8a04" : "transparent",
              color: session.activeMode === "plan" ? "#fff" : "#999",
              fontSize: "12px",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            <FileCode2 size={13} />
            <span>Plan</span>
          </button>
          <button
            onClick={() => onModeChange("build")}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              padding: "4px 10px",
              borderRadius: "4px",
              border: "none",
              background: session.activeMode === "build" ? "#16a34a" : "transparent",
              color: session.activeMode === "build" ? "#fff" : "#999",
              fontSize: "12px",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            <Hammer size={13} />
            <span>Build</span>
          </button>
        </div>
      </header>

      <div
        style={{
          padding: "8px 16px",
          background:
            session.activeMode === "orchestrator"
              ? "#172554"
              : session.activeMode === "plan"
              ? "#2e2105"
              : "#052e16",
          borderBottom: "1px solid #222",
          fontSize: "12px",
          display: "flex",
          alignItems: "center",
          gap: "8px",
          color:
            session.activeMode === "orchestrator"
              ? "#bfdbfe"
              : session.activeMode === "plan"
              ? "#fde047"
              : "#86efac",
        }}
      >
        {session.activeMode === "orchestrator" && (
          <>
            <Compass size={14} />
            <span>
              <strong>Orchestrator Mode:</strong> Hands off tasks to cheaper sub-agent harnesses via ACP. High-level planning & synthesis.
            </span>
          </>
        )}
        {session.activeMode === "plan" && (
          <>
            <ShieldAlert size={14} />
            <span>
              <strong>Plan Mode:</strong> Read-only architectural design and review. Direct mutations are disabled.
            </span>
          </>
        )}
        {session.activeMode === "build" && (
          <>
            <Hammer size={14} />
            <span>
              <strong>Build Mode:</strong> Direct implementation worker. Edits files and executes test suites.
            </span>
          </>
        )}
      </div>

      <div
        style={{
          flex: 1,
          padding: "20px",
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          gap: "12px",
        }}
      >
        <div style={{ color: "#888", fontSize: "13px", lineHeight: "1.6" }}>
          Welcome to BentoBox. Running in workspace <code>{session.workspacePath}</code>.
        </div>

        {session.subAgents.length === 0 ? (
          <div
            style={{
              padding: "24px",
              border: "1px dashed #333",
              borderRadius: "8px",
              textAlign: "center",
              color: "#666",
              fontSize: "13px",
            }}
          >
            {session.activeMode === "orchestrator"
              ? "No sub-agents active. Submit a prompt below to orchestrate and hand off tasks to sub-agents."
              : session.activeMode === "plan"
              ? "Plan mode active. Enter goals to generate a formal architecture or test plan."
              : "Build mode active. Enter coding tasks to apply direct modifications."}
          </div>
        ) : (
          session.subAgents.map((task) => (
            <div
              key={task.id}
              style={{
                padding: "12px",
                background: "#161616",
                border: "1px solid #282828",
                borderRadius: "6px",
                display: "flex",
                flexDirection: "column",
                gap: "6px",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontWeight: 600, fontSize: "13px", color: "#eee" }}>{task.title}</span>
                <span
                  style={{
                    fontSize: "10px",
                    fontWeight: 700,
                    textTransform: "uppercase",
                    padding: "2px 6px",
                    borderRadius: "3px",
                    background: task.status === "completed" ? "#166534" : "#1e3a8a",
                    color: "#fff",
                  }}
                >
                  {task.status}
                </span>
              </div>
              <div style={{ fontSize: "11px", color: "#888", display: "flex", gap: "12px" }}>
                <span>Harness: {task.harness}</span>
                {task.worktreeBranch && <span>Branch: {task.worktreeBranch}</span>}
              </div>
              {task.handoffSummary && (
                <div style={{ fontSize: "11px", color: "#aaa", background: "#0e0e0e", padding: "6px", borderRadius: "4px" }}>
                  {task.handoffSummary}
                </div>
              )}
            </div>
          ))
        )}
      </div>

      <form
        onSubmit={handleSubmit}
        style={{
          padding: "12px 16px",
          background: "#121212",
          borderTop: "1px solid #222",
          display: "flex",
          gap: "8px",
        }}
      >
        <input
          type="text"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={
            session.activeMode === "orchestrator"
              ? "Describe goal to decompose and hand off to sub-agents..."
              : session.activeMode === "plan"
              ? "Outline architecture or design goal to plan..."
              : "Direct build command or file modification goal..."
          }
          style={{
            flex: 1,
            background: "#1c1c1c",
            border: "1px solid #333",
            borderRadius: "6px",
            padding: "10px 12px",
            color: "#fff",
            fontSize: "13px",
            outline: "none",
          }}
        />
        <button
          type="submit"
          style={{
            background:
              session.activeMode === "orchestrator"
                ? "#2563eb"
                : session.activeMode === "plan"
                ? "#ca8a04"
                : "#16a34a",
            border: "none",
            borderRadius: "6px",
            color: "#fff",
            padding: "0 16px",
            display: "flex",
            alignItems: "center",
            gap: "6px",
            fontWeight: 600,
            fontSize: "13px",
            cursor: "pointer",
          }}
        >
          {session.activeMode === "orchestrator" ? (
            <>
              <span>Hands-off</span>
              <ArrowRight size={14} />
            </>
          ) : (
            <>
              <span>Send</span>
              <Send size={14} />
            </>
          )}
        </button>
      </form>
    </main>
  );
};
