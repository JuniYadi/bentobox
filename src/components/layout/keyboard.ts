import { geometry, regionWidths } from "./geometry";

/** @adr ADR-0016.D2 */
export function shortcut(event: Pick<KeyboardEvent, "code" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">, mac: boolean): "left" | "right" | "search" | "new-session" | "settings" | null {
  if (!(mac ? event.metaKey : event.ctrlKey) || event.shiftKey) return null;
  if (event.code === "KeyB") return event.altKey ? "right" : "left";
  if (event.altKey) return null;
  if (event.code === "KeyK") return "search";
  if (event.code === "KeyN") return "new-session";
  if (event.code === "Comma") return "settings";
  return null;
}

/** @adr ADR-0016.D2 */
export function resizedFraction(region: "left" | "right", key: string, shift: boolean, width: number, fraction: number | null): number | null {
  if (key === "Home" || key === "End") return geometry[region][key === "Home" ? "min" : "max"] / width;
  if (key !== "ArrowLeft" && key !== "ArrowRight") return null;
  const direction = region === "left" ? (key === "ArrowRight" ? 1 : -1) : (key === "ArrowLeft" ? 1 : -1);
  const actual = regionWidths(width, { leftFraction: fraction, rightFraction: fraction, rightCollapsed: false })[region] / width;
  return actual + direction * (shift ? 0.05 : 0.01);
}
