import React from "react";
import { FolderGit2, Plus, MessageSquare, ChevronLeft } from "lucide-react";
import { Session } from "../../features/session/types";
import { GitHubPanel } from "../../features/github/GitHubPanel";
import { GhIssue } from "../../features/github/api";

/** @adr ADR-0009.D1 */
export interface SidebarLeftProps {
  sessions: Session[];
  activeSessionId: number | null;
  onSelectSession: (id: number) => void;
  onCreateSession: () => void;
  onSelectGitHubIssue?: (issue: GhIssue) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
}

/** @adr ADR-0009.D1 */
export const SidebarLeft: React.FC<SidebarLeftProps> = ({
  sessions,
  activeSessionId,
  onSelectSession,
  onCreateSession,
  onSelectGitHubIssue,
  collapsed,
  onToggleCollapse,
}) => {
  if (collapsed) {
    return (
      <div
        style={{
          width: "48px",
          background: "#121212",
          borderRight: "1px solid #222",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          padding: "12px 0",
          gap: "12px",
        }}
      >
        <button
          onClick={onToggleCollapse}
          style={{ background: "transparent", border: "none", color: "#888", cursor: "pointer" }}
          title="Expand left sidebar"
        >
          <FolderGit2 size={18} />
        </button>
        <button
          onClick={onCreateSession}
          style={{ background: "#2563eb", border: "none", color: "#fff", borderRadius: "4px", width: "28px", height: "28px", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
          title="New session"
        >
          <Plus size={16} />
        </button>
      </div>
    );
  }

  return (
    <aside
      style={{
        width: "280px",
        background: "#121212",
        borderRight: "1px solid #222",
        display: "flex",
        flexDirection: "column",
        height: "100%",
        padding: "12px",
        boxSizing: "border-box",
        gap: "16px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <FolderGit2 size={16} color="#60a5fa" />
          <span style={{ fontWeight: 700, fontSize: "13px", color: "#eee" }}>bentobox</span>
        </div>
        <button
          onClick={onToggleCollapse}
          style={{ background: "transparent", border: "none", color: "#666", cursor: "pointer" }}
          title="Collapse sidebar"
        >
          <ChevronLeft size={16} />
        </button>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontSize: "11px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "#888" }}>
            Sessions
          </span>
          <button
            onClick={onCreateSession}
            style={{
              background: "#222",
              border: "1px solid #333",
              color: "#ddd",
              borderRadius: "4px",
              padding: "2px 6px",
              fontSize: "11px",
              display: "flex",
              alignItems: "center",
              gap: "4px",
              cursor: "pointer",
            }}
          >
            <Plus size={12} /> New
          </button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "4px", maxHeight: "140px", overflowY: "auto" }}>
          {sessions.map((session) => (
            <button
              key={session.id}
              onClick={() => onSelectSession(session.id)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                padding: "6px 8px",
                background: session.id === activeSessionId ? "#1e293b" : "transparent",
                border: session.id === activeSessionId ? "1px solid #3b82f6" : "1px solid transparent",
                borderRadius: "4px",
                color: session.id === activeSessionId ? "#fff" : "#aaa",
                fontSize: "12px",
                textAlign: "left",
                cursor: "pointer",
              }}
            >
              <MessageSquare size={13} />
              <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {session.title}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto" }}>
        <GitHubPanel onSelectIssue={onSelectGitHubIssue} />
      </div>

      <div style={{ borderTop: "1px solid #222", paddingTop: "8px", fontSize: "11px", color: "#888" }}>
        Harness status unavailable.
      </div>
    </aside>
  );
};
