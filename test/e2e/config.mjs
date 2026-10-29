// Shared path/port configuration for the Side Memo browser e2e harness.
//
// Nothing in test/e2e hardcodes a personal absolute path. Every location is
// resolved from the environment (or a documented default) so the suite can run
// from any checkout:
//
//   DSM_DSH_CLI      DSH CLI executable/command to launch the isolated server
//                    (default: `dsh`, i.e. resolved through PATH)
//   DSM_DSH_HOME     isolated DSH_HOME profile used by the test server
//                    (required to launch the isolated server, see README.md)
//   DSM_WEB_PORT     port of the isolated DSH web server   (default: 55001)
//   DSM_PROXY_PORT   port of the same-origin proxy         (default: 56000)
//   DSM_PLUGIN_DIR   the plugin checkout bundled by DSH    (default: repo root,
//                    i.e. two directories above this file)
//   DSM_RUNTIME_DIR  logs/token/result scratch directory    (default: test/e2e/.runtime,
//                    ignored by git)
//
// The proxy and probe run entirely in Node; the browser is always launched
// externally (REA MCP capture_browser_scenario or a manual Chrome/Edge window).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const E2E_DIR = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(E2E_DIR, '..', '..');

/**
 * Is this process Node's test runner? `node --test` may import every `.js`/`.mjs`
 * file under `test/` as a test file; these scripts are real programs (servers,
 * launchers, probes), not tests, so they must stay inert when that happens.
 *
 * Child isolation sets NODE_TEST_CONTEXT; in-process isolation (--test-isolation=
 * none) leaves it unset but keeps --test in process.execArgv.
 */
export function isNodeTestRun() {
  if (process.env.NODE_TEST_CONTEXT) return true;
  return process.execArgv.some((arg) => arg === '--test' || arg.startsWith('--test-'));
}

/** Was this module started directly (`node test/e2e/<script>.mjs`)? */
export function isMainModule(metaUrl) {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return pathToFileURL(path.resolve(entry)).href === metaUrl;
  } catch {
    return false;
  }
}

/** True only when a script should actually run: directly, and not under `node --test`. */
export function shouldRunAsMain(metaUrl) {
  return isMainModule(metaUrl) && !isNodeTestRun();
}


const DEFAULT_WEB_PORT = 55001;
const DEFAULT_PROXY_PORT = 56000;

function parsePort(name, raw, fallback, errors) {
  if (raw === undefined || raw === null || String(raw).trim() === '') return fallback;
  const value = Number(String(raw).trim());
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    errors.push(`${name} must be an integer between 1 and 65535 (got ${JSON.stringify(raw)})`);
    return fallback;
  }
  return value;
}

function resolveFromEnv(raw, fallback) {
  const text = raw === undefined || raw === null ? '' : String(raw).trim();
  return path.resolve(text === '' ? fallback : text);
}

/**
 * Resolve every configuration value. Pure: no filesystem access, no server.
 * @param {NodeJS.ProcessEnv} [env]
 */
export function resolveConfig(env = process.env) {
  const errors = [];
  const webPort = parsePort('DSM_WEB_PORT', env.DSM_WEB_PORT, DEFAULT_WEB_PORT, errors);
  const proxyPort = parsePort('DSM_PROXY_PORT', env.DSM_PROXY_PORT, DEFAULT_PROXY_PORT, errors);
  if (webPort === proxyPort) errors.push('DSM_WEB_PORT and DSM_PROXY_PORT must differ');

  const dshCli = String(env.DSM_DSH_CLI || '').trim() || 'dsh';
  const dshHomeRaw = String(env.DSM_DSH_HOME || '').trim();
  const runtimeDir = resolveFromEnv(env.DSM_RUNTIME_DIR, path.join(E2E_DIR, '.runtime'));
  const pluginDir = resolveFromEnv(env.DSM_PLUGIN_DIR, REPO_ROOT);

  return {
    e2eDir: E2E_DIR,
    repoRoot: REPO_ROOT,
    dshCli,
    dshHome: dshHomeRaw === '' ? '' : path.resolve(dshHomeRaw),
    webPort,
    proxyPort,
    pluginDir,
    runtimeDir,
    fixturesDir: path.join(E2E_DIR, 'fixtures'),
    resultFile: path.join(runtimeDir, 'last-result.json'),
    dshLogFile: path.join(runtimeDir, 'dsh-web.log'),
    proxyLogFile: path.join(runtimeDir, 'proxy.log'),
    tokenFile: path.join(runtimeDir, 'token.txt'),
    proxyOrigin: `http://127.0.0.1:${proxyPort}`,
    upstreamOrigin: `http://127.0.0.1:${webPort}`,
    errors,
  };
}

/** Create the ignored runtime directory (idempotent). */
export function ensureRuntimeDir(config) {
  fs.mkdirSync(config.runtimeDir, { recursive: true });
  return config.runtimeDir;
}

/** Is `child` inside (or equal to) `parent`? Path-comparison helper. */
function isInside(parent, child) {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

/**
 * Validate a resolved configuration without contacting any server.
 * @param {ReturnType<typeof resolveConfig>} config
 * @param {{requireHome?: boolean}} [options]
 * @returns {{errors: string[], warnings: string[]}}
 */
export function validateConfig(config, options = {}) {
  const errors = [...config.errors];
  const warnings = [];

  // Fixtures shipped with this directory.
  for (const name of ['index.html', 'harness.js']) {
    const file = path.join(config.fixturesDir, name);
    if (!fs.existsSync(file)) errors.push(`missing fixture: ${file}`);
  }
  if (!isInside(REPO_ROOT, config.fixturesDir)) {
    warnings.push(`fixtures directory is outside the repository: ${config.fixturesDir}`);
  }

  // Plugin checkout that the isolated DSH profile must bundle.
  if (!fs.existsSync(config.pluginDir)) {
    errors.push(`DSM_PLUGIN_DIR does not exist: ${config.pluginDir}`);
  } else {
    for (const name of ['package.json', 'client.js']) {
      if (!fs.existsSync(path.join(config.pluginDir, name))) {
        errors.push(`DSM_PLUGIN_DIR is not a dsh-side-memo checkout (missing ${name}): ${config.pluginDir}`);
      }
    }
  }

  // Isolated DSH_HOME: mandatory only when this config will launch the server.
  if (config.dshHome === '') {
    if (options.requireHome) {
      errors.push('DSM_DSH_HOME is required to launch the isolated DSH web server (see README.md)');
    } else {
      warnings.push('DSM_DSH_HOME is not set (required only to launch the isolated DSH web server)');
    }
  } else if (!fs.existsSync(config.dshHome)) {
    const message = `DSM_DSH_HOME does not exist: ${config.dshHome}`;
    if (options.requireHome) errors.push(message);
    else warnings.push(message);
  } else {
    const profile = path.join(config.dshHome, 'profiles', 'web');
    if (!fs.existsSync(profile)) {
      warnings.push(`DSM_DSH_HOME has no profiles/web yet; run \`dsh web\` once to create it: ${config.dshHome}`);
    }
  }

  // Runtime directory must be writable (the proxy writes results there).
  try {
    fs.mkdirSync(config.runtimeDir, { recursive: true });
    fs.accessSync(config.runtimeDir, fs.constants.W_OK);
  } catch (error) {
    errors.push(`DSM_RUNTIME_DIR is not writable (${config.runtimeDir}): ${error.message}`);
  }

  return { errors, warnings };
}

/** Human-readable `[key, value]` rows for logs and `--check` output. */
export function configSummary(config) {
  return [
    ['DSM_DSH_CLI', config.dshCli],
    ['DSM_DSH_HOME', config.dshHome === '' ? '(not set)' : config.dshHome],
    ['DSM_WEB_PORT', String(config.webPort)],
    ['DSM_PROXY_PORT', String(config.proxyPort)],
    ['DSM_PLUGIN_DIR', config.pluginDir],
    ['DSM_RUNTIME_DIR', config.runtimeDir],
    ['fixtures', config.fixturesDir],
    ['result file', config.resultFile],
  ];
}

/** Print an error/warning block; returns true when there are errors. */
export function reportValidation({ errors, warnings }, out = console.error) {
  for (const warning of warnings) out(`warning: ${warning}`);
  for (const error of errors) out(`error: ${error}`);
  return errors.length > 0;
}
