---
adr: ADR-0014
decisions:
  D1:
    title: Main window opens maximized and centered, 1280x800 restore size, 1024x640 minimum
    state: proposed
    paths: ["src-tauri/tauri.conf.json"]
    protected: false
    use_cases: []
---

# ADR-0014: Main Window Launch Geometry

## Context
The `v0.0.1` test build opened in the Tauri template's 800×600 window. At that size the ADR-0009 three-column layout (Sidebar Left, Content Area, Sidebar Right) is cramped, and nothing stopped the user from shrinking the window until the columns collapsed. The window title was also the lowercase package name `bentobox`. PR #7 changed the window settings in `src-tauri/tauri.conf.json`; this ADR records that decision.

## Decision
D1: The main window opens maximized and centered, titled `BentoBox`, with a 1280×800 restore size (used when the user un-maximizes it) and a 1024×640 minimum size, set in `app.windows[0]` of `src-tauri/tauri.conf.json`.

## Considered Options
- **Keep 800×600 (template default)**: too small for three columns. Rejected.
- **`fullscreen: true`**: takes over a separate macOS Space and hides the menu bar and Dock, which is too aggressive for a tool used next to an editor and terminal. Rejected.
- **Maximized with a minimum size (chosen)**: uses the whole screen on launch, keeps the OS chrome, and the minimum size protects the layout.
- **Remember size and position between launches (`tauri-plugin-window-state`)**: deferred. It needs a new dependency and its own decision. It fits ADR-0009's persistent sidebar widths.

## Consequences
- Every launch opens maximized, even if the user resized the window last time, until window-state persistence is decided.
- Screens smaller than 1024×640 can't show the whole window. That's acceptable for a developer desktop tool.
- The macOS app bundle name still comes from `productName` (`bentobox`). Only the window title changed.
- A check must show the built app opening maximized and refusing to resize below 1024×640.
