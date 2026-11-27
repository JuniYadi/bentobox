import { useState } from "react";
import { ThreeColumnLayout } from "./components/layout/ThreeColumnLayout";
import { Session, SessionMode, DEFAULT_SESSION_MODE } from "./features/session/types";
import { GhIssue } from "./features/github/api";
import "./App.css";

const INITIAL_SESSION: Session = {
  id: "sess-1",
  title: "BentoBox Setup & Orchestration",
  activeMode: DEFAULT_SESSION_MODE,
  workspacePath: "bentobox",
  optInWorktree: true,
  subAgents: [
    {
      id: "sub-1",
      title: "Scaffold Rust GitHub bridge",
      harness: "omp (Claude Code)",
      status: "completed",
      worktreeBranch: "task/gh-cli-bridge",
      handoffSummary: "Verified gh_check_status and gh_list_issues commands.",
    },
  ],
};

/** @adr ADR-0009.D1 */
export default function App() {
  const [sessions, setSessions] = useState<Session[]>([INITIAL_SESSION]);
  const [activeSessionId, setActiveSessionId] = useState<string>("sess-1");
  const [leftCollapsed, setLeftCollapsed] = useState<boolean>(false);
  const [rightCollapsed, setRightCollapsed] = useState<boolean>(false);

  const activeSession =
    sessions.find((s) => s.id === activeSessionId) || sessions[0];

  const handleSelectSession = (id: string) => {
    setActiveSessionId(id);
  };

  const handleCreateSession = () => {
    const newId = `sess-${Date.now()}`;
    const newSession: Session = {
      id: newId,
      title: `Session ${sessions.length + 1}`,
      activeMode: "orchestrator",
      workspacePath: "bentobox",
      optInWorktree: true,
      subAgents: [],
    };
    setSessions([...sessions, newSession]);
    setActiveSessionId(newId);
  };

  const handleModeChange = (mode: SessionMode) => {
    setSessions((prev) =>
      prev.map((s) => (s.id === activeSession.id ? { ...s, activeMode: mode } : s))
    );
  };

  const handleToggleWorktree = () => {
    setSessions((prev) =>
      prev.map((s) =>
        s.id === activeSession.id ? { ...s, optInWorktree: !s.optInWorktree } : s
      )
    );
  };

  const handleDispatchTask = (prompt: string, optInWorktree: boolean) => {
    const newSubAgent = {
      id: `task-${Date.now()}`,
      title: prompt,
      harness: activeSession.activeMode === "orchestrator" ? "ACP / omp" : "native build",
      status: "running" as const,
      worktreeBranch: optInWorktree ? `task/task-${Date.now().toString().slice(-4)}` : undefined,
      handoffSummary: `Dispatched with pointed context envelope in ${activeSession.activeMode} mode.`,
    };

    setSessions((prev) =>
      prev.map((s) =>
        s.id === activeSession.id
          ? { ...s, subAgents: [newSubAgent, ...s.subAgents] }
          : s
      )
    );
  };

  const handleSelectGitHubIssue = (issue: GhIssue) => {
    handleDispatchTask(
      `Investigate and resolve GitHub Issue #${issue.number}: ${issue.title}`,
      activeSession.optInWorktree
    );
  };

  return (
    <ThreeColumnLayout
      sessions={sessions}
      activeSession={activeSession}
      onSelectSession={handleSelectSession}
      onCreateSession={handleCreateSession}
      onModeChange={handleModeChange}
      onToggleWorktree={handleToggleWorktree}
      onDispatchTask={handleDispatchTask}
      onSelectGitHubIssue={handleSelectGitHubIssue}
      leftCollapsed={leftCollapsed}
      rightCollapsed={rightCollapsed}
      onToggleLeftCollapse={() => setLeftCollapsed((c) => !c)}
      onToggleRightCollapse={() => setRightCollapsed((c) => !c)}
    />
  );
}
