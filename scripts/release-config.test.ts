import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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

  test("with a certificate it exports every variable, including a multi-line value", () => {
    const values = Object.fromEntries(appleNames.map((name) => [name, `${name.toLowerCase()}-value`]));
    values.APPLE_CERTIFICATE = "line-one\nline-two";
    const result = runStep(values);
    expect(result.exitCode).toBe(0);
    for (const name of appleNames) expect(result.exported).toContain(`${name}<<`);
    expect(result.exported).toContain("line-one\nline-two");
  });

  test("a certificate without the notarization credentials fails the build instead of shipping a half-signed app", () => {
    const result = runStep({ APPLE_CERTIFICATE: "cert", APPLE_CERTIFICATE_PASSWORD: "pw" });
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("::error::APPLE_SIGNING_IDENTITY is required");
  });
});

describe("[ADR-0013.D3] Windows signing step", () => {
  const step = stepNamed("Enable Windows Authenticode signing");

  test("runs only on Windows with the certificate secrets mapped", () => {
    expect(step.if).toBe("runner.os == 'Windows'");
    expect(step.env.WINDOWS_CERTIFICATE).toBe("${{ secrets.WINDOWS_CERTIFICATE }}");
    expect(step.env.WINDOWS_CERTIFICATE_PASSWORD).toBe("${{ secrets.WINDOWS_CERTIFICATE_PASSWORD }}");
  });

  test("signing settings reach Tauri through a CI-only platform config, not the committed tauri.conf.json", () => {
    expect(step.run).toContain("src-tauri/tauri.windows.conf.json");
    expect(json("src-tauri/tauri.conf.json").bundle.windows).toBeUndefined();
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

  test("every build signs updater bundles with the private key, and a release uploads latest.json", () => {
    const action = buildSteps.find((candidate) => String(candidate.uses).startsWith("tauri-apps/tauri-action"))!;
    expect(action.env.TAURI_SIGNING_PRIVATE_KEY).toBe("${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}");
    expect(action.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD).toBe("${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}");
    expect(action.with.uploadUpdaterJson).toBe("${{ github.event_name == 'release' }}");
    expect(action.with.tagName).toBe("${{ github.event.release.tag_name }}");
  });

  test("a release run fails when latest.json misses a platform the build matrix produces", () => {
    const job = workflow.jobs["verify-updater-manifest"];
    expect(job.needs).toBe("build");
    expect(job.if).toBe("github.event_name == 'release'");
    const script = job.steps[0].run as string;
    for (const platform of ["darwin-aarch64", "darwin-x86_64", "linux-x86_64", "windows-x86_64"]) expect(script).toContain(platform);
  });

  test("both plugins are desktop-only dependencies", () => {
    const cargo = Bun.TOML.parse(read("src-tauri/Cargo.toml")) as Record<string, any>;
    const desktop = cargo.target['cfg(any(target_os = "macos", windows, target_os = "linux"))'].dependencies;
    expect(Object.keys(desktop).sort()).toEqual(["tauri-plugin-process", "tauri-plugin-updater"]);
  });
});
