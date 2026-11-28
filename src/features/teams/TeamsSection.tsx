import { useEffect, useRef, useState } from "react";
import { Button } from "../../components/ui/button";
import { Card, CardContent } from "../../components/ui/card";
import { Input } from "../../components/ui/input";
import { Badge } from "../../components/ui/badge";
import { listDetectedHarnesses, agentListModels, type DetectedHarness } from "../agent/api";
import { getAuthStatus, type AuthStatus } from "../auth/api";
import { settingsGet, settingsSet } from "../settings/api";
import {
  teamsList,
  teamsUpsert,
  teamsDelete,
  teamsSetDefault,
  teamsGeneratePreview,
  teamsApplyGenerated,
  type Team,
  type TeamRole,
  type TeamStep,
  type GenerateTeamsRules,
  type GeneratedTeamDiff,
} from "./api";

/** @adr ADR-0011.D1 */
export interface SubscriptionEntry {
  harness: DetectedHarness;
  auth: AuthStatus | null;
  models: string[];
}

/** @adr ADR-0011.D2 */
export interface TeamsSectionController {
  generatePreview: () => Promise<void>;
  applyPreview: () => Promise<void>;
  discardPreview: () => void;
  getPreview: () => GeneratedTeamDiff[] | null;
  createTeam: () => Promise<void>;
  deleteTeam: (id: string) => Promise<void>;
  setDefaultRole: (id: string) => Promise<void>;
}

/** @adr ADR-0011.D1 */
export interface TeamsSectionProps {
  initialTeams?: Team[];
  initialSubscriptions?: SubscriptionEntry[];
  initialPreview?: GeneratedTeamDiff[];
  initialDefaultEffort?: "low" | "medium" | "high";
  initialUnavailableAction?: "ask" | "fallback";
  onStateReady?: (controller: TeamsSectionController) => void;
}

const ROLE_CAPTIONS: Record<TeamRole, string> = {
  orchestrator: "Read-only planning and delegation · fallback order",
  sub_agents: "Work in isolated git worktrees · fallback order",
  review: "Diff and implementation review · fallback order",
};
function validateTeamName(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) {
    return "Team name cannot be empty.";
  }
  if (/\s/.test(name)) {
    return "Team name cannot contain whitespace.";
  }
  if (name.includes(":")) {
    return "Team name cannot contain ':'.";
  }
  return null;
}


/** @adr ADR-0011.D1 */
export function TeamsSection(props?: TeamsSectionProps) {
  const [teams, setTeams] = useState<Team[] | null>(props?.initialTeams ?? null);
  const [teamsError, setTeamsError] = useState<string | null>(null);
  const [subscriptions, setSubscriptions] = useState<SubscriptionEntry[] | null>(
    props?.initialSubscriptions ?? null
  );
  const [catalogs, setCatalogs] = useState<Record<string, string[]>>({});
  const [nameErrors, setNameErrors] = useState<Record<string, string | null>>({});

  // Generation state
  const [goal, setGoal] = useState<"cheapest" | "balanced" | "best_quality">("balanced");
  const [preferSubscriptions, setPreferSubscriptions] = useState(true);
  const [preferLocalSubagents, setPreferLocalSubagents] = useState(false);
  const [noFrontierSubagents, setNoFrontierSubagents] = useState(true);
  const [maxDepth, setMaxDepth] = useState(3);
  const [previewDiffs, setPreviewDiffs] = useState<GeneratedTeamDiff[] | null>(
    props?.initialPreview ?? null
  );
  const previewDiffsRef = useRef<GeneratedTeamDiff[] | null>(props?.initialPreview ?? null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isApplying, setIsApplying] = useState(false);

  // Defaults state
  const [defaultEffort, setDefaultEffort] = useState<"low" | "medium" | "high">(
    props?.initialDefaultEffort ?? "medium"
  );
  const [unavailableAction, setUnavailableAction] = useState<"ask" | "fallback">(
    props?.initialUnavailableAction ?? "ask"
  );

  const refreshTeams = async () => {
    try {
      const list = await teamsList();
      setTeams(list);
    } catch (err: unknown) {
      setTeamsError(err instanceof Error ? err.message : String(err));
    }
  };

  useEffect(() => {
    let active = true;

    if (props?.initialTeams === undefined) {
      refreshTeams();
    }

    if (props?.initialSubscriptions === undefined) {
      listDetectedHarnesses().then(async (detected) => {
        const catMap: Record<string, string[]> = {};
        const entries = await Promise.all(
          detected.map(async (harness) => {
            const hid = harness.capabilities.harness_id;
            let auth: AuthStatus | null = null;
            try {
              auth = await getAuthStatus(hid);
            } catch {
              auth = null;
            }
            let models: string[] = [];
            try {
              const catalog = await agentListModels(hid, false);
              models = catalog.models.map((m) => m.id);
              catMap[hid] = models;
            } catch {
              models = [];
              catMap[hid] = [];
            }
            return { harness, auth, models };
          })
        );
        if (active) {
          setSubscriptions(entries);
          setCatalogs(catMap);
        }
      }).catch(() => {});
    }

    if (props?.initialDefaultEffort === undefined) {
      settingsGet("routing.default_effort").then((val) => {
        if (active && (val === "low" || val === "medium" || val === "high")) {
          setDefaultEffort(val);
        }
      }).catch(() => {});
    }

    if (props?.initialUnavailableAction === undefined) {
      settingsGet("routing.unavailable_action").then((val) => {
        if (active && (val === "ask" || val === "fallback")) {
          setUnavailableAction(val);
        }
      }).catch(() => {});
    }

    return () => {
      active = false;
    };
  }, [props?.initialTeams, props?.initialSubscriptions, props?.initialDefaultEffort, props?.initialUnavailableAction]);

  const handleGeneratePreview = async () => {
    setIsGenerating(true);
    try {
      const rules: GenerateTeamsRules = {
        goal,
        preferSubscriptions,
        preferLocalSubagents,
        noFrontierSubagents,
        maxDepth: Math.max(1, Math.min(10, maxDepth || 3)),
      };
      const diffs = await teamsGeneratePreview(rules);
      previewDiffsRef.current = diffs;
      setPreviewDiffs(diffs);
    } catch (err: unknown) {
      setTeamsError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsGenerating(false);
    }
  };

  const handleApplyPreview = async () => {
    const currentDiffs = previewDiffsRef.current ?? previewDiffs;
    if (!currentDiffs) return;
    setIsApplying(true);
    try {
      const teamsToApply = currentDiffs.map((d) => d.team);
      await teamsApplyGenerated(teamsToApply);
      await refreshTeams();
      previewDiffsRef.current = null;
      setPreviewDiffs(null);
    } catch (err: unknown) {
      setTeamsError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsApplying(false);
    }
  };

  const handleDiscardPreview = () => {
    previewDiffsRef.current = null;
    setPreviewDiffs(null);
  };

  const handleUpdateTeam = async (updatedTeam: Team) => {
    const error = validateTeamName(updatedTeam.name);
    if (error) {
      setNameErrors((prev) => ({ ...prev, [updatedTeam.id]: error }));
      return;
    }
    setNameErrors((prev) => ({ ...prev, [updatedTeam.id]: null }));
    try {
      const saved = await teamsUpsert(updatedTeam);
      setTeams((prev) => (prev ? prev.map((t) => (t.id === saved.id ? saved : t)) : [saved]));
    } catch (err: unknown) {
      setTeamsError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleDeleteTeam = async (id: string) => {
    try {
      await teamsDelete(id);
      setTeams((prev) => (prev ? prev.filter((t) => t.id !== id) : []));
    } catch (err: unknown) {
      setTeamsError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleSetDefault = async (id: string) => {
    try {
      await teamsSetDefault(id);
      await refreshTeams();
    } catch (err: unknown) {
      setTeamsError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleCreateTeam = async () => {
    const firstHarness = subscriptions?.[0]?.harness.capabilities.harness_id;
    if (!firstHarness) return;

    const existingNames = new Set((teams ?? []).map((t) => t.name));
    let counter = 1;
    while (existingNames.has(`team-${counter}`)) {
      counter++;
    }
    const nextName = `team-${counter}`;

    const newTeam: Team = {
      id: "",
      name: nextName,
      role: "orchestrator",
      isDefault: false,
      steps: [{ harness: firstHarness, model: null, effort: null }],
    };
    try {
      const created = await teamsUpsert(newTeam);
      setTeams((prev) => (prev ? [...prev, created] : [created]));
    } catch (err: unknown) {
      setTeamsError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleDefaultEffortChange = async (effort: "low" | "medium" | "high") => {
    setDefaultEffort(effort);
    try {
      await settingsSet("routing.default_effort", effort);
    } catch (err: unknown) {
      setTeamsError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleUnavailableActionChange = async (action: "ask" | "fallback") => {
    setUnavailableAction(action);
    try {
      await settingsSet("routing.unavailable_action", action);
    } catch (err: unknown) {
      setTeamsError(err instanceof Error ? err.message : String(err));
    }
  };
  if (props?.onStateReady) {
    props.onStateReady({
      generatePreview: handleGeneratePreview,
      applyPreview: handleApplyPreview,
      discardPreview: handleDiscardPreview,
      getPreview: () => previewDiffsRef.current,
      createTeam: handleCreateTeam,
      deleteTeam: handleDeleteTeam,
      setDefaultRole: handleSetDefault,
    });
  }


  return (
    <div className="space-y-8">
      {/* Detected subscriptions */}
      <section aria-label="Detected subscriptions">
        <h2 className="mb-2 font-medium">Detected subscriptions</h2>
        <p className="mb-4 text-sm text-muted-foreground">
          Authentication is managed by each harness. Model availability depends on your account.
        </p>
        <Card className="shadow-none">
          <CardContent className="divide-y p-0">
            {!subscriptions && <div className="p-4 text-sm text-muted-foreground">Checking subscriptions…</div>}
            {subscriptions && subscriptions.length === 0 && (
              <div className="p-4 text-sm text-muted-foreground">No agent harnesses detected.</div>
            )}
            {subscriptions?.map(({ harness, auth, models }) => (
              <div
                key={harness.capabilities.harness_id}
                className="flex flex-wrap items-center justify-between gap-4 p-4 text-sm"
              >
                <div>
                  <div className="font-medium">{harness.capabilities.display_name}</div>
                  <div className="text-xs text-muted-foreground">
                    {auth?.auth_method ?? "Detected CLI"}
                  </div>
                </div>
                <div className="flex flex-wrap gap-1">
                  {models.length > 0 ? (
                    models.map((m) => (
                      <span
                        key={m}
                        className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground"
                      >
                        {m}
                      </span>
                    ))
                  ) : (
                    <span className="text-xs text-muted-foreground">No advertised models</span>
                  )}
                </div>
                <div className="text-right text-xs">
                  <div>
                    {auth?.state === "authenticated"
                      ? "Signed in"
                      : auth?.state
                      ? auth.state
                      : harness.runnable
                      ? "Available"
                      : "Offline"}
                  </div>
                  <div className="text-muted-foreground">quota Unavailable</div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </section>

      {/* Generate teams from subscriptions */}
      <section aria-label="Generate teams from subscriptions">
        <h2 className="mb-2 font-medium">Generate teams from my subscriptions</h2>
        <p className="mb-4 text-sm text-muted-foreground">
          Choose your priorities, then review suggested changes before applying them.
        </p>
        <Card className="shadow-none">
          <CardContent className="space-y-4 p-4 text-sm">
            <div>
              <div className="mb-2 font-medium text-xs text-muted-foreground">Goal preset</div>
              <div className="flex flex-wrap gap-4">
                {(["cheapest", "balanced", "best_quality"] as const).map((g) => (
                  <label key={g} className="flex items-center gap-1.5 capitalize cursor-pointer">
                    <input
                      type="radio"
                      name="goal"
                      value={g}
                      checked={goal === g}
                      onChange={() => setGoal(g)}
                    />
                    {g === "best_quality" ? "Best quality" : g}
                  </label>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={preferSubscriptions}
                  onChange={(e) => setPreferSubscriptions(e.target.checked)}
                />
                Use every subscription before paid API
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={preferLocalSubagents}
                  onChange={(e) => setPreferLocalSubagents(e.target.checked)}
                />
                Prefer local models for sub-agents
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={noFrontierSubagents}
                  onChange={(e) => setNoFrontierSubagents(e.target.checked)}
                />
                Never use frontier models for sub-agents
              </label>
              <div className="flex items-center gap-2 pt-1">
                <span>Max fallback depth</span>
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={maxDepth}
                  onChange={(e) => setMaxDepth(parseInt(e.target.value, 10) || 1)}
                  className="h-8 w-16 rounded border px-2 text-sm"
                  aria-label="Max fallback depth"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3 pt-2">
              <Button
                variant="default"
                size="sm"
                onClick={handleGeneratePreview}
                disabled={isGenerating}
              >
                {isGenerating ? "Generating…" : "Generate teams"}
              </Button>
              <span className="text-xs text-muted-foreground">
                Nothing changes until you apply.
              </span>
            </div>

            {/* Preview changes panel */}
            {previewDiffs && (
              <div
                id="preview"
                aria-label="Preview changes"
                className="mt-4 rounded-md border p-4 space-y-3 bg-muted/30"
              >
                <div className="font-medium">Preview changes</div>
                <div className="space-y-2 text-xs">
                  {previewDiffs.map((diff, idx) => (
                    <div key={idx} className="rounded border bg-background p-2.5">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-xs">
                          {diff.action === "add" ? "+ " : "~ "}
                        </span>
                        <strong className="font-medium">{diff.team.name}</strong>
                        <span className="text-muted-foreground">·</span>
                        <span>{diff.summary}</span>
                      </div>
                      {diff.warnings && diff.warnings.length > 0 && (
                        <div className="mt-1 text-muted-foreground space-y-0.5 pl-4">
                          {diff.warnings.map((w, wIdx) => (
                            <div key={wIdx}>⚠️ {w}</div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                <div className="flex items-center gap-2 pt-2">
                  <Button
                    variant="default"
                    size="sm"
                    onClick={handleApplyPreview}
                    disabled={isApplying}
                  >
                    {isApplying ? "Applying…" : "Apply"}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleDiscardPreview}
                    disabled={isApplying}
                  >
                    Discard
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      {/* Teams list */}
      <section aria-label="Teams">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-medium">Teams</h2>
          <Button
            variant="outline"
            size="sm"
            onClick={handleCreateTeam}
            disabled={!subscriptions || subscriptions.length === 0}
            title={
              subscriptions && subscriptions.length > 0
                ? undefined
                : "At least one detected subscription is required to create a team"
            }
          >
            + New team
          </Button>
        </div>
        <p className="mb-4 text-sm text-muted-foreground">
          A team is a role and an ordered fallback chain. The next step is tried when a step is not runnable, signed out, times out during start-up, or exits before producing output; quota is not detected.
        </p>

        {teamsError && (
          <p role="alert" className="text-sm text-destructive mb-4">
            {teamsError}
          </p>
        )}

        {!teams && <p className="text-sm text-muted-foreground">Loading teams…</p>}
        {teams && teams.length === 0 && (
          <p className="text-sm text-muted-foreground">No teams configured yet.</p>
        )}

        <div className="space-y-4">
          {teams?.map((team) => (
            <Card key={team.id} className="shadow-none">
              <CardContent className="space-y-4 p-4 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <Input
                        value={team.name}
                        aria-label={`Team name ${team.name}`}
                        className="h-8 w-40 text-sm font-medium"
                        onChange={(e) => {
                          const newName = e.target.value;
                          const error = validateTeamName(newName);
                          setNameErrors((prev) => ({ ...prev, [team.id]: error }));
                          setTeams((prev) =>
                            prev ? prev.map((t) => (t.id === team.id ? { ...t, name: newName } : t)) : []
                          );
                        }}
                        onBlur={() => {
                          const error = validateTeamName(team.name);
                          if (error) {
                            setNameErrors((prev) => ({ ...prev, [team.id]: error }));
                            return;
                          }
                          handleUpdateTeam(team);
                        }}
                      />
                      {team.isDefault && <Badge variant="secondary">Default</Badge>}
                    </div>
                    {nameErrors[team.id] && (
                      <p role="alert" className="text-xs text-destructive">
                        {nameErrors[team.id]}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <label htmlFor={`role-${team.id}`} className="text-xs text-muted-foreground">
                      Role
                    </label>
                    <select
                      id={`role-${team.id}`}
                      aria-label={`Role for ${team.name}`}
                      value={team.role}
                      className="h-8 rounded border bg-background px-2 text-sm"
                      onChange={(e) =>
                        handleUpdateTeam({
                          ...team,
                          role: e.target.value as TeamRole,
                        })
                      }
                    >
                      <option value="orchestrator">Orchestrator</option>
                      <option value="sub_agents">Sub-agents</option>
                      <option value="review">Review</option>
                    </select>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-muted-foreground hover:text-foreground"
                      onClick={() => handleDeleteTeam(team.id)}
                      aria-label={`Delete team ${team.name}`}
                    >
                      Delete
                    </Button>
                  </div>
                </div>

                <div className="text-xs text-muted-foreground">{ROLE_CAPTIONS[team.role]}</div>

                {/* Steps */}
                <div className="space-y-2 border-t pt-3">
                  <div className="text-xs font-medium text-muted-foreground">Fallback chain</div>
                  {team.steps.map((step, sIdx) => {
                    const harnessOptions = subscriptions?.map((s) => s.harness.capabilities.harness_id) ?? [step.harness];
                    const modelOptions = catalogs[step.harness] ?? [];

                    return (
                      <div
                        key={sIdx}
                        className="flex flex-wrap items-center gap-2 rounded border bg-muted/20 p-2 text-xs"
                      >
                        <span className="text-muted-foreground">{sIdx + 1}.</span>
                        <select
                          aria-label={`Step ${sIdx + 1} harness`}
                          value={step.harness}
                          className="h-7 rounded border bg-background px-2 text-xs"
                          onChange={(e) => {
                            const newHarness = e.target.value;
                            const nextSteps: TeamStep[] = team.steps.map((s, idx) =>
                              idx === sIdx ? { ...s, harness: newHarness, model: null } : s
                            );
                            handleUpdateTeam({ ...team, steps: nextSteps });
                          }}
                        >
                          {harnessOptions.map((hid) => (
                            <option key={hid} value={hid}>
                              {hid}
                            </option>
                          ))}
                        </select>

                        <select
                          aria-label={`Step ${sIdx + 1} model`}
                          value={step.model ?? ""}
                          className="h-7 rounded border bg-background px-2 text-xs"
                          onChange={(e) => {
                            const newModel = e.target.value || null;
                            const nextSteps: TeamStep[] = team.steps.map((s, idx) =>
                              idx === sIdx ? { ...s, model: newModel } : s
                            );
                            handleUpdateTeam({ ...team, steps: nextSteps });
                          }}
                        >
                          <option value="">Default model</option>
                          {modelOptions.map((m) => (
                            <option key={m} value={m}>
                              {m}
                            </option>
                          ))}
                        </select>

                        <select
                          aria-label={`Step ${sIdx + 1} effort`}
                          value={step.effort ?? ""}
                          className="h-7 rounded border bg-background px-2 text-xs"
                          onChange={(e) => {
                            const newEffort = (e.target.value as "low" | "medium" | "high") || null;
                            const nextSteps: TeamStep[] = team.steps.map((s, idx) =>
                              idx === sIdx ? { ...s, effort: newEffort } : s
                            );
                            handleUpdateTeam({ ...team, steps: nextSteps });
                          }}
                        >
                          <option value="">Effort: unapplied</option>
                          <option value="low">Low</option>
                          <option value="medium">Medium</option>
                          <option value="high">High</option>
                        </select>

                        <div className="ml-auto flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-1.5 text-xs"
                            disabled={sIdx === 0}
                            aria-label={`Move step ${sIdx + 1} up`}
                            onClick={() => {
                              if (sIdx === 0) return;
                              const nextSteps = [...team.steps];
                              const temp = nextSteps[sIdx - 1];
                              nextSteps[sIdx - 1] = nextSteps[sIdx];
                              nextSteps[sIdx] = temp;
                              handleUpdateTeam({ ...team, steps: nextSteps });
                            }}
                          >
                            ↑
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-1.5 text-xs"
                            disabled={sIdx === team.steps.length - 1}
                            aria-label={`Move step ${sIdx + 1} down`}
                            onClick={() => {
                              if (sIdx === team.steps.length - 1) return;
                              const nextSteps = [...team.steps];
                              const temp = nextSteps[sIdx + 1];
                              nextSteps[sIdx + 1] = nextSteps[sIdx];
                              nextSteps[sIdx] = temp;
                              handleUpdateTeam({ ...team, steps: nextSteps });
                            }}
                          >
                            ↓
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-1.5 text-xs text-muted-foreground hover:text-foreground"
                            disabled={team.steps.length <= 1}
                            aria-label={`Remove step ${sIdx + 1}`}
                            onClick={() => {
                              if (team.steps.length <= 1) return;
                              const nextSteps = team.steps.filter((_, idx) => idx !== sIdx);
                              handleUpdateTeam({ ...team, steps: nextSteps });
                            }}
                          >
                            ✕
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      const firstHarness = subscriptions?.[0]?.harness.capabilities.harness_id ?? "claude";
                      const nextSteps: TeamStep[] = [
                        ...team.steps,
                        { harness: firstHarness, model: null, effort: null },
                      ];
                      handleUpdateTeam({ ...team, steps: nextSteps });
                    }}
                  >
                    + Add step
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={team.isDefault}
                    onClick={() => handleSetDefault(team.id)}
                  >
                    Set default for role
                  </Button>
                </div>
                <div className="text-xs text-muted-foreground">
                  Defaults are stored and editable here; they are not silently applied to sessions that have no team.
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* Defaults section */}
      <section aria-label="Routing defaults">
        <h2 className="mb-2 font-medium">Routing defaults</h2>
        <p className="mb-4 text-sm text-muted-foreground">
          Preferences applied when a session or route does not specify an explicit value.
        </p>
        <Card className="shadow-none">
          <CardContent className="divide-y p-0">
            <div className="flex flex-wrap items-center justify-between gap-4 p-4 text-sm">
              <div>
                <div className="font-medium">Default effort</div>
                <div className="text-xs text-muted-foreground">
                  Stored only and not applied to runs yet.
                </div>
              </div>
              <select
                aria-label="Default effort"
                value={defaultEffort}
                className="h-8 rounded border bg-background px-2 text-sm"
                onChange={(e) =>
                  handleDefaultEffortChange(e.target.value as "low" | "medium" | "high")
                }
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-4 p-4 text-sm">
              <div>
                <div className="font-medium">Unavailable harness action</div>
                <div className="text-xs text-muted-foreground">
                  Action when an inline route references a harness that is offline or not installed.
                </div>
              </div>
              <select
                aria-label="Unavailable action"
                value={unavailableAction}
                className="h-8 rounded border bg-background px-2 text-sm"
                onChange={(e) =>
                  handleUnavailableActionChange(e.target.value as "ask" | "fallback")
                }
              >
                <option value="ask">Ask</option>
                <option value="fallback">Fallback</option>
              </select>
            </div>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
