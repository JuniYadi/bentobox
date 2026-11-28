// @adr ADR-0011.D1
// @adr ADR-0011.D2
use crate::agent::{read_cached_model_catalog, CapabilityRegistry, DetectedHarness, TransportKind};
use crate::auth::AuthState;
use crate::db::Store;
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use tauri::State;

#[derive(Serialize, Deserialize, Clone, PartialEq, Eq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TeamStep {
    pub harness: String,
    pub model: Option<String>,
    pub effort: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, PartialEq, Eq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Team {
    pub id: String,
    pub name: String,
    pub role: String, // orchestrator | sub_agents | review
    pub is_default: bool,
    pub steps: Vec<TeamStep>,
}

#[derive(Serialize, Deserialize, Clone, PartialEq, Eq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GenerateTeamsRules {
    pub goal: String, // cheapest | balanced | best_quality
    pub prefer_subscriptions: bool,
    pub prefer_local_subagents: bool,
    pub no_frontier_subagents: bool,
    pub max_depth: usize, // 1..=10
}

#[derive(Serialize, Deserialize, Clone, PartialEq, Eq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GeneratedTeamDiff {
    pub action: String, // add | update
    pub team: Team,
    pub summary: String,
    pub warnings: Vec<String>,
}

const ALLOWED_ROLES: &[&str] = &["orchestrator", "sub_agents", "review"];
const ALLOWED_EFFORTS: &[&str] = &["low", "medium", "high"];

fn validate_team(team: &Team) -> Result<(), String> {
    let name = &team.name;
    if name.is_empty() {
        return Err("Team name cannot be empty".to_string());
    }
    if name.chars().any(|c| c.is_whitespace() || c == ':') {
        return Err("Team name cannot contain whitespace or ':'".to_string());
    }
    if !ALLOWED_ROLES.contains(&team.role.as_str()) {
        return Err(format!("Invalid role '{}'; must be one of: orchestrator, sub_agents, review", team.role));
    }
    if team.steps.is_empty() {
        return Err("Team must have at least one step".to_string());
    }
    for (idx, step) in team.steps.iter().enumerate() {
        if step.harness.trim().is_empty() {
            return Err(format!("Step {} harness cannot be empty", idx + 1));
        }
        if let Some(effort) = &step.effort {
            if !ALLOWED_EFFORTS.contains(&effort.as_str()) {
                return Err(format!("Invalid effort '{}' in step {}; must be low, medium, or high", effort, idx + 1));
            }
        }
    }
    Ok(())
}

impl Store {
    /// key = team id or exact team name. Ok(None) when no such team. Steps ordered by position, never empty.
    pub(crate) fn team_chain_for(&self, key: &str) -> Result<Option<Vec<TeamStep>>, String> {
        let conn = self.connection()?;
        let team_id: Option<String> = conn
            .query_row(
                "SELECT id FROM teams WHERE id = ?1 OR name = ?1 ORDER BY (id = ?1) DESC LIMIT 1",
                params![key],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;

        let Some(team_id) = team_id else {
            return Ok(None);
        };

        let mut stmt = conn
            .prepare("SELECT harness, model, effort FROM team_steps WHERE team_id = ?1 ORDER BY position ASC")
            .map_err(|e| e.to_string())?;
        let steps = stmt
            .query_map(params![team_id], |row| {
                Ok(TeamStep {
                    harness: row.get(0)?,
                    model: row.get(1)?,
                    effort: row.get(2)?,
                })
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;

        if steps.is_empty() {
            Ok(None)
        } else {
            Ok(Some(steps))
        }
    }

    pub(crate) fn teams_list(&self) -> Result<Vec<Team>, String> {
        let conn = self.connection()?;
        let mut stmt = conn
            .prepare("SELECT id, name, role, is_default = 1 FROM teams ORDER BY role ASC, name ASC")
            .map_err(|e| e.to_string())?;

        let teams_meta = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, bool>(3)?,
                ))
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;

        let mut teams = Vec::with_capacity(teams_meta.len());
        let mut step_stmt = conn
            .prepare("SELECT harness, model, effort FROM team_steps WHERE team_id = ?1 ORDER BY position ASC")
            .map_err(|e| e.to_string())?;

        for (id, name, role, is_default) in teams_meta {
            let steps = step_stmt
                .query_map(params![id], |row| {
                    Ok(TeamStep {
                        harness: row.get(0)?,
                        model: row.get(1)?,
                        effort: row.get(2)?,
                    })
                })
                .map_err(|e| e.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?;

            teams.push(Team {
                id,
                name,
                role,
                is_default,
                steps,
            });
        }

        Ok(teams)
    }

    pub(crate) fn teams_upsert(&self, mut team: Team) -> Result<Team, String> {
        validate_team(&team)?;
        let name = team.name.clone();
        let role = team.role.clone();

        let mut conn = self.connection()?;
        let tx = conn
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(|e| e.to_string())?;

        // Determine if this is an insert or update
        let is_new = team.id.trim().is_empty();
        let id = if is_new {
            uuid::Uuid::new_v4().to_string()
        } else {
            team.id.clone()
        };

        // Check unique name constraint across other teams
        let existing_name_id: Option<String> = tx
            .query_row(
                "SELECT id FROM teams WHERE name = ?1 AND id != ?2",
                params![name, id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;

        if existing_name_id.is_some() {
            return Err(format!("A team with name '{}' already exists", name));
        }

        // Check if name collides with another team's id
        let colliding_team_id: Option<String> = tx
            .query_row(
                "SELECT id FROM teams WHERE id = ?1 AND id != ?2",
                params![name, id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;

        if colliding_team_id.is_some() {
            return Err(format!("Team name '{}' collides with another team's id", name));
        }

        // Count existing teams for this role (excluding current team if updating)
        let other_role_count: i64 = tx
            .query_row(
                "SELECT COUNT(*) FROM teams WHERE role = ?1 AND id != ?2",
                params![role, id],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;

        // First team of a role becomes default automatically
        let mut make_default = team.is_default;
        if other_role_count == 0 {
            make_default = true;
        }

        // If this team is default, clear existing default for this role atomically
        if make_default {
            tx.execute(
                "UPDATE teams SET is_default = 0 WHERE role = ?1 AND id != ?2",
                params![role, id],
            )
            .map_err(|e| e.to_string())?;
        }

        // Upsert team record
        tx.execute(
            "INSERT INTO teams (id, name, role, is_default) VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(id) DO UPDATE SET name = excluded.name, role = excluded.role, is_default = excluded.is_default",
            params![id, name, role, if make_default { 1 } else { 0 }],
        )
        .map_err(|e| e.to_string())?;

        // Replace team_steps atomically
        tx.execute("DELETE FROM team_steps WHERE team_id = ?1", params![id])
            .map_err(|e| e.to_string())?;

        {
            let mut insert_step = tx
                .prepare("INSERT INTO team_steps (team_id, position, harness, model, effort) VALUES (?1, ?2, ?3, ?4, ?5)")
                .map_err(|e| e.to_string())?;
            for (idx, step) in team.steps.iter().enumerate() {
                insert_step
                    .execute(params![id, idx as i64, step.harness.trim(), step.model, step.effort])
                    .map_err(|e| e.to_string())?;
            }
        }

        tx.commit().map_err(|e| e.to_string())?;

        team.id = id;
        team.name = name;
        team.role = role;
        team.is_default = make_default;
        Ok(team)
    }

    pub(crate) fn teams_delete(&self, id: &str) -> Result<(), String> {
        let mut conn = self.connection()?;
        let tx = conn
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(|e| e.to_string())?;

        // Delete from sessions first to clear sessions.team
        tx.execute(
            "UPDATE sessions SET team = NULL WHERE team = ?1",
            params![id],
        )
        .map_err(|e| e.to_string())?;

        // Delete team (cascade removes team_steps due to foreign key)
        let rows = tx
            .execute("DELETE FROM teams WHERE id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        if rows == 0 {
            return Err("unknown team".into());
        }

        tx.commit().map_err(|e| e.to_string())?;
        Ok(())
    }

    pub(crate) fn teams_set_default(&self, id: &str) -> Result<(), String> {
        let mut conn = self.connection()?;
        let tx = conn
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(|e| e.to_string())?;

        let role: Option<String> = tx
            .query_row(
                "SELECT role FROM teams WHERE id = ?1",
                params![id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;

        let Some(role) = role else {
            return Err("unknown team".into());
        };

        // Clear existing default for role
        tx.execute(
            "UPDATE teams SET is_default = 0 WHERE role = ?1",
            params![role],
        )
        .map_err(|e| e.to_string())?;

        // Set this team as default
        tx.execute(
            "UPDATE teams SET is_default = 1 WHERE id = ?1",
            params![id],
        )
        .map_err(|e| e.to_string())?;

        tx.commit().map_err(|e| e.to_string())?;
        Ok(())
    }

    pub(crate) fn teams_apply_all(&self, teams: Vec<Team>) -> Result<Vec<Team>, String> {
        // Validate all teams upfront before opening transaction
        for team in &teams {
            validate_team(team)?;
        }

        let mut conn = self.connection()?;
        let tx = conn
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(|e| e.to_string())?;

        let mut applied = Vec::with_capacity(teams.len());

        for mut team in teams {
            let name = team.name.clone();
            let role = team.role.clone();

            let is_new = team.id.trim().is_empty();
            let id = if is_new {
                uuid::Uuid::new_v4().to_string()
            } else {
                team.id.clone()
            };

            let existing_name_id: Option<String> = tx
                .query_row(
                    "SELECT id FROM teams WHERE name = ?1 AND id != ?2",
                    params![name, id],
                    |row| row.get(0),
                )
                .optional()
                .map_err(|e| e.to_string())?;

            if existing_name_id.is_some() {
                return Err(format!("A team with name '{}' already exists", name));
            }

            let colliding_team_id: Option<String> = tx
                .query_row(
                    "SELECT id FROM teams WHERE id = ?1 AND id != ?2",
                    params![name, id],
                    |row| row.get(0),
                )
                .optional()
                .map_err(|e| e.to_string())?;

            if colliding_team_id.is_some() {
                return Err(format!("Team name '{}' collides with another team's id", name));
            }

            let other_role_count: i64 = tx
                .query_row(
                    "SELECT COUNT(*) FROM teams WHERE role = ?1 AND id != ?2",
                    params![role, id],
                    |row| row.get(0),
                )
                .map_err(|e| e.to_string())?;

            let mut make_default = team.is_default;
            if other_role_count == 0 {
                make_default = true;
            }

            if make_default {
                tx.execute(
                    "UPDATE teams SET is_default = 0 WHERE role = ?1 AND id != ?2",
                    params![role, id],
                )
                .map_err(|e| e.to_string())?;
            }

            tx.execute(
                "INSERT INTO teams (id, name, role, is_default) VALUES (?1, ?2, ?3, ?4)
                 ON CONFLICT(id) DO UPDATE SET name = excluded.name, role = excluded.role, is_default = excluded.is_default",
                params![id, name, role, if make_default { 1 } else { 0 }],
            )
            .map_err(|e| e.to_string())?;

            tx.execute("DELETE FROM team_steps WHERE team_id = ?1", params![id])
                .map_err(|e| e.to_string())?;

            {
                let mut insert_step = tx
                    .prepare("INSERT INTO team_steps (team_id, position, harness, model, effort) VALUES (?1, ?2, ?3, ?4, ?5)")
                    .map_err(|e| e.to_string())?;
                for (idx, step) in team.steps.iter().enumerate() {
                    insert_step
                        .execute(params![id, idx as i64, step.harness.trim(), step.model, step.effort])
                        .map_err(|e| e.to_string())?;
                }
            }

            team.id = id;
            team.name = name;
            team.role = role;
            team.is_default = make_default;
            applied.push(team);
        }

        tx.commit().map_err(|e| e.to_string())?;
        Ok(applied)
    }
}

// ---------------- Generator Logic ---------------- //

pub(crate) fn generate_preview_with<FDetect, FAuth>(
    store: &Store,
    rules: &GenerateTeamsRules,
    detect: FDetect,
    auth: FAuth,
) -> Result<Vec<GeneratedTeamDiff>, String>
where
    FDetect: Fn() -> Vec<DetectedHarness>,
    FAuth: Fn(&str) -> AuthState,
{
    let max_depth = rules.max_depth.clamp(1, 10);
    let detected = detect();

    // Filter to detected runnable harnesses
    let runnable: Vec<DetectedHarness> = detected
        .into_iter()
        .filter(|h| h.runnable)
        .collect();

    // Collect auth state for each runnable harness
    let mut harness_auth = Vec::new();
    for h in runnable {
        let auth_state = auth(&h.capabilities.harness_id);
        harness_auth.push((h, auth_state));
    }

    // Generator produces teams for three roles: orchestrator, sub_agents, review
    let roles = ["orchestrator", "sub_agents", "review"];
    let existing_teams = store.teams_list()?;
    let mut diffs = Vec::new();

    for role in roles {
        let mut warnings = Vec::new();

        if rules.no_frontier_subagents && role == "sub_agents" {
            warnings.push("No frontier model metadata available; rule could not be evaluated".to_string());
        }
        if rules.goal == "cheapest" || rules.goal == "best_quality" {
            warnings.push(format!("No model cost/tier metadata available; '{0}' goal ordered by catalog availability only", rules.goal));
        }

        // When prefer_local_subagents is set and no runnable native harness exists after filtering
        if role == "sub_agents" && rules.prefer_local_subagents {
            let has_runnable_local = harness_auth.iter().any(|(h, _)| {
                h.capabilities.transport == TransportKind::NativeProcess
            });
            if !has_runnable_local {
                warnings.push("no runnable local harness detected".to_string());
            }
        }

        // Rank harnesses for this role
        let mut sorted = harness_auth.clone();
        sorted.sort_by(|(a_h, a_auth), (b_h, b_auth)| {
            let a_is_local = a_h.capabilities.transport == TransportKind::NativeProcess;
            let b_is_local = b_h.capabilities.transport == TransportKind::NativeProcess;

            // In sub_agents, if prefer_local_subagents:
            if role == "sub_agents" && rules.prefer_local_subagents {
                if a_is_local != b_is_local {
                    return b_is_local.cmp(&a_is_local);
                }
            }

            // prefer_subscriptions
            if rules.prefer_subscriptions {
                let a_sub = *a_auth == AuthState::Authenticated;
                let b_sub = *b_auth == AuthState::Authenticated;
                if a_sub != b_sub {
                    return b_sub.cmp(&a_sub);
                }
            }

            // Unauthenticated comes last
            let a_unauth = *a_auth == AuthState::Unauthenticated;
            let b_unauth = *b_auth == AuthState::Unauthenticated;
            if a_unauth != b_unauth {
                return a_unauth.cmp(&b_unauth);
            }

            a_h.capabilities.harness_id.cmp(&b_h.capabilities.harness_id)
        });

        // Build steps (never include Unauthenticated harnesses)
        let mut steps = Vec::new();
        let mut seen_harnesses = HashSet::new();

        for (h, auth_state) in &sorted {
            if *auth_state == AuthState::Unauthenticated {
                continue;
            }
            if seen_harnesses.contains(&h.capabilities.harness_id) {
                continue;
            }
            seen_harnesses.insert(h.capabilities.harness_id.clone());

            // Pick model from cached catalog
            let catalog = read_cached_model_catalog(
                store,
                &h.capabilities.harness_id,
                h.capabilities.binary_version.as_deref(),
            );
            let model = catalog.and_then(|c| {
                c.current_model.or_else(|| c.models.first().map(|m| m.id.clone()))
            });

            steps.push(TeamStep {
                harness: h.capabilities.harness_id.clone(),
                model,
                effort: None,
            });

            if steps.len() >= max_depth {
                break;
            }
        }

        // If a role ends up with no usable step, emit NO diff for it
        if steps.is_empty() {
            continue;
        }

        let team_name = match role {
            "orchestrator" => "default-orchestrator",
            "sub_agents" => "default-sub-agents",
            "review" => "default-review",
            _ => "default-team",
        };

        // Check against existing teams
        let existing = existing_teams.iter().find(|t| t.role == role && t.name == team_name);

        let (action, id, is_default) = match existing {
            Some(ex) => {
                if ex.steps == steps {
                    // Skip unchanged
                    continue;
                }
                ("update".to_string(), ex.id.clone(), ex.is_default)
            }
            None => {
                let has_default_in_role = existing_teams.iter().any(|t| t.role == role && t.is_default);
                ("add".to_string(), String::new(), !has_default_in_role)
            }
        };

        let summary = format!("{}: {} step(s) ({})", action, steps.len(), role);

        diffs.push(GeneratedTeamDiff {
            action,
            team: Team {
                id,
                name: team_name.to_string(),
                role: role.to_string(),
                is_default,
                steps,
            },
            summary,
            warnings,
        });
    }

    Ok(diffs)
}

// ---------------- Tauri Commands ---------------- //

/// @adr ADR-0011.D1
#[tauri::command]
pub async fn teams_list(store: State<'_, Store>) -> Result<Vec<Team>, String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || store.teams_list())
        .await
        .map_err(|e| e.to_string())?
}

/// @adr ADR-0011.D1
#[tauri::command]
pub async fn teams_upsert(store: State<'_, Store>, team: Team) -> Result<Team, String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || store.teams_upsert(team))
        .await
        .map_err(|e| e.to_string())?
}

/// @adr ADR-0011.D1
#[tauri::command]
pub async fn teams_delete(store: State<'_, Store>, id: String) -> Result<(), String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || store.teams_delete(&id))
        .await
        .map_err(|e| e.to_string())?
}

/// @adr ADR-0011.D1
#[tauri::command]
pub async fn teams_set_default(store: State<'_, Store>, id: String) -> Result<(), String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || store.teams_set_default(&id))
        .await
        .map_err(|e| e.to_string())?
}

/// @adr ADR-0011.D2
#[tauri::command]
pub async fn teams_generate_preview(
    store: State<'_, Store>,
    rules: GenerateTeamsRules,
) -> Result<Vec<GeneratedTeamDiff>, String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let path = std::env::var_os("PATH").unwrap_or_default();
        let detect = || CapabilityRegistry::detect(&path);
        let auth = |harness_id: &str| {
            let path_os = std::env::var_os("PATH").unwrap_or_default();
            crate::auth::status_with_path(harness_id, &path_os, std::time::Duration::from_secs(2)).state
        };
        generate_preview_with(&store, &rules, detect, auth)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// @adr ADR-0011.D2
#[tauri::command]
pub async fn teams_apply_generated(
    store: State<'_, Store>,
    teams: Vec<Team>,
) -> Result<Vec<Team>, String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || store.teams_apply_all(teams))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(test)]
#[path = "teams_test.rs"]
mod tests;
