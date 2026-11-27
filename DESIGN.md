---
name: BentoBox (shadcn zinc)
version: 2
colors:
  bg: "#09090b"
  surface: "#111113"
  surface-elevated: "#27272a"
  border: "#27272a"
  input: "#3f3f46"
  ring: "#71717a"
  fg: "#fafafa"
  fg-muted: "#a1a1aa"
  accent: "#fafafa"
  accent-fg: "#18181b"
  success: "#22c55e"
  warning: "#f59e0b"
  danger: "#ef4444"
typography:
  font-sans: "'Geist', 'Inter', ui-sans-serif, system-ui, -apple-system, sans-serif"
  font-mono: "'Geist Mono', ui-monospace, SFMono-Regular, Menlo, monospace"
  body-size: "14px"
radii:
  sm: "4px"
  md: "6px"
  lg: "8px"
  pill: "9999px"
spacing:
  unit: "4px"
motion:
  fast: "150ms cubic-bezier(0.4, 0, 0.2, 1)"
---

# Design System

Tailwind + shadcn/ui, dark zinc theme. Edit frontmatter tokens here; regenerate `.design/tokens.css` from them.

## Aesthetic Direction
- **Neutral first:** Almost everything is zinc. The primary button is near-white on dark, matching shadcn's default theme. No brand blue, no gradients, no glow.
- **Depth:** 1px borders and one step of surface change. No drop shadows except on popovers and dialogs.
- **Typography:** 14px body, 12px secondary text, 11px meta. Medium weight for labels, never bold in lists. Monospace only for branches, paths, diff counts and timers.
- **Status color:** Green, amber and red appear only as 6–8px dots or small icons that carry status. Never as fills behind text.

## Component Grammar
- Use shadcn patterns: Sidebar (header, group label, menu, sub-menu, footer), Button (default, outline, ghost), Badge (outline), Tabs, Switch, Input, Card.
- List rows are 28–32px tall, single line, with a truncating title and right-aligned muted meta.
- Icons are 16px, 1.5px stroke, lucide style.
- Spacing is the Tailwind 4px scale; padding 8/12/16, gaps 4/8.
