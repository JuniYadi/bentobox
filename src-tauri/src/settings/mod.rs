// @adr ADR-0016.D5
use crate::db::Store;
use rusqlite::{params, OptionalExtension};
use serde_json::Value;
use std::collections::BTreeMap;
use tauri::State;

#[derive(Clone, Copy)]
enum SettingType { Boolean, String }

struct SettingDef { key: &'static str, value_type: SettingType }

// No accepted decision currently defines a persisted preference.
const REGISTRY: &[SettingDef] = &[];

fn validate<'a>(registry: &'a [SettingDef], key: &str, value: Option<&Value>) -> Result<&'a SettingDef, String> {
    let def = registry.iter().find(|def| def.key == key).ok_or_else(|| format!("unknown setting: {key}"))?;
    if let Some(value) = value {
        let valid = match def.value_type { SettingType::Boolean => value.is_boolean(), SettingType::String => value.is_string() };
        if !valid { return Err(format!("wrong type for setting: {key}")); }
    }
    Ok(def)
}

impl Store {
    fn setting_get_with(&self, registry: &[SettingDef], key: &str) -> Result<Option<Value>, String> {
        let def = validate(registry, key, None)?;
        let conn = self.connection()?;
        let row: Option<(String, String)> = conn.query_row("SELECT value_type, value FROM settings WHERE key = ?1", [key], |row| Ok((row.get(0)?, row.get(1)?))).optional().map_err(|e| e.to_string())?;
        row.map(|(kind, raw)| {
            if kind != def.value_type.name() { return Err(format!("wrong stored type for setting: {key}")); }
            let value: Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
            validate(registry, key, Some(&value))?;
            Ok(value)
        }).transpose()
    }

    fn settings_get_all_with(&self, registry: &[SettingDef]) -> Result<BTreeMap<String, Value>, String> {
        let mut result = BTreeMap::new();
        for def in registry {
            if let Some(value) = self.setting_get_with(registry, def.key)? { result.insert(def.key.to_string(), value); }
        }
        Ok(result)
    }

    fn setting_set_with(&self, registry: &[SettingDef], key: &str, value: &Value) -> Result<(), String> {
        let def = validate(registry, key, Some(value))?;
        let raw = serde_json::to_string(value).map_err(|e| e.to_string())?;
        self.connection()?.execute("INSERT INTO settings (key, value_type, value) VALUES (?1, ?2, ?3) ON CONFLICT(key) DO UPDATE SET value_type = excluded.value_type, value = excluded.value, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')", params![key, def.value_type.name(), raw]).map_err(|e| e.to_string())?;
        Ok(())
    }
}

impl SettingType {
    fn name(self) -> &'static str { match self { Self::Boolean => "boolean", Self::String => "string" } }
}

/// @adr ADR-0016.D5
#[tauri::command]
pub async fn settings_get_all(store: State<'_, Store>) -> Result<BTreeMap<String, Value>, String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || store.settings_get_all_with(REGISTRY)).await.map_err(|e| e.to_string())?
}

/// @adr ADR-0016.D5
#[tauri::command]
pub async fn settings_get(store: State<'_, Store>, key: String) -> Result<Option<Value>, String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || store.setting_get_with(REGISTRY, &key)).await.map_err(|e| e.to_string())?
}

/// @adr ADR-0016.D5
#[tauri::command]
pub async fn settings_set(store: State<'_, Store>, key: String, value: Value) -> Result<(), String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || store.setting_set_with(REGISTRY, &key, &value)).await.map_err(|e| e.to_string())?
}

#[cfg(test)]
#[path = "settings_test.rs"]
mod tests;
