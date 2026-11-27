# AI Bot Teams Desktop App — Product Requirements Document

**Status:** Proposal; integrations and vendor capabilities require validation before implementation.  
**Product:** Cross-provider desktop workspace for coordinating coding agents  
**Platform:** Tauri desktop application

## 1. Summary

Build a desktop application that lets developers run and coordinate Claude Code, OpenAI Codex, Oh My Pi (`omp`), pi, and OpenCode from a unified workspace. The app uses the Agent Client Protocol (ACP) where a compatible agent provides it, and provider/tool-specific adapters or native command-line processes otherwise. It presents sessions, workspaces, agent activity, permissions, and usage information without implying that ACP provides subscription or account quota data.

The product is an orchestration and visibility layer, not a replacement for the agents' own models, credentials, policies, or safety mechanisms. Integration and feature availability vary by agent and version.

## 2. Problem and goals

Developers working across coding agents lack a single desktop view for starting work, comparing agent capabilities, coordinating independent tasks, reviewing changes, and understanding what usage information is actually available. A common UI should reduce operational friction while preserving each agent's native behavior and security boundaries.

### Goals

- Launch and manage supported agents from one Tauri desktop application.
- Provide consistent session, task, and workspace views over ACP and explicitly documented adapters.
- Support parallel work with clear repository/worktree isolation and reviewable outputs.
- Show trustworthy session/context usage when an agent reports it, and clearly distinguish it from provider-account quota.
- Make permissions, approvals, authentication ownership, and integration limitations visible.

### Non-goals

- Reimplement agent reasoning, model APIs, vendor authentication, or agent-native permission systems.
- Promise equivalent capabilities across all agents or support every CLI command in the first release.
- Infer or estimate account quota, remaining subscription allowance, billing, or reset times from token counts, model limits, or activity.
- Silently bypass approval policies or sandbox restrictions.

## 3. Target users and core workflows

**Primary user:** software developer using multiple coding agents locally, often across repositories and parallel tasks.

1. **Connect an agent:** select an installed supported agent, inspect detected version/capabilities, authenticate through that agent's documented flow, then confirm workspace access and permissions.
2. **Start a task:** select repository/worktree, choose agent, enter task, review effective permission/sandbox mode, and start a session. The UI identifies whether the connection is ACP-native or adapter-backed.
3. **Coordinate work:** create a parent task with independent subtasks assigned to different agent sessions; observe status and outputs; provide explicit handoffs; review conflicts before merging changes.
4. **Inspect and resume:** reopen session history where supported, inspect tool/activity events and changed files, and resume through the agent's supported session mechanism. Unsupported resume is shown as unavailable, not simulated.
5. **Review usage:** inspect reported session/context usage when supported. Account subscription quota is shown only when a verified provider-specific integration supplies authoritative structured data; otherwise display **Unavailable**.
6. **Approve actions:** respond to tool/file/terminal permission requests in context, with clear scope and persistent indication of granted access.

## 4. Product requirements

### 4.1 Agent integrations

A capability registry shall record per agent and detected version: transport (ACP/native adapter), launch/configuration method, session lifecycle, event support, tool permission support, cancellation, resume/history, usage/context reporting, and known limitations. Capabilities must be discovered or declared per integration rather than assumed uniformly. An unsupported capability is disabled or labeled unavailable.

| Agent | Integration approach | Product requirement / caveat |
|---|---|---|
| Claude Code | ACP if a supported Claude ACP server/bridge is available; otherwise documented Claude Code command/adapter integration | Do not assume ACP exposes account quota. Do not claim ACP forwards Claude SDK usage fields until verified against the actual server and versions. |
| OpenAI Codex | ACP-compatible implementation where available; otherwise documented Codex CLI/native command integration | Authentication and features are owned by the installed Codex tooling; detect actual supported capabilities. |
| Oh My Pi (`omp`) | ACP where supported; otherwise `omp` native command integration | Preserve omp's own agent/model configuration; do not infer capabilities from other ACP clients. |
| pi | ACP where supported; otherwise pi native command integration | Treat extensions and provider configuration as installation-specific; surface detected support only. |
| OpenCode | ACP where supported; otherwise OpenCode native command integration | Preserve its provider/model and permission behavior; show unsupported operations explicitly. |

The table describes integration strategies, not a claim that every named agent currently ships an ACP server or exposes all listed functions. Before implementation, validate current official docs and release/version support. The app must not bundle an undocumented protocol shim while presenting it as native ACP.

### 4.2 Usage and quota semantics

The UI and data model must distinguish:

- **Session/context usage:** per-session input/output tokens, context-window occupancy, or other usage values actually reported by an agent. Values carry source, timestamp, units, and support status. Context-window occupancy is not subscription quota.
- **Provider account quota:** remaining subscription/API allowance, rate limits, billing balance, and reset time. These are separate provider account facts, not derivable from ACP session events or token counts.

ACP does not guarantee account quota reporting. If no authoritative integration reports a field, display **Unavailable** (with an optional concise reason such as “not provided by this agent”), never an estimated percentage, extrapolation, or fabricated reset time. Do not treat absence as zero.

Claude Code's Claude Agent SDK documents an experimental structured `/usage` report. It may provide richer usage information through the SDK, but it is not a general ACP guarantee or proof of account-quota availability. Availability and meaning can depend on SDK/CLI version, authentication mode, and provider/account path. Mark the feature experimental, version-gate it, capture provenance, and only expose fields whose semantics are documented and verified for the active combination. Whether a Claude ACP server forwards the SDK's structured usage event/data is **unverified**; do not claim or depend on forwarding until tested against named server and client versions. If optional integration is not configured or cannot authenticate, show the relevant fields as unavailable.

Provider-specific usage integrations are optional, isolated additions. They must use official, authorized interfaces, disclose required scopes/credentials, handle unsupported auth/version combinations as unavailable, and never block core agent sessions. Do not scrape private endpoints or request credentials outside the provider's documented flow.

### 4.3 Coordination and workspace isolation

- Support a task board/tree with queued, running, waiting-for-approval, completed, failed, and cancelled states; each item links to its agent session and workspace.
- Allow explicit handoff of user-approved task context and results between sessions. Do not silently share secrets, full conversation histories, or credentials across agents.
- Parallel changes to one repository must use separate git worktrees or another explicit isolated checkout. Show branch/path ownership and prevent accidental concurrent writes into a shared working tree when isolation is requested.
- Worktree creation, cleanup, branch naming, uncommitted user changes, and merge/rebase actions require transparent status and safeguards. Never discard or overwrite user changes automatically.
- A user can inspect diffs and decide how to integrate results. Coordination is not a guarantee that agents' changes compose or pass tests.

### 4.4 Permissions and sandboxing

- Display the effective agent permission mode and any app-level workspace boundary before launch and during the session.
- Preserve native agent confirmation and sandbox behavior; route approval requests without weakening them. Where native ACP permission requests are unavailable, the UI must not imply that an app prompt enforces an equivalent sandbox.
- Make filesystem, terminal, network, and external-tool access explicit where the integration exposes it. Do not claim to restrict a process more tightly than the OS/agent configuration actually does.
- Treat agent output, repository content, and tool results as untrusted input. Keep credentials in OS-protected storage where practical; never include them in task handoffs, logs, or telemetry.

### 4.5 Authentication

Authentication remains owned by the relevant agent/provider unless a documented provider integration is explicitly enabled. Prefer launching the tool's official login/device flow and avoid copying credentials into application settings. Detect and explain missing/expired authentication where the tool exposes a reliable signal; otherwise link to the agent's own troubleshooting. Never claim a single sign-on session is shared across agents. Optional quota integrations must clearly describe additional authentication and permissions separately from agent authentication.

### 4.6 Architecture

- **Tauri shell:** native desktop lifecycle, OS integrations, and a narrowly scoped Rust backend; frontend consumes typed application commands/events.
- **Integration manager:** discovers configured executables and versions, starts/stops child processes, tracks health, and maps only supported features into a normalized capability description.
- **ACP transport:** protocol client for compatible agents, with session/event handling and protocol permission requests. ACP is a transport/interface, not a provider quota authority.
- **Native adapters:** per-agent process/command adapters for agents or functions not available through ACP. Each adapter declares its supported operations and owns version-sensitive parsing; no universal fake ACP feature layer.
- **Session and coordination service:** session metadata, task dependencies, explicit context handoffs, workspace association, and event provenance. Persist locally with clear retention controls.
- **Workspace service:** repository detection and isolated worktree operations with non-destructive defaults and explicit user confirmation for risky git operations.
- **Usage service:** typed, provenance-bearing session/context usage from agent reports; separate optional provider account connectors. Missing data remains unavailable.
- **Frontend:** agent/session/task views, approval surfaces, capability and limitation indicators, diffs, and usage distinctions.

All cross-boundary data should be typed and versioned. Process execution and filesystem access should be constrained to user-selected workspaces and documented integration requirements. Diagnostic logs must redact secrets and make retention configurable.

### 4.7 Distribution and operations

Package desktop builds using Tauri's supported signing/notarization and platform packaging paths for the initially selected operating systems. The app depends on separately installed agent CLIs unless a specific distribution agreement and technical design supports bundling them; it must clearly report missing executables and supported version ranges. Provide signed updates through a trusted channel, disclose platform permissions, and document that third-party agent/provider terms and availability apply. Keep update and telemetry behavior opt-in/transparent; no task content or credentials in telemetry.

## 5. Acceptance criteria

1. A user can discover a supported installed agent, see its detected version and integration type, launch a session in a selected workspace, and see clear failure feedback when unavailable.
2. The app reports per-agent capabilities and never presents unsupported ACP/native operations as available.
3. Users can manage task status and hand off selected context explicitly across sessions; parallel repository tasks can use separate worktrees without writing into one shared checkout.
4. Permission requests and effective integration permission mode are visible; the application does not claim an app-level prompt replaces an agent/OS sandbox.
5. Session/context metrics are labeled distinctly from provider account quota and include provenance/time when reported.
6. With no verified quota source, quota fields show **Unavailable**, never an estimate or inferred zero.
7. The Claude SDK experimental `/usage` path is optional and version/auth-aware; tests or validation must establish the precise supported combinations. UI and documentation explicitly state that Claude ACP structured quota forwarding is unverified until demonstrated for named versions.
8. Optional provider quota connectors can be absent or fail without preventing normal agent sessions; unsupported credentials/version/interface yields unavailable data.
9. Authentication stays within documented agent/provider flows; secrets are not exposed in logs or cross-agent task handoffs.
10. Users can inspect outputs/diffs and no worktree cleanup, merge, or destructive repository action silently removes user data.
11. Distribution documentation identifies supported OS/agent versions, installation prerequisites, signing/update approach, and third-party dependencies.

## 6. Open questions / validation before build

- Which OS platforms and minimum versions are in the initial release?
- For each agent/version, what official ACP server or native CLI interface is currently supported, and which lifecycle/events/permission features are exposed?
- Does any Claude ACP server forward Claude SDK's experimental structured `/usage` data, under which authentication modes and versions? This is presently unverified.
- Which provider account-quota interfaces are official, authorized, and sufficiently stable to support as optional connectors?
- Which local persistence, retention, telemetry, and update defaults meet product and privacy expectations?
- Which sandbox guarantees are available on each target OS and integration, beyond the agent's own controls?

## 7. Source links

These are primary project/protocol documentation starting points, not evidence that every integration or capability listed above is available in every version. Validate live documentation and exact version behavior during technical discovery.

- Agent Client Protocol: https://agentclientprotocol.com/
- ACP GitHub specification: https://github.com/agentclientprotocol/agent-client-protocol
- Tauri documentation: https://tauri.app/
- Claude Agent SDK documentation: https://docs.anthropic.com/en/docs/claude-code/sdk
- Claude Code documentation: https://docs.anthropic.com/en/docs/claude-code/overview
- OpenAI Codex documentation: https://developers.openai.com/codex/
- Oh My Pi (`omp`) project: https://github.com/can1357/oh-my-pi
- pi project: https://github.com/badlogic/pi-mono
- OpenCode documentation: https://opencode.ai/docs/
