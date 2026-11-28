// @adr ADR-0005.D1
// @adr ADR-0020.D2
// @adr ADR-0021.D2
// @adr ADR-0011.D1
use regex::Regex;
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    path::Path,
    sync::{LazyLock, Mutex},
};
use tauri::State;

const LATEST_SCHEMA_VERSION: i64 = 8;

#[derive(Clone)]
pub struct Store(std::sync::Arc<Mutex<Connection>>);

#[derive(Debug, Serialize, Deserialize)]
pub struct Event {
    pub id: i64,
    pub session_id: i64,
    pub task_id: Option<i64>,
    pub kind: String,
    pub payload: Value,
    pub created_at: String,
}

impl Store {
    pub fn open(path: impl AsRef<Path>) -> Result<Self, String> {
        let mut conn = Connection::open(path).map_err(|e| e.to_string())?;
        conn.execute_batch("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;")
            .map_err(|e| e.to_string())?;
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        let version: i64 = tx
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .map_err(|e| e.to_string())?;
        if version > LATEST_SCHEMA_VERSION {
            return Err(format!("unsupported database schema version {version}"));
        }
        if version == 0 {
            tx.execute_batch(
                "CREATE TABLE sessions (id INTEGER PRIMARY KEY, state TEXT NOT NULL);
                 CREATE TABLE tasks (id INTEGER PRIMARY KEY, session_id INTEGER NOT NULL REFERENCES sessions(id), title TEXT NOT NULL, state TEXT NOT NULL, UNIQUE(id, session_id));
                 CREATE TABLE task_dependencies (session_id INTEGER NOT NULL, task_id INTEGER NOT NULL, depends_on_id INTEGER NOT NULL, PRIMARY KEY(task_id, depends_on_id), FOREIGN KEY(task_id, session_id) REFERENCES tasks(id, session_id), FOREIGN KEY(depends_on_id, session_id) REFERENCES tasks(id, session_id), CHECK(task_id != depends_on_id));
                 CREATE TABLE events (id INTEGER PRIMARY KEY, session_id INTEGER NOT NULL REFERENCES sessions(id), task_id INTEGER, kind TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')), FOREIGN KEY(task_id, session_id) REFERENCES tasks(id, session_id));
                 CREATE INDEX events_session_id_id ON events(session_id, id);
                 CREATE TABLE capability_cache (key TEXT PRIMARY KEY, value TEXT NOT NULL);
                 PRAGMA user_version = 1;"
            ).map_err(|e| e.to_string())?;
        }
        if version < 2 {
            tx.execute_batch(
                "CREATE TABLE session_plans (session_id INTEGER PRIMARY KEY REFERENCES sessions(id), plan TEXT NOT NULL);
                 ALTER TABLE sessions ADD COLUMN title TEXT NOT NULL DEFAULT '';
                 ALTER TABLE sessions ADD COLUMN workspace_path TEXT NOT NULL DEFAULT '';
                 ALTER TABLE sessions ADD COLUMN opt_in_worktree INTEGER NOT NULL DEFAULT 0;
                 ALTER TABLE sessions ADD COLUMN created_at TEXT NOT NULL DEFAULT '';
                 PRAGMA user_version = 2;"
            ).map_err(|e| e.to_string())?;
        }
        if version < 3 {
            tx.execute_batch(
                "CREATE TABLE projects (id INTEGER PRIMARY KEY, name TEXT NOT NULL, root_path TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')));
                 ALTER TABLE sessions ADD COLUMN project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL;"
            ).map_err(|e| e.to_string())?;
            let paths = {
                let mut stmt = tx.prepare("SELECT DISTINCT workspace_path FROM sessions WHERE workspace_path != ''").map_err(|e| e.to_string())?;
                let rows = stmt.query_map([], |row| row.get::<_, String>(0)).map_err(|e| e.to_string())?;
                rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?
            };
            for path in paths {
                // Old sessions can refer to deleted or non-Git workspaces; keep them unlinked.
                if let Ok((root, name)) = crate::project::repository_root(Path::new(&path)) {
                    tx.execute("INSERT INTO projects (name, root_path) VALUES (?1, ?2) ON CONFLICT(root_path) DO NOTHING", params![name, root]).map_err(|e| e.to_string())?;
                    tx.execute("UPDATE sessions SET project_id = (SELECT id FROM projects WHERE root_path = ?1) WHERE workspace_path = ?2", params![root, path]).map_err(|e| e.to_string())?;
                }
            }
            tx.pragma_update(None, "user_version", 3).map_err(|e| e.to_string())?;
        }
        if version < 4 {
            tx.execute_batch(
                "CREATE TABLE settings (key TEXT PRIMARY KEY, value_type TEXT NOT NULL, value TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')));
                 PRAGMA user_version = 4;"
            ).map_err(|e| e.to_string())?;
        }
        if version < 5 {
            tx.execute_batch(
                "CREATE TABLE IF NOT EXISTS session_title_state (session_id INTEGER PRIMARY KEY REFERENCES sessions(id), custom INTEGER NOT NULL DEFAULT 0);
                 PRAGMA user_version = 5;"
            ).map_err(|e| e.to_string())?;
        }
        if version < 6 {
            tx.execute_batch(
                "ALTER TABLE sessions ADD COLUMN concise_replies INTEGER NOT NULL DEFAULT 0;
                 PRAGMA user_version = 6;"
            ).map_err(|e| e.to_string())?;
        }
        if version < 7 {
            tx.execute_batch("ALTER TABLE sessions ADD COLUMN model TEXT; PRAGMA user_version = 7;").map_err(|e| e.to_string())?;
        }
        if version < 8 {
            tx.execute_batch(
                "CREATE TABLE teams (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, role TEXT NOT NULL CHECK(role IN ('orchestrator','sub_agents','review')), is_default INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')));
                 CREATE UNIQUE INDEX teams_default_role ON teams(role) WHERE is_default = 1;
                 CREATE TABLE team_steps (team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE, position INTEGER NOT NULL, harness TEXT NOT NULL, model TEXT, effort TEXT CHECK(effort IN ('low','medium','high') OR effort IS NULL), PRIMARY KEY(team_id, position));
                 ALTER TABLE sessions ADD COLUMN team TEXT;
                 PRAGMA user_version = 8;"
            ).map_err(|e| e.to_string())?;
        }
        tx.commit().map_err(|e| e.to_string())?;
        Ok(Self(std::sync::Arc::new(Mutex::new(conn))))
    }

    pub(crate) fn connection(&self) -> Result<std::sync::MutexGuard<'_, Connection>, String> {
        self.0
            .lock()
            .map_err(|_| "database lock poisoned".to_string())
    }


    pub fn create_session(&self, state: &str) -> Result<i64, String> {
        let conn = self.connection()?;
        conn.execute("INSERT INTO sessions (state) VALUES (?1)", [state])
            .map_err(|e| e.to_string())?;
        Ok(conn.last_insert_rowid())
    }

    pub fn create_task(&self, session_id: i64, title: &str, state: &str) -> Result<i64, String> {
        let conn = self.connection()?;
        conn.execute(
            "INSERT INTO tasks (session_id, title, state) VALUES (?1, ?2, ?3)",
            params![session_id, title, state],
        )
        .map_err(|e| e.to_string())?;
        Ok(conn.last_insert_rowid())
    }

    pub fn add_dependency(
        &self,
        session_id: i64,
        task_id: i64,
        depends_on_id: i64,
    ) -> Result<(), String> {
        let mut conn = self.connection()?;
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        let cyclic: bool = tx.query_row(
            "WITH RECURSIVE ancestors(id) AS (SELECT ?1 UNION SELECT d.depends_on_id FROM task_dependencies d JOIN ancestors a ON d.task_id = a.id) SELECT EXISTS(SELECT 1 FROM ancestors WHERE id = ?2)",
            params![depends_on_id, task_id], |row| row.get(0),
        ).map_err(|e| e.to_string())?;
        if cyclic {
            return Err("dependency would create a cycle".into());
        }
        tx.execute("INSERT INTO task_dependencies (session_id, task_id, depends_on_id) VALUES (?1, ?2, ?3)", params![session_id, task_id, depends_on_id]).map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())
    }

    pub fn append_event(
        &self,
        session_id: i64,
        task_id: Option<i64>,
        kind: &str,
        mut payload: Value,
    ) -> Result<i64, String> {
        redact_value(&mut payload);
        let payload = serde_json::to_string(&payload).map_err(|e| e.to_string())?;
        let kind = redact_text(kind);
        let conn = self.connection()?;
        conn.execute(
            "INSERT INTO events (session_id, task_id, kind, payload) VALUES (?1, ?2, ?3, ?4)",
            params![session_id, task_id, kind, payload],
        )
        .map_err(|e| e.to_string())?;
        Ok(conn.last_insert_rowid())
    }

    pub fn events(&self, session_id: i64, after_id: i64, limit: u32) -> Result<Vec<Event>, String> {
        let conn = self.connection()?;
        let mut stmt = conn.prepare("SELECT id, session_id, task_id, kind, payload, created_at FROM events WHERE session_id = ?1 AND id > ?2 ORDER BY id LIMIT ?3").map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![session_id, after_id, limit], |row| {
                let payload: String = row.get(4)?;
                Ok(Event {
                    id: row.get(0)?,
                    session_id: row.get(1)?,
                    task_id: row.get(2)?,
                    kind: row.get(3)?,
                    payload: serde_json::from_str(&payload).map_err(|e| {
                        rusqlite::Error::FromSqlConversionFailure(
                            4,
                            rusqlite::types::Type::Text,
                            Box::new(e),
                        )
                    })?,
                    created_at: row.get(5)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())
    }

    pub fn set_capability(&self, key: &str, value: &Value) -> Result<(), String> {
        let value = serde_json::to_string(value).map_err(|e| e.to_string())?;
        self.connection()?.execute("INSERT INTO capability_cache (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value", params![key, value]).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn capability(&self, key: &str) -> Result<Option<Value>, String> {
        let conn = self.connection()?;
        let value: Option<String> = conn
            .query_row(
                "SELECT value FROM capability_cache WHERE key = ?1",
                [key],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        value
            .map(|v| serde_json::from_str(&v).map_err(|e| e.to_string()))
            .transpose()
    }
}


fn redact_text(text: &str) -> String {
    static PATTERNS: LazyLock<Vec<Regex>> = LazyLock::new(|| {
        [
        r"(?is)-----BEGIN [^\-\r\n]*PRIVATE KEY-----.*?-----END [^\-\r\n]*PRIVATE KEY-----",
        r"(?i)\b(?:bearer|basic)\s+[^\s,;]+",
        r"(?i)\b(?:authorization|cookie|set-cookie)\s*:\s*[^\r\n]+",
r"(?i)(https?://)[^/@:\s]+:[^/@\s]+@([^/\s?#]+)",
        r"(?i)([?&])(?:key|sig|signature|token|access_token|refresh_token|api[_-]?key|password|secret|credential)=([^&#\s]+)",
        r#"(?i)(?:--[a-z0-9_.-]*(?:password|token|secret|key|credential)[a-z0-9_.-]*)(?:\s+|=)(?:"[^"]*"|'[^']*'|[^\s,;&]+)"#,
        r#"(?i)[a-z0-9_.-]*(?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|password|passwd|pwd|secret|credential|authorization|cookie|set-cookie|auth|session|bearer|signature)[a-z0-9_.-]*"?\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;&]+)"#,
        r"\b(?:gh[a-z]_[A-Za-z0-9_]{3,}|github_pat_[A-Za-z0-9_]{8,}|sk-[A-Za-z0-9_-]{8,}|xox[a-z]-[A-Za-z0-9-]{8,}|AKIA[A-Z0-9]{16}|AIza[A-Za-z0-9_-]{8,})\b",
        r"\beyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)?\b",
    ].iter().map(|pattern| Regex::new(pattern).expect("valid redaction pattern")).collect()
    });
    PATTERNS.iter().fold(text.to_owned(), |text, pattern| {
        pattern
            .replace_all(&text, |caps: &regex::Captures| {
                if pattern.as_str().contains("https?://") {
                    format!("{}[REDACTED]@{}", &caps[1], &caps[2])
                } else if let Some(prefix) = caps.get(1) {
                    format!("{}[REDACTED]", prefix.as_str())
                } else {
                    "[REDACTED]".to_owned()
                }
            })
            .into_owned()
    })
}

fn redact_value(value: &mut Value) {
    match value {
        Value::Object(fields) => {
            for (key, value) in fields {
                let normalized = key.to_ascii_lowercase().replace(['-', '_'], "");
                let usage_counter = normalized == "tokens"
                    || normalized.ends_with("tokens")
                    || normalized == "tokencount"
                    || normalized.ends_with("tokencount");
                if !usage_counter
                    && [
                        "token",
                        "secret",
                        "password",
                        "passwd",
                        "pwd",
                        "apikey",
                        "privatekey",
                        "authorization",
                        "auth",
                        "cookie",
                        "setcookie",
                        "credential",
                        "session",
                        "bearer",
                        "signature",
                    ]
                    .iter()
                    .any(|term| normalized.contains(term))
                {
                    *value = Value::String("[REDACTED]".into());
                } else {
                    redact_value(value);
                }
            }
        }
        Value::Array(values) => values.iter_mut().for_each(redact_value),
        Value::String(text) => *text = redact_text(text),
        _ => {}
    }
}

#[tauri::command]
pub fn db_create_task(
    store: State<'_, Store>,
    session_id: i64,
    title: String,
    state: String,
) -> Result<i64, String> {
    store.create_task(session_id, &title, &state)
}
#[tauri::command]
pub fn db_add_dependency(
    store: State<'_, Store>,
    session_id: i64,
    task_id: i64,
    depends_on_id: i64,
) -> Result<(), String> {
    store.add_dependency(session_id, task_id, depends_on_id)
}
#[tauri::command]
pub fn db_append_event(
    store: State<'_, Store>,
    session_id: i64,
    task_id: Option<i64>,
    kind: String,
    payload: Value,
) -> Result<i64, String> {
    append_frontend_event(store.inner(), session_id, task_id, &kind, payload)
}

fn append_frontend_event(store: &Store, session_id: i64, task_id: Option<i64>, kind: &str, payload: Value) -> Result<i64, String> {
    if kind == "session_usage" { return Err("session_usage is reserved for usage recording".into()); }
    store.append_event(session_id, task_id, kind, payload)
}
#[tauri::command]
pub fn db_events(
    store: State<'_, Store>,
    session_id: i64,
    after_id: i64,
    limit: u32,
) -> Result<Vec<Event>, String> {
    store.events(session_id, after_id, limit)
}
#[tauri::command]
pub fn db_set_capability(store: State<'_, Store>, key: String, value: Value) -> Result<(), String> {
    store.set_capability(&key, &value)
}
#[tauri::command]
pub fn db_capability(store: State<'_, Store>, key: String) -> Result<Option<Value>, String> {
    store.capability(&key)
}

#[cfg(test)]
#[path = "db_test.rs"]
mod tests;
