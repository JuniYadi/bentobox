---
adr: ADR-0001
decisions:
  D1:
    title: Dual-transport ACP and native process adapters with Capability Registry
    state: accepted
    paths: ["src-tauri/src/agent/**", "src/features/agent/**"]
    protected: false
    use_cases: []
---

# ADR-0001: Dual-Transport Agent Integration and Capability Registry

## Context
BentoBox must coordinate multiple coding agents (Claude Code, OpenAI Codex, Oh My Pi, pi, OpenCode). While the Agent Client Protocol (ACP) offers a standardized JSON-RPC interface for compatible agents, several targets only provide command-line interfaces or have varying levels of protocol maturity. Developers need a consistent desktop experience without papering over real agent limitations.

## Decision
D1: We will implement a dual-transport architecture in the Rust backend supporting native ACP clients over JSON-RPC and dedicated CLI process adapters, governed by a strict Capability Registry that discovers or explicitly declares supported features per agent and binary version without synthetic protocol shims.

## Considered Options
- **Pure ACP client only**: Excludes CLI-only agents.
- **Universal synthetic ACP adapter**: Intercepts terminal output and fakes events; brittle and masks real limitations.
- **Dual-transport with Capability Registry (Chosen)**: Truthful capability matrix per integration.

## Consequences
- Every agent integration specifies a capability matrix and transport implementation.
- UI displays unsupported operations as disabled or unavailable.
