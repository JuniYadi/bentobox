use super::*;
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
use std::sync::atomic::{AtomicU64, Ordering};

static NEXT: AtomicU64 = AtomicU64::new(0);
#[cfg(unix)]
struct TestDir(std::path::PathBuf);
#[cfg(unix)]
impl TestDir {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!("bentobox-auth-{}-{}", std::process::id(), NEXT.fetch_add(1, Ordering::Relaxed)));
        std::fs::create_dir_all(&path).unwrap();
        Self(path)
    }
    fn executable(&self, name: &str, script: &str) -> std::path::PathBuf {
        let path = self.0.join(name);
        std::fs::write(&path, format!("#!/bin/sh\n{script}\n")).unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o700)).unwrap();
        path
    }
    fn path(&self) -> &std::path::Path { &self.0 }
}
#[cfg(unix)]
impl Drop for TestDir { fn drop(&mut self) { let _ = std::fs::remove_dir_all(&self.0); } }

#[cfg(unix)]
#[test]
fn claude_auth_status_reads_only_boolean_and_method() {
    // [ADR-0004.D1]
    let dir = TestDir::new();
    dir.executable("claude", "printf '%s' '{\"loggedIn\":true,\"authMethod\":\"oauth_token\",\"email\":\"secret@example.test\"}'");
    let result = status_with_path("claude", dir.path().as_os_str(), TIMEOUT);
    assert_eq!(result.state, AuthState::Authenticated);
    assert_eq!(result.auth_method.as_deref(), Some("oauth_token"));
    let serialized = serde_json::to_string(&result).unwrap();
    assert!(!serialized.contains("secret@example.test"));
}

#[cfg(unix)]
#[test]
fn claude_auth_status_reports_unauthenticated() {
    // [ADR-0004.D1]
    let dir = TestDir::new();
    dir.executable("claude", "printf '%s' '{\"loggedIn\":false,\"authMethod\":\"none\"}'; exit 1");
    assert_eq!(status_with_path("claude", dir.path().as_os_str(), TIMEOUT).state, AuthState::Unauthenticated);
}

#[cfg(unix)]
#[test]
fn codex_token_output_is_not_returned() {
    // [ADR-0004.D1]
    let dir = TestDir::new();
    dir.executable("codex", "echo 'API key configured - sk-abc***xyz' >&2");
    let result = status_with_path("codex", dir.path().as_os_str(), TIMEOUT);
    assert_eq!(result.state, AuthState::Authenticated);
    assert_eq!(result.auth_method.as_deref(), Some("API key"));
    let serialized = serde_json::to_string(&result).unwrap();
    for secret_fragment in ["API key configured", "sk-abc", "xyz"] { assert!(!serialized.contains(secret_fragment)); }
}

#[cfg(unix)]
#[test]
fn missing_executable_is_unavailable() {
    // [ADR-0004.D1]
    let dir = TestDir::new();
    assert_eq!(status_with_path("claude", dir.path().as_os_str(), TIMEOUT).state, AuthState::Unavailable);
}

#[cfg(unix)]
#[test]
fn hanging_status_times_out_as_unknown() {
    // [ADR-0004.D1]
    let dir = TestDir::new();
    dir.executable("claude", "sleep 5");
    let result = status_with_path("claude", dir.path().as_os_str(), Duration::from_millis(100));
    assert_eq!(result.state, AuthState::Unknown);
}

#[cfg(unix)]
#[test]
fn codex_nonzero_without_explicit_logged_out_text_is_unknown() {
    // [ADR-0004.D1]
    let dir = TestDir::new();
    dir.executable("codex", "echo 'unexpected error' >&2; exit 2");
    assert_eq!(status_with_path("codex", dir.path().as_os_str(), TIMEOUT).state, AuthState::Unknown);
}

#[cfg(unix)]
#[test]
fn codex_logged_out_on_stderr_is_unauthenticated() {
    // [ADR-0004.D1]
    let dir = TestDir::new();
    dir.executable("codex", "echo 'Not logged in' >&2; exit 1");
    let result = status_with_path("codex", dir.path().as_os_str(), TIMEOUT);
    assert_eq!(result.state, AuthState::Unauthenticated);
    assert_eq!(result.auth_method, None);
}

#[cfg(unix)]
#[test]
fn status_drains_both_streams_beyond_capture_limit() {
    // [ADR-0004.D1]
    let dir = TestDir::new();
    let executable = dir.executable("probe", "/usr/bin/head -c 131072 /dev/zero; /usr/bin/head -c 131072 /dev/zero >&2");
    let result = run_bounded(&mut Command::new(executable), TIMEOUT).unwrap();
    assert_eq!(result.code, Some(0));
    assert_eq!(result.stdout.len(), 65_536);
    assert_eq!(result.stderr.len(), 65_536);
}

#[test]
fn terminal_launcher_detaches_and_reaps() {
    // [ADR-0004.D1]
    const MARKER: &str = "BENTOBOX_AUTH_LAUNCH_TEST";
    if let Some(path) = std::env::var_os(MARKER) {
        let path = std::path::PathBuf::from(path);
        std::thread::sleep(Duration::from_millis(400));
        std::fs::write(&path, b"alive").unwrap();
        let deadline = Instant::now() + Duration::from_secs(5);
        while Instant::now() < deadline && !path.with_extension("stop").exists() {
            std::thread::sleep(Duration::from_millis(20));
        }
        return;
    }
    let marker = std::env::temp_dir().join(format!("bentobox-auth-launch-{}-{}", std::process::id(), NEXT.fetch_add(1, Ordering::Relaxed)));
    let mut command = Command::new(std::env::current_exe().unwrap());
    command.arg("terminal_launcher_detaches_and_reaps").env(MARKER, &marker);
    let start = Instant::now();
    let result = launch_terminal(&mut command);
    let elapsed = start.elapsed();
    let deadline = Instant::now() + Duration::from_secs(2);
    while !marker.exists() && Instant::now() < deadline { std::thread::sleep(Duration::from_millis(10)); }
    let alive = marker.exists();
    std::fs::write(marker.with_extension("stop"), b"stop").unwrap();
    assert!(result.is_ok());
    assert!(elapsed < Duration::from_secs(1), "launcher took {elapsed:?}");
    assert!(alive, "launcher did not survive detachment");
    let _ = std::fs::remove_file(&marker);
    // The child observes the stop file and exits; leave it briefly for the reaper.
    std::thread::sleep(Duration::from_millis(100));
    let _ = std::fs::remove_file(marker.with_extension("stop"));
}

#[test]
fn terminal_launcher_reports_immediate_failure() {
    // [ADR-0004.D1]
    const FAIL: &str = "BENTOBOX_AUTH_LAUNCH_FAIL_TEST";
    if std::env::var_os(FAIL).is_some() { std::process::exit(7); }
    let mut command = Command::new(std::env::current_exe().unwrap());
    command.arg("terminal_launcher_reports_immediate_failure").env(FAIL, "1");
    assert!(launch_terminal(&mut command).is_err());
}
