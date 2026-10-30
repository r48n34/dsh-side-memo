// Release contract: the package manifest, bundle patch, locale metadata and docs agree.
import assert from 'node:assert/strict';
import { access, readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';

import { repoRoot } from '../support/load-client.mjs';

const PACKAGE_NAME = 'dsh-side-memo';
const PACKAGE_VERSION = '1.1.0';

const readJson = async (relativePath) => JSON.parse(await readFile(join(repoRoot, relativePath), 'utf8'));
const readText = (relativePath) => readFile(join(repoRoot, relativePath), 'utf8');
const exists = async (relativePath) => {
  await access(join(repoRoot, relativePath));
  return true;
};

async function expandFilePattern(pattern) {
  if (!pattern.includes('*')) return [pattern];
  const directory = dirname(pattern);
  const entries = await readdir(join(repoRoot, directory));
  return entries.map((entry) => join(directory, entry).replaceAll('\\', '/'));
}

test('package.json declares the plugin identity and module type', async () => {
  const pkg = await readJson('package.json');
  assert.equal(pkg.name, PACKAGE_NAME);
  assert.equal(pkg.version, PACKAGE_VERSION);
  assert.equal(pkg.type, 'module');
  assert.equal(pkg.main, './index.js');
  assert.equal(pkg.license, 'MIT');
  assert.equal(pkg.engines.node, '>=22');
  assert.equal(pkg.icon, './icon.svg');
});

test('package.json has no runtime dependencies and a pinned build toolchain', async () => {
  const pkg = await readJson('package.json');
  for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
    const value = pkg[field];
    assert.ok(
      value === undefined || Object.keys(value).length === 0,
      field + ' must be empty or absent'
    );
  }
  // The published package stays dependency-free; only the TypeScript
  // sources are compiled, and the compiler is a build-time dev dependency.
  assert.deepEqual(pkg.devDependencies, {
    '@types/react': '18.3.31',
    typescript: '5.9.3'
  });
});

test('yarn test runs the unit suite glob', async () => {
  const pkg = await readJson('package.json');
  assert.equal(pkg.scripts.test, 'node --test test/unit/**/*.test.mjs');
});

test('yarn scripts build and type-check the TypeScript sources', async () => {
  const pkg = await readJson('package.json');
  assert.equal(pkg.scripts.build, 'node scripts/build.mjs');
  assert.equal(pkg.scripts.typecheck, 'tsc -p tsconfig.json');
  assert.equal(pkg.scripts.pretest, 'yarn build');
  assert.equal(pkg.scripts.prepublishOnly, 'yarn build');
  assert.equal(pkg.packageManager, 'yarn@1.22.22');
});

test('dependencies are locked with Yarn', async () => {
  assert.ok(await exists('yarn.lock'), 'yarn.lock must be committed');
  await assert.rejects(access(join(repoRoot, 'package-lock.json')), 'npm lockfile must not coexist with yarn.lock');
});

test('committed artifacts are generated from src/', async () => {
  const banner = '/* Generated from src/ by `yarn build` - do not edit directly. */';
  const client = await readText('client.js');
  const host = await readText('index.js');
  assert.ok(client.startsWith(banner), 'client.js must carry the generated banner');
  assert.ok(host.startsWith(banner), 'index.js must carry the generated banner');
  assert.ok(client.includes('require("react")'), 'client.js must receive React from the loader');
  assert.ok(!client.includes('react/jsx-runtime'), 'client.js must not need a JSX runtime');
});

test('exports targets all exist', async () => {
  const pkg = await readJson('package.json');
  for (const target of Object.values(pkg.exports)) {
    assert.equal(typeof target, 'string', 'export targets must be strings');
    if (target.includes('*')) {
      const expanded = await expandFilePattern(target);
      assert.ok(expanded.length > 0, 'glob export matched nothing: ' + target);
      for (const file of expanded) assert.ok(await exists(file), 'missing export target ' + file);
    } else {
      assert.ok(await exists(target), 'missing export target ' + target);
    }
  }
});

test('files entries all exist and cover the shipped bundle', async () => {
  const pkg = await readJson('package.json');
  assert.ok(Array.isArray(pkg.files));
  for (const pattern of pkg.files) {
    const expanded = await expandFilePattern(pattern);
    assert.ok(expanded.length > 0, 'file pattern matched nothing: ' + pattern);
    for (const file of expanded) assert.ok(await exists(file), 'missing shipped file ' + file);
  }
  for (const required of ['index.js', 'client.js', 'cordis.patch.yml', 'icon.svg', 'README.md', 'LICENSE']) {
    assert.ok(pkg.files.includes(required), 'files must ship ' + required);
  }
});

test('the DSH bundle patch points at an existing cordis patch file', async () => {
  const pkg = await readJson('package.json');
  assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml');
  assert.ok(await exists(pkg.dsh.bundle.patch));
  assert.equal(pkg.dsh.client.platform, 'web');
  assert.equal(pkg.dsh.client.immediately, true);
  assert.ok(Array.isArray(pkg.dsh.client.inject));
  assert.ok(pkg.dsh.client.inject.length > 0);
});

test('the cordis patch inserts the package under its own id', async () => {
  const patch = await readText('cordis.patch.yml');
  assert.match(patch, /^-\s+insert:/m);
  assert.match(patch, /id:\s*dsh-side-memo/);
  assert.match(patch, /name:\s*dsh-side-memo/);
});

test('client.js registers the module under the package name', async () => {
  const source = await readText('client.js');
  const match = source.match(/window\.__ModuleLoader__\.load\(\{\s*id:\s*'([^']+)'/);
  assert.ok(match, 'client.js must call window.__ModuleLoader__.load with an id');
  assert.equal(match[1], PACKAGE_NAME);
  assert.match(source, /window\.__dsmTestHooks === true/);
});

test('host index.js exports a Cordis apply function', async () => {
  const module = await import(pathToFileURL(join(repoRoot, 'index.js')).href);
  assert.equal(typeof module.apply, 'function');
});

test('locale files carry a non-empty meta title and description', async () => {
  for (const file of ['locale/en.json', 'locale/zh.json']) {
    const locale = await readJson(file);
    assert.equal(typeof locale.meta, 'object');
    assert.equal(typeof locale.meta.title, 'string');
    assert.equal(typeof locale.meta.description, 'string');
    assert.ok(locale.meta.title.trim().length > 0, file + ' meta.title must not be empty');
    assert.ok(locale.meta.description.trim().length > 0, file + ' meta.description must not be empty');
  }
});

test('screenshots.json only references existing files', async () => {
  const screenshots = await readJson('screenshots.json');
  assert.ok(Array.isArray(screenshots));
  assert.ok(screenshots.length > 0);
  for (const screenshot of screenshots) {
    assert.equal(typeof screenshot, 'string');
    assert.ok(await exists(screenshot), 'missing screenshot ' + screenshot);
  }
});

test('all README variants advertise the current version', async () => {
  const pkg = await readJson('package.json');
  for (const file of ['README.md', 'README.zh-CN.md', 'README.zh-TW.md']) {
    const source = await readText(file);
    const versions = [...source.matchAll(/badge\/version-([0-9][A-Za-z0-9.-]*)-/g)].map((match) => match[1]);
    assert.ok(versions.length > 0, file + ' should carry a version badge');
    assert.ok(versions.includes(pkg.version), file + ' badge must match package.json version ' + pkg.version);
  }
});

test('CHANGELOG top released version matches package.json', async () => {
  const pkg = await readJson('package.json');
  const source = await readText('CHANGELOG.md');
  const releases = source
    .split(/\r?\n/)
    .map((line) => line.match(/^##\s+v?(\d+\.\d+\.\d+)/))
    .filter(Boolean)
    .map((match) => match[1]);
  assert.ok(releases.length > 0, 'CHANGELOG should contain released version headings');
  assert.equal(releases[0], pkg.version);
});

test('authored tests and support files contain no absolute personal paths', async () => {
  const pending = [join(repoRoot, 'test', 'support'), join(repoRoot, 'test', 'unit')];
  const offenders = [];
  while (pending.length > 0) {
    const directory = pending.pop();
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const fullPath = join(directory, entry.name);
      if (entry.isDirectory()) pending.push(fullPath);
      else if (/\.(mjs|js|json|md)$/.test(entry.name)) {
        const source = await readFile(fullPath, 'utf8');
        if (/[A-Za-z]:\\Users\\/i.test(source) || /\/Users\//.test(source)) {
          offenders.push(fullPath);
        }
      }
    }
  }
  assert.deepEqual(offenders, []);
});
