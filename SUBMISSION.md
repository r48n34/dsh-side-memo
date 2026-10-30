# Release status — `r48n34/dsh-side-memo` v1.1.0 (released 2026-10-29; published to npm 2026-10-30)

Internal checklist for the v1.1.0 release. Status below covers the prepared local release tree
and the npm publication; remote push/tag checks are tracked as remaining steps and are not
claimed as verified here.

## Done

- [x] Version `1.1.0` set in `package.json`; the top `CHANGELOG.md` section is `1.1.0 — 2026-10-29`.
- [x] Tag `v1.1.0` created for the release commit.
- [x] Unit tests: a dependency-free suite run with `npm test` (`node --test`, Node.js >= 22) covering labels, note/content limits, `.xlsx` round-trip, drag-to-compose, i18n key parity, and the package contract.
- [x] CI: `.github/workflows/ci.yml` runs the unit suite and a package-content check on every push and pull request to `main`.
- [x] Release automation: `.github/workflows/release.yml` creates the GitHub Release when a `v*` tag is pushed and runs `npm publish` only when the optional `NPM_TOKEN` repository secret is configured (otherwise the publish step is skipped with a notice and the release is still created).
- [x] Git history rewritten to drop the committed development scaffolding (`.dsh-test/`, `.dsh-install/`) and the test-only credential it held.
- [x] npm publish: `dsh-side-memo@1.1.0` is live on npm (`latest` = `1.1.0`, published 2026-10-30 02:21 UTC / 10:21 HKT; the registry `gitHead` is `79f6e1c`, matching this release commit).
- [x] READMEs (English, Simplified Chinese, Traditional Chinese) now lead with the npm install command and keep the GitHub-source command as the documented fallback; the CI badge and test instructions are in place in all three.
- [x] Listing assets present: `assets/icon-180.png` (raster icon; the list does not accept the SVG), `assets/side-memo-banner.png`, `assets/plugin0_0_1_screenshot.jpg`, and `screenshots.json`.
- [x] Optional browser e2e harness ported to `test/e2e/` with its own README.

## Remaining manual steps

- [x] Make the GitHub repository (`r48n34/dsh-side-memo`) public — only after confirming `origin/main` points at the rewritten history.
- [x] Add the `dsh-plugin` GitHub topic.
- [ ] Verify remote state after the force-push: `main` contains no `.dsh-test/`/`.dsh-install/` files in tree or history, the `v1.1.0` tag exists, and CI is green on the release commit. (Could not be checked from this sandbox on 2026-10-30: `git ls-remote` cannot spawn its HTTPS helper here, so this stays unverified rather than assumed.)
- [x] npm publish: published `dsh-side-memo@1.1.0` with `npm publish` on 2026-10-30. The tag-triggered workflow still needs the optional `NPM_TOKEN` secret before a future `v*` tag can publish automatically.
- [ ] awesome-dsh-plugin submission: one PR adds exactly one file, `data/plugins/r48n34__dsh-side-memo.yml`; the list READMEs are generated, so never hand-edit them. The prepared entry YAML, PR body, and runbook live in the local, git-ignored `.scratch/awesome-submission/` directory and are not part of the published repo.
- [x] After the npm publish, the npm install command in the READMEs matches what is published (`dsh-side-memo@1.1.0`, `latest`).
- [ ] Before the next npm publish, close the two package-page gaps: npm currently selects `README.zh-TW.md` as the package readme, and the screenshot referenced by the READMEs is not in the published tarball (see below).
- [ ] Optional: unpublish the `0.0.0-stage` placeholder version while it is still inside npm's 72-hour window — `npm unpublish dsh-side-memo@0.0.0-stage` (placeholder published 2026-10-30 02:20 UTC; the window closes 2026-11-02 02:20 UTC). It is not `latest`, so installs are unaffected.

## npm publication notes (verified against the registry on 2026-10-30)

- Published package: `dsh-side-memo@1.1.0` with the `latest` dist-tag; `0.0.0-stage` is the temporary name-reservation placeholder.
- Tarball contents (12 files): `LICENSE`, `README.md`, `README.zh-CN.md`, `README.zh-TW.md`, `assets/side-memo-banner.png`, `client.js`, `cordis.patch.yml`, `icon.svg`, `index.js`, `locale/en.json`, `locale/zh.json`, `package.json`. `test/`, `assets/plugin0_0_1_screenshot.jpg`, and `screenshots.json` are not published.
- npm's readme picker globs `{README,README.*}` in the package root and takes the first Markdown match; in this checkout that resolves to `README.zh-TW.md`, so the registry stores the Traditional Chinese README (`readmeFilename: README.zh-TW.md`) and the npm page shows it. Keeping only `README.md` at the root (for example by moving the localized READMEs under `docs/`) makes npm publish the English one; this only takes effect on the next publish.
- The READMEs reference `assets/plugin0_0_1_screenshot.jpg`, which is not in the `package.json` `files` list, so the npm page has no screenshot payload to resolve it against. Add the screenshot to `files` (or link to absolute URLs) before the next publish.

## Listing facts (awesome-dsh-plugin)

- Category: `ui` — the plugin adds a panel to the existing right sidebar, ships no agent-facing tools, and is not a theme.
- Install command users see in the repo README: `dsh plugin --profile web add dsh-side-memo`; the GitHub-source form `dsh plugin --profile web add github:r48n34/dsh-side-memo` is the documented fallback.
- Icon: `assets/icon-180.png`; screenshot: `assets/plugin0_0_1_screenshot.jpg`.
- Not a duplicate: no listed plugin does Excel `.xlsx` round-trip; this one has the label model (12 labels per memo, 24 characters each, AND filter, group-by) with favorites pinning and no agent tools.
- Repository age rule: the list requires the repo to be at least one day old. The first commit is `2026-10-28 22:33 +0800`; the earliest clean submission date was therefore `2026-10-29 22:33 HKT`.

## Package identifiers

| Item | Value |
|---|---|
| npm package | `dsh-side-memo` — published, `latest` = `1.1.0` (2026-10-30) |
| GitHub repository | `r48n34/dsh-side-memo` |
| Version | `1.1.0` (released 2026-10-29; published to npm 2026-10-30) |
| License | MIT |
| awesome-dsh-plugin category | `ui` |
| DSH profile target | `web` (Desktop users use the profile shown in Settings → Plugins) |
