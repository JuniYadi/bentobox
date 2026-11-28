// @adr ADR-0017.D1
mod events;

use crate::{agent, db::Store, session::{self, Plan, PlanTask}, workspace};
use agent_client_protocol::{AcpAgent, AcpAgentConfig, Agent, Client, LineDirection, schema::ProtocolVersion};
use agent_client_protocol::v1::{
    ConnectionTo,
    schema::{
        CancelNotification, ClientCapabilities, ContentBlock, Implementation, InitializeRequest,
        NewSessionRequest, PermissionOptionId, PermissionOptionKind, PromptRequest,
        RequestPermissionOutcome, RequestPermissionRequest, RequestPermissionResponse,
        SelectedPermissionOutcome, SessionConfigKind, SessionConfigOptionCategory,
        SessionConfigSelectOption, SessionConfigSelectOptions, SessionConfigOptionValue,
        SessionId, SessionMode, SessionModeId, SessionNotification,
        SetSessionConfigOptionRequest, SetSessionModeRequest, StopReason, TextContent,
    },
};
use events::{Emit, EventWriter};
use serde::Serialize;
use serde_json::json;
use std::{collections::{HashMap, HashSet, VecDeque}, path::PathBuf, sync::{Arc, Mutex, atomic::{AtomicU64, Ordering}}, time::Duration};
use tauri::{Emitter, State};
use tokio::sync::{mpsc, oneshot, watch};

const MAX_RUNNING: usize = 3;
const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(120);
const STOP_GRACE: Duration = Duration::from_secs(2);

type TaskKey = (i64, String);

struct PendingPermission {
    allow: Option<PermissionOptionId>,
    deny: Option<PermissionOptionId>,
    allow_always: Option<PermissionOptionId>,
    answer: oneshot::Sender<RequestPermissionOutcome>,
}
struct TitleSessionGuard {
    session_id: Option<SessionId>,
    title_map: Arc<Mutex<HashMap<SessionId, Arc<Mutex<String>>>>>,
    connection: ConnectionTo<Agent>,
    completed: bool,
}

impl Drop for TitleSessionGuard {
    fn drop(&mut self) {
        if let Some(id) = self.session_id.take() {
            self.title_map.lock().unwrap().remove(&id);
            if !self.completed {
                let _ = self.connection.send_notification(CancelNotification::new(id));
            }
        }
    }
}

struct ActiveSession {
    session_id: SessionId,
    connection: ConnectionTo<Agent>,
    available_modes: Vec<SessionMode>,
    current_mode: Option<String>,
}

struct TaskControl {
    events: Arc<Mutex<EventWriter>>,
    pending: Mutex<HashMap<String, PendingPermission>>,
    active_session: Mutex<Option<ActiveSession>>,
    send_queue: Mutex<VecDeque<String>>,
    prompt_notify: Arc<tokio::sync::Notify>,
    abort: Mutex<Option<tokio::task::AbortHandle>>,
    revision: u64,
    stop: watch::Sender<bool>,
}

struct Registry {
    running: HashMap<TaskKey, Arc<TaskControl>>,
    sessions: HashSet<i64>,
    shutting_down: bool,
}

enum Incoming {
    Update(SessionNotification),
    Permission(RequestPermissionRequest, Box<dyn FnOnce(RequestPermissionOutcome) + Send>),
    Stderr(String),
    Flush(oneshot::Sender<()>),
}

/// @adr ADR-0017.D1
#[derive(Clone)]
pub struct Runner {
    store: Store,
    emit: Emit,
    title_emit: Arc<dyn Fn(i64, &str) + Send + Sync>,
    registry: Arc<Mutex<Registry>>,
    launch: Arc<dyn Fn(&str) -> Option<agent::LaunchSpec> + Send + Sync>,
    handshake_timeout: Duration,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct EventNotice { session_id: i64, event_id: i64 }

impl Runner {
    /// @adr ADR-0017.D1
    pub fn new(store: Store, app: tauri::AppHandle) -> Self {
        let app_title = app.clone();
        Self::with_emitters(
            store,
            Arc::new(move |session_id, event_id| {
                let _ = app.emit("runner:event", EventNotice { session_id, event_id });
            }),
            Arc::new(move |session_id, title| {
                let _ = app_title.emit("session:title", serde_json::json!({ "sessionId": session_id, "title": title }));
            }),
        )
    }

    #[cfg(test)]
    pub(crate) fn with_emitter(store: Store, emit: Emit) -> Self {
        Self::with_emitters(store, emit, Arc::new(|_, _| {}))
    }

    pub(crate) fn with_emitters(store: Store, emit: Emit, title_emit: Arc<dyn Fn(i64, &str) + Send + Sync>) -> Self {
        Self {
            store,
            emit,
            title_emit,
            registry: Arc::new(Mutex::new(Registry { running: HashMap::new(), sessions: HashSet::new(), shutting_down: false })),
            launch: Arc::new(|id| std::env::var_os("PATH").and_then(|path| agent::launch_spec(id, &path))),
            handshake_timeout: HANDSHAKE_TIMEOUT,
        }
    }

    /// @adr ADR-0017.D1
    // After a hard kill or crash, old agent process groups may survive; recovery only fixes task state.
    pub fn recover(&self) -> Result<(), String> {
        for summary in self.store.list_sessions()? {
            let plan = match self.plan(summary.id) {
                Ok(plan) => plan,
                Err(error) => { eprintln!("Failed to recover session {}: {error}", summary.id); continue; }
            };
            if let Some(plan) = plan {
                for task in plan.tasks.iter().filter(|task| matches!(task.status.as_str(), "running" | "review")) {
                    let result = session::transition_at_revision(&self.store, summary.id, &task.id, "failed", plan.revision)
                        .and_then(|_| EventWriter::new(self.store.clone(), summary.id, task.id.clone(), self.emit.clone())
                            .append("task_state", json!({"status": "failed", "reason": "interrupted"})).map(|_| ()));
                    if let Err(error) = result { eprintln!("Failed to recover session {} task {}: {error}", summary.id, task.id); }
                }
            }
        }
        Ok(())
    }

    fn plan(&self, id: i64) -> Result<Option<Plan>, String> {
        self.store.load_plan(id)?.map(|raw| serde_json::from_str(&raw).map_err(|e| e.to_string())).transpose()
    }

    /// @adr ADR-0017.D1
    pub(crate) fn start(&self, session_id: i64) -> Result<Vec<String>, String> {
        {
            let mut registry = self.registry.lock().map_err(|_| "runner lock poisoned")?;
            if registry.shutting_down { return Err("runner is shutting down".into()); }
            let plan = self.plan(session_id)?.ok_or("plan does not exist")?;
            if !plan.approved { return Err("plan is not approved".into()); }
            registry.sessions.insert(session_id);
        }
        self.schedule(session_id)
    }

    fn schedule(&self, session_id: i64) -> Result<Vec<String>, String> {
        let mut registry = self.registry.lock().map_err(|_| "runner lock poisoned")?;
        if registry.shutting_down { return Ok(Vec::new()); }
        let plan = self.plan(session_id)?.ok_or("plan does not exist")?;
        if !plan.approved { return Ok(Vec::new()); }
        let workspace_path = self.store.list_sessions()?.into_iter().find(|s| s.id == session_id).ok_or("unknown session")?.workspace_path;
        let mut started = Vec::new();
        for task in plan.tasks.iter().filter(|task| task.status == "queued") {
            let running_count = {
                let mut count = 0;
                for (sid, tid) in registry.running.keys() {
                    if let Ok(Some(plan)) = self.plan(*sid) {
                        if plan.tasks.iter().any(|t| t.id == *tid && t.status == "running") {
                            count += 1;
                        }
                    }
                }
                count
            };
            if running_count >= MAX_RUNNING { break; }
            if registry.running.keys().any(|(id, running_task)| *id == session_id && *running_task == task.id) { continue; }
            if task.dependencies.iter().any(|id| !plan.tasks.iter().any(|item| item.id == *id && item.status == "completed")) { continue; }
            session::transition_at_revision(&self.store, session_id, &task.id, "running", plan.revision)?;
            let events = Arc::new(Mutex::new(EventWriter::new(self.store.clone(), session_id, task.id.clone(), self.emit.clone())));
            events.lock().map_err(|_| "event lock poisoned")?.append("task_state", json!({"status": "running"}))?;
            let (stop, receiver) = watch::channel(false);
            let control = Arc::new(TaskControl {
                events,
                pending: Mutex::new(HashMap::new()),
                active_session: Mutex::new(None),
                send_queue: Mutex::new(VecDeque::new()),
                prompt_notify: Arc::new(tokio::sync::Notify::new()),
                abort: Mutex::new(None),
                revision: plan.revision,
                stop,
            });
            registry.running.insert((session_id, task.id.clone()), control.clone());
            started.push(task.id.clone());
            let runner = self.clone();
            let task = task.clone();
            let workspace_path = workspace_path.clone();
            let task_control = control.clone();
            let handle = tauri::async_runtime::spawn(async move { runner.run_task(session_id, task, workspace_path, task_control, receiver).await; });
            *control.abort.lock().map_err(|_| "runner task lock poisoned")? = Some(handle.inner().abort_handle());
        }
        Ok(started)
    }

    fn control(&self, session_id: i64, task_id: &str) -> Result<Arc<TaskControl>, String> {
        self.registry.lock().map_err(|_| "runner lock poisoned")?.running.get(&(session_id, task_id.to_owned())).cloned().ok_or_else(|| "task is not running".into())
    }

    fn stop(&self, session_id: i64, task_id: &str) -> Result<(), String> {
        let control = self.control(session_id, task_id)?;
        Self::stop_control(&control)
    }

    fn stop_control(control: &TaskControl) -> Result<(), String> {
        control.stop.send_replace(true);
        let pending = std::mem::take(&mut *control.pending.lock().map_err(|_| "permission lock poisoned")?);
        let mut failure = None;
        for (request_id, permission) in pending {
            let result = control.events.lock().map_err(|_| "event lock poisoned".to_string()).and_then(|events| events.append("permission_resolved", json!({"request_id": request_id, "decision": "cancelled"})).map(|_| ()));
            if let Err(error) = result { if failure.is_none() { failure = Some(error); } }
            let _ = permission.answer.send(RequestPermissionOutcome::Cancelled);
        }
        failure.map_or(Ok(()), Err)
    }

    /// @adr ADR-0017.D2
    pub(crate) fn cancel_session(&self, session_id: i64) -> Result<Plan, String> {
        let mut registry = self.registry.lock().map_err(|_| "runner lock poisoned")?;
        let plan = self.plan(session_id)?.ok_or("plan does not exist")?;
        if !plan.approved || !matches!(plan.phase.as_str(), "Approve" | "Build" | "Review") { return Err("plan cannot be cancelled in its current phase".into()); }
        registry.sessions.remove(&session_id);
        let running: Vec<_> = registry.running.iter().filter(|((id, _), _)| *id == session_id).map(|((_, task_id), control)| (task_id.clone(), control.clone())).collect();
        let mut failure = None;
        for (_, control) in &running {
            if let Err(error) = Self::stop_control(control) { if failure.is_none() { failure = Some(error); } }
        }
        for (task_id, control) in &running {
            if control.revision != plan.revision { continue; }
            match session::transition_at_revision(&self.store, session_id, task_id, "cancelled", control.revision) {
                Ok(_) => { control.events.lock().map_err(|_| "event lock poisoned")?.append("task_state", json!({"status": "cancelled"}))?; }
                Err(error) => {
                    let current = self.plan(session_id)?.ok_or("plan does not exist")?;
                    if !current.tasks.iter().any(|task| task.id == *task_id && matches!(task.status.as_str(), "cancelled" | "failed" | "completed")) { return Err(error); }
                }
            }
        }
        let plan = session::cancel(&self.store, session_id)?;
        match failure { Some(error) => Err(error), None => Ok(plan) }
    }

    fn respond(&self, session_id: i64, task_id: &str, request_id: &str, decision: &str) -> Result<(), String> {
        let control = self.control(session_id, task_id)?;
        let mut pending = control.pending.lock().map_err(|_| "permission lock poisoned")?;
        let permission = pending.get(request_id).ok_or("permission request is not pending")?;
        let option = match decision {
            "allow" => permission.allow.clone(),
            "deny" => permission.deny.clone(),
            "allow_always" => permission.allow_always.clone(),
            _ => return Err("decision must be allow, deny, or allow_always".into()),
        }.ok_or("decision was not offered")?;
        control.events.lock().map_err(|_| "event lock poisoned")?.append("permission_resolved", json!({"request_id": request_id, "decision": decision}))?;
        let permission = pending.remove(request_id).expect("permission remains pending under lock");
        permission.answer.send(RequestPermissionOutcome::Selected(SelectedPermissionOutcome::new(option))).map_err(|_| "agent no longer awaits permission".into())
    }

    fn send(&self, session_id: i64, task_id: &str, text: String) -> Result<(), String> {
        let control = self.control(session_id, task_id)?;
        if *control.stop.borrow() { return Err("task is stopping".into()); }
        let plan = self.plan(session_id)?.ok_or("plan does not exist")?;
        let task = plan.tasks.iter().find(|t| t.id == task_id).ok_or("unknown task")?;
        match task.status.as_str() {
            "running" => {
                control.events.lock().map_err(|_| "event lock poisoned")?.append("user_message", json!({"text": text}))?;
                control.send_queue.lock().map_err(|_| "send queue lock poisoned")?.push_back(text);
                Ok(())
            }
            "review" => {
                session::transition_at_revision(&self.store, session_id, task_id, "running", control.revision)?;
                let events = control.events.lock().map_err(|_| "event lock poisoned")?;
                events.append("task_state", json!({"status": "running"}))?;
                events.append("user_message", json!({"text": text}))?;
                control.send_queue.lock().map_err(|_| "send queue lock poisoned")?.push_back(text);
                control.prompt_notify.notify_one();
                Ok(())
            }
            status => Err(format!("task is in state {status}, expected running or review")),
        }
    }

    async fn set_mode(&self, session_id: i64, task_id: &str, mode_id: &str) -> Result<(), String> {
        let control = self.control(session_id, task_id)?;
        let (connection, acp_session_id) = {
            let active = control.active_session.lock().map_err(|_| "active session lock poisoned")?;
            let active = active.as_ref().ok_or("task has no active session")?;
            if !active.available_modes.iter().any(|m| m.id.0.as_ref() == mode_id) {
                return Err("mode is not in advertised modes".into());
            }
            (active.connection.clone(), active.session_id.clone())
        };
        connection.send_request(SetSessionModeRequest::new(acp_session_id, SessionModeId::new(mode_id))).block_task().await.map_err(|e| e.to_string())?;
        {
            let mut active = control.active_session.lock().map_err(|_| "active session lock poisoned")?;
            if let Some(active) = active.as_mut() {
                active.current_mode = Some(mode_id.to_string());
            }
        }
        control.events.lock().map_err(|_| "event lock poisoned")?.append("session_mode_changed", json!({"current": mode_id}))?;
        Ok(())
    }

    /// @adr ADR-0017.D1
    pub fn shutdown(&self) {
        let tasks: Vec<_> = match self.registry.lock() {
            Ok(mut registry) => { registry.shutting_down = true; registry.running.iter().map(|(key, control)| (key.clone(), control.clone())).collect() },
            Err(_) => return,
        };
        for ((session, task), _) in &tasks { let _ = self.stop(*session, task); }
        let deadline = std::time::Instant::now() + Duration::from_secs(5);
        while std::time::Instant::now() < deadline {
            if self.registry.lock().map(|registry| registry.running.is_empty()).unwrap_or(true) { return; }
            std::thread::sleep(Duration::from_millis(10));
        }
        for ((session_id, task_id), control) in &tasks {
            if let Ok(handle) = control.abort.lock() { if let Some(handle) = handle.as_ref() { handle.abort(); } }
            if session::transition_at_revision(&self.store, *session_id, task_id, "cancelled", control.revision).is_ok() {
                if let Ok(events) = control.events.lock() { let _ = events.append("task_state", json!({"status": "cancelled"})); }
            }
        }
        // Aborting schedules cancellation; wait for the futures to drop their process guards.
        let deadline = std::time::Instant::now() + Duration::from_secs(1);
        while std::time::Instant::now() < deadline {
            if tasks.iter().all(|(_, control)| control.abort.lock().map(|handle| handle.as_ref().is_none_or(|handle| handle.is_finished())).unwrap_or(true)) { break; }
            std::thread::sleep(Duration::from_millis(10));
        }
    }

    async fn run_task(&self, session_id: i64, task: PlanTask, workspace_path: String, control: Arc<TaskControl>, stop: watch::Receiver<bool>) {
        let result = match (self.launch)(&task.harness) {
            Some(spec) => self.execute(session_id, &task, &workspace_path, control.clone(), stop, spec, self.handshake_timeout).await,
            None => Err("harness is not runnable".into()),
        };
        if let Ok(mut queue) = control.send_queue.lock() { queue.clear(); }
        if let Ok(mut pending) = control.pending.lock() {
            for (request_id, permission) in std::mem::take(&mut *pending) {
                if let Ok(events) = control.events.lock() {
                    let _ = events.append("permission_resolved", json!({"request_id": request_id, "decision": "cancelled"}));
                }
                let _ = permission.answer.send(RequestPermissionOutcome::Cancelled);
            }
        }
        let (status, reason) = if *control.stop.borrow() { ("cancelled", None) } else { match result { Ok(pair) => pair, Err(reason) => ("failed", Some(reason)) } };
        if session::transition_at_revision(&self.store, session_id, &task.id, status, control.revision).is_ok() {
            if let Ok(mut events) = control.events.lock() {
                let _ = events.flush();
                let mut payload = json!({"status": status});
                if let Some(reason) = reason { payload["reason"] = json!(reason); }
                let _ = events.append("task_state", payload);
            }
        }
        let sessions = if let Ok(mut registry) = self.registry.lock() {
            registry.running.remove(&(session_id, task.id));
            registry.sessions.iter().copied().collect::<Vec<_>>()
        } else { Vec::new() };
        for id in sessions { let _ = self.schedule(id); }
    }

    async fn execute(&self, session_id: i64, task: &PlanTask, workspace_path: &str, control: Arc<TaskControl>, mut stop: watch::Receiver<bool>, spec: agent::LaunchSpec, handshake_timeout: Duration) -> Result<(&'static str, Option<String>), String> {
        let root = PathBuf::from(workspace_path).canonicalize().map_err(|e| e.to_string())?;
        if task.files.iter().any(|file| std::path::Path::new(file).components().any(|part| matches!(part, std::path::Component::ParentDir | std::path::Component::RootDir | std::path::Component::Prefix(_)))) {
            return Err("task files must be relative to the worktree".into());
        }
        let (cwd, branch) = if task.worktree && crate::project::is_git_repo(&root) {
            let worktree = workspace::create(&root, &task.id, "HEAD", true)?.ok_or("worktree creation disabled")?.worktree;
            (PathBuf::from(worktree.path).canonicalize().map_err(|e| e.to_string())?, worktree.branch)
        } else { (root, None) };
        let placeholder = clean_title(&task.title);
        if !placeholder.is_empty() {
            let _ = self.store.set_placeholder_title(session_id, &placeholder);
        }
        let mut prompt = format!("Goal: {}\n", task.title);
        if !task.files.is_empty() { prompt.push_str("\nFiles:\n"); for path in &task.files { prompt.push_str(&format!("- {path}\n")); } }
        prompt.push_str(&format!("\nWorktree: {}", cwd.display()));
        {
            let mut events = control.events.lock().map_err(|_| "event lock poisoned")?;
            events.set_branch(branch);
            events.append("user_message", json!({"text": task.title}))?;
            let mut handoff = json!({"goal": task.title, "worktree_path": cwd});
            if !task.files.is_empty() { handoff["files"] = json!(task.files.iter().map(|path| json!({"path": path})).collect::<Vec<_>>()); }
            events.append("handoff", json!({"handoff": handoff}))?;
        }
        let (incoming, mut receiver) = mpsc::unbounded_channel::<Incoming>();
        let worker_control = control.clone();
        let event_worker = tauri::async_runtime::spawn(async move {
            while let Some(message) = receiver.recv().await {
                match message {
                    Incoming::Update(notification) => worker_control.events.lock().map_err(|_| "event lock poisoned")?.update(notification.update)?,
                    Incoming::Stderr(line) => worker_control.events.lock().map_err(|_| "event lock poisoned")?.stderr_line(&line)?,
                    Incoming::Flush(done) => { worker_control.events.lock().map_err(|_| "event lock poisoned")?.flush()?; let _ = done.send(()); },
                    Incoming::Permission(request, reply) => {
                        // The UI echoes this opaque ID; the responder retains the real wire ID.
                        let request_id = format!("perm-{}", uuid::Uuid::new_v4());
                        let allow = request.options.iter().find(|o| o.kind == PermissionOptionKind::AllowOnce).map(|o| o.option_id.clone());
                        let deny = request.options.iter().find(|o| o.kind == PermissionOptionKind::RejectOnce).map(|o| o.option_id.clone());
                        let allow_always = request.options.iter().find(|o| o.kind == PermissionOptionKind::AllowAlways).map(|o| o.option_id.clone());
                        let allow_always_flag = allow_always.is_some();
                        let operation = request.tool_call.fields.title.clone().unwrap_or_else(|| request.tool_call.tool_call_id.0.to_string());
                        let target = request.tool_call.fields.locations.as_ref().and_then(|locations| locations.first()).map(|location| location.path.clone());
                        let (tx, rx) = oneshot::channel();
                        {
                            let mut pending = worker_control.pending.lock().map_err(|_| "permission lock poisoned")?;
                            let mut events = worker_control.events.lock().map_err(|_| "event lock poisoned")?;
                            events.flush()?;
                            let mut payload = json!({"request_id": request_id, "operation": operation, "can_allow": allow.is_some(), "can_deny": deny.is_some(), "allow_always": allow_always_flag});
                            if let Some(target) = target { payload["target"] = json!(target); }
                            events.append("permission_request", payload)?;
                            if *worker_control.stop.borrow() {
                                events.append("permission_resolved", json!({"request_id": request_id, "decision": "cancelled"}))?;
                                let _ = tx.send(RequestPermissionOutcome::Cancelled);
                            } else {
                                pending.insert(request_id, PendingPermission { allow, deny, allow_always, answer: tx });
                            }
                        }
                        tauri::async_runtime::spawn(async move { reply(rx.await.unwrap_or(RequestPermissionOutcome::Cancelled)); });
                    }
                }
            }
            Ok::<(), String>(())
        });
        let stderr = incoming.clone();
        let stderr_count = AtomicU64::new(0);
        let agent = AcpAgent::new(AcpAgentConfig::new(spec.program).args(spec.args)).with_debug(move |line, direction| {
            if direction == LineDirection::Stderr && stderr_count.fetch_add(1, Ordering::Relaxed) <= 500 { let _ = stderr.send(Incoming::Stderr(line.to_owned())); }
        });
        let notifications = incoming.clone();
        let permissions = incoming.clone();
        let foreground_events = incoming.clone();
        let foreground = control.clone();
        let capability_store = self.store.clone();
        let harness = task.harness.clone();
        let task_id_clone = task.id.clone();
        let task_title_clone = task.title.clone();
        let outcome = Arc::new(Mutex::new(("failed", Some("protocol_error".to_string()))));
        let final_outcome = outcome.clone();
        let title_sessions = Arc::new(Mutex::new(HashMap::<SessionId, Arc<Mutex<String>>>::new()));
        let title_notifs = title_sessions.clone();
        let title_perms = title_sessions.clone();
        let title_emitter = self.title_emit.clone();
        let connection = Client.v1()
            .on_receive_notification(async move |notification: SessionNotification, _cx| {
                let title_buf = title_notifs.lock().unwrap().get(&notification.session_id).cloned();
                if let Some(buf) = title_buf {
                    if let agent_client_protocol::v1::schema::SessionUpdate::AgentMessageChunk(chunk) = notification.update {
                        if let ContentBlock::Text(text) = chunk.content {
                            buf.lock().unwrap().push_str(&text.text);
                        }
                    }
                    return Ok(());
                }
                let _ = notifications.send(Incoming::Update(notification));
                Ok(())
            }, agent_client_protocol::on_receive_notification!())
            .on_receive_request(async move |request: RequestPermissionRequest, responder, _cx| {
                if title_perms.lock().unwrap().contains_key(&request.session_id) {
                    let _ = responder.respond(RequestPermissionResponse::new(RequestPermissionOutcome::Cancelled));
                    return Ok(());
                }
                let reply = Box::new(move |answer| { let _ = responder.respond(RequestPermissionResponse::new(answer)); });
                let _ = permissions.send(Incoming::Permission(request, reply));
                Ok(())
            }, agent_client_protocol::on_receive_request!())
            .connect_with(agent, move |connection: ConnectionTo<Agent>| async move {
                let handshake = async {
                    let init = connection.send_request(InitializeRequest::new(ProtocolVersion::V1).client_info(Implementation::new("bentobox", "0.1.0")).client_capabilities(ClientCapabilities::default().terminal(false))).block_task().await?;
                    let _ = capability_store.set_capability(&format!("acp:{harness}"), &serde_json::to_value(&init.agent_capabilities).unwrap_or_default());
                    let session = connection.send_request(NewSessionRequest::new(cwd.clone())).block_task().await;
                    if session.as_ref().err().is_some_and(|error| error.code == agent_client_protocol::ErrorCode::AUTH_REQUIRED) && !init.auth_methods.is_empty() { *final_outcome.lock().unwrap_or_else(std::sync::PoisonError::into_inner) = ("failed", Some("authentication_required".into())); }
                    session
                };
                let session = tokio::select! {
                    result = tokio::time::timeout(handshake_timeout, handshake) => match result {
                        Ok(result) => result?,
                        Err(_) => { *final_outcome.lock().unwrap_or_else(std::sync::PoisonError::into_inner) = ("failed", Some("handshake_timeout".into())); return Ok(()); }
                    },
                    _ = stop.changed() => { *final_outcome.lock().unwrap_or_else(std::sync::PoisonError::into_inner) = ("cancelled", None); return Ok(()); }
                };
                let (available_modes, initial_mode) = if let Some(modes) = session.modes {
                    let available = modes.available_modes;
                    let target = if available.iter().any(|m| m.id.0.as_ref() == "auto") {
                        Some("auto")
                    } else if available.iter().any(|m| m.id.0.as_ref() == "acceptEdits") {
                        Some("acceptEdits")
                    } else if available.iter().any(|m| m.id.0.as_ref() == "default") {
                        Some("default")
                    } else if modes.current_mode_id.0.as_ref() != "bypassPermissions" {
                        Some(modes.current_mode_id.0.as_ref())
                    } else {
                        available.iter().find(|m| m.id.0.as_ref() != "bypassPermissions").map(|m| m.id.0.as_ref())
                    };
                    let mut current_id = modes.current_mode_id.0.to_string();
                    if let Some(target_mode) = target {
                        if target_mode != current_id {
                            if connection.send_request(SetSessionModeRequest::new(session.session_id.clone(), SessionModeId::new(target_mode))).block_task().await.is_ok() {
                                current_id = target_mode.to_string();
                            }
                        }
                    }
                    let mode_list: Vec<_> = available.iter().map(|m| json!({ "id": m.id.0.as_ref(), "name": m.name })).collect();
                    if let Ok(events) = foreground.events.lock() {
                        let _ = events.append("session_modes", json!({ "available": mode_list, "current": current_id }));
                    }
                    (available, Some(current_id))
                } else {
                    (Vec::new(), None)
                };
                *foreground.active_session.lock().unwrap() = Some(ActiveSession {
                    session_id: session.session_id.clone(),
                    connection: connection.clone(),
                    available_modes,
                    current_mode: initial_mode,
                });
                let title_conn = connection.clone();
                let title_task_title = task_title_clone.clone();
                let title_harness = harness.clone();
                let title_cwd = cwd.clone();
                let title_store = capability_store.clone();
                let title_map = title_sessions.clone();
                tauri::async_runtime::spawn(async move {
                    let title_gen = async move {
                        let mut guard = TitleSessionGuard {
                            session_id: None,
                            title_map: title_map.clone(),
                            connection: title_conn.clone(),
                            completed: false,
                        };
                        let title_sess = title_conn.send_request(NewSessionRequest::new(title_cwd)).block_task().await.map_err(|e| e.to_string())?;
                        let buf = Arc::new(Mutex::new(String::new()));
                        title_map.lock().unwrap().insert(title_sess.session_id.clone(), buf.clone());
                        guard.session_id = Some(title_sess.session_id.clone());
                        if let Some(configs) = &title_sess.config_options {
                            if let Some(model_cfg) = configs.iter().find(|c| c.category == Some(SessionConfigOptionCategory::Model)) {
                                if let SessionConfigKind::Select(select) = &model_cfg.kind {
                                    let opts: Vec<&SessionConfigSelectOption> = match &select.options {
                                        SessionConfigSelectOptions::Ungrouped(o) => o.iter().collect(),
                                        SessionConfigSelectOptions::Grouped(g) => g.iter().flat_map(|grp| grp.options.iter()).collect(),
                                        _ => Vec::new(),
                                    };
                                    let target_opt = opts.into_iter().find(|opt| {
                                        let text = format!("{} {}", opt.value.0, opt.name).to_lowercase();
                                        let desc = opt.description.as_deref().unwrap_or("").to_lowercase();
                                        let h = title_harness.to_lowercase();
                                        if h.contains("claude") {
                                            text.contains("haiku")
                                        } else if h.contains("codex") {
                                            text.contains("luna")
                                        } else if h.contains("opencode") {
                                            text.contains("free") || desc.contains("free")
                                        } else {
                                            false
                                        }
                                    });
                                    if let Some(chosen) = target_opt {
                                        let _ = title_conn.send_request(SetSessionConfigOptionRequest::new(
                                            title_sess.session_id.clone(),
                                            model_cfg.id.clone(),
                                            SessionConfigOptionValue::from(chosen.value.clone()),
                                        )).block_task().await;
                                    }
                                }
                            }
                        }
                        let prompt_text = format!("Generate a short plain-text title of at most 6 words for the following user request. Do not include quotes, markdown formatting, or preamble:\n\n{title_task_title}");
                        let _ = title_conn.send_request(PromptRequest::new(title_sess.session_id.clone(), vec![ContentBlock::Text(TextContent::new(prompt_text))])).block_task().await;
                        guard.completed = true;
                        drop(guard);
                        let raw = buf.lock().unwrap().clone();
                        let cleaned = clean_title(&raw);
                        if !cleaned.is_empty() {
                            if let Ok(true) = title_store.update_generated_title(session_id, &cleaned) {
                                title_emitter(session_id, &cleaned);
                            }
                        }
                        Ok::<(), String>(())
                    };
                    let _ = tokio::time::timeout(Duration::from_secs(30), title_gen).await;
                });
                let mut next = prompt;
                loop {
                    if *stop.borrow() { *final_outcome.lock().unwrap_or_else(std::sync::PoisonError::into_inner) = ("cancelled", None); return Ok(()); }
                    let request = connection.send_request(PromptRequest::new(session.session_id.clone(), vec![ContentBlock::Text(TextContent::new(next))])).block_task();
                    tokio::pin!(request);
                    let response = tokio::select! {
                        result = &mut request => result?,
                        _ = stop.changed() => {
                            let _ = connection.send_notification(CancelNotification::new(session.session_id.clone()));
                            let _ = tokio::time::timeout(STOP_GRACE, &mut request).await;
                            *final_outcome.lock().unwrap_or_else(std::sync::PoisonError::into_inner) = ("cancelled", None);
                            return Ok(());
                        }
                    };
                    if *stop.borrow() { *final_outcome.lock().unwrap_or_else(std::sync::PoisonError::into_inner) = ("cancelled", None); return Ok(()); }
                    let (done, flushed) = oneshot::channel();
                    let _ = foreground_events.send(Incoming::Flush(done));
                    let _ = flushed.await;
                    match response.stop_reason {
                        StopReason::EndTurn => {
                            let _ = session::transition_at_revision(&capability_store, session_id, &task_id_clone, "review", foreground.revision);
                            if let Ok(events) = foreground.events.lock() {
                                let _ = events.append("task_state", json!({"status": "review"}));
                            }
                            loop {
                                let queued = foreground.send_queue.lock().ok().and_then(|mut q| q.pop_front());
                                if let Some(text) = queued {
                                    let _ = session::transition_at_revision(&capability_store, session_id, &task_id_clone, "running", foreground.revision);
                                    if let Ok(events) = foreground.events.lock() {
                                        let _ = events.append("task_state", json!({"status": "running"}));
                                    }
                                    next = text;
                                    break;
                                }
                                tokio::select! {
                                    _ = stop.changed() => {
                                        *final_outcome.lock().unwrap_or_else(std::sync::PoisonError::into_inner) = ("cancelled", None);
                                        return Ok(());
                                    }
                                    _ = foreground.prompt_notify.notified() => {}
                                }
                            }
                            continue;
                        },
                        StopReason::Cancelled => *final_outcome.lock().unwrap_or_else(std::sync::PoisonError::into_inner) = ("cancelled", None),
                        StopReason::MaxTokens => *final_outcome.lock().unwrap_or_else(std::sync::PoisonError::into_inner) = ("failed", Some("max_tokens".into())),
                        StopReason::MaxTurnRequests => *final_outcome.lock().unwrap_or_else(std::sync::PoisonError::into_inner) = ("failed", Some("max_turn_requests".into())),
                        StopReason::Refusal => *final_outcome.lock().unwrap_or_else(std::sync::PoisonError::into_inner) = ("failed", Some("refusal".into())),
                        _ => *final_outcome.lock().unwrap_or_else(std::sync::PoisonError::into_inner) = ("failed", Some("protocol_error".into())),
                    }
                    return Ok(());
                }
            });
        if let Err(error) = connection.await {
            let mut result = outcome.lock().map_err(|_| "outcome lock poisoned")?;
            if result.1.as_deref() == Some("protocol_error") && (agent_client_protocol::is_connection_terminated(&error) || agent_client_protocol::is_incoming_transport_closed(&error) || error.data.as_ref().and_then(|data| data.as_str()).is_some_and(|data| data.starts_with("Process exited with"))) {
                result.1 = Some("process_exited".into());
            }
            if let Ok(events) = control.events.lock() { let _ = events.append("agent_log", json!({"text": error.to_string()})); }
        }
        drop(incoming);
        event_worker.await.map_err(|error| error.to_string())??;
        control.events.lock().map_err(|_| "event lock poisoned")?.flush()?;
        let result = outcome.lock().map_err(|_| "outcome lock poisoned")?.clone();
        Ok(result)
    }
}

/// @adr ADR-0017.D1
#[tauri::command]
pub fn runner_start(runner: State<'_, Runner>, session_id: i64) -> Result<Vec<String>, String> { runner.start(session_id) }
/// @adr ADR-0017.D2
#[tauri::command]
pub fn runner_stop(runner: State<'_, Runner>, session_id: i64, task_id: String) -> Result<(), String> { runner.stop(session_id, &task_id) }
/// @adr ADR-0017.D2
/// @adr ADR-0018.D3
#[tauri::command]
pub fn runner_respond_permission(runner: State<'_, Runner>, session_id: i64, task_id: String, request_id: String, decision: String) -> Result<(), String> { runner.respond(session_id, &task_id, &request_id, &decision) }
/// @adr ADR-0018.D2
#[tauri::command]
pub fn runner_send(runner: State<'_, Runner>, session_id: i64, task_id: String, text: String) -> Result<(), String> { runner.send(session_id, &task_id, text) }
/// @adr ADR-0018.D3
#[tauri::command]
pub async fn runner_set_mode(runner: State<'_, Runner>, session_id: i64, task_id: String, mode_id: String) -> Result<(), String> { runner.set_mode(session_id, &task_id, &mode_id).await }
/// @adr ADR-0018.D5

fn clean_title(raw: &str) -> String {
    let trimmed = raw.trim().trim_matches(|c| matches!(c, '"' | '\'' | '`' | '“' | '”' | '«' | '»'));
    let single_line = trimmed.replace(['\r', '\n', '\t'], " ");
    let text = single_line.split_whitespace().collect::<Vec<_>>().join(" ");
    if text.chars().count() <= 60 {
        text
    } else {
        text.char_indices().nth(60).map(|(i, _)| text[..i].to_string()).unwrap_or(text)
    }
}

#[cfg(test)]
#[path = "runner_test.rs"]
mod tests;
