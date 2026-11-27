// @adr ADR-0007.D1
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::path::{Component, Path, PathBuf};
use std::sync::LazyLock;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LineRange {
    pub start: u64,
    pub end: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileReference {
    pub path: String,
    pub lines: Option<LineRange>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Handoff {
    pub goal: String,
    pub non_goals: Vec<String>,
    pub files: Vec<FileReference>,
    pub constraints: Vec<String>,
    pub acceptance_commands: Vec<String>,
    pub worktree_path: String,
}

const GOAL_HEADER: &str = "Goal:";
const NON_GOALS_HEADER: &str = "Non-goals:";
const WORKTREE_HEADER: &str = "Worktree:";
const FILES_HEADER: &str = "Files:";
const CONSTRAINTS_HEADER: &str = "Constraints:";
const ACCEPTANCE_HEADER: &str = "Acceptance commands:";
const HEADERS: &[&str] = &[GOAL_HEADER, NON_GOALS_HEADER, WORKTREE_HEADER, FILES_HEADER, CONSTRAINTS_HEADER, ACCEPTANCE_HEADER];

fn required_list(items: &[String], name: &str) -> Result<(), String> {
    if items.is_empty() || items.iter().any(|item| item.trim().is_empty()) {
        return Err(format!("{name} must contain nonempty entries"));
    }
    if items.iter().any(|item| item.contains(['\n', '\r'])) {
        return Err(format!("{name} entries must not contain line breaks"));
    }
    Ok(())
}

fn relative_path(path: &str) -> Result<&Path, String> {
    let path = Path::new(path);
    if path.as_os_str().is_empty() || path.components().any(|part| matches!(part, Component::ParentDir | Component::RootDir | Component::Prefix(_))) {
        return Err("paths must be nonempty relative paths without parent components".into());
    }
    Ok(path)
}

fn canonical_child(root: &Path, path: &str) -> Result<PathBuf, String> {
    let resolved = root.join(relative_path(path)?).canonicalize().map_err(|_| "referenced path does not exist or cannot be resolved".to_string())?;
    if !resolved.starts_with(root) {
        return Err("referenced path escapes its workspace".into());
    }
    Ok(resolved)
}

fn sanitize(text: &str, secrets: &[String]) -> String {
    static PATTERNS: LazyLock<Vec<Regex>> = LazyLock::new(|| [
        r"(?is)-----BEGIN [^\-\r\n]*PRIVATE KEY-----.*?-----END [^\-\r\n]*PRIVATE KEY-----",
        r"(?i)\b(?:bearer|basic)\s+[^\s,;]+",
        r"(?i)\b(?:authorization|cookie|set-cookie)\s*:\s*[^\r\n]+",
        r"(?i)https?://[^/@:\s]+:[^/@\s]+@[^/\s?#]+",
        r#"(?i)(?:--[a-z0-9_.-]*(?:password|token|secret|key|credential)[a-z0-9_.-]*)(?:\s+|=)(?:"[^"]*"|'[^']*'|[^\s,;&]+)"#,
        r#"(?i)[a-z0-9_.-]*(?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|password|passwd|pwd|secret|credential|authorization|cookie|auth|bearer|signature)[a-z0-9_.-]*"?\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;&]+)"#,
        r"\b(?:gh[a-z]_[A-Za-z0-9_]{3,}|github_pat_[A-Za-z0-9_]{8,}|sk-[A-Za-z0-9_-]{8,}|xox[a-z]-[A-Za-z0-9-]{8,}|AKIA[A-Z0-9]{16}|AIza[A-Za-z0-9_-]{8,})\b",
        r"\beyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)?\b",
    ].iter().map(|p| Regex::new(p).expect("valid redaction pattern")).collect());
    let mut result = text.to_owned();
    for secret in secrets.iter().filter(|secret| !secret.is_empty()) {
        result = result.replace(secret, "[REDACTED]");
    }
    for pattern in PATTERNS.iter() {
        result = pattern.replace_all(&result, "[REDACTED]").into_owned();
    }
    result
}

fn environment_secrets(vars: impl IntoIterator<Item = (std::ffi::OsString, std::ffi::OsString)>) -> Vec<String> {
    vars.into_iter().filter_map(|(key, value)| {
        let name = key.to_string_lossy().to_ascii_lowercase();
        if ["secret", "token", "password", "passwd", "credential", "api_key", "apikey", "private_key", "auth"].iter().any(|term| name.contains(term)) {
            value.into_string().ok().filter(|value| value.chars().count() >= 8)
        } else {
            None
        }
    }).collect()
}

impl Handoff {
    /// Validate the worktree and pointers before rendering any instructions.
    pub fn render(&self, workspace_root: &Path) -> Result<String, String> {
        self.render_with_secrets(workspace_root, &environment_secrets(std::env::vars_os()))
    }

    fn render_with_secrets(&self, workspace_root: &Path, secrets: &[String]) -> Result<String, String> {
        if self.goal.trim().is_empty() { return Err("goal must not be empty".into()); }
        if self.goal.split(['\n', '\r']).any(|line| HEADERS.contains(&line.trim())) {
            return Err("goal must not contain section headers".into());
        }
        required_list(&self.non_goals, "non_goals")?;
        required_list(&self.constraints, "constraints")?;
        required_list(&self.acceptance_commands, "acceptance_commands")?;
        if self.files.is_empty() { return Err("files must not be empty".into()); }
        let root = workspace_root.canonicalize().map_err(|_| "workspace root does not exist or cannot be resolved".to_string())?;
        if !root.is_dir() { return Err("workspace root must be a directory".into()); }
        let worktree = canonical_child(&root, &self.worktree_path)?;
        if !worktree.is_dir() { return Err("worktree must be a directory".into()); }
        let mut pointers = Vec::with_capacity(self.files.len());
        for file in &self.files {
            let resolved = canonical_child(&worktree, &file.path)?;
            if !resolved.is_file() { return Err("file reference must be a file".into()); }
            let mut pointer = resolved.strip_prefix(&worktree).map_err(|_| "file reference escapes worktree".to_string())?.to_string_lossy().into_owned();
            if let Some(lines) = &file.lines {
                if lines.start == 0 || lines.end < lines.start { return Err("invalid line range".into()); }
                let bytes = std::fs::read(&resolved).map_err(|_| "file reference cannot be read".to_string())?;
                let count = if bytes.is_empty() { 0 } else { bytes.iter().filter(|&&byte| byte == b'\n').count() as u64 + u64::from(!bytes.ends_with(b"\n")) };
                if lines.end > count { return Err("line range exceeds file length".into()); }
                pointer.push_str(&format!(":{}-{}", lines.start, lines.end));
            }
            pointers.push(pointer);
        }
        fn list(items: &[String], secrets: &[String]) -> String { items.iter().map(|item| format!("- {}\n", sanitize(item, secrets))).collect() }
        let pointer_list: String = pointers.iter().map(|pointer| format!("- {pointer}\n")).collect();
        Ok(format!("{GOAL_HEADER}\n{}\n\n{NON_GOALS_HEADER}\n{}\n{WORKTREE_HEADER}\n{}\n\n{FILES_HEADER}\n{}{CONSTRAINTS_HEADER}\n{}\n{ACCEPTANCE_HEADER}\n{}", sanitize(&self.goal, secrets), list(&self.non_goals, secrets), worktree.display(), pointer_list, list(&self.constraints, secrets), list(&self.acceptance_commands, secrets)))
    }
}

#[tauri::command]
pub async fn render_handoff(workspace_root: String, handoff: Handoff) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || handoff.render(Path::new(&workspace_root)))
        .await.map_err(|_| "handoff rendering failed".to_string())?
}

#[path = "handoff_test.rs"]
mod tests;
