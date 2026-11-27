---
adr: ADR-0009
decisions:
  D1:
    title: Three-column responsive desktop layout (Sidebar Left | Content | Sidebar Right)
    state: accepted
    paths: ["src/components/layout/**", "src/App.tsx"]
    protected: false
    use_cases: []
---

# ADR-0009: Three-Column Desktop Layout Architecture

## Context
Coordinating multi-agent workflows involves monitoring high-level task trees, reading code diffs, reviewing prompt handoffs, approving tool actions, and tracking GitHub issues/PRs. Cramming these distinct workflows into a single view creates clutter and cognitive overload, while fragmented multi-window navigation slows developer reaction times.

## Decision
D1: We will organize the desktop application into a standard Three-Column Layout: `Sidebar Left` (navigation, sessions, tasks, GitHub panel), `Content Area` (mode switcher, active session chat, diffs, plan editor), and `Sidebar Right` (sub-agents, prompt handoffs, approval requests, session telemetry), with independent collapsing and persistent widths.

## Considered Options
- **Tab-based single-view layout**: Hides approval prompts and sub-agent progress.
- **Floating multi-window layout**: Disorganized and cluttered on smaller screens.
- **Three-Column Resizable Layout (Chosen)**: Keeps navigation, active execution, and sub-agent delegation concurrently visible.

## Consequences
- Requires a split-pane layout manager in React.
- Panel widths and collapsed states are saved in local UI preferences.
