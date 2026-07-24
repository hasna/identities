import { afterAll, describe, expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const packageRoot = resolve(import.meta.dir, "..");
const temporaryRoots: string[] = [];

interface PackageExport {
  bun?: string;
  types?: string;
  import?: string;
}

interface PackageManifest {
  bin: Record<string, string>;
  dependencies: Record<string, string>;
  exports: Record<string, PackageExport>;
  files: string[];
  scripts: Record<string, string>;
}

afterAll(async () => {
  await Promise.all(temporaryRoots.map((root) => rm(root, { recursive: true, force: true })));
});

describe("script-independent package install contract", () => {
  test("routes Bun and TypeScript to shipped source while retaining built Node imports", async () => {
    const manifest = await readManifest();

    expect(manifest.files).toContain("src");

    for (const [subpath, entry] of Object.entries(manifest.exports)) {
      const source = sourceEntrypoint(subpath);
      expect(entry.bun).toBe(source);
      expect(entry.types).toBe(source);
      expect(entry.import?.startsWith("./dist/")).toBe(true);
    }

    expect(manifest.bin).toEqual({
      identities: "src/cli.ts",
      "identities-mcp": "src/mcp/index.ts",
      "identities-serve": "src/server/index.ts",
    });
    expect(Object.keys(manifest.dependencies)).toEqual(
      expect.arrayContaining(["@types/bun", "@types/node", "@types/pg"]),
    );
    expect(manifest.scripts.prepublishOnly).toBe("bun run verify:release");
    expect(manifest.scripts.prepare).toBeUndefined();
    expect(manifest.scripts.postinstall).toBeUndefined();
  });

  test("loads public entrypoints and runs all bins without lifecycle scripts or dist", async () => {
    const consumerRoot = await stageSourceOnlyConsumer();
    const importProbe = Bun.spawnSync({
      cmd: [
        process.execPath,
        "-e",
        [
          'const root = await import("@hasna/identities");',
          'const lifecycle = await import("@hasna/identities/user-lifecycle");',
          'const pgLifecycle = await import("@hasna/identities/pg-user-lifecycle");',
          'const sdk = await import("@hasna/identities/sdk");',
          'if (typeof root.IdentityStore !== "function") throw new Error("missing root export");',
          'if (typeof lifecycle.IdentityLifecycleService !== "function") throw new Error("missing lifecycle export");',
          'if (typeof pgLifecycle.PgIdentityLifecycleStore !== "function") throw new Error("missing pg lifecycle export");',
          'if (typeof sdk.IdentitiesClient !== "function") throw new Error("missing sdk export");',
          'console.log("source-only imports: ok");',
        ].join("\n"),
      ],
      cwd: consumerRoot,
      env: isolatedEnvironment(consumerRoot),
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(commandResult(importProbe)).toEqual({
      exitCode: 0,
      stderr: "",
      stdout: "source-only imports: ok",
    });

    await cp(
      join(packageRoot, "tests", "fixtures", "package-consumer.ts"),
      join(consumerRoot, "package-consumer.ts"),
    );
    const typeProbe = Bun.spawnSync({
      cmd: [
        process.execPath,
        join(packageRoot, "node_modules", "typescript", "bin", "tsc"),
        "--noEmit",
        "--strict",
        "--skipLibCheck",
        "--target",
        "ES2022",
        "--module",
        "ESNext",
        "--moduleResolution",
        "Bundler",
        "package-consumer.ts",
      ],
      cwd: consumerRoot,
      env: isolatedEnvironment(consumerRoot),
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(commandResult(typeProbe)).toEqual({
      exitCode: 0,
      stderr: "",
      stdout: "",
    });

    const binDirectory = join(consumerRoot, "node_modules", ".bin");
    const binCases = [
      ["identities", "--help"],
      ["identities-mcp"],
      ["identities-serve", "--help"],
    ] as const;

    for (const [name, argument] of binCases) {
      const result = Bun.spawnSync({
        cmd: argument === undefined
          ? [join(binDirectory, name)]
          : [join(binDirectory, name), argument],
        cwd: consumerRoot,
        env: isolatedEnvironment(consumerRoot),
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(result.exitCode, `${name}: ${result.stderr.toString()}`).toBe(0);
    }
  });
});

async function readManifest(): Promise<PackageManifest> {
  return JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8")) as PackageManifest;
}

function sourceEntrypoint(subpath: string): string {
  if (subpath === ".") return "./src/index.ts";
  return `./src/${subpath.slice(2)}${subpath === "./sdk" ? "/index" : ""}.ts`;
}

async function stageSourceOnlyConsumer(): Promise<string> {
  const consumerRoot = await mkdtemp(join(tmpdir(), "identities-source-install-"));
  temporaryRoots.push(consumerRoot);

  const nodeModules = join(consumerRoot, "node_modules");
  const packageDirectory = join(nodeModules, "@hasna", "identities");
  await mkdir(packageDirectory, { recursive: true });
  await cp(join(packageRoot, "package.json"), join(packageDirectory, "package.json"));
  await cp(join(packageRoot, "src"), join(packageDirectory, "src"), { recursive: true });

  const developmentModules = join(packageRoot, "node_modules");
  for (const entry of await readdir(developmentModules)) {
    if (entry.startsWith(".") || entry === "@hasna") continue;
    await symlink(join(developmentModules, entry), join(nodeModules, entry), "dir");
  }
  await symlink(
    join(developmentModules, "@hasna", "contracts"),
    join(nodeModules, "@hasna", "contracts"),
    "dir",
  );

  const binDirectory = join(nodeModules, ".bin");
  await mkdir(binDirectory, { recursive: true });
  const manifest = await readManifest();
  for (const [name, target] of Object.entries(manifest.bin)) {
    await symlink(join(packageDirectory, target), join(binDirectory, name));
  }

  return consumerRoot;
}

function isolatedEnvironment(root: string): Record<string, string | undefined> {
  return {
    ...process.env,
    OPEN_IDENTITIES_STORE: join(root, "identities.json"),
  };
}

function commandResult(result: Bun.SpawnSyncReturns<Buffer, Buffer>): {
  exitCode: number;
  stderr: string;
  stdout: string;
} {
  return {
    exitCode: result.exitCode,
    stderr: result.stderr.toString().trim(),
    stdout: result.stdout.toString().trim(),
  };
}
