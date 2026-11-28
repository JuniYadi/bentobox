// @adr ADR-0017.D3
use super::*;
use std::sync::Mutex;

#[test]
fn coalesces_agent_chunks_and_emits_appended_events() {
    // [ADR-0017.D3] Streaming chunks are coalesced and each persisted event is emitted.
    let store = Store::open(":memory:").unwrap();
    let session_id = store.create_session("active").unwrap();
    let emitted = Arc::new(Mutex::new(Vec::new()));
    let capture = emitted.clone();
    let emit: Emit = Arc::new(move |session, id| capture.lock().unwrap().push((session, id)));
    let mut writer = EventWriter::new(store.clone(), session_id, "task-a".into(), emit);
    for _ in 0..100 { writer.push_chunk("agent_message", "hello ", None).unwrap(); }
    writer.flush().unwrap();
    let events = store.events(session_id, 0, 100).unwrap();
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].kind, "agent_message");
    assert_eq!(events[0].task_id, None);
    assert_eq!(events[0].payload["plan_task_id"], "task-a");
    assert_eq!(events[0].payload["text"], "hello ".repeat(100));
    assert_eq!(*emitted.lock().unwrap(), [(session_id, events[0].id)]);
}

#[test]
fn limits_stderr_to_500_lines_and_a_single_notice() {
    // [ADR-0017.D3] Excess stderr cannot fill the event log.
    let store = Store::open(":memory:").unwrap();
    let session_id = store.create_session("active").unwrap();
    let mut writer = EventWriter::new(store.clone(), session_id, "task-b".into(), Arc::new(|_, _| {}));
    for _ in 0..510 { writer.stderr_line("warning").unwrap(); }
    let events = store.events(session_id, 0, 1000).unwrap();
    assert_eq!(events.len(), 501);
    assert_eq!(events[500].payload["text"], "Further stderr output was truncated");
}

#[test]
fn tool_call_and_diffs_carry_parent_tool_call_id() {
    // [ADR-0018.D4] Sub-agent and background tool-call events carry parent_tool_call_id from meta.
    use agent_client_protocol::v1::schema::{Diff, ToolCall, ToolCallContent, ToolCallId, ToolCallUpdate, ToolCallUpdateFields};
    let store = Store::open(":memory:").unwrap();
    let session_id = store.create_session("active").unwrap();
    let mut writer = EventWriter::new(store.clone(), session_id, "task-c".into(), Arc::new(|_, _| {}));
    let mut meta = serde_json::Map::new();
    meta.insert("claudeCode".into(), serde_json::json!({ "parentToolUseId": "parent-123" }));
    let mut call = ToolCall::new(ToolCallId::new("subtool-1"), "Edit file");
    call.content = vec![ToolCallContent::Diff(Diff::new("src/main.rs", "+hello"))];
    call.meta = Some(meta);
    writer.update(SessionUpdate::ToolCall(call)).unwrap();
    let events = store.events(session_id, 0, 100).unwrap();
    let diff_event = events.iter().find(|e| e.kind == "file_changed").unwrap();
    assert_eq!(diff_event.payload["parent_tool_call_id"], "parent-123");
    let tool_event = events.iter().find(|e| e.kind == "tool_call").unwrap();
    assert_eq!(tool_event.payload["parent_tool_call_id"], "parent-123");

    let mut update_meta = serde_json::Map::new();
    update_meta.insert("parent_tool_call_id".into(), serde_json::json!("parent-456"));
    let mut update = ToolCallUpdate::new(ToolCallId::new("subtool-2"), ToolCallUpdateFields::default());
    update.meta = Some(update_meta);
    writer.update(SessionUpdate::ToolCallUpdate(update)).unwrap();
    let events = store.events(session_id, 0, 100).unwrap();
    let tool2_event = events.iter().filter(|e| e.kind == "tool_call").last().unwrap();
    assert_eq!(tool2_event.payload["parent_tool_call_id"], "parent-456");
}

#[test]
fn agent_message_and_thought_chunks_carry_parent_tool_call_id_and_separate_by_parent() {
    // [ADR-0018.D4] Carry parent id through chunk path into agent_message and agent_thought; chunks with different parents are not merged.
    use agent_client_protocol::v1::schema::{ContentBlock, ContentChunk, TextContent};
    let store = Store::open(":memory:").unwrap();
    let session_id = store.create_session("active").unwrap();
    let mut writer = EventWriter::new(store.clone(), session_id, "task-d".into(), Arc::new(|_, _| {}));

    let mut chunk1 = ContentChunk::new(ContentBlock::Text(TextContent::new("hello from subagent 1")));
    let mut meta1 = serde_json::Map::new();
    meta1.insert("parent_tool_call_id".into(), serde_json::json!("parent-A"));
    chunk1.meta = Some(meta1);
    writer.update(SessionUpdate::AgentMessageChunk(chunk1)).unwrap();

    let mut chunk2 = ContentChunk::new(ContentBlock::Text(TextContent::new("hello from subagent 2")));
    let mut meta2 = serde_json::Map::new();
    meta2.insert("parent_tool_call_id".into(), serde_json::json!("parent-B"));
    chunk2.meta = Some(meta2);
    writer.update(SessionUpdate::AgentMessageChunk(chunk2)).unwrap();
    writer.flush().unwrap();

    let events = store.events(session_id, 0, 100).unwrap();
    let msgs: Vec<_> = events.iter().filter(|e| e.kind == "agent_message").collect();
    assert_eq!(msgs.len(), 2, "chunks with different parents must not be merged");
    assert_eq!(msgs[0].payload["text"], "hello from subagent 1");
    assert_eq!(msgs[0].payload["parent_tool_call_id"], "parent-A");
    assert_eq!(msgs[1].payload["text"], "hello from subagent 2");
    assert_eq!(msgs[1].payload["parent_tool_call_id"], "parent-B");
}
