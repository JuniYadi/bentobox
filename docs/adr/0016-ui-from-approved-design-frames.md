---
adr: ADR-0016
decisions:
  D1:
    title: Frontend is built with Tailwind and shadcn/ui from DESIGN.md tokens; approved frames are committed as the visual reference
    state: proposed
    paths: ["src/components/ui/**", "src/styles/**", "src/lib/**", "scripts/design-tokens.*"]
    protected: false
    use_cases: []
  D2:
    title: App shell follows project-tree-shadcn (projects tree, chat, contextual right panel, status bar) (supersedes ADR-0009.D1)
    state: proposed
    paths: ["src/components/layout/**", "src/App.tsx", "src/features/project/**", "src-tauri/src/project/**"]
    protected: false
    use_cases: []
  D3:
    title: Plan approval renders in the chat as a plan card per project-tree-plan-approve
    state: proposed
    paths: ["src/features/session/**"]
    protected: false
    use_cases: []
  D4:
    title: Each sub-agent has a detail view per agent-detail, built from the event log
    state: proposed
    paths: ["src/features/agent-detail/**"]
    protected: false
    use_cases: []
  D5:
    title: Settings is a full-width view per settings-teams; only sections backed by real data ship, persisted in SQLite
    state: proposed
    paths: ["src/features/settings/**", "src-tauri/src/settings/**"]
    protected: false
    use_cases: []
---

# ADR-0016: Build the UI from the Approved Design Frames

## Context
`DESIGN.md` v2 specifies Tailwind, shadcn/ui and a dark zinc theme. Four frames in `.design/frames/` are marked `approved` in `.design/frames.json`: `project-tree-shadcn` (the entry frame), `project-tree-plan-approve`, `agent-detail` and `settings-teams`.

The current frontend matches neither.
- **Styling:** it uses inline `style={{…}}` objects with hardcoded hex colours, including the brand blue `DESIGN.md` forbids. Tailwind and shadcn are not installed.
- **Layout:** it follows ADR-0009. The left sidebar holds a flat session list plus the GitHub panel, and the right sidebar holds sub-agents, handoffs and telemetry. All four frames move GitHub to the right panel, add a project tree and a status bar, and one frame drops the right panel.
- **Version control:** `.design/` is gitignored, so the approved frames exist only on one machine.

Backend work has run ahead of the UI. The UI has to catch up before more features land, so that each later feature (ADR-0011 teams, ADR-0012 routing, agent execution) has a defined place on screen.

## Decision
D1: **Foundation.**
- Install Tailwind and shadcn/ui. Generate the CSS variables in `src/styles/tokens.css` from the `DESIGN.md` frontmatter with `scripts/design-tokens`, which is run by a package script. Generated CSS is never hand-edited.
- Build every component from shadcn primitives under `src/components/ui/`: Sidebar, Button, Badge, Tabs, Switch, Input, Textarea, Card, DropdownMenu, Progress, Tooltip.
- No inline colour, spacing or font values in components.
- Commit the four approved frames, `frames.json` and `tokens.css`; draft frames stay ignored.
- Where a frame breaks a `DESIGN.md` rule, `DESIGN.md` wins:
  - status colour only as a dot or icon, never as a fill behind text, including GitHub state pills and diff lines
  - no bold weight in lists
  - monospace only for branches, paths, diff counts and timers
  - no hardcoded hex colours, including the GitHub Primer palette

D2: **App shell, from `project-tree-shadcn`.** This replaces ADR-0009.D1's column contents. The layout keeps three columns.
- **Left sidebar.** 256px wide (resizable 200–420px), collapsing to a 52px icon rail.
  - The header has a session search, opened with ⌘K.
  - Below it sits a **Projects** tree. A project is a registered local repository, and its sessions are nested beneath it with a status glyph and right-aligned meta.
  - The footer holds a teams summary, Settings (⌘,) and Collapse (⌘B).
- **Content.** The session chat (max 720px wide) and the composer: textarea, team or harness picker, `@` route chip, and a Worktree switch.
- **Right panel.** 360px wide (resizable 280–640px), toggled with ⌥⌘B. It is contextual: in a session it is the GitHub issue and PR inspector (ADR-0008), one tab per item, with a detail view.
- **Status bar.** 28px. It shows harness dots (ADR-0001/0004), session context usage and account quota as separate values (ADR-0002), and the `gh` login (ADR-0008).
- **Backend.** Projects are stored in SQLite (ADR-0005), with commands to add, list and remove them. Sessions reference a project.
- **Small windows.** Below 1200px of window width the right panel starts collapsed, so content stays usable at ADR-0014's 1024px minimum.
- **Persistence.** Panel widths and collapsed states are kept across launches, as ADR-0009 required.

D3: **Plan approval, from `project-tree-plan-approve`.**
- While a session's plan is in Plan or Approve, the chat shows a **plan card**:
  - an `orchestrator · read-only` badge
  - numbered tasks, each with its own harness or team picker, its worktree, its files and an `after #n` dependency
  - a footer with the worktree count and the estimated tokens. If any task's estimate is unknown, it shows "unknown", never 0.
  - Revise and "Approve & build" buttons
- The Plan → Approve → Build → Review stepper sits in the top bar and is bound to the real plan phase.
- The composer placeholder becomes "Reply to revise the plan, or approve above…".
- All actions call the ADR-0010 commands. "Approve & build" passes the plan revision it shows.

D4: **Sub-agent detail, from `agent-detail`.**
- Reached from a sub-agent card's "Open agent" link, and has a back button to the session.
- **Header.** A breadcrumb (project › session › agent), the worktree branch, the diff count, the run state and timer, and Pause, Stop and Take over buttons.
- **Timeline.** The orchestrator's handoff (ADR-0007), the tool-call activity, permission request cards (Allow, Deny, View diff), and a steering composer.
- **Right panel.** Tabs for Overview, Diff and Logs. Overview shows:
  - the team's fallback chain with each step's state (ADR-0011)
  - a context-window meter
  - token and cost usage (ADR-0002)
  - files touched and checks
- The view is built only from the event log and the plan. Controls whose backend does not exist are shown disabled with the reason, until a decision covers agent execution: Pause, Stop, Take over, Allow, Deny and Steer.

D5: **Settings, from `settings-teams`.**
- A full-width view opened with ⌘, or from the teams footer. The right panel is hidden.
- A 200px section nav sits beside a form area up to 880px wide. Sections: General, Harnesses, Teams, Defaults, GitHub, Worktrees, Keybindings.
- A section ships only when real data backs it:
  - **Teams:** ADR-0011, including the generate-from-subscriptions preview with Apply and Discard.
  - **Harnesses:** ADR-0001 and ADR-0004.
  - **Worktrees:** ADR-0003.
  - **GitHub:** ADR-0008.
- Preferences are stored in a typed SQLite settings table (ADR-0005), with a "Saved" confirmation after each change. A preference that no decision gives behaviour to is not shown.

## Considered Options
- **Keep ADR-0009's layout and restyle it**: it ignores the approved frames, and it keeps GitHub in the left sidebar, which crowds the session list.
- **Implement the frames as static HTML or CSS ports**: fast, but it carries the frames' fake data and their `DESIGN.md` violations into the product.
- **Rebuild on shadcn per frame, binding only real data (chosen)**: more work up front, but every screen has a defined place for each upcoming feature, and nothing fakes state the backend cannot provide.

## Consequences
- **Order.** D1 first, then D2. D3 can follow immediately, because ADR-0010's commands exist. D5 Teams waits for ADR-0011's backend. D4 ships its view with controls disabled until an agent-execution decision lands.
- **ADR-0009.D1 is superseded once D2's code lands.** Layout files then switch their tags to ADR-0016.D2.
- **New backend commands:** project add, list and remove, plus settings get and set.
- **GitHub data needs extending.** The ADR-0008 queries must also fetch body, author, draft and mergeable state, and checks for the inspector detail. That is an ADR-0008 change, not part of this ADR.
- **Data in the frames that no decision supports is not built:** subscription tier labels, per-harness model lists, dollar cost, the context-window size, worktree disk usage, General and Keybindings preferences. Each needs its own decision first.
- **Tests must prove:**
  - no component uses inline colour values
  - generated tokens match the `DESIGN.md` frontmatter
  - the plan card's Approve sends the displayed revision
  - an unknown estimate renders as unknown, not 0
  - the right panel is collapsed below 1200px
  - disabled agent controls show their reason
  - settings changes persist across a restart
