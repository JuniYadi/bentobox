# BentoBox Domain Glossary

Ubiquitous language for the BentoBox cross-agent desktop coordination workspace.

## Language

### Core Entities

**Agent**:
An external automated coding assistant CLI or server process (such as Claude Code, OpenAI Codex, Oh My Pi, pi, or OpenCode).
_Avoid_: Bot, AI, worker

**Sub-Agent**:
A secondary agent session spawned and steered by an Orchestrator session to execute an isolated task, frequently running on cost-efficient or specialized harnesses.
_Avoid_: Child process, background worker, slave agent

**Session**:
A single continuous execution lifecycle of an agent in a designated workspace, communicating over ACP or a native process adapter.
_Avoid_: Thread, chat, instance

**Task**:
A discrete unit of work assigned to an agent session, organized into a hierarchical task board or dependency graph.
_Avoid_: Job, ticket, prompt

**Workspace**:
A local filesystem directory or repository where an agent session operates.
_Avoid_: Project, folder, directory

**Worktree**:
An isolated Git working tree linked to a parent repository, optionally allocated to an agent session to avoid branch and checkout conflicts.
_Avoid_: Branch, clone, sandbox

### Session Modes

**Session Mode**:
The active operating posture of an agent session, constrained to `orchestrator`, `plan`, or `build`.
_Avoid_: State, persona, role

**Orchestrator Mode**:
The default session posture that decomposes user goals, formulates plans, and delegates execution tasks to sub-agents across harnesses.
_Avoid_: Manager mode, supervisor mode

**Plan Mode**:
A non-mutating session posture dedicated to research, architectural design, and review without writing codebase edits.
_Avoid_: Read-only mode, design phase

**Build Mode**:
A direct implementation session posture where the active agent directly writes files, executes commands, and modifies the codebase.
_Avoid_: Coding mode, worker mode

### Protocol and Coordination

**Capability Registry**:
A structured record of verified features (transport, session lifecycle, permissions, history, usage) detected for a specific agent binary and version.
_Avoid_: Feature flags, plugin manifest

**Prompt Handoff**:
A structured context envelope delivered from an Orchestrator to a Sub-Agent containing goals, boundary constraints, referenced files, and acceptance tests.
_Avoid_: Memory transfer, chat sync, prompt injection

**Approval Request**:
An explicit prompt routed from an agent seeking human authorization for a filesystem, terminal, or network action.
_Avoid_: Confirmation, permission popup, sandbox prompt

### Telemetry and External Systems

**Session Usage**:
Volumetric metrics (token count, context window fill) reported directly by an active agent session for that specific run.
_Avoid_: Quota, balance, allowance

**Account Quota**:
Provider-level subscription allowances, rate limits, monetary balance, and billing reset intervals provided by an external vendor account.
_Avoid_: Token usage, context size

**GitHub Integration**:
A system bridge backed by the GitHub CLI (`gh`) for inspecting issues and pull requests, opening them in the browser, and binding them to workspace tasks.
_Avoid_: Octokit client, web scraper
