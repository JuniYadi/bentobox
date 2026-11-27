---
adr: ADR-0011
decisions:
  D1:
    title: Teams bind a role to an ordered harness/model:effort fallback chain
    state: proposed
    paths: ["src-tauri/src/teams/**", "src/features/teams/**"]
    protected: false
    use_cases: []
  D2:
    title: Teams are generated from detected subscriptions by user rules, previewed before apply
    state: proposed
    paths: ["src-tauri/src/teams/**", "src/features/teams/**"]
    protected: false
    use_cases: []
---

# ADR-0011: Teams with Fallback Chains, Generated from Subscriptions

## Context
Users hold several subscriptions (for example Claude Max, ChatGPT Plus, an omp API key, a local pi model), and each has its own rate limits. A single global model picker leaves capacity unused and stalls work when one provider hits a limit. The orchestrator also needs a frontier model, while sub-agents should run on cheaper models.

## Decision
D1: A **Team** has a name, a **Role** (orchestrator, sub-agents or review) and an ordered **Fallback Chain** of steps. Each step is `harness/model:effort`. When a step is rate-limited, out of quota, logged out or offline, the next step is tried. Every role has one default team. A session picks a team, defaulting to the orchestrator role's default team, and the user can override it per session.

D2: BentoBox can **generate teams** from the subscriptions it detects through each agent's own login (ADR-0004). The user sets rules: a goal (Cheapest / Balanced / Best quality), "use every subscription before paid API", "prefer local models for sub-agents", "never use frontier models for sub-agents", and a maximum fallback depth. Generation produces a preview of the teams it would add or change. Nothing changes until the user applies it.

## Considered Options
- **One global model selector**: simple, but ignores multiple subscriptions and has no failover.
- **Automatic routing with no user model**: opaque, so the user cannot predict cost or which provider ran a task.
- **Named teams with explicit chains, optionally generated (chosen)**: predictable, editable, and uses every subscription.

## Consequences
- Fallback triggers depend on each harness reporting limit, quota or auth errors. Where quota is unknown (ADR-0002), only observed errors trigger a fallback.
- Every fallback is recorded in the event log (ADR-0005) so cost and provenance stay auditable.
- Teams and generation rules need persistent storage and a migration path when harnesses add or drop models.
- Tests must prove chain order, skipping of unavailable steps, and that generation never applies changes without confirmation.
