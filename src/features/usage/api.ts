import { invoke } from "@tauri-apps/api/core";

/** @adr ADR-0002.D1 */
export interface ReportedCost {
  amount: number;
  currency: string;
}

/** @adr ADR-0002.D1 */
export interface UsageAmounts {
  report_id: string;
  source: string;
  timestamp: string;
  units: "tokens";
  support_status: "reported";
  provenance: string;
  input_tokens: number;
  output_tokens: number;
  cost: ReportedCost | null;
}

/** @adr ADR-0002.D1 */
export interface UsageTotals {
  input_tokens: number;
  output_tokens: number;
  costs: Record<string, number>;
}

/** @adr ADR-0002.D1 */
export interface SessionUsage {
  session_id: number;
  total: UsageTotals;
  tasks: Record<number, UsageTotals>;
  skipped_events: number;
  reported_events: number;
}

/** @adr ADR-0002.D1 */
export type QuotaValue =
  | { status: "available"; value: number }
  | { status: "unavailable"; reason: string }
  | { status: "unknown"; reason: string };

/** @adr ADR-0002.D1 */
export interface AccountQuota {
  harness_id: string;
  limit: QuotaValue;
  remaining: QuotaValue;
}

/** @adr ADR-0002.D1 */
export function recordSessionUsage(sessionId: number, taskId: number | null, usage: UsageAmounts): Promise<number> {
  return invoke<number>("record_session_usage", { sessionId, taskId, usage });
}

/** @adr ADR-0002.D1 */
export function getSessionUsage(sessionId: number): Promise<SessionUsage> {
  return invoke<SessionUsage>("get_session_usage", { sessionId });
}

/** @adr ADR-0002.D1 */
export function getAccountQuota(harnessId: string): Promise<AccountQuota> {
  return invoke<AccountQuota>("get_account_quota", { harnessId });
}
