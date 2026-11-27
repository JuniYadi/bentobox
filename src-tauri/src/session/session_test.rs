use super::*;
use std::time::{SystemTime, UNIX_EPOCH};

fn store() -> (Store, std::path::PathBuf) {
    let unique = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
    let root = std::env::temp_dir().join(format!("bentobox-plan-{}-{unique}", std::process::id()));
    std::fs::create_dir_all(&root).unwrap();
    let store = Store::open(root.join("db.sqlite")).unwrap();
    (store, root)
}
fn task(id: &str, dependencies: &[&str]) -> PlanTask {
    PlanTask { id: id.into(), title: id.into(), team: "team".into(), harness: "harness".into(), worktree: true, dependencies: dependencies.iter().map(|s| (*s).into()).collect(), estimated_tokens: Some(100), status: String::new() }
}
fn cleanup(root: &std::path::Path) { std::fs::remove_dir_all(root).unwrap(); }

#[test]
fn approval_gate_and_revision_reset_persist() {
    // [ADR-0010.D1] Unapproved tasks cannot run; revisions invalidate approval across persistence.
    let (store, root) = store();
    let session = store.create_session("active").unwrap();
    propose(&store, session, vec![task("a", &[])]).unwrap();
    assert!(transition(&store, session, "a", "running").is_err());
    approve(&store, session, 1).unwrap();
    drop(store);
    let store = Store::open(root.join("db.sqlite")).unwrap();
    assert!(transition(&store, session, "a", "running").is_ok());
    assert!(propose(&store, session, vec![task("a", &[])]).unwrap_err().contains("cancel"));
    cancel(&store, session).unwrap();
    let revised = propose(&store, session, vec![task("a", &[])]).unwrap();
    assert_eq!(revised.revision, 2);
    assert!(!revised.approved);
    assert!(transition(&store, session, "a", "running").is_err());
    cleanup(&root);
}

#[test]
fn invalid_transitions_and_dependencies_are_rejected() {
    // [ADR-0010.D1] Tasks transition legally and dependents wait for completed prerequisites.
    let (store, root) = store();
    let session = store.create_session("active").unwrap();
    propose(&store, session, vec![task("a", &[]), task("b", &["a"])]).unwrap();
    assert!(transition(&store, session, "a", "completed").is_err());
    approve(&store, session, 1).unwrap();
    assert!(transition(&store, session, "b", "running").is_err());
    transition(&store, session, "a", "running").unwrap();
    transition(&store, session, "a", "review").unwrap();
    transition(&store, session, "a", "completed").unwrap();
    transition(&store, session, "b", "running").unwrap();
    cleanup(&root);
}


#[test]
fn plan_round_trips_after_store_reopen() {
    // [ADR-0010.D1] Persisted plan metadata and current approval state survive reopening.
    let (store, root) = store();
    let session = store.create_session("active").unwrap();
    let expected = propose(&store, session, vec![task("a", &[])]).unwrap();
    approve(&store, session, 1).unwrap();
    drop(store);
    let store = Store::open(root.join("db.sqlite")).unwrap();
    let actual: Plan = serde_json::from_str(&store.load_plan(session).unwrap().unwrap()).unwrap();
    assert_eq!(actual.revision, expected.revision);
    assert!(actual.approved);
    assert_eq!(actual.tasks[0].harness, "harness");
    cleanup(&root);
}

#[test]
fn stale_approval_and_concurrent_revision_are_atomic() {
    // [ADR-0010.D1] Approval must never attach to a revision other than the one accepted.
    let (store, root) = store();
    let session = store.create_session("active").unwrap();
    propose(&store, session, vec![task("a", &[])]).unwrap();
    propose(&store, session, vec![task("a", &[])]).unwrap();
    assert!(approve(&store, session, 1).unwrap_err().contains("revision"));
    for _ in 0..32 {
        let before: Plan = serde_json::from_str(&store.load_plan(session).unwrap().unwrap()).unwrap();
        let left = store.clone();
        let right = store.clone();
        let barrier = std::sync::Arc::new(std::sync::Barrier::new(2));
        let other = barrier.clone();
        let approving = std::thread::spawn(move || { other.wait(); approve(&left, session, before.revision) });
        let revising = std::thread::spawn(move || { barrier.wait(); propose(&right, session, vec![task("a", &[])]) });
        let approval = approving.join().unwrap();
        revising.join().unwrap().unwrap();
        let final_plan: Plan = serde_json::from_str(&store.load_plan(session).unwrap().unwrap()).unwrap();
        if let Ok(approved) = approval { assert!(!final_plan.approved || final_plan.revision == approved.revision); }
        assert!(!final_plan.approved);
    }
    cleanup(&root);
}

#[test]
fn tool_policy_enforces_actor_and_running_approved_task() {
    // [ADR-0010.D1] Mutations are denied to the orchestrator and gated for sub-agents.
    let (store, root) = store();
    let session = store.create_session("active").unwrap();
    let plan = propose(&store, session, vec![task("a", &[])]).unwrap();
    for tool in [Tool::WriteFile, Tool::EditFile, Tool::MutatingShell, Tool::GitCommit] {
        assert_eq!(ToolPolicy::authorize(Actor::Orchestrator, tool), Err(PolicyError::Denied));
        assert_eq!(ToolPolicy::authorize(Actor::SubAgent { plan: &plan, task_id: "a" }, tool), Err(PolicyError::Denied));
    }
    assert!(ToolPolicy::authorize(Actor::Orchestrator, Tool::ReadFile).is_ok());
    let approved = approve(&store, session, 1).unwrap();
    assert!(ToolPolicy::authorize(Actor::SubAgent { plan: &approved, task_id: "a" }, Tool::WriteFile).is_err());
    let running = transition(&store, session, "a", "running").unwrap();
    assert!(ToolPolicy::authorize(Actor::SubAgent { plan: &running, task_id: "a" }, Tool::WriteFile).is_ok());
    assert!(ToolPolicy::authorize(Actor::SubAgent { plan: &running, task_id: "missing" }, Tool::MutatingShell).is_err());
    cleanup(&root);
}

#[test]
fn lifecycle_retry_cancel_and_accept() {
    // [ADR-0010.D1] Approval, build, review, retry, acceptance and cancellation respect their phases.
    let (store, root) = store();
    let session = store.create_session("active").unwrap();
    propose(&store, session, vec![task("a", &[])]).unwrap();
    assert!(accept(&store, session).is_err());
    assert!(cancel(&store, session).is_err());
    assert_eq!(approve(&store, session, 1).unwrap().phase, "Approve");
    assert_eq!(transition(&store, session, "a", "running").unwrap().phase, "Build");
    assert_eq!(transition(&store, session, "a", "failed").unwrap().phase, "Review");
    assert_eq!(transition(&store, session, "a", "queued").unwrap().phase, "Build");
    assert!(propose(&store, session, vec![task("a", &[])]).unwrap_err().contains("cancel"));
    transition(&store, session, "a", "running").unwrap();
    transition(&store, session, "a", "review").unwrap();
    assert_eq!(transition(&store, session, "a", "completed").unwrap().phase, "Review");
    assert_eq!(accept(&store, session).unwrap().phase, "Closed");
    assert!(transition(&store, session, "a", "running").is_err());
    assert!(cancel(&store, session).is_err());
    let second = store.create_session("active").unwrap();
    propose(&store, second, vec![task("b", &[])]).unwrap();
    approve(&store, second, 1).unwrap();
    let cancelled = cancel(&store, second).unwrap();
    assert_eq!(cancelled.phase, "Cancelled");
    assert_eq!(cancelled.tasks[0].status, "cancelled");
    assert!(transition(&store, second, "b", "running").is_err());
    assert_eq!(propose(&store, second, vec![task("b", &[])]).unwrap().revision, 2);
    cleanup(&root);
}

#[test]
fn token_estimates_are_summed_only_when_known() {
    // [ADR-0010.D1] Unknown or zero estimates never masquerade as a zero total.
    let (store, root) = store();
    let session = store.create_session("active").unwrap();
    assert_eq!(propose(&store, session, vec![task("a", &[]), task("b", &[])]).unwrap().estimated_tokens, Some(200));
    let mut unknown = task("a", &[]); unknown.estimated_tokens = None;
    assert_eq!(propose(&store, session, vec![unknown]).unwrap().estimated_tokens, None);
    let mut zero = task("a", &[]); zero.estimated_tokens = Some(0);
    assert_eq!(propose(&store, session, vec![zero]).unwrap().estimated_tokens, None);
    let mut zero_with_known = task("zero", &[]); zero_with_known.estimated_tokens = Some(0);
    assert_eq!(propose(&store, session, vec![zero_with_known, task("known", &[])]).unwrap().estimated_tokens, Some(100));
    cleanup(&root);
}

#[test]
fn sessions_persist_metadata_and_are_listed_newest_first() {
    // [ADR-0010.D1] Session identity and workspace preferences survive reopening.
    let (store, root) = store();
    let first = store.create_named_session("First", "/one", false).unwrap();
    let second = store.create_named_session("Second", "/two", true).unwrap();
    assert!(!first.created_at.is_empty());
    assert_eq!(store.set_session_worktree(first.id, true).unwrap().opt_in_worktree, true);
    assert!(store.set_session_worktree(-1, true).is_err());
    drop(store);
    let store = Store::open(root.join("db.sqlite")).unwrap();
    let sessions = store.list_sessions().unwrap();
    assert_eq!(sessions.len(), 2);
    assert_eq!(sessions[0], second);
    assert_eq!(sessions[1].title, "First");
    assert_eq!(sessions[1].workspace_path, "/one");
    assert!(sessions[1].opt_in_worktree);
    cleanup(&root);
}

#[test]
fn reject_and_invalid_phase_transitions() {
    // [ADR-0010.D1] Rejection blocks approval until a new revision is proposed.
    let (store, root) = store();
    let session = store.create_session("active").unwrap();
    propose(&store, session, vec![task("a", &[])]).unwrap();
    assert_eq!(reject(&store, session).unwrap().phase, "Rejected");
    assert!(reject(&store, session).is_err());
    assert!(approve(&store, session, 1).is_err());
    let revised = propose(&store, session, vec![task("a", &[])]).unwrap();
    assert_eq!(revised.revision, 2);
    approve(&store, session, 2).unwrap();
    assert!(reject(&store, session).is_err());
    cleanup(&root);
}
