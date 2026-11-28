---
adr: ADR-0018
decisions:
  D1:
    title: Composer Send starts a one-task run directly; plan approval remains for orchestrated multi-task plans
    state: accepted
    paths: ["src/features/session/**", "src/App.tsx"]
    protected: false
    use_cases: []
  D2:
    title: Keep the ACP session alive across turns and send each new message as a prompt on that session
    state: accepted
    paths: ["src-tauri/src/runner/**", "src-tauri/src/session/**", "src/features/session/**", "src/features/runner/**"]
    protected: false
    use_cases: []
  D3:
    title: Choose an advertised ACP session mode by policy and expose user mode selection and session-scoped permission grants
    state: accepted
    paths: ["src-tauri/src/runner/**", "src/features/agent-detail/**", "src/features/session/**", "src/features/runner/**"]
    protected: false
    use_cases: []
  D4:
    title: Show conversation and pending permission requests in chat and group other events under Activity
    state: accepted
    paths: ["src/features/agent-detail/**", "src/features/runner/**", "src/App.tsx", "src-tauri/src/runner/**"]
    protected: false
    use_cases: []
  D5:
    title: Generate the session title in the background with a cheap model chosen from the harness's advertised models
    state: accepted
    paths: ["src-tauri/src/runner/**", "src-tauri/src/session/**", "src/features/session/**", "src/features/runner/**", "src/App.tsx"]
    protected: false
    use_cases: []
---

# ADR-0018: Chat-First Agent Sessions with a Dynamic Permission Policy

## Context

ADR-0017.D4 makes every composer message a one-task plan that must pass through PlanCard approval. ADR-0010's approval gate was intended for orchestrated plans, but this path makes a direct conversation feel like plan authoring. After one `end_turn`, the task enters `review`; the current Steer control queues another prompt rather than offering a normal next message. The main Chat does not load events, while AgentDetailView contains the agent reply and activity.

ACP permission requests currently block the agent until the user answers. Every `session/request_permission` becomes a card, and only AllowOnce and RejectOnce are mapped. With an adapter that asks for shell permission, an ordinary explanatory question can produce repeated permission cards and tool activity before any reply. The ACP protocol advertises session modes; the client must use modes actually returned by the agent rather than assume support.

## Decision

D1: **Direct start.** Composer Send in a session with a chosen harness proposes, approves and starts a one-task run in one step. It has no PlanCard approval. The first message starts the agent. The PlanCard approval gate remains for multi-task plans proposed by an orchestrator.

This supersedes ADR-0017.D4's sentence, “With the composer's picker set to a harness, Send creates a plan with one task: the typed text as the goal, that harness, the worktree switch value, and no dependencies. It lands in the Plan phase for the user to approve.” The one-task-plan note in ADR-0010.D1 Consequences, “Small direct edits now go through a one-task plan or Take over,” is superseded only as to the one-task-plan route: direct composer messages start without approval. These accepted decisions remain intact as historical records; this ADR records the superseding decisions.

D2: **Multi-turn session.** After `end_turn`, the ACP process and session stay alive. The composer sends the next `session/prompt` as a normal message on the same session. Steer as a separate queued control is replaced by this conversation flow. The task still moves to `review` after each `end_turn` and to `running` for the next turn. Stop, session close or app exit ends the process, as specified by ADR-0017.D1.

D3: **Permission policy.** After `session/new`, the runner reads `modes` from the response and calls `session/set_mode`. The initial choice is the first advertised mode in this order: `auto`, `acceptEdits`, then `default`. BentoBox never selects `bypassPermissions` automatically. The choice always comes from the advertised mode list, not a per-harness assumption. If the agent advertises no modes, permission behavior is unchanged and every request prompts.

A composer mode picker lets the user change mode with `session/set_mode`. A permission card has an “Always allow” action, sent as `AllowAlways` only when the agent offers that option and scoped to that session. Remove the unused “View diff” action. Routine edits within the worktree should not prompt in the selected modes; shell commands and other operations still prompt when requested by the agent. The permission card appears inline only while the request is pending.

The reported mode ids and the claim that `acceptEdits` or `auto` stop Claude Bash prompts are **unverified** until a manual run against a real Claude agent is recorded. Codex and opencode modes are also unchecked.

D4: **Quiet main chat.** The main Chat loads events and refreshes them incrementally. It shows user messages, `agent_message` text, and a permission card only while a request is pending. Other events—`tool_call`, `agent_thought`, `agent_log`, `task_state`, `handoff`, resolved permissions and sub-agent items—collapse into one expandable “Activity” row. AgentDetailView and the right panel remain the inspector. Sub-agent and background tool-call event payloads carry `parent_tool_call_id` so the UI can group them; this extends the payload keys in ADR-0017.D3.

D5: **Generated session title.** When the first message of a session is sent, the runner generates a short title in the background and stores it as the session title. Until it arrives, the sidebar shows the first message, truncated. A title the user typed is never overwritten.

Generation runs in its own short-lived ACP session (a second `session/new` on the same agent process), not in the chat session, so the title prompt and reply never enter the conversation or the chat event log. It is one prompt: the user's message plus an instruction to answer with a plain-text title of at most 6 words. The runner strips quotes and line breaks and cuts the result at 60 characters. Every permission request in the title session is answered `cancelled`, and the session is closed after its first `end_turn`.

The model comes from the `config_options` the agent returns for the title session: the option in the `model` category. The runner matches its values by id or name, applies the match with `session/set_config_option` on the title session only, and never hardcodes a model id:

| Harness | Model used for the title |
|:--|:--|
| Claude Code | an advertised model whose id or name contains `haiku` |
| Codex | an advertised model whose id or name contains `luna` |
| OpenCode | an advertised model whose id, name or description contains `free`, when one exists |
| Any other harness, or no match | the model the main chat session is currently using |

The harness is the one chosen for the session. The title call never starts another harness or spends another account's quota. If the agent advertises no model selection, the title session uses the agent's default model. If title generation fails or takes longer than 30 seconds, the truncated first message stays as the title. It is not retried, and no error is shown to the user. Token usage is recorded only when the agent reports it (ADR-0002.D1).

ACP schema 1.22.0 and SDK 5.6.1 have no `models` field in `session/new` and no `session/set_model`, so model selection goes through `config_options` and `session/set_config_option`. If the agent advertises no model option, or no value matches, the title session keeps the agent's current model. The `haiku` and `luna` name matches, the `free` marker for OpenCode, and whether Claude and Codex allow a second session on one process are **unverified** until a manual run against the real agents is recorded.

## Considered Options
- **Keep approval for every message.** Rejected: direct conversation is not plan authoring.
- **Select `bypassPermissions` by default.** Rejected: this removes the only boundary described by ADR-0017.D2's Honest limit.
- **Always prompt.** Rejected: it preserves current behavior, which makes ordinary chat unusable.
- **Title from the first N characters of the message.** Rejected: titles are often unreadable, such as "hai, explain this".
- **Generate the title with the main chat model.** Rejected: a throwaway call should not cost a full-size model. It remains the fallback.
- **Generate the title with a different harness than the session's.** Rejected: it starts another process and spends another account's quota without the user asking.
- **Hardcode model ids per harness.** Rejected: ids change between releases. The runner matches against what the agent advertises.

## Consequences
- The first message starts a run directly; multi-task orchestration still requires plan approval.
- Task transition must allow `review -> running` for a subsequent turn. The current `session_task_transition` does not allow this transition, so implementation must add it.
- The runner owns the ACP process for the full session lifetime, not just one task prompt.
- The worktree boundary still relies on agent permission prompts. Never choosing `bypassPermissions` is required to preserve that boundary.
- A title session costs one extra `session/new` and one prompt per chat session. It runs off the chat's critical path, so the first reply is not delayed.
- Whether an adapter allows a second concurrent session on one process is unchecked. If it does not, title generation falls back to the truncated first message.
- **Unverified.** Mode ids, mode selection behavior and Claude adapter permission behavior require a manual run against a real Claude agent. Codex and opencode modes are unchecked.
- **Out of scope.** ADR-0017's “ACP orchestrator chat” remains out of scope and unchanged.
- **Tests must prove:**
  - the default mode is chosen from the advertised list in the order `auto`, `acceptEdits`, `default`, and `bypassPermissions` is never chosen automatically
  - an agent with no modes still produces permission prompts
  - `AllowAlways` is sent only when offered
  - a second message reuses the same ACP session
  - the quiet chat partition shows only user messages, agent messages and pending permission requests in the main stream
  - for each harness, the title model is picked from the advertised list (`haiku`, `luna`, a free model), and any other harness or a missing match falls back to the main chat's current model
  - the title prompt and reply do not appear in the chat event log
  - a title the user typed is not overwritten by the generated one
  - a failed or timed-out title call keeps the truncated first message as the title
