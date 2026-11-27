use super::*;
use std::fs;
use std::process::Command;

struct Repo(PathBuf);
impl Repo {
    fn new() -> Self {
        let parent = std::env::temp_dir().join(format!("bentobox-worktree-{}-{}", std::process::id(), SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()));
        fs::create_dir(&parent).unwrap();
        let path = parent.join("repo");
        fs::create_dir(&path).unwrap();
        run(&path, &["init", "-b", "main"]);
        run(&path, &["config", "user.email", "test@example.invalid"]);
        run(&path, &["config", "user.name", "BentoBox test"]);
        fs::write(path.join("tracked.txt"), "clean\n").unwrap();
        run(&path, &["add", "--", "tracked.txt"]);
        run(&path, &["commit", "-m", "initial"]);
        Self(path)
    }
}
impl Drop for Repo { fn drop(&mut self) { let _ = fs::remove_dir_all(self.0.parent().unwrap()); } }
fn run(cwd: &Path, args: &[&str]) {
    let output = Command::new("git").current_dir(cwd).args(args).env("GIT_TERMINAL_PROMPT", "0").output().unwrap();
    assert!(output.status.success(), "git {:?}: {}", args, String::from_utf8_lossy(&output.stderr));
}
use std::time::{SystemTime, UNIX_EPOCH};

#[test]
fn create_list_remove_worktree() { // [ADR-0003.D1]
    let repo = Repo::new();
    let created = create(&repo.0, "task_1", "main", true).unwrap().unwrap();
    let canonical_repo = repo.0.canonicalize().unwrap();
    let canonical_worktree = Path::new(&created.worktree.path).canonicalize().unwrap();
    assert!(!canonical_worktree.starts_with(&canonical_repo));
    let status = Command::new("git").args(["-C", repo.0.to_str().unwrap(), "status", "--porcelain"]).output().unwrap();
    assert!(status.status.success());
    assert!(status.stdout.is_empty(), "repository was dirtied: {}", String::from_utf8_lossy(&status.stdout));
    assert_eq!(created.worktree.branch.as_deref(), Some("bentobox/task_1"));
    assert!(Path::new(&created.worktree.path).join("tracked.txt").exists());
    assert_eq!(list(&repo.0, true).unwrap().len(), 1);
    remove(&repo.0, "task_1", false, true).unwrap();
    assert!(list(&repo.0, true).unwrap().is_empty());
}

#[test]
fn recreate_worktree_preserves_committed_changes() { // [ADR-0003.D1]
    let repo = Repo::new();
    let created = create(&repo.0, "resume", "main", true).unwrap().unwrap();
    let worktree = Path::new(&created.worktree.path);
    fs::write(worktree.join("task.txt"), "preserved commit\n").unwrap();
    run(worktree, &["add", "--", "task.txt"]);
    run(worktree, &["commit", "-m", "task work"]);
    remove(&repo.0, "resume", false, true).unwrap();
    let recreated = create(&repo.0, "resume", "main", true).unwrap().unwrap();
    assert_eq!(fs::read_to_string(Path::new(&recreated.worktree.path).join("task.txt")).unwrap(), "preserved commit\n");
}

#[test]
fn existing_branch_checked_out_elsewhere_returns_clear_error() { // [ADR-0003.D1]
    let repo = Repo::new();
    run(&repo.0, &["branch", "bentobox/busy", "main"]);
    let elsewhere = repo.0.parent().unwrap().join("other worktree");
    run(&repo.0, &["worktree", "add", "--", elsewhere.to_str().unwrap(), "bentobox/busy"]);
    let error = create(&repo.0, "busy", "main", true).unwrap_err();
    assert!(error.contains("Branch bentobox/busy is already checked out at"), "{error}");
    assert!(error.contains(elsewhere.to_str().unwrap()), "{error}");
}

#[test]
fn opt_out_has_no_git_or_filesystem_effects() { // [ADR-0003.D1]
    let repo = Repo::new();
    assert!(create(&repo.0, "../escape", "-main", false).unwrap().is_none());
    assert!(list(&repo.0, false).unwrap().is_empty());
    remove(&repo.0, "../escape", false, false).unwrap();
    assert!(!repo.0.parent().unwrap().join(".bentobox-worktrees").exists());
}

#[test]
fn dirty_worktree_is_protected_unless_forced() { // [ADR-0003.D1]
    let repo = Repo::new();
    let created = create(&repo.0, "dirty", "main", true).unwrap().unwrap();
    fs::write(Path::new(&created.worktree.path).join("untracked.txt"), "keep me").unwrap();
    assert!(remove(&repo.0, "dirty", false, true).unwrap_err().contains("modified or untracked"));
    assert!(Path::new(&created.worktree.path).exists());
    remove(&repo.0, "dirty", true, true).unwrap();
    assert!(!Path::new(&created.worktree.path).exists());
}

#[test]
fn reject_injection_and_traversal_inputs() { // [ADR-0003.D1]
    let repo = Repo::new();
    for id in ["../escape", "-f", "a/b", ""] { assert!(create(&repo.0, id, "main", true).is_err()); }
    for branch in ["-main", "../main", "main/..", "bad name"] { assert!(create(&repo.0, "safe", branch, true).is_err()); }
    assert!(!repo.0.parent().unwrap().join("escape").exists());
}

#[test]
fn non_git_directory_returns_clear_error() { // [ADR-0003.D1]
    let dir = std::env::temp_dir().join(format!("bentobox-notgit-{}-{}", std::process::id(), SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()));
    fs::create_dir_all(&dir).unwrap();
    let error = list(&dir, true).unwrap_err();
    assert!(error.contains("Not a Git repository"), "{error}");
    fs::remove_dir_all(dir).unwrap();
}
