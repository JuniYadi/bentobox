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
    for _ in 0..100 { writer.push_chunk("agent_message", "hello ").unwrap(); }
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
