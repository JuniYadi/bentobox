/** @adr ADR-0012.D1 */
export type InlineRoute =
  | { kind: "harness"; harness: string; model: string; effort: "low" | "medium" | "high" | null }
  | { kind: "team"; name: string };

/** @adr ADR-0012.D1 */
export interface ParsedMessage {
  route: InlineRoute | null;
  promptText: string;
  error?: string;
}

/** @adr ADR-0012.D1 */
export function parseInlineRoute(text: string, knownHarnesses: string[], knownTeams: string[]): ParsedMessage {
  let found: { route: InlineRoute; start: number; end: number } | null = null;
  let fenced = false;
  for (const match of text.matchAll(/(^[ \t]*```[^\n]*(?:\n|$))|(^|[\s(])(@\S+)/gm)) {
    if (match[1]) { fenced = !fenced; continue; }
    if (fenced) continue;
    const candidate = match[3];
    const token = candidate.replace(/[.,;:!?)\]}'"]+$/, "");
    let route: InlineRoute | null = null;
    if (token.startsWith("@team:")) {
      const name = token.slice(6);
      if (knownTeams.includes(name)) route = { kind: "team", name };
    } else {
      const parsed = /^@([^/\s:]+)\/([^\s:]+)(?::(low|medium|high))?$/.exec(token);
      if (parsed && knownHarnesses.includes(parsed[1])) {
        route = { kind: "harness", harness: parsed[1], model: parsed[2], effort: (parsed[3] as "low" | "medium" | "high" | undefined) ?? null };
      }
    }
    if (!route) continue;
    if (found) return { route: null, promptText: text, error: "Only one inline route is allowed per message." };
    const start = match.index! + match[0].length - candidate.length;
    found = { route, start, end: start + token.length };
  }
  if (!found) return { route: null, promptText: text };
  let before = text.slice(0, found.start);
  let after = text.slice(found.end);
  const preceding = /\s+$/.exec(before);
  if (preceding) before = before.slice(0, -preceding[0].length);
  else if (!before) after = after.replace(/^\s+/, "");
  return { route: found.route, promptText: (before + after).trim() };
}
