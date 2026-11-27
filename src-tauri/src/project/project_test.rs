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

// [ADR-0016.D2] Active sessions block removal unless forced, and removal leaves repository files untouched.
#[test]
fn remove_protects_active_sessions_and_force_preserves_files() {
    let root = temp();
    let db = root.join("db.sqlite");
    let repository = root.join("repository");
    repo(&repository);
    let marker = repository.join("keep.txt");
    std::fs::write(&marker, "keep").unwrap();
    let (store, project) = {
        let store = Store::open(&db).unwrap();
        let (root_path, name) = repository_root(&repository).unwrap();
        let project = store.add_project(&name, &root_path).unwrap();
        store.create_named_session("active", project.id, &root_path, false).unwrap();
        (store, project)
    };
    assert!(store.remove_project(project.id, false).unwrap_err().contains("not closed"));
    store.remove_project(project.id, true).unwrap();
    assert_eq!(std::fs::read_to_string(marker).unwrap(), "keep");
    assert!(store.list_projects().unwrap().is_empty());
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
