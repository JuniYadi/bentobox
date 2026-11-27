---
adr: ADR-0002
decisions:
  D1:
    title: Strict separation of session usage and account quota with unavailable states
    state: proposed
    paths: ["src-tauri/src/usage/**", "src/features/usage/**"]
    protected: false
    use_cases: []
---

# ADR-0002: Strict Separation of Session Usage and Account Quota

## Context
Coding agents report token counts and context-window occupancy during active sessions. Developers frequently confuse these session-level metrics with provider-level subscription quotas, remaining credits, rate limits, or billing reset timers. ACP events carry session context usage but do not supply account quota or subscription facts.

## Decision
D1: We will isolate Session Usage (reported volumetric tokens/context window) from Account Quota (external provider subscription/rate limits). When an authoritative provider quota connector is absent or unconfigured, quota fields display `Unavailable` without estimation, extrapolation, or assumed zeros.

## Considered Options
- **Infer quota from session tokens**: Guess remaining allowance; misleading and inaccurate.
- **Unified usage/quota metric**: Blends context size into billing; confuses users.
- **Disjoint models with explicit `Unavailable` state (Chosen)**: Guarantees truthful telemetry.

## Consequences
- Frontend separates session context consumption from provider account balances.
- Quota connectors fail gracefully without blocking agent sessions.
