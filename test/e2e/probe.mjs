// Read-only probe of the verification proxy / isolated DSH web server.
//
//   node test/e2e/probe.mjs --help
//   node test/e2e/probe.mjs --check                  # config validation, no server needed
//   node test/e2e/probe.mjs <token> [baseUrl]
//
// Prints: token exchange status, cookie name, page status/size, the served
// Side Memo plugin URL and size, and whether the served bundle contains the
// rich-editor / paste-image feature markers. Requires the proxy
// (test/e2e/proxy.mjs) and the isolated DSH web server to be running.
//
// The token is printed by the isolated server; test/e2e/start-dsh.mjs stores it
// in <DSM_RUNTIME_DIR>/token.txt, so this probe can also read it from there when
// no positional token is given. Base URL defaults to http://127.0.0.1:<DSM_PROXY_PORT>.
//
// The script only runs when invoked directly (see config.mjs `shouldRunAsMain`),
// so `node --test` accidentally importing it is a harmless no-op.

import fs from 'node:fs';
import {
  resolveConfig,
  validateConfig,
  configSummary,
  reportValidation,
  shouldRunAsMain,
} from './config.mjs';

function usage() {
  console.log(`Usage: node test/e2e/probe.mjs [--help|--check] [<token>] [baseUrl]

Read-only sanity probe for the Side Memo browser e2e harness.

  --help     show this help and exit
  --check    resolve/validate the environment configuration without any server
  <token>    DSH web server token (default: DSM_TOKEN, else <DSM_RUNTIME_DIR>/token.txt)
  baseUrl    proxy origin (default: http://127.0.0.1:<DSM_PROXY_PORT>)

Environment (see config.mjs):
  DSM_DSH_CLI, DSM_DSH_HOME, DSM_WEB_PORT, DSM_PROXY_PORT,
  DSM_PLUGIN_DIR, DSM_RUNTIME_DIR, DSM_TOKEN, DSM_BASE_URL

Requires the proxy (node test/e2e/proxy.mjs) and the isolated DSH web server.`);
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) {
    usage();
    return;
  }

  const config = resolveConfig();

  if (argv.includes('--check')) {
    const validation = validateConfig(config, { requireHome: false });
    for (const [key, value] of configSummary(config)) console.log(`${key}: ${value}`);
    console.log(`probe base: ${config.proxyOrigin}`);
    const hasErrors = reportValidation(validation);
    console.log(hasErrors ? 'config INVALID' : 'config ok (no server contacted)');
    process.exitCode = hasErrors ? 1 : 0;
    return;
  }

  const positional = argv.filter((arg) => !arg.startsWith('-'));
  let token = positional[0] || process.env.DSM_TOKEN || '';
  if (token === '' && fs.existsSync(config.tokenFile)) {
    try {
      token = fs.readFileSync(config.tokenFile, 'utf8').trim();
      if (token !== '') console.log(`using token from ${config.tokenFile}`);
    } catch {
      // fall through to the usage error below
    }
  }
  if (token === '') {
    console.error('missing token: pass it as the first argument, set DSM_TOKEN, or run start-dsh.mjs first');
    usage();
    process.exitCode = 2;
    return;
  }

  const base = (positional[1] || process.env.DSM_BASE_URL || config.proxyOrigin).replace(/\/$/, '');
  console.log(`probe base: ${base}`);

  const jar = new Map();
  function cookieHeader() {
    return Array.from(jar.entries()).map(([k, v]) => `${k}=${v}`).join('; ');
  }
  function storeCookies(response) {
    for (const raw of response.headers.getSetCookie ? response.headers.getSetCookie() : []) {
      const [pair] = raw.split(';');
      const index = pair.indexOf('=');
      if (index > 0) jar.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim());
    }
  }
  async function get(url, redirect = 'manual') {
    const headers = {};
    if (jar.size > 0) headers.cookie = cookieHeader();
    const response = await fetch(url, { redirect, headers });
    storeCookies(response);
    return response;
  }

  const tokenUrl = `${base}/?token=${encodeURIComponent(token)}`;
  let first;
  try {
    first = await get(tokenUrl);
  } catch (error) {
    console.error(`cannot reach ${tokenUrl}: ${error.message}`);
    console.error('is the proxy running? node test/e2e/proxy.mjs');
    process.exitCode = 1;
    return;
  }
  console.log('token status:', first.status, 'location:', first.headers.get('location'));
  const page = first.status >= 300 && first.status < 400
    ? await get(new URL(first.headers.get('location'), tokenUrl), 'follow')
    : first;
  const html = await page.text();
  console.log('page status:', page.status, 'bytes:', Buffer.byteLength(html), 'cookies:', Array.from(jar.keys()).join(','));
  console.log('has __DSH_BOOT__:', html.includes('__DSH_BOOT__'), '| has dsh-side-memo:', html.includes('dsh-side-memo'));

  const match = /"id":"dsh-side-memo","url":"([^"]+)"/.exec(html);
  if (!match) {
    console.log('PLUGIN ENTRY NOT FOUND in page HTML');
    process.exitCode = 1;
    return;
  }
  const pluginUrl = match[1];
  console.log('plugin url:', pluginUrl);
  const pluginResponse = await get(new URL(pluginUrl, page.url || tokenUrl), 'follow');
  const bundle = await pluginResponse.text();
  const groups = {
    // labels feature (client.js rev with labels) — required
    labels: ['dsm-label-input', 'dsm-labels-editor', 'dsm-labels-bar', 'dsm-group-toggle',
      'dsm-label-filter', 'dsm-row-labels', 'labels.duplicate', 'labels.limit'],
    // editor top-bar "New memo" button (newmemo suite) — required
    newmemo: ['data-side-memo-new', 'dsm-new-memo', 'handleNewMemo', 'focusTitleInput', 'editor.new'],
    // rich editor / paste-image markers (legacy images suite). Informational:
    // dsm-image-input only exists in a custom event-bus build, so its absence
    // must not fail the probe used by the labels/newmemo runs.
    imagesLegacy: ['handleEditorPaste', 'clipboardImageFiles', 'insertImageIntoEditor',
      'dsm-editor-body', 'contentEditable', 'dsm-image-input', 'onPaste'],
  };
  const requiredGroups = ['labels', 'newmemo'];
  console.log('plugin status:', pluginResponse.status, 'bytes:', Buffer.byteLength(bundle));
  const missing = [];
  for (const [group, markers] of Object.entries(groups)) {
    const required = requiredGroups.includes(group);
    const groupMissing = markers.filter((marker) => !bundle.includes(marker));
    for (const marker of markers) {
      const present = bundle.includes(marker);
      console.log(`  ${marker}: ${present}${required ? '' : ' (informational)'}`);
      if (!present && required) missing.push(`${group}:${marker}`);
    }
    if (!required && groupMissing.length > 0) {
      console.log(`  note: optional ${group} markers absent: ${groupMissing.join(', ')}`);
    }
  }
  if (missing.length > 0) {
    console.log('MISSING MARKERS:', missing.join(', '));
    console.log('the served bundle is stale: restart the isolated DSH web server (start-dsh.mjs)');
    process.exitCode = 1;
  } else {
    console.log('ALL REQUIRED MARKERS PRESENT');
  }
}

if (shouldRunAsMain(import.meta.url)) {
  await main();
}
