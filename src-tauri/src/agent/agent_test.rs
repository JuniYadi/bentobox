
use super::*;
use std::sync::atomic::{AtomicU64, Ordering};

static NEXT_DIR: AtomicU64 = AtomicU64::new(0);

struct TestDir(PathBuf);
impl TestDir {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!(
            "bentobox-agent-{}-{}",
            std::process::id(),
            NEXT_DIR.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir(&path).unwrap();
        Self(path)
    }
}
impl Drop for TestDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

#[test]
fn registry_lookup_is_exact() {
    // [ADR-0001.D1]
    let codex = CapabilityRegistry::get("codex").unwrap().capabilities();
    assert_eq!(codex.harness_id, "codex");
    assert_eq!(codex.transport, TransportKind::Acp);
    assert_eq!(
        CapabilityRegistry::get("opencode")
            .unwrap()
            .capabilities()
            .transport,
        TransportKind::Acp
    );
    assert!(CapabilityRegistry::get("Codex").is_none());
    assert!(CapabilityRegistry::get("unknown").is_none());
}

#[test]
fn capability_descriptor_parses_and_preserves_unknowns() {
    // [ADR-0001.D1]
    let json = r#"{"harness_id":"codex","display_name":"Codex","executable":"codex","transport":"native_process","transport_args":[],"binary_version":"1.0","models":["gpt-6.1"],"effort_levels":["low","medium","high"],"features":{"session_lifecycle":true,"events":null,"tool_permissions":false,"cancellation":null,"resume_history":null,"usage_context":null},"known_limitations":[]}"#;
    let descriptor: CapabilityDescriptor = serde_json::from_str(json).unwrap();
    assert_eq!(
        descriptor.models.as_deref(),
        Some(&["gpt-6.1".to_string()][..])
    );
    assert_eq!(
        descriptor.effort_levels.as_ref().unwrap(),
        &["low", "medium", "high"]
    );
    assert_eq!(descriptor.features.events, None);
    assert_eq!(descriptor.features.tool_permissions, Some(false));
    assert!(
        serde_json::from_str::<CapabilityDescriptor>(&json.replace("native_process", "invented"))
            .is_err()
    );
}

#[cfg(unix)]
#[test]
fn detection_uses_injected_path_and_executable_permissions() {
    // [ADR-0001.D1]
    use std::os::unix::fs::PermissionsExt;
    let first = TestDir::new();
    let second = TestDir::new();
    let non_executable = first.0.join("codex");
    std::fs::write(&non_executable, "not executable").unwrap();
    std::fs::set_permissions(&non_executable, std::fs::Permissions::from_mode(0o644)).unwrap();
    let executable = second.0.join("codex");
    std::fs::write(&executable, "fake executable").unwrap();
    std::fs::set_permissions(&executable, std::fs::Permissions::from_mode(0o755)).unwrap();
    std::fs::create_dir(first.0.join("claude")).unwrap();
    let path = std::env::join_paths([&first.0, &second.0, &second.0]).unwrap();
    let found = CapabilityRegistry::detect(&path);
    assert_eq!(found.len(), 1);
    assert_eq!(found[0].capabilities.harness_id, "codex");
    assert_eq!(found[0].executable_path, executable);
    assert!(!found[0].runnable);
    assert!(found[0].launch_note.is_some());
    assert!(CapabilityRegistry::detect(first.0.as_os_str()).is_empty());
}

#[cfg(unix)]
#[test]
fn launch_specs_require_installed_executables_and_adapter_runtime() {
    // [ADR-0001.D1] Launch specifications reflect available executables.
    use std::os::unix::fs::PermissionsExt;
    let dir = TestDir::new();
    for name in ["omp", "opencode", "claude", "codex", "pi"] {
        let file = dir.0.join(name);
        std::fs::write(&file, "#!/bin/sh\nexit 0\n").unwrap();
        std::fs::set_permissions(file, std::fs::Permissions::from_mode(0o755)).unwrap();
    }
    let path = dir.0.as_os_str();
    assert_eq!(launch_spec("omp", path).unwrap().args, ["acp"]);
    assert_eq!(launch_spec("opencode", path).unwrap().args, ["acp"]);
    assert!(launch_spec("pi", path).is_none());
    assert!(launch_spec("codex", path).is_none());
    let npx = dir.0.join("npx");
    std::fs::write(&npx, "#!/bin/sh\nexit 0\n").unwrap();
    std::fs::set_permissions(&npx, std::fs::Permissions::from_mode(0o755)).unwrap();
    for (id, package) in [("claude", "@agentclientprotocol/claude-agent-acp"), ("codex", "@agentclientprotocol/codex-acp")] {
        let spec = launch_spec(id, path).unwrap();
        assert_eq!(spec.program, npx);
        assert_eq!(spec.args, ["-y", package]);
    }
}
#[cfg(unix)]
#[test]
fn detection_reads_version_and_ignores_failed_probe() {
    // [ADR-0001.D1]
    use std::os::unix::fs::PermissionsExt;
    let dir = TestDir::new();
    for (name, script) in [
        ("codex", "#!/bin/sh\nprintf '  codex 1.2.3  \\n'\n"),
        ("claude", "#!/bin/sh\necho misleading\nexit 1\n"),
    ] {
        let file = dir.0.join(name);
        std::fs::write(&file, script).unwrap();
        std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o755)).unwrap();
    }
    let found = CapabilityRegistry::detect(dir.0.as_os_str());
    let version = |id: &str| {
        found
            .iter()
            .find(|entry| entry.capabilities.harness_id == id)
            .unwrap()
            .capabilities
            .binary_version
            .as_deref()
    };
    assert_eq!(version("codex"), Some("codex 1.2.3"));
    assert_eq!(version("claude"), None);
}

#[test]
fn executable_candidates_respect_platform_and_pathext() {
    // [ADR-0001.D1]
    let extensions = OsStr::new(".COM;.EXE;;.CMD");
    assert_eq!(
        executable_names("codex", false, extensions),
        [OsString::from("codex")]
    );
    assert_eq!(
        executable_names("codex", true, extensions),
        ["codex.COM", "codex.EXE", "codex.CMD"].map(OsString::from)
    );
    assert_eq!(
        executable_names("codex.cmd", true, extensions),
        [OsString::from("codex.cmd")]
    );
    assert_eq!(
        executable_names("codex.sh", true, extensions),
        ["codex.sh.COM", "codex.sh.EXE", "codex.sh.CMD"].map(OsString::from)
    );
    assert!(executable_names("codex", true, OsStr::new(";;")).is_empty());
    assert_eq!(
        executable_names("é", true, OsStr::new(".EXE")),
        [OsString::from("é.EXE")]
    );
}

#[cfg(unix)]
#[test]
fn detection_deadline_survives_inherited_stdout() {
    // [ADR-0001.D1]
    use std::os::unix::fs::PermissionsExt;
    let dir = TestDir::new();
    let executable = dir.0.join("codex");
    let pid_file = dir.0.join("child.pid");
    std::fs::write(
        &executable,
        format!(
            "#!/bin/sh\nsleep 30 &\necho $! > '{}'\nprintf 'codex 1.0\\n'\n",
            pid_file.display()
        ),
    )
    .unwrap();
    std::fs::set_permissions(&executable, std::fs::Permissions::from_mode(0o755)).unwrap();
    let start = Instant::now();
    let found = CapabilityRegistry::detect(dir.0.as_os_str());
    let elapsed = start.elapsed();
    let pid = std::fs::read_to_string(pid_file).unwrap();
    let _ = Command::new("kill").arg(pid.trim()).status();
    assert!(
        elapsed < Duration::from_secs(3),
        "detection took {elapsed:?}"
    );
    assert_eq!(found.len(), 1);
    assert_eq!(found[0].capabilities.binary_version, None);
}

#[cfg(unix)]
#[test]
fn detection_probes_adapters_in_parallel_and_preserves_order() {
    // [ADR-0001.D1]
    use std::os::unix::fs::PermissionsExt;
    let dir = TestDir::new();
    for adapter in ADAPTERS {
        let executable = dir.0.join(adapter.executable);
        std::fs::write(&executable, "#!/bin/sh\nsleep 1\necho 1.0\n").unwrap();
        std::fs::set_permissions(&executable, std::fs::Permissions::from_mode(0o755)).unwrap();
    }
    let start = Instant::now();
    let found = CapabilityRegistry::detect(dir.0.as_os_str());
    assert!(
        start.elapsed() < Duration::from_secs(3),
        "adapter probes ran too slowly"
    );
    assert_eq!(
        found
            .iter()
            .map(|entry| entry.capabilities.harness_id.as_str())
            .collect::<Vec<_>>(),
        ADAPTERS
            .iter()
            .map(|adapter| adapter.id)
            .collect::<Vec<_>>()
    );
    assert!(
        found
            .iter()
            .all(|entry| entry.capabilities.binary_version.as_deref() == Some("1.0"))
    );
}

// [ADR-0021.D1] Probe parsing handles both Ungrouped and Grouped advertised options.
#[test]
fn adr0021_parse_model_catalog_handles_ungrouped_and_grouped() {
    use agent_client_protocol::v1::schema::{
        SessionConfigId, SessionConfigOption, SessionConfigOptionCategory, SessionConfigSelect,
        SessionConfigSelectGroup, SessionConfigSelectOption, SessionConfigSelectOptions,
        SessionConfigValueId,
    };

    let ungrouped = vec![SessionConfigOption::new(
        SessionConfigId::new("model"),
        "Model",
        SessionConfigKind::Select(SessionConfigSelect::new(
            SessionConfigValueId::new("sonnet"),
            SessionConfigSelectOptions::Ungrouped(vec![
                SessionConfigSelectOption::new(SessionConfigValueId::new("haiku"), "Claude Haiku"),
                SessionConfigSelectOption::new(SessionConfigValueId::new("sonnet"), "Claude Sonnet"),
            ]),
        )),
    ).category(Some(SessionConfigOptionCategory::Model))];

    let (models, current) = parse_model_catalog(Some(&ungrouped)).expect("parsed ungrouped");
    assert_eq!(current, Some("sonnet".into()));
    assert_eq!(models.len(), 2);
    assert_eq!(models[0].id, "haiku");
    assert_eq!(models[1].name, "Claude Sonnet");

    let grouped = vec![SessionConfigOption::new(
        SessionConfigId::new("model"),
        "Model",
        SessionConfigKind::Select(SessionConfigSelect::new(
            SessionConfigValueId::new("gpt-4o"),
            SessionConfigSelectOptions::Grouped(vec![
                SessionConfigSelectGroup::new(
                    "anthropic",
                    "Anthropic",
                    vec![SessionConfigSelectOption::new(SessionConfigValueId::new("claude-3-5"), "Claude 3.5")],
                ),
                SessionConfigSelectGroup::new(
                    "openai",
                    "OpenAI",
                    vec![SessionConfigSelectOption::new(SessionConfigValueId::new("gpt-4o"), "GPT-4o")],
                ),
            ]),
        )),
    ).category(Some(SessionConfigOptionCategory::Model))];

    let (models, current) = parse_model_catalog(Some(&grouped)).expect("parsed grouped");
    assert_eq!(current, Some("gpt-4o".into()));
    assert_eq!(models.len(), 2);
    assert_eq!(models[0].id, "claude-3-5");
    assert_eq!(models[1].id, "gpt-4o");

    let no_model = vec![SessionConfigOption::new(
        SessionConfigId::new("other"),
        "Other",
        SessionConfigKind::Select(SessionConfigSelect::new(
            SessionConfigValueId::new("val"),
            SessionConfigSelectOptions::Ungrouped(vec![]),
        )),
    )];
    assert_eq!(parse_model_catalog(Some(&no_model)), None);
}

// [ADR-0021.D1] Cached model catalog roundtrips and only ready/unadvertised catalogs are stored.
#[test]
fn adr0021_model_catalog_cache_storage_and_refresh() {
    let store = Store::open(":memory:").unwrap();
    let catalog = ModelCatalog {
        models: vec![ModelOption { id: "m1".into(), name: "Model 1".into() }],
        current_model: Some("m1".into()),
        status: "ready".into(),
        note: None,
    };

    write_cached_model_catalog(&store, "claude", Some("1.2.3"), &catalog);
    let cached = read_cached_model_catalog(&store, "claude", Some("1.2.3")).expect("cached catalog found");
    assert_eq!(cached, catalog);

    // An error status must never be cached.
    let err_catalog = ModelCatalog {
        models: vec![],
        current_model: None,
        status: "auth_required".into(),
        note: Some("needs login".into()),
    };
    write_cached_model_catalog(&store, "codex", Some("1.0.0"), &err_catalog);
    assert!(read_cached_model_catalog(&store, "codex", Some("1.0.0")).is_none());
}

// [ADR-0021.D1] Unavailable status for unknown harness or non-ACP harness.
#[tokio::test]
async fn adr0021_unavailable_for_unknown_or_non_acp_harness() {
    let store = Store::open(":memory:").unwrap();
    let res = list_models_with(store.clone(), "unknown-harness".into(), false, Duration::from_secs(1), Some(OsString::new())).await.unwrap();
    assert_eq!(res.status, "unavailable");
}

// [ADR-0021.D1] Direct probe tests for ready (ungrouped and grouped), unadvertised, auth_required, timeout, single-flight, refresh bypass, and cleanup.
#[tokio::test]
async fn adr0021_probe_harness_scenarios_and_lifecycle() {
    use std::os::unix::fs::PermissionsExt;
    let test_dir = TestDir::new();

    // Create a fake opencode executable that invokes Python FAKE with an environment variable SCENARIO
    let opencode_path = test_dir.0.join("opencode");
    let py_fake_path = test_dir.0.join("fake_agent.py");
    std::fs::write(&py_fake_path, crate::runner::tests::FAKE).unwrap();

    let scenario_file = test_dir.0.join("scenario.txt");
    let script = format!(
        "#!/bin/sh\nSCEN=$(cat \"{}\")\nexec python3 -u \"{}\" \"$SCEN\"\n",
        scenario_file.display(),
        py_fake_path.display()
    );
    std::fs::write(&opencode_path, script).unwrap();
    std::fs::set_permissions(&opencode_path, std::fs::Permissions::from_mode(0o755)).unwrap();

    let path_os = Some(test_dir.0.as_os_str().to_os_string());

    // Scenario 1: Ready Ungrouped
    std::fs::write(&scenario_file, "probe_ready").unwrap();
    let store = Store::open(":memory:").unwrap();
    let res = list_models_with(store.clone(), "opencode".into(), false, Duration::from_secs(5), path_os.clone()).await.unwrap();
    assert_eq!(res.status, "ready");
    assert_eq!(res.models.len(), 4);
    assert_eq!(res.current_model, Some("default-model".into()));

    // Cache hit should return immediately
    let cached = list_models_with(store.clone(), "opencode".into(), false, Duration::from_secs(5), path_os.clone()).await.unwrap();
    assert_eq!(cached.status, "ready");
    assert_eq!(cached.models.len(), 4);

    // Refresh=true bypasses cache
    std::fs::write(&scenario_file, "probe_unadvertised").unwrap();
    let refreshed = list_models_with(store.clone(), "opencode".into(), true, Duration::from_secs(5), path_os.clone()).await.unwrap();
    assert_eq!(refreshed.status, "unadvertised");
    assert!(refreshed.models.is_empty());

    // Scenario 2: Grouped options
    std::fs::write(&scenario_file, "probe_grouped").unwrap();
    let res_grouped = list_models_with(store.clone(), "opencode".into(), true, Duration::from_secs(5), path_os.clone()).await.unwrap();
    assert_eq!(res_grouped.status, "ready");
    assert_eq!(res_grouped.models.len(), 2);
    assert_eq!(res_grouped.models[0].id, "g1-m1");
    assert_eq!(res_grouped.models[1].id, "g2-m1");

    // Scenario 3: Auth required
    std::fs::write(&scenario_file, "probe_auth").unwrap();
    let res_auth = list_models_with(store.clone(), "opencode".into(), true, Duration::from_secs(5), path_os.clone()).await.unwrap();
    assert_eq!(res_auth.status, "auth_required");

    // Scenario 4: Timeout
    std::fs::write(&scenario_file, "probe_timeout_scenario").unwrap();
    let res_timeout = list_models_with(store.clone(), "opencode".into(), true, Duration::from_millis(200), path_os.clone()).await.unwrap();
    assert_eq!(res_timeout.status, "timeout");
    assert!(read_cached_model_catalog(&store, "opencode", Some("1.0")).is_none());

    // Scenario 5: Single flight - leader abort does not poison follower/future probe
    std::fs::write(&scenario_file, "probe_flight").unwrap();
    let s_clone = store.clone();
    let p_clone = path_os.clone();
    let handle = tokio::spawn(async move {
        let _ = list_models_with(s_clone, "opencode".into(), true, Duration::from_secs(5), p_clone).await;
    });
    handle.abort();
    tokio::time::sleep(Duration::from_millis(50)).await;

    // A new call after leader abort succeeds and runs its own probe
    std::fs::write(&scenario_file, "probe_ready").unwrap();
    let res_after_abort = list_models_with(store.clone(), "opencode".into(), true, Duration::from_secs(5), path_os.clone()).await.unwrap();
    assert_eq!(res_after_abort.status, "ready");
}
