import React from "react";
import {
  ChevronRight,
  Cpu,
  Layers,
  FileCheck,
  Activity,
  AlertCircle,
} from "lucide-react";
import { SubAgentTask } from "../../features/session/types";

/** @adr ADR-0009.D1 */
export interface SidebarRightProps {
  subAgents: SubAgentTask[];
  collapsed: boolean;
  onToggleCollapse: () => void;
}

/** @adr ADR-0009.D1 */
export const SidebarRight: React.FC<SidebarRightProps> = ({
  subAgents,
  collapsed,
  onToggleCollapse,
}) => {
  if (collapsed) {
    return (
      <div
        style={{
          width: "48px",
          background: "#121212",
          borderLeft: "1px solid #222",
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
          title="Expand right sidebar"
        >
          <Layers size={18} />
        </button>
      </div>
    );
  }

  return (
    <aside
      style={{
        width: "300px",
        background: "#121212",
        borderLeft: "1px solid #222",
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
          <Layers size={16} color="#a855f7" />
          <span style={{ fontWeight: 700, fontSize: "13px", color: "#eee" }}>
            Delegation & Inspector
          </span>
        </div>
        <button
          onClick={onToggleCollapse}
          style={{ background: "transparent", border: "none", color: "#666", cursor: "pointer" }}
          title="Collapse right sidebar"
        >
          <ChevronRight size={16} />
        </button>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "6px", color: "#888", fontSize: "11px", fontWeight: 700, textTransform: "uppercase" }}>
          <Cpu size={12} />
          <span>Active Sub-Agents ({subAgents.length})</span>
        </div>
        {subAgents.length === 0 ? (
          <div style={{ fontSize: "11px", color: "#666", padding: "8px 0" }}>
            No sub-agents executing.
          </div>
        ) : (
          subAgents.map((agent) => (
            <div
              key={agent.id}
              style={{
                padding: "8px",
                background: "#181818",
                border: "1px solid #282828",
                borderRadius: "4px",
                fontSize: "11px",
                display: "flex",
                flexDirection: "column",
                gap: "4px",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontWeight: 600, color: "#eee" }}>{agent.title}</span>
                <span style={{ color: "#38bdf8" }}>{agent.harness}</span>
              </div>
              {agent.worktreeBranch && (
                <div style={{ fontSize: "10px", color: "#888" }}>
                  Worktree: {agent.worktreeBranch}
                </div>
              )}
            </div>
          ))
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "6px", color: "#888", fontSize: "11px", fontWeight: 700, textTransform: "uppercase" }}>
          <FileCheck size={12} />
          <span>Pointed Prompt Handoff</span>
        </div>
        <div
          style={{
            padding: "8px",
            background: "#181818",
            border: "1px solid #282828",
            borderRadius: "4px",
            fontSize: "11px",
            color: "#aaa",
            lineHeight: "1.4",
          }}
        >
          <div style={{ color: "#888", marginBottom: "4px" }}>Active Envelope Schema:</div>
          <div>• Goal & Acceptance Tests</div>
          <div>• Pointed File Ranges</div>
          <div>• Sanitized Credentials</div>
        </div>
      </div>

      <div style={{ flex: 1 }} />

      <div
        style={{
          borderTop: "1px solid #222",
          paddingTop: "10px",
          display: "flex",
          flexDirection: "column",
          gap: "8px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "6px", color: "#888", fontSize: "11px", fontWeight: 700, textTransform: "uppercase" }}>
          <Activity size={12} />
          <span>Usage & Telemetry (ADR-0002)</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px" }}>
          <span style={{ color: "#888" }}>Session Context:</span>
          <span style={{ color: "#ddd", fontWeight: 600 }}>1,840 tokens</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", alignItems: "center" }}>
          <span style={{ color: "#888" }}>Account Quota:</span>
          <span
            style={{
              color: "#fbbf24",
              background: "#2e2105",
              padding: "2px 6px",
              borderRadius: "3px",
              fontSize: "10px",
              fontWeight: 700,
              display: "flex",
              alignItems: "center",
              gap: "4px",
            }}
          >
            <AlertCircle size={10} />
            Unavailable
          </span>
        </div>
        <span style={{ fontSize: "9px", color: "#555" }}>
          Context occupancy is separate from subscription quota. No unverified estimates.
        </span>
      </div>
    </aside>
  );
};
