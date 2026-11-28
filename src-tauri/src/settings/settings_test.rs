use super::*;
use serde_json::json;
use std::time::{SystemTime, UNIX_EPOCH};

const TEST_REGISTRY: &[SettingDef] = &[
    SettingDef { key: "test.boolean", value_type: SettingType::Boolean },
    SettingDef { key: "test.string", value_type: SettingType::String },
];

fn temp() -> std::path::PathBuf {
    let root = std::env::temp_dir().join(format!("bentobox-settings-{}-{}", std::process::id(), SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()));
    std::fs::create_dir_all(&root).unwrap();
    root
}

// [ADR-0016.D5] Typed settings roundtrip and overwrite.
#[test]
fn roundtrip() {
    let store = Store::open(":memory:").unwrap();
    assert_eq!(store.setting_get_with(TEST_REGISTRY, "test.boolean").unwrap(), None);
    store.setting_set_with(TEST_REGISTRY, "test.boolean", &json!(true)).unwrap();
    store.setting_set_with(TEST_REGISTRY, "test.string", &json!("first")).unwrap();
    store.setting_set_with(TEST_REGISTRY, "test.string", &json!("second")).unwrap();
    let values = store.settings_get_all_with(TEST_REGISTRY).unwrap();
    assert_eq!(values.get("test.boolean"), Some(&json!(true)));
    assert_eq!(values.get("test.string"), Some(&json!("second")));
}

// [ADR-0016.D5] Unknown keys are rejected, including by the empty production registry.
#[test]
fn rejects_unknown_key() {
    let store = Store::open(":memory:").unwrap();
    assert!(store.setting_get_with(TEST_REGISTRY, "unknown").is_err());
    assert!(store.setting_set_with(TEST_REGISTRY, "unknown", &json!(true)).is_err());
    assert!(store.setting_set_with(REGISTRY, "test.boolean", &json!(true)).is_err());
    assert!(store.settings_get_all_with(REGISTRY).unwrap().is_empty());
}

// [ADR-0016.D5] Wrong value types cannot be stored.
#[test]
fn rejects_wrong_type() {
    let store = Store::open(":memory:").unwrap();
    assert!(store.setting_set_with(TEST_REGISTRY, "test.boolean", &json!("true")).is_err());
    assert!(store.setting_set_with(TEST_REGISTRY, "test.string", &json!(false)).is_err());
    assert!(store.settings_get_all_with(TEST_REGISTRY).unwrap().is_empty());
}

// [ADR-0016.D5] Settings survive reopening the database.
#[test]
fn persists_after_reopen() {
    let root = temp();
    let path = root.join("db.sqlite");
    {
        let store = Store::open(&path).unwrap();
        store.setting_set_with(TEST_REGISTRY, "test.string", &json!("persisted")).unwrap();
    }
    {
        let store = Store::open(&path).unwrap();
        assert_eq!(store.setting_get_with(TEST_REGISTRY, "test.string").unwrap(), Some(json!("persisted")));
    }
    std::fs::remove_dir_all(root).unwrap();
}

// [ADR-0016.D5] A version-three database migrates without losing existing data.
#[test]
fn migrates_v3() {
    let root = temp();
    let path = root.join("db.sqlite");
    {
        let store = Store::open(&path).unwrap();
        let conn = store.connection().unwrap();
        conn.execute_batch("CREATE TABLE sentinel (value TEXT NOT NULL); INSERT INTO sentinel VALUES ('kept'); ALTER TABLE sessions DROP COLUMN concise_replies; DROP TABLE settings; PRAGMA user_version = 3;").unwrap();
    }
    {
        let store = Store::open(&path).unwrap();
        let conn = store.connection().unwrap();
        let version: i64 = conn.pragma_query_value(None, "user_version", |row| row.get(0)).unwrap();
        let sentinel: String = conn.query_row("SELECT value FROM sentinel", [], |row| row.get(0)).unwrap();
        assert_eq!(version, 6);
        assert_eq!(sentinel, "kept");
        drop(conn);
        store.setting_set_with(TEST_REGISTRY, "test.boolean", &json!(true)).unwrap();
        assert_eq!(store.setting_get_with(TEST_REGISTRY, "test.boolean").unwrap(), Some(json!(true)));
    }
    std::fs::remove_dir_all(root).unwrap();
}
