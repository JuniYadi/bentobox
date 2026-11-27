import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight, GitBranch, PanelRight, Search, Settings2 } from "lucide-react";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { Textarea } from "./components/ui/textarea";
import { Switch } from "./components/ui/switch";
import { DropdownMenu, DropdownMenuTrigger } from "./components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./components/ui/tooltip";
import { Sidebar, SidebarContent, SidebarFooter, SidebarHeader, SidebarProvider } from "./components/ui/sidebar";
import { geometry, regionWidthCss, regionWidths, storedFraction } from "./components/layout/geometry";
import { resizedFraction, shortcut } from "./components/layout/keyboard";
import { ProjectTree } from "./components/layout/ProjectTree";
import { RightPanel } from "./components/layout/RightPanel";
import { StatusBar } from "./components/layout/StatusBar";
import { projectAdd, projectTree, projectUnassignedSessions, type Project, type ProjectSession } from "./features/project/api";
import { createSession, getPlan, listSessions, setSessionWorktree } from "./features/session/api";
import type { Plan, Session } from "./features/session/types";
import packageJson from "../package.json";

const version = packageJson.version;
const storage = { left: "bentobox.leftWidth", right: "bentobox.rightWidth", leftCollapsed: "bentobox.leftCollapsed", rightCollapsed: "bentobox.rightCollapsed" };

function readFraction(key: string) {
  try { return storedFraction(localStorage.getItem(key)); } catch { return null; }
}


function storedBool(key: string, fallback: boolean) {
  try { return localStorage.getItem(key) === null ? fallback : localStorage.getItem(key) === "true"; }
  catch { return fallback; }
}
const widthChanged = new Event("bentobox-width");


/** @adr ADR-0016.D2 */
export function nextStateAfterCreate(previous: { sessions: Session[]; prompt: string }, session: Session) {
  return { ...previous, sessions: [...previous.sessions, session] };
}

/** @adr ADR-0016.D2 */
export default function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [tree, setTree] = useState<Record<number, ProjectSession[]>>({});
  const [unassigned, setUnassigned] = useState<ProjectSession[]>([]);
  const [conversation, setConversation] = useState<{ sessions: Session[]; prompt: string }>({ sessions: [], prompt: "" });
  const { sessions, prompt } = conversation;
  const setPrompt = (value: string) => setConversation((current) => ({ ...current, prompt: value }));
  const [activeSessionId, setActiveSessionId] = useState<number | null>(null);
  const [filter, setFilter] = useState("");
  const [adding, setAdding] = useState(false);
  const [projectPath, setProjectPath] = useState("");
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const searchRef = useRef<HTMLInputElement>(null);
  const focusSearch = useRef(false);
  const [leftCollapsed, setLeftCollapsed] = useState(() => storedBool(storage.leftCollapsed, false));
  const [rightCollapsed, setRightCollapsed] = useState(() => storedBool(storage.rightCollapsed, false));
  const [windowWidth, setWindowWidth] = useState(() => window.innerWidth);
  const [leftFraction, setLeftFraction] = useState(() => readFraction(storage.left));
  const [rightFraction, setRightFraction] = useState(() => readFraction(storage.right));
  const activeSession = sessions.find((session) => session.id === activeSessionId) ?? null;
  const activeSessionProjectId = projects.find((project) => (tree[project.id] ?? []).some((item) => item.id === activeSessionId))?.id ?? null;
  const effectiveRightCollapsed = rightCollapsed || windowWidth < 1200;
  const widths = regionWidths(windowWidth, { leftFraction, rightFraction, leftCollapsed, rightCollapsed: effectiveRightCollapsed });
  const refreshWidths = () => { setLeftFraction(readFraction(storage.left)); setRightFraction(readFraction(storage.right)); };

  const reloadProjects = useCallback(async () => {
    const [entries, orphaned] = await Promise.all([projectTree(), projectUnassignedSessions()]);
    setProjects(entries.map((entry) => entry.project));
    setTree(Object.fromEntries(entries.map((entry) => [entry.project.id, entry.sessions])));
    setUnassigned(orphaned);
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([projectTree(), projectUnassignedSessions(), listSessions()]).then(([entries, orphaned, allSessions]) => {
      if (cancelled) return;
      setProjects(entries.map((entry) => entry.project));
      setTree(Object.fromEntries(entries.map((entry) => [entry.project.id, entry.sessions])));
      setUnassigned(orphaned);
      setConversation((current) => ({ ...current, sessions: allSessions.map((item) => ({ ...item, subAgents: [] })) }));
      const assigned = new Set(entries.flatMap((entry) => entry.sessions.map((session) => session.id)));
      setActiveSessionId(allSessions.find((session) => assigned.has(session.id))?.id ?? null);
    }).catch(() => { if (!cancelled) setError("Backend isn't available."); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const resize = () => setWindowWidth(window.innerWidth);
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
  useEffect(() => {
    if (!leftCollapsed && focusSearch.current) { searchRef.current?.focus(); focusSearch.current = false; }
  }, [leftCollapsed]);
  useEffect(() => { window.addEventListener("bentobox-width", refreshWidths); return () => window.removeEventListener("bentobox-width", refreshWidths); }, []);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const action = shortcut(event, /Mac|iPhone|iPad/.test(navigator.platform));
      if (!action) return;
      event.preventDefault();
      if (action === "search") { if (leftCollapsed) { focusSearch.current = true; setLeftCollapsed(false); localStorage.setItem(storage.leftCollapsed, "false"); } else searchRef.current?.focus(); }
      else if (action === "right") { event.stopImmediatePropagation(); setRightCollapsed(!rightCollapsed); localStorage.setItem(storage.rightCollapsed, String(!rightCollapsed)); }
      else if (action === "left") { event.stopImmediatePropagation(); const next = !leftCollapsed; setLeftCollapsed(next); localStorage.setItem(storage.leftCollapsed, String(next)); }
      else { const project = projects.find((item) => item.id === activeSessionProjectId) ?? projects[0]; if (project) void createNewSession(project); }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  });

  async function createNewSession(project: Project) {
    try {
      const created = await createSession("New session", project.id, false, project.rootPath);
      const session = { ...created, subAgents: [] };
      setConversation((current) => nextStateAfterCreate(current, session)); setActiveSessionId(session.id);
      await reloadProjects(); setError(null);
    } catch (reason) { setError(`Could not create session: ${String(reason)}`); }
  }
  async function addProject(event: React.FormEvent) {
    event.preventDefault();
    const path = projectPath.trim();
    if (!path) return;
    try { await projectAdd(path); setProjectPath(""); setAdding(false); await reloadProjects(); setError(null); }
    catch (reason) { setError(`Could not add project: ${String(reason)}`); }
  }
  async function toggleWorktree() {
    if (!activeSession) return;
    try {
      const updated = await setSessionWorktree(activeSession.id, !activeSession.optInWorktree);
      setConversation((current) => ({ ...current, sessions: current.sessions.map((item) => item.id === updated.id ? { ...item, ...updated } : item) })); setError(null);
    } catch (reason) { setError(`Could not update worktree setting: ${String(reason)}`); }
  }

  return (
    <TooltipProvider>
      <div className="flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground">
        <SidebarProvider open={!leftCollapsed} onOpenChange={(open) => { setLeftCollapsed(!open); localStorage.setItem(storage.leftCollapsed, String(!open)); }} className="flex min-h-0 w-full flex-1">
          <Sidebar data-region="left" collapsible="none" className="h-full min-h-0 shrink-0 border-r w-(--sidebar-width)" style={{ "--sidebar-width": leftCollapsed ? `${geometry.rail / 16}rem` : regionWidthCss("left", leftFraction) } as React.CSSProperties}>
            <SidebarHeader className="gap-2 p-3">{leftCollapsed ? <div className="grid size-6 place-items-center rounded bg-primary text-primary-foreground">▦</div> : <><div className="flex h-8 items-center gap-2 px-1"><span className="grid size-6 place-items-center rounded bg-primary text-primary-foreground">▦</span><span className="font-medium">bentobox</span><span className="ml-auto text-xs text-muted-foreground">{version}</span></div><div className="relative"><Search className="absolute left-2 top-2.5 size-4 text-muted-foreground" /><Input ref={searchRef} aria-label="Search sessions" placeholder="Search sessions ⌘K" value={filter} onChange={(event) => setFilter(event.target.value)} className="h-8 pl-8" /></div></>}</SidebarHeader>
            <SidebarContent className="min-h-0 overflow-auto px-2">{!leftCollapsed && <ProjectTree projects={projects} sessionsByProject={tree} unassignedSessions={unassigned} activeSessionId={activeSessionId} filter={filter} loading={loading} adding={adding} projectPath={projectPath} expanded={expanded} onToggleAdd={() => setAdding((value) => !value)} onProjectPathChange={setProjectPath} onAddProject={addProject} onToggleProject={(id, open) => setExpanded((value) => ({ ...value, [id]: open }))} onSelectSession={setActiveSessionId} onCreateSession={(project) => void createNewSession(project)} />}</SidebarContent>
            <SidebarFooter className="border-t p-2">{!leftCollapsed && <Tooltip><TooltipTrigger asChild><Button variant="ghost" disabled className="justify-start"><Settings2 /><span>Settings ⌘,</span></Button></TooltipTrigger><TooltipContent>Settings arrives with ADR-0016.D5</TooltipContent></Tooltip>}<Button variant="ghost" className="justify-start" onClick={() => { const value = !leftCollapsed; setLeftCollapsed(value); localStorage.setItem(storage.leftCollapsed, String(value)); }}><PanelRight />{!leftCollapsed && <span>Collapse ⌘B</span>}</Button></SidebarFooter>
          </Sidebar>
          {!leftCollapsed && <div role="separator" aria-label="Resize project sidebar" aria-orientation="vertical" aria-valuenow={Math.round(widths.left / windowWidth * 100)} aria-valuemin={Math.round(geometry.left.min / windowWidth * 100)} aria-valuemax={Math.round(geometry.left.max / windowWidth * 100)} tabIndex={0} className="w-1 shrink-0 cursor-col-resize hover:bg-ring focus-visible:bg-ring" onDoubleClick={() => { localStorage.removeItem(storage.left); setLeftFraction(null); }} onKeyDown={(event) => resizeKey(event, "left", leftFraction)} onPointerDown={(event) => beginResize(event, "left")} />}
          <main data-region="content" className="flex h-full min-h-0 min-w-0 flex-1 flex-col"><TopBar session={activeSession} project={projects.find((item) => (tree[item.id] ?? []).some((entry) => entry.id === activeSessionId))} collapsed={effectiveRightCollapsed} onToggle={() => { const next = !rightCollapsed; setRightCollapsed(next); localStorage.setItem(storage.rightCollapsed, String(next)); }} /><Chat session={activeSession} prompt={prompt} onPromptChange={setPrompt} onToggleWorktree={toggleWorktree} onCreateSession={() => { const project = projects.find((item) => item.id === activeSessionProjectId) ?? projects[0]; if (project) void createNewSession(project); }} error={error} loading={loading} /></main>
          {!effectiveRightCollapsed && <><div role="separator" aria-label="Resize contextual panel" aria-orientation="vertical" aria-valuenow={Math.round(widths.right / windowWidth * 100)} aria-valuemin={Math.round(geometry.right.min / windowWidth * 100)} aria-valuemax={Math.round(geometry.right.max / windowWidth * 100)} tabIndex={0} className="w-1 shrink-0 cursor-col-resize hover:bg-ring focus-visible:bg-ring" onDoubleClick={() => { localStorage.removeItem(storage.right); setRightFraction(null); }} onKeyDown={(event) => resizeKey(event, "right", rightFraction)} onPointerDown={(event) => beginResize(event, "right")} />
          <div data-region="right" className="h-full min-h-0 shrink-0 overflow-hidden w-(--right-width)" style={{ "--right-width": regionWidthCss("right", rightFraction) } as React.CSSProperties}><RightPanel onUseAsPrompt={setPrompt} /></div></>}
        </SidebarProvider>
        <StatusBar selectedSessionId={activeSessionId} />
      </div>
    </TooltipProvider>
  );
}

function persistWidth(region: "left" | "right", fraction: number) {
  const bounds = geometry[region];
  const value = Math.max(bounds.min / window.innerWidth, Math.min(bounds.max / window.innerWidth, fraction));
  localStorage.setItem(storage[region], String(value));
  window.dispatchEvent(widthChanged);
}
function resizeKey(event: React.KeyboardEvent, region: "left" | "right", fraction: number | null) {
  const next = resizedFraction(region, event.key, event.shiftKey, window.innerWidth, fraction);
  if (next === null) return;
  event.preventDefault();
  persistWidth(region, next);
}
function beginResize(event: React.PointerEvent, region: "left" | "right") {
  event.preventDefault();
  const startX = event.clientX;
  const fraction = readFraction(storage[region]);
  const start = regionWidths(window.innerWidth, { leftFraction: fraction, rightFraction: fraction, rightCollapsed: false })[region] / window.innerWidth;
  const factor = region === "left" ? 1 : -1;
  const move = (moveEvent: PointerEvent) => persistWidth(region, start + (moveEvent.clientX - startX) * factor / window.innerWidth);
  const end = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", end); window.dispatchEvent(new Event("resize")); };
  window.addEventListener("pointermove", move); window.addEventListener("pointerup", end);
}

/** @adr ADR-0016.D2 */
export function TopBar({ session, project, collapsed, onToggle }: { session: (Session & { worktreeBranch?: string | null }) | null; project?: Project; collapsed: boolean; onToggle: () => void }) {
  const [plan, setPlan] = useState<Plan | null>(null);
  useEffect(() => { let cancelled = false; setPlan(null); if (session) void getPlan(session.id).then((value) => { if (!cancelled) setPlan(value); }).catch(() => {}); return () => { cancelled = true; }; }, [session?.id]);
  const phase = plan && plan.session_id === session?.id ? plan.phase : null;
  return <header className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
    <div className="flex min-w-0 items-center gap-2 text-sm"><span className="truncate text-muted-foreground">{project?.name ?? "Projects"}</span>{session && <><ChevronRight className="size-3.5 text-muted-foreground" /><span className="truncate">{session.title}</span></>}</div>
    {session?.optInWorktree && <span className="ml-2 inline-flex items-center gap-1 rounded border px-2 py-1 text-xs"><GitBranch className="size-3" />{session.worktreeBranch ? <span className="font-mono">{session.worktreeBranch}</span> : "Worktree on"}</span>}
    <div className="ml-auto flex items-center gap-3" aria-label="Plan phases">{(["Plan", "Approve", "Build", "Review"] as const).map((step) => <span key={step} aria-current={phase === step ? "step" : undefined} className={phase === step ? "text-foreground" : "text-muted-foreground"}>{step}</span>)}{phase === "Rejected" || phase === "Closed" || phase === "Cancelled" ? <span>{phase}</span> : null}</div>
    <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon" aria-label="Toggle right panel ⌥⌘B" aria-pressed={!collapsed} onClick={onToggle}><PanelRight /></Button></TooltipTrigger><TooltipContent>Toggle right panel ⌥⌘B</TooltipContent></Tooltip>
  </header>;
}

/** @adr ADR-0016.D2 */
export function Chat({ session, prompt, onPromptChange, onToggleWorktree, onCreateSession, error, loading }: { session: Session | null; prompt: string; onPromptChange: (value: string) => void; onToggleWorktree: () => void; onCreateSession: () => void; error: string | null; loading: boolean }) {
  return <>
    <section className="min-h-0 flex-1 overflow-auto">
      <div className="mx-auto flex w-full flex-col gap-5 px-6 py-8 max-w-(--chat-max-width)" style={{ "--chat-max-width": "calc(720 * var(--fw))" } as React.CSSProperties}>
        {error && <p role="alert" className="text-sm text-muted-foreground">{error}</p>}
        {!session ? <div className="flex flex-col items-center gap-3 py-20 text-center text-sm text-muted-foreground">{loading ? "Loading sessions…" : "No session selected. Choose a project to create a session."}<Button variant="outline" onClick={onCreateSession} disabled={!session && loading}>New session</Button></div> : <>
          <p className="font-mono text-sm text-muted-foreground">{session.workspacePath}</p>
        </>}
      </div>
    </section>
    <div className="mx-auto w-full px-6 pb-5 max-w-(--chat-max-width)" style={{ "--chat-max-width": "calc(720 * var(--fw))" } as React.CSSProperties}>
      <form onSubmit={(event) => event.preventDefault()} className="rounded-lg border bg-background focus-within:ring-1 focus-within:ring-ring">
        <Textarea aria-label="Prompt" value={prompt} onChange={(event) => onPromptChange(event.target.value)} placeholder="Describe the goal…" className="min-h-16 resize-none border-0 shadow-none focus-visible:ring-0" />
        <p id="orchestrator-unavailable" className="px-3 text-xs text-muted-foreground">Orchestrator execution isn't available yet. Your text will remain here.</p>
        <div className="flex items-center gap-3 p-2">
          <Tooltip><TooltipTrigger asChild><span><DropdownMenu><DropdownMenuTrigger asChild disabled><Button type="button" variant="outline" disabled>Team / harness <ChevronDown /></Button></DropdownMenuTrigger></DropdownMenu></span></TooltipTrigger><TooltipContent>Teams arrive with ADR-0011</TooltipContent></Tooltip>
          <label className="flex items-center gap-2 text-xs text-muted-foreground"><Switch checked={session?.optInWorktree ?? false} onCheckedChange={onToggleWorktree} disabled={!session} />Worktree</label>
          <Button type="submit" disabled aria-describedby="orchestrator-unavailable" className="ml-auto"><span>Send</span></Button>
        </div>
      </form>
    </div>
  </>;
}

