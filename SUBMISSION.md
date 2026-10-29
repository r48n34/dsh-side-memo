# Release status — `r48n34/dsh-side-memo` v1.1.0 (2026-10-29)

Internal checklist for the v1.1.0 release. Status below describes the prepared local release
tree; remote push/tag checks are tracked as remaining steps and are not claimed as verified
here.

## Done

- [x] Version `1.1.0` set in `package.json`; the top `CHANGELOG.md` section is `1.1.0 — 2026-10-29`.
- [x] Tag `v1.1.0` created for the release commit.
- [x] Unit tests: a dependency-free suite run with `npm test` (`node --test`, Node.js >= 22) covering labels, note/content limits, `.xlsx` round-trip, drag-to-compose, i18n key parity, and the package contract.
- [x] CI: `.github/workflows/ci.yml` runs the unit suite and a package-content check on every push and pull request to `main`.
- [x] Release automation: `.github/workflows/release.yml` creates the GitHub Release when a `v*` tag is pushed and runs `npm publish` only when the optional `NPM_TOKEN` repository secret is configured (otherwise the publish step is skipped with a notice and the release is still created).
- [x] Git history rewritten to drop the committed development scaffolding (`.dsh-test/`, `.dsh-install/`) and the test-only credential it held.
- [x] READMEs (English, Simplified Chinese, Traditional Chinese) tell one install story: GitHub source is primary, npm is the "once published on npm" alternative; the CI badge and test instructions are in place in all three.
- [x] Listing assets present: `assets/icon-180.png` (raster icon; the list does not accept the SVG), `assets/side-memo-banner.png`, `assets/plugin0_0_1_screenshot.jpg`, and `screenshots.json`.
- [x] Optional browser e2e harness ported to `test/e2e/` with its own README.

## Remaining manual steps

- [ ] Make the GitHub repository (`r48n34/dsh-side-memo`) public — only after confirming `origin/main` points at the rewritten history.
- [ ] Add the `dsh-plugin` GitHub topic.
- [ ] Verify remote state after the force-push: `main` contains no `.dsh-test/`/`.dsh-install/` files in tree or history, the `v1.1.0` tag exists, and CI is green on the release commit.
- [ ] Optional npm publish: run `npm login && npm publish` locally once, or add the `NPM_TOKEN` secret and re-run the `v1.1.0` release workflow so its publish step runs. The npm package is not published yet (registry 404 on 2026-10-29), which is why all three READMEs lead with the GitHub-source command.
- [ ] awesome-dsh-plugin submission: one PR adds exactly one file, `data/plugins/r48n34__dsh-side-memo.yml`; the list READMEs are generated, so never hand-edit them. The prepared entry YAML, PR body, and runbook live in the local, git-ignored `.scratch/awesome-submission/` directory and are not part of the published repo.
- [ ] After the npm publish (if it happens), confirm the npm install command in the READMEs still matches what is published.

## Listing facts (awesome-dsh-plugin)

- Category: `ui` — the plugin adds a panel to the existing right sidebar, ships no agent-facing tools, and is not a theme.
- Install command shown to users: `dsh plugin --profile web add github:r48n34/dsh-side-memo`.
- Icon: `assets/icon-180.png`; screenshot: `assets/plugin0_0_1_screenshot.jpg`.
- Not a duplicate: no listed plugin does Excel `.xlsx` round-trip; this one has the label model (12 labels per memo, 24 characters each, AND filter, group-by) with favorites pinning and no agent tools.
- Repository age rule: the list requires the repo to be at least one day old. The first commit is `2026-10-28 22:33 +0800`; the earliest clean submission date was therefore `2026-10-29 22:33 HKT`.

## Package identifiers

| Item | Value |
|---|---|
| npm package | `dsh-side-memo` (not published yet; registry 404 as of 2026-10-29) |
| GitHub repository | `r48n34/dsh-side-memo` |
| Version | `1.1.0` (2026-10-29) |
| License | MIT |
| awesome-dsh-plugin category | `ui` |
| DSH profile target | `web` (Desktop users use the profile shown in Settings → Plugins) |
