// @adr ADR-0010.D1
use crate::db::Store;
use rusqlite::{OptionalExtension, params};

use super::SessionSummary;

impl Store {
    pub(crate) fn mutate_plan<T>(&self, session_id: i64, mutate: impl FnOnce(Option<String>) -> Result<(String, T), String>) -> Result<T, String> {
        let mut conn = self.connection()?;
        let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate).map_err(|e| e.to_string())?;
        tx.query_row("SELECT id FROM sessions WHERE id = ?1", [session_id], |_| Ok(())).optional().map_err(|e| e.to_string())?.ok_or_else(|| "unknown session".to_string())?;
        let current = tx.query_row("SELECT plan FROM session_plans WHERE session_id = ?1", [session_id], |row| row.get(0)).optional().map_err(|e| e.to_string())?;
        let (json, result) = mutate(current)?;
        tx.execute("INSERT INTO session_plans (session_id, plan) VALUES (?1, ?2) ON CONFLICT(session_id) DO UPDATE SET plan = excluded.plan", params![session_id, json]).map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
        Ok(result)
    }

    pub(crate) fn load_plan(&self, session_id: i64) -> Result<Option<String>, String> {
        self.connection()?.query_row("SELECT plan FROM session_plans WHERE session_id = ?1", [session_id], |row| row.get(0)).optional().map_err(|e| e.to_string())
    }

    pub(crate) fn create_named_session(&self, title: &str, workspace_path: &str, opt_in_worktree: bool) -> Result<SessionSummary, String> {
        let conn = self.connection()?;
        conn.query_row("INSERT INTO sessions (state, title, workspace_path, opt_in_worktree, created_at) VALUES ('active', ?1, ?2, ?3, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) RETURNING id, title, workspace_path, opt_in_worktree, created_at", params![title, workspace_path, opt_in_worktree], session_summary).map_err(|e| e.to_string())
    }

    pub(crate) fn list_sessions(&self) -> Result<Vec<SessionSummary>, String> {
        let conn = self.connection()?;
        let mut stmt = conn.prepare("SELECT id, title, workspace_path, opt_in_worktree, created_at FROM sessions ORDER BY id DESC").map_err(|e| e.to_string())?;
        let rows = stmt.query_map([], session_summary).map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }

    pub(crate) fn set_session_worktree(&self, id: i64, enabled: bool) -> Result<SessionSummary, String> {
        self.connection()?.query_row("UPDATE sessions SET opt_in_worktree = ?2 WHERE id = ?1 RETURNING id, title, workspace_path, opt_in_worktree, created_at", params![id, enabled], session_summary).optional().map_err(|e| e.to_string())?.ok_or_else(|| "unknown session".to_string())
    }
}

fn session_summary(row: &rusqlite::Row<'_>) -> rusqlite::Result<SessionSummary> {
    Ok(SessionSummary { id: row.get(0)?, title: row.get(1)?, workspace_path: row.get(2)?, opt_in_worktree: row.get(3)?, created_at: row.get(4)? })
}
