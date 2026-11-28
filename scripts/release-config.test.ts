import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

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
