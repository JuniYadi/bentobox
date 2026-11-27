
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
    assert_eq!(codex.transport, TransportKind::NativeProcess);
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
    assert!(CapabilityRegistry::detect(first.0.as_os_str()).is_empty());
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
