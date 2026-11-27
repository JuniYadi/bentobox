# Decision status

Generated file; change the ADRs or the code, then run the `status` command. Code lists files tagged `@adr`. Tests lists test files with a `[ADR-NNNN.Dn]` marker.

## default

| ID | Decision | Status | Use cases | Code | Tests |
|:--|:--|:--|:--|:--|:--|
| ADR-0001.D1 | Dual-transport ACP and native process adapters with Capability Registry | accepted, code and test present | - | `src-tauri/src/agent/mod.rs`<br>`src/features/agent/api.ts` | `src-tauri/src/agent/agent_test.rs` |
| ADR-0002.D1 | Strict separation of session usage and account quota with unavailable states | accepted, code and test present | - | `src-tauri/src/usage/mod.rs`<br>`src/features/usage/api.ts` | `src-tauri/src/usage/usage_test.rs` |
| ADR-0003.D1 | Configurable opt-in Git worktree isolation for parallel task execution | accepted, code and test present | - | `src-tauri/src/workspace/mod.rs`<br>`src/features/workspace/api.ts` | `src-tauri/src/workspace/workspace_test.rs` |
| ADR-0004.D1 | Agent-owned authentication lifecycle via native CLIs and system keychains | accepted, code and test present | - | `src-tauri/src/auth/mod.rs`<br>`src/features/auth/api.ts` | `src-tauri/src/auth/auth_test.rs` |
| ADR-0005.D1 | Embedded SQLite for session coordination, task graphs, and redacted event logs | accepted, code and test present | - | `src-tauri/src/db/mod.rs` | `src-tauri/src/db/db_test.rs` |
| ADR-0006.D1 | Tri-mode session architecture supporting orchestrator, plan, and build modes | superseded | - | - | - |
| ADR-0007.D1 | Structured prompt handoff protocol with pointed file references and constraints | accepted, code and test present | - | `src-tauri/src/handoff/mod.rs`<br>`src/features/handoff/api.ts` | `src-tauri/src/handoff/handoff_test.rs` |
| ADR-0008.D1 | GitHub CLI integration for querying and browser-opening issues and pull requests | accepted, code present, no test | - | `src-tauri/src/github/mod.rs`<br>`src/features/github/GitHubPanel.tsx`<br>`src/features/github/api.ts` | - |
| ADR-0009.D1 | Three-column responsive desktop layout (Sidebar Left | Content | Sidebar Right) | accepted, code and test present | - | `src/components/layout/ContentArea.tsx`<br>`src/components/layout/SidebarLeft.tsx`<br>`src/components/layout/SidebarRight.tsx`<br>`src/components/layout/ThreeColumnLayout.tsx` | `src/components/layout/ContentArea.test.tsx` |
| ADR-0010.D1 | Orchestrator-only sessions; read-only orchestrator, sub-agents write in worktrees after plan approval (supersedes ADR-0006.D1) | accepted, code and test present | - | `src-tauri/src/session/mod.rs`<br>`src-tauri/src/session/store.rs`<br>`src/features/session/api.ts`<br>`src/features/session/types.ts` | `src-tauri/src/db/db_test.rs`<br>`src-tauri/src/session/session_test.rs` |
| ADR-0011.D1 | Teams bind a role to an ordered harness/model:effort fallback chain | accepted, no code yet | - | - | - |
| ADR-0011.D2 | Teams are generated from detected subscriptions by user rules, previewed before apply | accepted, no code yet | - | - | - |
| ADR-0012.D1 | Inline per-message routing via @harness/model[:effort] or @team:name overrides the session team | accepted, no code yet | - | - | - |
| ADR-0013.D1 | GitHub Release-triggered multi-platform Tauri build pipeline with tag/version guard | accepted, no code yet | - | - | - |
| ADR-0013.D2 | Sign and notarize macOS bundles with an Apple Developer ID | accepted, no code yet | - | - | - |
| ADR-0013.D3 | Authenticode-sign Windows installers | accepted, no code yet | - | - | - |
| ADR-0013.D4 | Signed in-app updates via the Tauri updater plugin and release-hosted latest.json | accepted, no code yet | - | - | - |
| ADR-0013.D5 | Keep CI actions current with Dependabot for github-actions | accepted, no code yet | - | - | - |
| ADR-0014.D1 | Main window opens maximized and centered, 1280x800 restore size, 1024x640 minimum | accepted, no code yet | - | - | - |
| ADR-0015.D1 | Dev profile keeps line tables for our crate and drops debug info for dependencies | accepted, no code yet | - | - | - |
| ADR-0015.D2 | Developers share one CARGO_TARGET_DIR across git worktrees | accepted, no code yet | - | - | - |
| ADR-0016.D1 | Frontend is built with Tailwind and shadcn/ui from DESIGN.md tokens; approved frames are committed as the visual reference | accepted, no code yet | - | - | - |
| ADR-0016.D2 | App shell follows project-tree-shadcn (projects tree, chat, contextual right panel, status bar) (supersedes ADR-0009.D1) | accepted, no code yet | - | - | - |
| ADR-0016.D3 | Plan approval renders in the chat as a plan card per project-tree-plan-approve | accepted, no code yet | - | - | - |
| ADR-0016.D4 | Each sub-agent has a detail view per agent-detail, built from the event log | accepted, no code yet | - | - | - |
| ADR-0016.D5 | Settings is a full-width view per settings-teams; only sections backed by real data ship, persisted in SQLite | accepted, no code yet | - | - | - |
