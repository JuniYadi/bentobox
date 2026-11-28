// @adr ADR-0016.D2
// @adr ADR-0019.D1
// @adr ADR-0019.D2
use crate::db::Store;
use rusqlite::{OptionalExtension, params};
use serde::{Deserialize, Serialize};
use std::path::{Component, Path};
use tauri::State;

/// @adr ADR-0016.D2
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: i64,
    pub name: String,
    pub root_path: String,
    pub is_git: bool,
    pub created_at: String,
}

/// @adr ADR-0016.D2
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSession {
    pub id: i64,
    pub title: String,
    pub phase: Option<String>,
    pub last_activity_at: String,
    pub state: String,
    pub task_statuses: Vec<String>,
}

/// @adr ADR-0016.D2
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectTreeEntry {
    pub project: Project,
    pub sessions: Vec<ProjectSession>,
}

/// @adr ADR-0019.D2
pub(crate) fn is_git_repo(path: &Path) -> bool {
    let Ok(path) = path.canonicalize() else { return false; };
    std::process::Command::new("git").arg("-C").arg(path).args(["rev-parse", "--show-toplevel"]).output().is_ok_and(|output| output.status.success())
}

pub(crate) fn repository_root(path: &Path) -> Result<(String, String), String> {
    project_directory(path, false)
}

fn project_directory(path: &Path, allow_non_git: bool) -> Result<(String, String), String> {
    let expanded = match path.strip_prefix("~") {
        Ok(rest) => std::path::PathBuf::from(std::env::var_os("HOME").ok_or("could not determine home directory")?).join(rest),
        Err(_) => path.to_path_buf(),
    };
    let is_managed = |p: &Path| p.components().any(|c| matches!(c, Component::Normal(name) if name == ".bentobox-worktrees"));
    if is_managed(&expanded) { return Err("cannot add a project inside a .bentobox-worktrees managed worktree".into()); }
    let canonical = expanded.canonicalize().map_err(|e| format!("could not resolve project path: {e}"))?;
    if !canonical.is_dir() { return Err("project path must be a directory".into()); }
    if is_managed(&canonical) { return Err("cannot add a project inside a .bentobox-worktrees managed worktree".into()); }
    let output = std::process::Command::new("git").args(["-C", canonical.to_str().ok_or("project path is not valid UTF-8")?, "rev-parse", "--show-toplevel"]).output().map_err(|e| format!("could not run git: {e}"))?;
    let root = if output.status.success() {
        let root = String::from_utf8(output.stdout).map_err(|e| e.to_string())?.trim().to_owned();
        Path::new(&root).canonicalize().map_err(|e| e.to_string())?
    } else if allow_non_git {
        canonical
    } else {
        return Err("path is not inside a Git repository".into());
    };
    if is_managed(&root) { return Err("cannot add a project inside a .bentobox-worktrees managed worktree".into()); }
    let root_path = root.to_str().ok_or("project path is not valid UTF-8")?;
    let name = root.file_name().and_then(|n| n.to_str()).unwrap_or(root_path).to_owned();
    Ok((root_path.to_owned(), name))
}

impl Store {
    pub(crate) fn add_project(&self, name: &str, root_path: &str) -> Result<Project, String> {
        let project = {
            let conn = self.connection()?;
            conn.execute("INSERT INTO projects (name, root_path) VALUES (?1, ?2) ON CONFLICT(root_path) DO NOTHING", params![name, root_path]).map_err(|e| e.to_string())?;
            conn.query_row("SELECT id, name, root_path, created_at FROM projects WHERE root_path = ?1", [root_path], project_row).map_err(|e| e.to_string())?
        };
        Ok(project_with_git_status(project))
    }
    pub(crate) fn project_root(&self, id: i64) -> Result<String, String> {
        self.connection()?.query_row("SELECT root_path FROM projects WHERE id = ?1", [id], |row| row.get(0)).optional().map_err(|e| e.to_string())?.ok_or_else(|| "unknown project".to_string())
    }

    pub(crate) fn list_projects(&self) -> Result<Vec<Project>, String> {
        let projects = {
            let conn = self.connection()?;
            let mut stmt = conn.prepare("SELECT id, name, root_path, created_at FROM projects ORDER BY name COLLATE NOCASE, id").map_err(|e| e.to_string())?;
            let rows = stmt.query_map([], project_row).map_err(|e| e.to_string())?.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;
            rows
        };
        Ok(projects.into_iter().map(project_with_git_status).collect())
    }

    pub(crate) fn remove_project(&self, id: i64, force: bool) -> Result<(), String> {
        let conn = self.connection()?;
        let exists: bool = conn.query_row("SELECT EXISTS(SELECT 1 FROM projects WHERE id = ?1)", [id], |r| r.get(0)).map_err(|e| e.to_string())?;
        if !exists { return Err("unknown project".into()); }
        if !force {
            let running: bool = conn.query_row("SELECT EXISTS(SELECT 1 FROM tasks t JOIN sessions s ON s.id = t.session_id WHERE s.project_id = ?1 AND t.state = 'running')", [id], |r| r.get(0)).map_err(|e| e.to_string())?;
            let mut stmt = conn.prepare("SELECT p.plan FROM session_plans p JOIN sessions s ON s.id = p.session_id WHERE s.project_id = ?1").map_err(|e| e.to_string())?;
            let plans = stmt.query_map([id], |r| r.get::<_, String>(0)).map_err(|e| e.to_string())?;
            let mut active = running;
            for plan in plans {
                let plan: serde_json::Value = serde_json::from_str(&plan.map_err(|e| e.to_string())?).map_err(|e| format!("invalid persisted plan: {e}"))?;
                let terminal = matches!(plan.get("phase").and_then(|p| p.as_str()), Some("Closed" | "Accepted" | "Rejected" | "Cancelled"));
                let running_task = plan.get("tasks").and_then(|t| t.as_array()).is_some_and(|tasks| tasks.iter().any(|task| task.get("status").and_then(|s| s.as_str()) == Some("running")));
                active |= !terminal || running_task;
            }
            if active { return Err("cannot remove project while it has sessions that are not closed or tasks that are running".into()); }
        }
        conn.execute("DELETE FROM projects WHERE id = ?1", [id]).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub(crate) fn project_sessions(&self, project_id: i64) -> Result<Vec<ProjectSession>, String> {
        let conn = self.connection()?;
        let mut stmt = conn.prepare("SELECT s.id, s.title, s.state, COALESCE((SELECT MAX(e.created_at) FROM events e WHERE e.session_id = s.id), s.created_at), p.plan FROM sessions s LEFT JOIN session_plans p ON p.session_id = s.id WHERE s.project_id = ?1 ORDER BY s.id DESC").map_err(|e| e.to_string())?;
        let rows = stmt.query_map([project_id], |row| session_row(row, 0)).map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }

    pub(crate) fn unassigned_sessions(&self) -> Result<Vec<ProjectSession>, String> {
        let conn = self.connection()?;
        let mut stmt = conn.prepare("SELECT s.id, s.title, s.state, COALESCE((SELECT MAX(e.created_at) FROM events e WHERE e.session_id = s.id), s.created_at), p.plan FROM sessions s LEFT JOIN session_plans p ON p.session_id = s.id WHERE s.project_id IS NULL ORDER BY s.id DESC").map_err(|e| e.to_string())?;
        stmt.query_map([], |row| session_row(row, 0)).map_err(|e| e.to_string())?.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }

    pub(crate) fn project_tree(&self) -> Result<Vec<ProjectTreeEntry>, String> {
        let projects = {
            let conn = self.connection()?;
            let mut stmt = conn.prepare("SELECT project.id, project.name, project.root_path, project.created_at, s.id, s.title, s.state, COALESCE((SELECT MAX(e.created_at) FROM events e WHERE e.session_id = s.id), s.created_at), p.plan FROM projects project LEFT JOIN sessions s ON s.project_id = project.id LEFT JOIN session_plans p ON p.session_id = s.id ORDER BY project.name COLLATE NOCASE, project.id, s.id DESC").map_err(|e| e.to_string())?;
            let mut rows = stmt.query([]).map_err(|e| e.to_string())?;
            let mut projects: Vec<(ProjectRow, Vec<ProjectSession>)> = Vec::new();
            while let Some(row) = rows.next().map_err(|e| e.to_string())? {
                let id: i64 = row.get(0).map_err(|e| e.to_string())?;
                if projects.last().is_none_or(|(project, _)| project.id != id) { projects.push((project_row(row).map_err(|e| e.to_string())?, Vec::new())); }
                if row.get::<_, Option<i64>>(4).map_err(|e| e.to_string())?.is_some() { projects.last_mut().unwrap().1.push(session_row(row, 4).map_err(|e| e.to_string())?); }
            }
            projects
        };
        Ok(projects.into_iter().map(|(project, sessions)| ProjectTreeEntry { project: project_with_git_status(project), sessions }).collect())
    }
}

struct ProjectRow {
    id: i64,
    name: String,
    root_path: String,
    created_at: String,
}

fn project_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ProjectRow> {
    Ok(ProjectRow { id: row.get(0)?, name: row.get(1)?, root_path: row.get(2)?, created_at: row.get(3)? })
}

fn project_with_git_status(row: ProjectRow) -> Project {
    let is_git = is_git_repo(Path::new(&row.root_path));
    Project { id: row.id, name: row.name, root_path: row.root_path, is_git, created_at: row.created_at }
}

fn session_row(row: &rusqlite::Row<'_>, offset: usize) -> rusqlite::Result<ProjectSession> {
    let plan: Option<String> = row.get(offset + 4)?;
    let parsed = plan.and_then(|raw| serde_json::from_str::<serde_json::Value>(&raw).ok());
    let phase = parsed.as_ref().and_then(|v| v.get("phase").and_then(|p| p.as_str()).map(str::to_owned));
    let task_statuses = parsed.as_ref().and_then(|v| v.get("tasks").and_then(|t| t.as_array())).map(|tasks| tasks.iter().filter_map(|t| t.get("status").and_then(|s| s.as_str()).map(str::to_owned)).collect()).unwrap_or_default();
    Ok(ProjectSession { id: row.get(offset)?, title: row.get(offset + 1)?, state: row.get(offset + 2)?, last_activity_at: row.get(offset + 3)?, phase, task_statuses })
}

/// @adr ADR-0016.D2
#[tauri::command]
pub async fn project_add(store: State<'_, Store>, path: String) -> Result<Project, String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || { let (root, name) = project_directory(Path::new(&path), true)?; store.add_project(&name, &root) }).await.map_err(|e| e.to_string())?
}

/// @adr ADR-0016.D2
#[tauri::command]
pub async fn project_list(store: State<'_, Store>) -> Result<Vec<Project>, String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || store.list_projects()).await.map_err(|e| e.to_string())?
}

/// @adr ADR-0016.D2
#[tauri::command]
pub async fn project_remove(store: State<'_, Store>, id: i64, force: bool) -> Result<(), String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || store.remove_project(id, force)).await.map_err(|e| e.to_string())?
}

/// @adr ADR-0016.D2
#[tauri::command]
pub async fn project_sessions(store: State<'_, Store>, project_id: i64) -> Result<Vec<ProjectSession>, String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || store.project_sessions(project_id)).await.map_err(|e| e.to_string())?
}

/// @adr ADR-0016.D2
#[tauri::command]
pub async fn project_unassigned_sessions(store: State<'_, Store>) -> Result<Vec<ProjectSession>, String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || store.unassigned_sessions()).await.map_err(|e| e.to_string())?
}

/// @adr ADR-0016.D2
#[tauri::command]
pub async fn project_tree(store: State<'_, Store>) -> Result<Vec<ProjectTreeEntry>, String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || store.project_tree()).await.map_err(|e| e.to_string())?
}

#[cfg(test)]
#[path = "project_test.rs"]
mod tests;
