import { useEffect, useState } from "react";
import { Button } from "../../components/ui/button";
import { Card, CardContent } from "../../components/ui/card";
import { listDetectedHarnesses, type DetectedHarness } from "../agent/api";
import { getAuthStatus, type AuthStatus } from "../auth/api";
import { checkGitHubStatus, type GhStatus } from "../github/api";
import { TeamsSection } from "../teams/TeamsSection";
import { UpdatesSection } from "../updater/UpdatesSection";

/** @adr ADR-0016.D5 */
export const settingsSections = ["Harnesses", "Teams", "Updates", "GitHub"] as const;

type Section = (typeof settingsSections)[number];
type HarnessEntry = { harness: DetectedHarness; auth: AuthStatus | null };

/** @adr ADR-0016.D5 */
export function SettingsView({ onClose }: { onClose: () => void }) {
  const [section, setSection] = useState<Section>("Harnesses");
  const [harnesses, setHarnesses] = useState<HarnessEntry[] | null>(null);
  const [harnessError, setHarnessError] = useState<string | null>(null);
  const [github, setGithub] = useState<GhStatus | null>(null);

  useEffect(() => {
    let active = true;
    listDetectedHarnesses().then(async (detected) => {
      const entries = await Promise.all(detected.map(async (harness) => {
        try {
          return { harness, auth: await getAuthStatus(harness.capabilities.harness_id) };
        } catch {
          return { harness, auth: null };
        }
      }));
      if (active) setHarnesses(entries);
    }).catch((error: unknown) => {
      if (active) setHarnessError(error instanceof Error ? error.message : String(error));
    });
    checkGitHubStatus().then((status) => { if (active) setGithub(status); });
    return () => { active = false; };
  }, []);

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <header className="flex h-12 shrink-0 items-center justify-between border-b px-4">
        <div><span className="text-muted-foreground">Settings</span><span aria-hidden="true"> › </span>{section}</div>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close settings">×</Button>
      </header>
      <div className="flex min-h-0 flex-1">
        <nav aria-label="Settings sections" className="w-[clamp(10rem,calc(200*var(--fw)),15rem)] shrink-0 border-r p-4">
          <h2 className="mb-2 text-sm text-muted-foreground">Settings</h2>
          {settingsSections.map((name) => (
            <Button key={name} variant={section === name ? "secondary" : "ghost"} className="w-full justify-start" aria-current={section === name ? "page" : undefined} onClick={() => setSection(name)}>{name}</Button>
          ))}
        </nav>
        <main className="min-w-0 flex-1 overflow-auto p-6">
          <div className="mx-auto max-w-[calc(880*var(--fw))]">
            <div className="mb-6 flex items-start justify-between gap-4">
              <div><h1 className="text-xl font-medium">{section}</h1><p className="mt-1 text-sm text-muted-foreground">{section === "Harnesses" ? "Detected agent CLIs and their authentication status." : section === "Teams" ? "Configure roles and ordered model fallbacks for your agents." : "Connect your workflow using the GitHub CLI."}</p></div>
              <Button variant="outline" size="sm" onClick={onClose}>Back to session</Button>
            </div>
            {section === "Harnesses" && <section aria-label="Installed harnesses">
              <h2 className="mb-2 font-medium">Installed harnesses</h2>
              <p className="mb-4 text-sm text-muted-foreground">Authentication is managed by each agent's own login.</p>
              {harnessError && <p role="alert">Unable to detect harnesses: {harnessError}</p>}
              {!harnessError && harnesses === null && <p>Loading harnesses…</p>}
              {harnesses?.length === 0 && <p>No harnesses detected.</p>}
              {harnesses && harnesses.length > 0 && <Card className="gap-0 py-0 shadow-none"><CardContent className="divide-y px-4">{harnesses.map(({ harness, auth }) => <div key={harness.capabilities.harness_id} className="py-3"><div>{harness.capabilities.display_name}</div><div className="text-sm text-muted-foreground"><span>{harness.executable_path}</span> · {harness.capabilities.transport === "acp" ? "ACP" : "Native process"} · Authentication: {auth?.state ?? "unavailable"}</div></div>)}</CardContent></Card>}
            </section>}
            {section === "Teams" && <TeamsSection />}
            {section === "Updates" && <UpdatesSection />}
            {section === "GitHub" && <section><h2 className="mb-2 font-medium">Connection</h2><p className="mb-4 text-sm text-muted-foreground">BentoBox uses your existing GitHub CLI authentication.</p><Card className="shadow-none"><CardContent>{github === null ? "Checking GitHub CLI…" : <><p>{github.installed ? "GitHub CLI detected" : "GitHub CLI unavailable"}</p><p className="text-sm text-muted-foreground">{github.message}</p>{!github.installed && <p className="text-sm text-muted-foreground">Install the GitHub CLI to use GitHub features.</p>}{github.installed && !github.authenticated && <p className="text-sm text-muted-foreground">Run <code>gh auth login</code> to sign in.</p>}{github.authenticated && github.username && <p className="text-sm text-muted-foreground">Signed in as {github.username}</p>}</>}</CardContent></Card></section>}
          </div>
        </main>
      </div>
    </div>
  );
}
