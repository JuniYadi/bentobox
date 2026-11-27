import React, { useEffect, useState } from "react";
import {
  ChevronRight,
  Cpu,
  Layers,
  FileCheck,
  Activity,
} from "lucide-react";
import { SubAgentTask } from "../../features/session/types";
import { listDetectedHarnesses } from "../../features/agent/api";
import { AccountQuota, getAccountQuota, getSessionUsage, QuotaValue, SessionUsage } from "../../features/usage/api";

function quotaText(value: QuotaValue): string {
  return value.status === "available" ? String(value.value) : `${value.status === "unknown" ? "Unknown" : "Unavailable"}: ${value.reason}`;
}

/** @adr ADR-0009.D1 */
export interface SidebarRightProps {
  sessionId: number | null;
  subAgents: SubAgentTask[];
  collapsed: boolean;
  onToggleCollapse: () => void;
}

/** @adr ADR-0009.D1 */
export const SidebarRight: React.FC<SidebarRightProps> = ({
  sessionId,
  subAgents,
  collapsed,
  onToggleCollapse,
}) => {
  const [usage, setUsage] = useState<SessionUsage | null>(null);
  const [usageUnavailable, setUsageUnavailable] = useState(false);
  const [quotas, setQuotas] = useState<AccountQuota[] | null>(null);
  const [quotaError, setQuotaError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setUsage(null);
    setUsageUnavailable(false);
    if (sessionId != null) {
      (async () => {
        try {
          const result = await getSessionUsage(sessionId);
          if (!cancelled) setUsage(result);
        } catch {
          if (!cancelled) setUsageUnavailable(true);
        }
      })();
    }
    return () => { cancelled = true; };
  }, [sessionId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const harnesses = await listDetectedHarnesses();
        const results = await Promise.all(harnesses.map(async ({ capabilities }) => {
          try {
            return await getAccountQuota(capabilities.harness_id);
          } catch {
            const unavailable = { status: "unavailable" as const, reason: "Could not load account quota" };
            return { harness_id: capabilities.harness_id, limit: unavailable, remaining: unavailable };
          }
        }));
        if (!cancelled) setQuotas(results);
      } catch {
        if (!cancelled) setQuotaError("Could not load detected harnesses");
      }
    })();
    return () => { cancelled = true; };
  }, []);

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
          <div>No handoff available.</div>
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
        <div style={{ fontSize: "11px", color: "#ddd" }}>
          <span style={{ color: "#888" }}>Session usage: </span>
          {sessionId == null ? "Unavailable: No session selected" : usageUnavailable ? "Unavailable" : usage?.session_id !== sessionId ? "Loading…" : usage.reported_events === 0 ? "No usage recorded" : `${usage.total.input_tokens.toLocaleString()} input / ${usage.total.output_tokens.toLocaleString()} output tokens`}
        </div>
        {usage?.session_id === sessionId && usage.skipped_events > 0 && <div role="status" style={{ fontSize: "11px", color: "#a1a1aa" }}>Warning: {usage.skipped_events} malformed usage {usage.skipped_events === 1 ? "report was" : "reports were"} skipped.</div>}
        <div style={{ fontSize: "11px", color: "#ddd" }}>
          <span style={{ color: "#888" }}>Account quota: </span>
          {quotaError ? `Unavailable: ${quotaError}` : quotas == null ? "Loading…" : quotas.length === 0 ? "Unavailable: No detected harnesses" : quotas.map((quota) => <div key={quota.harness_id}>{quota.harness_id}: limit {quotaText(quota.limit)}; remaining {quotaText(quota.remaining)}</div>)}
        </div>
        <span style={{ fontSize: "9px", color: "#888" }}>Session usage is separate from subscription quota.</span>
      </div>
    </aside>
  );
};
