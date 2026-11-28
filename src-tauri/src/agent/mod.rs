// @adr ADR-0001.D1
// @adr ADR-0021.D1
use agent_client_protocol::{AcpAgent, AcpAgentConfig, Agent, Client, schema::ProtocolVersion};
use agent_client_protocol::v1::schema::{
    ClientCapabilities, Implementation, InitializeRequest, NewSessionRequest,
    SessionConfigKind, SessionConfigOption, SessionConfigOptionCategory, SessionConfigSelectOptions,
};
use crate::db::Store;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::ffi::{OsStr, OsString};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::State;
use tokio::sync::broadcast;

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
    pub(crate) const UNKNOWN: Self = Self {
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

/// @adr ADR-0021.D1
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ModelOption {
    pub id: String,
    pub name: String,
}

/// @adr ADR-0021.D1
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ModelCatalog {
    pub models: Vec<ModelOption>,
    pub current_model: Option<String>,
    pub status: String,
    pub note: Option<String>,
}

const PROBE_TIMEOUT: Duration = Duration::from_secs(90);

#[derive(Clone)]
enum FlightOutcome {
    Success(ModelCatalog),
    Failed(String),
}

static FLIGHTS: std::sync::LazyLock<Mutex<HashMap<String, broadcast::Sender<FlightOutcome>>>> =
    std::sync::LazyLock::new(|| Mutex::new(HashMap::new()));

struct TempDirGuard(PathBuf);
impl Drop for TempDirGuard {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

/// @adr ADR-0021.D1
pub(crate) fn parse_model_catalog(configs: Option<&[SessionConfigOption]>) -> Option<(Vec<ModelOption>, Option<String>)> {
    let configs = configs?;
    let model_cfg = configs.iter().find(|cfg| cfg.category == Some(SessionConfigOptionCategory::Model))?;
    let SessionConfigKind::Select(select) = &model_cfg.kind else { return None; };
    let mut models = Vec::new();
    match &select.options {
        SessionConfigSelectOptions::Ungrouped(opts) => {
            for opt in opts {
                models.push(ModelOption {
                    id: opt.value.0.to_string(),
                    name: opt.name.clone(),
                });
            }
        }
        SessionConfigSelectOptions::Grouped(groups) => {
            for group in groups {
                for opt in &group.options {
                    models.push(ModelOption {
                        id: opt.value.0.to_string(),
                        name: opt.name.clone(),
                    });
                }
            }
        }
        _ => {}
    }
    let current_model = if select.current_value.0.is_empty() {
        None
    } else {
        Some(select.current_value.0.to_string())
    };
    Some((models, current_model))
}

/// @adr ADR-0021.D1
pub(crate) fn model_cache_key(harness: &str, binary_version: Option<&str>) -> String {
    let version = binary_version.unwrap_or("unknown");
    format!("acp_models:{harness}:{version}")
}

/// @adr ADR-0021.D1
pub(crate) fn read_cached_model_catalog(store: &Store, harness: &str, binary_version: Option<&str>) -> Option<ModelCatalog> {
    let key = model_cache_key(harness, binary_version);
    let val = store.capability(&key).ok().flatten()?;
    serde_json::from_value(val).ok()
}

/// @adr ADR-0021.D1
pub(crate) fn write_cached_model_catalog(store: &Store, harness: &str, binary_version: Option<&str>, catalog: &ModelCatalog) {
    if (catalog.status == "ready" && !catalog.models.is_empty()) || catalog.status == "unadvertised" {
        let key = model_cache_key(harness, binary_version);
        if let Ok(val) = serde_json::to_value(catalog) {
            let _ = store.set_capability(&key, &val);
        }
    }
}

struct FlightGuard {
    harness: String,
}

impl Drop for FlightGuard {
    fn drop(&mut self) {
        let mut flights = FLIGHTS.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        flights.remove(&self.harness);
    }
}

/// @adr ADR-0021.D1
pub async fn list_models_with(
    store: Store,
    harness: String,
    refresh: bool,
    probe_timeout: Duration,
    path_os: Option<OsString>,
) -> Result<ModelCatalog, String> {
    let path_val = path_os.or_else(|| std::env::var_os("PATH")).unwrap_or_default();
    let path_detect = path_val.clone();
    let detected = tauri::async_runtime::spawn_blocking(move || {
        CapabilityRegistry::detect(&path_detect)
    }).await.map_err(|e| e.to_string())?;
    let harness_info = detected.into_iter().find(|d| d.capabilities.harness_id == harness);

    let Some(detected_harness) = harness_info else {
        return Ok(ModelCatalog {
            models: Vec::new(),
            current_model: None,
            status: "unavailable".into(),
            note: Some("harness unknown or not detected".into()),
        });
    };

    if detected_harness.capabilities.transport != TransportKind::Acp || !detected_harness.runnable {
        return Ok(ModelCatalog {
            models: Vec::new(),
            current_model: None,
            status: "unavailable".into(),
            note: Some(detected_harness.launch_note.unwrap_or_else(|| "harness is not runnable via ACP".into())),
        });
    }

    let binary_version = detected_harness.capabilities.binary_version.clone();
    if !refresh {
        if let Some(cached) = read_cached_model_catalog(&store, &harness, binary_version.as_deref()) {
            return Ok(cached);
        }
    }

    let (tx, mut rx, _leader_guard) = {
        let mut flights = FLIGHTS.lock().map_err(|_| "flights lock poisoned")?;
        if let Some(existing) = flights.get(&harness) {
            (existing.clone(), existing.subscribe(), None)
        } else {
            let (sender, receiver) = broadcast::channel(1);
            flights.insert(harness.clone(), sender.clone());
            let guard = FlightGuard { harness: harness.clone() };
            (sender, receiver, Some(guard))
        }
    };

    if _leader_guard.is_none() {
        return match rx.recv().await {
            Ok(FlightOutcome::Success(catalog)) => Ok(catalog),
            Ok(FlightOutcome::Failed(err)) => Err(err),
            Err(_) => Err("concurrent probe disconnected".into()),
        };
    }

    let probe_res = probe_harness_catalog(&harness, &path_val, probe_timeout).await;
    drop(_leader_guard);

    match &probe_res {
        Ok(catalog) => {
            write_cached_model_catalog(&store, &harness, binary_version.as_deref(), catalog);
            let _ = tx.send(FlightOutcome::Success(catalog.clone()));
            Ok(catalog.clone())
        }
        Err(err) => {
            let _ = tx.send(FlightOutcome::Failed(err.clone()));
            Err(err.clone())
        }
    }
}

async fn probe_harness_catalog(harness: &str, path: &OsStr, timeout: Duration) -> Result<ModelCatalog, String> {
    let spec = match launch_spec(harness, path) {
        Some(s) => s,
        None => {
            return Ok(ModelCatalog {
                models: Vec::new(),
                current_model: None,
                status: "unavailable".into(),
                note: Some("launch spec not available".into()),
            });
        }
    };

    let temp_dir = std::env::temp_dir().join(format!("bentobox-probe-{}-{}-{}", harness, std::process::id(), uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&temp_dir).map_err(|e| e.to_string())?;
    let _temp_guard = TempDirGuard(temp_dir.clone());

    let probe_fut = async {
        let agent = AcpAgent::new(AcpAgentConfig::new(spec.program).args(spec.args));
        let outcome_cell = Arc::new(Mutex::new(None));
        let out_ref = outcome_cell.clone();
        let cwd = temp_dir.clone();

        let connection = Client.v1().connect_with(agent, move |conn: agent_client_protocol::v1::ConnectionTo<Agent>| async move {
            let init = match conn.send_request(
                InitializeRequest::new(ProtocolVersion::V1)
                    .client_info(Implementation::new("bentobox-probe", "0.1.0"))
                    .client_capabilities(ClientCapabilities::default().terminal(false)),
            ).block_task().await {
                Ok(res) => res,
                Err(err) => {
                    *out_ref.lock().unwrap() = Some(ModelCatalog {
                        models: Vec::new(),
                        current_model: None,
                        status: "unavailable".into(),
                        note: Some(err.to_string()),
                    });
                    return Ok(());
                }
            };

            let session_res = conn.send_request(NewSessionRequest::new(cwd)).block_task().await;
            match session_res {
                Ok(session) => {
                    if let Some((models, current_model)) = parse_model_catalog(session.config_options.as_deref()) {
                        if models.is_empty() {
                            *out_ref.lock().unwrap() = Some(ModelCatalog {
                                models: Vec::new(),
                                current_model: None,
                                status: "unadvertised".into(),
                                note: None,
                            });
                        } else {
                            *out_ref.lock().unwrap() = Some(ModelCatalog {
                                models,
                                current_model,
                                status: "ready".into(),
                                note: None,
                            });
                        }
                    } else {
                        *out_ref.lock().unwrap() = Some(ModelCatalog {
                            models: Vec::new(),
                            current_model: None,
                            status: "unadvertised".into(),
                            note: None,
                        });
                    }
                }
                Err(err) => {
                    if err.code == agent_client_protocol::ErrorCode::AUTH_REQUIRED && !init.auth_methods.is_empty() {
                        *out_ref.lock().unwrap() = Some(ModelCatalog {
                            models: Vec::new(),
                            current_model: None,
                            status: "auth_required".into(),
                            note: Some(err.message.to_string()),
                        });
                    } else {
                        *out_ref.lock().unwrap() = Some(ModelCatalog {
                            models: Vec::new(),
                            current_model: None,
                            status: "unavailable".into(),
                            note: Some(err.to_string()),
                        });
                    }
                }
            }
            Ok::<(), agent_client_protocol::Error>(())
        });

        let _ = connection.await;
        let res = outcome_cell.lock().unwrap().take().unwrap_or_else(|| ModelCatalog {
            models: Vec::new(),
            current_model: None,
            status: "unavailable".into(),
            note: Some("probe connection closed prematurely".into()),
        });
        Ok::<ModelCatalog, String>(res)
    };

    match tokio::time::timeout(timeout, probe_fut).await {
        Ok(res) => res,
        Err(_) => Ok(ModelCatalog {
            models: Vec::new(),
            current_model: None,
            status: "timeout".into(),
            note: Some("model probe timed out".into()),
        }),
    }
}

/// @adr ADR-0021.D1
#[tauri::command]
pub async fn agent_list_models(
    store: State<'_, Store>,
    harness: String,
    refresh: Option<bool>,
) -> Result<ModelCatalog, String> {
    list_models_with(store.inner().clone(), harness, refresh.unwrap_or(false), PROBE_TIMEOUT, None).await
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
