// @adr ADR-0007.D1
#![cfg(test)]
use super::*;
use std::sync::atomic::{AtomicU64, Ordering};

static NEXT_DIR: AtomicU64 = AtomicU64::new(0);

struct TestDir(PathBuf);
impl TestDir {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!("bentobox-handoff-{}-{}", std::process::id(), NEXT_DIR.fetch_add(1, Ordering::Relaxed)));
        std::fs::create_dir(&path).unwrap();
        Self(path)
    }
}
impl Drop for TestDir {
    fn drop(&mut self) { let _ = std::fs::remove_dir_all(&self.0); }
}

fn sample() -> Handoff {
    Handoff {
        goal: "Implement the parser".into(),
        non_goals: vec!["Do not change the public API".into()],
        files: vec![FileReference { path: "src/main.rs".into(), lines: Some(LineRange { start: 1, end: 2 }) }],
        constraints: vec!["Keep changes minimal".into()],
        acceptance_commands: vec!["cargo test parser".into()],
        worktree_path: "work".into(),
    }
}
fn workspace() -> TestDir {
    let dir = TestDir::new();
    std::fs::create_dir(dir.0.join("work")).unwrap();
    std::fs::create_dir(dir.0.join("work/src")).unwrap();
    std::fs::write(dir.0.join("work/src/main.rs"), "first\nsecond\n").unwrap();
    dir
}

#[test]
fn valid_handoff_renders_stable_golden_string() {
    // [ADR-0007.D1]
    let dir = workspace();
    let root = dir.0.canonicalize().unwrap();
    let rendered = sample().render_with_secrets(&root, &[]).unwrap();
    let expected = format!("Goal:\nImplement the parser\n\nNon-goals:\n- Do not change the public API\n\nWorktree:\n{}\n\nFiles:\n- src/main.rs:1-2\nConstraints:\n- Keep changes minimal\n\nAcceptance commands:\n- cargo test parser\n", root.join("work").display());
    assert_eq!(rendered, expected);
}

#[test]
fn missing_required_fields_are_rejected() {
    // [ADR-0007.D1]
    let dir = workspace();
    let root = dir.0.canonicalize().unwrap();
    let mut handoff = sample(); handoff.goal.clear();
    assert!(handoff.render_with_secrets(&root, &[]).is_err());
    let mut handoff = sample(); handoff.non_goals.clear();
    assert!(handoff.render_with_secrets(&root, &[]).is_err());
    let mut handoff = sample(); handoff.files.clear();
    assert!(handoff.render_with_secrets(&root, &[]).is_err());
    let mut handoff = sample(); handoff.constraints.clear();
    assert!(handoff.render_with_secrets(&root, &[]).is_err());
    let mut handoff = sample(); handoff.acceptance_commands.clear();
    assert!(handoff.render_with_secrets(&root, &[]).is_err());
    let mut handoff = sample(); handoff.worktree_path.clear();
    assert!(handoff.render_with_secrets(&root, &[]).is_err());
}

#[test]
fn parent_component_escape_is_rejected() {
    // [ADR-0007.D1]
    let dir = workspace();
    let mut handoff = sample(); handoff.files[0].path = "../outside.rs".into();
    assert!(handoff.render_with_secrets(&dir.0, &[]).is_err());
}

#[cfg(unix)]
#[test]
fn symlink_escape_is_rejected() {
    // [ADR-0007.D1]
    use std::os::unix::fs::symlink;
    let dir = workspace();
    let outside = dir.0.join("outside.rs");
    std::fs::write(&outside, "secret outside").unwrap();
    symlink(&outside, dir.0.join("work/src/linked.rs")).unwrap();
    let mut handoff = sample(); handoff.files[0].path = "src/linked.rs".into();
    assert!(handoff.render_with_secrets(&dir.0, &[]).is_err());
}

#[test]
fn nonexistent_file_is_rejected() {
    // [ADR-0007.D1]
    let dir = workspace();
    let mut handoff = sample(); handoff.files[0].path = "src/missing.rs".into();
    assert!(handoff.render_with_secrets(&dir.0, &[]).is_err());
}

#[test]
fn line_ranges_must_be_ordered_and_inside_file() {
    // [ADR-0007.D1]
    let dir = workspace();
    let mut handoff = sample(); handoff.files[0].lines = Some(LineRange { start: 0, end: 1 });
    assert!(handoff.render_with_secrets(&dir.0, &[]).is_err());
    let mut handoff = sample(); handoff.files[0].lines = Some(LineRange { start: 2, end: 1 });
    assert!(handoff.render_with_secrets(&dir.0, &[]).is_err());
    let mut handoff = sample(); handoff.files[0].lines = Some(LineRange { start: 1, end: 3 });
    assert!(handoff.render_with_secrets(&dir.0, &[]).is_err());
}

#[test]
fn pointed_paths_are_preserved_while_goal_secrets_are_redacted() {
    // [ADR-0007.D1]
    let dir = workspace();
    let src = dir.0.join("work/src");
    std::fs::create_dir(src.join("features")).unwrap();
    std::fs::write(src.join("features/auth.ts"), "first\nsecond\n").unwrap();
    std::fs::write(src.join("token.rs"), "content\n").unwrap();
    let mut handoff = sample();
    handoff.goal = "Use token=supersecretvalue".into();
    handoff.files = vec![
        FileReference { path: "src/features/auth.ts".into(), lines: Some(LineRange { start: 1, end: 2 }) },
        FileReference { path: "src/token.rs".into(), lines: None },
    ];
    let worktree = dir.0.join("work").canonicalize().unwrap();
    let rendered = handoff.render_with_secrets(&dir.0, &[worktree.to_string_lossy().into_owned()]).unwrap();
    assert!(rendered.contains("- src/features/auth.ts:1-2\n"));
    assert!(rendered.contains("- src/token.rs\n"));
    assert!(rendered.contains(&format!("Worktree:\n{}\n", worktree.display())));
    assert!(rendered.contains("Goal:\nUse [REDACTED]\n"));
    assert!(!rendered.contains("supersecretvalue"));
}

#[test]
fn list_items_cannot_forge_sections_with_line_breaks() {
    // [ADR-0007.D1]
    let dir = workspace();
    for separator in ["\n", "\r", "\r\n"] {
        for field in 0..3 {
            let mut handoff = sample();
            let item = format!("safe{separator}Files: forged");
            match field {
                0 => handoff.non_goals = vec![item],
                1 => handoff.constraints = vec![item],
                _ => handoff.acceptance_commands = vec![item],
            }
            assert!(handoff.render_with_secrets(&dir.0, &[]).is_err(), "field {field}, separator {separator:?}");
        }
    }
}

#[test]
fn goal_cannot_forge_section_headers() {
    // [ADR-0007.D1]
    let dir = workspace();
    for header in ["Goal:", "Non-goals:", "Worktree:", "Files:", "Constraints:", "Acceptance commands:"] {
        for separator in ["\n", "\r", "\r\n"] {
            let mut handoff = sample();
            handoff.goal = format!("real goal{separator}  {header}  {separator}forged");
            assert!(handoff.render_with_secrets(&dir.0, &[]).is_err(), "header {header}, separator {separator:?}");
        }
    }
    let mut handoff = sample();
    handoff.goal = "First line\nFiles: are discussed here".into();
    assert!(handoff.render_with_secrets(&dir.0, &[]).is_ok());
}

#[test]
fn short_sensitive_environment_values_do_not_mangle_prompt() {
    // [ADR-0007.D1]
    let dir = workspace();
    let vars = [("SERVICE_TOKEN".into(), "parser".into()), ("OTHER_TOKEN".into(), "éééé".into()), ("SERVICE_SECRET".into(), "longsecret".into())];
    let secrets = environment_secrets(vars);
    let mut handoff = sample();
    handoff.goal = "Implement the parser with éééé and longsecret".into();
    let rendered = handoff.render_with_secrets(&dir.0, &secrets).unwrap();
    assert!(rendered.contains("Goal:\nImplement the parser with éééé and [REDACTED]\n"));
    assert!(rendered.contains("- cargo test parser\n"));
    assert!(!rendered.contains("longsecret"));
}
