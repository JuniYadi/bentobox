---
adr: ADR-0005
decisions:
  D1:
    title: Embedded SQLite for session coordination, task graphs, and redacted event logs
    state: proposed
    paths: ["src-tauri/src/db/**", "src-tauri/src/session/**"]
    protected: false
    use_cases: []
---

# ADR-0005: Embedded SQLite for Session Coordination and Event Logging

## Context
BentoBox manages hierarchical task trees, agent session lifecycles, structured event streams (tool calls, terminal outputs, approval requests), diff logs, and context handoffs across sessions. This state must persist across application restarts, support fast relational queries, and maintain strict audit trails while ensuring local data privacy.

## Decision
D1: We will use an embedded SQLite database managed exclusively by the Tauri Rust backend for session states, task graphs, capability caches, and redacted event logs, exposed to the frontend via typed IPC commands.

## Considered Options
- **Flat JSON / YAML files**: Fragile under crashes, poor indexing, no transactional safety.
- **Frontend IndexedDB**: Sandboxed in webview, inaccessible to background Rust tasks.
- **Embedded SQLite in Rust (Chosen)**: Full ACID transactions, fast query performance, zero external daemons.

## Consequences
- Integrates a Rust SQLite driver (`rusqlite` or `sqlx`) in `src-tauri/Cargo.toml`.
- All session and event models incorporate schema versioning and migrations.
