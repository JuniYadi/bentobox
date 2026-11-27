// @adr ADR-0002.D1
use crate::{agent::CapabilityRegistry, db::Store};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashSet};
use tauri::{AppHandle, Manager};

const USAGE_EVENT: &str = "session_usage";
const PAGE_SIZE: u32 = 500;

/// An observed incremental usage measurement, not a provider allowance.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct UsageAmounts {
    pub report_id: String,
    pub source: String,
    pub timestamp: String,
    pub units: String,
    pub support_status: String,
    pub provenance: String,
    pub input_tokens: u64,
    pub output_tokens: u64,
    /// Cost reported by the agent, in the stated currency; absent when not reported.
    pub cost: Option<ReportedCost>,
}

impl UsageAmounts {
    fn validate(&self) -> Result<(), String> {
        if self.report_id.trim().is_empty() || self.source.trim().is_empty()
            || self.timestamp.trim().is_empty() || self.provenance.trim().is_empty()
            || self.units != "tokens" || self.support_status != "reported" {
            return Err("usage requires a report ID, source, timestamp, provenance, token units and reported support status".into());
        }
        if let Some(cost) = &self.cost {
            if !cost.amount.is_finite() || cost.amount < 0.0 || cost.currency.trim().is_empty() {
                return Err("reported cost must be finite, nonnegative, and have a currency".into());
            }
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ReportedCost {
    pub amount: f64,
    pub currency: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct UsageTotals {
    pub input_tokens: u64,
    pub output_tokens: u64,
    /// Costs are grouped by currency and only include explicitly reported values.
    pub costs: BTreeMap<String, f64>,
}

impl UsageTotals {
    fn empty() -> Self {
        Self { input_tokens: 0, output_tokens: 0, costs: BTreeMap::new() }
    }

    fn add(&mut self, usage: &UsageAmounts) -> Result<(), String> {
        self.input_tokens = self.input_tokens.checked_add(usage.input_tokens).ok_or("input token total overflow")?;
        self.output_tokens = self.output_tokens.checked_add(usage.output_tokens).ok_or("output token total overflow")?;
        if let Some(cost) = &usage.cost {
            let total = self.costs.entry(cost.currency.clone()).or_default();
            *total += cost.amount;
            if !total.is_finite() { return Err("cost total overflow".into()); }
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct SessionUsage {
    pub session_id: i64,
    pub total: UsageTotals,
    pub tasks: BTreeMap<i64, UsageTotals>,
    pub skipped_events: u64,
    pub reported_events: u64,
}

/// Provider-reported quota values are independent of locally observed usage.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum QuotaValue {
    Available { value: f64 },
    Unavailable { reason: String },
    Unknown { reason: String },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AccountQuota {
    pub harness_id: String,
    pub limit: QuotaValue,
    pub remaining: QuotaValue,
}

fn record(store: &Store, session_id: i64, task_id: Option<i64>, usage: UsageAmounts) -> Result<i64, String> {
    usage.validate()?;
    let payload = serde_json::to_value(usage).map_err(|e| e.to_string())?;
    store.append_event(session_id, task_id, USAGE_EVENT, payload)
}

fn aggregate(store: &Store, session_id: i64) -> Result<SessionUsage, String> {
    let mut result = SessionUsage { session_id, total: UsageTotals::empty(), tasks: BTreeMap::new(), skipped_events: 0, reported_events: 0 };
    let mut after_id = 0;
    let mut report_ids = HashSet::new();
    loop {
        let events = store.events(session_id, after_id, PAGE_SIZE)?;
        if events.is_empty() { break; }
        let count = events.len();
        for event in events {
            after_id = event.id;
            if event.kind != USAGE_EVENT { continue; }
            let usage: UsageAmounts = match serde_json::from_value(event.payload) {
                Ok(usage) => usage,
                Err(_) => { result.skipped_events += 1; continue; }
            };
            if usage.validate().is_err() {
                result.skipped_events += 1;
                continue;
            }
            if report_ids.contains(&usage.report_id) { continue; }
            result.total.add(&usage)?;
            if let Some(task_id) = event.task_id {
                result.tasks.entry(task_id).or_insert_with(UsageTotals::empty).add(&usage)?;
            }
            report_ids.insert(usage.report_id);
            result.reported_events += 1;
        }
        if count < PAGE_SIZE as usize { break; }
    }
    Ok(result)
}

fn quota(harness_id: String) -> Result<AccountQuota, String> {
    if CapabilityRegistry::get(&harness_id).is_none() {
        return Err(format!("unknown harness: {harness_id}"));
    }
    let unavailable = || QuotaValue::Unavailable { reason: "No authoritative provider quota connector is configured".into() };
    Ok(AccountQuota { harness_id, limit: unavailable(), remaining: unavailable() })
}

#[tauri::command]
pub async fn record_session_usage(app: AppHandle, session_id: i64, task_id: Option<i64>, usage: UsageAmounts) -> Result<i64, String> {
    tauri::async_runtime::spawn_blocking(move || record(&app.state::<Store>(), session_id, task_id, usage)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn get_session_usage(app: AppHandle, session_id: i64) -> Result<SessionUsage, String> {
    tauri::async_runtime::spawn_blocking(move || aggregate(&app.state::<Store>(), session_id)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn get_account_quota(harness_id: String) -> Result<AccountQuota, String> {
    quota(harness_id)
}

#[cfg(test)]
#[path = "usage_test.rs"]
mod tests;
