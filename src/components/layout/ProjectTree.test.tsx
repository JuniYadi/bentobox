import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { SidebarProvider } from "../ui/sidebar";
import { TooltipProvider } from "../ui/tooltip";
import { ProjectTree } from "./ProjectTree";

const project = { id: 1, name: "bentobox", rootPath: "/repo", createdAt: "2026-01-01T00:00:00Z" };
const session = { id: 7, title: "Review changes", phase: "Approve", lastActivityAt: "2026-11-28T00:00:00Z", state: "active" as const, taskStatuses: [] };

describe("[ADR-0016.D2] project session tree", () => {
  test("nests sessions under projects and shows their status glyph", () => {
    const html = renderToStaticMarkup(<TooltipProvider><SidebarProvider><ProjectTree projects={[project]} sessionsByProject={{ 1: [session] }} activeSessionId={7} filter="" loading={false} adding={false} projectPath="" expanded={{}} onToggleAdd={() => {}} onProjectPathChange={() => {}} onAddProject={() => {}} onToggleProject={() => {}} onSelectSession={() => {}} onCreateSession={() => {}} /></SidebarProvider></TooltipProvider>);
    expect(html.indexOf("bentobox")).toBeLessThan(html.indexOf("Review changes"));
    expect(html).toContain('aria-label="needs-approval"');
    expect(html).toContain("New session");
  });

  test("a project-name match includes every session and orphan sessions are visible only when present", () => {
    const props = { projects: [project], sessionsByProject: { 1: [session, { ...session, id: 8, title: "Another task" }] }, activeSessionId: null, filter: "bento", loading: false, adding: false, projectPath: "", expanded: {}, onToggleAdd: () => {}, onProjectPathChange: () => {}, onAddProject: () => {}, onToggleProject: () => {}, onSelectSession: () => {}, onCreateSession: () => {} };
    const render = (orphaned = false) => renderToStaticMarkup(<TooltipProvider><SidebarProvider><ProjectTree {...props} filter={orphaned ? "" : props.filter} unassignedSessions={orphaned ? [{ ...session, id: 9, title: "Orphan" }] : []} /></SidebarProvider></TooltipProvider>);
    expect(render()).toContain("Review changes");
    expect(render()).toContain("Another task");
    expect(render()).not.toContain("Unassigned");
    expect(render(true)).toContain("Unassigned");
    expect(render(true)).toContain("Orphan");
    expect(render()).toContain("text-warning");
    expect(render()).toContain("size-1.75");
  });

  test("renders status tokens on frame-sized glyphs", () => {
    const items = [session, { ...session, id: 8, phase: null, taskStatuses: ["failed"] }, { ...session, id: 9, phase: null, taskStatuses: ["running"] }, { ...session, id: 10, phase: null }, { ...session, id: 11, state: "closed" as const }];
    const html = renderToStaticMarkup(<TooltipProvider><SidebarProvider><ProjectTree projects={[project]} sessionsByProject={{ 1: items }} activeSessionId={null} filter="" loading={false} adding={false} projectPath="" expanded={{}} onToggleAdd={() => {}} onProjectPathChange={() => {}} onAddProject={() => {}} onToggleProject={() => {}} onSelectSession={() => {}} onCreateSession={() => {}} /></SidebarProvider></TooltipProvider>);
    expect(html).toContain('aria-label="needs-approval" class="size-1.75 rounded-full bg-current text-warning"');
    expect(html).toContain('aria-label="failed" class="size-1.75 rounded-full bg-current text-danger"');
    expect(html).toContain('aria-label="running" class="size-1.75 rounded-full bg-current text-muted-foreground"');
    expect(html).toContain('aria-label="idle" class="size-2 rounded-full border border-current text-muted-foreground"');
    expect(html).toContain('aria-label="done"');
    expect(html).toContain("text-success");
  });
});
