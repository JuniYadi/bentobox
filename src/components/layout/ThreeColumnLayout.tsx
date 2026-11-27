import React from "react";
import { SidebarLeft } from "./SidebarLeft";
import { ContentArea } from "./ContentArea";
import { SidebarRight } from "./SidebarRight";
import { Session, SessionMode } from "../../features/session/types";
import { GhIssue } from "../../features/github/api";

/** @adr ADR-0009.D1 */
export interface ThreeColumnLayoutProps {
  sessions: Session[];
  activeSession: Session;
  onSelectSession: (id: string) => void;
  onCreateSession: () => void;
  onModeChange: (mode: SessionMode) => void;
  onToggleWorktree: () => void;
  onDispatchTask: (prompt: string, optInWorktree: boolean) => void;
  onSelectGitHubIssue?: (issue: GhIssue) => void;
  leftCollapsed: boolean;
  rightCollapsed: boolean;
  onToggleLeftCollapse: () => void;
  onToggleRightCollapse: () => void;
}

/** @adr ADR-0009.D1 */
export const ThreeColumnLayout: React.FC<ThreeColumnLayoutProps> = ({
  sessions,
  activeSession,
  onSelectSession,
  onCreateSession,
  onModeChange,
  onToggleWorktree,
  onDispatchTask,
  onSelectGitHubIssue,
  leftCollapsed,
  rightCollapsed,
  onToggleLeftCollapse,
  onToggleRightCollapse,
}) => {
  return (
    <div
      style={{
        display: "flex",
        width: "100vw",
        height: "100vh",
        overflow: "hidden",
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
        background: "#0c0c0c",
        color: "#eee",
        userSelect: "none",
      }}
    >
      <SidebarLeft
        sessions={sessions}
        activeSessionId={activeSession.id}
        onSelectSession={onSelectSession}
        onCreateSession={onCreateSession}
        onSelectGitHubIssue={onSelectGitHubIssue}
        collapsed={leftCollapsed}
        onToggleCollapse={onToggleLeftCollapse}
      />
      <ContentArea
        session={activeSession}
        onModeChange={onModeChange}
        onToggleWorktree={onToggleWorktree}
        onDispatchTask={onDispatchTask}
      />
      <SidebarRight
        subAgents={activeSession.subAgents}
        collapsed={rightCollapsed}
        onToggleCollapse={onToggleRightCollapse}
      />
    </div>
  );
};
