// @adr ADR-0016.D2
use crate::db::Store;
use rusqlite::{OptionalExtension, params};
use serde::{Deserialize, Serialize};
use std::path::Path;
use tauri::State;

/// @adr ADR-0016.D2
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: i64,
    pub name: String,
    pub root_path: String,
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

pub(crate) fn repository_root(path: &Path) -> Result<(String, String), String> {
    let canonical = path.canonicalize().map_err(|e| format!("could not resolve project path: {e}"))?;
    let output = std::process::Command::new("git").args(["-C", canonical.to_str().ok_or("project path is not valid UTF-8")?, "rev-parse", "--show-toplevel"]).output().map_err(|e| format!("could not run git: {e}"))?;
    if !output.status.success() { return Err("path is not inside a Git repository".into()); }
    let root = String::from_utf8(output.stdout).map_err(|e| e.to_string())?.trim().to_owned();
    let root = Path::new(&root).canonicalize().map_err(|e| e.to_string())?;
    let name = root.file_name().and_then(|n| n.to_str()).ok_or("repository root has no directory name")?.to_owned();
    Ok((root.to_str().ok_or("repository path is not valid UTF-8")?.to_owned(), name))
}

impl Store {
    pub(crate) fn add_project(&self, name: &str, root_path: &str) -> Result<Project, String> {
        let conn = self.connection()?;
        conn.execute("INSERT INTO projects (name, root_path) VALUES (?1, ?2) ON CONFLICT(root_path) DO NOTHING", params![name, root_path]).map_err(|e| e.to_string())?;
        conn.query_row("SELECT id, name, root_path, created_at FROM projects WHERE root_path = ?1", [root_path], project_row).map_err(|e| e.to_string())
    }
    pub(crate) fn project_root(&self, id: i64) -> Result<String, String> {
        self.connection()?.query_row("SELECT root_path FROM projects WHERE id = ?1", [id], |row| row.get(0)).optional().map_err(|e| e.to_string())?.ok_or_else(|| "unknown project".to_string())
    }

    pub(crate) fn list_projects(&self) -> Result<Vec<Project>, String> {
        let conn = self.connection()?;
        let mut stmt = conn.prepare("SELECT id, name, root_path, created_at FROM projects ORDER BY name COLLATE NOCASE, id").map_err(|e| e.to_string())?;
        stmt.query_map([], project_row).map_err(|e| e.to_string())?.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }

    pub(crate) fn remove_project(&self, id: i64, force: bool) -> Result<(), String> {
        let conn = self.connection()?;
        let exists: bool = conn.query_row("SELECT EXISTS(SELECT 1 FROM projects WHERE id = ?1)", [id], |r| r.get(0)).map_err(|e| e.to_string())?;
        if !exists { return Err("unknown project".into()); }
        let active: bool = conn.query_row("SELECT EXISTS(SELECT 1 FROM sessions WHERE project_id = ?1 AND state != 'closed')", [id], |r| r.get(0)).map_err(|e| e.to_string())?;
        if active && !force { return Err("cannot remove project while it has sessions that are not closed".into()); }
        conn.execute("DELETE FROM projects WHERE id = ?1", [id]).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub(crate) fn project_sessions(&self, project_id: i64) -> Result<Vec<ProjectSession>, String> {
        let conn = self.connection()?;
        let mut stmt = conn.prepare("SELECT s.id, s.title, s.state, COALESCE((SELECT MAX(e.created_at) FROM events e WHERE e.session_id = s.id), s.created_at), p.plan FROM sessions s LEFT JOIN session_plans p ON p.session_id = s.id WHERE s.project_id = ?1 ORDER BY s.id DESC").map_err(|e| e.to_string())?;
        let rows = stmt.query_map([project_id], |row| {
            let plan: Option<String> = row.get(4)?;
            let parsed = plan.and_then(|raw| serde_json::from_str::<serde_json::Value>(&raw).ok());
            let phase = parsed.as_ref().and_then(|v| v.get("phase").and_then(|p| p.as_str()).map(str::to_owned));
            let task_statuses = parsed.as_ref().and_then(|v| v.get("tasks").and_then(|t| t.as_array())).map(|tasks| tasks.iter().filter_map(|t| t.get("status").and_then(|s| s.as_str()).map(str::to_owned)).collect()).unwrap_or_default();
            Ok(ProjectSession { id: row.get(0)?, title: row.get(1)?, state: row.get(2)?, last_activity_at: row.get::<_, String>(3)?, phase, task_statuses })
        }).map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }
}

fn project_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Project> {
    Ok(Project { id: row.get(0)?, name: row.get(1)?, root_path: row.get(2)?, created_at: row.get(3)? })
}

/// @adr ADR-0016.D2
#[tauri::command]
pub async fn project_add(store: State<'_, Store>, path: String) -> Result<Project, String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || { let (root, name) = repository_root(Path::new(&path))?; store.add_project(&name, &root) }).await.map_err(|e| e.to_string())?
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

#[cfg(test)]
#[path = "project_test.rs"]
mod tests;
