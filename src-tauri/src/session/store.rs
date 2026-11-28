// @adr ADR-0010.D1
// @adr ADR-0020.D2
// @adr ADR-0021.D2
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

    pub(crate) fn create_named_session(&self, title: &str, project_id: i64, workspace_path: &str, opt_in_worktree: bool) -> Result<SessionSummary, String> {
        let conn = self.connection()?;
        let summary = conn.query_row("INSERT INTO sessions (state, title, project_id, workspace_path, opt_in_worktree, created_at) VALUES ('active', ?1, ?2, ?3, ?4, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) RETURNING id, title, workspace_path, opt_in_worktree, created_at, concise_replies, model", params![title, project_id, workspace_path, opt_in_worktree], session_summary).map_err(|e| e.to_string())?;
        if !title.is_empty() && title != "New session" {
            let _ = conn.execute("INSERT OR REPLACE INTO session_title_state (session_id, custom) VALUES (?1, 1)", [summary.id]);
        }
        Ok(summary)
    }

    /// @adr ADR-0018.D5
    pub(crate) fn set_placeholder_title(&self, id: i64, title: &str) -> Result<(), String> {
        let conn = self.connection()?;
        let is_custom: bool = conn.query_row("SELECT custom FROM session_title_state WHERE session_id = ?1", [id], |r| r.get(0)).unwrap_or(0) == 1;
        if !is_custom {
            let _ = conn.execute("UPDATE sessions SET title = ?1 WHERE id = ?2 AND (title = '' OR title = 'New session')", params![title, id]);
        }
        Ok(())
    }

    /// @adr ADR-0018.D5
    pub(crate) fn update_generated_title(&self, id: i64, title: &str) -> Result<bool, String> {
        let conn = self.connection()?;
        let is_custom: bool = conn.query_row("SELECT custom FROM session_title_state WHERE session_id = ?1", [id], |r| r.get(0)).unwrap_or(0) == 1;
        if is_custom {
            return Ok(false);
        }
        let rows = conn.execute("UPDATE sessions SET title = ?1 WHERE id = ?2", params![title, id]).unwrap_or(0);
        Ok(rows > 0)
    }


    pub(crate) fn list_sessions(&self) -> Result<Vec<SessionSummary>, String> {
        let conn = self.connection()?;
        let mut stmt = conn.prepare("SELECT id, title, workspace_path, opt_in_worktree, created_at, concise_replies, model FROM sessions ORDER BY id DESC").map_err(|e| e.to_string())?;
        let rows = stmt.query_map([], session_summary).map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }

    pub(crate) fn set_session_worktree(&self, id: i64, enabled: bool) -> Result<SessionSummary, String> {
        self.connection()?.query_row("UPDATE sessions SET opt_in_worktree = ?2 WHERE id = ?1 RETURNING id, title, workspace_path, opt_in_worktree, created_at, concise_replies, model", params![id, enabled], session_summary).optional().map_err(|e| e.to_string())?.ok_or_else(|| "unknown session".to_string())
    }

    /// @adr ADR-0020.D2
    pub(crate) fn set_session_concise(&self, id: i64, enabled: bool) -> Result<(), String> {
        let changed = self.connection()?.execute("UPDATE sessions SET concise_replies = ?2 WHERE id = ?1", params![id, enabled]).map_err(|e| e.to_string())?;
        if changed == 0 { return Err("unknown session".into()); }
        Ok(())
    }

    /// @adr ADR-0020.D2
    pub(crate) fn session_concise(&self, id: i64) -> Result<bool, String> {
        self.connection()?.query_row("SELECT concise_replies FROM sessions WHERE id = ?1", [id], |row| row.get(0)).optional().map_err(|e| e.to_string())?.ok_or_else(|| "unknown session".to_string())
    }

    /// @adr ADR-0021.D2
    pub(crate) fn set_session_model(&self, id: i64, model: Option<&str>) -> Result<(), String> {
        let changed = self.connection()?.execute("UPDATE sessions SET model = ?2 WHERE id = ?1", params![id, model]).map_err(|e| e.to_string())?;
        if changed == 0 { return Err("unknown session".into()); }
        Ok(())
    }

    /// @adr ADR-0021.D2
    pub(crate) fn session_model(&self, id: i64) -> Result<Option<String>, String> {
        self.connection()?.query_row("SELECT model FROM sessions WHERE id = ?1", [id], |row| row.get(0)).optional().map_err(|e| e.to_string())?.ok_or_else(|| "unknown session".to_string())
    }
}

fn session_summary(row: &rusqlite::Row<'_>) -> rusqlite::Result<SessionSummary> {
    Ok(SessionSummary { id: row.get(0)?, title: row.get(1)?, workspace_path: row.get(2)?, opt_in_worktree: row.get(3)?, created_at: row.get(4)?, concise_replies: row.get(5)?, model: row.get(6)? })
}
