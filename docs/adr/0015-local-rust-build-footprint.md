---
adr: ADR-0015
decisions:
  D1:
    title: Dev profile keeps line tables for our crate and drops debug info for dependencies
    state: accepted
    paths: ["src-tauri/Cargo.toml"]
    protected: false
    use_cases: []
  D2:
    title: Developers share one CARGO_TARGET_DIR across git worktrees
    state: accepted
    paths: []
    protected: false
    use_cases: []
---

# ADR-0015: Local Rust Build Footprint

## Context
One debug build left 4.6 GB in `src-tauri/target`. Most of that is full debug info for Tauri's many dependencies. ADR-0003 has parallel tasks run in git worktrees, and each worktree builds into its own `target/`, so disk use grows by several GB per worktree. PR #8 changed the dev profile in `src-tauri/Cargo.toml`; this ADR records that decision and the shared build folder that goes with it.

## Decision
D1: In `src-tauri/Cargo.toml`, `[profile.dev]` sets `debug = "line-tables-only"` and `[profile.dev.package."*"]` sets `debug = false`. `[profile.release]` doesn't change.

D2: Developers set `CARGO_TARGET_DIR` (for example `~/.cache/bentobox-target`) in their shell, so every worktree reuses one build cache. This is a developer setting and isn't committed to the repo.

## Considered Options
- **Do nothing and `cargo clean` now and then**: every worktree still costs a full build and several GB. Rejected as the only measure.
- **Commit `build.target-dir` in `.cargo/config.toml`**: forces one path on every developer and CI runner. Rejected; the per-developer env var is less intrusive.
- **`sccache`**: shares compiled crates across projects. That mainly saves build time and adds a tool. Optional and not required.
- **Trim debug info + shared target dir (chosen)**: biggest disk saving for the least change.

## Consequences
- After two `cargo check` runs from two worktrees, the shared folder was 1.3 GB, versus 4.6 GB for one checkout's own `target/` before the change. These aren't the same kind of build, so it isn't a benchmark.
- Panic backtraces still show file and line for BentoBox code. A debugger loses variables and symbols inside dependency code. To get them back for a debugging session, temporarily set `debug = true`.
- With D2, two worktrees building at once wait on Cargo's build lock.
- Shipped bundles are unaffected because the release profile is unchanged.
- CI keeps its own cache through `swatinem/rust-cache` and isn't affected by D2.
