---
adr: ADR-0020
decisions:
  D1:
    title: Send single-task chat messages as the user's text unchanged without the plan-task wrapper
    state: accepted
    paths: ["src-tauri/src/runner/**", "src-tauri/src/session/**", "src-tauri/src/db/**", "src-tauri/src/lib.rs", "src/features/session/**", "src/features/runner/**", "src/App.tsx"]
    protected: false
    use_cases: []
  D2:
    title: Add a per-session concise-replies setting that prepends a fixed instruction line when enabled
    state: accepted
    paths: ["src-tauri/src/runner/**", "src-tauri/src/session/**", "src-tauri/src/db/**", "src-tauri/src/lib.rs", "src/features/session/**", "src/features/runner/**", "src/App.tsx"]
    protected: false
    use_cases: []
---

# ADR-0020: Plain Chat Prompt and Concise Replies

## Context

The `Goal`/`Files`/`Worktree` wrapper in `src-tauri/src/runner/mod.rs:391-393` makes casual chat messages look like repository tasks. The worktree path is already the ACP session's `cwd`, so repeating it in a single-task chat prompt is unnecessary. There is no reply-length control.

## Decision

D1: **Plain single-task chat prompt.** A single-task chat message is sent to the agent as the user's text unchanged: no Goal/Files/Worktree wrapper. The wrapper remains for plans with more than one task or tasks that carry files (the orchestrator path); only the single-task chat message goes through unchanged.

This supersedes ADR-0017.D1's prompt construction only for single-task chat messages: its sentence about the prompt being built as goal/files/worktree does not apply to those messages. Multi-task plans and tasks that carry files continue to use the wrapper.

D2: **Per-session concise replies.** A session has a concise-replies setting, default off. When enabled, the runner prepends this fixed instruction line on its own line before the user text: `Keep replies short and direct. Do not describe the repository or your tools unless asked.`

## Considered Options

- **Always append an instruction.** Rejected: it changes user intent silently.
- **Set a system prompt at session/new.** Rejected: adapter support for appending a system prompt is unverified.
- **Global setting.** Rejected: the setting is per session.

## Consequences

- Single-task chat messages reach the agent byte for byte when concise replies are off.
- Multi-task plans and tasks that carry files keep the existing Goal/Files/Worktree wrapper.
- With concise replies on, the exact instruction line is prepended before the user text; with it off, nothing extra is sent.
- The setting is stored per session and survives restart.
- A follow-up message in the same session also receives the instruction line when concise replies are on.
- **Unverified.** Whether an agent actually obeys the concise-replies instruction requires a manual run against that agent.
- **Tests must prove:**
  - a single-task chat message reaches the agent byte for byte unchanged when concise replies are off
  - multi-task plans and tasks that carry files retain the wrapper
  - concise replies on prepends the exact instruction line on its own line before the user text, and off sends nothing extra
  - the concise-replies setting survives restart
  - a follow-up message in the same session receives the instruction line when concise replies are on
  - whether the agent obeys the instruction is recorded as unverified until manually checked
