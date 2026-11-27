import { useEffect, useState } from "react";
import { AlertCircle, CircleDot, ExternalLink, GitPullRequest } from "lucide-react";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { ScrollArea } from "../../components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../components/ui/tabs";
import { checkGitHubStatus, listGitHubIssues, listGitHubPullRequests, openGitHubUrl, type GhIssue, type GhPullRequest, type GhStatus } from "./api";

type GitHubItem = (GhIssue | GhPullRequest) & { kind: "issue" | "pull request" };

/** @adr ADR-0008.D1 */
export interface GitHubPanelProps {
  onUseAsPrompt?: (prompt: string) => void;
}


function itemKey(item: GitHubItem): string {
  return `${item.kind}-${item.number}`;
}

/** @adr ADR-0008.D1 */
export function GitHubPanel({ onUseAsPrompt }: GitHubPanelProps) {
  const [status, setStatus] = useState<GhStatus | null>(null);
  const [items, setItems] = useState<GitHubItem[]>([]);
  const [opened, setOpened] = useState<GitHubItem[]>([]);
  const [selectedKey, setSelectedKey] = useState("list");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    void (async () => {
      const result = await checkGitHubStatus();
      if (!current) return;
      setStatus(result);
      if (!result.installed || !result.authenticated) {
        setLoading(false);
        return;
      }
      try {
        const [issues, prs] = await Promise.all([listGitHubIssues(), listGitHubPullRequests()]);
        if (current) setItems([
          ...issues.map((item) => ({ ...item, kind: "issue" as const })),
          ...prs.map((item) => ({ ...item, kind: "pull request" as const })),
        ]);
      } catch (cause) {
        if (current) setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        if (current) setLoading(false);
      }
    })();
    return () => { current = false; };
  }, []);

  const selected = opened.find((item) => itemKey(item) === selectedKey);
  const unavailable = status && (!status.installed || !status.authenticated);
  const openItem = (item: GitHubItem) => {
    const key = itemKey(item);
    setOpened((previous) => previous.some((entry) => itemKey(entry) === key) ? previous : [...previous, item]);
    setSelectedKey(key);
  };

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <Tabs value={selected ? selectedKey : "list"} onValueChange={setSelectedKey} className="min-h-0 flex-1 gap-0">
        <div className="flex h-12 shrink-0 items-center border-b px-2">
          <TabsList variant="line" className="h-full max-w-full overflow-x-auto">
            <TabsTrigger value="list">Issues &amp; PRs</TabsTrigger>
            {opened.map((item) => <TabsTrigger key={itemKey(item)} value={itemKey(item)} aria-label={`${item.kind} #${item.number}`}>#{item.number}</TabsTrigger>)}
          </TabsList>
        </div>
        <TabsContent value="list" className="min-h-0 overflow-hidden">
          {unavailable ? (
            <div className="space-y-2 p-4 text-sm">
              <p className="flex items-center gap-2 text-muted-foreground"><AlertCircle className="size-4" />{status.message}</p>
              <p className="text-muted-foreground">Run <code>gh auth login</code> to connect GitHub.</p>
            </div>
          ) : loading ? <p className="p-4 text-sm text-muted-foreground">Loading GitHub items…</p> : error ? (
            <p className="p-4 text-sm text-muted-foreground">GitHub items unavailable: {error}</p>
          ) : <ScrollArea className="h-full">
            {items.length === 0 ? <p className="p-4 text-sm text-muted-foreground">No issues or pull requests.</p> : <ul className="space-y-1 p-2">
              {items.map((item) => <li key={itemKey(item)}>
                <button type="button" onClick={() => openItem(item)} className="flex h-8 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-accent">
                  {item.kind === "issue" ? <CircleDot className="size-4 shrink-0 text-muted-foreground" /> : <GitPullRequest className="size-4 shrink-0 text-muted-foreground" />}
                  <span className="min-w-0 flex-1 truncate">{item.title}</span><span className="shrink-0 text-xs text-muted-foreground">#{item.number}</span>
                </button>
              </li>)}
            </ul>}
          </ScrollArea>}
        </TabsContent>
        {opened.map((item) => <TabsContent key={itemKey(item)} value={itemKey(item)} className="min-h-0 overflow-auto p-4">
          <div className="space-y-4">
            <div className="space-y-2">
              <h2 className="text-base font-medium">{item.title}</h2>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <span aria-hidden="true" className={`size-2 rounded-full ${item.state.toLowerCase() === "open" ? "bg-success" : "bg-muted-foreground"}`} />
                <span className="state-label">{item.state}</span><span>#{item.number}</span><Badge variant="outline">{item.kind}</Badge>
              </div>
              {"headRefName" in item && item.headRefName && <p className="truncate text-xs text-muted-foreground">{item.headRefName}</p>}
            </div>
            <p className="text-sm text-muted-foreground">Details aren't loaded yet.</p>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => void openGitHubUrl(item.url)}><ExternalLink />Open in browser</Button>
              <Button size="sm" onClick={() => onUseAsPrompt?.(`${item.kind} #${item.number}: ${item.title}\n${item.url}`)}>Use as prompt</Button>
            </div>
          </div>
        </TabsContent>)}
      </Tabs>
    </section>
  );
}
