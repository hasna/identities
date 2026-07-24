#!/usr/bin/env bun

import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  isolatedPackageConsumerEnvironment,
  preparePackageConsumerEnvironment,
} from "./package-consumer-environment.js";

const packageRoot = resolve(import.meta.dir, "..");
const packageManifest = await readJson<PackageManifest>(join(packageRoot, "package.json"));
const minimumReleaseAgeSeconds = 604_800;
const typeScriptVersion = packageManifest.devDependencies?.typescript;
assert(typeScriptVersion !== undefined, "package manifest is missing the TypeScript verifier dependency");
const args = Bun.argv.slice(2).filter((argument) => argument !== "--");
const explicitSpec = argumentValue(args, "--spec");
if (explicitSpec !== undefined) validateExactGitSpec(explicitSpec);
const temporaryRoot = await mkdtemp(join(tmpdir(), "identities-package-consumers-"));

interface PackageExport {
  bun?: string;
  types?: string;
  import?: string;
}

/**
 * Compiler flag sets every consumer probe must survive.
 *
 * `--strict` alone is not enough: a consumer is free to run stricter flags, and
 * with the `types` condition pointing at raw source those flags would typecheck
 * our implementation. Declarations are shipped instead, so the strictest common
 * flags must stay clean here or the packaging regressed.
 */
const strictFlagSets = [
  ["--strict"],
  ["--strict", "--exactOptionalPropertyTypes", "--noUncheckedIndexedAccess"],
] as const;

interface PackageManifest {
  bin: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  exports: Record<string, PackageExport>;
  peerDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
  trustedDependencies?: string[];
  version?: string;
}

interface PackFile {
  mode: number;
  path: string;
  size: number;
}

interface PackResult {
  entryCount: number;
  filename: string;
  files: PackFile[];
  size: number;
  unpackedSize: number;
}

interface ConsumerOptions {
  /** Extra consumer dev dependencies, e.g. an older ambient type pin. */
  devDependencies?: Record<string, string>;
  expectDist: boolean;
  label: string;
  manager: "bun" | "npm";
  packageSpec: string;
  runtime: "bun" | "node";
}

try {
  if (explicitSpec) {
    await verifyConsumer({
      expectDist: false,
      label: "exact-git-bun",
      manager: "bun",
      packageSpec: explicitSpec,
      runtime: "bun",
    });
  } else {
    const tarball = await createAndInspectTarball();
    await verifyConsumer({
      expectDist: true,
      label: "packed-bun",
      manager: "bun",
      packageSpec: tarball,
      runtime: "bun",
    });
    await verifyConsumer({
      expectDist: true,
      label: "packed-npm-node",
      manager: "npm",
      packageSpec: tarball,
      runtime: "node",
    });
    // A consumer that pins ambient type packages older than the ones this package
    // develops against must still install. Type packages must never hard-block an
    // install, so this case fails the moment they come back as peer requirements.
    await verifyConsumer({
      devDependencies: { "@types/node": "^18.19.0", "@types/pg": "^8.6.6" },
      expectDist: true,
      label: "packed-npm-node-old-ambient-types",
      manager: "npm",
      packageSpec: tarball,
      runtime: "node",
    });
  }
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

async function createAndInspectTarball(): Promise<string> {
  const packDirectory = join(temporaryRoot, "pack");
  await mkdir(packDirectory, { recursive: true });
  await preparePackageConsumerEnvironment(packDirectory);
  const result = runCommand(
    ["npm", "pack", "--json", "--ignore-scripts", "--pack-destination", packDirectory],
    packageRoot,
    quietInstallEnvironment(packDirectory),
  );
  const [packed] = JSON.parse(result.stdout) as PackResult[];
  assert(packed !== undefined, "npm pack returned no package");

  const packedPaths = new Set(packed.files.map((file) => file.path));
  const sourceTests = packed.files.filter((file) => /^src\/.*\.test\.ts$/.test(file.path));
  assert(sourceTests.length === 0, `packed source tests: ${sourceTests.map((file) => file.path).join(", ")}`);

  for (const entry of Object.values(packageManifest.exports)) {
    assert(entry.bun !== undefined, "every export needs a Bun source target");
    assert(entry.import !== undefined, "every export needs a built Node target");
    assert(entry.types !== undefined, "every export needs a declaration target");
    assert(
      entry.types.endsWith(".d.ts") && !entry.types.startsWith("./src/"),
      `types condition must point at shipped declarations, not source: ${entry.types}`,
    );
    assert(packedPaths.has(withoutDotSlash(entry.bun)), `missing packed source export ${entry.bun}`);
    assert(packedPaths.has(withoutDotSlash(entry.import)), `missing packed Node export ${entry.import}`);
    assert(
      packedPaths.has(withoutDotSlash(entry.types)),
      `missing packed declaration export ${entry.types}`,
    );
  }

  for (const target of Object.values(packageManifest.bin)) {
    const packedBin = packed.files.find((file) => file.path === target);
    assert(packedBin !== undefined, `missing packed bin ${target}`);
    assert((packedBin.mode & 0o111) !== 0, `packed bin is not executable: ${target}`);
  }

  console.log(
    `packed archive: ${packed.entryCount} entries, ${packed.size} bytes, ${packed.unpackedSize} unpacked, no source tests`,
  );
  return join(packDirectory, packed.filename);
}

async function verifyConsumer(options: ConsumerOptions): Promise<void> {
  const consumerRoot = join(temporaryRoot, options.label);
  await mkdir(consumerRoot, { recursive: true });
  await preparePackageConsumerEnvironment(consumerRoot);
  const dependencySpec = options.packageSpec.startsWith("/")
    ? `file:${options.packageSpec}`
    : options.packageSpec;
  await writeFile(
    join(consumerRoot, "package.json"),
    `${JSON.stringify({
      name: `identities-${options.label}-consumer`,
      private: true,
      type: "module",
      dependencies: {
        "@hasna/identities": dependencySpec,
      },
      devDependencies: {
        ...options.devDependencies,
        typescript: typeScriptVersion,
      },
    }, null, 2)}\n`,
  );

  if (options.manager === "bun") {
    runCommand(
      [
        "bun",
        "install",
        "--ignore-scripts",
        "--minimum-release-age",
        String(minimumReleaseAgeSeconds),
      ],
      consumerRoot,
      quietInstallEnvironment(consumerRoot),
    );
  } else {
    runCommand(
      ["npm", "install", "--ignore-scripts", "--no-audit", "--no-fund"],
      consumerRoot,
      quietInstallEnvironment(consumerRoot),
    );
  }

  const installedRoot = join(consumerRoot, "node_modules", "@hasna", "identities");
  const installedManifest = await readJson<PackageManifest>(join(installedRoot, "package.json"));
  assert(installedManifest.scripts?.prepare === undefined, "installed package has a prepare lifecycle");
  assert(installedManifest.scripts?.postinstall === undefined, "installed package has a postinstall lifecycle");
  assert(installedManifest.trustedDependencies === undefined, "installed package declares trustedDependencies");
  assert(
    Object.keys(installedManifest.exports).join("\n") === Object.keys(packageManifest.exports).join("\n"),
    "installed export surface differs from the source manifest",
  );

  for (const [subpath, entry] of Object.entries(installedManifest.exports)) {
    assert(entry.types !== undefined, `${subpath} lost its declaration target`);
    assert(!entry.types.startsWith("./src/"), `${subpath} types condition points at source`);
    assert(
      await pathExists(join(installedRoot, entry.types)),
      `${options.label} is missing installed declarations for ${subpath} (${entry.types})`,
    );
  }
  // Type packages must never be able to block a consumer install, so none of them
  // may be a peer requirement. `@types/pg` stays an ordinary wide-range dependency
  // because the shipped `pg-store` declarations reference `pg` types: as a
  // dependency it is nested on conflict instead of failing resolution.
  for (const ambient of ["@types/bun", "@types/node", "@types/pg"]) {
    assert(
      installedManifest.peerDependencies?.[ambient] === undefined,
      `installed package requires ambient types as a peer: ${ambient}`,
    );
  }
  for (const ambient of ["@types/bun", "@types/node"]) {
    assert(
      installedManifest.dependencies?.[ambient] === undefined,
      `installed package requires ambient types as a runtime dependency: ${ambient}`,
    );
  }
  const pgTypesRange = installedManifest.dependencies?.["@types/pg"];
  assert(
    pgTypesRange !== undefined && /^[\^>]/.test(pgTypesRange),
    `@types/pg must be a wide-range dependency so it dedupes, got ${pgTypesRange ?? "nothing"}`,
  );
  for (const [ambient, range] of Object.entries(options.devDependencies ?? {})) {
    const installedVersion = await installedDependencyVersion(consumerRoot, ambient);
    assert(
      installedVersion !== undefined && satisfiesCaretMajor(range, installedVersion),
      `${options.label} expected ${ambient}@${range} but resolved ${installedVersion ?? "nothing"}`,
    );
  }

  const distPresent = await pathExists(join(installedRoot, "dist"));
  assert(distPresent === options.expectDist, `${options.label} dist presence was ${distPresent}`);
  if (options.expectDist) {
    const sourceTests = await Array.fromAsync(
      new Bun.Glob("src/**/*.test.ts").scan({ cwd: installedRoot, onlyFiles: true }),
    );
    assert(sourceTests.length === 0, `${options.label} installed source tests: ${sourceTests.join(", ")}`);
  }

  if (options.manager === "bun") {
    const untrusted = runCommand(
      ["bun", "pm", "untrusted"],
      consumerRoot,
      isolatedRuntimeEnvironment(consumerRoot),
    );
    assert(
      /(?:0|no) untrusted/i.test(`${untrusted.stdout}\n${untrusted.stderr}`),
      `${options.label} has untrusted lifecycle scripts`,
    );
  }

  await cp(join(packageRoot, "tests", "fixtures", "package-consumer.ts"), join(consumerRoot, "package-consumer.ts"));
  runRuntimeImports(consumerRoot, options.runtime, Object.keys(installedManifest.exports));
  runStrictTypeProbes(consumerRoot);
  runBinProbes(consumerRoot, Object.keys(installedManifest.bin));
  const exportCount = Object.keys(installedManifest.exports).length;
  const binCount = Object.keys(installedManifest.bin).length;
  const ambient = Object.keys(options.devDependencies ?? {});
  console.log(
    `${options.label}: ${exportCount}/${exportCount} imports, ` +
      `shipped declarations typecheck under ${strictFlagSets.map((flags) => flags.join(" ")).join(" / ")} ` +
      `(Bundler+NodeNext), ${binCount}/${binCount} bins` +
      (ambient.length > 0 ? `, install succeeded with ${ambient.join(", ")} pinned old` : ""),
  );
}

function runRuntimeImports(
  consumerRoot: string,
  runtime: "bun" | "node",
  exportSubpaths: string[],
): void {
  const specifiers = exportSubpaths.map((subpath) =>
    subpath === "." ? "@hasna/identities" : `@hasna/identities/${subpath.slice(2)}`
  );
  const probe = [
    `const specifiers = ${JSON.stringify(specifiers)};`,
    "for (const specifier of specifiers) await import(specifier);",
    'console.log(`${specifiers.length}/${specifiers.length} imports`);',
  ].join("\n");
  runCommand(
    runtime === "bun"
      ? [process.execPath, "-e", probe]
      : ["node", "--input-type=module", "-e", probe],
    consumerRoot,
    isolatedRuntimeEnvironment(consumerRoot),
  );
}

function runStrictTypeProbes(consumerRoot: string): void {
  const typeScript = join(consumerRoot, "node_modules", "typescript", "bin", "tsc");
  for (const moduleResolution of ["Bundler", "NodeNext"] as const) {
    for (const flags of strictFlagSets) {
      runCommand(
        [
          "node",
          typeScript,
          "--noEmit",
          ...flags,
          "--target",
          "ES2022",
          "--module",
          moduleResolution === "Bundler" ? "ESNext" : "NodeNext",
          "--moduleResolution",
          moduleResolution,
          "package-consumer.ts",
        ],
        consumerRoot,
        isolatedRuntimeEnvironment(consumerRoot),
      );
    }
  }
}

/** Version of a package as actually installed in the consumer tree. */
async function installedDependencyVersion(
  consumerRoot: string,
  name: string,
): Promise<string | undefined> {
  const manifestPath = join(consumerRoot, "node_modules", ...name.split("/"), "package.json");
  if (!(await pathExists(manifestPath))) return undefined;
  return (await readJson<PackageManifest>(manifestPath)).version;
}

/** Minimal `^major.minor.patch` check — enough to prove a pin was honoured. */
function satisfiesCaretMajor(range: string, version: string): boolean {
  const wanted = /^\^?(\d+)\./.exec(range)?.[1];
  const actual = /^(\d+)\./.exec(version)?.[1];
  return wanted !== undefined && wanted === actual;
}

function runBinProbes(consumerRoot: string, binNames: string[]): void {
  const binDirectory = join(consumerRoot, "node_modules", ".bin");
  // Smoke arguments per shipped bin. `identities-mcp` speaks MCP over stdio and
  // exits on closed stdin, so it takes no argument.
  const binArguments: Record<string, string | undefined> = {
    identities: "--help",
    "identities-mcp": undefined,
    "identities-serve": "--help",
  };
  const unprobed = binNames.filter((name) => !(name in binArguments));
  assert(unprobed.length === 0, `no consumer smoke probe for bins: ${unprobed.join(", ")}`);
  const binCases = binNames.map((name) => [name, binArguments[name]] as const);
  for (const [name, argument] of binCases) {
    runCommand(
      argument === undefined
        ? [join(binDirectory, name)]
        : [join(binDirectory, name), argument],
      consumerRoot,
      isolatedRuntimeEnvironment(consumerRoot),
    );
  }
}

function argumentValue(arguments_: string[], name: string): string | undefined {
  const indexes = arguments_
    .map((argument, index) => argument === name ? index : -1)
    .filter((index) => index !== -1);
  assert(indexes.length <= 1, `${name} may only be provided once`);
  const [index] = indexes;
  if (index === undefined) return undefined;
  const value = arguments_[index + 1];
  assert(value !== undefined && !value.startsWith("--"), `${name} requires a value`);
  return value;
}

function validateExactGitSpec(spec: string): void {
  assert(
    /^github:hasna\/identities#[0-9a-f]{40}$/.test(spec),
    "--spec must be github:hasna/identities# followed by a 40-character lowercase commit SHA",
  );
}

function isolatedRuntimeEnvironment(root: string): Record<string, string | undefined> {
  return {
    ...isolatedPackageConsumerEnvironment(root),
    HASNA_IDENTITIES_DATABASE_URL: undefined,
    HASNA_IDENTITIES_STORAGE_MODE: "local",
    IDENTITIES_DATABASE_URL: undefined,
    IDENTITIES_STORAGE_MODE: undefined,
    OPEN_IDENTITIES_STORE: join(root, "identities.json"),
  };
}

function quietInstallEnvironment(root: string): Record<string, string | undefined> {
  return {
    ...isolatedPackageConsumerEnvironment(root),
    npm_config_audit: "false",
    npm_config_fund: "false",
    npm_config_progress: "false",
  };
}

function runCommand(
  cmd: string[],
  cwd: string,
  env: Record<string, string | undefined>,
): { stderr: string; stdout: string } {
  const result = Bun.spawnSync({
    cmd,
    cwd,
    env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = result.stdout.toString().trim();
  const stderr = result.stderr.toString().trim();
  if (result.exitCode !== 0) {
    throw new Error(
      `${cmd.map(shellQuote).join(" ")} failed with ${result.exitCode}\n${stdout}\n${stderr}`.trim(),
    );
  }
  return { stderr, stdout };
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
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

function withoutDotSlash(path: string): string {
  return path.startsWith("./") ? path.slice(2) : path;
}

function shellQuote(value: string): string {
  return /^[A-Za-z0-9_./:@#=-]+$/.test(value) ? value : JSON.stringify(value);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
