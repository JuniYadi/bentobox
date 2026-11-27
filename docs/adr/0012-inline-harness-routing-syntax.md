---
adr: ADR-0012
decisions:
  D1:
    title: Inline per-message routing via @harness/model[:effort] or @team:name overrides the session team
    state: proposed
    paths: ["src/features/routing/**", "src-tauri/src/routing/**"]
    protected: false
    use_cases: []
---

# ADR-0012: Inline Harness Routing Syntax

## Context
Users sometimes know which harness should handle a task, for example "this one goes to Codex at high effort". Opening settings or changing the session's team for one message is slow, and it also changes the team for every later message.

## Decision
D1: A message can contain one **Inline Route**:
- `@harness/model[:effort]`, for example `@codex/gpt-6.1:high`
- `@team:name`, for example `@team:cheaper`

Effort is `low`, `medium` or `high`. If effort is omitted, the model's default effort from Settings is used. The route applies to the tasks created from that message only and overrides the session team for them. If the routed harness is unavailable, BentoBox follows a user setting: ask the user (default), or fall back to the session team's chain. The composer autocompletes after `@` using detected harnesses, models and their availability.

## Considered Options
- **Slash commands (`/route codex …`)**: clashes with agent-native slash commands passed through to harnesses.
- **A picker only**: no keyboard flow, and it cannot express a per-message intent.
- **`@` mention grammar (chosen)**: familiar from chat tools, typed inline, and machine-parseable.

## Consequences
- The grammar becomes a user-facing contract. Changing it later breaks saved prompts and habits.
- `@` followed by text that is not a known route stays plain text, so it does not conflict with agent prompts that mention `@file` paths. Only exact `harness/model` or `team:` forms are parsed.
- Tests must cover parsing, fallback for omitted effort, and the unavailable-harness behaviour.
