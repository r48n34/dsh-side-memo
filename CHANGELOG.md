# Changelog

## 1.1.0 — 2026-10-29

- The memo editor's top bar has a **New** button that creates a new memo and jumps straight into it with the title focused, so starting another memo no longer requires going back to the list first. If the open memo is still the blank draft that button just created, clicking it again reuses that draft instead of stacking up empty memos.
- Memos can now be tagged with labels — up to 12 per memo, 24 characters each. Labels are added in the editor under the title as removable chips (Enter or `,` commits the typed label), and every change saves immediately.
- Search now covers labels as well as title and body, so `#work` finds the `work` label. A label bar above the list filters by one or more labels, combining multiple selections with AND.
- The list can be grouped by label: one section per label in use, a memo appears under each of its labels, and an untagged section comes last. Each row shows up to three of its labels plus `+N` for the rest.
- Excel export gained a `Labels` column (between `Favorite` and `Created`, values joined with `, `); import reads a `Labels` column, accepts header aliases such as `tags`, `label`, `标签`, and `标记`, and workbooks without the column still import, just without labels.
- Existing saved memos keep working and simply start with no labels; the stored notes payload is upgraded in place.
- Memos can now hold images. Paste an image straight into a memo (or use the insert-image button / drag and drop); it appears inline in the memo, is downscaled to a sensible size, and is stored in IndexedDB so the text notes stay small. Images can be removed from a memo with the hover control.
- Copying an image-only memo copies the image to the clipboard; list rows and the editor footer show how many images a memo holds.
- Excel export gained an informational `Images` column; image binaries are not exported.
- The Side Memo toggle is now available before a Session is established and on the blank new-Session screen. It renders at the header's right edge — next to the right sidebar's panel toggle when present — by mounting through the resident header's `conversation.header.leading` seat and measuring the live header geometry, and it opens a frame-level notes drawer when no Session exists. Once a Session is on screen the toggle returns to the right-side Session-header utilities, and an open drawer hands off to the right sidebar automatically.
- The right sidebar's Start guide now draws a dedicated memo artwork on the Side Memo card — the plugin's page-in-brand-blue mark — instead of the generic placeholder glyph.
- Docs: added Simplified Chinese (`README.zh-CN.md`) and Traditional Chinese (`README.zh-TW.md`) READMEs, with a language switcher at the top of all three versions and a product screenshot (`assets/plugin0_0_1_screenshot.jpg`) in each.
- Memo list rows are now draggable: drop a memo on the chat box and its text is pasted into the composer at the caret as a single undoable edit, inserted through the conversation's `inputActions` API. When the composer cannot take the edit (for example while a message is submitting) the panel says so instead of dropping the memo silently; memo images and labels are not transferred.
- Release: published to npm as [`dsh-side-memo@1.1.0`](https://www.npmjs.com/package/dsh-side-memo) on 2026-10-30. The three READMEs now install from npm first (`dsh plugin --profile web add dsh-side-memo`), with the GitHub-source command kept as the fallback.

## 1.0.0 — 2026-10-28

Initial public release.

- Side Memo tab in the DSH right sidebar, with a Session-header toggle.
- Searchable plain-text notes; create, edit, delete, and one-click copy.
- Favorites that pin to the top of the list.
- Local persistence in `localStorage`, shared across Sessions.
- Excel (`.xlsx`) export and import, including the `Favorite` column.
- English and Simplified Chinese plugin metadata.
- No build step, no network access, no agent-facing tools.
