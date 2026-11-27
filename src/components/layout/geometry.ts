/** @adr ADR-0016.D2 */
export const geometry = {
  left: { min: 200, max: 420, frame: 256 },
  right: { min: 280, max: 640, frame: 360 },
  rail: 52,
  chat: 720,
  frame: 1440,
} as const;

/** @adr ADR-0016.D2 */
export interface WidthPreferences {
  leftFraction?: number | null;
  rightFraction?: number | null;
  leftCollapsed?: boolean;
  rightCollapsed?: boolean;
}


/** @adr ADR-0016.D2 */
export function regionWidths(windowWidth: number, prefs: WidthPreferences = {}) {
  const leftFraction = prefs.leftFraction ?? geometry.left.frame / geometry.frame;
  const rightFraction = prefs.rightFraction ?? geometry.right.frame / geometry.frame;
  return {
    left: prefs.leftCollapsed ? geometry.rail : Math.min(geometry.left.max, Math.max(geometry.left.min, windowWidth * leftFraction)),
    right: (prefs.rightCollapsed ?? windowWidth < 1200) ? 0 : Math.min(geometry.right.max, Math.max(geometry.right.min, windowWidth * rightFraction)),
    chat: windowWidth * geometry.chat / geometry.frame,
  };
}

/** @adr ADR-0016.D2 */
export function storedFraction(raw: string | null): number | null {
  if (raw === null || raw.trim() === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 && value <= 1 ? value : null;
}

/** @adr ADR-0016.D2 */
export function regionWidthCss(region: "left" | "right", fraction: number | null): string {
  const { min, max, frame } = geometry[region];
  return `clamp(${min}px, ${fraction === null ? `calc(${frame} * var(--fw))` : `calc(${fraction} * 100vw)`}, ${max}px)`;
}
