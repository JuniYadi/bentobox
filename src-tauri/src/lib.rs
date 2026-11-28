use tauri::Manager;
pub mod agent;
pub mod db;
pub mod github;
pub mod auth;
pub mod workspace;
pub mod usage;
pub mod handoff;
pub mod session;

pub mod project;
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            let store =
                db::Store::open(data_dir.join("bentobox.sqlite")).map_err(std::io::Error::other)?;
            app.manage(store);
            Ok(())
        })
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            agent::list_detected_harnesses,
            auth::auth_status,
            auth::auth_login,
            auth::auth_logout,
            workspace::create_worktree,
            workspace::list_worktrees,
            workspace::remove_worktree,
            handoff::render_handoff,
            github::gh_check_status,
            github::gh_list_issues,
            github::gh_list_prs,
            project::project_add,
            project::project_list,
            project::project_remove,
            project::project_sessions,
            project::project_unassigned_sessions,
            project::project_tree,
            session::session_propose_plan,
            session::session_revise_plan,
            session::session_approve_plan,
            session::session_reject_plan,
            session::session_task_transition,
            session::session_get_plan,
            session::session_cancel_plan,
            session::session_accept_plan,
            session::session_create,
            session::session_list,
            session::session_set_worktree,
            db::db_append_event,
            db::db_events,
            db::db_set_capability,
            usage::record_session_usage,
            usage::get_session_usage,
            usage::get_account_quota,
            db::db_capability
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
