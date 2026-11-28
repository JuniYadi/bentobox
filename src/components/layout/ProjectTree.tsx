import { Check, ChevronDown, ChevronRight, Plus, TriangleAlert } from "lucide-react";
import { SidebarGroup, SidebarGroupAction, SidebarGroupContent, SidebarGroupLabel, SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "../ui/sidebar";
import { sessionGlyph, type Project, type ProjectSession } from "../../features/project/api";

/** @adr ADR-0016.D2 */
/** @adr ADR-0019.D1 */
/** @adr ADR-0019.D2 */
export interface ProjectTreeProps {
  projects: Project[];
  sessionsByProject: Record<number, ProjectSession[]>;
  unassignedSessions?: ProjectSession[];
  activeSessionId: number | null;
  filter: string;
  loading: boolean;
  expanded: Record<number, boolean>;
  onAddProject: () => void;
  onToggleProject: (id: number, expanded: boolean) => void;
  onSelectSession: (id: number) => void;
  onCreateSession: (project: Project) => void;
}

function Glyph({ item }: { item: ProjectSession }) {
  const glyph = sessionGlyph(item);
  if (glyph === "done") return <span className="grid size-3.5 shrink-0 place-items-center"><Check aria-label={glyph} className="size-3.5 text-success" /></span>;
  const color = glyph === "needs-approval" ? "text-warning" : glyph === "failed" ? "text-danger" : "text-muted-foreground";
  return <span className="grid size-3.5 shrink-0 place-items-center"><span aria-label={glyph} className={glyph === "idle" ? `size-2 rounded-full border border-current ${color}` : `size-1.75 rounded-full bg-current ${color}`} /></span>;
}

function sessionMeta(activity: string) {
  const elapsed = Date.now() - new Date(activity).getTime();
  if (!Number.isFinite(elapsed) || elapsed < 0) return "";
  const minutes = Math.floor(elapsed / 60000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
}

/** @adr ADR-0016.D2 */
/** @adr ADR-0019.D1 */
/** @adr ADR-0019.D2 */
export function ProjectTree({ projects, sessionsByProject, unassignedSessions = [], activeSessionId, filter, loading, expanded, onAddProject, onToggleProject, onSelectSession, onCreateSession }: ProjectTreeProps) {
  const search = filter.toLowerCase();
  const matches = projects.filter((project) => (project.name + " " + (sessionsByProject[project.id] ?? []).map((session) => session.title).join(" ")).toLowerCase().includes(search));
  return <SidebarGroup>
    <SidebarGroupLabel>Projects</SidebarGroupLabel>
    <SidebarGroupAction aria-label="Add project" title="Add project" onClick={onAddProject}><Plus /></SidebarGroupAction>
    <SidebarGroupContent>
      {matches.map((project) => {
        const sessions = (sessionsByProject[project.id] ?? []).filter((item) => project.name.toLowerCase().includes(search) || item.title.toLowerCase().includes(search));
        const isOpen = expanded[project.id] ?? true;
        return <SidebarMenu key={project.id}>
          <SidebarMenuItem>
            <SidebarMenuButton onClick={() => onToggleProject(project.id, !isOpen)} aria-expanded={isOpen}><span>{isOpen ? <ChevronDown /> : <ChevronRight />}</span><span>{project.name}</span>{!project.isGit && <span title="Not a git repository: worktree isolation is unavailable" aria-label="Not a git repository: worktree isolation is unavailable"><TriangleAlert className="text-warning" /></span>}</SidebarMenuButton>
            {isOpen && <div className="ml-5 border-l pl-2">
              {sessions.map((item) => <SidebarMenuItem key={item.id}>
                <SidebarMenuButton className="h-7" isActive={item.id === activeSessionId} onClick={() => onSelectSession(item.id)} title={item.title}>
                  <Glyph item={item} /><span>{item.title}</span><span className="ml-auto text-xs text-muted-foreground">{sessionMeta(item.lastActivityAt)}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>)}
              <SidebarMenuItem><SidebarMenuButton className="h-7" onClick={() => onCreateSession(project)}><Plus /><span>New session</span></SidebarMenuButton></SidebarMenuItem>
            </div>}
          </SidebarMenuItem>
        </SidebarMenu>;
      })}
      {unassignedSessions.length > 0 && <SidebarMenu><SidebarMenuItem><div className="px-2 py-1 text-sm text-muted-foreground">Unassigned</div>{unassignedSessions.filter((item) => item.title.toLowerCase().includes(search) || "unassigned".includes(search)).map((item) => <SidebarMenuButton key={item.id} className="h-7" isActive={item.id === activeSessionId} onClick={() => onSelectSession(item.id)} title={item.title}><Glyph item={item} /><span>{item.title}</span><span className="ml-auto text-xs text-muted-foreground">{sessionMeta(item.lastActivityAt)}</span></SidebarMenuButton>)}</SidebarMenuItem></SidebarMenu>}
      {!loading && !projects.length && <p className="px-2 py-3 text-sm text-muted-foreground">No projects registered.</p>}
    </SidebarGroupContent>
  </SidebarGroup>;
}
