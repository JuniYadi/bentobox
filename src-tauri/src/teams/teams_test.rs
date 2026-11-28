use super::*;
use crate::agent::{write_cached_model_catalog, Features, ModelCatalog, ModelOption};
use std::path::PathBuf;

fn test_store() -> (Store, PathBuf) {
    let unique = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let root = std::env::temp_dir().join(format!("bentobox-teams-test-{}-{unique}", std::process::id()));
    std::fs::create_dir_all(&root).unwrap();
    let path = root.join("db.sqlite");
    let store = Store::open(&path).unwrap();
    (store, root)
}

fn cleanup(root: &std::path::Path) {
    let _ = std::fs::remove_dir_all(root);
}

fn fake_harness(id: &str, is_local: bool, is_runnable: bool) -> DetectedHarness {
    DetectedHarness {
        capabilities: crate::agent::CapabilityDescriptor {
            harness_id: id.to_string(),
            display_name: id.to_string(),
            executable: id.to_string(),
            transport: if is_local {
                TransportKind::NativeProcess
            } else {
                TransportKind::Acp
            },
            transport_args: vec![],
            binary_version: Some("1.0.0".to_string()),
            models: None,
            effort_levels: None,
            features: Features::UNKNOWN,
            known_limitations: vec![],
        },
        executable_path: PathBuf::from(format!("/usr/bin/{id}")),
        runnable: is_runnable,
        launch_note: None,
    }
}

// [ADR-0011.D1] Chain order is preserved and lookup works by id or exact name.
#[test]
fn adr0011_chain_order_preserved_and_resolved() {
    let (store, root) = test_store();

    let team = Team {
        id: String::new(),
        name: "dev-team".to_string(),
        role: "orchestrator".to_string(),
        is_default: false,
        steps: vec![
            TeamStep {
                harness: "claude".to_string(),
                model: Some("claude-sonnet-4-6".to_string()),
                effort: Some("high".to_string()),
            },
            TeamStep {
                harness: "omp".to_string(),
                model: Some("gpt-4o".to_string()),
                effort: Some("medium".to_string()),
            },
            TeamStep {
                harness: "pi".to_string(),
                model: None,
                effort: None,
            },
        ],
    };

    let inserted = store.teams_upsert(team).unwrap();
    assert_ne!(inserted.id, "");
    assert!(inserted.is_default); // First team of role becomes default automatically

    // Lookup by id
    let chain_by_id = store.team_chain_for(&inserted.id).unwrap().expect("chain by id");
    assert_eq!(chain_by_id.len(), 3);
    assert_eq!(chain_by_id[0].harness, "claude");
    assert_eq!(chain_by_id[0].model, Some("claude-sonnet-4-6".to_string()));
    assert_eq!(chain_by_id[0].effort, Some("high".to_string()));
    assert_eq!(chain_by_id[1].harness, "omp");
    assert_eq!(chain_by_id[2].harness, "pi");

    // Lookup by exact name
    let chain_by_name = store.team_chain_for("dev-team").unwrap().expect("chain by name");
    assert_eq!(chain_by_name, chain_by_id);

    // Nonexistent lookup returns None
    assert!(store.team_chain_for("unknown").unwrap().is_none());

    cleanup(&root);
}

// [ADR-0011.D1] Exactly one default per role is maintained atomically when setting or inserting defaults.
#[test]
fn adr0011_one_default_per_role_enforced() {
    let (store, root) = test_store();

    let team1 = Team {
        id: String::new(),
        name: "team-1".to_string(),
        role: "orchestrator".to_string(),
        is_default: false,
        steps: vec![TeamStep {
            harness: "claude".to_string(),
            model: None,
            effort: None,
        }],
    };
    let saved1 = store.teams_upsert(team1).unwrap();
    assert!(saved1.is_default); // First in role

    let team2 = Team {
        id: String::new(),
        name: "team-2".to_string(),
        role: "orchestrator".to_string(),
        is_default: true,
        steps: vec![TeamStep {
            harness: "codex".to_string(),
            model: None,
            effort: None,
        }],
    };
    let saved2 = store.teams_upsert(team2).unwrap();
    assert!(saved2.is_default);

    // Team 1 should now not be default
    let list = store.teams_list().unwrap();
    let t1 = list.iter().find(|t| t.id == saved1.id).unwrap();
    let t2 = list.iter().find(|t| t.id == saved2.id).unwrap();
    assert!(!t1.is_default);
    assert!(t2.is_default);

    // teams_set_default switches default back to team 1
    store.teams_set_default(&saved1.id).unwrap();
    let list = store.teams_list().unwrap();
    let t1 = list.iter().find(|t| t.id == saved1.id).unwrap();
    let t2 = list.iter().find(|t| t.id == saved2.id).unwrap();
    assert!(t1.is_default);
    assert!(!t2.is_default);

    cleanup(&root);
}

// [ADR-0011.D1] Upsert validates bad role, bad effort, empty steps, whitespace, colons, and duplicate names or id collisions.
#[test]
fn adr0011_upsert_validation_errors() {
    let (store, root) = test_store();

    // Bad role
    let bad_role = Team {
        id: String::new(),
        name: "bad-role".to_string(),
        role: "manager".to_string(),
        is_default: false,
        steps: vec![TeamStep {
            harness: "claude".to_string(),
            model: None,
            effort: None,
        }],
    };
    assert!(store.teams_upsert(bad_role).is_err());

    // Bad effort
    let bad_effort = Team {
        id: String::new(),
        name: "bad-effort".to_string(),
        role: "orchestrator".to_string(),
        is_default: false,
        steps: vec![TeamStep {
            harness: "claude".to_string(),
            model: None,
            effort: Some("maximum".to_string()),
        }],
    };
    assert!(store.teams_upsert(bad_effort).is_err());

    // Empty steps
    let empty_steps = Team {
        id: String::new(),
        name: "empty-steps".to_string(),
        role: "review".to_string(),
        is_default: false,
        steps: vec![],
    };
    assert!(store.teams_upsert(empty_steps).is_err());

    // Name with whitespace
    let whitespace_name = Team {
        id: String::new(),
        name: "my team".to_string(),
        role: "sub_agents".to_string(),
        is_default: false,
        steps: vec![TeamStep {
            harness: "claude".to_string(),
            model: None,
            effort: None,
        }],
    };
    assert!(store.teams_upsert(whitespace_name).is_err());

    // Name with colon
    let colon_name = Team {
        id: String::new(),
        name: "a:b".to_string(),
        role: "sub_agents".to_string(),
        is_default: false,
        steps: vec![TeamStep {
            harness: "claude".to_string(),
            model: None,
            effort: None,
        }],
    };
    assert!(store.teams_upsert(colon_name).is_err());

    // Duplicate name
    let valid = Team {
        id: String::new(),
        name: "duplicate".to_string(),
        role: "sub_agents".to_string(),
        is_default: false,
        steps: vec![TeamStep {
            harness: "claude".to_string(),
            model: None,
            effort: None,
        }],
    };
    let created = store.teams_upsert(valid).unwrap();

    let duplicate = Team {
        id: String::new(),
        name: "duplicate".to_string(),
        role: "review".to_string(),
        is_default: false,
        steps: vec![TeamStep {
            harness: "omp".to_string(),
            model: None,
            effort: None,
        }],
    };
    assert!(store.teams_upsert(duplicate).is_err());

    // Collision with another team's id
    let id_collision = Team {
        id: String::new(),
        name: created.id.clone(),
        role: "review".to_string(),
        is_default: false,
        steps: vec![TeamStep {
            harness: "omp".to_string(),
            model: None,
            effort: None,
        }],
    };
    assert!(store.teams_upsert(id_collision).is_err());

    cleanup(&root);
}

// [ADR-0011.D1] Deleting a team clears sessions.team, cascade deletes steps, and does not promote another default.
#[test]
fn adr0011_delete_clears_sessions_team_and_does_not_promote() {
    let (store, root) = test_store();

    let team1 = store
        .teams_upsert(Team {
            id: String::new(),
            name: "team-1".to_string(),
            role: "orchestrator".to_string(),
            is_default: true,
            steps: vec![TeamStep {
                harness: "claude".to_string(),
                model: None,
                effort: None,
            }],
        })
        .unwrap();

    let team2 = store
        .teams_upsert(Team {
            id: String::new(),
            name: "team-2".to_string(),
            role: "orchestrator".to_string(),
            is_default: false,
            steps: vec![TeamStep {
                harness: "codex".to_string(),
                model: None,
                effort: None,
            }],
        })
        .unwrap();

    // Create session referencing team1
    let session_id = {
        let conn = store.connection().unwrap();
        conn.execute(
            "INSERT INTO sessions (id, state, team) VALUES (10, 'active', ?1)",
            params![team1.id],
        )
        .unwrap();
        10i64
    };

    assert_eq!(store.session_team(session_id).unwrap(), Some(team1.id.clone()));

    // Delete team 1
    store.teams_delete(&team1.id).unwrap();

    // sessions.team must be set to NULL
    assert_eq!(store.session_team(session_id).unwrap(), None);

    // team2 must NOT have been promoted to default
    let list = store.teams_list().unwrap();
    let remaining = list.iter().find(|t| t.id == team2.id).unwrap();
    assert!(!remaining.is_default);

    cleanup(&root);
}

// [ADR-0011.D2] Generator preview is pure read and leaves teams table untouched.
#[test]
fn adr0011_generator_preview_is_read_only() {
    let (store, root) = test_store();

    let rules = GenerateTeamsRules {
        goal: "balanced".to_string(),
        prefer_subscriptions: true,
        prefer_local_subagents: true,
        no_frontier_subagents: true,
        max_depth: 3,
    };

    // native pi is runnable=false per agent/mod.rs convention
    let detect = || vec![fake_harness("claude", false, true), fake_harness("pi", true, false)];
    let auth = |h: &str| {
        if h == "claude" {
            AuthState::Authenticated
        } else {
            AuthState::Unknown
        }
    };

    let preview = generate_preview_with(&store, &rules, detect, auth).unwrap();
    assert!(!preview.is_empty());

    // Generated slug names pass validation
    for diff in &preview {
        assert!(validate_team(&diff.team).is_ok());
    }

    // Assert teams table is completely untouched / empty
    let list_after_preview = store.teams_list().unwrap();
    assert!(list_after_preview.is_empty());

    cleanup(&root);
}

// [ADR-0011.D2] Applying generated teams writes atomically; invalid team rolls back everything.
#[test]
fn adr0011_apply_atomic_all_or_nothing() {
    let (store, root) = test_store();

    // Create an existing team
    store
        .teams_upsert(Team {
            id: String::new(),
            name: "existing-team".to_string(),
            role: "orchestrator".to_string(),
            is_default: true,
            steps: vec![TeamStep {
                harness: "claude".to_string(),
                model: None,
                effort: None,
            }],
        })
        .unwrap();

    let team1 = Team {
        id: String::new(),
        name: "new-team-1".to_string(),
        role: "sub_agents".to_string(),
        is_default: false,
        steps: vec![TeamStep {
            harness: "claude".to_string(),
            model: None,
            effort: None,
        }],
    };

    let team2_invalid_duplicate = Team {
        id: String::new(),
        name: "existing-team".to_string(), // collides with existing team name!
        role: "review".to_string(),
        is_default: false,
        steps: vec![TeamStep {
            harness: "codex".to_string(),
            model: None,
            effort: None,
        }],
    };

    // Apply both together
    let res = store.teams_apply_all(vec![team1, team2_invalid_duplicate]);
    assert!(res.is_err());

    // Assert team1 was NOT written due to transaction rollback
    let all_teams = store.teams_list().unwrap();
    assert_eq!(all_teams.len(), 1);
    assert_eq!(all_teams[0].name, "existing-team");

    cleanup(&root);
}

// [ADR-0011.D2] Generator emits warning when prefer_local_subagents is set and no runnable local harness exists.
#[test]
fn adr0011_generator_local_subagent_warning() {
    let (store, root) = test_store();

    let rules = GenerateTeamsRules {
        goal: "balanced".to_string(),
        prefer_subscriptions: true,
        prefer_local_subagents: true,
        no_frontier_subagents: false,
        max_depth: 3,
    };

    // Only non-local ACP harness is runnable; native pi is runnable=false
    let detect = || vec![fake_harness("claude", false, true), fake_harness("pi", true, false)];
    let auth = |_h: &str| AuthState::Authenticated;

    let preview = generate_preview_with(&store, &rules, detect, auth).unwrap();
    let subagents_diff = preview.iter().find(|d| d.team.role == "sub_agents").unwrap();
    assert!(subagents_diff.warnings.iter().any(|w| w.contains("no runnable local harness detected")));

    cleanup(&root);
}

// [ADR-0011.D2] Generator drops unauthenticated harnesses and emits NO diff for empty roles.
#[test]
fn adr0011_generator_drops_unauthenticated_and_omits_empty_roles() {
    let (store, root) = test_store();

    let rules = GenerateTeamsRules {
        goal: "balanced".to_string(),
        prefer_subscriptions: true,
        prefer_local_subagents: false,
        no_frontier_subagents: false,
        max_depth: 3,
    };

    // Harness is detected & runnable, but unauthenticated
    let detect = || vec![fake_harness("claude", false, true)];
    let auth = |_h: &str| AuthState::Unauthenticated;

    let preview = generate_preview_with(&store, &rules, detect, auth).unwrap();
    assert!(preview.is_empty()); // No usable step => no diffs emitted

    cleanup(&root);
}

// [ADR-0011.D2] Max depth truncates the fallback chain to the specified limit.
#[test]
fn adr0011_max_depth_truncation() {
    let (store, root) = test_store();

    let rules = GenerateTeamsRules {
        goal: "balanced".to_string(),
        prefer_subscriptions: false,
        prefer_local_subagents: false,
        no_frontier_subagents: false,
        max_depth: 2,
    };

    let detect = || {
        vec![
            fake_harness("claude", false, true),
            fake_harness("codex", false, true),
            fake_harness("omp", false, true),
            fake_harness("opencode", false, true),
        ]
    };
    let auth = |_h: &str| AuthState::Authenticated;

    let preview = generate_preview_with(&store, &rules, detect, auth).unwrap();
    for diff in preview {
        assert!(diff.team.steps.len() <= 2);
    }

    cleanup(&root);
}

// [ADR-0011.D2] Model from cached catalog is populated on steps.
#[test]
fn adr0011_generator_uses_cached_catalog_models() {
    let (store, root) = test_store();

    let catalog = ModelCatalog {
        models: vec![
            ModelOption {
                id: "claude-3-7-sonnet".to_string(),
                name: "Claude 3.7 Sonnet".to_string(),
            },
        ],
        current_model: Some("claude-3-7-sonnet".to_string()),
        status: "ready".to_string(),
        note: None,
    };
    write_cached_model_catalog(&store, "claude", Some("1.0.0"), &catalog);

    let rules = GenerateTeamsRules {
        goal: "balanced".to_string(),
        prefer_subscriptions: true,
        prefer_local_subagents: false,
        no_frontier_subagents: false,
        max_depth: 3,
    };

    let detect = || vec![fake_harness("claude", false, true)];
    let auth = |_h: &str| AuthState::Authenticated;

    let preview = generate_preview_with(&store, &rules, detect, auth).unwrap();
    assert!(!preview.is_empty());
    assert_eq!(
        preview[0].team.steps[0].model,
        Some("claude-3-7-sonnet".to_string())
    );

    cleanup(&root);
}
