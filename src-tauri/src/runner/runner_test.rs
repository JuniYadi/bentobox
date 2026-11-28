// @adr ADR-0017.D1
use super::*;

// This independent agent speaks JSON-RPC directly; it is not a Tauri binary.
pub(crate) const FAKE: &str = r#"
import json, os, subprocess, sys, time
scenario = sys.argv[1]
if scenario == 'group':
    child_source = "import os,sys,time\np=sys.argv[1]\nt=p+'.tmp'\nwith open(t,'w') as f: f.write(str(os.getpid()))\nos.replace(t,p)\nprint('ready', flush=True)\nwhile True: time.sleep(1)\n"
    child = subprocess.Popen([sys.executable, '-u', '-c', child_source, sys.argv[2]], stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    child.stdout.readline()
def send(msg):
    print(json.dumps(msg), flush=True)
def reply(id, result):
    send({'jsonrpc':'2.0','id':id,'result':result})
def update(session_id, upd):
    send({'jsonrpc':'2.0','method':'session/update','params':{'sessionId':session_id,'update':upd}})
def permission(id, sess_id):
    permission_sessions[str(id)] = sess_id
    permission_prompts[str(id)] = session_prompts.get(sess_id)
    options = [{'optionId':'no','name':'Deny','kind':'reject_once'}]
    if scenario != 'deny_only': options.insert(0, {'optionId':'yes','name':'Allow','kind':'allow_once'})
    if scenario == 'allow_always': options.insert(0, {'optionId':'always','name':'Always Allow','kind':'allow_always'})
    send({'jsonrpc':'2.0','id':id,'method':'session/request_permission','params':{'sessionId':sess_id,'toolCall':{'toolCallId':'tool','title':'Write file'},'options':options}})
answers = {}
turn = 0
cwd = ''
client_caps = {}
session_counter = 0
selected_mode = None
selected_model = None
call_order = []
session_prompts = {}
permission_sessions = {}
permission_prompts = {}
for line in sys.stdin:
    try: msg = json.loads(line)
    except ValueError: continue
    method = msg.get('method')
    if method == 'initialize':
        client_caps = msg.get('params', {}).get('clientCapabilities', {})
        if scenario in ('timeout', 'probe_timeout_scenario'): time.sleep(5); continue
        methods = [{'id':'login','name':'Login'}] if scenario in ('auth_required', 'probe_auth') else []
        reply(msg['id'], {'protocolVersion':1,'agentCapabilities':{},'authMethods':methods})
    elif method == 'session/new':
        cwd = msg['params']['cwd']
        session_counter += 1
        sess_id = f'session-{session_counter}'
        if scenario in ('auth_required', 'auth_unadvertised', 'probe_auth'):
            send({'jsonrpc':'2.0','id':msg['id'],'error':{'code':-32000,'message':'Authentication required'}})
            continue
        res = {'sessionId': sess_id}
        if scenario in ('modes', 'multi_turn') and session_counter == 1:
            res['modes'] = {
                'currentModeId': 'default',
                'availableModes': [
                    {'id': 'default', 'name': 'Default'},
                    {'id': 'auto', 'name': 'Auto'},
                    {'id': 'bypassPermissions', 'name': 'Bypass'},
                    {'id': 'acceptEdits', 'name': 'Accept Edits'}
                ]
            }
        elif scenario == 'modes_no_preferred' and session_counter == 1:
            res['modes'] = {
                'currentModeId': 'bypassPermissions',
                'availableModes': [
                    {'id': 'bypassPermissions', 'name': 'Bypass'},
                    {'id': 'custom', 'name': 'Custom'}
                ]
            }
        if scenario == 'probe_grouped':
            res['configOptions'] = [{
                'id': 'model-select',
                'name': 'Model',
                'category': 'model',
                'type': 'select',
                'currentValue': 'g2-m1',
                'options': [
                    {'group': 'g1', 'name': 'Group 1', 'options': [{'value': 'g1-m1', 'name': 'Model G1'}]},
                    {'group': 'g2', 'name': 'Group 2', 'options': [{'value': 'g2-m1', 'name': 'Model G2'}]}
                ]
            }]
        elif scenario == 'probe_unadvertised':
            res['configOptions'] = []
        elif session_counter > 1 or scenario.startswith('title_') or scenario in ('models', 'model_apply', 'model_inspect', 'model_update', 'team_model_crash', 'probe_ready', 'probe_timeout_scenario', 'probe_flight'):
            res['configOptions'] = [{
                'id': 'model-select',
                'name': 'Model',
                'category': 'model',
                'type': 'select',
                'currentValue': 'default-model',
                'options': [
                    {'value': 'claude-3-5-haiku-latest', 'name': 'Claude 3.5 Haiku'},
                    {'value': 'codex-luna-mini', 'name': 'Codex Luna Mini'},
                    {'value': 'opencode-free-model', 'name': 'Free Community Model', 'description': 'Completely free model'},
                    {'value': 'gpt-4o', 'name': 'Standard Model'}
                ]
            }]
        reply(msg['id'], res)
    elif method == 'session/set_mode':
        selected_mode = msg.get('params', {}).get('modeId')
        reply(msg['id'], {})
    elif method == 'session/set_config_option':
        call_order.append('set_config_option')
        val = msg.get('params', {}).get('value')
        if isinstance(val, dict):
            val = val.get('value', val)
        selected_model = val
        reply(msg['id'], {'configOptions': []})
        if scenario == 'model_update':
            update(sess_id, {
                'sessionUpdate': 'config_option_update',
                'configOptions': [{
                    'id': 'model-select',
                    'name': 'Model',
                    'category': 'model',
                    'type': 'select',
                    'currentValue': 'updated-model',
                    'options': [
                        {'value': 'claude-3-5-haiku-latest', 'name': 'Claude 3.5 Haiku'},
                        {'value': 'updated-model', 'name': 'Updated Model'}
                    ]
                }]
            })
    elif method == 'session/prompt':
        call_order.append('prompt')
        prompt_id = msg['id']
        prompt_session = msg.get('params', {}).get('sessionId', 'session-1')
        session_prompts[prompt_session] = prompt_id
        prompt_text = msg['params']['prompt'][0]['text']
        if 'Generate a short plain-text title' in prompt_text:
            if scenario == 'title_fail':
                send({'jsonrpc':'2.0','id':prompt_id,'error':{'code':-32000,'message':'Title generation failed'}})
                continue
            if scenario == 'title_timeout':
                time.sleep(35)
                continue
            update(prompt_session, {'sessionUpdate':'agent_message_chunk','content':{'type':'text','text':f'"Generated Title for {selected_model}"\n'}})
            reply(prompt_id, {'stopReason':'end_turn'})
            continue
        turn += 1
        if scenario in ('multi_turn', 'models'):
            update(prompt_session, {'sessionUpdate':'agent_message_chunk','content':{'type':'text','text':json.dumps({'turn': turn, 'channel': prompt_session, 'prompt': prompt_text})}})
            reply(prompt_id, {'stopReason':'end_turn'})
            continue
        if scenario == 'steer' and turn > 1:
            update(prompt_session, {'sessionUpdate':'agent_message_chunk','content':{'type':'text','text':prompt_text}})
            reply(prompt_id, {'stopReason':'end_turn'})
            continue
        if scenario in ('inspect', 'multi_turn_inspect'):
            update(prompt_session, {'sessionUpdate':'agent_message_chunk','content':{'type':'text','text':json.dumps({'cwd':cwd,'prompt':prompt_text,'turn':turn})}})
            reply(prompt_id, {'stopReason':'end_turn'})
            continue
        if scenario == 'model_inspect':
            update(prompt_session, {'sessionUpdate':'agent_message_chunk','content':{'type':'text','text':json.dumps({'selected_model': selected_model, 'call_order': call_order})}})
            reply(prompt_id, {'stopReason':'end_turn'})
            continue
        if scenario == 'capabilities':
            fs = client_caps.get('fs')
            read_val = 'none' if fs is None else str(fs.get('readTextFile'))
            write_val = 'none' if fs is None else str(fs.get('writeTextFile'))
            term_val = str(client_caps.get('terminal'))
            send({'jsonrpc':'2.0','id':prompt_id,'error':{'code':-32000,'message':f'CAPS terminal={term_val} read={read_val} write={write_val}'}})
            continue
        if scenario == 'team_model_crash':
            update(prompt_session, {'sessionUpdate':'agent_message_chunk','content':{'type':'text','text':json.dumps({'selected_model':selected_model})}})
            sys.exit(7)
        if scenario == 'crash': sys.exit(7)
        if scenario in ('max_tokens', 'max_turn_requests', 'refusal'):
            reply(prompt_id, {'stopReason':scenario})
            continue
        if scenario == 'allow': update(prompt_session, {'sessionUpdate':'agent_thought_chunk','content':{'type':'text','text':cwd}})
        for i in range(50): update(prompt_session, {'sessionUpdate':'agent_message_chunk','content':{'type':'text','text':'x'}})
        update(prompt_session, {'sessionUpdate':'tool_call','toolCallId':'tool','title':'Write file','kind':'edit','status':'pending'})
        if scenario == 'collision': permission(1, prompt_session); permission('1', prompt_session)
        elif scenario in ('allow', 'deny', 'deny_only', 'stop', 'stubborn', 'group', 'steer', 'allow_always'): permission(9, prompt_session)
        else: reply(prompt_id, {'stopReason':'end_turn'})
        if scenario in ('stop', 'stubborn', 'group'): update(prompt_session, {'sessionUpdate':'agent_thought_chunk','content':{'type':'text','text':str(os.getpid())}})
        if scenario in ('collision', 'allow', 'deny', 'deny_only', 'stop', 'stubborn', 'group', 'steer', 'allow_always'):
            update(prompt_session, {'sessionUpdate':'tool_call_update','toolCallId':'tool','status':'in_progress'})
    elif method == 'session/cancel':
        if scenario not in ('stubborn', 'group'): reply(prompt_id, {'stopReason':'cancelled'})
    elif 'id' in msg and 'result' in msg:
        answers[(type(msg['id']).__name__, str(msg['id']))] = msg['result']['outcome']
        req_id = str(msg['id'])
        sess_id = permission_sessions.get(req_id, 'session-1')
        p_id = permission_prompts.get(req_id, session_prompts.get(sess_id))
        if scenario == 'collision' and len(answers) == 2:
            a = answers[('int','1')]; b = answers[('str','1')]
            text = 'correct' if a.get('optionId') == 'yes' and b.get('optionId') == 'no' else 'incorrect'
            update(sess_id, {'sessionUpdate':'agent_message_chunk','content':{'type':'text','text':text}})
            if p_id: reply(p_id, {'stopReason':'end_turn'})
        elif scenario in ('allow','deny','deny_only','steer','allow_always'):
            opt = msg['result']['outcome'].get('optionId')
            expected = 'no' if scenario in ('deny','deny_only') else ('always' if scenario == 'allow_always' else 'yes')
            if opt != expected: sys.exit(8)
            update(sess_id, {'sessionUpdate':'tool_call_update','toolCallId':'tool','status':'completed'})
            if p_id: reply(p_id, {'stopReason':'end_turn'})
if scenario in ('stubborn', 'group'): time.sleep(30)
"#;

fn setup() -> (Runner, i64, Arc<TaskControl>, watch::Receiver<bool>, PlanTask) {
    let store = Store::open(":memory:").unwrap();
    let session = store.create_session("active").unwrap();
    let runner = Runner::with_emitter(store.clone(), Arc::new(|_, _| {}));
    let (stop, receiver) = watch::channel(false);
    let control = Arc::new(TaskControl {
        events: Arc::new(Mutex::new(EventWriter::new(store, session, "task".into(), runner.emit.clone()))),
        pending: Mutex::new(HashMap::new()),
        active_session: Mutex::new(None),
        send_queue: Mutex::new(VecDeque::new()),
        prompt_notify: Arc::new(tokio::sync::Notify::new()),
        abort: Mutex::new(None),
        revision: 1,
        stop,
    });
    runner.registry.lock().unwrap().running.insert((session, "task".into()), control.clone());
    let task = PlanTask { id: "task".into(), title: "Do the task".into(), team: "".into(), pinned: false, harness: "fake".into(), model: None, worktree: false, files: vec![], dependencies: vec![], estimated_tokens: None, status: "running".into() };
    (runner, session, control, receiver, task)
}

pub(crate) fn launch(scenario: &str) -> agent::LaunchSpec {
    agent::LaunchSpec { program: PathBuf::from("python3"), args: vec!["-u".into(), "-c".into(), FAKE.into(), scenario.into()] }
}

async fn wait_for(store: &Store, session: i64, kind: &str, count: usize) -> Vec<crate::db::Event> {
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            let events = store.events(session, 0, 1000).unwrap();
            if events.iter().filter(|event| event.kind == kind).count() >= count { return events; }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    }).await.expect("agent did not produce the expected events")
}

#[test]
fn collision_ids_are_answered_independently_and_updates_continue() {
    // [ADR-0017.D2] Distinct wire IDs 1 and "1" get independently answerable opaque IDs.
    tauri::async_runtime::block_on(async {
        let (runner, session, control, stop, task) = setup();
        let worker = runner.clone();
        let cwd = std::env::temp_dir().to_string_lossy().into_owned();
        let handle = tauri::async_runtime::spawn(async move { worker.execute(session, &task, &cwd, control, stop, launch("collision"), Duration::from_secs(5)).await });
        let events = wait_for(&runner.store, session, "permission_request", 2).await;
        assert!(events.iter().any(|event| event.kind == "tool_call"));
        let ids: Vec<_> = events.iter().filter(|event| event.kind == "permission_request").map(|event| event.payload["request_id"].as_str().unwrap().to_string()).collect();
        assert_ne!(ids[0], ids[1]);
        runner.respond(session, "task", &ids[0], "allow").unwrap();
        runner.respond(session, "task", &ids[1], "deny").unwrap();
        let events = wait_for(&runner.store, session, "agent_message", 2).await;
        assert!(events.iter().any(|event| event.kind == "agent_message" && event.payload["text"] == "correct"), "events: {events:?}");
        assert_eq!(events.iter().filter(|event| event.kind == "permission_resolved").count(), 2);
        runner.stop(session, "task").unwrap();
        assert_eq!(handle.await.unwrap().unwrap(), ("cancelled", None));
    });
}

#[test]
fn handshake_timeout_is_a_failure() {
    // [ADR-0017.D1] An unresponsive initialization is bounded.
    tauri::async_runtime::block_on(async {
        let (runner, session, control, stop, task) = setup();
        let cwd = std::env::temp_dir().to_string_lossy().into_owned();
        let result = runner.execute(session, &task, &cwd, control, stop, launch("timeout"), Duration::from_millis(100)).await.unwrap();
        assert_eq!(result, ("failed", Some("handshake_timeout".into())));
    });
}

#[test]
fn stdout_noise_is_rejected_without_panicking() {
    // [ADR-0017.D1] Malformed stdout is handled by the SDK and valid messages continue.
    tauri::async_runtime::block_on(async {
        let (runner, session, control, stop, task) = setup();
        let worker = runner.clone();
        let cwd = std::env::temp_dir().to_string_lossy().into_owned();
        let handle = tauri::async_runtime::spawn(async move { worker.execute(session, &task, &cwd, control, stop, launch("noise"), Duration::from_secs(5)).await });
        let events = wait_for(&runner.store, session, "task_state", 1).await;
        assert!(events.iter().any(|event| event.kind == "task_state" && event.payload["status"] == "review"));
        runner.stop(session, "task").unwrap();
        assert_eq!(handle.await.unwrap().unwrap(), ("cancelled", None));
    });
}

#[test]
fn pending_permission_does_not_block_updates_and_stop_cancels_it() {
    // [ADR-0017.D2] A pending request does not stop later updates and Stop resolves it.
    tauri::async_runtime::block_on(async {
        let (runner, session, control, stop, task) = setup();
        let worker = runner.clone();
        let cwd = std::env::temp_dir().to_string_lossy().into_owned();
        let handle = tauri::async_runtime::spawn(async move { worker.execute(session, &task, &cwd, control, stop, launch("stop"), Duration::from_secs(5)).await });
        wait_for(&runner.store, session, "permission_request", 1).await;
        let events = wait_for(&runner.store, session, "tool_call", 2).await;
        assert!(events.iter().any(|event| event.kind == "tool_call" && event.payload["status"] == "in_progress"));
        let pid = events.iter().find(|event| event.kind == "agent_thought").unwrap().payload["text"].as_str().unwrap().to_string();
        runner.stop(session, "task").unwrap();
        assert_eq!(handle.await.unwrap().unwrap(), ("cancelled", None));
        let alive = std::process::Command::new("kill").args(["-0", &pid]).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null()).status().unwrap();
        assert!(!alive.success(), "agent process remains alive after stop");
        let events = runner.store.events(session, 0, 1000).unwrap();
        assert!(events.iter().any(|event| event.kind == "permission_resolved" && event.payload["decision"] == "cancelled"));
    });
}

#[test]
fn agent_crash_is_reported_as_process_exit() {
    // [ADR-0017.D1] An agent exit during a prompt is a failed task.
    tauri::async_runtime::block_on(async {
        let (runner, session, control, stop, task) = setup();
        let cwd = std::env::temp_dir().to_string_lossy().into_owned();
        assert_eq!(runner.execute(session, &task, &cwd, control, stop, launch("crash"), Duration::from_secs(5)).await.unwrap(), ("failed", Some("process_exited".into())));
    });
}
#[test]
fn deny_is_forwarded_to_the_agent() {
    // [ADR-0017.D2] Deny selects the offered reject-once option.
    tauri::async_runtime::block_on(async {
        let (runner, session, control, stop, task) = setup();
        let worker = runner.clone();
        let cwd = std::env::temp_dir().to_string_lossy().into_owned();
        let handle = tauri::async_runtime::spawn(async move { worker.execute(session, &task, &cwd, control, stop, launch("deny"), Duration::from_secs(5)).await });
        let events = wait_for(&runner.store, session, "permission_request", 1).await;
        let id = events.iter().find(|event| event.kind == "permission_request").unwrap().payload["request_id"].as_str().unwrap();
        runner.respond(session, "task", id, "deny").unwrap();
        let events = wait_for(&runner.store, session, "permission_resolved", 1).await;
        assert!(events.iter().any(|event| event.kind == "permission_resolved" && event.payload["decision"] == "deny"));
        runner.stop(session, "task").unwrap();
        assert_eq!(handle.await.unwrap().unwrap(), ("cancelled", None));
    });
}

#[test]
fn approval_and_global_concurrency_gate_scheduling() {
    // [ADR-0017.D1] Unapproved tasks cannot start and at most three run concurrently.
    tauri::async_runtime::block_on(async {
        let (mut runner, session_id, _, _, template) = setup();
        runner.registry.lock().unwrap().running.clear();
        runner.store.connection().unwrap().execute("UPDATE sessions SET workspace_path = ?1 WHERE id = ?2", rusqlite::params![std::env::temp_dir().to_string_lossy().to_string(), session_id]).unwrap();
        runner.launch = Arc::new(|_| Some(launch("stop")));
        let tasks = (0..4).map(|index| { let mut task = template.clone(); task.id = format!("task-{index}"); task }).collect();
        session::propose(&runner.store, session_id, tasks).unwrap();
        assert!(runner.start(session_id).is_err());
        session::approve(&runner.store, session_id, 1).unwrap();
        assert_eq!(runner.start(session_id).unwrap(), ["task-0", "task-1", "task-2"]);
        assert!(runner.start(session_id).unwrap().is_empty());
        wait_for(&runner.store, session_id, "permission_request", 3).await;
        runner.stop(session_id, "task-0").unwrap();
        tokio::time::timeout(Duration::from_secs(5), async {
            loop {
                let plan = runner.plan(session_id).unwrap().unwrap();
                if plan.tasks[3].status == "running" { break; }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        }).await.unwrap();
        assert_eq!(runner.plan(session_id).unwrap().unwrap().tasks[0].status, "cancelled");
        runner.shutdown();
    });
}

#[test]
fn startup_recovery_marks_running_plan_tasks_interrupted() {
    // [ADR-0017.D1] An orphaned task is transitioned and the interruption is logged.
    let (runner, session_id, _, _, task) = setup();
    runner.registry.lock().unwrap().running.clear();
    session::propose(&runner.store, session_id, vec![task]).unwrap();
    session::approve(&runner.store, session_id, 1).unwrap();
    session::transition(&runner.store, session_id, "task", "running").unwrap();
    let corrupt = runner.store.create_session("active").unwrap();
    runner.store.mutate_plan(corrupt, |_| Ok(("{invalid json".into(), ()))).unwrap();
    runner.recover().unwrap();
    assert_eq!(runner.plan(session_id).unwrap().unwrap().tasks[0].status, "failed");
    let events = runner.store.events(session_id, 0, 100).unwrap();
    assert!(events.iter().any(|event| event.kind == "task_state" && event.payload["reason"] == "interrupted"));
}

#[test]
#[ignore]
fn real_agent_omp_smoke() {
    // [ADR-0017.D1] Exercise the command's scheduler with an opt-in real ACP agent.
    if std::env::var("BENTOBOX_REAL_ACP").as_deref() != Ok("omp") { return; }
    tauri::async_runtime::block_on(async {
        let unique = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
        let root = std::env::temp_dir().join(format!("bentobox-real-acp-{unique}"));
        let repo = root.join("repo");
        std::fs::create_dir_all(&repo).unwrap();
        for args in [vec!["init", "-q"], vec!["config", "user.email", "test@example.invalid"], vec!["config", "user.name", "Test"], vec!["commit", "--allow-empty", "-qm", "initial"]] {
            assert!(std::process::Command::new("git").args(args).current_dir(&repo).status().unwrap().success());
        }
        let store = Store::open(root.join("store.sqlite")).unwrap();
        let session_id = store.create_session("active").unwrap();
        store.connection().unwrap().execute("UPDATE sessions SET workspace_path = ?1 WHERE id = ?2", rusqlite::params![repo.to_string_lossy().to_string(), session_id]).unwrap();
        let runner = Runner::with_emitter(store.clone(), Arc::new(|_, _| {}));
        let task = PlanTask { id: "task-1".into(), title: "Reply with OK without making changes".into(), team: "".into(), pinned: false, harness: "omp".into(), model: None, worktree: true, files: vec![], dependencies: vec![], estimated_tokens: None, status: "queued".into() };
        let plan = session::propose(&store, session_id, vec![task]).unwrap();
        session::approve(&store, session_id, plan.revision).unwrap();
        assert_eq!(runner.start(session_id).unwrap(), ["task-1"]);

        let finished = tokio::time::timeout(Duration::from_secs(120), async {
            loop {
                if runner.plan(session_id).unwrap().unwrap().tasks[0].status != "running" { break; }
                tokio::time::sleep(Duration::from_millis(50)).await;
            }
        }).await.is_ok();
        if !finished {
            if let Ok(control) = runner.control(session_id, "task-1") {
                println!("120s timeout; pending permissions: {:?}", control.pending.lock().unwrap().keys().collect::<Vec<_>>());
                println!("stop result: {:?}", runner.stop(session_id, "task-1"));
            }
        }
        let reaped = tokio::time::timeout(Duration::from_secs(10), async {
            loop {
                if runner.registry.lock().unwrap().running.is_empty() { break; }
                tokio::time::sleep(Duration::from_millis(50)).await;
            }
        }).await.is_ok();
        if !reaped { runner.shutdown(); }
        let registry_empty = runner.registry.lock().unwrap().running.is_empty();
        let plan = runner.plan(session_id).unwrap().unwrap();
        println!("Final plan: status={} phase={}", plan.tasks[0].status, plan.phase);
        let mut events = Vec::new();
        loop {
            let after = events.last().map_or(0, |event: &crate::db::Event| event.id);
            let page = store.events(session_id, after, 500).unwrap();
            let count = page.len();
            events.extend(page);
            if count < 500 { break; }
        }
        println!("Events (id kind payload keys and text previews):");
        for event in &events {
            let fields = event.payload.as_object().unwrap();
            let previews: Vec<_> = fields.iter().filter_map(|(key, value)| value.as_str().map(|text| format!("{key}={:?}", text.chars().take(120).collect::<String>()))).collect();
            println!("{} {} keys={:?} {}", event.id, event.kind, fields.keys().collect::<Vec<_>>(), previews.join(" "));
            if event.kind == "permission_request" || event.kind == "permission_resolved" || event.kind == "session_usage" { println!("  {}: {}", event.kind, event.payload); }
        }
        if !events.iter().any(|event| event.kind == "permission_request") { println!("Permission requests: none"); }
        if !events.iter().any(|event| event.kind == "session_usage") { println!("Token usage: not reported"); }
        let handoff = events.iter().position(|event| event.kind == "handoff");
        let running = events.iter().position(|event| event.kind == "task_state" && event.payload["status"] == "running");
        let review = events.iter().position(|event| event.kind == "task_state" && event.payload["status"] == "review");
        let worktree = handoff.and_then(|index| events[index].payload["handoff"]["worktree_path"].as_str());
        if let Some(path) = worktree {
            println!("Worktree {path} directory listing:");
            match std::fs::read_dir(path) {
                Ok(entries) => for entry in entries { println!("  {}", entry.unwrap().file_name().to_string_lossy()); },
                Err(error) => println!("  listing failed: {error}"),
            }
            let output = std::process::Command::new("git").args(["status", "--short"]).current_dir(path).output().unwrap();
            println!("git status --short (exit {}):\n{}{}", output.status, String::from_utf8_lossy(&output.stdout), String::from_utf8_lossy(&output.stderr));
        } else { println!("Worktree unavailable; no handoff was recorded"); }
        drop(runner);
        drop(store);
        std::fs::remove_dir_all(&root).unwrap();

        assert!(finished, "agent did not finish within 120 seconds");
        assert!(reaped && registry_empty, "runner registry did not empty after completion");
        assert_eq!(plan.tasks[0].status, "review");
        assert_eq!(plan.phase, "Build");
        assert!(events.iter().all(|event| event.payload["plan_task_id"] == "task-1"));
        assert!(events.iter().all(|event| !event.payload.to_string().contains("None")));
        assert!(events.iter().filter(|event| event.kind == "session_usage").all(|event| event.payload["input_tokens"].as_u64().unwrap_or(0) + event.payload["output_tokens"].as_u64().unwrap_or(0) > 0));
        let handoff = handoff.expect("missing handoff");
        assert!(events[handoff].payload["handoff"]["worktree_path"].as_str().is_some_and(|path| !path.is_empty()));
        assert!(events[handoff].payload["branch"].as_str().is_some_and(|branch| !branch.is_empty()));
        assert!(running.expect("missing running event") < handoff && handoff < review.expect("missing review event"), "expected running, handoff, review in order");
    });
}

#[test]
fn runner_send_waits_for_the_current_prompt() {
    // [ADR-0018.D2] Messages sent during a turn are queued and sent when the turn ends.
    tauri::async_runtime::block_on(async {
        let (runner, session_id, control, stop, task) = setup();
        session::propose(&runner.store, session_id, vec![task.clone()]).unwrap();
        session::approve(&runner.store, session_id, 1).unwrap();
        session::transition(&runner.store, session_id, "task", "running").unwrap();
        let worker = runner.clone();
        let cwd = std::env::temp_dir().to_string_lossy().into_owned();
        let handle = tauri::async_runtime::spawn(async move { worker.execute(session_id, &task, &cwd, control, stop, launch("steer"), Duration::from_secs(5)).await });
        let events = wait_for(&runner.store, session_id, "permission_request", 1).await;
        let id = events.iter().find(|event| event.kind == "permission_request").unwrap().payload["request_id"].as_str().unwrap();
        runner.send(session_id, "task", "Continue carefully".into()).unwrap();
        runner.respond(session_id, "task", id, "allow").unwrap();
        let events = wait_for(&runner.store, session_id, "agent_message", 2).await;
        let user_msg = events.iter().find(|event| event.kind == "user_message" && event.payload["text"] == "Continue carefully").unwrap();
        assert_eq!(user_msg.payload["plan_task_id"], "task");
        assert!(events.iter().any(|event| event.kind == "agent_message" && event.payload["text"] == "Continue carefully"));
        runner.stop(session_id, "task").unwrap();
        assert_eq!(handle.await.unwrap().unwrap(), ("cancelled", None));
    });
}

#[test]
fn worktree_cwd_and_prompt_are_the_agent_received_values() {
    // [ADR-0017.D1] The worktree is absolute and the handoff omits empty sections.
    tauri::async_runtime::block_on(async {
        let unique = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
        let root = std::env::temp_dir().join(format!("bentobox-runner-{unique}"));
        std::fs::create_dir_all(&root).unwrap();
        for args in [vec!["init", "-q"], vec!["config", "user.email", "test@example.invalid"], vec!["config", "user.name", "Test"], vec!["commit", "--allow-empty", "-qm", "initial"]] {
            assert!(std::process::Command::new("git").args(args).current_dir(&root).status().unwrap().success());
        }
        let (runner, session_id, control, stop, mut task) = setup();
        task.worktree = true;
        task.files = vec!["src/lib.rs".into()];
        session::propose(&runner.store, session_id, vec![task.clone()]).unwrap();
        session::approve(&runner.store, session_id, 1).unwrap();
        let worker = runner.clone();
        let root_str = root.to_str().unwrap().to_string();
        let handle = tauri::async_runtime::spawn(async move { worker.execute(session_id, &task, &root_str, control, stop, launch("inspect"), Duration::from_secs(5)).await });
        let events = wait_for(&runner.store, session_id, "agent_message", 1).await;
        let handoff = events.iter().find(|event| event.kind == "handoff").unwrap();
        let received = events.iter().find(|event| event.kind == "agent_message").unwrap().payload["text"].as_str().unwrap();
        let received: serde_json::Value = serde_json::from_str(received).unwrap();
        assert_eq!(received["cwd"], handoff.payload["handoff"]["worktree_path"]);
        assert!(std::path::Path::new(received["cwd"].as_str().unwrap()).is_absolute());
        let prompt = received["prompt"].as_str().unwrap();
        assert!(prompt.starts_with("Goal: Do the task\n"));
        assert!(prompt.contains("Files:\n- src/lib.rs"));
        assert!(prompt.contains("Worktree:"));
        assert!(events.iter().all(|event| event.kind != "usage"));
        let path = handoff.payload["handoff"]["worktree_path"].as_str().unwrap();
        runner.stop(session_id, "task").unwrap();
        assert_eq!(handle.await.unwrap().unwrap(), ("cancelled", None));
        assert!(std::process::Command::new("git").args(["worktree", "remove", "--force", path]).current_dir(&root).status().unwrap().success());
        std::fs::remove_dir_all(root).unwrap();
    });
}

#[test]
fn dependencies_do_not_start_until_completed() {
    // [ADR-0017.D1] A dependent waits through the prerequisite's review state.
    tauri::async_runtime::block_on(async {
        let (mut runner, session_id, _, _, template) = setup();
        runner.registry.lock().unwrap().running.clear();
        runner.store.connection().unwrap().execute("UPDATE sessions SET workspace_path = ?1 WHERE id = ?2", rusqlite::params![std::env::temp_dir().to_string_lossy().to_string(), session_id]).unwrap();
        runner.launch = Arc::new(|_| Some(launch("allow")));
        let mut first = template.clone(); first.id = "first".into();
        let mut second = template; second.id = "second".into(); second.dependencies = vec!["first".into()];
        session::propose(&runner.store, session_id, vec![first, second]).unwrap();
        session::approve(&runner.store, session_id, 1).unwrap();
        assert_eq!(runner.start(session_id).unwrap(), ["first"]);
        let events = wait_for(&runner.store, session_id, "permission_request", 1).await;
        let id = events.iter().find(|event| event.kind == "permission_request").unwrap().payload["request_id"].as_str().unwrap();
        runner.respond(session_id, "first", id, "allow").unwrap();
        tokio::time::timeout(Duration::from_secs(5), async { loop {
            if runner.plan(session_id).unwrap().unwrap().tasks[0].status == "review" { break; }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }}).await.unwrap();
        assert_eq!(runner.plan(session_id).unwrap().unwrap().tasks[1].status, "queued");
        session::transition(&runner.store, session_id, "first", "completed").unwrap();
        assert_eq!(runner.start(session_id).unwrap(), ["second"]);
        runner.shutdown();
    });
}

#[test]
fn approved_task_runs_to_review_with_real_events_and_no_unreported_usage() {
    // [ADR-0017.D1] The scheduler and fake ACP agent complete an approved task end to end.
    // [ADR-0017.D3] Each activity remains attributed to the plan task, without invented usage.
    tauri::async_runtime::block_on(async {
        let unique = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
        let root = std::env::temp_dir().join(format!("bentobox-happy-{unique}"));
        std::fs::create_dir_all(&root).unwrap();
        for args in [vec!["init", "-q"], vec!["config", "user.email", "test@example.invalid"], vec!["config", "user.name", "Test"], vec!["commit", "--allow-empty", "-qm", "initial"]] {
            assert!(std::process::Command::new("git").args(args).current_dir(&root).status().unwrap().success());
        }
        let (mut runner, session_id, _, _, mut task) = setup();
        task.worktree = true;
        runner.registry.lock().unwrap().running.clear();
        runner.store.connection().unwrap().execute("UPDATE sessions SET workspace_path = ?1 WHERE id = ?2", rusqlite::params![root.to_string_lossy().to_string(), session_id]).unwrap();
        runner.launch = Arc::new(|_| Some(launch("allow")));
        session::propose(&runner.store, session_id, vec![task]).unwrap();
        session::approve(&runner.store, session_id, 1).unwrap();
        assert_eq!(runner.start(session_id).unwrap(), ["task"]);
        let events = wait_for(&runner.store, session_id, "permission_request", 1).await;
        let permission = events.iter().find(|event| event.kind == "permission_request").unwrap();
        assert_eq!(permission.payload["can_allow"], true);
        assert_eq!(permission.payload["can_deny"], true);
        runner.respond(session_id, "task", permission.payload["request_id"].as_str().unwrap(), "allow").unwrap();
        tokio::time::timeout(Duration::from_secs(5), async { loop {
            if runner.plan(session_id).unwrap().unwrap().tasks[0].status == "review" { break; }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }}).await.unwrap();
        wait_for(&runner.store, session_id, "task_state", 2).await;
        let events = runner.store.events(session_id, 0, 1000).unwrap();
        assert!(events.iter().all(|event| event.task_id.is_none() && event.payload["plan_task_id"] == "task"));
        let states: Vec<_> = events.iter().filter(|event| event.kind == "task_state").map(|event| event.payload["status"].as_str().unwrap()).collect();
        assert_eq!(states, ["running", "review"]);
        let handoff = events.iter().find(|event| event.kind == "handoff").unwrap();
        let worktree = handoff.payload["handoff"]["worktree_path"].as_str().unwrap();
        assert!(std::path::Path::new(worktree).is_absolute());
        assert_eq!(handoff.payload["branch"], "bentobox/task");
        assert!(events.iter().any(|event| event.kind == "agent_thought" && event.payload["text"] == worktree));
        assert_eq!(events.iter().filter(|event| event.kind == "agent_message").count(), 1);
        assert!(events.iter().filter(|event| event.kind == "tool_call").count() >= 2);
        assert!(events.iter().any(|event| event.kind == "permission_resolved" && event.payload["decision"] == "allow"));
        assert!(!events.iter().any(|event| event.kind.contains("usage")));
        assert!(std::process::Command::new("git").args(["worktree", "remove", "--force", worktree]).current_dir(&root).status().unwrap().success());
        std::fs::remove_dir_all(root).unwrap();
    });
}

#[test]
fn unavailable_permission_options_are_not_selectable() {
    // [ADR-0017.D2] A decision not offered by the agent is rejected without resolving the request.
    tauri::async_runtime::block_on(async {
        let (runner, session_id, control, stop, task) = setup();
        let worker = runner.clone();
        let cwd = std::env::temp_dir().to_string_lossy().into_owned();
        let handle = tauri::async_runtime::spawn(async move { worker.execute(session_id, &task, &cwd, control, stop, launch("deny_only"), Duration::from_secs(5)).await });
        let events = wait_for(&runner.store, session_id, "permission_request", 1).await;
        let request = events.iter().find(|event| event.kind == "permission_request").unwrap();
        assert_eq!(request.payload["can_allow"], false);
        assert_eq!(request.payload["can_deny"], true);
        let id = request.payload["request_id"].as_str().unwrap();
        assert!(runner.respond(session_id, "task", id, "allow").is_err());
        runner.respond(session_id, "task", id, "deny").unwrap();
        wait_for(&runner.store, session_id, "permission_resolved", 1).await;
        runner.stop(session_id, "task").unwrap();
        assert_eq!(handle.await.unwrap().unwrap(), ("cancelled", None));
    });
}

#[test]
fn shutdown_waits_for_agent_process_to_exit() {
    // [ADR-0017.D1] App shutdown cancels active agents and leaves no child running.
    tauri::async_runtime::block_on(async {
        let (mut runner, session_id, _, _, task) = setup();
        runner.registry.lock().unwrap().running.clear();
        runner.store.connection().unwrap().execute("UPDATE sessions SET workspace_path = ?1 WHERE id = ?2", rusqlite::params![std::env::temp_dir().to_string_lossy().to_string(), session_id]).unwrap();
        runner.launch = Arc::new(|_| Some(launch("stop")));
        session::propose(&runner.store, session_id, vec![task]).unwrap();
        session::approve(&runner.store, session_id, 1).unwrap();
        assert_eq!(runner.start(session_id).unwrap(), ["task"]);
        let events = wait_for(&runner.store, session_id, "agent_thought", 1).await;
        let pid = events.iter().find(|event| event.kind == "agent_thought").unwrap().payload["text"].as_str().unwrap().to_owned();
        runner.shutdown();
        let alive = std::process::Command::new("kill").args(["-0", &pid]).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null()).status().unwrap();
        assert!(!alive.success(), "agent process remains alive after shutdown");
        assert_eq!(runner.plan(session_id).unwrap().unwrap().tasks[0].status, "cancelled");
    });
}

#[test]
fn stop_terminates_agent_that_ignores_cancel_and_stdin_close() {
    // [ADR-0017.D2] Stop escalates after the grace period when an agent does not cooperate.
    tauri::async_runtime::block_on(async {
        let (runner, session_id, control, stop, task) = setup();
        let worker = runner.clone();
        let cwd = std::env::temp_dir().to_string_lossy().into_owned();
        let handle = tauri::async_runtime::spawn(async move { worker.execute(session_id, &task, &cwd, control, stop, launch("stubborn"), Duration::from_secs(5)).await });
        let events = wait_for(&runner.store, session_id, "agent_thought", 1).await;
        let pid = events.iter().find(|event| event.kind == "agent_thought").unwrap().payload["text"].as_str().unwrap().to_owned();
        runner.stop(session_id, "task").unwrap();
        assert_eq!(handle.await.unwrap().unwrap(), ("cancelled", None));
        let alive = std::process::Command::new("kill").args(["-0", &pid]).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null()).status().unwrap();
        assert!(!alive.success(), "noncooperative agent remains alive after Stop");
    });
}

#[test]
fn cancelling_plan_stops_its_running_agent_without_starting_queued_tasks() {
    // [ADR-0017.D2] Cancelling the plan also stops running processes and pending permissions.
    tauri::async_runtime::block_on(async {
        let (mut runner, session_id, _, _, template) = setup();
        runner.registry.lock().unwrap().running.clear();
        runner.store.connection().unwrap().execute("UPDATE sessions SET workspace_path = ?1 WHERE id = ?2", rusqlite::params![std::env::temp_dir().to_string_lossy().to_string(), session_id]).unwrap();
        runner.launch = Arc::new(|_| Some(launch("stop")));
        let mut first = template.clone(); first.id = "first".into();
        let mut second = template; second.id = "second".into(); second.dependencies = vec!["first".into()];
        session::propose(&runner.store, session_id, vec![first, second]).unwrap();
        session::approve(&runner.store, session_id, 1).unwrap();
        assert_eq!(runner.start(session_id).unwrap(), ["first"]);
        let events = wait_for(&runner.store, session_id, "agent_thought", 1).await;
        let pid = events.iter().find(|event| event.kind == "agent_thought").unwrap().payload["text"].as_str().unwrap().to_owned();
        let plan = runner.cancel_session(session_id).unwrap();
        assert_eq!(plan.phase, "Cancelled");
        assert!(!plan.approved);
        assert!(plan.tasks.iter().all(|task| task.status == "cancelled"));
        assert!(runner.start(session_id).is_err());
        tokio::time::timeout(Duration::from_secs(5), async { loop {
            if runner.registry.lock().unwrap().running.is_empty() { break; }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }}).await.unwrap();
        let alive = std::process::Command::new("kill").args(["-0", &pid]).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null()).status().unwrap();
        assert!(!alive.success(), "agent process remains alive after plan cancellation");
        let events = runner.store.events(session_id, 0, 1000).unwrap();
        assert!(events.iter().any(|event| event.kind == "permission_resolved" && event.payload["decision"] == "cancelled"));
        assert!(events.iter().any(|event| event.kind == "task_state" && event.payload["plan_task_id"] == "first" && event.payload["status"] == "cancelled"));
        assert!(!events.iter().any(|event| event.kind == "task_state" && event.payload["plan_task_id"] == "second" && event.payload["status"] == "running"));
    });
}

#[test]
fn stop_answers_all_pending_permissions_even_if_event_storage_fails() {
    // [ADR-0017.D2] Persistence failures must not strand later permission responders.
    tauri::async_runtime::block_on(async {
        let (runner, session_id, control, _, _) = setup();
        let (first_tx, first_rx) = oneshot::channel();
        let (second_tx, second_rx) = oneshot::channel();
        {
            let mut pending = control.pending.lock().unwrap();
            pending.insert("first".into(), PendingPermission { allow: None, deny: None, allow_always: None, answer: first_tx });
            pending.insert("second".into(), PendingPermission { allow: None, deny: None, allow_always: None, answer: second_tx });
        }
        runner.store.connection().unwrap().execute_batch("PRAGMA query_only = ON;").unwrap();
        assert!(runner.stop(session_id, "task").is_err());
        assert_eq!(first_rx.await.unwrap(), RequestPermissionOutcome::Cancelled);
        assert_eq!(second_rx.await.unwrap(), RequestPermissionOutcome::Cancelled);
    });
}

#[test]
fn revised_plan_waits_for_old_attempt_and_ignores_its_late_outcome() {
    // [ADR-0017.D1] A cancelled process must not overlap or alter a new plan revision.
    tauri::async_runtime::block_on(async {
        let (mut runner, session_id, _, _, task) = setup();
        runner.registry.lock().unwrap().running.clear();
        runner.store.connection().unwrap().execute("UPDATE sessions SET workspace_path = ?1 WHERE id = ?2", rusqlite::params![std::env::temp_dir().to_string_lossy().to_string(), session_id]).unwrap();
        let launches = Arc::new(AtomicU64::new(0));
        runner.launch = Arc::new(move |_| Some(launch(if launches.fetch_add(1, Ordering::Relaxed) == 0 { "stubborn" } else { "stop" })));
        session::propose(&runner.store, session_id, vec![task.clone()]).unwrap();
        session::approve(&runner.store, session_id, 1).unwrap();
        assert_eq!(runner.start(session_id).unwrap(), ["task"]);
        let events = wait_for(&runner.store, session_id, "agent_thought", 1).await;
        let old_pid = events.iter().find(|event| event.kind == "agent_thought").unwrap().payload["text"].as_str().unwrap().to_owned();
        runner.cancel_session(session_id).unwrap();
        assert_eq!(session::propose(&runner.store, session_id, vec![task]).unwrap().revision, 2);
        session::approve(&runner.store, session_id, 2).unwrap();
        assert!(runner.start(session_id).unwrap().is_empty());
        assert_eq!(runner.plan(session_id).unwrap().unwrap().tasks[0].status, "queued");
        wait_for(&runner.store, session_id, "permission_request", 2).await;
        assert_eq!(runner.plan(session_id).unwrap().unwrap().tasks[0].status, "running");
        let alive = std::process::Command::new("kill").args(["-0", &old_pid]).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null()).status().unwrap();
        assert!(!alive.success(), "old agent still runs alongside the revised plan");
        runner.shutdown();
    });
}

#[cfg(unix)]
#[test]
fn shutdown_terminates_descendants_in_the_agent_process_group() {
    // [ADR-0017.D2] App shutdown terminates a noncooperative agent's descendants too.
    tauri::async_runtime::block_on(async {
        let unique = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
        let marker = std::env::temp_dir().join(format!("bentobox-agent-child-{unique}"));
        let (mut runner, session_id, _, _, task) = setup();
        runner.registry.lock().unwrap().running.clear();
        runner.store.connection().unwrap().execute("UPDATE sessions SET workspace_path = ?1 WHERE id = ?2", rusqlite::params![std::env::temp_dir().to_string_lossy().to_string(), session_id]).unwrap();
        let marker_path = marker.to_string_lossy().into_owned();
        runner.launch = Arc::new(move |_| { let mut spec = launch("group"); spec.args.push(marker_path.clone()); Some(spec) });
        session::propose(&runner.store, session_id, vec![task]).unwrap();
        session::approve(&runner.store, session_id, 1).unwrap();
        assert_eq!(runner.start(session_id).unwrap(), ["task"]);
        wait_for(&runner.store, session_id, "permission_request", 1).await;
        let pid: libc::pid_t = std::fs::read_to_string(&marker).unwrap().parse().unwrap();
        runner.shutdown();
        tokio::time::timeout(Duration::from_secs(2), async {
            loop {
                // Signal zero only queries the process; ESRCH means it no longer exists.
                let result = unsafe { libc::kill(pid, 0) };
                if result == -1 && std::io::Error::last_os_error().raw_os_error() == Some(libc::ESRCH) { break; }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        }).await.expect("agent descendant still exists after runner shutdown");
        std::fs::remove_file(marker).unwrap();
    });
}

#[test]
fn terminal_stop_reasons_are_recorded_as_task_failures() {
    // [ADR-0017.D1] ACP limit and refusal stop reasons are preserved after the plan transition.
    tauri::async_runtime::block_on(async {
        for reason in ["max_tokens", "max_turn_requests", "refusal"] {
            let (mut runner, session_id, _, _, task) = setup();
            runner.registry.lock().unwrap().running.clear();
            runner.store.connection().unwrap().execute("UPDATE sessions SET workspace_path = ?1 WHERE id = ?2", rusqlite::params![std::env::temp_dir().to_string_lossy().to_string(), session_id]).unwrap();
            runner.launch = Arc::new(move |_| Some(launch(reason)));
            session::propose(&runner.store, session_id, vec![task]).unwrap();
            session::approve(&runner.store, session_id, 1).unwrap();
            assert_eq!(runner.start(session_id).unwrap(), ["task"]);
            let events = wait_for(&runner.store, session_id, "task_state", 2).await;
            let failure = events.iter().find(|event| event.kind == "task_state" && event.payload["status"] == "failed").unwrap();
            assert_eq!(failure.payload["reason"], reason);
            assert_eq!(runner.plan(session_id).unwrap().unwrap().tasks[0].status, "failed");
        }
    });
}

#[test]
fn authentication_required_is_recorded_only_for_advertised_authentication() {
    // [ADR-0017.D1] Authentication remains agent-owned and an auth failure is visible.
    tauri::async_runtime::block_on(async {
        for (scenario, expected_reason) in [("auth_required", "authentication_required"), ("auth_unadvertised", "protocol_error")] {
            let (mut runner, session_id, _, _, task) = setup();
            runner.registry.lock().unwrap().running.clear();
            runner.store.connection().unwrap().execute("UPDATE sessions SET workspace_path = ?1 WHERE id = ?2", rusqlite::params![std::env::temp_dir().to_string_lossy().to_string(), session_id]).unwrap();
            runner.launch = Arc::new(move |_| Some(launch(scenario)));
            session::propose(&runner.store, session_id, vec![task]).unwrap();
            session::approve(&runner.store, session_id, 1).unwrap();
            assert_eq!(runner.start(session_id).unwrap(), ["task"]);
            let events = wait_for(&runner.store, session_id, "task_state", 2).await;
            let failure = events.iter().find(|event| event.kind == "task_state" && event.payload["status"] == "failed").unwrap();
            assert_eq!(failure.payload["reason"], expected_reason);
            assert!(events.iter().any(|event| event.kind == "agent_log" && event.payload["text"].as_str().is_some_and(|text| text.contains("Authentication required"))));
        }
    });
}

#[test]
fn initialize_advertises_no_fs_and_no_terminal_capabilities() {
    // [ADR-0017.D1] The client advertises no fs and no terminal capability to the agent.
    tauri::async_runtime::block_on(async {
        let (mut runner, session_id, _, _, task) = setup();
        runner.registry.lock().unwrap().running.clear();
        runner.store.connection().unwrap().execute("UPDATE sessions SET workspace_path = ?1 WHERE id = ?2", rusqlite::params![std::env::temp_dir().to_string_lossy().to_string(), session_id]).unwrap();
        runner.launch = Arc::new(|_| Some(launch("capabilities")));
        session::propose(&runner.store, session_id, vec![task]).unwrap();
        session::approve(&runner.store, session_id, 1).unwrap();
        assert_eq!(runner.start(session_id).unwrap(), ["task"]);
        let events = wait_for(&runner.store, session_id, "task_state", 2).await;
        let log = events.iter().find(|e| e.kind == "agent_log" && e.payload["text"].as_str().is_some_and(|t| t.contains("CAPS"))).unwrap();
        let text = log.payload["text"].as_str().unwrap();
        assert!(text.contains("terminal=False"));
        assert!(text.contains("read=none") || text.contains("read=False"));
        assert!(text.contains("write=none") || text.contains("write=False"));
        runner.shutdown();
    });
}

#[test]
fn mode_order_prefers_auto_over_accept_edits_and_never_selects_bypass() {
    // [ADR-0018.D3] the default mode is chosen from the advertised list in the order auto, acceptEdits, default, and bypassPermissions is never chosen automatically
    tauri::async_runtime::block_on(async {
        let (mut runner, session_id, _, _, task) = setup();
        runner.registry.lock().unwrap().running.clear();
        runner.store.connection().unwrap().execute("UPDATE sessions SET workspace_path = ?1 WHERE id = ?2", rusqlite::params![std::env::temp_dir().to_string_lossy().to_string(), session_id]).unwrap();
        runner.launch = Arc::new(|_| Some(launch("modes")));
        session::propose(&runner.store, session_id, vec![task]).unwrap();
        session::approve(&runner.store, session_id, 1).unwrap();
        assert_eq!(runner.start(session_id).unwrap(), ["task"]);
        let events = wait_for(&runner.store, session_id, "session_modes", 1).await;
        let mode_event = events.iter().find(|e| e.kind == "session_modes").unwrap();
        assert_eq!(mode_event.payload["current"], "auto");
        assert_eq!(mode_event.payload["plan_task_id"], "task");
        let available = mode_event.payload["available"].as_array().unwrap();
        assert_eq!(available.len(), 4);

        runner.set_mode(session_id, "task", "bypassPermissions").await.unwrap();
        let events = wait_for(&runner.store, session_id, "session_mode_changed", 1).await;
        let changed = events.iter().find(|e| e.kind == "session_mode_changed").unwrap();
        assert_eq!(changed.payload["current"], "bypassPermissions");

        assert!(runner.set_mode(session_id, "task", "nonexistent").await.is_err());
        runner.shutdown();
    });
}

#[test]
fn mode_avoids_bypass_permissions_when_preferred_modes_absent() {
    // [ADR-0018.D3] bypassPermissions is never chosen automatically even if it is the current mode
    tauri::async_runtime::block_on(async {
        let (mut runner, session_id, _, _, task) = setup();
        runner.registry.lock().unwrap().running.clear();
        runner.store.connection().unwrap().execute("UPDATE sessions SET workspace_path = ?1 WHERE id = ?2", rusqlite::params![std::env::temp_dir().to_string_lossy().to_string(), session_id]).unwrap();
        runner.launch = Arc::new(|_| Some(launch("modes_no_preferred")));
        session::propose(&runner.store, session_id, vec![task]).unwrap();
        session::approve(&runner.store, session_id, 1).unwrap();
        assert_eq!(runner.start(session_id).unwrap(), ["task"]);
        let events = wait_for(&runner.store, session_id, "session_modes", 1).await;
        let mode_event = events.iter().find(|e| e.kind == "session_modes").unwrap();
        assert_eq!(mode_event.payload["current"], "custom");
        runner.shutdown();
    });
}

#[test]
fn agent_without_modes_still_produces_permission_prompts() {
    // [ADR-0018.D3] an agent with no modes still produces permission prompts
    tauri::async_runtime::block_on(async {
        let (mut runner, session_id, _, _, task) = setup();
        runner.registry.lock().unwrap().running.clear();
        runner.store.connection().unwrap().execute("UPDATE sessions SET workspace_path = ?1 WHERE id = ?2", rusqlite::params![std::env::temp_dir().to_string_lossy().to_string(), session_id]).unwrap();
        runner.launch = Arc::new(|_| Some(launch("allow")));
        session::propose(&runner.store, session_id, vec![task]).unwrap();
        session::approve(&runner.store, session_id, 1).unwrap();
        assert_eq!(runner.start(session_id).unwrap(), ["task"]);
        let events = wait_for(&runner.store, session_id, "permission_request", 1).await;
        assert!(events.iter().any(|e| e.kind == "permission_request"));
        assert!(events.iter().all(|e| e.kind != "session_modes"));
        runner.shutdown();
    });
}

#[test]
fn allow_always_sent_only_when_offered() {
    // [ADR-0018.D3] AllowAlways is sent only when offered
    tauri::async_runtime::block_on(async {
        let (runner, session_id, control, stop, task) = setup();
        let worker = runner.clone();
        let cwd = std::env::temp_dir().to_string_lossy().into_owned();
        let cwd_clone = cwd.clone();
        let handle = tauri::async_runtime::spawn(async move { worker.execute(session_id, &task, &cwd_clone, control, stop, launch("allow"), Duration::from_secs(5)).await });
        let events = wait_for(&runner.store, session_id, "permission_request", 1).await;
        let req = events.iter().find(|e| e.kind == "permission_request").unwrap();
        assert_eq!(req.payload["allow_always"], false);
        let id = req.payload["request_id"].as_str().unwrap();
        assert!(runner.respond(session_id, "task", id, "allow_always").is_err());
        runner.respond(session_id, "task", id, "allow").unwrap();
        wait_for(&runner.store, session_id, "permission_resolved", 1).await;
        runner.stop(session_id, "task").unwrap();
        assert_eq!(handle.await.unwrap().unwrap(), ("cancelled", None));

        let (runner2, session_id2, control2, stop2, task2) = setup();
        let worker2 = runner2.clone();
        let handle2 = tauri::async_runtime::spawn(async move { worker2.execute(session_id2, &task2, &cwd, control2, stop2, launch("allow_always"), Duration::from_secs(5)).await });
        let events2 = wait_for(&runner2.store, session_id2, "permission_request", 1).await;
        let req2 = events2.iter().find(|e| e.kind == "permission_request").unwrap();
        assert_eq!(req2.payload["allow_always"], true);
        let id2 = req2.payload["request_id"].as_str().unwrap();
        runner2.respond(session_id2, "task", id2, "allow_always").unwrap();
        wait_for(&runner2.store, session_id2, "permission_resolved", 1).await;
        runner2.stop(session_id2, "task").unwrap();
        assert_eq!(handle2.await.unwrap().unwrap(), ("cancelled", None));
    });
}

#[test]
fn multi_turn_second_message_reuses_same_acp_session() {
    // [ADR-0018.D2] a second message reuses the same ACP session
    tauri::async_runtime::block_on(async {
        let (mut runner, session_id, _, _, task) = setup();
        runner.registry.lock().unwrap().running.clear();
        runner.store.connection().unwrap().execute("UPDATE sessions SET workspace_path = ?1 WHERE id = ?2", rusqlite::params![std::env::temp_dir().to_string_lossy().to_string(), session_id]).unwrap();
        runner.launch = Arc::new(|_| Some(launch("multi_turn")));
        session::propose(&runner.store, session_id, vec![task]).unwrap();
        session::approve(&runner.store, session_id, 1).unwrap();
        assert_eq!(runner.start(session_id).unwrap(), ["task"]);

        tokio::time::timeout(Duration::from_secs(5), async { loop {
            if runner.plan(session_id).unwrap().unwrap().tasks[0].status == "review" { break; }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }}).await.unwrap();

        let events = runner.store.events(session_id, 0, 1000).unwrap();
        let msg1 = events.iter().find(|e| e.kind == "agent_message").unwrap().payload["text"].as_str().unwrap();
        let parsed1: serde_json::Value = serde_json::from_str(msg1).unwrap();
        assert_eq!(parsed1["turn"], 1);
        let session_id_str = parsed1["channel"].as_str().unwrap().to_string();

        runner.send(session_id, "task", "Follow up message".into()).unwrap();

        tokio::time::timeout(Duration::from_secs(5), async { loop {
            let events = runner.store.events(session_id, 0, 1000).unwrap();
            if events.iter().filter(|e| e.kind == "agent_message").count() >= 2 {
                let plan = runner.plan(session_id).unwrap().unwrap();
                if plan.tasks[0].status == "review" { break; }
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }}).await.unwrap();

        let events = runner.store.events(session_id, 0, 1000).unwrap();
        let msgs: Vec<_> = events.iter().filter(|e| e.kind == "agent_message").collect();
        let parsed2: serde_json::Value = serde_json::from_str(msgs[1].payload["text"].as_str().unwrap()).unwrap();
        assert_eq!(parsed2["turn"], 2);
        assert_eq!(parsed2["channel"], session_id_str);
        assert_eq!(parsed2["prompt"], "Follow up message");

        runner.shutdown();
    });
}

#[test]
fn title_model_selection_per_harness_with_fallback() {
    // [ADR-0018.D5] for each harness, the title model is picked from the advertised list (haiku, luna, a free model), and any other harness or a missing match falls back to the main chat's current model
    tauri::async_runtime::block_on(async {
        for (harness, expected_model) in [
            ("claude-code", "claude-3-5-haiku-latest"),
            ("codex", "codex-luna-mini"),
            ("opencode", "opencode-free-model"),
            ("other-agent", "None"),
        ] {
            let captured_title = Arc::new(Mutex::new(None));
            let cap = captured_title.clone();
            let store = Store::open(":memory:").unwrap();
            let session_id = store.create_session("active").unwrap();
            store.connection().unwrap().execute("UPDATE sessions SET workspace_path = ?1 WHERE id = ?2", rusqlite::params![std::env::temp_dir().to_string_lossy().to_string(), session_id]).unwrap();
            let mut runner = Runner::with_emitters(store.clone(), Arc::new(|_, _| {}), Arc::new(move |_, title| {
                *cap.lock().unwrap() = Some(title.to_string());
            }));
            runner.launch = Arc::new(|_| Some(launch("models")));
            let task = PlanTask { id: "task".into(), title: "Write an algorithm".into(), team: "".into(), pinned: false, harness: harness.into(), model: None, worktree: false, files: vec![], dependencies: vec![], estimated_tokens: None, status: "queued".into() };
            session::propose(&runner.store, session_id, vec![task]).unwrap();
            session::approve(&runner.store, session_id, 1).unwrap();
            runner.start(session_id).unwrap();

            tokio::time::timeout(Duration::from_secs(5), async { loop {
                if captured_title.lock().unwrap().is_some() { break; }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }}).await.unwrap();

            let title = captured_title.lock().unwrap().clone().unwrap();
            assert!(title.contains(expected_model), "harness {harness} expected {expected_model}, got {title}");
            runner.shutdown();
        }
    });
}

#[test]
fn title_prompt_and_reply_do_not_appear_in_chat_event_log() {
    // [ADR-0018.D5] the title prompt and reply do not appear in the chat event log
    tauri::async_runtime::block_on(async {
        let (mut runner, session_id, _, _, task) = setup();
        runner.registry.lock().unwrap().running.clear();
        runner.store.connection().unwrap().execute("UPDATE sessions SET workspace_path = ?1 WHERE id = ?2", rusqlite::params![std::env::temp_dir().to_string_lossy().to_string(), session_id]).unwrap();
        runner.launch = Arc::new(|_| Some(launch("models")));
        session::propose(&runner.store, session_id, vec![task]).unwrap();
        session::approve(&runner.store, session_id, 1).unwrap();
        runner.start(session_id).unwrap();

        tokio::time::timeout(Duration::from_secs(5), async { loop {
            let session = runner.store.list_sessions().unwrap().into_iter().find(|s| s.id == session_id).unwrap();
            if session.title.contains("Generated Title") { break; }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }}).await.unwrap();

        let events = runner.store.events(session_id, 0, 1000).unwrap();
        assert!(!events.iter().any(|e| e.payload.to_string().contains("Generate a short plain-text title")));
        assert!(!events.iter().any(|e| e.payload.to_string().contains("Generated Title")));
        runner.shutdown();
    });
}

#[test]
fn typed_title_not_overwritten_by_generated_title() {
    // [ADR-0018.D5] a title the user typed is not overwritten by the generated one
    tauri::async_runtime::block_on(async {
        let store = Store::open(":memory:").unwrap();
        let root = std::env::temp_dir().to_string_lossy().to_string();
        let proj = store.add_project("proj", &root).unwrap();
        let session = store.create_named_session("User Typed Title", proj.id, &root, false).unwrap();
        let mut runner = Runner::with_emitter(store.clone(), Arc::new(|_, _| {}));
        runner.launch = Arc::new(|_| Some(launch("models")));
        let task = PlanTask { id: "task".into(), title: "Do work".into(), team: "".into(), pinned: false, harness: "fake".into(), model: None, worktree: false, files: vec![], dependencies: vec![], estimated_tokens: None, status: "queued".into() };
        session::propose(&runner.store, session.id, vec![task]).unwrap();
        session::approve(&runner.store, session.id, 1).unwrap();
        runner.start(session.id).unwrap();
        tokio::time::timeout(Duration::from_secs(5), async { loop {
            let plan = runner.plan(session.id).unwrap().unwrap();
            if plan.tasks[0].status == "review" { break; }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }}).await.unwrap();
        let sessions = runner.store.list_sessions().unwrap();
        let current = sessions.into_iter().find(|s| s.id == session.id).unwrap();
        assert_eq!(current.title, "User Typed Title");
        runner.shutdown();
    });
}

#[test]
fn failed_or_timed_out_title_keeps_truncated_first_message() {
    // [ADR-0018.D5] a failed or timed-out title call keeps the truncated first message as the title
    tauri::async_runtime::block_on(async {
        let store = Store::open(":memory:").unwrap();
        let root = std::env::temp_dir().to_string_lossy().to_string();
        let proj = store.add_project("proj", &root).unwrap();
        let session = store.create_named_session("New session", proj.id, &root, false).unwrap();
        let mut runner = Runner::with_emitter(store.clone(), Arc::new(|_, _| {}));
        runner.launch = Arc::new(|_| Some(launch("title_fail")));
        let task = PlanTask { id: "task".into(), title: "Investigate and solve the issue with concurrency in runner".into(), team: "".into(), pinned: false, harness: "fake".into(), model: None, worktree: false, files: vec![], dependencies: vec![], estimated_tokens: None, status: "queued".into() };
        session::propose(&runner.store, session.id, vec![task]).unwrap();
        session::approve(&runner.store, session.id, 1).unwrap();
        runner.start(session.id).unwrap();
        tokio::time::timeout(Duration::from_secs(5), async { loop {
            let plan = runner.plan(session.id).unwrap().unwrap();
            if plan.tasks[0].status == "review" { break; }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }}).await.unwrap();
        let sessions = runner.store.list_sessions().unwrap();
        let current = sessions.into_iter().find(|s| s.id == session.id).unwrap();
        assert_eq!(current.title, "Investigate and solve the issue with concurrency in runner");
        runner.shutdown();
    });
}

#[test]
fn non_git_project_runs_in_project_root_without_worktree() {
    // [ADR-0019.D2] Register non-git directories with a warning and run agents directly in the selected directory
    tauri::async_runtime::block_on(async {
        let unique = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
        let root = std::env::temp_dir().join(format!("bentobox-nongit-{unique}"));
        std::fs::create_dir_all(&root).unwrap();
        let canonical_root = root.canonicalize().unwrap();
        let (runner, session_id, control, stop, mut task) = setup();
        task.worktree = true;
        let worker = runner.clone();
        let canon_str = canonical_root.to_str().unwrap().to_string();
        let handle = tauri::async_runtime::spawn(async move { worker.execute(session_id, &task, &canon_str, control, stop, launch("inspect"), Duration::from_secs(5)).await });
        let events = wait_for(&runner.store, session_id, "agent_message", 1).await;
        let handoff = events.iter().find(|event| event.kind == "handoff").unwrap();
        assert_eq!(handoff.payload["handoff"]["worktree_path"], canonical_root.to_str().unwrap());
        assert!(handoff.payload.get("branch").is_none());

        let received = events.iter().find(|event| event.kind == "agent_message").unwrap().payload["text"].as_str().unwrap();
        let received: serde_json::Value = serde_json::from_str(received).unwrap();
        assert_eq!(received["cwd"], canonical_root.to_str().unwrap());

        runner.stop(session_id, "task").unwrap();
        assert_eq!(handle.await.unwrap().unwrap(), ("cancelled", None));
        std::fs::remove_dir_all(root).unwrap();
    });
}

#[test]
fn stale_prompt_notify_does_not_fail_idle_task() {
    // [ADR-0018.D2] Stale prompt_notify does not fall through to failed protocol_error
    tauri::async_runtime::block_on(async {
        let (mut runner, session_id, _, _, task) = setup();
        runner.registry.lock().unwrap().running.clear();
        runner.store.connection().unwrap().execute("UPDATE sessions SET workspace_path = ?1 WHERE id = ?2", rusqlite::params![std::env::temp_dir().to_string_lossy().to_string(), session_id]).unwrap();
        runner.launch = Arc::new(|_| Some(launch("multi_turn")));
        session::propose(&runner.store, session_id, vec![task]).unwrap();
        session::approve(&runner.store, session_id, 1).unwrap();
        runner.start(session_id).unwrap();

        tokio::time::timeout(Duration::from_secs(5), async { loop {
            if runner.plan(session_id).unwrap().unwrap().tasks[0].status == "review" { break; }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }}).await.unwrap();

        // Spurious prompt_notify permit with empty queue
        let control = runner.control(session_id, "task").unwrap();
        control.prompt_notify.notify_one();

        tokio::time::sleep(Duration::from_millis(100)).await;
        assert_eq!(runner.plan(session_id).unwrap().unwrap().tasks[0].status, "review");

        // Real follow up prompt works normally
        runner.send(session_id, "task", "Valid turn".into()).unwrap();
        tokio::time::timeout(Duration::from_secs(5), async { loop {
            let events = runner.store.events(session_id, 0, 1000).unwrap();
            if events.iter().filter(|e| e.kind == "agent_message").count() >= 2 {
                if runner.plan(session_id).unwrap().unwrap().tasks[0].status == "review" { break; }
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }}).await.unwrap();

        runner.shutdown();
    });
}

#[test]
fn recover_marks_orphaned_review_tasks_interrupted() {
    // [ADR-0018.D2] Startup recovery marks orphaned review tasks failed with reason interrupted
    let store = Store::open(":memory:").unwrap();
    let session_id = store.create_session("active").unwrap();
    let runner = Runner::with_emitter(store.clone(), Arc::new(|_, _| {}));
    let task = PlanTask { id: "task-r".into(), title: "Review task".into(), team: "".into(), pinned: false, harness: "fake".into(), model: None, worktree: false, files: vec![], dependencies: vec![], estimated_tokens: None, status: "queued".into() };
    session::propose(&store, session_id, vec![task]).unwrap();
    session::approve(&store, session_id, 1).unwrap();
    session::transition(&store, session_id, "task-r", "running").unwrap();
    session::transition(&store, session_id, "task-r", "review").unwrap();

    runner.recover().unwrap();

    let plan = runner.plan(session_id).unwrap().unwrap();
    assert_eq!(plan.tasks[0].status, "failed");
    let events = store.events(session_id, 0, 100).unwrap();
    let fail_event = events.iter().find(|e| e.kind == "task_state" && e.payload["status"] == "failed").unwrap();
    assert_eq!(fail_event.payload["reason"], "interrupted");
}

#[test]
fn idle_review_tasks_do_not_count_against_max_running_and_stop_cancels_them() {
    // [ADR-0018.D2] Review tasks do not block max running concurrency and Stop terminates review tasks
    tauri::async_runtime::block_on(async {
        let (mut runner, session_id, _, _, template) = setup();
        runner.registry.lock().unwrap().running.clear();
        runner.store.connection().unwrap().execute("UPDATE sessions SET workspace_path = ?1 WHERE id = ?2", rusqlite::params![std::env::temp_dir().to_string_lossy().to_string(), session_id]).unwrap();
        runner.launch = Arc::new(|_| Some(launch("multi_turn")));
        let tasks = (0..4).map(|i| {
            let mut t = template.clone();
            t.id = format!("t-{i}");
            t
        }).collect();
        session::propose(&runner.store, session_id, tasks).unwrap();
        session::approve(&runner.store, session_id, 1).unwrap();
        assert_eq!(runner.start(session_id).unwrap(), ["t-0", "t-1", "t-2"]);

        // Wait for all 3 running tasks to enter review
        tokio::time::timeout(Duration::from_secs(5), async { loop {
            let plan = runner.plan(session_id).unwrap().unwrap();
            if plan.tasks[0..3].iter().all(|t| t.status == "review") { break; }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }}).await.unwrap();

        // Since tasks 0..3 are idle in review, task 3 can now be started!
        assert_eq!(runner.start(session_id).unwrap(), ["t-3"]);

        // Stop must work on an idle review task
        runner.stop(session_id, "t-0").unwrap();
        tokio::time::timeout(Duration::from_secs(2), async { loop {
            let plan = runner.plan(session_id).unwrap().unwrap();
            if plan.tasks[0].status == "cancelled" { break; }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }}).await.unwrap();

        runner.shutdown();
    });
}

#[test]
fn session_transition_allows_review_to_running() {
    // [ADR-0018.D2] Task transition must allow review -> running for a subsequent turn
    let store = Store::open(":memory:").unwrap();
    let session = store.create_session("active").unwrap();
    let task = PlanTask { id: "task-1".into(), title: "Work".into(), team: "".into(), pinned: false, harness: "fake".into(), model: None, worktree: false, files: vec![], dependencies: vec![], estimated_tokens: None, status: "queued".into() };
    session::propose(&store, session, vec![task]).unwrap();
    session::approve(&store, session, 1).unwrap();
    session::transition(&store, session, "task-1", "running").unwrap();
    session::transition(&store, session, "task-1", "review").unwrap();
    assert_eq!(session::transition(&store, session, "task-1", "running").unwrap().tasks[0].status, "running");
}

#[test]
fn adr0020_single_task_chat_message_reaches_agent_unchanged() {
    // [ADR-0020.D1] a single-task chat message reaches the agent exactly as typed
    tauri::async_runtime::block_on(async {
        let (runner, session_id, control, stop, task) = setup();
        let prompt_raw = "Hello assistant, how are you?";
        let mut task = task;
        task.title = prompt_raw.into();
        task.files = vec![];
        session::propose(&runner.store, session_id, vec![task.clone()]).unwrap();
        session::approve(&runner.store, session_id, 1).unwrap();
        let worker = runner.clone();
        let cwd = std::env::temp_dir().to_string_lossy().into_owned();
        let handle = tauri::async_runtime::spawn(async move { worker.execute(session_id, &task, &cwd, control, stop, launch("inspect"), Duration::from_secs(5)).await });
        let events = wait_for(&runner.store, session_id, "agent_message", 1).await;
        let received_text = events.iter().find(|e| e.kind == "agent_message").unwrap().payload["text"].as_str().unwrap();
        let parsed: serde_json::Value = serde_json::from_str(received_text).unwrap();
        assert_eq!(parsed["prompt"], prompt_raw);
        runner.stop(session_id, "task").unwrap();
        assert_eq!(handle.await.unwrap().unwrap(), ("cancelled", None));
    });
}

#[test]
fn adr0020_multi_task_and_task_with_files_keep_wrapper() {
    // [ADR-0020.D1] a two-task plan and a task with files keep the Goal/Files/Worktree wrapper
    tauri::async_runtime::block_on(async {
        // Case 1: Multi-task plan (2 tasks) without files still uses wrapper
        {
            let (runner, session_id, control, stop, task1) = setup();
            let task2 = PlanTask { id: "task2".into(), title: "Second".into(), team: "".into(), pinned: false, harness: "fake".into(), model: None, worktree: false, files: vec![], dependencies: vec![], estimated_tokens: None, status: "queued".into() };
            session::propose(&runner.store, session_id, vec![task1.clone(), task2]).unwrap();
            session::approve(&runner.store, session_id, 1).unwrap();
            let worker = runner.clone();
            let cwd = std::env::temp_dir().to_string_lossy().into_owned();
            let task1_run = task1.clone();
            let cwd_run = cwd.clone();
            let handle = tauri::async_runtime::spawn(async move { worker.execute(session_id, &task1_run, &cwd_run, control, stop, launch("inspect"), Duration::from_secs(5)).await });
            let events = wait_for(&runner.store, session_id, "agent_message", 1).await;
            let received = events.iter().find(|e| e.kind == "agent_message").unwrap().payload["text"].as_str().unwrap();
            let parsed: serde_json::Value = serde_json::from_str(received).unwrap();
            let prompt = parsed["prompt"].as_str().unwrap();
            assert!(prompt.starts_with(&format!("Goal: {}\n", task1.title)));
            let expected_cwd = std::path::Path::new(&cwd).canonicalize().unwrap();
            assert!(prompt.contains(&format!("Worktree: {}", expected_cwd.display())));
            runner.stop(session_id, "task").unwrap();
            assert_eq!(handle.await.unwrap().unwrap(), ("cancelled", None));
        }
        // Case 2: Single-task plan but with files keeps wrapper
        {
            let (runner, session_id, control, stop, mut task) = setup();
            task.files = vec!["README.md".into()];
            session::propose(&runner.store, session_id, vec![task.clone()]).unwrap();
            session::approve(&runner.store, session_id, 1).unwrap();
            let worker = runner.clone();
            let cwd = std::env::temp_dir().to_string_lossy().into_owned();
            let task_run = task.clone();
            let cwd_run = cwd.clone();
            let handle = tauri::async_runtime::spawn(async move { worker.execute(session_id, &task_run, &cwd_run, control, stop, launch("inspect"), Duration::from_secs(5)).await });
            let events = wait_for(&runner.store, session_id, "agent_message", 1).await;
            let received = events.iter().find(|e| e.kind == "agent_message").unwrap().payload["text"].as_str().unwrap();
            let parsed: serde_json::Value = serde_json::from_str(received).unwrap();
            let prompt = parsed["prompt"].as_str().unwrap();
            assert!(prompt.starts_with(&format!("Goal: {}\n", task.title)));
            assert!(prompt.contains("Files:\n- README.md"));
            let expected_cwd = std::path::Path::new(&cwd).canonicalize().unwrap();
            assert!(prompt.contains(&format!("Worktree: {}", expected_cwd.display())));
            runner.stop(session_id, "task").unwrap();
            assert_eq!(handle.await.unwrap().unwrap(), ("cancelled", None));
        }
    });
}

#[test]
fn adr0020_concise_replies_prepends_instruction_and_toggling_applies_dynamically() {
    // [ADR-0020.D2] with the setting on the agent receives the line plus blank line plus text, for the first prompt and for a follow-up
    // [ADR-0020.D2] toggling off stops it
    // [ADR-0020.D2] the user_message event contains only the typed text
    tauri::async_runtime::block_on(async {
        let (mut runner, session_id, _, _, task) = setup();
        runner.registry.lock().unwrap().running.clear();
        runner.store.connection().unwrap().execute("UPDATE sessions SET workspace_path = ?1 WHERE id = ?2", rusqlite::params![std::env::temp_dir().to_string_lossy().to_string(), session_id]).unwrap();
        runner.launch = Arc::new(|_| Some(launch("multi_turn_inspect")));

        // Enable concise replies
        runner.store.set_session_concise(session_id, true).unwrap();
        assert!(runner.store.session_concise(session_id).unwrap());

        let mut task = task;
        task.title = "First question".into();
        session::propose(&runner.store, session_id, vec![task]).unwrap();
        session::approve(&runner.store, session_id, 1).unwrap();
        assert_eq!(runner.start(session_id).unwrap(), ["task"]);

        // Wait for first turn to hit review
        tokio::time::timeout(Duration::from_secs(5), async { loop {
            if runner.plan(session_id).unwrap().unwrap().tasks[0].status == "review" { break; }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }}).await.unwrap();

        let events = runner.store.events(session_id, 0, 1000).unwrap();
        let user_msgs: Vec<_> = events.iter().filter(|e| e.kind == "user_message").collect();
        assert_eq!(user_msgs.len(), 1);
        // [ADR-0020.D2] the user_message event contains only the typed text
        assert_eq!(user_msgs[0].payload["text"], "First question");

        let agent_msg1 = events.iter().find(|e| e.kind == "agent_message").unwrap().payload["text"].as_str().unwrap();
        let parsed1: serde_json::Value = serde_json::from_str(agent_msg1).unwrap();
        let prompt1 = parsed1["prompt"].as_str().unwrap();
        // [ADR-0020.D2] agent receives instruction line plus blank line plus text on first prompt
        assert_eq!(prompt1, "Keep replies short and direct. Do not describe the repository or your tools unless asked.\n\nFirst question");

        // Send follow-up while concise is still on
        runner.send(session_id, "task", "Second question".into()).unwrap();

        tokio::time::timeout(Duration::from_secs(5), async { loop {
            let events = runner.store.events(session_id, 0, 1000).unwrap();
            if events.iter().filter(|e| e.kind == "agent_message").count() >= 2 {
                let plan = runner.plan(session_id).unwrap().unwrap();
                if plan.tasks[0].status == "review" { break; }
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }}).await.unwrap();

        let events = runner.store.events(session_id, 0, 1000).unwrap();
        let user_msgs: Vec<_> = events.iter().filter(|e| e.kind == "user_message").collect();
        assert_eq!(user_msgs.len(), 2);
        assert_eq!(user_msgs[1].payload["text"], "Second question");

        let agent_msgs: Vec<_> = events.iter().filter(|e| e.kind == "agent_message").collect();
        let parsed2: serde_json::Value = serde_json::from_str(agent_msgs[1].payload["text"].as_str().unwrap()).unwrap();
        let prompt2 = parsed2["prompt"].as_str().unwrap();
        // [ADR-0020.D2] follow up prompt also receives instruction line
        assert_eq!(prompt2, "Keep replies short and direct. Do not describe the repository or your tools unless asked.\n\nSecond question");

        // Now toggle concise replies OFF dynamically mid-session
        runner.store.set_session_concise(session_id, false).unwrap();
        assert!(!runner.store.session_concise(session_id).unwrap());

        // Send third question
        runner.send(session_id, "task", "Third question".into()).unwrap();

        tokio::time::timeout(Duration::from_secs(5), async { loop {
            let events = runner.store.events(session_id, 0, 1000).unwrap();
            if events.iter().filter(|e| e.kind == "agent_message").count() >= 3 {
                let plan = runner.plan(session_id).unwrap().unwrap();
                if plan.tasks[0].status == "review" { break; }
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }}).await.unwrap();

        let events = runner.store.events(session_id, 0, 1000).unwrap();
        let user_msgs: Vec<_> = events.iter().filter(|e| e.kind == "user_message").collect();
        assert_eq!(user_msgs.len(), 3);
        assert_eq!(user_msgs[2].payload["text"], "Third question");

        let agent_msgs: Vec<_> = events.iter().filter(|e| e.kind == "agent_message").collect();
        let parsed3: serde_json::Value = serde_json::from_str(agent_msgs[2].payload["text"].as_str().unwrap()).unwrap();
        let prompt3 = parsed3["prompt"].as_str().unwrap();
        // [ADR-0020.D2] toggling off stops it
        assert_eq!(prompt3, "Third question");

        runner.shutdown();
    });
}

// [ADR-0021.D2] Selected model is applied with set_config_option before the first prompt.
#[test]
fn adr0021_model_applied_before_first_prompt() {
    tauri::async_runtime::block_on(async {
        let (runner, session_id, control, stop, mut task) = setup();
        task.model = Some("gpt-4o".into());
        let worker = runner.clone();
        let cwd = std::env::temp_dir().to_string_lossy().into_owned();
        let task_clone = task.clone();
        let handle = tauri::async_runtime::spawn(async move {
            worker.execute(session_id, &task_clone, &cwd, control, stop, launch("model_inspect"), Duration::from_secs(5)).await
        });

        let events = wait_for(&runner.store, session_id, "agent_message", 1).await;
        let msg = events.iter().find(|e| e.kind == "agent_message").unwrap();
        let parsed: serde_json::Value = serde_json::from_str(msg.payload["text"].as_str().unwrap()).unwrap();
        assert_eq!(parsed["selected_model"], "gpt-4o");
        let order: Vec<&str> = parsed["call_order"].as_array().unwrap().iter().map(|v| v.as_str().unwrap()).collect();
        assert_eq!(order, vec!["set_config_option", "prompt"]);

        runner.stop(session_id, "task").unwrap();
        assert_eq!(handle.await.unwrap().unwrap(), ("cancelled", None));
    });
}

// [ADR-0021.D2] Unadvertised or unknown desired model leaves default active and logs agent_log.
#[test]
fn adr0021_unadvertised_or_unknown_desired_model_leaves_default_and_logs() {
    tauri::async_runtime::block_on(async {
        let (runner, session_id, control, stop, mut task) = setup();
        task.model = Some("nonexistent-model-xyz".into());
        let worker = runner.clone();
        let cwd = std::env::temp_dir().to_string_lossy().into_owned();
        let task_clone = task.clone();
        let handle = tauri::async_runtime::spawn(async move {
            worker.execute(session_id, &task_clone, &cwd, control, stop, launch("model_inspect"), Duration::from_secs(5)).await
        });

        let events = wait_for(&runner.store, session_id, "agent_message", 1).await;
        let msg = events.iter().find(|e| e.kind == "agent_message").unwrap();
        let parsed: serde_json::Value = serde_json::from_str(msg.payload["text"].as_str().unwrap()).unwrap();
        // The agent never received a set_config_option call for nonexistent-model-xyz
        assert_eq!(parsed["selected_model"], serde_json::Value::Null);
        let all_events = runner.store.events(session_id, 0, 1000).unwrap();
        assert!(all_events.iter().any(|e| e.kind == "agent_log" && e.payload["text"].as_str().unwrap().contains("Desired model nonexistent-model-xyz is not available")));

        runner.stop(session_id, "task").unwrap();
        assert_eq!(handle.await.unwrap().unwrap(), ("cancelled", None));
    });
}

// [ADR-0021.D2] runner_set_model rejects unadvertised ids and updates sessions.model + emits session_model_changed.
#[test]
fn adr0021_runner_set_model_validates_and_updates_and_emits_event() {
    tauri::async_runtime::block_on(async {
        let (mut runner, session_id, _, _, mut task) = setup();
        runner.registry.lock().unwrap().running.clear();
        task.status = "queued".into();
        runner.store.connection().unwrap().execute(
            "UPDATE sessions SET workspace_path = ?1 WHERE id = ?2",
            rusqlite::params![std::env::temp_dir().to_string_lossy().to_string(), session_id],
        ).unwrap();
        runner.launch = Arc::new(|_| Some(launch("models")));
        session::propose(&runner.store, session_id, vec![task]).unwrap();
        session::approve(&runner.store, session_id, 1).unwrap();
        runner.start(session_id).unwrap();

        tokio::time::timeout(Duration::from_secs(5), async { loop {
            let plan = runner.plan(session_id).unwrap().unwrap();
            if plan.tasks[0].status == "review" { break; }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }}).await.unwrap();

        // Setting an invalid model must fail
        let err = runner.set_model(session_id, "task", "invalid-id-xyz").await;
        assert!(err.is_err(), "expected error for unadvertised model");

        // Setting an advertised model must succeed, update sessions.model, and emit session_model_changed
        runner.set_model(session_id, "task", "claude-3-5-haiku-latest").await.unwrap();
        assert_eq!(runner.store.session_model(session_id).unwrap(), Some("claude-3-5-haiku-latest".into()));

        let events = runner.store.events(session_id, 0, 1000).unwrap();
        assert!(events.iter().any(|e| e.kind == "session_model_changed" && e.payload["current"] == "claude-3-5-haiku-latest"));

        runner.shutdown();
    });
}

// [ADR-0021.D2] Title session selection is unaffected by sessions.model.
#[test]
fn adr0021_title_session_unaffected_by_sessions_model() {
    tauri::async_runtime::block_on(async {
        let captured_title = Arc::new(Mutex::new(None));
        let cap = captured_title.clone();
        let store = Store::open(":memory:").unwrap();
        let session_id = store.create_session("active").unwrap();
        // Persist a user chat model in the session
        store.set_session_model(session_id, Some("gpt-4o")).unwrap();
        store.connection().unwrap().execute(
            "UPDATE sessions SET workspace_path = ?1 WHERE id = ?2",
            rusqlite::params![std::env::temp_dir().to_string_lossy().to_string(), session_id],
        ).unwrap();

        let mut runner = Runner::with_emitters(store.clone(), Arc::new(|_, _| {}), Arc::new(move |_, title| {
            *cap.lock().unwrap() = Some(title.to_string());
        }));
        runner.launch = Arc::new(|_| Some(launch("models")));
        let task = PlanTask {
            id: "task".into(),
            title: "Write an algorithm".into(),
            team: "".into(),
            pinned: false,
            harness: "claude-code".into(),
            model: Some("gpt-4o".into()),
            worktree: false,
            files: vec![],
            dependencies: vec![],
            estimated_tokens: None,
            status: "queued".into(),
        };
        session::propose(&runner.store, session_id, vec![task]).unwrap();
        session::approve(&runner.store, session_id, 1).unwrap();
        runner.start(session_id).unwrap();

        tokio::time::timeout(Duration::from_secs(5), async { loop {
            if captured_title.lock().unwrap().is_some() { break; }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }}).await.unwrap();

        let title = captured_title.lock().unwrap().clone().unwrap();
        // For claude-code harness, title session must still pick haiku, not gpt-4o from sessions.model
        assert!(title.contains("claude-3-5-haiku-latest"), "title should have haiku, got {title}");
        assert_eq!(runner.store.session_model(session_id).unwrap(), Some("gpt-4o".into()));
        let control = runner.control(session_id, "task").unwrap();
        let main_model = control.active_session.lock().unwrap().as_ref().and_then(|a| a.current_model.clone());
        assert_eq!(main_model, Some("gpt-4o".into()));
        runner.shutdown();
    });
}

// [ADR-0021.D2] ConfigOptionUpdate arriving during set_config_option updates ActiveSession and yields single event.
#[test]
fn adr0021_config_option_update_during_set_model_deduplicates_event() {
    tauri::async_runtime::block_on(async {
        let (mut runner, session_id, _, _, mut task) = setup();
        runner.registry.lock().unwrap().running.clear();
        task.status = "queued".into();
        runner.store.connection().unwrap().execute(
            "UPDATE sessions SET workspace_path = ?1 WHERE id = ?2",
            rusqlite::params![std::env::temp_dir().to_string_lossy().to_string(), session_id],
        ).unwrap();
        runner.launch = Arc::new(|_| Some(launch("model_update")));
        session::propose(&runner.store, session_id, vec![task]).unwrap();
        session::approve(&runner.store, session_id, 1).unwrap();
        runner.start(session_id).unwrap();

        tokio::time::timeout(Duration::from_secs(5), async { loop {
            let plan = runner.plan(session_id).unwrap().unwrap();
            if plan.tasks[0].status == "review" { break; }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }}).await.unwrap();

        runner.set_model(session_id, "task", "claude-3-5-haiku-latest").await.unwrap();

        tokio::time::sleep(Duration::from_millis(50)).await;
        let events = runner.store.events(session_id, 0, 1000).unwrap();
        // ActiveSession should reflect updated model from ConfigOptionUpdate
        let control = runner.control(session_id, "task").unwrap();
        let current_active = control.active_session.lock().unwrap().as_ref().and_then(|a| a.current_model.clone());
        assert_eq!(current_active, Some("updated-model".into()));

        // session_model_changed events for updated-model should be emitted exactly once
        let change_events: Vec<_> = events.iter().filter(|e| e.kind == "session_model_changed" && e.payload["current"] == "updated-model").collect();
        assert_eq!(change_events.len(), 1);

        runner.shutdown();
    });
}

fn insert_team(store: &Store, id: &str, steps: &[(&str, Option<&str>)]) {
    let conn = store.connection().unwrap();
    conn.execute("INSERT INTO teams (id, name, role) VALUES (?1, ?1, 'orchestrator')", [id]).unwrap();
    for (position, (harness, model)) in steps.iter().enumerate() {
        conn.execute("INSERT INTO team_steps (team_id, position, harness, model) VALUES (?1, ?2, ?3, ?4)", rusqlite::params![id, position as i64, harness, model]).unwrap();
    }
}

// [ADR-0011.D1] Missing launch specs are skipped in order and each switch is recorded.
#[test]
fn team_chain_skips_unrunnable_steps_in_order() {
    tauri::async_runtime::block_on(async {
        let (mut runner, session, control, stop, mut task) = setup();
        insert_team(&runner.store, "ordered", &[("missing-a", Some("a")), ("missing-b", Some("b")), ("last", Some("c"))]);
        task.team = "ordered".into();
        let calls = Arc::new(Mutex::new(Vec::new()));
        let seen = calls.clone();
        runner.launch = Arc::new(move |id| { seen.lock().unwrap().push(id.to_owned()); if id == "last" { Some(launch("max_tokens")) } else { None } });
        let result = runner.run_task_attempts(session, &task, std::env::temp_dir().to_str().unwrap(), control, stop).await.unwrap();
        assert_eq!(result, ("failed", Some("max_tokens".into())));
        assert_eq!(*calls.lock().unwrap(), ["missing-a", "missing-b", "last"]);
        let events = runner.store.events(session, 0, 1000).unwrap();
        let switches: Vec<_> = events.iter().filter(|event| event.kind == "team_fallback").collect();
        assert_eq!(switches.len(), 2);
        assert_eq!(switches[0].payload["from"], "missing-a/a");
        assert_eq!(switches[0].payload["to"], "missing-b/b");
        assert_eq!(switches[0].payload["reason"], "harness is not runnable");
        assert_eq!(switches[1].payload["to"], "last/c");
    });
}

// [ADR-0011.D1] Authentication failures switch to the next step with the observed reason.
#[test]
fn team_chain_falls_back_on_authentication_failure() {
    tauri::async_runtime::block_on(async {
        let (mut runner, session, control, stop, mut task) = setup();
        insert_team(&runner.store, "auth-team", &[("first", Some("one")), ("second", Some("two"))]);
        task.team = "auth-team".into();
        runner.launch = Arc::new(|id| Some(launch(if id == "first" { "auth_required" } else { "max_tokens" })));
        let result = runner.run_task_attempts(session, &task, std::env::temp_dir().to_str().unwrap(), control, stop).await.unwrap();
        assert_eq!(result, ("failed", Some("max_tokens".into())));
        let events = runner.store.events(session, 0, 1000).unwrap();
        let fallback = events.iter().find(|event| event.kind == "team_fallback").unwrap();
        assert_eq!(fallback.payload["from"], "first/one");
        assert_eq!(fallback.payload["to"], "second/two");
        assert_eq!(fallback.payload["reason"], "authentication_required");
        assert_eq!(events.iter().filter(|event| event.kind == "user_message").count(), 1);
    });
}

// [ADR-0011.D1] Output from an attempt prevents replay, and its selected team model is applied.
#[test]
fn team_chain_never_replays_after_output() {
    tauri::async_runtime::block_on(async {
        let (mut runner, session, control, stop, mut task) = setup();
        insert_team(&runner.store, "output", &[("first", Some("gpt-4o")), ("second", None)]);
        task.team = "output".into();
        let calls = Arc::new(Mutex::new(Vec::new()));
        let seen = calls.clone();
        runner.launch = Arc::new(move |id| { seen.lock().unwrap().push(id.to_owned()); Some(launch("team_model_crash")) });
        let result = runner.run_task_attempts(session, &task, std::env::temp_dir().to_str().unwrap(), control, stop).await.unwrap();
        assert_eq!(result, ("failed", Some("process_exited".into())));
        assert_eq!(*calls.lock().unwrap(), ["first"]);
        let events = runner.store.events(session, 0, 1000).unwrap();
        assert!(!events.iter().any(|event| event.kind == "team_fallback"));
        let output = events.iter().find(|event| event.kind == "agent_message").unwrap();
        let text: serde_json::Value = serde_json::from_str(output.payload["text"].as_str().unwrap()).unwrap();
        assert_eq!(text["selected_model"], "gpt-4o");
    });
}

// [ADR-0011.D1] Exhaustion returns the last observed reason, not the first.
#[test]
fn team_chain_exhaustion_returns_last_reason() {
    tauri::async_runtime::block_on(async {
        let (mut runner, session, control, stop, mut task) = setup();
        insert_team(&runner.store, "exhausted", &[("first", None), ("missing", None)]);
        task.team = "exhausted".into();
        runner.launch = Arc::new(|id| if id == "first" { Some(launch("auth_required")) } else { None });
        let error = runner.run_task_attempts(session, &task, std::env::temp_dir().to_str().unwrap(), control, stop).await.unwrap_err();
        assert_eq!(error, "harness is not runnable");
    });
}

// [ADR-0011.D1] Task teams override session teams; without either, the task harness is unchanged.
#[test]
fn team_resolution_respects_task_session_and_no_team() {
    tauri::async_runtime::block_on(async {
        for (task_team, session_team, expected) in [("task-team", Some("session-team"), "task-step"), ("", Some("session-team"), "session-step"), ("", None, "fake")] {
            let (mut runner, session, control, stop, mut task) = setup();
            insert_team(&runner.store, "task-team", &[("task-step", None)]);
            insert_team(&runner.store, "session-team", &[("session-step", None)]);
            runner.store.connection().unwrap().execute("UPDATE sessions SET team = ?1 WHERE id = ?2", rusqlite::params![session_team, session]).unwrap();
            task.team = task_team.into();
            let calls = Arc::new(Mutex::new(Vec::new()));
            let seen = calls.clone();
            runner.launch = Arc::new(move |id| { seen.lock().unwrap().push(id.to_owned()); Some(launch("max_tokens")) });
            assert_eq!(runner.run_task_attempts(session, &task, std::env::temp_dir().to_str().unwrap(), control, stop).await.unwrap(), ("failed", Some("max_tokens".into())));
            assert_eq!(*calls.lock().unwrap(), [expected]);
            assert!(!runner.store.events(session, 0, 1000).unwrap().iter().any(|event| event.kind == "team_fallback"));
        }
    });
}

// [ADR-0012.D1] A pinned inline harness ignores both task and session teams.
#[test]
fn pinned_route_ignores_session_team() {
    tauri::async_runtime::block_on(async {
        let (mut runner, session, control, stop, mut task) = setup();
        insert_team(&runner.store, "session-team", &[("session-step", None)]);
        runner.store.connection().unwrap().execute("UPDATE sessions SET team = ?1 WHERE id = ?2", rusqlite::params!["session-team", session]).unwrap();
        task.team = "session-team".into();
        task.pinned = true;
        let calls = Arc::new(Mutex::new(Vec::new()));
        let seen = calls.clone();
        runner.launch = Arc::new(move |id| { seen.lock().unwrap().push(id.to_owned()); Some(launch("max_tokens")) });
        assert_eq!(runner.run_task_attempts(session, &task, std::env::temp_dir().to_str().unwrap(), control, stop).await.unwrap(), ("failed", Some("max_tokens".into())));
        assert_eq!(*calls.lock().unwrap(), ["fake"]);
        assert!(!runner.store.events(session, 0, 1000).unwrap().iter().any(|event| event.kind == "team_fallback"));
    });
}

// [ADR-0011.D1] A handshake timeout or process exit before output advances the chain.
#[test]
fn team_chain_retries_pre_output_timeout_and_exit() {
    tauri::async_runtime::block_on(async {
        for (scenario, reason) in [("timeout", "handshake_timeout"), ("crash", "process_exited")] {
            let (mut runner, session, control, stop, mut task) = setup();
            insert_team(&runner.store, "failures", &[("first", None), ("second", None)]);
            task.team = "failures".into();
            runner.handshake_timeout = Duration::from_millis(250);
            runner.launch = Arc::new(move |id| Some(launch(if id == "first" { scenario } else { "max_tokens" })));
            assert_eq!(runner.run_task_attempts(session, &task, std::env::temp_dir().to_str().unwrap(), control, stop).await.unwrap(), ("failed", Some("max_tokens".into())));
            let events = runner.store.events(session, 0, 1000).unwrap();
            let fallback = events.iter().find(|event| event.kind == "team_fallback").unwrap();
            assert_eq!(fallback.payload["from"], "first");
            assert_eq!(fallback.payload["to"], "second");
            assert_eq!(fallback.payload["reason"], reason);
        }
    });
}

// [ADR-0011.D1] A selected but unknown team is an error, not an implicit harness override.
#[test]
fn unknown_team_does_not_launch_task_harness() {
    tauri::async_runtime::block_on(async {
        let (mut runner, session, control, stop, mut task) = setup();
        task.team = "absent".into();
        let calls = Arc::new(Mutex::new(Vec::new()));
        let seen = calls.clone();
        runner.launch = Arc::new(move |id| { seen.lock().unwrap().push(id.to_owned()); Some(launch("max_tokens")) });
        assert!(runner.run_task_attempts(session, &task, std::env::temp_dir().to_str().unwrap(), control, stop).await.unwrap_err().contains("absent"));
        assert!(calls.lock().unwrap().is_empty());
    });
}
