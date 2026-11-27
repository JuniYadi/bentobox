// @adr ADR-0008.D1
use serde::{Deserialize, Serialize};
use std::process::Command;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GhStatus {
    pub installed: bool,
    pub authenticated: bool,
    pub username: Option<String>,
    pub message: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GhIssue {
    pub number: u64,
    pub title: String,
    pub state: String,
    pub url: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GhPullRequest {
    pub number: u64,
    pub title: String,
    pub state: String,
    pub url: String,
    #[serde(rename = "headRefName")]
    pub head_ref_name: Option<String>,
}

#[tauri::command]
pub fn gh_check_status() -> Result<GhStatus, String> {
    let check_cmd = Command::new("gh").arg("--version").output();
    let _version_output = match check_cmd {
        Ok(out) if out.status.success() => out,
        Ok(_) => {
            return Ok(GhStatus {
                installed: true,
                authenticated: false,
                username: None,
                message: "GitHub CLI returned non-zero when checking version.".into(),
            });
        }
        Err(_) => {
            return Ok(GhStatus {
                installed: false,
                authenticated: false,
                username: None,
                message: "GitHub CLI (`gh`) is not installed or not in PATH.".into(),
            });
        }
    };

    let auth_cmd = Command::new("gh")
        .args(["auth", "status", "--hostname", "github.com"])
        .output();

    match auth_cmd {
        Ok(out) => {
            let combined = format!(
                "{}\n{}",
                String::from_utf8_lossy(&out.stdout),
                String::from_utf8_lossy(&out.stderr)
            );
            if out.status.success() || combined.contains("Logged in to github.com") {
                let user = combined
                    .lines()
                    .find(|l| l.contains("account "))
                    .and_then(|l| l.split("account ").nth(1))
                    .and_then(|s| s.split_whitespace().next())
                    .map(|s| s.to_string());

                Ok(GhStatus {
                    installed: true,
                    authenticated: true,
                    username: user,
                    message: "GitHub CLI is authenticated.".into(),
                })
            } else {
                Ok(GhStatus {
                    installed: true,
                    authenticated: false,
                    username: None,
                    message: "GitHub CLI is installed but not authenticated. Run `gh auth login`."
                        .into(),
                })
            }
        }
        Err(e) => Ok(GhStatus {
            installed: true,
            authenticated: false,
            username: None,
            message: format!("Failed to check gh auth status: {}", e),
        }),
    }
}

#[tauri::command]
pub fn gh_list_issues() -> Result<Vec<GhIssue>, String> {
    let output = Command::new("gh")
        .args([
            "issue",
            "list",
            "--limit",
            "30",
            "--json",
            "number,title,state,url",
        ])
        .output()
        .map_err(|e| format!("Failed to execute gh issue list: {}", e))?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }

    serde_json::from_slice(&output.stdout)
        .map_err(|e| format!("Failed to parse gh issue list output: {}", e))
}

#[tauri::command]
pub fn gh_list_prs() -> Result<Vec<GhPullRequest>, String> {
    let output = Command::new("gh")
        .args([
            "pr",
            "list",
            "--limit",
            "30",
            "--json",
            "number,title,state,url,headRefName",
        ])
        .output()
        .map_err(|e| format!("Failed to execute gh pr list: {}", e))?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }

    serde_json::from_slice(&output.stdout)
        .map_err(|e| format!("Failed to parse gh pr list output: {}", e))
}
