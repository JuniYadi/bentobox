// @adr ADR-0001.D1
use serde::{Deserialize, Serialize};
use std::ffi::{OsStr, OsString};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

/// The actual protocol used by an integration, not a synthetic ACP facade.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TransportKind {
    Acp,
    NativeProcess,
}

/// Unknown capabilities are represented by `None`, not by an assertion of support.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Features {
    pub session_lifecycle: Option<bool>,
    pub events: Option<bool>,
    pub tool_permissions: Option<bool>,
    pub cancellation: Option<bool>,
    pub resume_history: Option<bool>,
    pub usage_context: Option<bool>,
}

impl Features {
    const UNKNOWN: Self = Self {
        session_lifecycle: None,
        events: None,
        tool_permissions: None,
        cancellation: None,
        resume_history: None,
        usage_context: None,
    };
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CapabilityDescriptor {
    pub harness_id: String,
    pub display_name: String,
    pub executable: String,
    pub transport: TransportKind,
    /// Arguments used to start the transport, before any session-specific arguments.
    pub transport_args: Vec<String>,
    /// None means the installed binary's version or capability has not been established.
    pub binary_version: Option<String>,
    pub models: Option<Vec<String>>,
    pub effort_levels: Option<Vec<String>>,
    pub features: Features,
    pub known_limitations: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DetectedHarness {
    pub capabilities: CapabilityDescriptor,
    pub executable_path: PathBuf,
    pub runnable: bool,
    pub launch_note: Option<String>,
}

/// Transport adapters declare their integration without manufacturing protocol events.
pub trait AgentAdapter {
    fn capabilities(&self) -> CapabilityDescriptor;

    fn detect(&self, path: &OsStr) -> Option<DetectedHarness> {
        let mut capabilities = self.capabilities();
        find_executable(&capabilities.executable, path).map(|executable_path| {
            capabilities.binary_version = probe_version(&executable_path);
            let adapter = matches!(capabilities.harness_id.as_str(), "claude" | "codex");
            let runnable = capabilities.transport == TransportKind::Acp
                && (!adapter || find_executable("npx", path).is_some());
            let launch_note = adapter.then(|| "Downloads the adapter with npx on first use".to_string());
            DetectedHarness {
                capabilities,
                executable_path,
                runnable,
                launch_note,
            }
        })
    }
}

struct DeclaredAdapter {
    id: &'static str,
    name: &'static str,
    executable: &'static str,
    transport: TransportKind,
    transport_args: &'static [&'static str],
}

impl AgentAdapter for DeclaredAdapter {
    fn capabilities(&self) -> CapabilityDescriptor {
        CapabilityDescriptor {
            harness_id: self.id.into(),
            display_name: self.name.into(),
            executable: self.executable.into(),
            transport: self.transport,
            transport_args: self
                .transport_args
                .iter()
                .map(|arg| (*arg).into())
                .collect(),
            binary_version: None,
            models: None,
            effort_levels: None,
            features: Features::UNKNOWN,
            known_limitations: vec![
                "Models, effort levels and features have not been verified".into(),
            ],
        }
    }
}

static ADAPTERS: &[DeclaredAdapter] = &[
    DeclaredAdapter {
        id: "claude",
        name: "Claude Code",
        executable: "claude",
        transport: TransportKind::Acp,
        transport_args: &["-y", "@agentclientprotocol/claude-agent-acp"],
    },
    DeclaredAdapter {
        id: "codex",
        name: "OpenAI Codex",
        executable: "codex",
        transport: TransportKind::Acp,
        transport_args: &["-y", "@agentclientprotocol/codex-acp"],
    },
    DeclaredAdapter {
        id: "omp",
        name: "Oh My Pi",
        executable: "omp",
        transport: TransportKind::Acp,
        transport_args: &["acp"],
    },
    DeclaredAdapter {
        id: "pi",
        name: "pi",
        executable: "pi",
        transport: TransportKind::NativeProcess,
        transport_args: &[],
    },
    DeclaredAdapter {
        id: "opencode",
        name: "OpenCode",
        executable: "opencode",
        transport: TransportKind::Acp,
        transport_args: &["acp"],
    },
];

pub struct CapabilityRegistry;

impl CapabilityRegistry {
    pub fn get(harness_id: &str) -> Option<&'static dyn AgentAdapter> {
        ADAPTERS
            .iter()
            .find(|adapter| adapter.id == harness_id)
            .map(|adapter| adapter as &dyn AgentAdapter)
    }

    pub fn detect(path: &OsStr) -> Vec<DetectedHarness> {
        std::thread::scope(|scope| {
            let probes: Vec<_> = ADAPTERS
                .iter()
                .map(|adapter| scope.spawn(move || adapter.detect(path)))
                .collect();
            probes
                .into_iter()
                .filter_map(|probe| probe.join().expect("adapter detection thread panicked"))
                .collect()
        })
    }
}

/// @adr ADR-0001.D1
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LaunchSpec {
    pub program: PathBuf,
    pub args: Vec<String>,
}

/// @adr ADR-0001.D1
pub fn launch_spec(harness_id: &str, path: &OsStr) -> Option<LaunchSpec> {
    let adapter = ADAPTERS.iter().find(|adapter| adapter.id == harness_id)?;
    if adapter.transport != TransportKind::Acp { return None; }
    let executable = find_executable(adapter.executable, path)?;
    let program = if matches!(harness_id, "claude" | "codex") {
        find_executable("npx", path)?
    } else {
        executable
    };
    Some(LaunchSpec {
        program,
        args: adapter.transport_args.iter().map(|arg| (*arg).to_owned()).collect(),
    })
}

fn find_executable(name: &str, path: &OsStr) -> Option<PathBuf> {
    let pathext =
        std::env::var_os("PATHEXT").unwrap_or_else(|| OsString::from(".COM;.EXE;.BAT;.CMD"));
    let names = executable_names(name, cfg!(windows), &pathext);
    for directory in std::env::split_paths(path) {
        for candidate in &names {
            let candidate = directory.join(candidate);
            if is_executable(&candidate) {
                return Some(candidate);
            }
        }
    }
    None
}

fn executable_names(name: &str, is_windows: bool, pathext: &OsStr) -> Vec<OsString> {
    if !is_windows {
        return vec![OsString::from(name)];
    }
    let extensions = pathext.to_string_lossy();
    let extensions: Vec<_> = extensions
        .split(';')
        .filter(|ext| !ext.is_empty())
        .collect();
    if extensions.iter().any(|ext| {
        name.get(name.len().saturating_sub(ext.len())..)
            .is_some_and(|suffix| suffix.eq_ignore_ascii_case(ext))
    }) {
        return vec![OsString::from(name)];
    }
    extensions
        .into_iter()
        .map(|ext| OsString::from(format!("{name}{ext}")))
        .collect()
}

fn is_executable(path: &Path) -> bool {
    let Ok(metadata) = path.metadata() else {
        return false;
    };
    if !metadata.is_file() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        metadata.permissions().mode() & 0o111 != 0
    }
    #[cfg(not(unix))]
    {
        true
    }
}

fn probe_version(executable: &Path) -> Option<String> {
    let mut child = Command::new(executable)
        .arg("--version")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let stdout = child.stdout.take()?;
    let (sender, receiver) = std::sync::mpsc::sync_channel(1);
    std::thread::spawn(move || {
        let mut bytes = Vec::new();
        let result = stdout.take(65_536).read_to_end(&mut bytes).map(|_| bytes);
        let _ = sender.send(result);
    });
    let deadline = Instant::now() + Duration::from_secs(2);
    loop {
        match child.try_wait() {
            Ok(Some(status)) if status.success() => {
                let bytes = receiver
                    .recv_timeout(deadline.saturating_duration_since(Instant::now()))
                    .ok()?
                    .ok()?;
                let version = String::from_utf8(bytes).ok()?;
                let version = version.trim();
                return (!version.is_empty()).then(|| version.to_owned());
            }
            Ok(Some(_)) => return None,
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(10)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
        }
    }
}

#[tauri::command]
pub async fn list_detected_harnesses() -> Vec<DetectedHarness> {
    tauri::async_runtime::spawn_blocking(|| {
        std::env::var_os("PATH")
            .map(|path| CapabilityRegistry::detect(&path))
            .unwrap_or_default()
    })
    .await
    .expect("harness detection task panicked")
}

#[cfg(test)]
#[path = "agent_test.rs"]
mod tests;
