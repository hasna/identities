import { afterAll, describe, expect, test } from "bun:test";
import {
  chmod,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  isolatedPackageConsumerEnvironment,
  preparePackageConsumerEnvironment,
} from "../scripts/package-consumer-environment.js";

const packageRoot = resolve(import.meta.dir, "..");

/** Piped `Bun.spawnSync` result, named without depending on a bun-types alias. */
type SpawnSyncResult = ReturnType<typeof runVerifier>;
const temporaryRoots: string[] = [];

interface PackageExport {
  bun?: string;
  types?: string;
  import?: string;
}

interface PackageManifest {
  bin: Record<string, string>;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  exports: Record<string, PackageExport>;
  files: string[];
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
  scripts: Record<string, string>;
  types: string;
}

afterAll(async () => {
  await Promise.all(temporaryRoots.map((root) => rm(root, { recursive: true, force: true })));
});

describe("script-independent package install contract", () => {
  test("routes Bun to shipped source, TypeScript to shipped declarations, Node to dist", async () => {
    const manifest = await readManifest();

    const subpaths = Object.keys(manifest.exports);
    expect(subpaths.length).toBeGreaterThan(0);
    expect(manifest.files).toContain("src/**/*.ts");
    expect(manifest.files).toContain("!src/**/*.test.ts");
    expect(manifest.files).toContain("types");

    for (const [subpath, entry] of Object.entries(manifest.exports)) {
      const source = sourceEntrypoint(subpath);
      const declaration = declarationEntrypoint(subpath);
      expect(entry.bun).toBe(source);
      // Never the raw source: a consumer's own compiler flags (e.g.
      // exactOptionalPropertyTypes) must not typecheck this package's implementation.
      expect(entry.types).toBe(declaration);
      expect(entry.import?.startsWith("./dist/")).toBe(true);
      expect(await pathExists(join(packageRoot, source)), `${subpath} source target`).toBe(true);
      expect(
        await pathExists(join(packageRoot, declaration)),
        `${subpath} declaration target`,
      ).toBe(true);
    }
    expect(manifest.types).toBe(declarationEntrypoint("."));

    expect(manifest.bin).toEqual({
      identities: "src/cli.ts",
      "identities-mcp": "src/mcp/index.ts",
      "identities-serve": "src/server/index.ts",
    });
    // Type packages must never be peers: npm fails an install outright (ERESOLVE)
    // when a consumer pins a version outside a peer range, even an optional one.
    // `@types/pg` is an ordinary wide-range dependency because the shipped
    // `pg-store` declarations reference `pg` types; a conflicting consumer pin then
    // nests instead of breaking the install. `@types/bun` and `@types/node` are not
    // imposed at all — no shipped declaration needs their ambient types.
    expect(manifest.peerDependencies).toBeUndefined();
    expect(manifest.peerDependenciesMeta).toBeUndefined();
    for (const ambient of ["@types/bun", "@types/node"]) {
      expect(Object.keys(manifest.dependencies), ambient).not.toContain(ambient);
    }
    expect(manifest.dependencies["@types/pg"]).toMatch(/^[\^>]/);
    expect(manifest.scripts.prepublishOnly).toBe("bun run verify:release");
    expect(manifest.scripts["verify:release"]).toContain("verify:shipped-types");
    expect(manifest.scripts.prepare).toBeUndefined();
    expect(manifest.scripts.postinstall).toBeUndefined();
  });

  test("no shipped declaration depends on ambient Node types", async () => {
    const offenders: string[] = [];
    for await (const path of new Bun.Glob("**/*.d.ts").scan({
      cwd: join(packageRoot, "types"),
      onlyFiles: true,
    })) {
      const contents = await readFile(join(packageRoot, "types", path), "utf8");
      if (/\bNodeJS\.|\bBuffer\b|types="node"/.test(contents)) offenders.push(path);
    }
    expect(offenders).toEqual([]);
  });

  test("the committed declaration tree is in sync with src", async () => {
    const result = Bun.spawnSync({
      cmd: [process.execPath, join(packageRoot, "scripts", "verify-shipped-types.ts")],
      cwd: packageRoot,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(commandResult(result).exitCode, commandResult(result).stderr).toBe(0);
    expect(commandResult(result).stdout).toContain("declaration files match src/");
  }, 60_000);

  test("the freshness gate fails when the declaration tree drifts", async () => {
    const staleRoot = await mkdtemp(join(tmpdir(), "identities-stale-types-"));
    temporaryRoots.push(staleRoot);
    await cp(join(packageRoot, "types"), staleRoot, { recursive: true });
    await rm(join(staleRoot, "status.d.ts"));
    await writeFile(join(staleRoot, "core.d.ts"), "export declare const drifted: true;\n");

    const result = commandResult(Bun.spawnSync({
      cmd: [
        process.execPath,
        join(packageRoot, "scripts", "verify-shipped-types.ts"),
        "--committed",
        staleRoot,
      ],
      cwd: packageRoot,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    }));
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("missing: status.d.ts");
    expect(result.stderr).toContain("out of date: core.d.ts");
  }, 60_000);

  test("strict consumer fixture imports every public export without skipLibCheck", async () => {
    const manifest = await readManifest();
    const fixture = await readFile(
      join(packageRoot, "tests", "fixtures", "package-consumer.ts"),
      "utf8",
    );
    const importedSpecifiers = Array.from(
      fixture.matchAll(/from "(@hasna\/identities(?:\/[^"]+)?)"/g),
      (match) => match[1],
    ).sort();
    const expectedSpecifiers = Object.keys(manifest.exports)
      .map((subpath) =>
        subpath === "." ? "@hasna/identities" : `@hasna/identities/${subpath.slice(2)}`
      )
      .sort();

    expect(importedSpecifiers).toEqual(expectedSpecifiers);
    expect(fixture).not.toContain("skipLibCheck");
  });

  test("rejects branch, tag, short, uppercase, and file specs before invoking an installer", async () => {
    const invalidSpecs = [
      "github:hasna/identities#main",
      "github:hasna/identities#v0.3.5",
      "github:hasna/identities#0123456",
      "github:hasna/identities#0123456789ABCDEF0123456789ABCDEF01234567",
      "file:/tmp/identities-package.tgz",
    ];

    for (const spec of invalidSpecs) {
      const harness = await createFakeBunHarness();
      const result = runVerifier(spec, harness);
      expect(result.exitCode, spec).not.toBe(0);
      expect(result.stderr.toString(), spec).toContain(
        "--spec must be github:hasna/identities# followed by a 40-character lowercase commit SHA",
      );
      expect(await pathExists(harness.capturePath), `${spec} invoked the installer`).toBe(false);
    }
  });

  test("isolates child config and propagates an exact-SHA installer failure", async () => {
    const harness = await createFakeBunHarness();
    const hostMarker = "host-configuration-marker";
    const result = runVerifier(
      "github:hasna/identities#0123456789abcdef0123456789abcdef01234567",
      harness,
      {
        BUN_INSTALL_CACHE_DIR: `/tmp/${hostMarker}-bun-cache`,
        BUN_CONFIG_VERBOSE_FETCH: hostMarker,
        HOME: `/tmp/${hostMarker}-home`,
        NODE_EXTRA_CA_CERTS: `/tmp/${hostMarker}-node-ca.pem`,
        NODE_OPTIONS: `--require=/tmp/${hostMarker}-node-hook.cjs`,
        NODE_PATH: `/tmp/${hostMarker}-node-path`,
        NPM_CONFIG_CACHE: `/tmp/${hostMarker}-npm-cache`,
        NPM_CONFIG_USERCONFIG: `/tmp/${hostMarker}-npmrc`,
        XDG_CACHE_HOME: `/tmp/${hostMarker}-xdg-cache`,
        XDG_CONFIG_HOME: `/tmp/${hostMarker}-xdg-config`,
      },
    );

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.toString()).toContain("failed with 37");
    const captured = await readFile(harness.capturePath, "utf8");
    expect(captured).not.toContain(hostMarker);
    expect(captured).toContain("HOME=");
    expect(captured).toContain("identities-package-consumers-");
  });

  // A consumer may compile with flags stricter than this package uses. Because the
  // `types` condition resolves to shipped declarations rather than the
  // implementation, the strictest of these must stay clean.
  const strictFlagSets = [
    ["--strict"],
    ["--strict", "--exactOptionalPropertyTypes", "--noUncheckedIndexedAccess"],
  ] as const;

  for (const moduleResolution of ["Bundler", "NodeNext"] as const) {
    for (const flags of strictFlagSets) {
      test(`typechecks a ${flags.length > 1 ? "stricter-than-ours" : "strict"} consumer with ${moduleResolution} resolution`, async () => {
        const consumerRoot = await stageSourceOnlyConsumer();
        await cp(
          join(packageRoot, "tests", "fixtures", "package-consumer.ts"),
          join(consumerRoot, "package-consumer.ts"),
        );
        const moduleKind = moduleResolution === "Bundler" ? "ESNext" : "NodeNext";
        const typeProbe = Bun.spawnSync({
          cmd: [
            process.execPath,
            join(packageRoot, "node_modules", "typescript", "bin", "tsc"),
            "--noEmit",
            ...flags,
            "--target",
            "ES2022",
            "--module",
            moduleKind,
            "--moduleResolution",
            moduleResolution,
            "package-consumer.ts",
          ],
          cwd: consumerRoot,
          env: isolatedEnvironment(consumerRoot),
          stdout: "pipe",
          stderr: "pipe",
        });
        expect(commandResult(typeProbe), `${moduleResolution} ${flags.join(" ")} probe`).toEqual({
          exitCode: 0,
          stderr: "",
          stdout: "",
        });
      }, 30_000);
    }
  }

  test("loads public entrypoints and runs all bins without lifecycle scripts or dist", async () => {
    const consumerRoot = await stageSourceOnlyConsumer();
    const importProbe = Bun.spawnSync({
      cmd: [
        process.execPath,
        "-e",
        [
          'const root = await import("@hasna/identities");',
          'const pgStore = await import("@hasna/identities/pg-store");',
          'const storage = await import("@hasna/identities/storage");',
          'const sdk = await import("@hasna/identities/sdk");',
          'if (typeof root.IdentityStore !== "function") throw new Error("missing root export");',
          'if (typeof pgStore.PgStorageBackend !== "function") throw new Error("missing pg-store export");',
          'if (typeof storage.FileStorageBackend !== "function") throw new Error("missing storage export");',
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

function declarationEntrypoint(subpath: string): string {
  return `${sourceEntrypoint(subpath).replace("./src/", "./types/").slice(0, -3)}.d.ts`;
}

async function stageSourceOnlyConsumer(): Promise<string> {
  const consumerRoot = await mkdtemp(join(tmpdir(), "identities-source-install-"));
  temporaryRoots.push(consumerRoot);
  await preparePackageConsumerEnvironment(consumerRoot);

  const nodeModules = join(consumerRoot, "node_modules");
  const packageDirectory = join(nodeModules, "@hasna", "identities");
  await mkdir(packageDirectory, { recursive: true });
  await cp(join(packageRoot, "package.json"), join(packageDirectory, "package.json"));
  await cp(join(packageRoot, "src"), join(packageDirectory, "src"), { recursive: true });
  // The declaration tree is committed, so an exact-Git install carries it too.
  await cp(join(packageRoot, "types"), join(packageDirectory, "types"), { recursive: true });

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
    ...isolatedPackageConsumerEnvironment(root),
    HASNA_IDENTITIES_DATABASE_URL: undefined,
    HASNA_IDENTITIES_STORAGE_MODE: "local",
    IDENTITIES_DATABASE_URL: undefined,
    IDENTITIES_STORAGE_MODE: undefined,
    OPEN_IDENTITIES_STORE: join(root, "identities.json"),
  };
}

function commandResult(result: SpawnSyncResult): {
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

interface FakeBunHarness {
  capturePath: string;
  directory: string;
}

async function createFakeBunHarness(): Promise<FakeBunHarness> {
  const directory = await mkdtemp(join(tmpdir(), "identities-fake-bun-"));
  temporaryRoots.push(directory);
  const capturePath = join(directory, "child.env");
  const executable = join(directory, "bun");
  const shellCapturePath = capturePath.replaceAll("'", "'\\''");
  await writeFile(
    executable,
    [
      "#!/bin/sh",
      "{",
      "  printf 'HOME=%s\\n' \"${HOME-}\"",
      "  printf 'XDG_CONFIG_HOME=%s\\n' \"${XDG_CONFIG_HOME-}\"",
      "  printf 'XDG_CACHE_HOME=%s\\n' \"${XDG_CACHE_HOME-}\"",
      "  printf 'NPM_CONFIG_USERCONFIG=%s\\n' \"${NPM_CONFIG_USERCONFIG-}\"",
      "  printf 'NPM_CONFIG_CACHE=%s\\n' \"${NPM_CONFIG_CACHE-}\"",
      "  printf 'BUN_INSTALL_CACHE_DIR=%s\\n' \"${BUN_INSTALL_CACHE_DIR-}\"",
      "  printf 'BUN_CONFIG_VERBOSE_FETCH=%s\\n' \"${BUN_CONFIG_VERBOSE_FETCH-}\"",
      "  printf 'NODE_OPTIONS=%s\\n' \"${NODE_OPTIONS-}\"",
      "  printf 'NODE_PATH=%s\\n' \"${NODE_PATH-}\"",
      "  printf 'NODE_EXTRA_CA_CERTS=%s\\n' \"${NODE_EXTRA_CA_CERTS-}\"",
      `} > '${shellCapturePath}'`,
      "exit 37",
      "",
    ].join("\n"),
  );
  await chmod(executable, 0o755);
  return { capturePath, directory };
}

function runVerifier(
  spec: string,
  harness: FakeBunHarness,
  extraEnv: Record<string, string> = {},
){
  return Bun.spawnSync({
    cmd: [
      process.execPath,
      join(packageRoot, "scripts", "verify-package-consumers.ts"),
      "--spec",
      spec,
    ],
    cwd: packageRoot,
    env: {
      ...process.env,
      ...extraEnv,
      PATH: `${harness.directory}:${process.env["PATH"] ?? ""}`,
    },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}
