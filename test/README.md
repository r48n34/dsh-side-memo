# Unit tests

Node-only unit suite for the `dsh-side-memo` client plugin. It uses the built-in
`node:test` runner and `node:assert/strict` only — there are no test dependencies
and nothing is built, so a checkout is ready to test.

The suite loads the **real** `client.js` module in Node through a test-only loader
(`test/support/load-client.mjs`) and drives the same plain-data helpers the
opt-in browser hook (`window.__dsmTest`) exposes. It never starts a browser,
Electron or a DSH host.

## Requirements

- Node.js 22 or newer (CI runs 22.x and 24.x; developed on 24)
- Run commands from the repository root

## Commands

```powershell
# CI form: what `npm test` runs
node --test test/unit/**/*.test.mjs

# one file while iterating
node test/unit/labels.test.mjs
```

Node 22+ treats positional arguments as **glob patterns**, so `node --test test/unit`
does not recurse into the directory — the `test/unit/**/*.test.mjs` glob is required.
`test/e2e/` is deliberately outside this glob.

### Sandboxes that block child processes

The default runner executes each test file in a child process. In a restricted
environment where spawning is denied (`Error: spawn EPERM` from the test runner,
not from the tests themselves) either run a file directly:

```powershell
node test/unit/labels.test.mjs
```

or run the whole suite in one process:

```powershell
node --test --test-isolation=none "test/unit/**/*.test.mjs"
```

Both forms execute the same tests and assertions.

## What is covered

| File | Covers |
| --- | --- |
| `test/unit/hook.test.mjs` | The 49-key `window.__dsmTest` surface, exact `constants` values, existing keys preserved, gate inert when `window.__dsmTestHooks !== true`, per-instance isolation |
| `test/unit/labels.test.mjs` | `normalizeLabel`, `normalizeLabels`, `noteLabels`, `noteHasLabel`, `noteImageIds`, `imageCountLabel` |
| `test/unit/content.test.mjs` | `textBlocksForBody`, `contentText`, `fitContent`, `normalizeContent`, CRLF handling, `MAX_BODY` truncation, image/text block boundaries |
| `test/unit/notes.test.mjs` | `normalizeNote` validation/truncation/defaults, `createNotesStore` load/save round-trip, `MAX_NOTES` cap, create/update/setFavorite/remove/importMany, persistence failures, image records through the fake IndexedDB |
| `test/unit/xlsx.test.mjs` | UTF-8 encode/decode, CRC-32 check value, `xmlEscape`/`xmlDecode`, `xlsxCell`, store-only ZIP layout, `buildXlsxNotes` → `parseSheetRows` round-trip, `importTimestamp`, `importFavorite`, label/header parsing |
| `test/unit/drag-drop.test.mjs` | `memoDragText`/`memoDragPayload`, `fillMemoDragData`, `readMemoDragPayload` (malformed JSON safety), `memoDragTypesInclude`, `composerEditorFor`, `planMemoDrop`, `insertMemoIntoComposer` |
| `test/unit/i18n.test.mjs` | `dict.zh` / `dict.en` key parity, `{placeholder}` parity and multiplicity, non-empty translations, locale namespaces |
| `test/unit/package-contract.test.mjs` | `package.json` identity/version/`files`/`exports` targets/no dependencies, DSH bundle patch, `cordis.patch.yml`, module id, locale metadata, screenshots, README version badges, CHANGELOG top release, no absolute personal paths in authored tests |

## How the loader works

`test/support/load-client.mjs` exports `loadClient(options)`:

1. installs a minimal `globalThis.window` (`__dsmTestHooks`, listeners,
   `localStorage`) and a fake IndexedDB on the process globals;
2. captures the module definition from `window.__ModuleLoader__.load(...)`;
3. imports `client.js` with a cache-busting query so repeated calls get a fresh
   module instance;
4. calls `definition.factory(require)` with a React proxy stub (`react` is the
   only allowed dependency) and returns `{ hook, moduleExports, window }`.

Because the hook block only runs when `window.__dsmTestHooks === true`,
`loadClient({ hooks: false })` proves the hook is inert without touching the
default path.

`memoryLocalStorage()` and `createFakeIndexedDB()` are exported for tests that
seed or inspect persisted state.

## Known gaps

Not covered by this unit suite (verified manually or by `test/e2e/`):

- React rendering and DOM interaction: drawer/toggle components, focus handling,
  contenteditable behavior, real `dragstart`/`drop` events, paste/copy.
- Image pipeline in a real browser: `FileReader`, `createImageBitmap`, canvas
  re-encoding/quality limits, `prepareImageFile` for large files.
- Real IndexedDB and `localStorage` behavior: quota failures, `pagehide`
  flush timing, multi-tab races. The suite uses in-memory fakes.
- Real `.xlsx` files through the file picker / download path and Excel itself;
  the ZIP/OOXML helpers are round-tripped in memory only.
- DSH/Electron host integration, locale switching UI and visual layout.
- Browser and OS-specific drag-and-drop permission rules.

When adding tests, prefer seeding through `loadClient()` and the exported fakes,
use `waitFor`-style polling for the asynchronous image store, and do not add
external dependencies or absolute workstation paths.
