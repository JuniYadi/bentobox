use tauri::Manager;
pub mod agent;
pub mod db;
pub mod github;
pub mod auth;
pub mod workspace;
pub mod handoff;

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
            db::db_create_session,
            db::db_create_task,
            db::db_add_dependency,
            db::db_append_event,
            db::db_events,
            db::db_set_capability,
            db::db_capability
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
