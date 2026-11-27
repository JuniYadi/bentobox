---
adr: ADR-0008
decisions:
  D1:
    title: GitHub CLI integration for querying and browser-opening issues and pull requests
    state: accepted
    paths: ["src-tauri/src/github/**", "src/features/github/**"]
    protected: false
    use_cases: []
---

# ADR-0008: GitHub CLI Integration for Issue and Pull Request Management

## Context
Developers coordinating agent tasks frequently work against GitHub Issues (for task requirements) and Pull Requests (for reviewing agent worktrees and branch diffs). Managing GitHub authentication directly inside BentoBox would require handling OAuth tokens, scopes, and keychains. The GitHub CLI (`gh`) is the standard, secure, official tool developers already use locally.

## Decision
D1: We will integrate with GitHub exclusively via the local GitHub CLI (`gh`) for querying issues and PRs, opening them in the browser (`--web`), and checking auth status. If `gh` is uninstalled or unauthenticated, the UI displays an actionable diagnosis without disrupting agent sessions.

## Considered Options
- **Direct GitHub REST API with in-app PAT storage**: Duplicates auth tooling and increases security risk.
- **Web scraping**: Brittle and violates platform terms.
- **GitHub CLI Bridge (Chosen)**: Leverages existing user authentication, supports browser opening, and provides clean failure feedback.

## Consequences
- Requires `gh` CLI installed on user machine for GitHub features.
- Missing `gh` states fail gracefully with setup guidance.
