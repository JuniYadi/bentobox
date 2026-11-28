# Tauri + React + Typescript

This template should help get you started developing with Tauri, React and Typescript in Vite.

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)

## Local Rust builds
<!-- @adr ADR-0015.D2 -->

Share one Cargo build folder across all git worktrees (ADR-0015.D2), so each worktree doesn't rebuild Tauri into its own multi-GB `src-tauri/target`:

```sh
# ~/.zshrc or ~/.bashrc
export CARGO_TARGET_DIR=~/.cache/bentobox-target
```

Two worktrees building at once wait on Cargo's build lock. Free the space with `cargo clean` (run from `src-tauri`, with the variable set).

## Releases

Publishing a GitHub Release builds and uploads the bundles (see `.github/workflows/release.yml`). Signing is driven by repository secrets, and a missing certificate builds that platform unsigned with a workflow warning:

| Secret | Used for |
|:--|:--|
| `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Required. Signs the updater bundles. The matching public key is in `src-tauri/tauri.conf.json`. Losing this key means installed apps can no longer be updated. |
| `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID` | macOS Developer ID signing and notarization. All six are required once `APPLE_CERTIFICATE` is set. |
| `WINDOWS_CERTIFICATE` (base64 PFX), `WINDOWS_CERTIFICATE_PASSWORD` | Windows Authenticode signing. |

Generate the updater key pair once with `bun run tauri signer generate -w ~/.tauri/bentobox-updater.key`, keep the private key outside the repository, and put its public key in `plugins.updater.pubkey`.
