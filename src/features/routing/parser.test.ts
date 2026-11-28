import { expect, test } from "bun:test";
import { parseInlineRoute } from "./parser";

const parse = (text: string) => parseInlineRoute(text, ["codex"], ["cheaper"]);

test("[ADR-0012.D1] parses harness routes and removes their token", () => {
  expect(parse("Please @codex/gpt-6.1 solve it")).toEqual({ route: { kind: "harness", harness: "codex", model: "gpt-6.1", effort: null }, promptText: "Please solve it" });
  expect(parse("@codex/vendor/model:high go").route).toEqual({ kind: "harness", harness: "codex", model: "vendor/model", effort: "high" });
});

test("[ADR-0012.D1] accepts each supported effort and rejects malformed variants", () => {
  for (const effort of ["low", "medium", "high"] as const) {
    expect(parse(`@codex/model:${effort} work`).route).toEqual({ kind: "harness", harness: "codex", model: "model", effort });
  }
  for (const token of ["@codex/model:HIGH", "@codex/model:low:high"]) {
    expect(parse(`${token} work`)).toEqual({ route: null, promptText: `${token} work` });
  }
});

test("[ADR-0012.D1] does not count plain mentions as additional routes", () => {
  expect(parse("@file @codex/model work @src/App.tsx")).toEqual({ route: { kind: "harness", harness: "codex", model: "model", effort: null }, promptText: "@file work @src/App.tsx" });
});

test("[ADR-0012.D1] parses known team names", () => {
  expect(parse("@team:cheaper do it")).toEqual({ route: { kind: "team", name: "cheaper" }, promptText: "do it" });
});

test("[ADR-0012.D1] leaves unknown mentions and invalid effort alone", () => {
  for (const text of ["@unknown/model hi", "@src/App.tsx", "@file", "@codex/model:extreme", "@team:unknown"]) {
    expect(parse(text)).toEqual({ route: null, promptText: text });
  }
});

test("[ADR-0012.D1] rejects a second valid route without dropping text", () => {
  const text = "@codex/model and @team:cheaper task";
  expect(parse(text)).toEqual({ route: null, promptText: text, error: "Only one inline route is allowed per message." });
});

test("[ADR-0012.D1] preserves multiline prompt formatting and fenced code", () => {
  const body = "fix this:\n\n```ts\n    const value = 1;\n\n    run(value);\n```";
  expect(parse(`@team:cheaper ${body}`)).toEqual({ route: { kind: "team", name: "cheaper" }, promptText: body });
});

test("[ADR-0012.D1] retains punctuation after a route", () => {
  for (const [token, punctuation, effort] of [["@codex/gpt-6.1:high.", ".", "high"], ["@codex/gpt-6.1:high,", ",", "high"], ["@codex/gpt-6.1,", ",", null], ["@codex/gpt-6.1:", ":", null]] as const) {
    expect(parse(`${token} work`)).toEqual({ route: { kind: "harness", harness: "codex", model: "gpt-6.1", effort }, promptText: `${punctuation} work` });
  }
  expect(parse("Use (@codex/gpt-6.1) now")).toEqual({ route: { kind: "harness", harness: "codex", model: "gpt-6.1", effort: null }, promptText: "Use () now" });
});

test("[ADR-0012.D1] leaves routes inside fenced blocks unchanged", () => {
  const text = "Example:\n```text\n@codex/gpt-6.1:high\n```\nThen continue.";
  expect(parse(text)).toEqual({ route: null, promptText: text });
  expect(parse(`${text}\n@team:cheaper fix`)).toEqual({ route: { kind: "team", name: "cheaper" }, promptText: `${text} fix` });
});

test("[ADR-0012.D1] requires exact team names and leaves omitted effort null", () => {
  expect(parseInlineRoute("@team:Default work", ["codex"], ["default-orchestrator"])).toEqual({ route: null, promptText: "@team:Default work" });
  expect(parse("@codex/gpt-6.1 work").route).toEqual({ kind: "harness", harness: "codex", model: "gpt-6.1", effort: null });
});
