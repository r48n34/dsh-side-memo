# Side Memo browser e2e harness

Optional, dev-only browser verification for the **real** `dsh-side-memo` plugin
UI (`client.js`). It is **not** part of `yarn test` and is not required to build or
release the plugin; it exists to prove that the labels / New memo / paste-image
features still work inside the actual DSH web shell after a markup or behavior
change.

The harness boots an isolated DSH web instance that bundles this checkout, serves
a self-checking fixture page from the **same origin** through a small reverse
proxy, and drives the real app inside an iframe. Each suite reports PASS/FAIL by
posting a JSON result to `/__verify/result`; the proxy writes it to
`test/e2e/.runtime/last-result.json`.

> The plugin only renders inside the real DSH shell (React + slot registration),
> so this harness boots the app, not a mock. It is driven through an iframe
> fixture because browser-automation runners generally cannot evaluate arbitrary
> page JavaScript, and cross-origin iframes cannot reach the app.

## Suites

| Suite | URL flag | What it verifies |
| --- | --- | --- |
| `labels` (default) | `?suite=labels` | editor label chips (Enter/comma/blur commit, duplicate, 12-label cap, Backspace on empty draft, Escape clears draft, remove), immediate localStorage persistence, reload persistence, search by label name and `#label`, label filter bar (single, AND multi-select, clear), group-by-label view (memo repeated per label, Untagged last, toggle off), and xlsx export/import of the `Labels` column |
| `newmemo` | `?suite=newmemo` | editor top-bar New memo button (`button[data-side-memo-new="true"].dsm-new-memo`): DOM/label contract, New redirects to a blank focused draft while memo A is untouched, New on an empty draft de-dupes (same note id, no count change), New after typing adds one note while earlier drafts keep their text, Back returns to a list showing all non-empty notes |
| `images` (legacy) | `?suite=images` | paste a real PNG into the rich editor, caret-at-offset-0, reload persistence, image removal (requires the custom event-bus build; kept for regression) |

Harness URL flags: `?token=<TOKEN>` (required), `?suite=labels|newmemo|images`
(default `labels`), `?noreset=1` (skip the pre-boot localStorage/IndexedDB wipe;
useful when inspecting a previous state), `?nodiv=1` / `?keep=1` (images suite
only).

## Layout

```
test/e2e/
├── config.mjs             env resolution + `--check` validation helpers (no side effects)
├── start-dsh.mjs          starts the isolated DSH web server, records its token
├── proxy.mjs              same-origin reverse proxy: /__verify/* = fixtures, rest → isolated DSH web
├── probe.mjs              read-only sanity probe (token, page, served plugin bundle markers)
├── fixtures/index.html    harness page (iframes the real app)
├── fixtures/harness.js    suite driver; posts result + sets body[data-verify-done]
├── .runtime/              generated: logs, token.txt, last-result.json (git-ignored)
└── README.md              this file
```

`client.js` is never modified or imported by these scripts; they only launch the
server that bundles it. These files are real programs, not unit tests, so each
script checks `shouldRunAsMain()` (in `config.mjs`) and only runs when invoked
directly. If a bare `node --test` run imports them because they live under
`test/`, they are harmless no-ops (the browser-only `fixtures/harness.js` also
guards on `window`/`document` being present). The supported unit entry point is
`yarn test` (`node --test test/unit/**/*.test.mjs`); a bare `node --test` is not
what this repo runs and would also import *every* file under `test/`, not just
the e2e scripts.

## Prerequisites

- Node.js >= 22 (the version range in `package.json`; developed on Node 24).
- A Chromium-based browser (Chrome or Edge) that browser automation can launch.
- A working DSH CLI: either `dsh` on `PATH`, or point `DSM_DSH_CLI` at the CLI
  executable/`.cmd` shim.
- An isolated DSH home directory (`DSM_DSH_HOME`, see below) whose `web` profile
  bundles this checkout. Never point it at your real `~/.dsh` profile.
- Two free loopback ports (`DSM_WEB_PORT`, `DSM_PROXY_PORT`; defaults 55001 and
  56000).

## Environment variables

All values are optional except `DSM_DSH_HOME` when a server is launched. Nothing
below is read from a config file, and no personal absolute path is baked into the
scripts.

| Variable | Default | Meaning |
| --- | --- | --- |
| `DSM_DSH_CLI` | `dsh` | DSH CLI command/executable to run (resolved through `PATH` when not absolute) |
| `DSM_DSH_HOME` | *(required)* | isolated `DSH_HOME` used by the test server |
| `DSM_WEB_PORT` | `55001` | port of the isolated DSH web server |
| `DSM_PROXY_PORT` | `56000` | port of the same-origin verification proxy |
| `DSM_PLUGIN_DIR` | repo root | plugin checkout that the isolated profile should bundle (sanity-checked for `package.json` + `client.js`) |
| `DSM_RUNTIME_DIR` | `test/e2e/.runtime` | logs, `token.txt`, `last-result.json` (git-ignored) |
| `DSM_FIXTURES_DIR` | `test/e2e/fixtures` | directory served at `/__verify/` |
| `DSM_TOKEN` | *(unset)* | token override for `probe.mjs` |
| `DSM_BASE_URL` | `http://127.0.0.1:<DSM_PROXY_PORT>` | probe base URL override |

Keep the isolated `DSM_DSH_HOME` **outside this checkout** (for example under
`%TEMP%` or a sibling directory). Creating it inside `test/` would make Node's
test runner discover the profile's JavaScript files on the next `yarn test`.

## One-time isolated DSH_HOME

Boot the CLI once with `DSH_HOME` pointed at a fresh directory; this creates
`profiles/web`:

```powershell
$env:DSH_HOME = "$env:TEMP\dsm-e2e-home"      # pick any disposable directory
& $env:DSM_DSH_CLI web --no-open --port 55001  # Ctrl+C after the token URL is printed
```

Then edit `$env:DSH_HOME/profiles/web/package.json` so the profile links this
checkout and bundles the plugin (use the absolute path to your clone):

```json
{
  "name": "dsh-profile-web",
  "private": true,
  "dependencies": {
    "dsh-side-memo": "link:<absolute-path-to-this-checkout>"
  },
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-web-app",
        "dsh-side-memo"
      ]
    }
  }
}
```

Finally install/link the dependency into the profile, e.g. with `yarn install` in
`$env:DSH_HOME/profiles/web`, or by creating a directory junction on Windows:

```powershell
New-Item -ItemType Junction `
  -Path "$env:DSH_HOME\profiles\web\node_modules\dsh-side-memo" `
  -Target '<absolute-path-to-this-checkout>'
```

Edit the TypeScript sources in `src/`, then run `yarn build` before restarting the
server: `client.js` is generated, and the served bundle is assembled at boot, so a
stale bundle is the usual cause of "selector not found".

## Run it

### 0. Validate the configuration (no server needed)

```powershell
node test/e2e/probe.mjs --check
node test/e2e/start-dsh.mjs --check
node test/e2e/proxy.mjs --check
```

Each prints the resolved configuration, warnings, and `config ok` / `config
INVALID`; exit code 0 means the paths, fixtures, plugin checkout, `DSM_DSH_HOME`,
and runtime directory are usable. `probe.mjs --check` deliberately succeeds
without `DSM_DSH_HOME` (it only prints a warning); `start-dsh.mjs --check`
requires it. `probe.mjs --help`, `start-dsh.mjs --help`, and `proxy.mjs --help`
exit 0 and touch nothing.

### 1. Start the isolated DSH web server

```powershell
$env:DSM_DSH_HOME = "$env:TEMP\dsm-e2e-home"
node test/e2e/start-dsh.mjs
```

The launcher runs `<DSM_DSH_CLI> web --no-open --port <DSM_WEB_PORT>` with
`DSH_HOME=<DSM_DSH_HOME>`, tees the server output to
`<DSM_RUNTIME_DIR>/dsh-web.log`, writes the printed token to
`<DSM_RUNTIME_DIR>/token.txt`, and prints the harness URL. Keep it running.

### 2. Start the same-origin proxy (second terminal)

```powershell
node test/e2e/proxy.mjs
# http://127.0.0.1:56000/  ->  http://127.0.0.1:55001/
```

It forwards everything except `/__verify/*` to the isolated server, rewriting
`Host`/`Origin`/`Referer`, and accepts `POST /__verify/result` (4 MiB JSON cap,
written atomically enough for a local check run). It only listens on loopback.

### 3. Probe (recommended)

```powershell
node test/e2e/probe.mjs        # reads token.txt; or pass <TOKEN> [baseUrl]
```

Expect `token status: 303`, `page status: 200`, `has dsh-side-memo: true`,
`plugin status: 200`, and every required marker `true` (groups `labels` +
`newmemo`). The probe prints `ALL REQUIRED MARKERS PRESENT` and exits 0; missing
markers print `MISSING MARKERS: ...`, exit 1, and mean the served bundle is stale
(restart step 1). The legacy `imagesLegacy` markers are informational
(`dsm-image-input` only exists in a custom event-bus build).

### 4. Run a UI suite in Chromium

Open the harness URL printed by step 1 (`http://127.0.0.1:56000/__verify/?token=<TOKEN>&suite=labels|newmemo|images`)
in an automated Chromium session and wait for `body[data-verify-done]`.

Example with the REA MCP browser-scenario tool (headless), which is the supported
way to run this under the DSH sandbox — launching Chrome directly from a shell
can fail with crashpad/mojo `Access is denied` there:

```json
{
  "browser": { "mode": "launch", "headless": true,
               "executable_path": "<path-to-chrome-or-edge-executable>" },
  "start_url": { "url": "http://127.0.0.1:56000/__verify/?token=<TOKEN>&suite=newmemo" },
  "actions": [ { "step_id": "wait-done", "action": "wait_for",
                 "locator": { "kind": "css", "selector": "body[data-verify-done]" },
                 "state": "attached", "timeout_ms": 90000 } ],
  "capture": { "at_end": ["screenshot", "url"], "events": ["console", "page-errors"] }
}
```

Otherwise launch any Chromium with the same URL. `harness.js` boots the app
inside the iframe, drives the suite, posts `window.__dsmTest` to
`/__verify/result`, then sets `body[data-verify-done]` (and
`data-verify-failed` when a step failed).

### 5. Read the result

- `capture_browser_scenario` console output contains `VERIFY_RESULT {...}`.
- `<DSM_RUNTIME_DIR>/last-result.json` holds the same payload (plus console
  errors if the runner captured them).
- PASS = `failed:null && error:null` and the step list ends with `all-passed`.
  Any failure is reported as `failed:<first-failing-step>`; `results.failures`
  lists `{step, error}` and `results.evidence` holds the observed values.
- The proxy also serves the last result at
  `GET http://127.0.0.1:56000/__verify/result` (404 until a suite posts one).

### Cleanup

Stop the two foreground processes (Ctrl+C) or cancel their background jobs, then
confirm nothing is bound to `DSM_WEB_PORT` / `DSM_PROXY_PORT`. The DSH home under
`DSM_RUNTIME_DIR` is disposable; `.runtime/` is git-ignored. Do not stop unrelated
Node/DSH processes on the machine.

## Evidence to expect

Highlights per suite (the authoritative record is `last-result.json`; the
`newmemo` suite is the shortest smoke run at 15 steps and is the best first-run
check).

- `labels`: memo payload `version: 3` with `labels: []`; chip commits produce
  `["work","urgent","idea"]`; 12-label cap refuses the 13th with a notice;
  duplicate/Backspace/Escape/remove behave and persist; search `work` and
  `#work` return 2 rows each, no-match shows the empty state; filter
  `work`+`urgent` returns 1 row and footer `1 of 3`; group view repeats memos per
  label with `Untagged` last; reload keeps chips; xlsx headers are exactly
  `Title, Body, Favorite, Labels, Created, Updated, Images` and importing the
  captured file round-trips labels.
- `newmemo`: `newButton` contract (`dsm-btn dsm-new-memo`, svg, locale text),
  first New click +1 note with blank focused draft and memo A untouched, second
  click on the empty draft de-dupes (same draft id, count unchanged), typed draft
  + New adds one note, Back lists exactly `Alpha memo` and `Second memo`
  (`storedCount: 2`; the last empty draft is discarded by closeEditor).
- `images` (legacy): constructed paste `DataTransfer` with a real PNG, title
  `Verify memo`, caret-at-0 paste keeps the line text, IndexedDB has 1 record
  (webp ~2.6 KB, natural 160x100), row after reload shows `· 1 image`, text
  survives. Expected console noise: one `favicon.ico` 404 plus `VERIFY_RESULT`.

## Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| `EADDRINUSE` on 55001 / 56000 | another server owns the port; stop it or set `DSM_WEB_PORT` / `DSM_PROXY_PORT` |
| probe `MISSING MARKERS` | served bundle is stale: restart `start-dsh.mjs` (bundles are assembled at boot) |
| browser suite times out at `iframe-load` | step 1 not running, or proxy points at the wrong `DSM_WEB_PORT` |
| focus assertions fail inside the app | a fresh isolated `DSH_HOME` shows a one-time shell dialog that makes `#root` inert; run `newmemo` once to dismiss it (or open the app once manually) |
| `Error: spawn EPERM` under `node --test` | Node's test runner is blocked from spawning children by a sandbox; use `node --test --test-isolation=none`, or run the unit tests outside that sandbox. This does not affect `test/e2e` scripts, which no-op under the runner |
| Chrome launches then exits with `Access is denied` | the DSH Windows sandbox blocks direct browser launches; use the browser-scenario MCP tool or run the step outside the sandbox |
| `page status` 4xx/5xx | wrong token (tokens rotate per server boot); rerun `start-dsh.mjs` and use the fresh `token.txt` |

## Caveats / limitations

- Paste is a **constructed** `ClipboardEvent('paste')` with a `DataTransfer`
  holding a real PNG; it is not an OS clipboard read. It exercises the plugin's
  `onPaste` → `clipboardImageFiles` → `insertImageFiles` path for real.
- Synthetic input events are untrusted; the harness sets controlled values with
  the native `value` descriptor and dispatches `input`/`keydown`, which is what
  the plugin's handlers consume. A few browser-only behaviors (e.g.
  `execCommand('insertText')` in a headless iframe) do not work and are avoided.
- xlsx export is intercepted by patching the iframe's `URL.createObjectURL` and
  `HTMLAnchorElement.prototype.click`; no real file download happens. The harness
  parses the captured Blob with a minimal ZIP + sheet-XML reader.
- `reload` in the labels suite is a fresh iframe boot; reload-persistence
  assertions read localStorage.
- After image removal, the harness's immediate IndexedDB check can still see the
  record (deferred delete); treat it as async GC, not a failure.
- Selectors are plugin-specific (`.dsm-*`, `data-side-memo-*`, `data-label*`);
  keep them in sync when the plugin markup changes.

## Last verified

**2026-10-29** — all three suites PASS against `client.js` SHA-256
`5419d69b00784aa22f2a1860bc346de70f5e801de64619853c83e604decb025f`
(185,183 bytes):
`labels` 53/53 steps, `newmemo` 15/15 steps, `images` 20/20 steps — 0 failures,
`failed:null`, each step list ends with `all-passed`.

Environment of that run: Windows, Node v24.14.0, Chromium 156.0.8078.48
headless driven by the REA MCP browser-scenario tool (direct Chrome launch is
blocked by the DSH sandbox), an isolated `DSM_DSH_HOME` bundling this checkout,
`DSM_WEB_PORT=55001`, `DSM_PROXY_PORT=56000`. The same booted server served all
three suites (plugin bundle rev `524ef68d8334`); the read-only probe reported
`ALL REQUIRED MARKERS PRESENT` first. `last-result.json` in the runtime directory
is the `images` run; run each suite separately to overwrite it.

Re-verified on the frozen final tree on 2026-10-29; all three suites PASSed
again. Afterwards `client.js` received one comment-only reword (the dev-harness
path in the test-hook comment now points at `test/e2e/`), so the final file's
SHA-256 is `e4a4d8a14abbfbece18bd8ce10e5d4b9c8f9322ac97c38f8e3f56ee7d62478b2`
(185,182 bytes); executable code is unchanged.
Reported steps per suite: `newmemo` 15
(`harness-start` … `all-passed`), `labels` 53, `images` 20 (the `images` suite
appends `all-passed` twice; both entries are the same terminal marker).
Durations were ~4.8 s / ~15.9 s / ~8.5 s
and are informational only. The `imagesLegacy` probe marker `dsm-image-input`
stays `false` (informational: it only exists in a custom event-bus build).

Local note: this checkout's `yarn test` only runs `test/unit`; the e2e harness is
not part of `yarn test` and this verification does not change that. Under a
sandbox that blocks Node's test-runner child processes, `yarn test` can fail with
`spawn EPERM`; use `node --test --test-isolation=none "test/unit/**/*.test.mjs"`
for local evidence (CI is unaffected).
