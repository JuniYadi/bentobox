import React from "react";
import { SidebarLeft } from "./SidebarLeft";
import { ContentArea } from "./ContentArea";
import { SidebarRight } from "./SidebarRight";
import { Session } from "../../features/session/types";
import { GhIssue } from "../../features/github/api";

/** @adr ADR-0009.D1 */
export interface ThreeColumnLayoutProps {
  sessions: Session[];
  activeSession: Session | null;
  onSelectSession: (id: number) => void;
  onCreateSession: () => void;
  onToggleWorktree: () => void;
  onSelectGitHubIssue?: (issue: GhIssue) => void;
  prompt: string;
  onPromptChange: (prompt: string) => void;
  emptyMessage: string;
  error: string | null;
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
  onToggleWorktree,
  onSelectGitHubIssue,
  prompt,
  onPromptChange,
  emptyMessage,
  error,
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
        activeSessionId={activeSession?.id ?? null}
        onSelectSession={onSelectSession}
        onCreateSession={onCreateSession}
        onSelectGitHubIssue={onSelectGitHubIssue}
        collapsed={leftCollapsed}
        onToggleCollapse={onToggleLeftCollapse}
      />
      <ContentArea
        session={activeSession}
        onToggleWorktree={onToggleWorktree}
        onCreateSession={onCreateSession}
        prompt={prompt}
        onPromptChange={onPromptChange}
        emptyMessage={emptyMessage}
        error={error}
      />
      <SidebarRight
        sessionId={activeSession?.id ?? null}
        subAgents={activeSession?.subAgents ?? []}
        collapsed={rightCollapsed}
        onToggleCollapse={onToggleRightCollapse}
      />
    </div>
  );
};
