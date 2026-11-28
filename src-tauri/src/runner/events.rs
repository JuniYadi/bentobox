// @adr ADR-0017.D3
use crate::db::Store;
use agent_client_protocol::v1::schema::{ContentBlock, SessionUpdate, ToolCallContent};
use std::collections::HashMap;
use serde_json::{Value, json};
use std::sync::Arc;

const CHUNK_LIMIT: usize = 4096;
const STDERR_LIMIT: usize = 500;

/// @adr ADR-0017.D3
pub(crate) type Emit = Arc<dyn Fn(i64, i64) + Send + Sync>;

/// @adr ADR-0017.D3
pub(crate) struct EventWriter {
    store: Store,
    session_id: i64,
    task_id: String,
    branch: Option<String>,
    emit: Emit,
    chunk_kind: Option<&'static str>,
    chunk_parent: Option<String>,
    chunk: String,
    stderr_lines: usize,
    tools: HashMap<String, Value>,
}

impl EventWriter {
    /// @adr ADR-0017.D3
    pub(crate) fn new(store: Store, session_id: i64, task_id: String, emit: Emit) -> Self {
        Self { store, session_id, task_id, branch: None, emit, chunk_kind: None, chunk_parent: None, chunk: String::new(), stderr_lines: 0, tools: HashMap::new() }
    }

    /// @adr ADR-0017.D3
    pub(crate) fn set_branch(&mut self, branch: Option<String>) { self.branch = branch; }

    /// @adr ADR-0017.D3
    pub(crate) fn append(&self, kind: &str, mut payload: Value) -> Result<i64, String> {
        let fields = payload.as_object_mut().ok_or("runner event payload must be an object")?;
        fields.insert("plan_task_id".into(), json!(self.task_id));
        if let Some(branch) = &self.branch { fields.insert("branch".into(), json!(branch)); }
        let id = self.store.append_event(self.session_id, None, kind, payload)?;
        (self.emit)(self.session_id, id);
        Ok(id)
    }

    /// @adr ADR-0018.D4
    pub(crate) fn push_chunk(&mut self, kind: &'static str, text: &str, parent: Option<String>) -> Result<(), String> {
        if self.chunk_kind.is_some_and(|previous| previous != kind) || self.chunk_parent != parent { self.flush()?; }
        self.chunk_kind = Some(kind);
        self.chunk_parent = parent;
        self.chunk.push_str(text);
        if self.chunk.len() > CHUNK_LIMIT { self.flush()?; }
        Ok(())
    }

    /// @adr ADR-0018.D4
    pub(crate) fn flush(&mut self) -> Result<(), String> {
        if !self.chunk.is_empty() {
            let kind = self.chunk_kind.expect("chunk has a kind");
            let mut payload = json!({"text": self.chunk});
            if let Some(parent) = &self.chunk_parent {
                payload["parent_tool_call_id"] = json!(parent);
            }
            self.append(kind, payload)?;
            self.chunk.clear();
        }
        self.chunk_kind = None;
        self.chunk_parent = None;
        Ok(())
    }

    /// @adr ADR-0017.D3
    pub(crate) fn update(&mut self, update: SessionUpdate) -> Result<(), String> {
        match update {
            SessionUpdate::AgentMessageChunk(chunk) => {
                let parent = extract_parent_tool_call_id(&chunk.meta);
                if let ContentBlock::Text(text) = chunk.content {
                    self.push_chunk("agent_message", &text.text, parent)?;
                }
            }
            SessionUpdate::AgentThoughtChunk(chunk) => {
                let parent = extract_parent_tool_call_id(&chunk.meta);
                if let ContentBlock::Text(text) = chunk.content {
                    self.push_chunk("agent_thought", &text.text, parent)?;
                }
            }
            SessionUpdate::ToolCall(call) => {
                self.flush()?;
                let id = call.tool_call_id.0.to_string();
                let mut fields = serde_json::to_value(&call).map_err(|e| e.to_string())?;
                let parent = extract_parent_tool_call_id(&call.meta);
                self.emit_diffs(&call.content, parent.as_deref())?;
                let object = fields.as_object_mut().ok_or("invalid ACP tool call")?;
                if let Some(parent_id) = &parent { object.insert("parent_tool_call_id".into(), json!(parent_id)); }
                object.insert("kind".into(), json!(call.kind));
                object.insert("status".into(), json!(call.status));
                object.insert("tool".into(), json!(call.name.unwrap_or(call.title)));
                self.tools.insert(id.clone(), fields.clone());
                self.tool_event(&id, &fields)?;
            },
            SessionUpdate::ToolCallUpdate(call) => {
                self.flush()?;
                let id = call.tool_call_id.0.to_string();
                let update_meta = extract_parent_tool_call_id(&call.meta);
                let update = serde_json::to_value(&call.fields).map_err(|e| e.to_string())?;
                let mut fields = self.tools.remove(&id).unwrap_or_else(|| json!({}));
                let object = fields.as_object_mut().ok_or("invalid ACP tool call")?;
                if let Some(update) = update.as_object() {
                    for (key, value) in update { if !value.is_null() { object.insert(key.clone(), value.clone()); } }
                }
                if let Some(parent_id) = update_meta { object.insert("parent_tool_call_id".into(), json!(parent_id)); }
                let parent = object.get("parent_tool_call_id").and_then(Value::as_str);
                if let Some(content) = &call.fields.content { self.emit_diffs(content, parent)?; }
                if let Some(name) = object.get("name").or_else(|| object.get("title")).cloned() { object.insert("tool".into(), name); }
                self.tool_event(&id, &fields)?;
                self.tools.insert(id, fields);
            },
            _ => {}
        }
        Ok(())
    }

    fn emit_diffs(&self, contents: &[ToolCallContent], parent: Option<&str>) -> Result<(), String> {
        for content in contents {
            if let ToolCallContent::Diff(diff) = content {
                let mut payload = json!({"path": diff.path});
                if let Some(parent) = parent { payload["parent_tool_call_id"] = json!(parent); }
                self.append("file_changed", payload)?;
            }
        }
        Ok(())
    }

    fn tool_event(&self, id: &str, fields: &Value) -> Result<(), String> {
        let mut payload = json!({"tool_call_id": id, "tool": fields.get("tool"), "kind": fields.get("kind"), "status": fields.get("status")});
        let target = fields.get("locations").and_then(Value::as_array).and_then(|v| v.first()).and_then(|v| v.get("path"));
        if let Some(target) = target { payload["target"] = target.clone(); }
        let output = fields.get("rawOutput").filter(|output| !output.is_null()).map(|output| match output {
            Value::String(text) => text.clone(),
            other => other.to_string(),
        }).or_else(|| fields.get("content").and_then(Value::as_array).and_then(|items| items.iter().find_map(|item| item.get("content").and_then(|content| content.get("text")).and_then(Value::as_str).map(str::to_owned))));
        if let Some(output) = output { payload["output"] = json!(output); }
        if let Some(parent) = fields.get("parent_tool_call_id").and_then(Value::as_str) {
            payload["parent_tool_call_id"] = json!(parent);
        }
        self.append("tool_call", payload)?;
        Ok(())
    }

    /// @adr ADR-0017.D3
    pub(crate) fn stderr_line(&mut self, line: &str) -> Result<(), String> {
        if self.stderr_lines < STDERR_LIMIT {
            self.append("agent_log", json!({"text": line}))?;
        } else if self.stderr_lines == STDERR_LIMIT {
            self.append("agent_log", json!({"text": "Further stderr output was truncated"}))?;
        }
        self.stderr_lines = self.stderr_lines.saturating_add(1);
        Ok(())
    }
}

fn extract_parent_tool_call_id(meta: &Option<agent_client_protocol::v1::schema::Meta>) -> Option<String> {
    let meta = meta.as_ref()?;
    if let Some(id) = meta.get("parent_tool_call_id").or_else(|| meta.get("parentToolCallId")).and_then(Value::as_str) {
        return Some(id.to_string());
    }
    if let Some(claude) = meta.get("claudeCode").or_else(|| meta.get("claude_code")) {
        if let Some(id) = claude.get("parentToolUseId").or_else(|| claude.get("parent_tool_use_id")).and_then(Value::as_str) {
            return Some(id.to_string());
        }
    }
    None
}

#[cfg(test)]
#[path = "events_test.rs"]
mod tests;
