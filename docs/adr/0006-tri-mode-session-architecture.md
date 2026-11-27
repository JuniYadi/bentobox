---
adr: ADR-0006
decisions:
  D1:
    title: Tri-mode session architecture supporting orchestrator, plan, and build modes
    state: accepted
    paths: ["src-tauri/src/session/**", "src/features/session/**"]
    protected: false
    use_cases: []
---

# ADR-0006: Tri-Mode Session Architecture (Orchestrator, Plan, Build)

## Context
Deploying frontier reasoning models for all operations (including mechanical refactors, boilerplate, and command runs) leads to exorbitant token costs. Conversely, deploying lower-cost or smaller models for whole-repo architectural planning causes hallucination and system drift. Developers need to switch operational postures within a single session and route discrete tasks to specialized, cost-effective harnesses.

## Decision
D1: Every session operates in one of three explicit Session Modes: `Orchestrator` (default: decomposes tasks and delegates to sub-agents on cheaper harnesses), `Plan` (read-only architectural analysis without codebase mutation), and `Build` (direct file editing and command execution).

## Considered Options
- **Unstructured Single Mode**: Uncontrolled token burn, prompt bloat, and accidental code mutations.
- **Separate Session Types (Fixed at creation)**: Rigid silos preventing fluid workflow transitions.
- **Tri-Mode Dynamic Posture per Session (Chosen)**: Clear tool permission gates per mode and seamless delegation to lower-cost sub-agents.

## Consequences
- Rust backend enforces mode-specific tool permission policies (e.g. blocking file writes during Plan mode).
- UI displays active mode status and instant switching controls.
