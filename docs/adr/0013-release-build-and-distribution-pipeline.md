---
adr: ADR-0013
decisions:
  D1:
    title: GitHub Release-triggered multi-platform Tauri build pipeline with tag/version guard
    state: accepted
    paths: [".github/workflows/release.yml"]
    protected: false
    use_cases: []
  D2:
    title: Sign and notarize macOS bundles with an Apple Developer ID
    state: accepted
    paths: [".github/workflows/release.yml", "src-tauri/tauri.conf.json"]
    protected: false
    use_cases: []
  D3:
    title: Authenticode-sign Windows installers
    state: accepted
    paths: [".github/workflows/release.yml", "src-tauri/tauri.conf.json"]
    protected: false
    use_cases: []
  D4:
    title: Signed in-app updates via the Tauri updater plugin and release-hosted latest.json
    state: accepted
    paths: [".github/workflows/release.yml", "src-tauri/tauri.conf.json", "src-tauri/src/**"]
    protected: false
    use_cases: []
  D5:
    title: Keep CI actions current with Dependabot for github-actions
    state: accepted
    paths: [".github/dependabot.yml", ".github/workflows/**"]
    protected: false
    use_cases: []
---

# ADR-0013: Release Build and Distribution Pipeline

## Context
PRD §4.7 requires desktop builds packaged through Tauri's supported signing, notarization and platform packaging paths, plus signed updates through a trusted channel. Until now nothing defined how a release is built, which platforms ship, or what users get on first launch. The `release` workflow (`.github/workflows/release.yml`) exists but has no decision behind it. The first test release (`v0.0.1`) will show what the pipeline produces today and what it cannot do yet.

## Decision
D1: Publishing a GitHub Release builds the app with `tauri-apps/tauri-action` on macOS arm64, macOS x64, Linux x64 (Ubuntu 22.04 for glibc compatibility) and Windows x64, and uploads the bundles to that release. A guard job fails the run when the tag (without `v`) differs from the version in `package.json`, `src-tauri/tauri.conf.json` or `src-tauri/Cargo.toml`. `workflow_dispatch` is a dry run that keeps the bundles as workflow artifacts only.

D2: macOS bundles are signed with a Developer ID Application certificate and notarized, using the `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD` and `APPLE_TEAM_ID` repository secrets.

D3: Windows `.msi`/`.exe` installers are Authenticode-signed (a certificate or Azure Trusted Signing), so SmartScreen does not block them as an unknown publisher.

D4: The app ships `tauri-plugin-updater`, with a minisign public key in `tauri.conf.json`. The release workflow signs the bundles with `TAURI_SIGNING_PRIVATE_KEY` and uploads `latest.json` (`uploadUpdaterJson`). The app checks for updates only after the user agrees, matching PRD §4.7's opt-in rule.

D5: `.github/dependabot.yml` checks the `github-actions` ecosystem weekly, so action versions such as `actions/checkout` stay current through reviewed PRs instead of manual bumps.

## Considered Options
- **Manual local builds per OS**: not reproducible, needs three machines, no provenance.
- **Build on every push to main**: wastes runner minutes. Releases stay an explicit human action.
- **GitHub Release trigger with tauri-action (chosen)**: official Tauri path, uploads straight to the release, and works with signing and the updater later.
- **Linux arm64 / Windows arm64**: deferred. Add them to the matrix once there is demand.

## Consequences
- With D1 alone, releases are unsigned. macOS Gatekeeper shows "app is damaged / can't be opened" for downloaded builds (workaround: `xattr -dr com.apple.quarantine`). Windows SmartScreen warns about an unknown publisher. Linux packages are unsigned.
- D2 needs a paid Apple Developer account. D3 needs a code-signing certificate or an Azure Trusted Signing account.
- D4 depends on D2/D3 for a trusted update chain. Losing the updater private key means users must reinstall by hand.
- Bumping the version means editing three files. The guard job turns a forgotten bump into a failed release instead of mislabeled assets.
- A test must prove that a mismatched tag fails `verify-version` and a matching tag uploads assets for all four targets.
