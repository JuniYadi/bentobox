import React, { useEffect, useState } from "react";
import { GitBranch, Send } from "lucide-react";
import { getPlan } from "../../features/session/api";
import { Plan, Session } from "../../features/session/types";

/** @adr ADR-0009.D1 */
export interface ContentAreaProps {
  session: Session | null;
  onToggleWorktree: () => void;
  onCreateSession: () => void;
  prompt: string;
  onPromptChange: (prompt: string) => void;
  emptyMessage: string;
  error: string | null;
}

/** @adr ADR-0009.D1 */
export const ContentArea: React.FC<ContentAreaProps> = ({ session, onToggleWorktree, onCreateSession, prompt, onPromptChange, emptyMessage, error }) => {
  const [plan, setPlan] = useState<Plan | null>(null);
  const sessionId = session?.id;

  useEffect(() => {
    let cancelled = false;
    setPlan(null);
    if (sessionId != null) {
      (async () => {
        try {
          const result = await getPlan(sessionId);
          if (!cancelled) setPlan(result);
        } catch {
          if (!cancelled) setPlan(null);
        }
      })();
    }
    return () => { cancelled = true; };
  }, [sessionId]);

  const phase = plan && plan.session_id === sessionId ? plan.phase : null;
  return (
    <main style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", background: "#09090b", height: "100%", boxSizing: "border-box" }}>
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 16px", background: "#111113", borderBottom: "1px solid #27272a" }}>
        <span style={{ fontWeight: 500, fontSize: "14px", color: "#fafafa" }}>{session?.title ?? "Sessions"}</span>
        {session && <button onClick={onToggleWorktree} title="Toggle Git Worktree isolation for sub-agent tasks" style={{ display: "flex", alignItems: "center", gap: "4px", padding: "3px 8px", borderRadius: "4px", border: "1px solid #3f3f46", background: "transparent", color: "#a1a1aa", fontSize: "11px", cursor: "pointer" }}>
          <GitBranch size={12} /><span>Worktree: {session.optInWorktree ? "Enabled" : "Off"}</span>
        </button>}
      </header>
      <div aria-label="Plan phases" style={{ display: "flex", gap: "12px", padding: "8px 16px", color: "#a1a1aa", fontSize: "12px", borderBottom: "1px solid #27272a" }}>
        {(["Plan", "Approve", "Build", "Review"] as const).map((step, index) => <span key={step} aria-current={phase === step ? "step" : undefined} style={{ fontWeight: phase === step ? 600 : 400, color: phase === step ? "#fafafa" : "#a1a1aa" }}>{index > 0 ? "→ " : ""}{step}</span>)}
        {phase === "Rejected" || phase === "Closed" || phase === "Cancelled" ? <span>{phase}</span> : null}
      </div>
      <div style={{ flex: 1, padding: "20px", overflowY: "auto", display: "flex", flexDirection: "column", gap: "12px" }}>
        {error && <div role="alert" style={{ color: "#a1a1aa", fontSize: "13px" }}>{error}</div>}
        {session ? <>
          <div style={{ color: "#a1a1aa", fontSize: "13px", lineHeight: "1.6" }}>Workspace <code>{session.workspacePath}</code></div>
          <div style={{ padding: "24px", border: "1px dashed #3f3f46", borderRadius: "8px", textAlign: "center", color: "#a1a1aa", fontSize: "13px" }}>No sub-agents active.</div>
        </> : <div style={{ display: "flex", alignItems: "center", gap: "8px", color: "#a1a1aa", fontSize: "13px" }}>{emptyMessage} <button type="button" onClick={onCreateSession} style={{ padding: "6px 10px", border: "1px solid #3f3f46", borderRadius: "6px", background: "#27272a", color: "#fafafa", cursor: "pointer" }}>Create session</button></div>}
      </div>
      <form onSubmit={(event) => event.preventDefault()} style={{ padding: "12px 16px", background: "#111113", borderTop: "1px solid #27272a", display: "flex", flexDirection: "column", gap: "8px" }}>
        <div style={{ display: "flex", gap: "8px" }}>
          <textarea aria-label="Prompt" value={prompt} onChange={(event) => onPromptChange(event.target.value)} placeholder="Describe your goal to the orchestrator…" rows={3} style={{ flex: 1, resize: "vertical", background: "#09090b", border: "1px solid #3f3f46", borderRadius: "6px", padding: "10px 12px", color: "#fafafa", font: "inherit", fontSize: "13px", userSelect: "text" }} />
          <button type="submit" disabled aria-describedby="orchestrator-unavailable" style={{ alignSelf: "flex-end", display: "flex", alignItems: "center", gap: "6px", padding: "8px 12px", border: 0, borderRadius: "6px", background: "#3f3f46", color: "#a1a1aa", cursor: "not-allowed" }}>Send <Send size={14} /></button>
        </div>
        <span id="orchestrator-unavailable" style={{ fontSize: "12px", color: "#a1a1aa" }}>Orchestrator execution isn't available yet. Your text will remain here.</span>
      </form>
    </main>
  );
};
