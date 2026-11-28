---
adr: ADR-0019
decisions:
  D1:
    title: Use the native operating system folder picker to add a project and validate its selected path in the backend
    state: accepted
    paths: ["src/components/layout/ProjectTree.tsx", "src/features/project/**", "src-tauri/capabilities/**", "src-tauri/src/project/**"]
    protected: false
    use_cases: []
  D2:
    title: Register non-git directories with a warning and run agents directly in the selected directory
    state: accepted
    paths: ["src-tauri/src/project/**", "src-tauri/src/runner/**", "src-tauri/src/session/**", "src-tauri/src/workspace/**", "src/components/layout/ProjectTree.tsx", "src/features/project/**", "src/App.tsx"]
    protected: false
    use_cases: []
---

# ADR-0019: Native Folder Picker for Adding a Project, and Non-Git Projects

## Context

The Projects tree currently asks the user to type a “Repository path”. The backend canonicalises the path, asks Git for its repository root, and rejects a path outside a Git repository. A user cannot register a plain directory, even when they want an agent to work directly there.

ADR-0003 makes worktree isolation configurable and opt-in for Git projects. A non-git directory cannot use a Git worktree, so the interface must make that limitation clear and avoid implying isolation.

## Decision

D1: **Native picker.** Adding a project opens the operating system folder dialog through `tauri-plugin-dialog` in directory mode: Finder on macOS, Explorer on Windows, and the GTK/portal chooser on Linux. Enable `dialog:allow-open` in `src-tauri/capabilities/default.json`. Remove the typed “Repository path” input from `ProjectTree.tsx`. The selected path is untrusted input. The backend `project_add` canonicalises and validates it at the trust boundary: it must exist and be a directory. The frontend does not pre-validate. Cancelling the dialog does nothing.

D2: **Non-git directories.** Accept a selected directory that is not inside a Git repository. Register it with a visible warning: “Not a git repository: worktree isolation is unavailable”. Disable the per-session worktree switch and show that reason. Agents run with `cwd` set to the project directory itself. Detect repository membership with Git, not directory-name heuristics.

For a directory inside a Git repository, preserve current behavior: resolve and register the repository root, including when the selected directory is a subdirectory. This changes ADR-0016.D2's sentence, “A project is a registered local repository,” and the corresponding description of a project as a repository in the Projects tree. Those descriptions are superseded only to the extent that a project may now be a non-git directory. The tree, session nesting and project registration remain unchanged.

## Considered Options
- **Keep typed path with a Browse button.** Rejected: the user should not have to type a path.
- **Reject non-git directories.** Rejected: users need to register them with a clear limitation warning.
- **Run `git init` automatically.** Rejected: it modifies the user's directory without consent.

## Consequences
- A project without a Git repository has no worktree isolation. Agents write directly in the user's directory. Update the help text for ADR-0017.D2's Honest limit to state this explicitly.
- ADR-0003 remains unchanged for Git projects. Its opt-in worktree behavior still applies where worktrees are available.
- **Tests must prove:**
  - a non-git directory registers and is visibly flagged
  - its worktree switch is disabled with the stated reason
  - a Git subdirectory still resolves to the repository root
  - nonexistent paths and file paths are rejected by the backend
  - the typed path input is absent
