use super::*;
use std::time::{SystemTime, UNIX_EPOCH};

static COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

fn store() -> (Store, std::path::PathBuf) {
    let unique = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
    let count = COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let root = std::env::temp_dir().join(format!("bentobox-plan-{}-{unique}-{count}", std::process::id()));
    std::fs::create_dir_all(&root).unwrap();
    let store = Store::open(root.join("db.sqlite")).unwrap();
    (store, root)
}
fn task(id: &str, dependencies: &[&str]) -> PlanTask {
    PlanTask { id: id.into(), title: id.into(), team: "team".into(), harness: "harness".into(), model: None, worktree: true, files: vec![], dependencies: dependencies.iter().map(|s| (*s).into()).collect(), estimated_tokens: Some(100), status: String::new() }
}
fn cleanup(root: &std::path::Path) { std::fs::remove_dir_all(root).unwrap(); }

#[test]
fn legacy_plan_without_files_deserializes() {
    // [ADR-0016.D3] Stored plans created before file lists remain readable.
    let raw = r#"{"session_id":1,"revision":1,"phase":"Plan","approved":false,"estimated_tokens":null,"tasks_started":false,"tasks":[{"id":"a","title":"Task","team":"team","harness":"harness","worktree":true,"dependencies":[],"estimated_tokens":null,"status":"queued"}]}"#;
    let plan: Plan = serde_json::from_str(raw).unwrap();
    assert!(plan.tasks[0].files.is_empty());
}

#[test]
fn direct_harness_plan_does_not_require_a_team() {
    // [ADR-0010.D1] A composer plan can target a harness without a team.
    let (store, root) = store();
    let session = store.create_session("active").unwrap();
    let mut direct = task("direct", &[]);
    direct.team.clear();
    assert_eq!(propose(&store, session, vec![direct]).unwrap().tasks[0].team, "");
    cleanup(&root);
}

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
    let repo = root.join("repo");
    std::fs::create_dir_all(&repo).unwrap();
    std::process::Command::new("git").args(["init", "-q"]).current_dir(&repo).status().unwrap();
    let (repo_root, name) = crate::project::repository_root(&repo).unwrap();
    let project = store.add_project(&name, &repo_root).unwrap();
    let first = store.create_named_session("First", project.id, "/one", false).unwrap();
    let second = store.create_named_session("Second", project.id, "/two", true).unwrap();
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

#[test]
fn completed_transition_succeeds_even_when_runner_start_fails() {
    // [ADR-0010.D1] A start failure after completion must not fail the transition command.
    let (store, root) = store();
    let session = store.create_session("active").unwrap();
    let t = task("task-1", &[]);
    propose(&store, session, vec![t]).unwrap();
    approve(&store, session, 1).unwrap();
    transition(&store, session, "task-1", "running").unwrap();
    transition(&store, session, "task-1", "review").unwrap();
    let runner = crate::runner::Runner::with_emitter(store.clone(), std::sync::Arc::new(|_, _| {}));
    let res = tauri::async_runtime::block_on(session_task_transition_with(store, &runner, session, "task-1".into(), "completed".into()));
    assert!(res.is_ok());
    let plan = res.unwrap();
    assert_eq!(plan.tasks[0].status, "completed");
    cleanup(&root);
}

#[test]
fn non_git_project_rejects_worktree_opt_in() {
    // [ADR-0019.D2] Non-git project rejects opt_in_worktree on session creation and update
    let (store, root) = store();
    let nongit = root.join("nongit-folder");
    std::fs::create_dir_all(&nongit).unwrap();
    let proj = store.add_project("nongit", nongit.to_str().unwrap()).unwrap();

    let check = || {
        let proj_root = store.project_root(proj.id)?;
        if !crate::project::is_git_repo(std::path::Path::new(&proj_root)) {
            return Err("Not a git repository: worktree isolation is unavailable".to_string());
        }
        store.create_named_session("Session", proj.id, &proj_root, true)
    };
    assert!(check().unwrap_err().contains("Not a git repository: worktree isolation is unavailable"));

    let session = store.create_named_session("Session", proj.id, nongit.to_str().unwrap(), false).unwrap();
    let set_worktree = || {
        let proj_root: String = store.connection()?.query_row(
            "SELECT projects.root_path FROM sessions JOIN projects ON projects.id = sessions.project_id WHERE sessions.id = ?1",
            [session.id],
            |row| row.get(0),
        ).map_err(|e| e.to_string())?;
        if !crate::project::is_git_repo(std::path::Path::new(&proj_root)) {
            return Err("Not a git repository: worktree isolation is unavailable".to_string());
        }
        store.set_session_worktree(session.id, true)
    };
    assert!(set_worktree().unwrap_err().contains("Not a git repository: worktree isolation is unavailable"));
    cleanup(&root);
}

#[test]
fn adr0020_concise_setting_persists_across_reopen_and_validates_session_id() {
    // [ADR-0020.D2] the setting persists across a Store reopen; session_set_concise with an unknown id errors
    let (store, root) = store();
    let repo = root.join("repo");
    std::fs::create_dir_all(&repo).unwrap();
    std::process::Command::new("git").args(["init", "-q"]).current_dir(&repo).status().unwrap();
    let (repo_root, name) = crate::project::repository_root(&repo).unwrap();
    let project = store.add_project(&name, &repo_root).unwrap();
    let session = store.create_named_session("Chat", project.id, "/repo", false).unwrap();

    // Default is false
    assert!(!session.concise_replies);
    assert!(!store.session_concise(session.id).unwrap());

    // Error on unknown id
    assert_eq!(store.set_session_concise(-999, true).unwrap_err(), "unknown session");
    assert_eq!(store.session_concise(-999).unwrap_err(), "unknown session");

    // Enable concise replies
    store.set_session_concise(session.id, true).unwrap();
    assert!(store.session_concise(session.id).unwrap());

    // Survives reopen
    drop(store);
    let store = Store::open(root.join("db.sqlite")).unwrap();
    assert!(store.session_concise(session.id).unwrap());
    let listed = store.list_sessions().unwrap();
    assert_eq!(listed.len(), 1);
    assert!(listed[0].concise_replies);

    cleanup(&root);
}

// [ADR-0021.D2] Model setting persists across reopen, allows clearing, and errors on unknown session id.
#[test]
fn adr0021_model_setting_persists_across_reopen_and_validates_session_id() {
    let (store, root) = store();
    let repo = root.join("repo");
    std::fs::create_dir_all(&repo).unwrap();
    std::process::Command::new("git").args(["init", "-q"]).current_dir(&repo).status().unwrap();
    let (repo_root, name) = crate::project::repository_root(&repo).unwrap();
    let project = store.add_project(&name, &repo_root).unwrap();
    let summary = store.create_named_session("Test Session", project.id, "/workspace", false).unwrap();
    assert_eq!(summary.model, None);
    assert_eq!(store.session_model(summary.id).unwrap(), None);

    store.set_session_model(summary.id, Some("claude-sonnet-4-6")).unwrap();
    assert_eq!(store.session_model(summary.id).unwrap(), Some("claude-sonnet-4-6".into()));

    let list = store.list_sessions().unwrap();
    let listed = list.iter().find(|s| s.id == summary.id).unwrap();
    assert_eq!(listed.model, Some("claude-sonnet-4-6".into()));

    drop(store);
    let reopened = Store::open(root.join("db.sqlite")).unwrap();
    assert_eq!(reopened.session_model(summary.id).unwrap(), Some("claude-sonnet-4-6".into()));

    reopened.set_session_model(summary.id, None).unwrap();
    assert_eq!(reopened.session_model(summary.id).unwrap(), None);
    assert!(reopened.set_session_model(99999, Some("claude-sonnet-4-6")).is_err());
    assert!(reopened.session_model(99999).is_err());
    cleanup(&root);
}
