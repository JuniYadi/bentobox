import { describe, expect, mock, test } from "bun:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SidebarGroupAction, SidebarProvider } from "../ui/sidebar";
import { TooltipProvider } from "../ui/tooltip";
import { ProjectTree } from "./ProjectTree";

const project = { id: 1, name: "bentobox", rootPath: "/repo", isGit: true, createdAt: "2026-01-01T00:00:00Z" };
const session = { id: 7, title: "Review changes", phase: "Approve", lastActivityAt: "2026-11-28T00:00:00Z", state: "active" as const, taskStatuses: [] };

describe("[ADR-0016.D2] project session tree", () => {
  test("nests sessions under projects and shows their status glyph", () => {
    const html = renderToStaticMarkup(<TooltipProvider><SidebarProvider><ProjectTree projects={[project]} sessionsByProject={{ 1: [session] }} activeSessionId={7} filter="" loading={false} expanded={{}} onAddProject={() => {}} onToggleProject={() => {}} onSelectSession={() => {}} onCreateSession={() => {}} /></SidebarProvider></TooltipProvider>);
    expect(html.indexOf("bentobox")).toBeLessThan(html.indexOf("Review changes"));
    expect(html).toContain('aria-label="needs-approval"');
    expect(html).toContain("New session");
  });

  test("a project-name match includes every session and orphan sessions are visible only when present", () => {
    const props = { projects: [project], sessionsByProject: { 1: [session, { ...session, id: 8, title: "Another task" }] }, activeSessionId: null, filter: "bento", loading: false, expanded: {}, onAddProject: () => {}, onToggleProject: () => {}, onSelectSession: () => {}, onCreateSession: () => {} };
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
    const html = renderToStaticMarkup(<TooltipProvider><SidebarProvider><ProjectTree projects={[project]} sessionsByProject={{ 1: items }} activeSessionId={null} filter="" loading={false} expanded={{}} onAddProject={() => {}} onToggleProject={() => {}} onSelectSession={() => {}} onCreateSession={() => {}} /></SidebarProvider></TooltipProvider>);
    expect(html).toContain('aria-label="needs-approval" class="size-1.75 rounded-full bg-current text-warning"');
    expect(html).toContain('aria-label="failed" class="size-1.75 rounded-full bg-current text-danger"');
    expect(html).toContain('aria-label="running" class="size-1.75 rounded-full bg-current text-muted-foreground"');
    expect(html).toContain('aria-label="idle" class="size-2 rounded-full border border-current text-muted-foreground"');
    expect(html).toContain('aria-label="done"');
    expect(html).toContain("text-success");
  });
});

describe("[ADR-0019.D1] native project picker", () => {
  test("renders no path input and the Add project action calls its handler", () => {
    const onAddProject = mock(() => {});
    const props = { projects: [project], sessionsByProject: {}, activeSessionId: null, filter: "", loading: false, expanded: {}, onAddProject, onToggleProject: () => {}, onSelectSession: () => {}, onCreateSession: () => {} };
    const html = renderToStaticMarkup(<TooltipProvider><SidebarProvider><ProjectTree {...props} /></SidebarProvider></TooltipProvider>);
    expect(html).toContain('aria-label="Add project"');
    expect(html).not.toContain("Repository path");
    expect(html).not.toContain("<input");
    const tree = ProjectTree(props);
    const action = React.Children.toArray(tree.props.children).find((child) => React.isValidElement(child) && child.type === SidebarGroupAction) as React.ReactElement<{ onClick: () => void }>;
    expect(action).toBeDefined();
    action.props.onClick();
    expect(onAddProject).toHaveBeenCalledTimes(1);
  });
});

describe("[ADR-0019.D2] non-git project warning", () => {
  test("flags only non-git projects", () => {
    const html = renderToStaticMarkup(<TooltipProvider><SidebarProvider><ProjectTree projects={[{ ...project, isGit: false }]} sessionsByProject={{}} activeSessionId={null} filter="" loading={false} expanded={{}} onAddProject={() => {}} onToggleProject={() => {}} onSelectSession={() => {}} onCreateSession={() => {}} /></SidebarProvider></TooltipProvider>);
    expect(html).toContain('title="Not a git repository: worktree isolation is unavailable"');
    const gitHtml = renderToStaticMarkup(<TooltipProvider><SidebarProvider><ProjectTree projects={[project]} sessionsByProject={{}} activeSessionId={null} filter="" loading={false} expanded={{}} onAddProject={() => {}} onToggleProject={() => {}} onSelectSession={() => {}} onCreateSession={() => {}} /></SidebarProvider></TooltipProvider>);
    expect(gitHtml).not.toContain("Not a git repository: worktree isolation is unavailable");
  });
});
