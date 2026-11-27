use super::*;
use serde_json::json;

// [ADR-0005.D1] Migrations are repeatable and preserve existing data.
#[test]
fn migrations_are_idempotent() {
    let path = std::env::temp_dir().join(format!(
        "bentobox-db-test-{}-{:?}.sqlite",
        std::process::id(),
        std::thread::current().id()
    ));
    let store = Store::open(&path).unwrap();
    let session = store.create_session("active").unwrap();
    drop(store);
    let reopened = Store::open(&path).unwrap();
    let conn = reopened.connection().unwrap();
    assert_eq!(
        conn.pragma_query_value(None, "user_version", |r| r.get::<_, i64>(0))
            .unwrap(),
        LATEST_SCHEMA_VERSION
    );
    assert_eq!(
        conn.query_row("SELECT state FROM sessions WHERE id = ?1", [session], |r| r
            .get::<_, String>(0))
            .unwrap(),
        "active"
    );
    drop(conn);
    drop(reopened);
    std::fs::remove_file(path).unwrap();
}

// [ADR-0005.D1] Existing version-1 databases upgrade without losing session data.
#[test]
fn version_one_database_upgrades_to_latest_schema() {
    let unique = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
    let root = std::env::temp_dir().join(format!("bentobox-db-upgrade-{}-{unique}", std::process::id()));
    std::fs::create_dir_all(&root).unwrap();
    let path = root.join("db.sqlite");
    let conn = Connection::open(&path).unwrap();
    conn.execute_batch("CREATE TABLE sessions (id INTEGER PRIMARY KEY, state TEXT NOT NULL); CREATE TABLE tasks (id INTEGER PRIMARY KEY, session_id INTEGER NOT NULL REFERENCES sessions(id), title TEXT NOT NULL, state TEXT NOT NULL, UNIQUE(id, session_id)); CREATE TABLE task_dependencies (session_id INTEGER NOT NULL, task_id INTEGER NOT NULL, depends_on_id INTEGER NOT NULL, PRIMARY KEY(task_id, depends_on_id), FOREIGN KEY(task_id, session_id) REFERENCES tasks(id, session_id), FOREIGN KEY(depends_on_id, session_id) REFERENCES tasks(id, session_id), CHECK(task_id != depends_on_id)); CREATE TABLE events (id INTEGER PRIMARY KEY, session_id INTEGER NOT NULL REFERENCES sessions(id), task_id INTEGER, kind TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')), FOREIGN KEY(task_id, session_id) REFERENCES tasks(id, session_id)); CREATE INDEX events_session_id_id ON events(session_id, id); CREATE TABLE capability_cache (key TEXT PRIMARY KEY, value TEXT NOT NULL); INSERT INTO sessions (id, state) VALUES (7, 'active'); PRAGMA user_version = 1;").unwrap();
    drop(conn);
    let store = Store::open(&path).unwrap();
    let conn = store.connection().unwrap();
    assert_eq!(conn.pragma_query_value(None, "user_version", |row| row.get::<_, i64>(0)).unwrap(), LATEST_SCHEMA_VERSION);
    assert_eq!(conn.query_row("SELECT state FROM sessions WHERE id = 7", [], |row| row.get::<_, String>(0)).unwrap(), "active");
    assert!(conn.query_row("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'session_plans'", [], |_| Ok(())).is_ok());
    for table in ["plan_tasks", "plan_task_dependencies"] {
        assert!(conn.query_row("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?1", [table], |_| Ok(())).optional().unwrap().is_none());
    }
    drop(conn);
    drop(store);
    std::fs::remove_dir_all(root).unwrap();
}

// [ADR-0010.D1] Frontend event injection cannot forge authoritative usage records.
#[test]
fn frontend_cannot_append_reserved_session_usage() {
    let store = Store::open(":memory:").unwrap();
    let session = store.create_session("active").unwrap();
    assert!(append_frontend_event(&store, session, None, "session_usage", json!({"input_tokens": 123})).is_err());
    assert!(store.events(session, 0, 10).unwrap().is_empty());
    assert!(append_frontend_event(&store, session, None, "tool", json!({})).is_ok());
    assert!(store.append_event(session, None, "session_usage", json!({"input_tokens": 123})).is_ok());
}

// [ADR-0005.D1] Tasks and event references stay in their session; dependency graphs are acyclic.
#[test]
fn graph_and_event_relationships() {
    let store = Store::open(":memory:").unwrap();
    let first = store.create_session("active").unwrap();
    let second = store.create_session("active").unwrap();
    let a = store.create_task(first, "a", "pending").unwrap();
    let b = store.create_task(first, "b", "pending").unwrap();
    let c = store.create_task(first, "c", "pending").unwrap();
    let other = store.create_task(second, "other", "pending").unwrap();
    store.add_dependency(first, a, b).unwrap();
    store.add_dependency(first, b, c).unwrap();
    assert!(store.add_dependency(first, c, a).is_err());
    assert!(store.add_dependency(first, a, a).is_err());
    assert!(store.add_dependency(first, a, b).is_err());
    assert!(store.add_dependency(first, a, other).is_err());
    assert!(
        store
            .append_event(first, Some(other), "tool", json!({}))
            .is_err()
    );
    assert!(store.create_task(-1, "orphan", "pending").is_err());
}

// [ADR-0005.D1] Neither structured nor recognizable textual credentials reach the event table.
#[test]
fn events_are_redacted_before_storage() {
    let store = Store::open(":memory:").unwrap();
    let session = store.create_session("active").unwrap();
    store.append_event(session, None, "tool", json!({"nested": [{"api_key": "key-secret-value"}, {"output": "Bearer bearer-secret password=hunter2 ghp_abcdefghijk"}], "message": "safe"})).unwrap();
    let conn = store.connection().unwrap();
    let raw: String = conn
        .query_row("SELECT payload FROM events", [], |r| r.get(0))
        .unwrap();
    for secret in [
        "key-secret-value",
        "bearer-secret",
        "hunter2",
        "ghp_abcdefghijk",
    ] {
        assert!(!raw.contains(secret), "leaked {secret}");
    }
    drop(conn);
    let events = store.events(session, 0, 10).unwrap();
    assert_eq!(events[0].payload["message"], "safe");
    assert_eq!(events[0].payload["nested"][0]["api_key"], "[REDACTED]");
    assert!(store.events(session, events[0].id, 10).unwrap().is_empty());
    store
        .set_capability("agent", &json!({"tools": true}))
        .unwrap();
    assert_eq!(
        store.capability("agent").unwrap(),
        Some(json!({"tools": true}))
    );
}

// [ADR-0005.D1] Deep event payloads are traversed once and sensitive values are removed.
#[test]
fn deeply_nested_payload_is_redacted_promptly() {
    let _ = redact_text("warm up patterns");
    let mut payload = json!({"password": "deep-secret"});
    for _ in 0..40 {
        payload = json!({"child": payload});
    }
    let start = std::time::Instant::now();
    redact_value(&mut payload);
    assert!(start.elapsed() < std::time::Duration::from_millis(100));
    assert!(!payload.to_string().contains("deep-secret"));
}

// [ADR-0005.D1] Textual credentials are removed from event payloads and kinds.
#[test]
fn text_redaction_covers_credentials_in_common_formats() {
    let cases = [
        ("GITHUB_TOKEN=ghx_abc", "ghx_abc"),
        ("DB_PASSWORD=hunter2", "hunter2"),
        ("AWS_SECRET_ACCESS_KEY=aws-secret-value", "aws-secret-value"),
        (r#"{"password": "hunter two"}"#, "hunter two"),
        (r#"{"api_key":"abcdef"}"#, "abcdef"),
        (r#"password="my pass word""#, "my pass word"),
        ("Authorization: Token abc123\nnext line", "abc123"),
        ("Cookie: session=abc123\nnext line", "abc123"),
        ("Set-Cookie: session=abc123; HttpOnly\nnext line", "abc123"),
        ("--password hunter2", "hunter2"),
        ("--token=x", "x"),
        ("https://user:pass123@host/path", "pass123"),
        (
            "https://host/path?key=abc&sig=zzz&access_token=secretvalue",
            "abc",
        ),
        (
            "https://host/path?key=abc&sig=zzz&access_token=secretvalue",
            "zzz",
        ),
        (
            "https://host/path?key=abc&sig=zzz&access_token=secretvalue",
            "secretvalue",
        ),
        ("ghx_abcd1234", "ghx_abcd1234"),
        ("github_pat_abcd1234", "github_pat_abcd1234"),
        ("sk-abcd1234", "sk-abcd1234"),
        ("xoxb-abcd1234", "xoxb-abcd1234"),
        ("AKIAABCDEFGHIJKLMNOP", "AKIAABCDEFGHIJKLMNOP"),
        ("AIzaabcd12345678", "AIzaabcd12345678"),
        (
            "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature",
            "eyJhbGciOiJIUzI1NiJ9",
        ),
    ];
    for (text, secret) in cases {
        let redacted = redact_text(text);
        assert!(!redacted.contains(secret), "leaked {secret} in {redacted}");
    }
    assert!(redact_text("https://user:pass123@host/path").contains("host/path"));
    assert!(redact_text("Authorization: Token abc123\nnext line").contains("next line"));
}

// [ADR-0005.D1] Secret keys are redacted without discarding usage counters.
#[test]
fn sensitive_keys_and_token_usage_counters_are_distinguished() {
    let mut payload = json!({
        "Cookie": "cookie-secret", "SET-COOKIE": "set-cookie-secret",
        "auth": "auth-secret", "passwd": "passwd-secret", "PWD": "pwd-secret",
        "session": "session-secret", "bearer": "bearer-secret",
        "signature": "signature-secret", "access_token": "token-secret",
        "max_tokens": 1, "input_tokens": 2, "output_tokens": 3,
        "total_tokens": 4, "cached_tokens": 5, "token_count": 6,
        "input_token_count": 7
    });
    redact_value(&mut payload);
    for key in [
        "Cookie",
        "SET-COOKIE",
        "auth",
        "passwd",
        "PWD",
        "session",
        "bearer",
        "signature",
        "access_token",
    ] {
        assert_eq!(payload[key], "[REDACTED]", "key {key}");
    }
    for (key, count) in [
        ("max_tokens", 1),
        ("input_tokens", 2),
        ("output_tokens", 3),
        ("total_tokens", 4),
        ("cached_tokens", 5),
        ("token_count", 6),
        ("input_token_count", 7),
    ] {
        assert_eq!(payload[key], count, "key {key}");
    }
}
