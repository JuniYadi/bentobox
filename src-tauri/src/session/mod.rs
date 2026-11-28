// @adr ADR-0010.D1
// @adr ADR-0021.D2
// @adr ADR-0011.D1
mod store;
use crate::db::Store;
use serde::{Deserialize, Serialize};
use tauri::State;

/// @adr ADR-0010.D1
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct PlanTask {
    pub id: String,
    pub title: String,
    pub team: String,
    pub harness: String,
    #[serde(default)]
    pub model: Option<String>,
    pub worktree: bool,
    #[serde(default)]
    pub files: Vec<String>,
    pub dependencies: Vec<String>,
    pub estimated_tokens: Option<u64>,
    #[serde(default)]
    pub pinned: bool,
    pub status: String,
}

/// @adr ADR-0010.D1
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct Plan {
    pub session_id: i64,
    pub revision: u64,
    pub phase: String,
    pub approved: bool,
    #[serde(default)]
    pub estimated_tokens: Option<u64>,
    #[serde(default)]
    pub tasks_started: bool,
    pub tasks: Vec<PlanTask>,
}

/// @adr ADR-0010.D1
/// @adr ADR-0020.D2
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SessionSummary {
    pub id: i64,
    pub title: String,
    pub workspace_path: String,
    pub opt_in_worktree: bool,
    pub concise_replies: bool,
    pub model: Option<String>,
    pub team: Option<String>,
    pub created_at: String,
}

/// @adr ADR-0010.D1
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Tool { ReadFile, ListFiles, SearchFiles, ReadGitStatus, WriteFile, EditFile, MutatingShell, GitCommit }

impl Tool {
    pub fn mutates(self) -> bool {
        matches!(self, Self::WriteFile | Self::EditFile | Self::MutatingShell | Self::GitCommit)
    }
}

/// @adr ADR-0010.D1
pub enum Actor<'a> { Orchestrator, SubAgent { plan: &'a Plan, task_id: &'a str } }

/// @adr ADR-0010.D1
#[derive(Debug, PartialEq, Eq)]
pub enum PolicyError { Denied }

/// @adr ADR-0010.D1
pub struct ToolPolicy;

impl ToolPolicy {
    pub fn authorize(actor: Actor<'_>, tool: Tool) -> Result<(), PolicyError> {
        match actor {
            Actor::Orchestrator if !tool.mutates() => Ok(()),
            Actor::SubAgent { plan, task_id } if plan.approved && plan.phase == "Build" && plan.tasks.iter().any(|task| task.id == task_id && task.status == "running") => Ok(()),
            _ => Err(PolicyError::Denied),
        }
    }
}

fn parse_plan(raw: Option<String>) -> Result<Plan, String> {
    serde_json::from_str(&raw.ok_or_else(|| "plan does not exist".to_string())?).map_err(|e| e.to_string())
}

fn mutate_plan(store: &Store, session_id: i64, mutate: impl FnOnce(&mut Plan) -> Result<(), String>) -> Result<Plan, String> {
    store.mutate_plan(session_id, |raw| {
        let mut plan = parse_plan(raw)?;
        mutate(&mut plan)?;
        Ok((serde_json::to_string(&plan).map_err(|e| e.to_string())?, plan))
    })
}

/// @adr ADR-0010.D1
pub fn propose(store: &Store, session_id: i64, tasks: Vec<PlanTask>) -> Result<Plan, String> {
    if tasks.is_empty() { return Err("plan must contain at least one task".into()); }
    if tasks.iter().any(|task| task.id.is_empty() || task.title.is_empty() || task.harness.is_empty()) {
        return Err("task id, title, and harness are required".into());
    }
    let ids: std::collections::HashSet<_> = tasks.iter().map(|task| task.id.as_str()).collect();
    if ids.len() != tasks.len() || tasks.iter().any(|task| task.dependencies.iter().any(|dependency| !ids.contains(dependency.as_str()) || dependency == &task.id)) {
        return Err("task ids or dependencies are invalid".into());
    }
    let mut graph = std::collections::HashMap::<&str, Vec<&str>>::new();
    for task in &tasks { graph.insert(&task.id, task.dependencies.iter().map(String::as_str).collect()); }
    fn visit<'a>(node: &'a str, graph: &std::collections::HashMap<&'a str, Vec<&'a str>>, visiting: &mut std::collections::HashSet<&'a str>, done: &mut std::collections::HashSet<&'a str>) -> bool {
        if done.contains(node) { return true; }
        if !visiting.insert(node) { return false; }
        if graph.get(node).is_some_and(|edges| edges.iter().any(|edge| !visit(edge, graph, visiting, done))) { return false; }
        visiting.remove(node); done.insert(node); true
    }
    let mut done = std::collections::HashSet::new();
    for task in &tasks { if !visit(&task.id, &graph, &mut std::collections::HashSet::new(), &mut done) { return Err("dependencies contain a cycle".into()); } }
    store.mutate_plan(session_id, |raw| {
        let previous = raw.map(|raw| serde_json::from_str::<Plan>(&raw).map_err(|e| e.to_string())).transpose()?;
        if previous.as_ref().is_some_and(|plan| (plan.tasks_started || plan.tasks.iter().any(|task| task.status != "queued")) && plan.phase != "Cancelled") {
            return Err("cannot revise a plan after a task has started; cancel the plan first".into());
        }
        let revision = previous.map(|plan| plan.revision.checked_add(1).ok_or_else(|| "plan revision overflow".to_string())).transpose()?.unwrap_or(1);
        let estimated_tokens = tasks.iter().try_fold(0u64, |sum, task| sum.checked_add(task.estimated_tokens?)).filter(|total| *total > 0);
        let plan = Plan { session_id, revision, phase: "Plan".into(), approved: false, estimated_tokens, tasks_started: false, tasks: tasks.into_iter().map(|mut task| { task.status = "queued".into(); task }).collect() };
        Ok((serde_json::to_string(&plan).map_err(|e| e.to_string())?, plan))
    })
}

/// @adr ADR-0010.D1
pub fn approve(store: &Store, session_id: i64, expected_revision: u64) -> Result<Plan, String> {
    mutate_plan(store, session_id, |plan| {
        if plan.revision != expected_revision { return Err("plan revision mismatch".into()); }
        if plan.approved || plan.phase != "Plan" { return Err("plan cannot be approved in its current phase".into()); }
        plan.approved = true;
        plan.phase = "Approve".into();
        Ok(())
    })
}

/// @adr ADR-0010.D1
pub fn reject(store: &Store, session_id: i64) -> Result<Plan, String> {
    mutate_plan(store, session_id, |plan| {
        if plan.approved || plan.phase != "Plan" { return Err("plan cannot be rejected in its current phase".into()); }
        plan.phase = "Rejected".into();
        Ok(())
    })
}

/// @adr ADR-0010.D1
pub fn transition(store: &Store, session_id: i64, task_id: &str, next: &str) -> Result<Plan, String> {
    transition_checked(store, session_id, task_id, next, None)
}

/// @adr ADR-0010.D1
pub(crate) fn transition_at_revision(store: &Store, session_id: i64, task_id: &str, next: &str, expected_revision: u64) -> Result<Plan, String> {
    transition_checked(store, session_id, task_id, next, Some(expected_revision))
}

fn transition_checked(store: &Store, session_id: i64, task_id: &str, next: &str, expected_revision: Option<u64>) -> Result<Plan, String> {
    mutate_plan(store, session_id, |plan| {
        if expected_revision.is_some_and(|revision| plan.revision != revision) { return Err("plan revision mismatch".into()); }
        let index = plan.tasks.iter().position(|task| task.id == task_id).ok_or_else(|| "unknown task".to_string())?;
        let current = plan.tasks[index].status.as_str();
        // @adr ADR-0018.D2
        let valid = matches!((current, next), ("queued", "running") | ("running", "review") | ("review", "running") | ("review", "completed") | ("running", "failed") | ("review", "failed") | ("failed", "queued") | ("queued", "cancelled") | ("running", "cancelled") | ("review", "cancelled"));
        if !valid || !plan.approved || !matches!(plan.phase.as_str(), "Approve" | "Build" | "Review") { return Err("invalid task transition".into()); }
        if next == "running" {
            if !matches!(plan.phase.as_str(), "Approve" | "Build") && !(current == "review" && plan.phase == "Review") { return Err("plan approval required before a task can run".into()); }
            if plan.tasks[index].dependencies.iter().any(|dependency| !plan.tasks.iter().any(|task| task.id == *dependency && task.status == "completed")) { return Err("task dependencies are not complete".into()); }
            plan.phase = "Build".into();
        }
        if current == "failed" && next == "queued" { plan.phase = "Build".into(); }
        if current == "queued" && next != "queued" { plan.tasks_started = true; }
        plan.tasks[index].status = next.into();
        if plan.tasks.iter().all(|task| matches!(task.status.as_str(), "completed" | "failed" | "cancelled")) { plan.phase = "Review".into(); }
        Ok(())
    })
}

/// @adr ADR-0010.D1
pub fn cancel(store: &Store, session_id: i64) -> Result<Plan, String> {
    mutate_plan(store, session_id, |plan| {
        if !plan.approved || !matches!(plan.phase.as_str(), "Approve" | "Build" | "Review") { return Err("plan cannot be cancelled in its current phase".into()); }
        for task in &mut plan.tasks {
            if !matches!(task.status.as_str(), "completed" | "failed" | "cancelled") { task.status = "cancelled".into(); }
        }
        plan.approved = false;
        plan.phase = "Cancelled".into();
        Ok(())
    })
}

/// @adr ADR-0010.D1
pub fn accept(store: &Store, session_id: i64) -> Result<Plan, String> {
    mutate_plan(store, session_id, |plan| {
        if plan.phase != "Review" { return Err("only a plan in Review can be accepted".into()); }
        plan.phase = "Closed".into();
        Ok(())
    })
}

/// @adr ADR-0010.D1
#[tauri::command]
pub async fn session_propose_plan(store: State<'_, Store>, session_id: i64, tasks: Vec<PlanTask>) -> Result<Plan, String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || propose(&store, session_id, tasks)).await.map_err(|e| e.to_string())?
}
/// @adr ADR-0010.D1
#[tauri::command]
pub async fn session_revise_plan(store: State<'_, Store>, session_id: i64, tasks: Vec<PlanTask>) -> Result<Plan, String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || propose(&store, session_id, tasks)).await.map_err(|e| e.to_string())?
}
/// @adr ADR-0010.D1
#[tauri::command]
pub async fn session_approve_plan(store: State<'_, Store>, session_id: i64, expected_revision: u64) -> Result<Plan, String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || approve(&store, session_id, expected_revision)).await.map_err(|e| e.to_string())?
}
/// @adr ADR-0010.D1
#[tauri::command]
pub async fn session_reject_plan(store: State<'_, Store>, session_id: i64) -> Result<Plan, String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || reject(&store, session_id)).await.map_err(|e| e.to_string())?
}
/// @adr ADR-0010.D1
pub async fn session_task_transition_with(store: Store, runner: &crate::runner::Runner, session_id: i64, task_id: String, next: String) -> Result<Plan, String> {
    let completed = next == "completed";
    let plan = tauri::async_runtime::spawn_blocking(move || transition(&store, session_id, &task_id, &next)).await.map_err(|e| e.to_string())??;
    if completed {
        if let Err(error) = runner.start(session_id) {
            eprintln!("Failed to auto-start session {session_id} after completion: {error}");
        }
    }
    Ok(plan)
}

/// @adr ADR-0010.D1
#[tauri::command]
pub async fn session_task_transition(store: State<'_, Store>, runner: State<'_, crate::runner::Runner>, session_id: i64, task_id: String, next: String) -> Result<Plan, String> {
    session_task_transition_with(store.inner().clone(), runner.inner(), session_id, task_id, next).await
}

/// @adr ADR-0010.D1
#[tauri::command]
pub async fn session_get_plan(store: State<'_, Store>, session_id: i64) -> Result<Option<Plan>, String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || store.load_plan(session_id)?.map(|raw| serde_json::from_str(&raw).map_err(|e| e.to_string())).transpose()).await.map_err(|e| e.to_string())?
}

/// @adr ADR-0010.D1
#[tauri::command]
pub async fn session_cancel_plan(runner: State<'_, crate::runner::Runner>, session_id: i64) -> Result<Plan, String> {
    let runner = runner.inner().clone();
    tauri::async_runtime::spawn_blocking(move || runner.cancel_session(session_id)).await.map_err(|e| e.to_string())?
}

/// @adr ADR-0010.D1
#[tauri::command]
pub async fn session_accept_plan(store: State<'_, Store>, session_id: i64) -> Result<Plan, String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || accept(&store, session_id)).await.map_err(|e| e.to_string())?
}

/// @adr ADR-0010.D1
/// @adr ADR-0019.D2
#[tauri::command]
pub async fn session_create(store: State<'_, Store>, title: String, project_id: i64, workspace_path: Option<String>, opt_in_worktree: bool) -> Result<SessionSummary, String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let root = store.project_root(project_id)?;
        if opt_in_worktree && !crate::project::is_git_repo(std::path::Path::new(&root)) { return Err("Not a git repository: worktree isolation is unavailable".into()); }
        let workspace_path = workspace_path.unwrap_or(root);
        store.create_named_session(&title, project_id, &workspace_path, opt_in_worktree)
    }).await.map_err(|e| e.to_string())?
}


/// @adr ADR-0010.D1
#[tauri::command]
pub async fn session_list(store: State<'_, Store>) -> Result<Vec<SessionSummary>, String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || store.list_sessions()).await.map_err(|e| e.to_string())?
}

/// @adr ADR-0010.D1
/// @adr ADR-0019.D2
#[tauri::command]
pub async fn session_set_worktree(store: State<'_, Store>, id: i64, enabled: bool) -> Result<SessionSummary, String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        if enabled {
            let root: String = store.connection()?.query_row("SELECT projects.root_path FROM sessions JOIN projects ON projects.id = sessions.project_id WHERE sessions.id = ?1", [id], |row| row.get(0)).map_err(|e| e.to_string())?;
            if !crate::project::is_git_repo(std::path::Path::new(&root)) { return Err("Not a git repository: worktree isolation is unavailable".into()); }
        }
        store.set_session_worktree(id, enabled)
    }).await.map_err(|e| e.to_string())?
}

/// @adr ADR-0020.D2
#[tauri::command]
pub async fn session_set_concise(store: State<'_, Store>, session_id: i64, enabled: bool) -> Result<(), String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || store.set_session_concise(session_id, enabled)).await.map_err(|e| e.to_string())?
}

/// @adr ADR-0021.D2
#[tauri::command]
pub async fn session_set_model(store: State<'_, Store>, session_id: i64, model_id: Option<String>) -> Result<(), String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || store.set_session_model(session_id, model_id.as_deref())).await.map_err(|e| e.to_string())?
}

/// @adr ADR-0011.D1
#[tauri::command]
pub async fn session_set_team(store: State<'_, Store>, session_id: i64, team_id: Option<String>) -> Result<(), String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || store.set_session_team(session_id, team_id.as_deref())).await.map_err(|e| e.to_string())?
}

#[cfg(test)]
#[path = "session_test.rs"]
mod tests;
