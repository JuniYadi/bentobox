import React, { useEffect, useState } from "react";
import {
  checkGitHubStatus,
  listGitHubIssues,
  listGitHubPullRequests,
  openGitHubUrl,
  GhStatus,
  GhIssue,
  GhPullRequest,
} from "./api";
import { ExternalLink, GitPullRequest, CircleDot, AlertTriangle, CheckCircle2, RefreshCw } from "lucide-react";

/** @adr ADR-0008.D1 */
export interface GitHubPanelProps {
  onSelectIssue?: (issue: GhIssue) => void;
}

/** @adr ADR-0008.D1 */
export const GitHubPanel: React.FC<GitHubPanelProps> = ({ onSelectIssue }) => {
  const [status, setStatus] = useState<GhStatus | null>(null);
  const [tab, setTab] = useState<"issues" | "prs">("issues");
  const [issues, setIssues] = useState<GhIssue[]>([]);
  const [prs, setPrs] = useState<GhPullRequest[]>([]);
  const [loading, setLoading] = useState(false);

  const loadData = async () => {
    setLoading(true);
    const s = await checkGitHubStatus();
    setStatus(s);
    if (s.authenticated) {
      const [issueList, prList] = await Promise.all([
        listGitHubIssues(),
        listGitHubPullRequests(),
      ]);
      setIssues(issueList);
      setPrs(prList);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadData();
  }, []);

  return (
    <div className="github-panel" style={{ display: "flex", flexDirection: "column", height: "100%", gap: "8px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingBottom: "4px", borderBottom: "1px solid #333" }}>
        <span style={{ fontSize: "11px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "#888" }}>
          GitHub Integration
        </span>
        <button
          onClick={loadData}
          disabled={loading}
          style={{ background: "transparent", border: "none", color: "#aaa", cursor: "pointer", display: "flex", alignItems: "center" }}
          title="Refresh GitHub data"
        >
          <RefreshCw size={12} className={loading ? "spin" : ""} />
        </button>
      </div>

      {status && !status.authenticated ? (
        <div style={{ padding: "8px", background: "#2a1e17", border: "1px solid #633", borderRadius: "4px", fontSize: "11px", color: "#f88" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "6px", fontWeight: 600 }}>
            <AlertTriangle size={14} color="#f88" />
            <span>GitHub CLI Notice</span>
          </div>
          <p style={{ margin: "4px 0 0 0", color: "#ccc" }}>{status.message}</p>
        </div>
      ) : status?.authenticated ? (
        <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "11px", color: "#4ade80" }}>
          <CheckCircle2 size={12} />
          <span>Connected as @{status.username}</span>
        </div>
      ) : null}

      <div style={{ display: "flex", gap: "4px", borderBottom: "1px solid #282828" }}>
        <button
          onClick={() => setTab("issues")}
          style={{
            flex: 1,
            padding: "4px 8px",
            fontSize: "11px",
            background: tab === "issues" ? "#282828" : "transparent",
            color: tab === "issues" ? "#fff" : "#888",
            border: "none",
            borderRadius: "4px 4px 0 0",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "4px",
          }}
        >
          <CircleDot size={12} /> Issues ({issues.length})
        </button>
        <button
          onClick={() => setTab("prs")}
          style={{
            flex: 1,
            padding: "4px 8px",
            fontSize: "11px",
            background: tab === "prs" ? "#282828" : "transparent",
            color: tab === "prs" ? "#fff" : "#888",
            border: "none",
            borderRadius: "4px 4px 0 0",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "4px",
          }}
        >
          <GitPullRequest size={12} /> PRs ({prs.length})
        </button>
      </div>

      <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: "6px" }}>
        {tab === "issues" ? (
          issues.length === 0 ? (
            <div style={{ fontSize: "11px", color: "#666", padding: "8px 0" }}>
              {status?.authenticated ? "No open issues found." : "Unavailable until gh auth login is complete."}
            </div>
          ) : (
            issues.map((issue) => (
              <div
                key={issue.number}
                style={{
                  padding: "6px 8px",
                  background: "#181818",
                  border: "1px solid #282828",
                  borderRadius: "4px",
                  fontSize: "11px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "4px",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "6px" }}>
                  <span style={{ fontWeight: 600, color: "#ddd" }}>#{issue.number}</span>
                  <button
                    onClick={() => openGitHubUrl(issue.url)}
                    style={{ background: "transparent", border: "none", color: "#888", cursor: "pointer", padding: 0 }}
                    title="Open in browser"
                  >
                    <ExternalLink size={12} />
                  </button>
                </div>
                <div style={{ color: "#bbb", lineHeight: "1.3" }}>{issue.title}</div>
                {onSelectIssue && (
                  <button
                    onClick={() => onSelectIssue(issue)}
                    style={{
                      alignSelf: "flex-start",
                      fontSize: "10px",
                      padding: "2px 6px",
                      background: "#223",
                      border: "1px solid #335",
                      color: "#99f",
                      borderRadius: "3px",
                      cursor: "pointer",
                    }}
                  >
                    Add to Orchestrator
                  </button>
                )}
              </div>
            ))
          )
        ) : prs.length === 0 ? (
          <div style={{ fontSize: "11px", color: "#666", padding: "8px 0" }}>
            {status?.authenticated ? "No open pull requests found." : "Unavailable until gh auth login is complete."}
          </div>
        ) : (
          prs.map((pr) => (
            <div
              key={pr.number}
              style={{
                padding: "6px 8px",
                background: "#181818",
                border: "1px solid #282828",
                borderRadius: "4px",
                fontSize: "11px",
                display: "flex",
                flexDirection: "column",
                gap: "4px",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "6px" }}>
                <span style={{ fontWeight: 600, color: "#a855f7" }}>#{pr.number}</span>
                <button
                  onClick={() => openGitHubUrl(pr.url)}
                  style={{ background: "transparent", border: "none", color: "#888", cursor: "pointer", padding: 0 }}
                  title="Open in browser"
                >
                  <ExternalLink size={12} />
                </button>
              </div>
              <div style={{ color: "#bbb", lineHeight: "1.3" }}>{pr.title}</div>
              {pr.headRefName && (
                <div style={{ fontSize: "10px", color: "#888" }}>Branch: {pr.headRefName}</div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
};
