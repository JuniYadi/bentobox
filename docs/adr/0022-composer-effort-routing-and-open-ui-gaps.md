---
adr: ADR-0022
decisions:
  D1:
    title: Read effort (thought level) options by category and let the user pick one per session
    state: proposed
    paths: ["src-tauri/src/agent/**", "src-tauri/src/runner/**", "src-tauri/src/db/**", "src-tauri/src/session/**", "src-tauri/src/lib.rs", "src/features/agent/**", "src/features/session/**", "src/features/runner/**", "src/App.tsx"]
    protected: false
    use_cases: []
  D2:
    title: Resolve inline @harness/model:effort routes in the composer against the probed catalogs
    state: proposed
    paths: ["src/features/session/**", "src/App.tsx"]
    protected: false
    use_cases: []
  D3:
    title: Read mode options from mode-category config options when the agent advertises no session modes
    state: proposed
    paths: ["src-tauri/src/runner/**", "src/App.tsx", "src/features/session/**"]
    protected: false
    use_cases: []
---

# ADR-0022: Composer Effort Routing and Open UI Gaps

## Context

The design frames show an `@harness/model:effort` route in the composer and an effort control. ACP exposes `thought_level` as a config-option category. ADR-0021 deliberately left effort selection and effort routing out of scope while adding model catalogs and per-session model selection.

## Decision

D1: **Read effort (thought level) options by category and let the user pick one per session.** Extend the on-demand probe to read the config option with category `thought_level` and return its advertised options in the same catalog as models. Codex advertises `reasoning_effort` and OpenCode advertises `effort`; this is unverified for Claude and omp. Store the selection in nullable `sessions.effort` with migration v8. Apply it using `session/set_config_option` before the first prompt and when changed. Use the same honest states as the model picker. Never hardcode option values or ids; locate the option by category. The title session ignores `sessions.effort`.

D2: **Resolve inline `@harness/model:effort` routes in the composer against the probed catalogs.** This extends ADR-0012.D1 and depends on D1. The composer lists detected harnesses and their advertised options and shows a route chip. An unknown harness, model or effort is an error shown before sending; it is never silently dropped. `@team:` routes remain out of scope until ADR-0011 has code.

D3: **Read mode options from mode-category config options when the agent advertises no session modes.** This extends ADR-0018.D3. OpenCode is reported to advertise mode as a config option, but that is unverified. The first task is to confirm it against a real OpenCode before accepting this decision. Apply the same rule as ADR-0018.D3: never select `bypassPermissions` automatically.

## Considered Options

- **Hardcode effort levels.** Rejected: ids drift, for the same reason as ADR-0021's rejection of hardcoded model ids.
- **Fold effort into the model option.** Rejected: agents advertise effort separately from model.

## Consequences

- Effort and routing choices come only from detected harnesses and advertised options; unavailable or unknown routes are visible errors rather than silently changed prompts.
- **Unverified.** Effort option ids and values for Claude and omp, and the reported OpenCode mode config option, require manual confirmation against real harnesses.
- **Tests must prove:**
  - D1 tests with the fake ACP agent locate thought-level options by category, preserve advertised values, persist nullable effort through migration v8, apply it before the first prompt and on change, render honest statuses, and keep it out of the title session
  - D2 tests with the fake ACP agent list detected harnesses and advertised model/effort choices, render the route chip, show unknown harness/model/effort errors before sending, never silently drop a route, and leave `@team:` routing out of scope
  - D3 tests with the fake ACP agent read mode-category options only when session modes are absent and never select `bypassPermissions` automatically

## Open tasks (no decision yet)

- Harness menu footer actions “Set as project default” and “Manage teams…” and the sidebar Teams block: blocked until ADR-0011 teams have code.
- Sidebar project avatar and branch/summary metadata shown in the frame: needs a data source decision.
- Empty state for a new session chat: no approved frame defines it, so draw a frame first (ADR-0016.D1).
- Status bar context usage such as “1,840 / 200k ctx” instead of “0 tokens”: needs a data source (ADR-0002 usage); ACP `usage_update` is recorded only when the agent reports it, so never invent numbers.
- Manual runs against real harnesses, to be recorded in the PR or an ADR Unverified update: verify Claude `acceptEdits`/`auto` really stop Bash prompts (ADR-0018.D3); real model, effort and mode option ids and probe duration for Claude, Codex, OpenCode and omp, including npx first-run download time (ADR-0021); whether the concise line is obeyed (ADR-0020.D2); and whether a second concurrent ACP session on one process works for the title session (ADR-0018.D5).
