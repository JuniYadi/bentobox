---
adr: ADR-0021
decisions:
  D1:
    title: Probe each ACP harness for its advertised model options on demand and cache the catalog per harness and binary version
    state: accepted
    paths: ["src-tauri/src/agent/**", "src-tauri/src/runner/**", "src-tauri/src/db/**", "src/features/agent/**"]
    protected: false
    use_cases: []
  D2:
    title: Persist a per-session model, apply it with session/set_config_option before the first prompt and when changed mid-session
    state: accepted
    paths: ["src-tauri/src/db/**", "src-tauri/src/session/**", "src-tauri/src/runner/**", "src-tauri/src/lib.rs", "src/features/session/**", "src/features/runner/**", "src/App.tsx"]
    protected: false
    use_cases: []
---

# ADR-0021: Per-Session Model Selection

## Context

The composer picker chooses only a harness; no model is listed, stored or sent. `CapabilityDescriptor.models` is `None`. ACP 5.6.1/schema 1.22.0 has no `models` field or `session/set_model`, so models exist only as `config_options` (category `model`) after `session/new` and are set with `session/set_config_option`, the same mechanism ADR-0018.D5 uses for the title session. The model list is needed before the first message.

## Decision

D1: **Probe each ACP harness for its advertised model options on demand and cache the catalog per harness and binary version.** Lazily probe when a harness is selected in the composer and provide a refresh action. Start the harness with its existing launch spec in a fresh temporary-directory cwd, initialize it, call `session/new`, read its Model-category option, flattening both Ungrouped and Grouped selections, then terminate the whole process group. A probe has a 90-second timeout. Report exactly one of `ready`, `unadvertised`, `auth_required`, `unavailable` or `timeout`. Cache only `ready` and `unadvertised` catalogs in `capability_cache` under `acp_models:<harness>:<version>`. Concurrent callers for a harness share one probe. Never hardcode model ids. The runner also refreshes this cache opportunistically after its own `session/new`. Claude and Codex adapters may download via npx on the first probe; the UI says so.

D2: **Persist a per-session model, apply it with `session/set_config_option` before the first prompt and when changed mid-session.** Store the selected model in nullable `sessions.model`; null means the agent default. Add migration v7 and provide `session_set_model` and `runner_set_model`. Before the first prompt, apply the requested model only if the live session advertised it. If the chosen model is not advertised, continue on the agent default and record an `agent_log` note. Emit `session_models` and `session_model_changed` events for advertised options and model changes. Changing harness clears the model. The title session in ADR-0018.D5 is independent of the user's model choice and retains its own cheap-model logic.

This decision supersedes nothing. It extends ADR-0018.D3/D5 and fills ADR-0001.D1's `models` capability field with observed data only.

## Considered Options

- **Option B: Static per-harness model lists.** Rejected: this violates “never hardcode model ids”; ids drift.
- **Option C: Eagerly create a session for every idle harness.** Rejected: it spawns heavy processes and conflicts with `MAX_RUNNING`.
- **Option D: Choose a model only after the first turn.** Rejected: the user cannot pick before turn 1.

## Consequences

- The model catalog reflects options advertised by the installed harness rather than a maintained list of assumed ids. Probing can be slow, especially when an npx adapter downloads on first use; the UI must communicate that possibility and render honest loading, empty and failure states without inventing model names.
- A selected model is scoped to its session, persists across restart, and is applied through the ACP config-option mechanism. A model unavailable to the live session does not prevent the task from running; the agent default remains in effect and the user-visible event log records the reason.
- Changing harness clears the saved model because a selection from one harness must not be applied to another.
- The title session remains independent and does not read or change `sessions.model`.
- **Unverified.** Exact config option ids per harness (Claude `model`, Codex `model`/`reasoning_effort`, OpenCode `model`/`effort`/`mode`) and probe duration/auth behavior for npx adapters.
- **Out of scope.** Effort/thought_level selection and `@harness/model:effort` routing in ADR-0012.
- **Tests must prove:**
  - probe parsing handles both Ungrouped and Grouped advertised options
  - a cache hit avoids spawning a process, refresh bypasses the cache, and concurrent requests use a single probe
  - status mapping includes `auth_required` and `timeout`, as well as the other defined statuses
  - migration v7 preserves existing session rows
  - `session_set_model` persists across reopen and errors for an unknown session id
  - a selected model is applied before the first prompt
  - an unadvertised or unknown model leaves the agent default active and logs the reason
  - `runner_set_model` rejects ids the live agent did not advertise
  - the title session ignores `sessions.model`
  - the UI shows honest empty states and never invents model names
