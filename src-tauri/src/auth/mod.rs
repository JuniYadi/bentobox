// @adr ADR-0004.D1
use crate::agent::CapabilityRegistry;
use serde::Serialize;
use std::ffi::OsStr;
use std::io::Read;
use std::path::Path;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

const TIMEOUT: Duration = Duration::from_secs(2);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AuthState {
    Authenticated,
    Unauthenticated,
    Unknown,
    Unavailable,
}

#[derive(Debug, Serialize)]
pub struct AuthStatus {
    pub state: AuthState,
    pub auth_method: Option<String>,
}

struct ProbeResult {
    code: Option<i32>,
    stdout: Vec<u8>,
    stderr: Vec<u8>,
}

fn read_bounded(mut stream: impl Read) -> std::io::Result<Vec<u8>> {
    let mut output = Vec::new();
    let mut buffer = [0; 8192];
    loop {
        let count = stream.read(&mut buffer)?;
        if count == 0 { return Ok(output); }
        let keep = count.min(65_536usize.saturating_sub(output.len()));
        output.extend_from_slice(&buffer[..keep]);
    }
}

fn run_bounded(command: &mut Command, timeout: Duration) -> Option<ProbeResult> {
    let mut child = command.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().ok()?;
    let stdout = child.stdout.take()?;
    let stderr = child.stderr.take()?;
    let (sender, receiver) = std::sync::mpsc::sync_channel(2);
    let stdout_sender = sender.clone();
    std::thread::spawn(move || { let _ = stdout_sender.send((true, read_bounded(stdout))); });
    std::thread::spawn(move || { let _ = sender.send((false, read_bounded(stderr))); });
    let deadline = Instant::now() + timeout;
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                let mut stdout = None;
                let mut stderr = None;
                for _ in 0..2 {
                    let (is_stdout, output) = receiver.recv_timeout(deadline.saturating_duration_since(Instant::now())).ok()?;
                    if is_stdout { stdout = Some(output.ok()?); } else { stderr = Some(output.ok()?); }
                }
                return Some(ProbeResult { code: status.code(), stdout: stdout?, stderr: stderr? });
            }
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(10)),
            _ => { let _ = child.kill(); let _ = child.wait(); return None; }
        }
    }
}

fn status_with_path(harness_id: &str, path: &OsStr, timeout: Duration) -> AuthStatus {
    let Some(adapter) = CapabilityRegistry::get(harness_id) else {
        return AuthStatus { state: AuthState::Unavailable, auth_method: None };
    };
    let Some(harness) = adapter.detect(path) else {
        return AuthStatus { state: AuthState::Unavailable, auth_method: None };
    };
    if !matches!(harness_id, "claude" | "codex") {
        return AuthStatus { state: AuthState::Unknown, auth_method: None };
    }
    let args: &[&str] = match harness_id {
        "claude" => &["auth", "status", "--json"],
        "codex" => &["login", "status"],
        _ => unreachable!(),
    };
    let Some(result) = run_bounded(&mut Command::new(harness.executable_path).args(args), timeout) else {
        return AuthStatus { state: AuthState::Unknown, auth_method: None };
    };
    let output = String::from_utf8_lossy(&result.stdout);
    let (state, auth_method) = match harness_id {
        "claude" if matches!(result.code, Some(0 | 1)) => {
            let parsed: serde_json::Value = match serde_json::from_str(&output) {
                Ok(value) => value,
                Err(_) => return AuthStatus { state: AuthState::Unknown, auth_method: None },
            };
            match parsed.get("loggedIn").and_then(serde_json::Value::as_bool) {
                Some(true) => {
                    let method = parsed.get("authMethod").and_then(serde_json::Value::as_str)
                        .filter(|method| matches!(*method, "none" | "claude.ai" | "oauth_token" | "api_key" | "api_key_helper" | "third_party"))
                        .map(str::to_owned);
                    (AuthState::Authenticated, method)
                }
                Some(false) => (AuthState::Unauthenticated, None),
                None => return AuthStatus { state: AuthState::Unknown, auth_method: None },
            }
        }
        "codex" => {
            let stderr = String::from_utf8_lossy(&result.stderr);
            let lines = output.lines().chain(stderr.lines());
            if result.code == Some(0) {
                let method = lines.map(|line| line.trim_start().to_ascii_lowercase()).find_map(|line| {
                    if line.starts_with("api key") { Some("API key".to_owned()) }
                    else if line.starts_with("chatgpt") { Some("ChatGPT".to_owned()) }
                    else { None }
                });
                (AuthState::Authenticated, method)
            } else if lines.map(str::to_ascii_lowercase).any(|line| line.contains("not logged in") || line.contains("not authenticated")) {
                (AuthState::Unauthenticated, None)
            } else { (AuthState::Unknown, None) }
        }
        _ => (AuthState::Unknown, None),
    };
    AuthStatus { state, auth_method }
}

#[tauri::command]
pub async fn auth_status(harness_id: String) -> AuthStatus {
    tauri::async_runtime::spawn_blocking(move || {
        let path = std::env::var_os("PATH").unwrap_or_default();
        status_with_path(&harness_id, &path, TIMEOUT)
    }).await.unwrap_or(AuthStatus { state: AuthState::Unknown, auth_method: None })
}

#[cfg(any(target_os = "linux", test))]
fn launch_terminal(command: &mut Command) -> Result<(), String> {
    let error = || "Could not open the native authentication flow".to_string();
    let mut child = command.stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).spawn().map_err(|_| error())?;
    let deadline = Instant::now() + Duration::from_millis(200);
    loop {
        match child.try_wait() {
            Ok(Some(status)) => return if status.success() { Ok(()) } else { Err(error()) },
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(10)),
            result => {
                std::thread::spawn(move || { let _ = child.wait(); });
                return if result.is_ok() { Ok(()) } else { Err(error()) };
            }
        }
    }
}

fn open_terminal(executable: &Path, args: &[&str]) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    let mut command = {
        let mut command = Command::new("osascript");
        command.args(["-e", "on run argv\nset cmd to quoted form of item 1 of argv\nrepeat with arg in rest of argv\nset cmd to cmd & \" \" & quoted form of (contents of arg)\nend repeat\ntell application \"Terminal\"\nactivate\ndo script cmd\nend tell\nend run", "--"]);
        command.arg(executable).args(args);
        command
    };
    #[cfg(target_os = "linux")]
    let mut command = { let mut command = Command::new("x-terminal-emulator"); command.arg("-e").arg(executable).args(args); command };
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    { let _ = (executable, args); return Err("Opening a terminal is not supported on this platform".into()); }
    #[cfg(target_os = "linux")]
    { launch_terminal(&mut command) }
    #[cfg(target_os = "macos")]
    match run_bounded(&mut command, TIMEOUT) {
        Some(ProbeResult { code: Some(0), .. }) => Ok(()),
        _ => Err("Could not open the native authentication flow".into()),
    }
}

fn start_flow(harness_id: &str, logout: bool, path: &OsStr) -> Result<(), String> {
    let adapter = CapabilityRegistry::get(harness_id).ok_or("Unknown harness")?;
    let args: &[&str] = match (harness_id, logout) {
        ("claude", false) => &["auth", "login"],
        ("claude", true) => &["auth", "logout"],
        ("codex", false) => &["login"],
        ("codex", true) => return Err("Native logout is not available for this harness".into()),
        _ => return Err("Native authentication flow is not available for this harness".into()),
    };
    let harness = adapter.detect(path).ok_or("Harness executable is unavailable")?;
    open_terminal(&harness.executable_path, args)
}

#[tauri::command]
pub async fn auth_login(harness_id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = std::env::var_os("PATH").unwrap_or_default();
        start_flow(&harness_id, false, &path)
    }).await.map_err(|_| "Could not start the native authentication flow".to_string())?
}

#[tauri::command]
pub async fn auth_logout(harness_id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = std::env::var_os("PATH").unwrap_or_default();
        start_flow(&harness_id, true, &path)
    }).await.map_err(|_| "Could not start the native authentication flow".to_string())?
}

#[cfg(test)]
#[path = "auth_test.rs"]
mod tests;
