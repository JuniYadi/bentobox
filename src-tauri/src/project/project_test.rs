use super::*;
use std::time::{SystemTime, UNIX_EPOCH};

fn temp() -> std::path::PathBuf {
    let root = std::env::temp_dir().join(format!("bentobox-project-{}-{}", std::process::id(), SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()));
    std::fs::create_dir_all(&root).unwrap();
    root
}
fn repo(path: &Path) {
    std::fs::create_dir_all(path).unwrap();
    assert!(std::process::Command::new("git").args(["init", "-q"]).current_dir(path).status().unwrap().success());
}

// [ADR-0016.D2] Projects require Git repositories and normalize subdirectories to repository roots.
#[test]
fn add_requires_git_and_resolves_subdirectory() {
    let root = temp();
    let store = Store::open(root.join("db.sqlite")).unwrap();
    let non_repo = root.join("plain");
    std::fs::create_dir_all(&non_repo).unwrap();
    assert!(repository_root(&non_repo).is_err());
    let repository = root.join("repository");
    repo(&repository);
    let sub = repository.join("src");
    std::fs::create_dir_all(&sub).unwrap();
    let (canonical, _) = repository_root(&repository).unwrap();
    let (sub_root, name) = repository_root(&sub).unwrap();
    assert_eq!(canonical, sub_root);
    let first = store.add_project(&name, &canonical).unwrap();
    assert_eq!(store.add_project(&name, &sub_root).unwrap(), first);
    assert_eq!(store.list_projects().unwrap(), vec![first]);
    std::fs::remove_dir_all(root).unwrap();
}

// [ADR-0016.D2] Non-terminal plan phase or running task blocks removal unless forced; no-plan and terminal plans are removable.
#[test]
fn remove_protects_nonterminal_plan_or_running_task_and_permits_terminal_or_empty() {
    let root = temp();
    let db = root.join("db.sqlite");
    let repository = root.join("repository");
    repo(&repository);
    let marker = repository.join("keep.txt");
    std::fs::write(&marker, "keep").unwrap();
    let (root_path, name) = repository_root(&repository).unwrap();

    // 1. Session with no plan can be removed without force
    let store = Store::open(&db).unwrap();
    let project = store.add_project(&name, &root_path).unwrap();
    let session_empty = store.create_named_session("empty", project.id, &root_path, false).unwrap();
    assert!(store.remove_project(project.id, false).is_ok());
    assert!(store.list_projects().unwrap().is_empty());

    // 2. Active non-terminal plan blocks removal unless forced
    let project = store.add_project(&name, &root_path).unwrap();
    let session_active = store.create_named_session("active", project.id, &root_path, false).unwrap();
    store.mutate_plan(session_active.id, |_| Ok((r#"{"phase":"Plan","tasks":[]}"#.into(), ()))).unwrap();
    assert!(store.remove_project(project.id, false).unwrap_err().contains("sessions that are not closed or tasks that are running"));
    store.remove_project(project.id, true).unwrap();
    assert_eq!(std::fs::read_to_string(&marker).unwrap(), "keep");

    // 3. Running task in tasks table blocks removal
    let project = store.add_project(&name, &root_path).unwrap();
    let session_task = store.create_named_session("task", project.id, &root_path, false).unwrap();
    store.create_task(session_task.id, "run", "running").unwrap();
    assert!(store.remove_project(project.id, false).unwrap_err().contains("sessions that are not closed or tasks that are running"));
    store.remove_project(project.id, true).unwrap();

    // 4. Terminal plan phases permit removal without force
    for terminal_phase in ["Closed", "Accepted", "Rejected", "Cancelled"] {
        let project = store.add_project(&name, &root_path).unwrap();
        let session_terminal = store.create_named_session("term", project.id, &root_path, false).unwrap();
        store.mutate_plan(session_terminal.id, |_| Ok((format!(r#"{{"phase":"{terminal_phase}","tasks":[]}}"#), ()))).unwrap();
        assert!(store.remove_project(project.id, false).is_ok());
    }

    drop(session_empty);
    drop(store);
    std::fs::remove_dir_all(root).unwrap();
}

// [ADR-0016.D2] Project sessions expose persisted plan phase and task status.
#[test]
fn project_sessions_round_trip_plan_state() {
    let root = temp();
    let repository = root.join("repo");
    repo(&repository);
    let store = Store::open(root.join("db.sqlite")).unwrap();
    let (root_path, name) = repository_root(&repository).unwrap();
    let project = store.add_project(&name, &root_path).unwrap();
    let session = store.create_named_session("plan", project.id, &root_path, false).unwrap();
    store.mutate_plan(session.id, |_| Ok((r#"{"phase":"Build","tasks":[{"status":"running"}]}"#.into(), ()))).unwrap();
    let item = store.project_sessions(project.id).unwrap().pop().unwrap();
    assert_eq!(item.id, session.id);
    assert_eq!(item.title, "plan");
    assert_eq!(item.phase.as_deref(), Some("Build"));
    assert_eq!(item.task_statuses, vec!["running"]);
    assert_eq!(item.state, "active");
    std::fs::remove_dir_all(root).unwrap();
}
// [ADR-0016.D2] Version two sessions are grouped by canonical repository root; invalid paths remain unlinked.
#[test]
fn v2_migration_groups_sessions_and_leaves_unresolvable_paths_unlinked() {
    let root = temp();
    let repository = root.join("repo");
    repo(&repository);
    let sub = repository.join("nested");
    std::fs::create_dir_all(&sub).unwrap();
    let invalid = root.join("not-git");
    std::fs::create_dir_all(&invalid).unwrap();
    let path = root.join("db.sqlite");
    let conn = rusqlite::Connection::open(&path).unwrap();
    conn.execute_batch("CREATE TABLE sessions (id INTEGER PRIMARY KEY, state TEXT NOT NULL, title TEXT NOT NULL, workspace_path TEXT NOT NULL, opt_in_worktree INTEGER NOT NULL, created_at TEXT NOT NULL); PRAGMA user_version = 2;").unwrap();
    conn.execute("INSERT INTO sessions VALUES (1,'active','one',?1,0,'now')", [repository.to_str().unwrap()]).unwrap();
    conn.execute("INSERT INTO sessions VALUES (2,'active','two',?1,0,'now')", [sub.to_str().unwrap()]).unwrap();
    conn.execute("INSERT INTO sessions VALUES (3,'active','orphan',?1,0,'now')", [invalid.to_str().unwrap()]).unwrap();
    drop(conn);
    let store = Store::open(&path).unwrap();
    let conn = store.connection().unwrap();
    let projects: i64 = conn.query_row("SELECT count(*) FROM projects", [], |row| row.get(0)).unwrap();
    let linked: i64 = conn.query_row("SELECT count(DISTINCT project_id) FROM sessions WHERE id IN (1,2)", [], |row| row.get(0)).unwrap();
    let unlinked: Option<i64> = conn.query_row("SELECT project_id FROM sessions WHERE id=3", [], |row| row.get(0)).unwrap();
    assert_eq!(projects, 1);
    assert_eq!(linked, 1);
    assert_eq!(unlinked, None);
    drop(conn);
    drop(store);
    std::fs::remove_dir_all(root).unwrap();
}

// [ADR-0016.D2] Unassigned sessions are returned by unassigned_sessions and tree groups projects and sessions in one call.
#[test]
fn project_tree_and_unassigned_sessions() {
    let root = temp();
    let store = Store::open(root.join("db.sqlite")).unwrap();
    let repo1 = root.join("repo1");
    let repo2 = root.join("repo2");
    repo(&repo1);
    repo(&repo2);
    let (root1, name1) = repository_root(&repo1).unwrap();
    let (root2, name2) = repository_root(&repo2).unwrap();
    let p1 = store.add_project(&name1, &root1).unwrap();
    let p2 = store.add_project(&name2, &root2).unwrap();

    let s1 = store.create_named_session("s1", p1.id, &root1, false).unwrap();
    let orphan = {
        let conn = store.connection().unwrap();
        conn.execute("INSERT INTO sessions (state, title, project_id, workspace_path, opt_in_worktree, created_at) VALUES ('active', 'orphan-session', NULL, ?1, 0, 'now')", [&root1]).unwrap();
        conn.last_insert_rowid()
    };

    let unassigned = store.unassigned_sessions().unwrap();
    assert_eq!(unassigned.len(), 1);
    assert_eq!(unassigned[0].id, orphan);
    assert_eq!(unassigned[0].title, "orphan-session");

    let tree = store.project_tree().unwrap();
    assert_eq!(tree.len(), 2);
    let entry1 = tree.iter().find(|e| e.project.id == p1.id).unwrap();
    assert_eq!(entry1.sessions.len(), 1);
    assert_eq!(entry1.sessions[0].id, s1.id);
    let entry2 = tree.iter().find(|e| e.project.id == p2.id).unwrap();
    assert!(entry2.sessions.is_empty());

    std::fs::remove_dir_all(root).unwrap();
}

// [ADR-0016.D2] Path normalization expands leading ~ and rejects .bentobox-worktrees paths.
#[test]
fn repository_root_path_expansion_and_worktree_rejection() {
    let root = temp();
    let home_dir = root.join("mock-home");
    let repo_dir = home_dir.join("my-repo");
    repo(&repo_dir);

    // Set HOME for this test run
    unsafe { std::env::set_var("HOME", &home_dir); }
    let tilde_path = Path::new("~/my-repo");
    let (canonical, name) = repository_root(tilde_path).unwrap();
    assert_eq!(name, "my-repo");
    assert_eq!(canonical, repo_dir.canonicalize().unwrap().to_str().unwrap());

    let worktree_repo = root.join(".bentobox-worktrees").join("child-repo");
    repo(&worktree_repo);
    assert!(repository_root(&worktree_repo).unwrap_err().contains(".bentobox-worktrees"));

    std::fs::remove_dir_all(root).unwrap();
}
