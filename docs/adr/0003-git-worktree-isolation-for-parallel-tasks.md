---
adr: ADR-0003
decisions:
  D1:
    title: Configurable opt-in Git worktree isolation for parallel task execution
    state: accepted
    paths: ["src-tauri/src/workspace/**", "src/features/workspace/**"]
    protected: false
    use_cases: []
---

# ADR-0003: Configurable Opt-In Git Worktree Isolation for Multi-Agent Workspaces

## Context
When coordinating multiple agents within the same Git repository, agents operating simultaneously on the same working branch trigger file write collisions, merge conflicts, index locking, and git state corruption. However, forcing mandatory worktrees for every task creates friction for users running sequential workflows or lightweight edits.

## Decision
D1: We will provide a configurable, opt-in Git Worktree isolation mechanism where tasks can execute in dedicated isolated worktrees (`git worktree add`), with collision warnings when multiple agents target the same branch, and non-destructive lifecycles requiring explicit user review before merges.

## Considered Options
- **Mandatory worktrees for all tasks**: Heavy filesystem overhead and friction for quick edits.
- **Shared working tree without isolation**: Destructive file overwrites and corrupted git states.
- **Configurable Opt-In Worktrees with Collision Safeguards (Chosen)**: Balances safety with lightweight usability.

## Consequences
- Workspace Service manages worktree paths, branch conventions, and non-destructive cleanup.
- UI exposes explicit worktree toggles during task delegation.
