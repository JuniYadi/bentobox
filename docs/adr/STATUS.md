# Decision status

Generated file; change the ADRs or the code, then run the `status` command. Code lists files tagged `@adr`. Tests lists test files with a `[ADR-NNNN.Dn]` marker.

## default

| ID | Decision | Status | Use cases | Code | Tests |
|:--|:--|:--|:--|:--|:--|
| ADR-0001.D1 | Dual-transport ACP and native process adapters with Capability Registry | accepted, code and test present | - | `src-tauri/src/agent/mod.rs`<br>`src/features/agent/api.ts` | `src-tauri/src/agent/agent_test.rs` |
| ADR-0002.D1 | Strict separation of session usage and account quota with unavailable states | accepted, no code yet | - | - | - |
| ADR-0003.D1 | Configurable opt-in Git worktree isolation for parallel task execution | accepted, no code yet | - | - | - |
| ADR-0004.D1 | Agent-owned authentication lifecycle via native CLIs and system keychains | accepted, no code yet | - | - | - |
| ADR-0005.D1 | Embedded SQLite for session coordination, task graphs, and redacted event logs | accepted, code and test present | - | `src-tauri/src/db/mod.rs` | `src-tauri/src/db/db_test.rs` |
| ADR-0006.D1 | Tri-mode session architecture supporting orchestrator, plan, and build modes | accepted, code present, no test | - | `src/features/session/types.ts` | - |
| ADR-0007.D1 | Structured prompt handoff protocol with pointed file references and constraints | accepted, no code yet | - | - | - |
| ADR-0008.D1 | GitHub CLI integration for querying and browser-opening issues and pull requests | accepted, code present, no test | - | `src-tauri/src/github/mod.rs`<br>`src/features/github/GitHubPanel.tsx`<br>`src/features/github/api.ts` | - |
| ADR-0009.D1 | Three-column responsive desktop layout (Sidebar Left | Content | Sidebar Right) | accepted, code present, no test | - | `src/components/layout/ContentArea.tsx`<br>`src/components/layout/SidebarLeft.tsx`<br>`src/components/layout/SidebarRight.tsx`<br>`src/components/layout/ThreeColumnLayout.tsx` | - |
| ADR-0010.D1 | Orchestrator-only sessions; read-only orchestrator, sub-agents write in worktrees after plan approval (supersedes ADR-0006.D1) | accepted, no code yet | - | - | - |
| ADR-0011.D1 | Teams bind a role to an ordered harness/model:effort fallback chain | accepted, no code yet | - | - | - |
| ADR-0011.D2 | Teams are generated from detected subscriptions by user rules, previewed before apply | accepted, no code yet | - | - | - |
| ADR-0012.D1 | Inline per-message routing via @harness/model[:effort] or @team:name overrides the session team | accepted, no code yet | - | - | - |
| ADR-0013.D1 | GitHub Release-triggered multi-platform Tauri build pipeline with tag/version guard | proposed | - | - | - |
| ADR-0013.D2 | Sign and notarize macOS bundles with an Apple Developer ID | proposed | - | - | - |
| ADR-0013.D3 | Authenticode-sign Windows installers | proposed | - | - | - |
| ADR-0013.D4 | Signed in-app updates via the Tauri updater plugin and release-hosted latest.json | proposed | - | - | - |
| ADR-0013.D5 | Keep CI actions current with Dependabot for github-actions | proposed | - | - | - |
