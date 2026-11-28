// @adr ADR-0017.D1
use super::*;

// This independent agent speaks JSON-RPC directly; it is not a Tauri binary.
const FAKE: &str = r#"
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
def update(update):
    send({'jsonrpc':'2.0','method':'session/update','params':{'sessionId':'session','update':update}})
def permission(id):
    options = [{'optionId':'no','name':'Deny','kind':'reject_once'}]
    if scenario != 'deny_only': options.insert(0, {'optionId':'yes','name':'Allow','kind':'allow_once'})
    send({'jsonrpc':'2.0','id':id,'method':'session/request_permission','params':{'sessionId':'session','toolCall':{'toolCallId':'tool','title':'Write file'},'options':options}})
answers = {}
turn = 0
cwd = ''
client_caps = {}
for line in sys.stdin:
    try: msg = json.loads(line)
    except ValueError: continue
    method = msg.get('method')
    if method == 'initialize':
        client_caps = msg.get('params', {}).get('clientCapabilities', {})
        if scenario == 'timeout': time.sleep(5); continue
        if scenario == 'noise': print('not json', flush=True)
        methods = [{'id':'login','name':'Login'}] if scenario == 'auth_required' else []
        reply(msg['id'], {'protocolVersion':1,'agentCapabilities':{},'authMethods':methods})
    elif method == 'session/new':
        cwd = msg['params']['cwd']
        if scenario in ('auth_required', 'auth_unadvertised'):
            send({'jsonrpc':'2.0','id':msg['id'],'error':{'code':-32000,'message':'Authentication required'}})
        else:
            reply(msg['id'], {'sessionId':'session'})
    elif method == 'session/prompt':
        prompt_id = msg['id']
        turn += 1
        if scenario == 'steer' and turn > 1:
            update({'sessionUpdate':'agent_message_chunk','content':{'type':'text','text':msg['params']['prompt'][0]['text']}})
            reply(prompt_id, {'stopReason':'end_turn'})
            continue
        if scenario == 'inspect':
            update({'sessionUpdate':'agent_message_chunk','content':{'type':'text','text':json.dumps({'cwd':cwd,'prompt':msg['params']['prompt'][0]['text']})}})
            reply(prompt_id, {'stopReason':'end_turn'})
            continue
        if scenario == 'capabilities':
            fs = client_caps.get('fs')
            read_val = 'none' if fs is None else str(fs.get('readTextFile'))
            write_val = 'none' if fs is None else str(fs.get('writeTextFile'))
            term_val = str(client_caps.get('terminal'))
            send({'jsonrpc':'2.0','id':prompt_id,'error':{'code':-32000,'message':f'CAPS terminal={term_val} read={read_val} write={write_val}'}})
            continue
        if scenario == 'crash': sys.exit(7)
        if scenario in ('max_tokens', 'max_turn_requests', 'refusal'):
            reply(prompt_id, {'stopReason':scenario})
            continue
        if scenario == 'allow': update({'sessionUpdate':'agent_thought_chunk','content':{'type':'text','text':cwd}})
        for i in range(50): update({'sessionUpdate':'agent_message_chunk','content':{'type':'text','text':'x'}})
        update({'sessionUpdate':'tool_call','toolCallId':'tool','title':'Write file','kind':'edit','status':'pending'})
        if scenario == 'collision': permission(1); permission('1')
        elif scenario in ('allow', 'deny', 'deny_only', 'stop', 'stubborn', 'group', 'steer'): permission(9)
        else: reply(prompt_id, {'stopReason':'end_turn'})
        if scenario in ('stop', 'stubborn', 'group'): update({'sessionUpdate':'agent_thought_chunk','content':{'type':'text','text':str(os.getpid())}})
        if scenario in ('collision', 'allow', 'deny', 'deny_only', 'stop', 'stubborn', 'group', 'steer'):
            update({'sessionUpdate':'tool_call_update','toolCallId':'tool','status':'in_progress'})
    elif method == 'session/cancel':
        if scenario not in ('stubborn', 'group'): reply(prompt_id, {'stopReason':'cancelled'})
    elif 'id' in msg and 'result' in msg:
        answers[(type(msg['id']).__name__, str(msg['id']))] = msg['result']['outcome']
        if scenario == 'collision' and len(answers) == 2:
            a = answers[('int','1')]; b = answers[('str','1')]
            text = 'correct' if a.get('optionId') == 'yes' and b.get('optionId') == 'no' else 'incorrect'
            update({'sessionUpdate':'agent_message_chunk','content':{'type':'text','text':text}})
            reply(prompt_id, {'stopReason':'end_turn'})
        elif scenario in ('allow','deny','deny_only','steer'):
            if msg['result']['outcome'].get('optionId') != ('no' if scenario in ('deny','deny_only') else 'yes'): sys.exit(8)
            update({'sessionUpdate':'tool_call_update','toolCallId':'tool','status':'completed'})
            reply(prompt_id, {'stopReason':'end_turn'})
if scenario in ('stubborn', 'group'): time.sleep(30)
"#;

fn setup() -> (Runner, i64, Arc<TaskControl>, watch::Receiver<bool>, PlanTask) {
    let store = Store::open(":memory:").unwrap();
    let session = store.create_session("active").unwrap();
    let runner = Runner::with_emitter(store.clone(), Arc::new(|_, _| {}));
    let (stop, receiver) = watch::channel(false);
    let control = Arc::new(TaskControl { events: Arc::new(Mutex::new(EventWriter::new(store, session, "task".into(), runner.emit.clone()))), pending: Mutex::new(HashMap::new()), steering: Mutex::new(Some(VecDeque::new())), abort: Mutex::new(None), revision: 1, stop });
    runner.registry.lock().unwrap().running.insert((session, "task".into()), control.clone());
    let task = PlanTask { id: "task".into(), title: "Do the task".into(), team: "".into(), harness: "fake".into(), worktree: false, files: vec![], dependencies: vec![], estimated_tokens: None, status: "running".into() };
    (runner, session, control, receiver, task)
}

fn launch(scenario: &str) -> agent::LaunchSpec {
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
        let handle = tauri::async_runtime::spawn(async move { worker.execute(&task, &cwd, control, stop, launch("collision"), Duration::from_secs(5)).await });
        let events = wait_for(&runner.store, session, "permission_request", 2).await;
        assert!(events.iter().any(|event| event.kind == "tool_call"));
        let ids: Vec<_> = events.iter().filter(|event| event.kind == "permission_request").map(|event| event.payload["request_id"].as_str().unwrap().to_string()).collect();
        assert_ne!(ids[0], ids[1]);
        runner.respond(session, "task", &ids[0], "allow").unwrap();
        runner.respond(session, "task", &ids[1], "deny").unwrap();
        assert_eq!(handle.await.unwrap().unwrap(), ("review", None));
        let events = runner.store.events(session, 0, 1000).unwrap();
        assert!(events.iter().any(|event| event.kind == "agent_message" && event.payload["text"] == "correct"), "events: {events:?}");
        assert_eq!(events.iter().filter(|event| event.kind == "permission_resolved").count(), 2);
    });
}

#[test]
fn handshake_timeout_is_a_failure() {
    // [ADR-0017.D1] An unresponsive initialization is bounded.
    tauri::async_runtime::block_on(async {
        let (runner, _, control, stop, task) = setup();
        let cwd = std::env::temp_dir().to_string_lossy().into_owned();
        let result = runner.execute(&task, &cwd, control, stop, launch("timeout"), Duration::from_millis(100)).await.unwrap();
        assert_eq!(result, ("failed", Some("handshake_timeout".into())));
    });
}

#[test]
fn stdout_noise_is_rejected_without_panicking() {
    // [ADR-0017.D1] Malformed stdout is handled by the SDK and valid messages continue.
    tauri::async_runtime::block_on(async {
        let (runner, _, control, stop, task) = setup();
        let cwd = std::env::temp_dir().to_string_lossy().into_owned();
        assert_eq!(runner.execute(&task, &cwd, control, stop, launch("noise"), Duration::from_secs(5)).await.unwrap(), ("review", None));
    });
}

#[test]
fn pending_permission_does_not_block_updates_and_stop_cancels_it() {
    // [ADR-0017.D2] A pending request does not stop later updates and Stop resolves it.
    tauri::async_runtime::block_on(async {
        let (runner, session, control, stop, task) = setup();
        let worker = runner.clone();
        let cwd = std::env::temp_dir().to_string_lossy().into_owned();
        let handle = tauri::async_runtime::spawn(async move { worker.execute(&task, &cwd, control, stop, launch("stop"), Duration::from_secs(5)).await });
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
        let (runner, _, control, stop, task) = setup();
        let cwd = std::env::temp_dir().to_string_lossy().into_owned();
        assert_eq!(runner.execute(&task, &cwd, control, stop, launch("crash"), Duration::from_secs(5)).await.unwrap(), ("failed", Some("process_exited".into())));
    });
}

#[test]
fn deny_is_forwarded_to_the_agent() {
    // [ADR-0017.D2] Deny selects the offered reject-once option.
    tauri::async_runtime::block_on(async {
        let (runner, session, control, stop, task) = setup();
        let worker = runner.clone();
        let cwd = std::env::temp_dir().to_string_lossy().into_owned();
        let handle = tauri::async_runtime::spawn(async move { worker.execute(&task, &cwd, control, stop, launch("deny"), Duration::from_secs(5)).await });
        let events = wait_for(&runner.store, session, "permission_request", 1).await;
        let id = events.iter().find(|event| event.kind == "permission_request").unwrap().payload["request_id"].as_str().unwrap();
        runner.respond(session, "task", id, "deny").unwrap();
        assert_eq!(handle.await.unwrap().unwrap(), ("review", None));
        assert!(runner.store.events(session, 0, 1000).unwrap().iter().any(|event| event.kind == "permission_resolved" && event.payload["decision"] == "deny"));
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
        let task = PlanTask { id: "task-1".into(), title: "Reply with OK without making changes".into(), team: "".into(), harness: "omp".into(), worktree: true, files: vec![], dependencies: vec![], estimated_tokens: None, status: "queued".into() };
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
fn steering_waits_for_the_current_prompt() {
    // [ADR-0017.D2] Steering is sent as the next prompt, never concurrently.
    tauri::async_runtime::block_on(async {
        let (runner, session_id, control, stop, task) = setup();
        let worker = runner.clone();
        let cwd = std::env::temp_dir().to_string_lossy().into_owned();
        let handle = tauri::async_runtime::spawn(async move { worker.execute(&task, &cwd, control, stop, launch("steer"), Duration::from_secs(5)).await });
        let events = wait_for(&runner.store, session_id, "permission_request", 1).await;
        let id = events.iter().find(|event| event.kind == "permission_request").unwrap().payload["request_id"].as_str().unwrap();
        runner.steer(session_id, "task", "Continue carefully".into()).unwrap();
        runner.respond(session_id, "task", id, "allow").unwrap();
        assert_eq!(handle.await.unwrap().unwrap(), ("review", None));
        let events = runner.store.events(session_id, 0, 1000).unwrap();
        let queued = events.iter().find(|event| event.kind == "steer_queued").unwrap();
        let sent = events.iter().find(|event| event.kind == "steer_sent").unwrap();
        assert!(queued.id < sent.id);
        assert_eq!(sent.payload["text"], "Continue carefully");
        assert!(events.iter().any(|event| event.kind == "agent_message" && event.payload["text"] == "Continue carefully"));
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
        assert_eq!(runner.execute(&task, root.to_str().unwrap(), control, stop, launch("inspect"), Duration::from_secs(5)).await.unwrap().0, "review");
        let events = runner.store.events(session_id, 0, 1000).unwrap();
        let handoff = events.iter().find(|event| event.kind == "handoff").unwrap();
        let received = events.iter().find(|event| event.kind == "agent_message").unwrap().payload["text"].as_str().unwrap();
        let received: serde_json::Value = serde_json::from_str(received).unwrap();
        assert_eq!(received["cwd"], handoff.payload["handoff"]["worktree_path"]);
        assert!(std::path::Path::new(received["cwd"].as_str().unwrap()).is_absolute());
        let prompt = received["prompt"].as_str().unwrap();
        assert!(prompt.contains("Do the task"));
        assert!(!prompt.contains("None"));
        assert!(!prompt.contains("Files:"));
        assert!(events.iter().all(|event| event.kind != "usage"));
        let path = handoff.payload["handoff"]["worktree_path"].as_str().unwrap();
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
        let handle = tauri::async_runtime::spawn(async move { worker.execute(&task, &cwd, control, stop, launch("deny_only"), Duration::from_secs(5)).await });
        let events = wait_for(&runner.store, session_id, "permission_request", 1).await;
        let request = events.iter().find(|event| event.kind == "permission_request").unwrap();
        assert_eq!(request.payload["can_allow"], false);
        assert_eq!(request.payload["can_deny"], true);
        let id = request.payload["request_id"].as_str().unwrap();
        assert!(runner.respond(session_id, "task", id, "allow").is_err());
        runner.respond(session_id, "task", id, "deny").unwrap();
        assert_eq!(handle.await.unwrap().unwrap(), ("review", None));
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
        let handle = tauri::async_runtime::spawn(async move { worker.execute(&task, &cwd, control, stop, launch("stubborn"), Duration::from_secs(5)).await });
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
            pending.insert("first".into(), PendingPermission { allow: None, deny: None, answer: first_tx });
            pending.insert("second".into(), PendingPermission { allow: None, deny: None, answer: second_tx });
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
