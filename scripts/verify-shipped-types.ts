#!/usr/bin/env bun

// Freshness gate for the committed declaration tree.
//
// `types/` is generated from `src/` but committed, because a scriptless exact-Git
// install (`bun add github:hasna/identities#<sha>`) can only ship what the Git tree
// already contains — there is no build step and no lifecycle script to run one.
// Shipping declarations (instead of pointing the `types` condition at raw source)
// keeps a consumer's own compiler flags from typechecking our implementation.
//
// This script re-emits declarations into a temporary directory and compares them
// against the committed tree, so `types/` can never silently drift from `src/`.

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";

const packageRoot = resolve(import.meta.dir, "..");
// `--committed <dir>` exists so the drift detection itself can be exercised by a
// test against a deliberately stale copy; it defaults to the shipped tree.
const committedArgument = Bun.argv.slice(2).filter((argument) => argument !== "--");
const committedRoot = committedArgument[0] === "--committed" && committedArgument[1] !== undefined
  ? resolve(committedArgument[1])
  : join(packageRoot, "types");
const temporaryRoot = await mkdtemp(join(tmpdir(), "identities-shipped-types-"));

try {
  emitDeclarations(temporaryRoot);
  const expected = await declarationTree(temporaryRoot);
  const committed = await declarationTree(committedRoot);

  const missing = [...expected.keys()].filter((path) => !committed.has(path)).sort();
  const extra = [...committed.keys()].filter((path) => !expected.has(path)).sort();
  const changed = [...expected.entries()]
    .filter(([path, contents]) => committed.get(path) !== undefined && committed.get(path) !== contents)
    .map(([path]) => path)
    .sort();

  const problems = [
    missing.length > 0 ? `missing: ${missing.join(", ")}` : undefined,
    extra.length > 0 ? `stale: ${extra.join(", ")}` : undefined,
    changed.length > 0 ? `out of date: ${changed.join(", ")}` : undefined,
  ].filter((problem): problem is string => problem !== undefined);

  if (problems.length > 0) {
    throw new Error(
      `committed types/ tree does not match src/ (${problems.join("; ")}). Run \`bun run build:types\` and commit the result.`,
    );
  }

  console.log(`shipped types: ${expected.size} declaration files match src/`);
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

function emitDeclarations(outputDirectory: string): void {
  const result = Bun.spawnSync({
    cmd: [
      join(packageRoot, "node_modules", ".bin", "tsc"),
      "--emitDeclarationOnly",
      "--outDir",
      outputDirectory,
    ],
    cwd: packageRoot,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    throw new Error(
      `declaration emit failed with ${result.exitCode}\n${result.stdout.toString()}\n${result.stderr.toString()}`
        .trim(),
    );
  }
}

async function declarationTree(root: string): Promise<Map<string, string>> {
  const tree = new Map<string, string>();
  for await (const path of new Bun.Glob("**/*.d.ts").scan({ cwd: root, onlyFiles: true })) {
    tree.set(normalizeSeparators(path), await readFile(join(root, path), "utf8"));
  }
  return tree;
}

function normalizeSeparators(path: string): string {
  return relative(".", path).split("\\").join("/");
}
