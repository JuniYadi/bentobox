// @adr ADR-0017.D1
mod events;

use crate::{agent, db::Store, session::{self, Plan, PlanTask}, workspace};
use agent_client_protocol::{AcpAgent, AcpAgentConfig, Agent, Client, LineDirection, schema::ProtocolVersion};
use agent_client_protocol::v1::{ConnectionTo, schema::{CancelNotification, ClientCapabilities, ContentBlock, Implementation, InitializeRequest, NewSessionRequest, PermissionOptionId, PermissionOptionKind, PromptRequest, RequestPermissionOutcome, RequestPermissionRequest, RequestPermissionResponse, SelectedPermissionOutcome, SessionNotification, StopReason, TextContent}};
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
    answer: oneshot::Sender<RequestPermissionOutcome>,
}

struct TaskControl {
    events: Arc<Mutex<EventWriter>>,
    pending: Mutex<HashMap<String, PendingPermission>>,
    steering: Mutex<Option<VecDeque<String>>>,
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
        Self::with_emitter(store, Arc::new(move |session_id, event_id| {
            let _ = app.emit("runner:event", EventNotice { session_id, event_id });
        }))
    }

    pub(crate) fn with_emitter(store: Store, emit: Emit) -> Self {
        Self { store, emit, registry: Arc::new(Mutex::new(Registry { running: HashMap::new(), sessions: HashSet::new(), shutting_down: false })), launch: Arc::new(|id| std::env::var_os("PATH").and_then(|path| agent::launch_spec(id, &path))), handshake_timeout: HANDSHAKE_TIMEOUT }
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
                for task in plan.tasks.iter().filter(|task| task.status == "running") {
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
            if registry.running.len() >= MAX_RUNNING { break; }
            if registry.running.keys().any(|(id, running_task)| *id == session_id && *running_task == task.id) { continue; }
            if task.dependencies.iter().any(|id| !plan.tasks.iter().any(|item| item.id == *id && item.status == "completed")) { continue; }
            session::transition_at_revision(&self.store, session_id, &task.id, "running", plan.revision)?;
            let events = Arc::new(Mutex::new(EventWriter::new(self.store.clone(), session_id, task.id.clone(), self.emit.clone())));
            events.lock().map_err(|_| "event lock poisoned")?.append("task_state", json!({"status": "running"}))?;
            let (stop, receiver) = watch::channel(false);
            let control = Arc::new(TaskControl { events, pending: Mutex::new(HashMap::new()), steering: Mutex::new(Some(VecDeque::new())), abort: Mutex::new(None), revision: plan.revision, stop });
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
        let option = match decision { "allow" => permission.allow.clone(), "deny" => permission.deny.clone(), _ => return Err("decision must be allow or deny".into()) }.ok_or("decision was not offered")?;
        control.events.lock().map_err(|_| "event lock poisoned")?.append("permission_resolved", json!({"request_id": request_id, "decision": decision}))?;
        let permission = pending.remove(request_id).expect("permission remains pending under lock");
        permission.answer.send(RequestPermissionOutcome::Selected(SelectedPermissionOutcome::new(option))).map_err(|_| "agent no longer awaits permission".into())
    }

    fn steer(&self, session_id: i64, task_id: &str, text: String) -> Result<(), String> {
        let control = self.control(session_id, task_id)?;
        if *control.stop.borrow() { return Err("task is stopping".into()); }
        let mut queue = control.steering.lock().map_err(|_| "steering lock poisoned")?;
        let queue = queue.as_mut().ok_or("task is not running")?;
        control.events.lock().map_err(|_| "event lock poisoned")?.append("steer_queued", json!({"text": text}))?;
        queue.push_back(text);
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
            Some(spec) => self.execute(&task, &workspace_path, control.clone(), stop, spec, self.handshake_timeout).await,
            None => Err("harness is not runnable".into()),
        };
        if let Ok(mut queue) = control.steering.lock() { *queue = None; }
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

    async fn execute(&self, task: &PlanTask, workspace_path: &str, control: Arc<TaskControl>, mut stop: watch::Receiver<bool>, spec: agent::LaunchSpec, handshake_timeout: Duration) -> Result<(&'static str, Option<String>), String> {
        let root = PathBuf::from(workspace_path).canonicalize().map_err(|e| e.to_string())?;
        if task.files.iter().any(|file| std::path::Path::new(file).components().any(|part| matches!(part, std::path::Component::ParentDir | std::path::Component::RootDir | std::path::Component::Prefix(_)))) {
            return Err("task files must be relative to the worktree".into());
        }
        let (cwd, branch) = if task.worktree {
            let worktree = workspace::create(&root, &task.id, "HEAD", true)?.ok_or("worktree creation disabled")?.worktree;
            (PathBuf::from(worktree.path).canonicalize().map_err(|e| e.to_string())?, worktree.branch)
        } else { (root, None) };
        let mut prompt = format!("Goal: {}\n", task.title);
        if !task.files.is_empty() { prompt.push_str("\nFiles:\n"); for path in &task.files { prompt.push_str(&format!("- {path}\n")); } }
        prompt.push_str(&format!("\nWorktree: {}", cwd.display()));
        {
            let mut events = control.events.lock().map_err(|_| "event lock poisoned")?;
            events.set_branch(branch);
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
                        let operation = request.tool_call.fields.title.clone().unwrap_or_else(|| request.tool_call.tool_call_id.0.to_string());
                        let target = request.tool_call.fields.locations.as_ref().and_then(|locations| locations.first()).map(|location| location.path.clone());
                        let (tx, rx) = oneshot::channel();
                        {
                            let mut pending = worker_control.pending.lock().map_err(|_| "permission lock poisoned")?;
                            let mut events = worker_control.events.lock().map_err(|_| "event lock poisoned")?;
                            events.flush()?;
                            let mut payload = json!({"request_id": request_id, "operation": operation, "can_allow": allow.is_some(), "can_deny": deny.is_some()});
                            if let Some(target) = target { payload["target"] = json!(target); }
                            events.append("permission_request", payload)?;
                            if *worker_control.stop.borrow() {
                                events.append("permission_resolved", json!({"request_id": request_id, "decision": "cancelled"}))?;
                                let _ = tx.send(RequestPermissionOutcome::Cancelled);
                            } else {
                                pending.insert(request_id, PendingPermission { allow, deny, answer: tx });
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
        let outcome = Arc::new(Mutex::new(("failed", Some("protocol_error".to_string()))));
        let final_outcome = outcome.clone();
        let connection = Client.v1()
            .on_receive_notification(async move |notification: SessionNotification, _cx| {
                let _ = notifications.send(Incoming::Update(notification));
                Ok(())
            }, agent_client_protocol::on_receive_notification!())
            .on_receive_request(async move |request: RequestPermissionRequest, responder, _cx| {
                let reply = Box::new(move |answer| { let _ = responder.respond(RequestPermissionResponse::new(answer)); });
                let _ = permissions.send(Incoming::Permission(request, reply));
                Ok(())
            }, agent_client_protocol::on_receive_request!())
            .connect_with(agent, move |connection: ConnectionTo<Agent>| async move {
                let handshake = async {
                    let init = connection.send_request(InitializeRequest::new(ProtocolVersion::V1).client_info(Implementation::new("bentobox", "0.1.0")).client_capabilities(ClientCapabilities::default().terminal(false))).block_task().await?;
                    let _ = capability_store.set_capability(&format!("acp:{harness}"), &serde_json::to_value(&init.agent_capabilities).unwrap_or_default());
                    let session = connection.send_request(NewSessionRequest::new(cwd)).block_task().await;
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
                            let queued = {
                                let mut queue = foreground.steering.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
                                let next = queue.as_mut().and_then(VecDeque::pop_front);
                                if next.is_none() { *queue = None; }
                                next
                            };
                            if let Some(text) = queued {
                                if let Ok(events) = foreground.events.lock() { let _ = events.append("steer_sent", json!({"text": text})); }
                                next = text;
                                continue;
                            }
                            *final_outcome.lock().unwrap_or_else(std::sync::PoisonError::into_inner) = ("review", None);
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
#[tauri::command]
pub fn runner_respond_permission(runner: State<'_, Runner>, session_id: i64, task_id: String, request_id: String, decision: String) -> Result<(), String> { runner.respond(session_id, &task_id, &request_id, &decision) }
/// @adr ADR-0017.D2
#[tauri::command]
pub fn runner_steer(runner: State<'_, Runner>, session_id: i64, task_id: String, text: String) -> Result<(), String> { runner.steer(session_id, &task_id, text) }

#[cfg(test)]
#[path = "runner_test.rs"]
mod tests;
