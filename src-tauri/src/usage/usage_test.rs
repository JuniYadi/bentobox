use super::*;
use serde_json::json;

fn temp_db() -> (std::path::PathBuf, std::path::PathBuf) {
    let dir = std::env::temp_dir().join(format!("bentobox-usage-{}-{}", std::process::id(), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
    std::fs::create_dir(&dir).unwrap();
    (dir.clone(), dir.join("usage.sqlite"))
}

fn usage(report_id: &str, input_tokens: u64, output_tokens: u64, cost: Option<ReportedCost>) -> UsageAmounts {
    UsageAmounts {
        report_id: report_id.into(), source: "agent".into(), timestamp: "2026-01-01T00:00:00Z".into(),
        units: "tokens".into(), support_status: "reported".into(), provenance: "agent event".into(),
        input_tokens, output_tokens, cost,
    }
}

// [ADR-0002.D1] Session totals and task totals aggregate observed usage independently.
#[test]
fn usage_aggregates_by_session_and_task() {
    let store = Store::open(":memory:").unwrap();
    let session = store.create_session("active").unwrap();
    let task_a = store.create_task(session, "a", "active").unwrap();
    let task_b = store.create_task(session, "b", "active").unwrap();
    record(&store, session, Some(task_a), usage("a", 10, 3, Some(ReportedCost { amount: 0.2, currency: "USD".into() }))).unwrap();
    record(&store, session, Some(task_b), usage("b", 5, 7, None)).unwrap();
    record(&store, session, None, usage("c", 2, 1, None)).unwrap();
    let usage = aggregate(&store, session).unwrap();
    assert_eq!((usage.total.input_tokens, usage.total.output_tokens), (17, 11));
    assert_eq!(usage.total.costs["USD"], 0.2);
    assert_eq!((usage.tasks[&task_a].input_tokens, usage.tasks[&task_a].output_tokens), (10, 3));
    assert_eq!((usage.tasks[&task_b].input_tokens, usage.tasks[&task_b].output_tokens), (5, 7));
    assert!(!usage.tasks.contains_key(&-1));
    assert_eq!(usage.reported_events, 3);
}

// [ADR-0002.D1] Persisted usage events retain token counters across Store reopen.
#[test]
fn usage_survives_persistence_round_trip_and_redaction() {
    let (dir, path) = temp_db();
    let store = Store::open(&path).unwrap();
    let session = store.create_session("active").unwrap();
    let task = store.create_task(session, "work", "active").unwrap();
    record(&store, session, Some(task), usage("round-trip", 41, 9, None)).unwrap();
    let event = store.events(session, 0, 10).unwrap().remove(0);
    assert_eq!(event.payload["input_tokens"], 41);
    assert_eq!(event.payload["output_tokens"], 9);
    assert_eq!(event.payload["report_id"], "round-trip");
    assert_eq!(event.payload["source"], "agent");
    assert_eq!(event.payload["timestamp"], "2026-01-01T00:00:00Z");
    assert_eq!(event.payload["units"], "tokens");
    assert_eq!(event.payload["support_status"], "reported");
    assert_eq!(event.payload["provenance"], "agent event");
    drop(store);
    let reopened = Store::open(&path).unwrap();
    let usage = aggregate(&reopened, session).unwrap();
    assert_eq!((usage.total.input_tokens, usage.total.output_tokens), (41, 9));
    drop(reopened);
    std::fs::remove_dir_all(dir).unwrap();
}

// [ADR-0002.D1] Account quota has no usage input and unavailable is not numeric zero.
#[test]
fn quota_unavailable_serializes_distinctly_from_zero() {
    let unavailable = serde_json::to_value(QuotaValue::Unavailable { reason: "not configured".into() }).unwrap();
    let zero = serde_json::to_value(QuotaValue::Available { value: 0.0 }).unwrap();
    assert_eq!(unavailable["status"], "unavailable");
    assert_eq!(unavailable["reason"], "not configured");
    assert_eq!(zero["status"], "available");
    assert_eq!(zero["value"], 0.0);
    let quota = quota("claude".into()).unwrap();
    assert!(matches!(quota.limit, QuotaValue::Unavailable { .. }));
    assert!(matches!(quota.remaining, QuotaValue::Unavailable { .. }));
}

// [ADR-0002.D1] Existing event redaction preserves counters while removing secrets.
#[test]
fn usage_event_redacts_credentials_without_changing_counts() {
    let store = Store::open(":memory:").unwrap();
    let session = store.create_session("active").unwrap();
    store.append_event(session, None, USAGE_EVENT, json!({"input_tokens": 3, "output_tokens": 4, "api_key": "secret-value"})).unwrap();
    let payload = store.events(session, 0, 1).unwrap().remove(0).payload;
    assert_eq!(payload["input_tokens"], 3);
    assert_eq!(payload["output_tokens"], 4);
    assert_eq!(payload["api_key"], "[REDACTED]");
}

// [ADR-0002.D1] Invalid usage reports are counted without hiding valid measurements.
#[test]
fn aggregate_skips_malformed_reports() {
    let store = Store::open(":memory:").unwrap();
    let session = store.create_session("active").unwrap();
    store.append_event(session, None, USAGE_EVENT, json!({"input_tokens": "bad"})).unwrap();
    let mut invalid = usage("same", 100, 100, None);
    invalid.units = "bytes".into();
    store.append_event(session, None, USAGE_EVENT, serde_json::to_value(invalid).unwrap()).unwrap();
    let mut missing_id = serde_json::to_value(usage("missing", 100, 100, None)).unwrap();
    missing_id.as_object_mut().unwrap().remove("report_id");
    store.append_event(session, None, USAGE_EVENT, missing_id).unwrap();
    let invalid_cost = usage("invalid-cost", 100, 100, Some(ReportedCost { amount: -1.0, currency: "USD".into() }));
    store.append_event(session, None, USAGE_EVENT, serde_json::to_value(invalid_cost).unwrap()).unwrap();
    record(&store, session, None, usage("same", 4, 5, None)).unwrap();
    let result = aggregate(&store, session).unwrap();
    assert_eq!(result.skipped_events, 4);
    assert_eq!(result.reported_events, 1);
    assert_eq!((result.total.input_tokens, result.total.output_tokens), (4, 5));
}

// [ADR-0002.D1] A report is counted once per session, including across event pages and tasks.
#[test]
fn aggregate_deduplicates_report_ids_per_session() {
    let store = Store::open(":memory:").unwrap();
    let session = store.create_session("active").unwrap();
    let other = store.create_session("active").unwrap();
    let task = store.create_task(session, "work", "active").unwrap();
    record(&store, session, Some(task), usage("shared", 3, 4, Some(ReportedCost { amount: 0.5, currency: "USD".into() }))).unwrap();
    for _ in 0..PAGE_SIZE {
        store.append_event(session, None, "other", json!({})).unwrap();
    }
    record(&store, session, None, usage("shared", 30, 40, Some(ReportedCost { amount: 5.0, currency: "USD".into() }))).unwrap();
    record(&store, other, None, usage("shared", 7, 8, None)).unwrap();
    let result = aggregate(&store, session).unwrap();
    assert_eq!((result.total.input_tokens, result.total.output_tokens), (3, 4));
    assert_eq!(result.total.costs["USD"], 0.5);
    assert_eq!(result.tasks[&task].input_tokens, 3);
    assert_eq!(result.skipped_events, 0);
    assert_eq!(result.reported_events, 1);
    assert_eq!(aggregate(&store, other).unwrap().total.input_tokens, 7);
}

// [ADR-0002.D1] Recording rejects reports without truthful measurement metadata.
#[test]
fn record_rejects_invalid_metadata() {
    let store = Store::open(":memory:").unwrap();
    let session = store.create_session("active").unwrap();
    let mut report = usage("", 1, 2, None);
    assert!(record(&store, session, None, report.clone()).is_err());
    report.report_id = "id".into();
    report.support_status = "unavailable".into();
    assert!(record(&store, session, None, report).is_err());
    assert!(store.events(session, 0, 10).unwrap().is_empty());
}

// [ADR-0002.D1] No reported usage is distinguishable from a reported zero.
#[test]
fn empty_usage_is_distinct_from_reported_zero() {
    let store = Store::open(":memory:").unwrap();
    let session = store.create_session("active").unwrap();
    assert_eq!(aggregate(&store, session).unwrap().reported_events, 0);
    record(&store, session, None, usage("zero", 0, 0, None)).unwrap();
    let result = aggregate(&store, session).unwrap();
    assert_eq!(result.reported_events, 1);
    assert_eq!((result.total.input_tokens, result.total.output_tokens), (0, 0));
}
