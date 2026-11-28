import type { Update } from "@tauri-apps/plugin-updater";
import { useState } from "react";
import { Button } from "../../components/ui/button";
import { Card, CardContent } from "../../components/ui/card";
import { Progress } from "../../components/ui/progress";
import { checkForUpdate, installUpdate, type DownloadProgress } from "./api";

type State =
  | { phase: "idle" }
  | { phase: "checking" }
  | { phase: "current" }
  | { phase: "available"; update: Update }
  | { phase: "installing"; progress: DownloadProgress }
  | { phase: "error"; during: "check" | "install"; message: string };

/** @adr ADR-0013.D4 */
export function UpdatesSection() {
  const [state, setState] = useState<State>({ phase: "idle" });
  const busy = state.phase === "checking" || state.phase === "installing";

  async function handleCheck() {
    setState({ phase: "checking" });
    try {
      const result = await checkForUpdate();
      setState(result.status === "available" ? { phase: "available", update: result.update } : { phase: "current" });
    } catch (error) {
      setState({ phase: "error", during: "check", message: error instanceof Error ? error.message : String(error) });
    }
  }

  async function handleInstall(update: Update) {
    setState({ phase: "installing", progress: { downloaded: 0, total: null } });
    try {
      await installUpdate(update, (progress) => setState({ phase: "installing", progress }));
    } catch (error) {
      setState({ phase: "error", during: "install", message: error instanceof Error ? error.message : String(error) });
    }
  }

  const percent = state.phase === "installing" && state.progress.total ? Math.round((state.progress.downloaded / state.progress.total) * 100) : null;

  return (
    <section aria-label="Updates">
      <h2 className="mb-2 font-medium">App updates</h2>
      <p className="mb-4 text-sm text-muted-foreground">BentoBox checks for updates only when you ask. Every update is verified against the signing key built into this version before it installs.</p>
      <Card className="shadow-none">
        <CardContent className="space-y-3">
          <p>{state.phase === "idle" && "No check has run yet."}
            {state.phase === "checking" && "Checking for updates…"}
            {state.phase === "current" && "BentoBox is up to date."}
            {state.phase === "available" && `Version ${state.update.version} is available (you have ${state.update.currentVersion}).`}
            {state.phase === "installing" && (percent === null ? "Downloading update…" : `Downloading update… ${percent}%`)}
            {state.phase === "error" && (state.during === "check" ? "The update check failed." : "The update did not install.")}</p>
          {state.phase === "available" && state.update.body && <p className="whitespace-pre-wrap text-sm text-muted-foreground">{state.update.body}</p>}
          {state.phase === "installing" && percent !== null && <Progress value={percent} aria-label="Update download progress" />}
          {state.phase === "error" && <p role="alert" className="text-sm text-muted-foreground">{state.message}</p>}
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={busy} onClick={() => void handleCheck()}>Check for updates</Button>
            {state.phase === "available" && <Button size="sm" onClick={() => void handleInstall(state.update)}>Install and restart</Button>}
          </div>
          {state.phase === "available" && <p className="text-sm text-muted-foreground">Installing restarts BentoBox. It is refused while agent tasks are running.</p>}
        </CardContent>
      </Card>
    </section>
  );
}
