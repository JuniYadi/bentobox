import { useEffect, useState } from "react";
import { ThreeColumnLayout } from "./components/layout/ThreeColumnLayout";
import { createSession, listSessions, setSessionWorktree } from "./features/session/api";
import { Session } from "./features/session/types";
import { GhIssue } from "./features/github/api";
import "./App.css";

/** @adr ADR-0009.D1 */
export default function App() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<number | null>(null);
  const [backendError, setBackendError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [prompt, setPrompt] = useState("");
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const items = await listSessions();
        if (cancelled) return;
        setSessions(items.map((item) => ({ ...item, subAgents: [] })));
        setActiveSessionId(items[0]?.id ?? null);
      } catch {
        if (!cancelled) setBackendError("Backend isn't available.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const activeSession = sessions.find((session) => session.id === activeSessionId) ?? null;

  const handleCreateSession = async () => {
    const workspacePath = window.prompt("Workspace path", activeSession?.workspacePath ?? "")?.trim();
    if (!workspacePath) return;
    const title = window.prompt("Session title", "New session")?.trim();
    if (!title) return;
    try {
      const session = await createSession(title, workspacePath, true);
      setSessions((previous) => [...previous, { ...session, subAgents: [] }]);
      setActiveSessionId(session.id);
      setBackendError(null);
    } catch (error) {
      setBackendError(`Could not create session: ${String(error)}`);
    }
  };

  const handleToggleWorktree = async () => {
    if (!activeSession) return;
    try {
      const updated = await setSessionWorktree(activeSession.id, !activeSession.optInWorktree);
      setSessions((previous) => previous.map((session) => session.id === updated.id ? { ...session, ...updated } : session));
      setBackendError(null);
    } catch (error) {
      setBackendError(`Could not update worktree setting: ${String(error)}`);
    }
  };

  const handleSelectGitHubIssue = (issue: GhIssue) => {
    setPrompt(`Investigate and resolve GitHub Issue #${issue.number}: ${issue.title}`);
  };

  return (
    <ThreeColumnLayout
      sessions={sessions}
      activeSession={activeSession}
      onSelectSession={setActiveSessionId}
      onCreateSession={handleCreateSession}
      onToggleWorktree={handleToggleWorktree}
      onSelectGitHubIssue={handleSelectGitHubIssue}
      prompt={prompt}
      onPromptChange={setPrompt}
      emptyMessage={loading ? "Loading sessions…" : backendError ?? "No sessions yet. Create a session to get started."}
      error={activeSession ? backendError : null}
      leftCollapsed={leftCollapsed}
      rightCollapsed={rightCollapsed}
      onToggleLeftCollapse={() => setLeftCollapsed((c) => !c)}
      onToggleRightCollapse={() => setRightCollapsed((c) => !c)}
    />
  );
}
