# Tauri + React + Typescript

This template should help get you started developing with Tauri, React and Typescript in Vite.

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)

## Local Rust builds

Share one Cargo build folder across all git worktrees (ADR-0015.D2), so each worktree doesn't rebuild Tauri into its own multi-GB `src-tauri/target`:

```sh
# ~/.zshrc or ~/.bashrc
export CARGO_TARGET_DIR=~/.cache/bentobox-target
```

Two worktrees building at once wait on Cargo's build lock. Free the space with `cargo clean` (run from `src-tauri`, with the variable set).
