# Side Memo

![Side Memo — your notes, right where you work](assets/side-memo-banner.png)

**Language:** **English** · [简体中文](README.zh-CN.md) · [繁體中文](README.zh-TW.md)

![Side Memo panel open in the right sidebar, with searchable notes and labels](assets/plugin0_0_1_screenshot.jpg)

A lightweight, toggleable **right-side notes panel** for [DeepSeek Harness](https://deepseek.com/harness). Jot memos while you chat — text, inline images, and labels — copy them with one click, star favorites to keep them pinned at the top, and move everything in or out as an Excel workbook.

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Version](https://img.shields.io/badge/version-1.1.0-4D6BFE)
[![CI](https://github.com/r48n34/dsh-side-memo/actions/workflows/ci.yml/badge.svg)](https://github.com/r48n34/dsh-side-memo/actions/workflows/ci.yml)
![DeepSeek Harness](https://img.shields.io/badge/DeepSeek%20Harness-0.2.x-4D6BFE)
![Platform](https://img.shields.io/badge/platform-Web%20%7C%20Desktop-lightgrey)

**Category:** UI & Experience

## Install

Install directly from this repository — the primary install path while the package is not on npm:

```bash
dsh plugin --profile web add github:r48n34/dsh-side-memo
```

> The npm package is not published yet, so the npm form below does not work today. Once it is published, the shorter command will install the same plugin:

```bash
dsh plugin --profile web add dsh-side-memo
```

If your DSH runs the Desktop profile, use the profile name shown in **Settings → Plugins** (for the Desktop app this is usually `desktop`):

```bash
dsh plugin --profile desktop add github:r48n34/dsh-side-memo
```

After installing, the **Side Memo** icon is already available in the Session header — at the header's right edge, including before any Session exists (the first screen) and on the new-Session welcome screen. Open it from there, from the Session header's right-side utilities, or from the right sidebar's add/guide control. If the icon does not appear, restart DSH once so the new plugin bundle is loaded.

To remove it, use **Settings → Plugins** in DSH (or the equivalent `dsh plugin` command for your profile).

## What it does

- **Quick notes:** Open notes beside your chat, or in a floating drawer before a Session starts.
- **Drag into chat:** Drag a memo from the list onto the chat box to paste its text into the message you are writing.
- **Stay organized:** Search notes, add labels, filter or group by label, and pin favorites.
- **Add images:** Paste or drag images into notes, or use the image button.
- **Copy and transfer:** Copy notes in one click; import or export notes as Excel workbooks.
- **Save locally:** Notes and images stay in your browser and are available across Sessions.

## Usage

1. Click the **Side Memo** icon at the right of the conversation header to open or close the panel.
2. Click **New** and start writing. Changes save automatically; you can also create a note from the editor.
3. Add labels below the title, or paste, drag in, or insert an image. Use the star to pin a favorite and the copy icon to copy a note.
4. Search or use the label filters and **Group by label** to find notes. Use the toolbar's import/export icons to transfer notes as `.xlsx` files.
5. While writing a message, drag a memo from the list onto the chat box; its text is inserted at the caret in your draft, and the memo's images stay in the panel.

Imports add new notes without overwriting existing ones. Images remain local and are not included in Excel exports.

## Compatibility

- DeepSeek Harness **0.2.x** (developed and tested against **0.2.1-rc.3**, Desktop profile).
- Web GUI and Desktop (Electron/Chromium). The client half relies on standard browser APIs: `localStorage`, IndexedDB, Clipboard, File API, `Blob`/`URL`, Canvas, and `DecompressionStream('deflate-raw')` for reading compressed `.xlsx` files.
- Uses the shipped right-sidebar plugin API (`@deepseek-ai/dsh-client-ui-sidebar-right`); the panel is a normal right-sidebar tab, so a Session is required to host it. Before any Session exists the same notes UI is rendered by the plugin itself in the frame-level overlay layer (`shell.overlay`). In the pre-Session and new-Session phases the toggle mounts through the resident header's `conversation.header.leading` seat and positions itself at the header's right edge from the live header/panel-toggle geometry.
- Uses the conversation client's composer insertion API (`inputActions`) to paste a dragged memo into the chat draft as a single undoable edit.
- No build step: `client.js` is the browser module and `index.js` is a no-op Host half.

## Permissions & privacy

- **No network access** and no external services.
- **No Host data access** and no agent-facing tools. The Host half is an empty `apply()`.
- Memos and images stay in this browser (`localStorage` for notes, under the `dsh.side-memo.notes.v1` key; IndexedDB for image data, under the `dsh-side-memo-images` database); they are not encrypted or synced across devices.
- Clipboard writes happen only when you click copy.
- Excel files are read from and written to your machine through the browser's file picker/download — they are never uploaded.

## Known limitations

- Browser-local storage only: no cross-device or cross-browser sync.
- Without a Session the notes open in the plugin's own floating drawer (the right sidebar itself is Session-scoped); the drawer and the right-sidebar tab are alternative hosts for the same notes.
- Drag-to-compose needs an open Session with an editable chat box and pastes plain text only: memo images and labels are not transferred.
- Text is plain text (no Markdown or rich-text formatting); images are the only rich content. Images are downscaled before storage and are not exported to Excel — the `Images` column only holds a count.
- Image support needs IndexedDB and Canvas. If the browser blocks IndexedDB, the text memos keep working and image insertion is disabled.
- Excel import reads the first worksheet only; formulas import as their cached values, and rich-text cell formatting is ignored.
- Limits: 300 memos, 120-character titles, 8,000-character bodies, 12 labels per memo (24 characters each), 20 images per memo (source images up to 24 MB, downscaled to at most 1,400 px at quality 0.82 before storage), 8 MB `.xlsx` imports (up to 32 MB expanded across at most 64 entries), and a 60 MB total image budget for the browser.
- Labels are flat tags — no nesting, per-label colors, or separate tag manager — and each label is stored per memo, so renaming one means editing every memo that carries it.
- Favorites are pinned within the memo list; there is no separate favorites-only view yet.

## Development

The repository is the complete plugin package — no bundler or build step:

| File | Role |
|---|---|
| `package.json` | Bundle/client manifest (`dsh.bundle` patch and `dsh.client` browser module) |
| `cordis.patch.yml` | Inserts the `dsh-side-memo` Loader row |
| `index.js` | Host half (no-op `apply`) |
| `client.js` | Notes panel, tab type, always-available header toggle, pre-Session drawer, localStorage + IndexedDB store, inline-image editor, label tags/filter/grouping, editor top-bar new-memo button, drag-memo-to-composer paste, `.xlsx` import/export |
| `locale/en.json`, `locale/zh.json` | Plugin Manager title and description |
| `icon.svg` | Plugin artwork |

Load it into a profile with the DSH Plugin Manager (`install_bundle` on this directory) or install it with the commands in [Install](#install). Package contents are limited to the files above; the npm tarball contains only runtime assets plus README and LICENSE.

### Tests

- Unit tests: `npm test` runs `node --test` on Node.js **>=22**. There are no dependencies, so no `npm install` is needed; the suite exercises the real helpers in `client.js`.
- Browser e2e (optional, dev-only; not part of `npm test`): see [`test/e2e/README.md`](test/e2e/README.md) for the isolated-profile harness and its suites.
- CI runs the unit suite on every push and pull request: [`.github/workflows/ci.yml`](.github/workflows/ci.yml).

## License

[MIT](LICENSE) © 2026 Reemo Studio
