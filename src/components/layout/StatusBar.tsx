import { useEffect, useState } from "react";
import { getAuthStatus, type AuthStatus } from "../../features/auth/api";
import { listDetectedHarnesses, type DetectedHarness } from "../../features/agent/api";
import { checkGitHubStatus, type GhStatus } from "../../features/github/api";
import { getAccountQuota, getSessionUsage, type AccountQuota, type SessionUsage } from "../../features/usage/api";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../ui/tooltip";

/** @adr ADR-0016.D2 */
export interface StatusBarProps {
  selectedSessionId?: number | null;
}

type HarnessState = { harness: DetectedHarness; auth: AuthStatus | null; reason: string };
type QuotaState = { harnessId: string; quota: AccountQuota | null; reason: string };

/** @adr ADR-0016.D2 */
export function QuotaIndicators({ states }: { states: QuotaState[] }) {
  if (states.length === 0) return <Tooltip><TooltipTrigger asChild><span className="shrink-0">quota Unavailable</span></TooltipTrigger><TooltipContent>No harness quota available</TooltipContent></Tooltip>;

  const describe = (state: QuotaState) => {
    const remaining = state.quota?.remaining;
    if (!remaining) return { status: "error", text: "quota Unavailable", detail: state.reason };
    if (remaining.status === "available") return { status: remaining.status, text: `quota ${remaining.value} remaining`, detail: "Account quota" };
    return { status: remaining.status, text: "quota Unavailable", detail: remaining.reason };
  };
  const descriptions = states.map(describe);
  const first = descriptions[0];
  const identical = descriptions.every((item) => item.status === first.status && item.text === first.text && item.detail === first.detail);
  const shown = identical ? states.slice(0, 1) : states;
  return <>{shown.map((state, index) => {
    const { text, detail } = descriptions[index];
    return <Tooltip key={state.harnessId}><TooltipTrigger asChild><span className="shrink-0" title={detail}>{identical ? text : `${state.harnessId} ${text}`}</span></TooltipTrigger><TooltipContent>{detail}</TooltipContent></Tooltip>;
  })}</>;
}

/** @adr ADR-0016.D2 */
export function StatusBar({ selectedSessionId }: StatusBarProps) {
  const [harnesses, setHarnesses] = useState<HarnessState[]>([]);
  const [usage, setUsage] = useState<SessionUsage | null>(null);
  const [usageReason, setUsageReason] = useState("");
  const [quotaStates, setQuotaStates] = useState<QuotaState[]>([]);
  const [github, setGithub] = useState<GhStatus | null>(null);
  const [backendUnavailable, setBackendUnavailable] = useState(false);

  useEffect(() => {
    let current = true;
    void (async () => {
      try {
        const detected = await listDetectedHarnesses();
        if (!current) return;
        const states = await Promise.all(detected.map(async (harness): Promise<HarnessState> => {
          try { return { harness, auth: await getAuthStatus(harness.capabilities.harness_id), reason: "" }; }
          catch (error) { return { harness, auth: null, reason: error instanceof Error ? error.message : String(error) }; }
        }));
        const quotas = await Promise.all(detected.map(async (harness): Promise<QuotaState> => {
          try { return { harnessId: harness.capabilities.harness_id, quota: await getAccountQuota(harness.capabilities.harness_id), reason: "" }; }
          catch (error) { return { harnessId: harness.capabilities.harness_id, quota: null, reason: error instanceof Error ? error.message : String(error) }; }
        }));
        const gh = await checkGitHubStatus();
        if (current) { setHarnesses(states); setQuotaStates(quotas); setGithub(gh); }
      } catch {
        if (current) setBackendUnavailable(true);
      }
    })();
    return () => { current = false; };
  }, []);

  useEffect(() => {
    let current = true;
    setUsage(null);
    if (selectedSessionId == null) { setUsageReason("No session selected"); return () => { current = false; }; }
    void getSessionUsage(selectedSessionId).then((result) => {
      if (current) { setUsage(result); setUsageReason(""); }
    }).catch((error: unknown) => {
      if (current) setUsageReason(error instanceof Error ? error.message : String(error));
    });
    return () => { current = false; };
  }, [selectedSessionId]);

  if (backendUnavailable) return <footer data-region="status" className="flex h-7 shrink-0 items-center border-t px-3 text-[11px] text-muted-foreground">Backend unavailable</footer>;


  return <TooltipProvider><footer data-region="status" className="flex h-7 shrink-0 items-center gap-4 overflow-hidden border-t px-3 text-[11px] text-muted-foreground">
    {harnesses.length === 0 ? <Tooltip><TooltipTrigger asChild><span className="truncate">Harnesses unavailable</span></TooltipTrigger><TooltipContent>No harnesses detected</TooltipContent></Tooltip> : harnesses.map(({ harness, auth, reason }) => {
      const state = auth?.state;
      const dot = state === "authenticated" ? "bg-success" : state === "unauthenticated" ? "bg-warning" : "bg-muted-foreground";
      const message = reason || (state === "authenticated" ? "Signed in" : state === "unauthenticated" ? "Not signed in" : "Authentication status unknown");
      return <Tooltip key={harness.capabilities.harness_id}><TooltipTrigger asChild><span className="flex shrink-0 items-center gap-1.5"><span className={`size-1.5 rounded-full ${dot}`} />{harness.capabilities.display_name}</span></TooltipTrigger><TooltipContent>{message}</TooltipContent></Tooltip>;
    })}
    <span className="flex-1" />
    <Tooltip><TooltipTrigger asChild><span className="shrink-0">{selectedSessionId == null ? "No session" : usage ? `${usage.total.input_tokens + usage.total.output_tokens} tokens` : "Usage Unavailable"}</span></TooltipTrigger><TooltipContent>{selectedSessionId == null ? "No session selected" : usageReason || "Session usage"}</TooltipContent></Tooltip>
    <QuotaIndicators states={quotaStates} />
    <Tooltip><TooltipTrigger asChild><span className="shrink-0">{github?.authenticated ? `gh @${github.username ?? "signed in"}` : "gh Unavailable"}</span></TooltipTrigger><TooltipContent>{github?.message ?? "GitHub status unavailable"}</TooltipContent></Tooltip>
  </footer></TooltipProvider>;
}
