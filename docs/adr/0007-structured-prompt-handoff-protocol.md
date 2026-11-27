---
adr: ADR-0007
decisions:
  D1:
    title: Structured prompt handoff protocol with pointed file references and constraints
    state: proposed
    paths: ["src-tauri/src/handoff/**", "src/features/handoff/**"]
    protected: false
    use_cases: []
---

# ADR-0007: Structured Prompt Handoff Protocol for Agent Delegation

## Context
When an Orchestrator delegates a task to a sub-agent, dumping the full conversation history inflates token costs, pollutes the sub-agent's context window with irrelevant parent discussions, and risks leaking credentials or unrelated instructions. To leverage cheaper agent harnesses effectively, sub-agents must receive clean, self-contained, pointed instructions.

## Decision
D1: We will define a standardized Prompt Handoff envelope containing goal and non-goals, targeted file pointers/ranges, strict constraints, acceptance criteria commands, and assigned worktree paths, while strictly sanitizing environment secrets and tokens before dispatch.

## Considered Options
- **Full Chat Transcript Forwarding**: High token burn, leaks parent secrets, degrades small model accuracy.
- **Raw Unstructured Prompts**: Vague instructions lead to erratic sub-agent behavior.
- **Structured Pointed Envelope (Chosen)**: Minimizes token usage, isolates security boundaries, and provides deterministic verification.

## Consequences
- Orchestrator system prompts are tuned to output structured handoff payloads.
- Right sidebar includes a Prompt Handoff inspector/editor.
