---
adr: ADR-0004
decisions:
  D1:
    title: Agent-owned authentication lifecycle via native CLIs and system keychains
    state: proposed
    paths: ["src-tauri/src/auth/**", "src/features/auth/**"]
    protected: false
    use_cases: []
---

# ADR-0004: Agent-Owned Authentication Lifecycle

## Context
Each supported coding agent (Claude Code, OpenAI Codex, Oh My Pi, pi, OpenCode) implements proprietary authentication workflows, token caching, OAuth device flows, and keychain storage. Centralizing credentials inside BentoBox increases security exposure, requires maintaining volatile vendor auth flows, and risks leaking secrets across agent sessions.

## Decision
D1: We will delegate credential acquisition and authentication lifecycles entirely to each agent's native mechanisms and OS keychains, detecting auth health via status probes while never storing primary agent keys inside BentoBox.

## Considered Options
- **Centralized API key wallet in BentoBox**: High security liability and constant vendor auth drift.
- **Agent-owned authentication (Chosen)**: Minimal attack surface, zero secret duplication, and respects native agent keychains.

## Consequences
- BentoBox does not provide a single sign-on form; users authenticate via official agent CLIs.
- UI displays actionable diagnostic links when an agent reports expired or missing credentials.
