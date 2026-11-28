---
adr: ADR-0017
decisions:
  D1:
    title: The backend runs each approved plan task as an ACP agent process in the task's worktree, using the official agent-client-protocol crate
    state: proposed
    paths: ["src-tauri/src/runner/**"]
    protected: false
    use_cases: []
  D2:
    title: Allow and Deny answer session/request_permission, Stop cancels the turn, Steer queues a prompt; Pause and Take over stay disabled
    state: proposed
    paths: ["src-tauri/src/runner/**", "src/features/agent-detail/**"]
    protected: false
    use_cases: []
  D3:
    title: Every agent update is appended to the event log in the shape the agent detail view reads, and the UI refreshes on a Tauri notification
    state: proposed
    paths: ["src-tauri/src/runner/**", "src/features/runner/**"]
    protected: false
    use_cases: []
  D4:
    title: Composer Send creates a one-task plan for the chosen harness, so a user can start an agent without an orchestrator
    state: proposed
    paths: ["src/features/session/**"]
    protected: false
    use_cases: []
---

# ADR-0017: Run Agents over ACP

## Context
ADR-0001 chose a dual-transport design with a Capability Registry. ADR-0010 chose a plan approval gate, after which sub-agents write in worktrees (ADR-0003). ADR-0016 shipped the screens for that flow. No code starts an agent yet.
- `src-tauri/src/agent/mod.rs` only detects harnesses with `<exe> --version`. It never spawns a long-lived process, and `Cargo.toml` has no async runtime or ACP crate.
- Approving a plan only sets `phase = Approve`. Nothing moves a task to `running`, so `tasks_started` never becomes true.
- The agent detail view reads events that nothing writes. Its Pause, Stop, Take over, Allow, Deny and Steer controls are disabled "until a decision covers agent execution" (ADR-0016.D4). This ADR is that decision.
- Nothing in the UI creates a plan. The composer's Send is disabled, and the orchestrator that would propose plans does not exist.

Facts the decisions rely on, from the ACP spec (agentclientprotocol.com, protocol v1) and each project's docs, checked 2026-11-28:
- ACP is JSON-RPC 2.0 over stdio, one JSON message per line. stdout carries protocol only.
- The client calls `initialize`, `authenticate` (when the agent lists auth methods), `session/new` (absolute `cwd`), `session/prompt` and `session/cancel`.
- The agent calls `session/request_permission` and streams `session/update`. A prompt ends with a stop reason: `end_turn`, `max_tokens`, `max_turn_requests`, `refusal` or `cancelled`.
- `fs/*` and `terminal/*` are optional client capabilities. Claude, Codex and OpenCode do not call them, and `omp` falls back to local execution.
- On `session/cancel`, the client must answer every pending permission request with `cancelled`.
- Launch commands:

| Harness | Command | Kind |
|:--|:--|:--|
| Oh My Pi | `omp acp` | native |
| OpenCode | `opencode acp` | native |
| Claude Code | `npx -y @agentclientprotocol/claude-agent-acp` | adapter |
| Codex | `npx -y @agentclientprotocol/codex-acp` | adapter |

- Crate: `agent-client-protocol` 5.6.1 on crates.io (Apache-2.0, Rust 1.88 or newer).

## Decision
D1: **Runner.** A new `runner` module in the Rust backend starts approved plan tasks.
- **Start.** After `approve`, the runner starts every `queued` task whose dependencies are `completed`, in its worktree (ADR-0003), up to 3 at once. The limit is a fixed constant; a user setting needs its own decision (ADR-0016.D5 rule).
  - It moves the task `queued -> running` through the existing `session_task_transition`.
  - It creates the worktree, spawns the harness, and runs `initialize`, `session/new` with the absolute worktree path as `cwd` and `mcpServers: []`, then `session/prompt`.
  - The prompt is the ADR-0007 handoff built from the plan task.
- **Client.** ACP is spoken with the official `agent-client-protocol` crate, with tokio added to bridge `tokio::process` stdio. No hand-rolled JSON-RPC.
- **Launch table.** The Capability Registry gains the launch command per harness from the table above. `omp` and `claude` and `codex` move to transport `Acp`. `pi` stays `NativeProcess` and is not runnable. After `initialize`, the registry records the `agentCapabilities` the agent actually returned. It does not guess features (ADR-0001.D1).
- **Adapters.** Claude and Codex run through `npx`. They count as available only when `npx` resolves, and the UI says that an adapter downloads on first use.
- **Auth.** Auth stays agent-owned (ADR-0004). If `initialize` lists auth methods and the agent cannot start without them, the task fails with the agent's message and `payload.reason = "authentication_required"`. BentoBox does not store credentials.
- **Outcome.** When the prompt returns:

| Stop reason or exit | Task status |
|:--|:--|
| `end_turn` | `review` |
| `cancelled` | `cancelled` |
| `max_tokens`, `max_turn_requests`, `refusal` | `failed`, reason recorded |
| process exit, protocol error or timeout | `failed`, reason recorded |

  Completing review is out of scope here. Acceptance commands are not run.
- **Process lifetime.**
  - The runner keeps a registry of children.
  - It drains stderr into the event log as `agent_log`, which is redacted like every event.
  - It closes stdin, waits briefly, then kills the process group on Stop, task end and app exit (`RunEvent::Exit`).
  - On startup, any task still `running` with no process is set to `failed` with reason `interrupted`.
- **Capabilities advertised.** The client advertises no `fs` and no `terminal`. Agents run their own tools inside the worktree.

D2: **Controls.** The agent detail controls become real where ACP supports them.
- **Allow, Deny.** A `session/request_permission` becomes a `permission_request` event, and the agent's turn stays blocked. Allow and Deny send the matching `allow_once` or `reject_once` option. If an agent offers no such option, the control stays disabled with that reason. The reader loop never waits on the UI.
- **Stop.** Sends `session/cancel` and answers every pending permission with `cancelled`, as the spec requires. If the process has not ended after a grace period, it is killed. The task becomes `cancelled`.
- **Steer.** ACP forbids two prompts at once on a session, so a steering message is queued and sent as the next `session/prompt` when the current turn ends. The composer says it is queued.
- **Pause and Take over.** ACP has no pause method, and Take over (ADR-0010) is a different editing flow. Both stay disabled with their reason.
- **Honest limit.** Agents write files themselves, so BentoBox cannot enforce ADR-0010's "sub-agent writes only inside its worktree". It sets `cwd` to the worktree and relies on the agent's own permission prompts. This is a gap against ADR-0010.D1's backend-enforced boundary and is stated in the UI help text.

D3: **Events and refresh.** The runner appends events with kinds and payload keys that `src/features/agent-detail/timeline.ts` already reads:
- `handoff` (the ADR-0007 payload), `tool_call` (`tool`, `target`, `output`), `permission_request` (`operation`, `target`, `request_id`), `file_changed` (`path`, `additions`, `deletions`, from the agent's diff updates when it sends them), `agent_message`, `agent_thought`, `agent_log` and `task_state`.
- Every payload carries `plan_task_id` (string) and, once the worktree exists, `branch`.
- `events.task_id` stays null. No `tasks` rows are created. The attribution rule from ADR-0016.D4 is the only link.
- Agent token reports (ACP `usage_update`) are recorded through `usage::record` only when the agent reports them (ADR-0002.D1). Otherwise usage stays unavailable and the UI says so.
- After each append the backend emits a Tauri event `runner:event` with `{ sessionId, eventId }`. The UI refetches events after the last id it holds, and re-reads the plan on `task_state`. The event log stays the source of truth.

D4: **One-task plan from the composer.** ADR-0010's Consequences already say small edits go through a one-task plan. With the composer's picker set to a harness, Send creates a plan with one task: the typed text as the goal, that harness, the worktree switch value, and no dependencies. It lands in the Plan phase for the user to approve. Without a selected harness, Send stays disabled with the reason.

## Considered Options
- **Hand-rolled JSON-RPC.** About 500 to 900 lines of framing, id routing and cancellation, with deadlock risk on permission requests. The crate gives typed v1 schema and bidirectional routing.
- **Terminal scraping for CLI agents.** Rejected by ADR-0001.
- **ACP orchestrator chat in this slice.** Not chosen by the user for the first slice. D4 gives a path to run an agent without it.
- **Auto-complete tasks at `end_turn`.** Rejected: ADR-0010 has a Review phase.

## Consequences
- **Dependencies.** `agent-client-protocol`, tokio (process, io-util, sync) and `tokio-util` compat. The crate needs Rust 1.88 or newer; the repo's toolchain must be checked before building.
- **Handoff gap.** ADR-0007's renderer validates `goal`, `non_goals`, `constraints`, `acceptance_commands` and `files`. A `PlanTask` carries a title and optional files only. The first build step reads the validation. If empty lists are rejected, the one-task plan must supply fixed text, and any change to the ADR-0007 renderer needs its own decision.
- **Unverified.** Adapter behaviour for Claude and Codex on this machine, `omp acp` and `opencode acp` versions, and whether each agent sends diff updates for `file_changed`.
- **Out of scope.** ACP orchestrator and plan generation, running acceptance commands, review completion, Pause, Take over, teams and fallback (ADR-0011), routing (ADR-0012), `session/load` resume, any user setting for concurrency.
- **Tests must prove:**
  - with a scripted fake ACP agent (a test binary speaking newline-delimited JSON), the handshake runs in order and the prompt reaches `end_turn`
  - the task moves `queued -> running -> review`, and the runner does not start a task before its dependencies are completed
  - a task never starts before approval
  - `cwd` is the absolute worktree path
  - a permission request is answered by Allow, and by Stop with `cancelled`
  - Stop ends the process and sets `cancelled`
  - a killed or crashed agent sets `failed`, and startup marks orphaned `running` tasks `failed`
  - events carry `plan_task_id`, and `timeline.ts` attributes them to the right task
  - unreported usage is not written as 0
  - stdout noise that is not JSON does not crash the reader
  - a manual run against a real agent (`omp acp`, then the others) is recorded in the PR
