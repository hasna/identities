import { mkdir } from "node:fs/promises";
import { join } from "node:path";

const inheritedEnvironmentNames = [
  "CI",
  "COMSPEC",
  "FORCE_COLOR",
  "HTTPS_PROXY",
  "HTTP_PROXY",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "NO_COLOR",
  "NO_PROXY",
  "PATH",
  "PATHEXT",
  "SSL_CERT_DIR",
  "SSL_CERT_FILE",
  "SYSTEMROOT",
  "WINDIR",
  "https_proxy",
  "http_proxy",
  "no_proxy",
] as const;

export function isolatedPackageConsumerEnvironment(
  root: string,
): Record<string, string | undefined> {
  const inherited: Record<string, string | undefined> = {};
  for (const name of inheritedEnvironmentNames) {
    const value = process.env[name];
    if (value !== undefined) inherited[name] = value;
  }
  const nullDevice = process.platform === "win32" ? "NUL" : "/dev/null";
  return {
    ...inherited,
    BUN_INSTALL: undefined,
    BUN_INSTALL_CACHE_DIR: join(root, ".bun-cache"),
    GIT_CONFIG_GLOBAL: nullDevice,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_SYSTEM: nullDevice,
    GIT_TERMINAL_PROMPT: "0",
    HOME: join(root, ".home"),
    NODE_EXTRA_CA_CERTS: undefined,
    NODE_OPTIONS: undefined,
    NODE_PATH: undefined,
    USERPROFILE: join(root, ".home"),
    XDG_CACHE_HOME: join(root, ".cache"),
    XDG_CONFIG_HOME: join(root, ".config"),
    XDG_DATA_HOME: join(root, ".data"),
    npm_config_cache: join(root, ".npm-cache"),
    npm_config_globalconfig: nullDevice,
    npm_config_userconfig: join(root, ".npmrc"),
  };
}

export async function preparePackageConsumerEnvironment(root: string): Promise<void> {
  await Promise.all(
    [".bun-cache", ".cache", ".config", ".data", ".home", ".npm-cache"].map((directory) =>
      mkdir(join(root, directory), { recursive: true })
    ),
  );
}
