---
adr: ADR-0010
decisions:
  D1:
    title: Orchestrator-only sessions; read-only orchestrator, sub-agents write in worktrees after plan approval (supersedes ADR-0006.D1)
    state: accepted
    paths: ["src-tauri/src/session/**", "src/features/session/**"]
    protected: false
    use_cases: []
---

# ADR-0010: Orchestrator-Only Sessions with a Plan Approval Gate

## Context
ADR-0006.D1 gives every session three switchable modes: Orchestrator, Plan and Build. In practice the modes overlap. Planning is the orchestrator's main job, so Plan mode is the orchestrator minus delegation. Build mode makes the frontier model do mechanical edits, which is the token cost ADR-0006 set out to avoid. A three-way toggle also makes the user check which mode they are in before every prompt.

## Decision
D1: A session has no mode. The user always talks to the **Orchestrator**, which is read-only: the Rust backend gives it no file-write or mutating shell tools. Each goal moves through the phases Plan → Approve → Build → Review.
- The orchestrator proposes a **Plan**: tasks, the team or harness per task, worktrees, dependencies and an estimated token cost.
- No sub-agent starts until the user approves the plan. The user can revise it by replying.
- Only **Sub-Agents** write files, each in its own worktree (ADR-0003).
- **Take over** opens a direct editing session in one sub-agent's worktree as a manual escape hatch. It is scoped to that worktree and does not give the orchestrator write access.
- An optional "auto-approve small plans" setting skips the approval step below user-set limits (max files, max estimated tokens).

Once accepted, this supersedes ADR-0006.D1.

## Considered Options
- **Keep three modes, default to Orchestrator (ADR-0006)**: fixes the first impression, but the redundant Plan mode and the costly Build mode remain.
- **Two modes (Orchestrator, Build)**: still a toggle, and Build still bypasses delegation.
- **Orchestrator-only with an approval gate (chosen)**: one posture and a clear write boundary enforced in the backend. Human control happens at the plan, not per mode.

## Consequences
- `SessionMode`, `DEFAULT_SESSION_MODE` and the mode tabs in the content area are removed. The UI shows a phase stepper instead.
- The tool-permission policy is fixed per actor (orchestrator read-only, sub-agent write inside its worktree) instead of per mode.
- Small direct edits now go through a one-task plan or Take over. Auto-approve keeps this cheap.
- Tests must prove that the orchestrator cannot write files, and that no sub-agent starts before approval unless auto-approve applies.
