// @adr ADR-0003.D1
use serde::Serialize;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

#[derive(Debug, Clone, Serialize)]
pub struct Worktree {
    pub path: String,
    pub branch: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct CreateWorktreeResult {
    pub worktree: Worktree,
    pub warnings: Vec<String>,
}

// Read both pipes concurrently so a verbose Git process cannot block on a full pipe.
fn git_output(repo: &Path, args: &[&str], missing_ref_ok: bool) -> Result<Option<String>, String> {
    let mut child = Command::new("git")
        .current_dir(repo)
        .args(args)
        .env("GIT_TERMINAL_PROMPT", "0")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Could not start git: {e}"))?;
    let mut stdout = child.stdout.take().ok_or("Could not capture git output")?;
    let mut stderr = child.stderr.take().ok_or("Could not capture git errors")?;
    let out = std::thread::spawn(move || { let mut bytes = Vec::new(); stdout.read_to_end(&mut bytes).map(|_| bytes) });
    let err = std::thread::spawn(move || { let mut bytes = Vec::new(); stderr.read_to_end(&mut bytes).map(|_| bytes) });
    let deadline = Instant::now() + Duration::from_secs(30);
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(10)),
            Ok(None) => { let _ = child.kill(); let _ = child.wait(); return Err("Git command timed out".into()); }
            Err(e) => { let _ = child.kill(); let _ = child.wait(); return Err(format!("Could not wait for git: {e}")); }
        }
    };
    let output = out.join().map_err(|_| "Could not read git output")?.map_err(|e| e.to_string())?;
    let errors = err.join().map_err(|_| "Could not read git errors")?.map_err(|e| e.to_string())?;
    if !status.success() {
        if missing_ref_ok && status.code() == Some(1) && errors.is_empty() { return Ok(None); }
        return Err(format!("Git command failed: {}", String::from_utf8_lossy(&errors).trim()));
    }
    String::from_utf8(output).map(Some).map_err(|_| "Git returned non-UTF-8 output".into())
}

fn git(repo: &Path, args: &[&str]) -> Result<String, String> {
    git_output(repo, args, false).map(|output| output.expect("successful Git command has output"))
}

fn validate_task_id(id: &str) -> Result<(), String> {
    if id.is_empty() || id.starts_with('-') || !id.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_') {
        return Err("Invalid task ID: use only letters, digits, underscores and hyphens, without a leading hyphen".into());
    }
    Ok(())
}

fn validate_branch(branch: &str) -> Result<(), String> {
    if branch.is_empty() || branch.starts_with('-') || branch.starts_with('/') || branch.ends_with('/')
        || branch.ends_with('.') || branch.contains("..") || branch.contains("@{") || branch == "@"
        || branch.split('/').any(|part| part.is_empty() || part.starts_with('.') || part.ends_with(".lock"))
        || branch.bytes().any(|c| c <= b' ' || c == 127 || b"~^:?*[\\".contains(&c)) {
        return Err("Invalid branch name".into());
    }
    Ok(())
}

fn managed_root(repo: &Path) -> Result<PathBuf, String> {
    let common = git(repo, &["rev-parse", "--path-format=absolute", "--git-common-dir"])
        .map_err(|e| format!("Not a Git repository or Git is unavailable: {e}"))?;
    let common = PathBuf::from(common.trim_end_matches(['\r', '\n']));
    let common = common.canonicalize().map_err(|e| format!("Cannot resolve Git directory: {e}"))?;
    // Only non-bare repositories with a standard .git directory have an unambiguous owner.
    if common.file_name().and_then(|s| s.to_str()) != Some(".git") {
        return Err("Worktree isolation requires a non-bare repository with a .git directory".into());
    }
    let owner = common.parent().ok_or("Cannot determine repository root")?;
    let parent = owner.parent().ok_or("Cannot determine repository parent")?;
    let name = owner.file_name().ok_or("Cannot determine repository name")?;
    Ok(parent.join(".bentobox-worktrees").join(name))
}

fn list_all(repo: &Path) -> Result<Vec<Worktree>, String> {
    let output = git(repo, &["worktree", "list", "--porcelain", "-z"])?;
    let mut result = Vec::new();
    let mut current: Option<Worktree> = None;
    for field in output.split('\0') {
        if let Some(path) = field.strip_prefix("worktree ") {
            if let Some(item) = current.take() { result.push(item); }
            current = Some(Worktree { path: path.to_owned(), branch: None });
        } else if let Some(branch) = field.strip_prefix("branch refs/heads/") {
            if let Some(item) = current.as_mut() { item.branch = Some(branch.to_owned()); }
        }
    }
    if let Some(item) = current { result.push(item); }
    Ok(result)
}

fn create(repo: &Path, task_id: &str, base_branch: &str, enabled: bool) -> Result<Option<CreateWorktreeResult>, String> {
    if !enabled { return Ok(None); }
    validate_task_id(task_id)?;
    validate_branch(base_branch)?;
    let root = managed_root(repo)?;
    let path = root.join(task_id);
    let path_str = path.to_str().ok_or("Worktree path is not UTF-8")?;
    let branch = format!("bentobox/{task_id}");
    let worktrees = list_all(repo)?;
    let branch_ref = format!("refs/heads/{branch}");
    let branch_exists = git_output(repo, &["show-ref", "--verify", "--quiet", &branch_ref], true)?.is_some();
    if branch_exists {
        if let Some(item) = worktrees.iter().find(|item| item.branch.as_deref() == Some(&branch)) {
            return Err(format!("Branch {branch} is already checked out at {}", item.path));
        }
    }
    let warnings = worktrees.into_iter().filter(|item| item.branch.as_deref() == Some(base_branch))
        .map(|item| format!("Base branch {base_branch} is already checked out at {}", item.path)).collect();
    std::fs::create_dir_all(&root).map_err(|e| format!("Cannot create managed worktree directory: {e}"))?;
    if branch_exists { git(repo, &["worktree", "add", "--", path_str, &branch])?; }
    else { git(repo, &["worktree", "add", "-b", &branch, "--", path_str, base_branch])?; }
    Ok(Some(CreateWorktreeResult { worktree: Worktree { path: path_str.to_owned(), branch: Some(branch) }, warnings }))
}

fn list(repo: &Path, enabled: bool) -> Result<Vec<Worktree>, String> {
    if !enabled { return Ok(Vec::new()); }
    let root = managed_root(repo)?;
    Ok(list_all(repo)?.into_iter().filter(|item| Path::new(&item.path).parent() == Some(root.as_path())).collect())
}

fn remove(repo: &Path, task_id: &str, force: bool, enabled: bool) -> Result<(), String> {
    if !enabled { return Ok(()); }
    validate_task_id(task_id)?;
    let root = managed_root(repo)?;
    let path = root.join(task_id);
    let path_str = path.to_str().ok_or("Worktree path is not UTF-8")?;
    if !list_all(repo)?.iter().any(|item| Path::new(&item.path) == path) {
        return Err("Managed worktree not found".into());
    }
    // Git itself checks tracked and untracked changes atomically with its removal operation.
    if force { git(repo, &["worktree", "remove", "--force", "--", path_str])?; }
    else { git(repo, &["worktree", "remove", "--", path_str])?; }
    Ok(())
}

#[tauri::command]
pub async fn create_worktree(repo_path: String, task_id: String, base_branch: String, enabled: bool) -> Result<Option<CreateWorktreeResult>, String> {
    tauri::async_runtime::spawn_blocking(move || create(Path::new(&repo_path), &task_id, &base_branch, enabled)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn list_worktrees(repo_path: String, enabled: bool) -> Result<Vec<Worktree>, String> {
    tauri::async_runtime::spawn_blocking(move || list(Path::new(&repo_path), enabled)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn remove_worktree(repo_path: String, task_id: String, force: bool, enabled: bool) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || remove(Path::new(&repo_path), &task_id, force, enabled)).await.map_err(|e| e.to_string())?
}

#[cfg(test)]
#[path = "workspace_test.rs"]
mod tests;
