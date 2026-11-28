import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUp, ChevronDown, ChevronRight, GitBranch, PanelRight, Search, Settings2 } from "lucide-react";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { Textarea } from "./components/ui/textarea";
import { Switch } from "./components/ui/switch";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "./components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./components/ui/tooltip";
import { Sidebar, SidebarContent, SidebarFooter, SidebarHeader, SidebarProvider } from "./components/ui/sidebar";
import { geometry, regionWidthCss, regionWidths, storedFraction } from "./components/layout/geometry";
import { resizedFraction, shortcut } from "./components/layout/keyboard";
import { ProjectTree } from "./components/layout/ProjectTree";
import { RightPanel } from "./components/layout/RightPanel";
import { StatusBar } from "./components/layout/StatusBar";
import { addProjectFromPicker, projectTree, projectUnassignedSessions, type Project, type ProjectSession } from "./features/project/api";
import { approvePlan, createSession, getPlan, listSessions, sessionSetConcise, setSessionWorktree, startDirectRun } from "./features/session/api";
import { PLAN_COMPOSER_PLACEHOLDER, PlanCard, showsPlanCard } from "./features/session/PlanCard";
import { buildOneTaskPlan, getComposerHarnessOptions, phaseStepState, sendState, toggleSessionConcise } from "./features/session/composer";
import { AgentDetailView, AgentRightPanel, SubAgentCard } from "./features/agent-detail";
import { fetchIncrementalEvents, loadSessionEvents, mergeEvents, partitionChatTimeline } from "./features/agent-detail/timeline";
import { listDetectedHarnesses, type DetectedHarness } from "./features/agent/api";
import { onRunnerEvent, onSessionTitle, runnerRespondPermission, runnerSend, runnerSetMode, runnerStart, runnerStop } from "./features/runner/api";
import type { DbEvent, JsonValue } from "../src-tauri/src/db/api";
import { SettingsView } from "./features/settings/SettingsView";
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

/** @adr ADR-0018.D5 */
export function withSessionTitle<T extends { id: number; title: string }>(items: T[], sessionId: number, title: string): T[] {
  return items.map((item) => item.id === sessionId ? { ...item, title } : item);
}

/** @adr ADR-0018.D5 */
export function applyRecentTitles<T extends { id: number; title: string }>(items: T[], updates: Map<number, { sequence: number; title: string }>, after: number): T[] {
  return items.map((item) => {
    const update = updates.get(item.id);
    return update && update.sequence > after ? { ...item, title: update.title } : item;
  });
}

/** @adr ADR-0016.D2 */
export default function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [tree, setTree] = useState<Record<number, ProjectSession[]>>({});
  const [unassigned, setUnassigned] = useState<ProjectSession[]>([]);
  const [conversation, setConversation] = useState<{ sessions: Session[]; prompt: string }>({ sessions: [], prompt: "" });
  const { sessions, prompt } = conversation;
  const [stoppingTaskId, setStoppingTaskId] = useState<string | null>(null);
  const setPrompt = (value: string) => setConversation((current) => ({ ...current, prompt: value }));
  const [activeSessionId, setActiveSessionId] = useState<number | null>(null);
  const [view, setView] = useState<{ kind: "main" } | { kind: "settings" } | { kind: "agent"; taskId: string }>({ kind: "main" });
  const [plan, setPlan] = useState<Plan | null>(null);
  const [events, setEvents] = useState<DbEvent[] | null>(null);
  const [eventsError, setEventsError] = useState<string | null>(null);
  const [eventsTruncated, setEventsTruncated] = useState(false);
  const [approvingSessionId, setApprovingSessionId] = useState<number | null>(null);
  const sendingRef = useRef(false);
  const [detectedHarnesses, setDetectedHarnesses] = useState<DetectedHarness[]>([]);
  const [selectedHarness, setSelectedHarness] = useState<string | null>(null);
  const planGeneration = useRef(0);
  const titleUpdates = useRef<{ sequence: number; titles: Map<number, { sequence: number; title: string }> }>({ sequence: 0, titles: new Map() });
  const eventsRef = useRef(events);
  eventsRef.current = events;
  const eventsGeneration = useRef(0);
  const [filter, setFilter] = useState("");
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
  const activeProject = projects.find((project) => project.id === activeSessionProjectId);
  const chatScrollRef = useRef<HTMLElement>(null);
  const activePlan = plan?.session_id === activeSessionId ? plan : null;
  const activeTask = view.kind === "agent" ? activePlan?.tasks.find((task) => task.id === view.taskId) : undefined;
  const effectiveRightCollapsed = rightCollapsed || windowWidth < 1200;
  const widths = regionWidths(windowWidth, { leftFraction, rightFraction, leftCollapsed, rightCollapsed: effectiveRightCollapsed });
  const refreshWidths = () => { setLeftFraction(readFraction(storage.left)); setRightFraction(readFraction(storage.right)); };


  const reloadProjects = useCallback(async () => {
    const titleSequence = titleUpdates.current.sequence;
    const [entries, orphaned] = await Promise.all([projectTree(), projectUnassignedSessions()]);
    setProjects(entries.map((entry) => entry.project));
    setTree(Object.fromEntries(entries.map((entry) => [entry.project.id, applyRecentTitles(entry.sessions, titleUpdates.current.titles, titleSequence)])));
    setUnassigned(applyRecentTitles(orphaned, titleUpdates.current.titles, titleSequence));
  }, []);

  useEffect(() => {
    let cancelled = false;
    const titleSequence = titleUpdates.current.sequence;
    Promise.all([projectTree(), projectUnassignedSessions(), listSessions()]).then(([entries, orphaned, allSessions]) => {
      if (cancelled) return;
      setProjects(entries.map((entry) => entry.project));
      setTree(Object.fromEntries(entries.map((entry) => [entry.project.id, applyRecentTitles(entry.sessions, titleUpdates.current.titles, titleSequence)])));
      setUnassigned(applyRecentTitles(orphaned, titleUpdates.current.titles, titleSequence));
      setConversation((current) => ({ ...current, sessions: applyRecentTitles(allSessions, titleUpdates.current.titles, titleSequence).map((item) => ({ ...item, subAgents: [] })) }));
      const assigned = new Set(entries.flatMap((entry) => entry.sessions.map((session) => session.id)));
      setActiveSessionId(allSessions.find((session) => assigned.has(session.id))?.id ?? null);
    }).catch(() => { if (!cancelled) setError("Backend isn't available."); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    listDetectedHarnesses().then((harnesses) => {
      if (cancelled) return;
      setDetectedHarnesses(harnesses);
      setSelectedHarness((current) => {
        if (current) return current;
        const runnableAcp = harnesses.find((h) => h.capabilities.transport.toLowerCase() === "acp" && h.runnable);
        return runnableAcp?.capabilities.harness_id ?? null;
      });
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const generation = ++planGeneration.current;
    setPlan(null);
    if (activeSessionId !== null) {
      void getPlan(activeSessionId).then((value) => {
        if (planGeneration.current === generation) setPlan(value);
      }).catch((reason) => {
        if (planGeneration.current === generation) setError(`Could not load plan: ${String(reason)}`);
      });
    }
    return () => { planGeneration.current++; };
  }, [activeSessionId]);

  useEffect(() => {
    if (activeSessionId === null) { setEvents(null); return; }
    let cancelled = false;
    eventsRef.current = null;
    setEvents(null);
    const generation = ++eventsGeneration.current;
    setEventsError(null);
    setEventsTruncated(false);
    void loadSessionEvents(activeSessionId).then((value) => {
      if (!cancelled && eventsGeneration.current === generation) {
        setEvents((current) => mergeEvents(value, current ?? []).events);
        setEventsTruncated(false);
      }
    }).catch((reason) => {
      if (!cancelled && eventsGeneration.current === generation) {
        setEventsError(`Could not load events: ${String(reason)}`);
      }
    });
    return () => {
      cancelled = true;
      eventsGeneration.current++;
    };
  }, [activeSessionId]);

  useEffect(() => {
    if (activeSessionId === null) return;
    const sessionId = activeSessionId;
    let debounceTimer: number | null = null;
    let unlisten: (() => void) | null = null;
    let isSubscribed = true;

    let isFetching = false;
    let pendingFetch = false;

    const runFetch = async () => {
      if (isFetching) {
        pendingFetch = true;
        return;
      }
      isFetching = true;
      const generation = eventsGeneration.current;

      try {
        try {
          const updatedPlan = await getPlan(sessionId);
          if (isSubscribed && eventsGeneration.current === generation) {
            setPlan(updatedPlan);
          }
        } catch {
          // Retain current plan on transient error
        }

        try {
          const current = eventsRef.current ?? [];
          const result = await fetchIncrementalEvents(sessionId, current);
          if (isSubscribed && eventsGeneration.current === generation) {
            if (result.events.some((event) => event.kind === "user_message" && !current.some((existing) => existing.id === event.id))) void reloadProjects().catch(() => {});
            setEvents((latest) => mergeEvents(latest ?? [], result.events).events);
            setEventsTruncated(result.truncated);
            setEventsError(null);
          }
        } catch (err) {
          if (isSubscribed && eventsGeneration.current === generation) setEventsError(String(err instanceof Error ? err.message : err));
        }
      } finally {
        isFetching = false;
        if (pendingFetch && isSubscribed) {
          pendingFetch = false;
          void runFetch();
        }
      }
    };

    onRunnerEvent((payload) => {
      if (payload.sessionId !== sessionId) return;
      clearTimeout(debounceTimer ?? undefined);
      debounceTimer = window.setTimeout(() => {
        void runFetch();
      }, 250);
    }).then((cleanup) => {
      if (!isSubscribed) {
        cleanup();
      } else {
        unlisten = cleanup;
        void runFetch();
      }
    }).catch(() => {});

    return () => {
      isSubscribed = false;
      clearTimeout(debounceTimer ?? undefined);
      if (unlisten) unlisten();
    };
  }, [activeSessionId, reloadProjects]);

  useEffect(() => {
    let subscribed = true;
    let unlisten: (() => void) | undefined;
    void onSessionTitle(({ sessionId, title }) => {
      const sequence = ++titleUpdates.current.sequence;
      titleUpdates.current.titles.set(sessionId, { sequence, title });
      setTree((current) => Object.fromEntries(Object.entries(current).map(([id, items]) => [id, withSessionTitle(items, sessionId, title)])));
      setUnassigned((current) => withSessionTitle(current, sessionId, title));
      setConversation((current) => ({ ...current, sessions: withSessionTitle(current.sessions, sessionId, title) }));
    }).then((cleanup) => { if (subscribed) unlisten = cleanup; else cleanup(); }).catch(() => {});
    return () => { subscribed = false; unlisten?.(); };
  }, []);

  useEffect(() => { const element = chatScrollRef.current; if (element) element.scrollTop = element.scrollHeight; }, [events, activeSessionId, view.kind]);

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
      else if (action === "settings") setView({ kind: "settings" });
      else { const project = projects.find((item) => item.id === activeSessionProjectId) ?? projects[0]; if (project) void createNewSession(project); }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  });

  async function createNewSession(project: Project) {
    try {
      const created = await createSession("New session", project.id, false, project.rootPath);
      const session = { ...created, subAgents: [] };
      setConversation((current) => nextStateAfterCreate(current, session)); setActiveSessionId(session.id); setView({ kind: "main" });
      await reloadProjects(); setError(null);
    } catch (reason) { setError(`Could not create session: ${String(reason)}`); }
  }
  async function addProject() {
    try { const added = await addProjectFromPicker(); if (added) { await reloadProjects(); setError(null); } }
    catch (reason) { setError(`Could not add project: ${String(reason)}`); }
  }
  async function toggleWorktree() {
    if (!activeSession || activeProject?.isGit === false) return;
    try {
      const updated = await setSessionWorktree(activeSession.id, !activeSession.optInWorktree);
      setConversation((current) => ({ ...current, sessions: current.sessions.map((item) => item.id === updated.id ? { ...item, ...updated } : item) })); setError(null);
    } catch (reason) { setError(`Could not update worktree setting: ${String(reason)}`); }
  }
  async function toggleConcise() {
    if (!activeSession) return;
    await toggleSessionConcise<Session>(
      activeSession.id,
      (updater) => {
        setConversation((current) => {
          const next = updater({ sessions: current.sessions, error });
          setError(next.error);
          return { ...current, sessions: next.sessions };
        });
      },
      sessionSetConcise
    );
  }
  async function approveCurrentPlan(revision: number) {
    if (!activeSession || approvingSessionId !== null) return;
    const sessionId = activeSession.id;
    const generation = planGeneration.current;
    setApprovingSessionId(sessionId);
    try {
      await approvePlan(sessionId, revision);
      await runnerStart(sessionId);
      const updated = await getPlan(sessionId);
      if (planGeneration.current === generation) { setPlan(updated); setError(null); }
    } catch (reason) {
      if (planGeneration.current === generation) {
        setError(`Could not approve, start, or reload plan: ${String(reason)}`);
        try {
          const refreshed = await getPlan(sessionId);
          if (planGeneration.current === generation) setPlan(refreshed);
        } catch {
          // Keep the original error visible if refreshing also fails.
        }
      }
    } finally {
      setApprovingSessionId(null);
    }
  }
  async function stopChatTask(taskId: string) {
    if (!activeSession || stoppingTaskId !== null) return;
    setStoppingTaskId(taskId);
    try { await runnerStop(activeSession.id, taskId); setError(null); }
    catch (reason) { setError(`Could not stop task: ${String(reason)}`); }
    finally { setStoppingTaskId(null); }
  }
  async function handleSend() {
    if (!activeSession || !selectedHarness || !prompt.trim() || sendingRef.current) return;
    const state = sendState({ text: prompt, harness: selectedHarness, plan: activePlan });
    if (!state.enabled) return;
    const generation = planGeneration.current;
    sendingRef.current = true;
    try {
      const task = activePlan?.tasks.length === 1 ? activePlan.tasks[0] : null;
      if (task && (task.status === "running" || task.status === "review")) {
        await runnerSend(activeSession.id, task.id, prompt.trim());
      } else {
        const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
        const tasks = buildOneTaskPlan(prompt, selectedHarness, activeProject?.isGit !== false && activeSession.optInWorktree, suffix);
        await startDirectRun(activeSession.id, tasks);
        const updated = await getPlan(activeSession.id);
        if (planGeneration.current === generation) setPlan(updated);
        void reloadProjects().catch(() => {});
      }
      if (planGeneration.current === generation) { setPrompt(""); setError(null); }
    } catch (reason) {
      if (planGeneration.current === generation) {
        setError(`Could not send message: ${String(reason)}`);
        void getPlan(activeSession.id).then((updated) => { if (planGeneration.current === generation) setPlan(updated); }).catch(() => {});
      }
    } finally {
      sendingRef.current = false;
    }
  }


  return (
    <TooltipProvider>
      <div className="flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground">
        <SidebarProvider open={!leftCollapsed} onOpenChange={(open) => { setLeftCollapsed(!open); localStorage.setItem(storage.leftCollapsed, String(!open)); }} className="flex min-h-0 w-full flex-1">
          <Sidebar data-region="left" collapsible="none" className="h-full min-h-0 shrink-0 border-r w-(--sidebar-width)" style={{ "--sidebar-width": leftCollapsed ? `${geometry.rail / 16}rem` : regionWidthCss("left", leftFraction) } as React.CSSProperties}>
            <SidebarHeader className="gap-2 p-3">{leftCollapsed ? <div className="grid size-6 place-items-center rounded bg-primary text-primary-foreground">▦</div> : <><div className="flex h-8 items-center gap-2 px-1"><span className="grid size-6 place-items-center rounded bg-primary text-primary-foreground">▦</span><span className="font-medium">bentobox</span><span className="ml-auto text-xs text-muted-foreground">{version}</span></div><div className="relative"><Search className="absolute left-2 top-2.5 size-4 text-muted-foreground" /><Input ref={searchRef} aria-label="Search sessions" placeholder="Search sessions ⌘K" value={filter} onChange={(event) => setFilter(event.target.value)} className="h-8 pl-8" /></div></>}</SidebarHeader>
            <SidebarContent className="min-h-0 overflow-auto px-2">{!leftCollapsed && <ProjectTree projects={projects} sessionsByProject={tree} unassignedSessions={unassigned} activeSessionId={activeSessionId} filter={filter} loading={loading} expanded={expanded} onAddProject={() => void addProject()} onToggleProject={(id, open) => setExpanded((value) => ({ ...value, [id]: open }))} onSelectSession={(id) => { setActiveSessionId(id); setView({ kind: "main" }); }} onCreateSession={(project) => void createNewSession(project)} />}</SidebarContent>
            <SidebarFooter className="border-t p-2">{!leftCollapsed && <Button variant="ghost" className="justify-start" onClick={() => setView({ kind: "settings" })}><Settings2 /><span>Settings ⌘,</span></Button>}<Button variant="ghost" className="justify-start" onClick={() => { const value = !leftCollapsed; setLeftCollapsed(value); localStorage.setItem(storage.leftCollapsed, String(value)); }}><PanelRight />{!leftCollapsed && <span>Collapse ⌘B</span>}</Button></SidebarFooter>
          </Sidebar>
          {!leftCollapsed && <div role="separator" aria-label="Resize project sidebar" aria-orientation="vertical" aria-valuenow={Math.round(widths.left / windowWidth * 100)} aria-valuemin={Math.round(geometry.left.min / windowWidth * 100)} aria-valuemax={Math.round(geometry.left.max / windowWidth * 100)} tabIndex={0} className="w-1 shrink-0 cursor-col-resize hover:bg-ring focus-visible:bg-ring" onDoubleClick={() => { localStorage.removeItem(storage.left); setLeftFraction(null); }} onKeyDown={(event) => resizeKey(event, "left", leftFraction)} onPointerDown={(event) => beginResize(event, "left")} />}
          <main data-region="content" className="flex h-full min-h-0 min-w-0 flex-1 flex-col">{view.kind === "settings" ? <SettingsView onClose={() => setView({ kind: "main" })} /> : view.kind === "agent" && activeSession && activePlan && activeTask ? <AgentDetailView session={activeSession} plan={activePlan} task={activeTask} events={events} eventsError={eventsError} eventsTruncated={eventsTruncated} onBack={() => setView({ kind: "main" })} /> : <><TopBar session={activeSession} plan={activePlan} project={activeProject} collapsed={effectiveRightCollapsed} onToggle={() => { const next = !rightCollapsed; setRightCollapsed(next); localStorage.setItem(storage.rightCollapsed, String(next)); }} /><Chat session={activeSession} plan={activePlan} events={events} eventsError={eventsError} eventsTruncated={eventsTruncated} scrollRef={chatScrollRef} nonGit={activeProject?.isGit === false} busy={approvingSessionId === activeSessionId && activeSessionId !== null} stoppingTaskId={stoppingTaskId} onStop={(taskId) => void stopChatTask(taskId)} onApprove={(revision) => void approveCurrentPlan(revision)} onOpenAgent={(taskId) => setView({ kind: "agent", taskId })} prompt={prompt} onPromptChange={setPrompt} onToggleWorktree={toggleWorktree} onToggleConcise={toggleConcise} onCreateSession={() => { const project = activeProject ?? projects[0]; if (project) void createNewSession(project); }} error={error} loading={loading} harnesses={detectedHarnesses} selectedHarness={selectedHarness} onSelectHarness={setSelectedHarness} onSend={() => void handleSend()} onPermission={(taskId, requestId, decision) => { if (activeSession) void runnerRespondPermission(activeSession.id, taskId, requestId, decision).catch((reason) => setError(`Could not respond to permission: ${String(reason)}`)); }} onMode={(taskId, modeId) => { if (activeSession) void runnerSetMode(activeSession.id, taskId, modeId).catch((reason) => setError(`Could not change mode: ${String(reason)}`)); }} /></>}</main>
          {view.kind !== "settings" && !effectiveRightCollapsed && <><div role="separator" aria-label="Resize contextual panel" aria-orientation="vertical" aria-valuenow={Math.round(widths.right / windowWidth * 100)} aria-valuemin={Math.round(geometry.right.min / windowWidth * 100)} aria-valuemax={Math.round(geometry.right.max / windowWidth * 100)} tabIndex={0} className="w-1 shrink-0 cursor-col-resize hover:bg-ring focus-visible:bg-ring" onDoubleClick={() => { localStorage.removeItem(storage.right); setRightFraction(null); }} onKeyDown={(event) => resizeKey(event, "right", rightFraction)} onPointerDown={(event) => beginResize(event, "right")} />
          <div data-region="right" className="h-full min-h-0 shrink-0 overflow-hidden w-(--right-width)" style={{ "--right-width": regionWidthCss("right", rightFraction) } as React.CSSProperties}>{view.kind === "agent" && activeSession && activePlan && activeTask ? <AgentRightPanel session={activeSession} plan={activePlan} task={activeTask} events={events} eventsError={eventsError} /> : <RightPanel onUseAsPrompt={setPrompt} />}</div></>}
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
export function TopBar({ session, plan, project, collapsed, onToggle }: { session: (Session & { worktreeBranch?: string | null }) | null; plan: Plan | null; project?: Project; collapsed: boolean; onToggle: () => void }) {
  const phase = plan && plan.session_id === session?.id ? plan.phase : null;
  return <header className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
    <div className="flex min-w-0 items-center gap-2 text-sm"><span className="truncate text-muted-foreground">{project?.name ?? "Projects"}</span>{session && <><ChevronRight className="size-3.5 text-muted-foreground" /><span className="truncate">{session.title}</span></>}</div>
    {session?.optInWorktree && <span className="ml-2 inline-flex items-center gap-1 rounded border px-2 py-1 text-xs"><GitBranch className="size-3" />{session.worktreeBranch ? <span className="font-mono">{session.worktreeBranch}</span> : "Worktree on"}</span>}
    <div className="ml-auto flex items-center" aria-label="Plan phases">
      {(["Plan", "Approve", "Build", "Review"] as const).map((step, idx) => {
        const state = phaseStepState(phase, step);
        return (
          <span key={step} className="flex items-center">
            {idx > 0 && <span className="h-px w-3 bg-border" />}
            <span
              aria-current={state === "current" ? "step" : undefined}
              className={`inline-flex h-6 items-center gap-1.5 rounded-full px-2 text-xs ${
                state === "current"
                  ? "bg-surface-elevated font-medium text-foreground"
                  : state === "done"
                  ? "text-foreground"
                  : "text-muted-foreground"
              }`}
            >
              <span
                className={`size-1.5 rounded-full ${
                  state === "current"
                    ? "bg-warning"
                    : state === "done"
                    ? "bg-success"
                    : "bg-muted-foreground"
                }`}
              />
              {step}
            </span>
          </span>
        );
      })}
      {phase === "Rejected" || phase === "Closed" || phase === "Cancelled" ? (
        <span className="ml-2 text-xs text-muted-foreground">{phase}</span>
      ) : null}
    </div>
    <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon" aria-label="Toggle right panel ⌥⌘B" aria-pressed={!collapsed} onClick={onToggle}><PanelRight /></Button></TooltipTrigger><TooltipContent>Toggle right panel ⌥⌘B</TooltipContent></Tooltip>
  </header>;
}

/** @adr ADR-0016.D2 */
export interface ChatProps {
  session: Session | null;
  plan: Plan | null;
  busy: boolean;
  onApprove: (revision: number) => void;
  onOpenAgent: (taskId: string) => void;
  prompt: string;
  onPromptChange: (value: string) => void;
  onToggleWorktree: () => void;
  onToggleConcise?: () => void;
  onCreateSession: () => void;
  error: string | null;
  loading: boolean;
  harnesses?: DetectedHarness[];
  selectedHarness?: string | null;
  onSelectHarness?: (harnessId: string) => void;
  onSend?: () => void;
  events?: DbEvent[] | null;
  eventsError?: string | null;
  eventsTruncated?: boolean;
  scrollRef?: React.Ref<HTMLElement>;
  nonGit?: boolean;
  onPermission?: (taskId: string, requestId: string, decision: "allow" | "deny" | "allow_always") => void;
  onMode?: (taskId: string, modeId: string) => void;
  stoppingTaskId?: string | null;
  onStop?: (taskId: string) => void;
}

/** @adr ADR-0016.D2 */
export function Chat({
  session,
  plan,
  busy,
  onApprove,
  onOpenAgent,
  prompt,
  onPromptChange,
  onToggleWorktree,
  onToggleConcise,
  onCreateSession,
  error,
  loading,
  harnesses = [],
  selectedHarness = null,
  onSelectHarness,
  onSend,
  events = null,
  eventsError,
  eventsTruncated,
  scrollRef,
  nonGit = false,
  onPermission,
  onMode,
  stoppingTaskId = null,
  onStop,
}: ChatProps) {
  const harnessOptions = getComposerHarnessOptions(harnesses);
  const chosenOption = harnessOptions.find((opt) => opt.harnessId === selectedHarness);
  const currentSendState = sendState({
    text: prompt,
    harness: selectedHarness,
    plan,
  });
  const sendDisabled = !currentSendState.enabled || !session;
  const tasks = plan?.tasks ?? [];
  const parts = tasks.map((task) => ({ task, ...partitionChatTimeline(events ?? [], task) }));
  const chatItems = parts.flatMap(({ task, chatItems }) => chatItems.map((event) => ({ task, event }))).sort((a, b) => a.event.id - b.event.id);
  const chatIds = new Set(chatItems.map(({ event }) => event.id));
  const activityItems = (events ?? []).filter((event) => !chatIds.has(event.id));
  const task = tasks.length === 1 ? tasks[0] : null;
  let modes: { id: string; name: string }[] = [];
  let currentMode: string | null = null;
  for (const event of events ?? []) {
    const payload = event.payload && typeof event.payload === "object" && !Array.isArray(event.payload) ? event.payload as Record<string, JsonValue> : {};
    if (!task || payload.plan_task_id !== task.id) continue;
    if (event.kind === "session_modes" && Array.isArray(payload.available)) {
      modes = payload.available.flatMap((mode) => mode && typeof mode === "object" && !Array.isArray(mode) && typeof mode.id === "string" && typeof mode.name === "string" ? [{ id: mode.id, name: mode.name }] : []);
      currentMode = typeof payload.current === "string" ? payload.current : null;
    } else if (event.kind === "session_mode_changed") currentMode = typeof payload.current === "string" ? payload.current : null;
  }

  return <>
    <section ref={scrollRef} className="min-h-0 flex-1 overflow-auto">
      <div className="mx-auto flex w-full flex-col gap-5 px-6 py-8 max-w-(--chat-max-width)" style={{ "--chat-max-width": "calc(720 * var(--fw))" } as React.CSSProperties}>
        {error && <p role="alert" className="text-sm text-muted-foreground">{error}</p>}
        {!session ? <div className="flex flex-col items-center gap-3 py-20 text-center text-sm text-muted-foreground">{loading ? "Loading sessions…" : "No session selected. Choose a project to create a session."}<Button variant="outline" onClick={onCreateSession} disabled={!session && loading}>New session</Button></div> : <>
          {showsPlanCard(plan) && plan && <PlanCard plan={plan} busy={busy} onApprove={onApprove} />}
          {plan?.tasks_started && tasks.length > 1 && tasks.map((item) => <SubAgentCard key={item.id} task={item} onOpen={() => onOpenAgent(item.id)} />)}
          {task && plan?.tasks_started && <Button type="button" variant="outline" onClick={() => onOpenAgent(task.id)}>Open agent</Button>}
          {task && (task.status === "running" || task.status === "review") && <Button type="button" variant="outline" disabled={stoppingTaskId === task.id} onClick={() => onStop?.(task.id)}>{stoppingTaskId === task.id ? "Stopping…" : "Stop"}</Button>}
          {eventsError && <p role="alert">{eventsError}</p>}
          {eventsTruncated && <p role="status">Showing the first 5,000 events</p>}
          {chatItems.map(({ task: itemTask, event }) => {
            const payload = event.payload && typeof event.payload === "object" && !Array.isArray(event.payload) ? event.payload as Record<string, JsonValue> : {};
            if (event.kind === "user_message") {
              return (
                <div key={event.id} data-chat-role="user" className="self-end max-w-[80%] rounded-lg bg-surface-elevated px-3 py-2 text-sm text-foreground">
                  <p className="whitespace-pre-wrap">{typeof payload.text === "string" ? payload.text : ""}</p>
                </div>
              );
            }
            if (event.kind === "agent_message") {
              return (
                <div key={event.id} data-chat-role="assistant" className="text-sm text-foreground">
                  <p className="whitespace-pre-wrap">{typeof payload.text === "string" ? payload.text : ""}</p>
                </div>
              );
            }
            const requestId = String(payload.request_id ?? event.id);
            const operation = typeof payload.operation === "string" ? payload.operation : "";
            const target = typeof payload.target === "string" ? payload.target : "";
            return (
              <div key={event.id} className="rounded-lg border border-warning/45 bg-card p-3 text-sm">
                <div className="mb-2 text-[11px] font-medium text-warning">PERMISSION REQUIRED</div>
                <p>{[operation, target].filter(Boolean).join(" ") || "Operation requested"}</p>
                <div className="flex gap-2 pt-2">
                  <Button type="button" size="sm" variant="outline" disabled={payload.can_deny === false} onClick={() => onPermission?.(itemTask.id, requestId, "deny")}>Deny</Button>
                  <Button type="button" size="sm" disabled={payload.can_allow === false} onClick={() => onPermission?.(itemTask.id, requestId, "allow")}>Allow</Button>
                  {payload.allow_always === true && <Button type="button" size="sm" variant="outline" onClick={() => onPermission?.(itemTask.id, requestId, "allow_always")}>Always allow</Button>}
                </div>
              </div>
            );
          })}
          {tasks.some((item) => item.status === "running") && <p role="status" className="text-sm text-muted-foreground">Agent working…</p>}
          {activityItems.length > 0 && <details className="rounded-lg border border-border bg-card p-3 text-sm"><summary className="cursor-pointer">Activity ({activityItems.length})</summary><ul className="mt-2 space-y-1 text-xs text-muted-foreground">{activityItems.map((event) => { const payload = event.payload && typeof event.payload === "object" && !Array.isArray(event.payload) ? event.payload as Record<string, JsonValue> : {}; const detail = [payload.tool, payload.target, payload.text, payload.status].find((value) => typeof value === "string"); return <li key={event.id} className="truncate">{event.kind}{typeof detail === "string" ? `: ${detail}` : ""}</li>; })}</ul></details>}
        </>}
      </div>
    </section>
    <div className="mx-auto w-full px-6 pb-5 max-w-(--chat-max-width)" style={{ "--chat-max-width": "calc(720 * var(--fw))" } as React.CSSProperties}>
      <form onSubmit={(event) => { event.preventDefault(); if (!sendDisabled && onSend) onSend(); }} className="rounded-lg border border-input bg-background focus-within:ring-1 focus-within:ring-ring">
        <Textarea aria-label="Prompt" value={prompt} onChange={(event) => onPromptChange(event.target.value)} placeholder={showsPlanCard(plan) ? PLAN_COMPOSER_PLACEHOLDER : "Describe the goal…"} className="min-h-16 resize-none border-0 shadow-none focus-visible:ring-0" />
        {currentSendState.reason && (
          <p id="send-disabled-reason" className="px-3 text-xs text-muted-foreground">{currentSendState.reason}</p>
        )}
        <div className="flex items-center gap-3 p-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="outline" className="text-xs">
                <span>{chosenOption ? chosenOption.displayName : "Select harness"}</span>
                <ChevronDown className="ml-1 size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-64 p-1">
              {harnessOptions.length === 0 ? (
                <div className="p-2 text-xs text-muted-foreground">No ACP harnesses detected</div>
              ) : (
                harnessOptions.map((opt) => (
                  <DropdownMenuItem
                    key={opt.harnessId}
                    disabled={!opt.runnable}
                    onClick={() => {
                      if (opt.runnable && onSelectHarness) onSelectHarness(opt.harnessId);
                    }}
                    className="flex flex-col items-start gap-0.5 p-2 text-xs cursor-pointer"
                  >
                    <div className="flex w-full items-center justify-between font-medium">
                      <span>{opt.displayName}</span>
                      {opt.harnessId === selectedHarness && <span className="text-xs text-primary">✓</span>}
                    </div>
                    {opt.launchNote && (
                      <span className="text-xs text-muted-foreground">{opt.launchNote}</span>
                    )}
                    {!opt.runnable && opt.disabledReason && !opt.launchNote && (
                      <span className="text-xs text-muted-foreground">{opt.disabledReason}</span>
                    )}
                  </DropdownMenuItem>
                ))
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          {task && modes.length > 0 && <label className="text-xs">Mode <select aria-label="Mode" value={currentMode ?? ""} onChange={(event) => onMode?.(task.id, event.target.value)} className="rounded border bg-background p-1">{currentMode === null && <option value="" disabled>Select mode</option>}{modes.map((mode) => <option key={mode.id} value={mode.id}>{mode.name}</option>)}</select></label>}
          <label className="flex items-center gap-2 text-xs text-muted-foreground"><Switch checked={session?.conciseReplies ?? false} onCheckedChange={onToggleConcise} disabled={!session} />Concise</label>
          <label title={nonGit ? "Not a git repository: worktree isolation is unavailable" : undefined} className="flex items-center gap-2 text-xs text-muted-foreground"><Switch checked={!nonGit && (session?.optInWorktree ?? false)} onCheckedChange={onToggleWorktree} disabled={!session || nonGit} />Worktree{nonGit && <span>Not a git repository: worktree isolation is unavailable</span>}</label>
          <Button type="submit" size="icon-sm" disabled={sendDisabled} aria-label="Send" aria-describedby={currentSendState.reason ? "send-disabled-reason" : undefined} className="ml-auto"><ArrowUp className="size-4" /></Button>
        </div>
      </form>
    </div>
  </>;
}

