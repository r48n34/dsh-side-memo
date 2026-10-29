// Launch the isolated DSH web server that bundles the real Side Memo plugin.
//
//   node test/e2e/start-dsh.mjs            # foreground; Ctrl+C stops it
//   node test/e2e/start-dsh.mjs --check    # validate configuration only
//   node test/e2e/start-dsh.mjs --help     # usage
//
// Environment (see config.mjs):
//   DSM_DSH_CLI      DSH CLI to run             (default: dsh, resolved from PATH)
//   DSM_DSH_HOME     isolated DSH_HOME           (required)
//   DSM_WEB_PORT     web server port            (default 55001)
//   DSM_RUNTIME_DIR  log/token directory        (default test/e2e/.runtime)
//
// On success the server prints `dsh web: http://127.0.0.1:<port>/?token=<TOKEN>`;
// this launcher mirrors the child's stdout/stderr into
// <DSM_RUNTIME_DIR>/dsh-web.log and writes the token to
// <DSM_RUNTIME_DIR>/token.txt so the probe and the browser scenario can pick it
// up. Restart this server after editing client.js: the served bundle is
// assembled at boot (a stale bundle is the usual cause of "selector not found").
//
// The child's stdio is redirected to a file descriptor instead of a pipe: sandboxed
// environments (including the DSH Windows sandbox) can block pipe-based child
// I/O with `spawn EPERM`. The launcher therefore tails the log file to detect the
// token URL and to mirror output. The script only runs when invoked directly
// (see config.mjs `shouldRunAsMain`), so `node --test` importing it is a no-op.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import {
  resolveConfig,
  validateConfig,
  configSummary,
  ensureRuntimeDir,
  reportValidation,
  shouldRunAsMain,
} from './config.mjs';

const TOKEN_PATTERN = /https?:\/\/127\.0\.0\.1:(\d+)\/?\?token=([^\s"'<>]+)/;

function usage() {
  console.log(`Usage: node test/e2e/start-dsh.mjs [--help|--check]

Starts the isolated DSH web server with DSH_HOME=<DSM_DSH_HOME> and
\`<DSM_DSH_CLI> web --no-open --port <DSM_WEB_PORT>\`, mirrors its output to
<DSM_RUNTIME_DIR>/dsh-web.log, and records the printed token in
<DSM_RUNTIME_DIR>/token.txt.

  --help     show this help and exit
  --check    validate the configuration without starting anything

Environment: DSM_DSH_CLI, DSM_DSH_HOME (required), DSM_WEB_PORT, DSM_RUNTIME_DIR`);
}

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

/**
 * Spawn the CLI. Handles Windows `.cmd`/`.bat` shims and paths with spaces, and
 * gives the child file-descriptor stdio (see the file header).
 */
function launch(cli, cliArgs, dshHome, logFd) {
  const env = { ...process.env, DSH_HOME: dshHome };
  const stdio = ['ignore', logFd, logFd];
  if (process.platform === 'win32') {
    const quote = (text) => (/[\s"]/.test(text) ? `"${text}"` : text);
    const commandLine = `"${[quote(cli), ...cliArgs.map(quote)].join(' ')}"`;
    return spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', commandLine], {
      env,
      stdio,
      windowsVerbatimArguments: true,
    });
  }
  return spawn(cli, cliArgs, { env, stdio });
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) {
    usage();
    return;
  }

  const config = resolveConfig();
  const { errors, warnings } = validateConfig(config, { requireHome: true });
  for (const warning of warnings) console.warn(`warning: ${warning}`);

  if (argv.includes('--check')) {
    for (const [key, value] of configSummary(config)) console.log(`${key}: ${value}`);
    const hasErrors = reportValidation({ errors, warnings: [] });
    console.log(hasErrors ? 'config INVALID (server not started)' : 'config ok (server not started)');
    process.exitCode = hasErrors ? 1 : 0;
    return;
  }
  if (reportValidation({ errors, warnings: [] })) {
    process.exitCode = 1;
    return;
  }

  ensureRuntimeDir(config);
  fs.mkdirSync(config.dshHome, { recursive: true });
  // Never let a previous boot's token leak into this run.
  fs.rmSync(config.tokenFile, { force: true });

  console.log(`[dsh] cli:       ${config.dshCli}`);
  console.log(`[dsh] DSH_HOME:  ${config.dshHome}`);
  console.log(`[dsh] upstream:  ${config.upstreamOrigin}/`);
  console.log(`[dsh] log:       ${config.dshLogFile}`);
  console.log(`[dsh] token out: ${config.tokenFile}`);

  const args = ['web', '--no-open', '--port', String(config.webPort)];
  const logFd = fs.openSync(config.dshLogFile, 'w');
  let child;
  try {
    child = launch(config.dshCli, args, config.dshHome, logFd);
  } catch (error) {
    fs.closeSync(logFd);
    console.error(`[dsh] failed to start "${config.dshCli}": ${error.message}`);
    console.error('[dsh] set DSM_DSH_CLI to the DSH CLI executable (see README.md)');
    process.exitCode = 1;
    return;
  }
  fs.closeSync(logFd); // the child owns its duplicate of the descriptor now

  let spawnError = null;
  let exited = false;
  let exitCode = null;
  let exitSignal = null;
  let interrupt = null;
  child.on('error', (error) => {
    spawnError = error;
  });
  child.on('exit', (code, signal) => {
    exited = true;
    exitCode = code;
    exitSignal = signal;
  });

  const onSignal = (signal) => {
    interrupt = signal;
    try { child.kill(signal); } catch { /* the child is already gone */ }
  };
  process.on('SIGINT', () => onSignal('SIGINT'));
  process.on('SIGTERM', () => onSignal('SIGTERM'));

  let offset = 0;
  let tail = '';
  let token = '';
  let lastWaitNotice = 0;

  function writeToken(found) {
    token = found;
    fs.writeFileSync(config.tokenFile, `${token}\n`, { mode: 0o600 });
    console.log(`[dsh] token:     ${token}`);
    console.log(`[dsh] probe:     node test/e2e/probe.mjs (reads the token file)`);
    console.log(`[dsh] harness:   ${config.proxyOrigin}/__verify/?token=${encodeURIComponent(token)}`);
  }

  /** Read newly appended log bytes, mirror them, and look for the token URL. */
  function pump() {
    let size;
    try {
      size = fs.statSync(config.dshLogFile).size;
    } catch {
      return;
    }
    if (size <= offset) return;
    const length = size - offset;
    const buffer = Buffer.alloc(length);
    const fd = fs.openSync(config.dshLogFile, 'r');
    try {
      fs.readSync(fd, buffer, 0, length, offset);
    } finally {
      fs.closeSync(fd);
    }
    offset = size;
    const text = buffer.toString('utf8');
    process.stdout.write(text);
    // A single URL can be split across reads; scan a rolling tail.
    tail = (tail + text).slice(-16384);
    if (token === '') {
      const match = TOKEN_PATTERN.exec(tail);
      if (match) writeToken(match[2]);
    }
  }

  while (!exited && interrupt === null) {
    await sleep(150);
    pump();
    if (token === '' && Date.now() - lastWaitNotice > 10000) {
      lastWaitNotice = Date.now();
      console.log(`[dsh] waiting for the server to print its token URL... (log: ${config.dshLogFile})`);
    }
  }
  pump();

  if (interrupt !== null) {
    console.log(`[dsh] stopped (${interrupt})`);
    // Give the child a moment to disappear, then leave the process group.
    for (let i = 0; i < 20 && !exited; i += 1) await sleep(100);
    process.exitCode = 130;
    return;
  }
  if (spawnError) {
    console.error(`[dsh] failed to start "${config.dshCli}": ${spawnError.message}`);
    console.error('[dsh] set DSM_DSH_CLI to the DSH CLI executable (see README.md)');
    process.exitCode = 1;
    return;
  }
  if (token === '') {
    console.error(`[dsh] server exited before printing a token URL (code=${exitCode} signal=${exitSignal})`);
    console.error(`[dsh] see ${config.dshLogFile}`);
    process.exitCode = 1;
    return;
  }
  console.log(`[dsh] server stopped (code=${exitCode} signal=${exitSignal})`);
  process.exitCode = exitSignal !== null ? 1 : (exitCode ?? 0);
}

if (shouldRunAsMain(import.meta.url)) {
  await main();
}
