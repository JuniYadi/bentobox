import { describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = new URL("../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");
const json = (path: string) => JSON.parse(read(path)) as Record<string, any>;

describe("[ADR-0013.D1] release pipeline", () => {
  test("package.json, tauri.conf.json and Cargo.toml carry one version, as verify-version requires", () => {
    const versions = {
      "package.json": json("package.json").version,
      "tauri.conf.json": json("src-tauri/tauri.conf.json").version,
      "Cargo.toml": (Bun.TOML.parse(read("src-tauri/Cargo.toml")) as Record<string, any>).package.version,
    };
    expect(new Set(Object.values(versions)).size, JSON.stringify(versions)).toBe(1);
  });

  test("the build matrix covers macOS arm64/x64, Linux x64 and Windows x64, and only a published release uploads", () => {
    const workflow = Bun.YAML.parse(read(".github/workflows/release.yml")) as Record<string, any>;
    const targets = workflow.jobs.build.strategy.matrix.include.map((entry: { target: string }) => entry.target).sort();
    expect(targets).toEqual([
      "aarch64-apple-darwin",
      "x86_64-apple-darwin",
      "x86_64-pc-windows-msvc",
      "x86_64-unknown-linux-gnu",
    ]);
    expect(workflow.jobs["verify-version"].if).toBe("github.event_name == 'release'");
    expect(workflow.jobs.build.needs).toBe("verify-version");
  });
});

describe("[ADR-0013.D5] dependabot", () => {
  test("github-actions is checked weekly from the repo root", () => {
    const config = Bun.YAML.parse(read(".github/dependabot.yml")) as { updates: Array<Record<string, any>> };
    const entry = config.updates.find((update) => update["package-ecosystem"] === "github-actions");
    expect(entry?.directory).toBe("/");
    expect(entry?.schedule.interval).toBe("weekly");
  });
});

describe("[ADR-0014.D1] main window geometry", () => {
  test("opens maximized and centered with a 1280x800 restore size and a 1024x640 minimum", () => {
    const [window] = json("src-tauri/tauri.conf.json").app.windows;
    expect(window).toMatchObject({ title: "BentoBox", maximized: true, center: true, width: 1280, height: 800, minWidth: 1024, minHeight: 640 });
  });
});

describe("[ADR-0015.D1] dev build footprint", () => {
  test("dev keeps line tables for our crate, drops debug info for dependencies, and release is unchanged", () => {
    const cargo = Bun.TOML.parse(read("src-tauri/Cargo.toml")) as Record<string, any>;
    expect(cargo.profile.dev.debug).toBe("line-tables-only");
    expect(cargo.profile.dev.package["*"].debug).toBe(false);
    expect(cargo.profile.release.debug).toBeUndefined();
  });
});

const workflow = Bun.YAML.parse(read(".github/workflows/release.yml")) as Record<string, any>;
const buildSteps = workflow.jobs.build.steps as Array<Record<string, any>>;
const stepNamed = (name: string) => buildSteps.find((step) => step.name === name)!;
const stepIndex = (predicate: (step: Record<string, any>) => boolean) => buildSteps.findIndex(predicate);

/** Parses the `NAME<<delimiter` blocks the macOS step appends to $GITHUB_ENV, the way the runner does. */
function parseGithubEnv(text: string) {
  const parsed: Record<string, string> = {};
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const header = lines[i].match(/^([A-Z_]+)<<(.+)$/);
    if (!header) continue;
    const value: string[] = [];
    for (i++; i < lines.length && lines[i] !== header[2]; i++) value.push(lines[i]);
    parsed[header[1]] = value.join("\n");
  }
  return parsed;
}

describe("[ADR-0013.D2] macOS signing step", () => {
  const appleNames = ["APPLE_CERTIFICATE", "APPLE_CERTIFICATE_PASSWORD", "APPLE_SIGNING_IDENTITY", "APPLE_ID", "APPLE_PASSWORD", "APPLE_TEAM_ID"];
  const step = stepNamed("Enable macOS signing and notarization");

  function runStep(values: Record<string, string>) {
    const githubEnv = `${mkdtempSync(join(tmpdir(), "gh-env-"))}/env`;
    writeFileSync(githubEnv, "");
    const env = { PATH: process.env.PATH ?? "", GITHUB_ENV: githubEnv, ...Object.fromEntries(appleNames.map((name) => [name, ""])), ...values };
    const result = Bun.spawnSync(["bash", "-c", step.run], { env });
    return { exitCode: result.exitCode, stdout: result.stdout.toString(), exported: readFileSync(githubEnv, "utf8") };
  }

  test("runs only on macOS and maps all six secrets", () => {
    expect(step.if).toBe("runner.os == 'macOS'");
    for (const name of appleNames) expect(step.env[name]).toBe(`\${{ secrets.${name} }}`);
  });

  test("without a certificate it warns and exports nothing, so the bundle builds unsigned", () => {
    const result = runStep({});
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("::warning::APPLE_CERTIFICATE is not set");
    expect(result.exported).toBe("");
  });

  test("with a certificate every value reaches GITHUB_ENV intact, including multi-line values and values that look like env headers", () => {
    const values = Object.fromEntries(appleNames.map((name) => [name, `${name.toLowerCase()}-value`]));
    values.APPLE_CERTIFICATE = "line-one\nline-two\nAPPLE_ID<<fake";
    values.APPLE_PASSWORD = "p@ss=word<<EOF";
    const result = runStep(values);
    expect(result.exitCode).toBe(0);
    expect(parseGithubEnv(result.exported)).toEqual(values);
  });

  test("a certificate without the notarization credentials fails the build instead of shipping a half-signed app", () => {
    const result = runStep({ APPLE_CERTIFICATE: "cert", APPLE_CERTIFICATE_PASSWORD: "pw" });
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("::error::APPLE_SIGNING_IDENTITY is required");
    expect(result.exported).toBe("");
  });
});

describe("[ADR-0013.D3] Windows signing step", () => {
  const step = stepNamed("Enable Windows Authenticode signing");

  test("runs only on Windows with the certificate secrets mapped", () => {
    expect(step.if).toBe("runner.os == 'Windows'");
    expect(step.env.WINDOWS_CERTIFICATE).toBe("${{ secrets.WINDOWS_CERTIFICATE }}");
    expect(step.env.WINDOWS_CERTIFICATE_PASSWORD).toBe("${{ secrets.WINDOWS_CERTIFICATE_PASSWORD }}");
  });

  test("signing settings stay out of the committed tauri.conf.json, so unsigned local and Linux/macOS builds are unaffected", () => {
    expect(json("src-tauri/tauri.conf.json").bundle.windows).toBeUndefined();
  });
});

describe("[ADR-0013.D2][ADR-0013.D3] signing secrets exposure", () => {
  test("both signing steps run after every third-party action and dependency install, right before the build", () => {
    const mac = stepIndex((step) => step.name === "Enable macOS signing and notarization");
    const windows = stepIndex((step) => step.name === "Enable Windows Authenticode signing");
    const build = stepIndex((step) => String(step.uses).startsWith("tauri-apps/tauri-action"));
    const lastSetup = Math.max(...buildSteps.map((step, index) => (index !== mac && index !== windows && index !== build && step.uses !== "actions/checkout@v7" ? index : -1)));
    expect(mac).toBeGreaterThan(lastSetup);
    expect(windows).toBeGreaterThan(lastSetup);
    expect(build).toBe(Math.max(mac, windows) + 1);
  });

  test("the workflow token is read-only by default and only the build job may write the release", () => {
    expect(workflow.permissions).toEqual({ contents: "read" });
    expect(workflow.jobs.build.permissions).toEqual({ contents: "write" });
    expect(workflow.jobs["verify-updater-manifest"].permissions).toBeUndefined();
  });

  test("the action that receives every signing secret is pinned to a commit", () => {
    const action = buildSteps.find((step) => String(step.uses).startsWith("tauri-apps/tauri-action"))!;
    expect(String(action.uses)).toMatch(/^tauri-apps\/tauri-action@[0-9a-f]{40}$/);
  });
});

describe("[ADR-0013.D4] signed updates", () => {
  const config = json("src-tauri/tauri.conf.json");

  test("the app embeds a minisign public key and reads latest.json from the latest release", () => {
    expect(config.bundle.createUpdaterArtifacts).toBe(true);
    const pubkey = Buffer.from(config.plugins.updater.pubkey, "base64").toString("utf8");
    expect(pubkey.startsWith("untrusted comment: minisign public key")).toBe(true);
    expect(config.plugins.updater.endpoints).toEqual(["https://github.com/JuniYadi/bentobox/releases/latest/download/latest.json"]);
  });

  test("the window may check and install updates and restart, and nothing else from the plugins", () => {
    const permissions = json("src-tauri/capabilities/default.json").permissions as string[];
    expect(permissions).toEqual(expect.arrayContaining(["updater:allow-check", "updater:allow-download-and-install", "process:allow-restart"]));
    expect(permissions.filter((permission) => /^(updater|process):/.test(permission)).length).toBe(3);
  });

  test("every build signs updater bundles with the private key, and only a release run uploads latest.json", () => {
    const action = buildSteps.find((candidate) => String(candidate.uses).startsWith("tauri-apps/tauri-action"))!;
    expect(action.env.TAURI_SIGNING_PRIVATE_KEY).toBe("${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}");
    expect(action.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD).toBe("${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}");
    expect(action.with.uploadUpdaterJson).toBe("${{ github.event_name == 'release' }}");
  });

  test("both plugins are desktop-only dependencies", () => {
    const cargo = Bun.TOML.parse(read("src-tauri/Cargo.toml")) as Record<string, any>;
    const desktop = cargo.target['cfg(any(target_os = "macos", windows, target_os = "linux"))'].dependencies;
    expect(Object.keys(desktop).sort()).toEqual(["tauri-plugin-process", "tauri-plugin-updater"]);
  });
});

describe("[ADR-0013.D4] latest.json verification job", () => {
  const job = workflow.jobs["verify-updater-manifest"];
  const signed = (url: string) => ({ signature: "dW50cnVzdGVk", url });
  const complete = {
    version: "0.0.2",
    platforms: {
      "darwin-aarch64": signed("a"),
      "darwin-x86_64": signed("b"),
      "linux-x86_64": signed("c"),
      "windows-x86_64": signed("d"),
    },
  };

  /** Runs the job's script with a fake `gh` that "downloads" the given manifest. */
  function verify(manifest: unknown, tag = "v0.0.2") {
    const dir = mkdtempSync(join(tmpdir(), "verify-"));
    const fixture = join(dir, "fixture.json");
    writeFileSync(fixture, JSON.stringify(manifest));
    const gh = join(dir, "gh");
    writeFileSync(gh, '#!/usr/bin/env bash\nwhile [ $# -gt 0 ]; do if [ "$1" = "--output" ]; then cp "$FIXTURE" "$2"; fi; shift; done\n');
    chmodSync(gh, 0o755);
    const result = Bun.spawnSync(["bash", "-c", job.steps[0].run], {
      cwd: dir,
      env: { PATH: `${dir}:${process.env.PATH}`, FIXTURE: fixture, TAG: tag, GITHUB_REPOSITORY: "JuniYadi/bentobox", GH_TOKEN: "unused" },
    });
    return { exitCode: result.exitCode, stdout: result.stdout.toString() };
  }

  test("runs only for releases, after every build job", () => {
    expect(job.needs).toBe("build");
    expect(job.if).toBe("github.event_name == 'release'");
  });

  test("a complete, signed manifest for the tagged version passes", () => {
    expect(verify(complete).exitCode).toBe(0);
  });

  test("a manifest that lost a platform to the upload race fails and names it", () => {
    const { "windows-x86_64": _lost, ...platforms } = complete.platforms;
    const result = verify({ ...complete, platforms });
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("missing platforms: windows-x86_64");
  });

  test("an entry with an empty signature fails", () => {
    const result = verify({ ...complete, platforms: { ...complete.platforms, "linux-x86_64": { signature: "", url: "c" } } });
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("empty signature for: linux-x86_64");
  });

  test("a manifest for a different version than the tag fails", () => {
    const result = verify({ ...complete, version: "0.0.1" });
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("version 0.0.1 does not match tag 0.0.2");
  });
});
