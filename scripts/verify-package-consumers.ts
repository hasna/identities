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

interface PackageManifest {
  bin: Record<string, string>;
  devDependencies?: Record<string, string>;
  exports: Record<string, PackageExport>;
  scripts?: Record<string, string>;
  trustedDependencies?: string[];
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
    assert(packedPaths.has(withoutDotSlash(entry.bun)), `missing packed source export ${entry.bun}`);
    assert(packedPaths.has(withoutDotSlash(entry.import)), `missing packed Node export ${entry.import}`);
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
  runCredentialBoundaryProbe(consumerRoot, options.runtime);
  runStrictTypeProbes(consumerRoot);
  runBinProbes(consumerRoot);
  const exportCount = Object.keys(installedManifest.exports).length;
  console.log(
    `${options.label}: ${exportCount}/${exportCount} imports, credential-safe cloud client, strict Bundler+NodeNext types, 3/3 bins`,
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

function runCredentialBoundaryProbe(
  consumerRoot: string,
  runtime: "bun" | "node",
): void {
  const probe = [
    'import { inspect } from "node:util";',
    'import { createCloudIdentityStore } from "@hasna/identities/pg-store";',
    'const passwordMarker = "installed-identity-password-marker";',
    'const databaseMarker = "installed-identity-database-marker";',
    'const databaseUrl = `postgresql://identity-user:${passwordMarker}@127.0.0.1:1/${databaseMarker}`;',
    "function graphContains(value, marker, depth = 12, seen = new Set()) {",
    '  if (typeof value === "string") return value.includes(marker);',
    '  if ((typeof value !== "object" && typeof value !== "function") || value === null || depth === 0) return false;',
    "  if (seen.has(value)) return false;",
    "  seen.add(value);",
    "  for (const key of Reflect.ownKeys(value)) {",
    "    const descriptor = Object.getOwnPropertyDescriptor(value, key);",
    '    if (descriptor && "value" in descriptor && graphContains(descriptor.value, marker, depth - 1, seen)) return true;',
    "  }",
    "  return false;",
    "}",
    "const cloud = createCloudIdentityStore({",
    '  applicationName: "identities-installed-boundary-probe",',
    "  env: {",
    '    HASNA_IDENTITIES_STORAGE_MODE: "cloud",',
    "    HASNA_IDENTITIES_DATABASE_URL: databaseUrl,",
    "  },",
    "});",
    "try {",
    '  if ("pool" in cloud.client || "close" in cloud.client) throw new Error("public query client exposes pool authority");',
    "  for (const marker of [databaseUrl, passwordMarker, databaseMarker]) {",
    '    if (graphContains(cloud, marker)) throw new Error("public cloud object graph exposes connection credentials");',
    '    if (JSON.stringify(cloud).includes(marker)) throw new Error("public cloud JSON exposes connection credentials");',
    '    if (inspect(cloud, { depth: 12, showHidden: true }).includes(marker)) throw new Error("public cloud inspection exposes connection credentials");',
    "  }",
    '  const pathMarker = "installed-identity-ca-path-marker";',
    "  let certificateError;",
    "  try {",
    "    createCloudIdentityStore({",
    "      env: {",
    '        HASNA_IDENTITIES_STORAGE_MODE: "cloud",',
    '        HASNA_IDENTITIES_DATABASE_URL: "postgresql://identity-user:installed-password-marker@127.0.0.1:1/identity?sslmode=verify-full",',
    "      },",
    "      caCertPath: `/tmp/${pathMarker}.pem`,",
    "    });",
    "  } catch (error) {",
    "    certificateError = error;",
    "  }",
    '  if (!(certificateError instanceof Error)) throw new Error("missing certificate-path failure");',
    '  if (String(certificateError).includes(pathMarker)) throw new Error("certificate error exposes its path");',
    '  if (certificateError.cause !== undefined || "path" in certificateError) throw new Error("certificate error exposes filesystem details");',
    "} finally {",
    "  await cloud.close();",
    "}",
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
    runCommand(
      [
        "node",
        typeScript,
        "--noEmit",
        "--strict",
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

function runBinProbes(consumerRoot: string): void {
  const binDirectory = join(consumerRoot, "node_modules", ".bin");
  const binCases = [
    ["identities", "--help"],
    ["identities-mcp"],
    ["identities-serve", "--help"],
  ] as const;
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
