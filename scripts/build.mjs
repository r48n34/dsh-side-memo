/**
 * Build the shipped plugin artifacts from the TypeScript sources.
 *
 * - `src/client/index.ts` is emitted as a CommonJS module and wrapped in the
 *   `window.__ModuleLoader__.load(...)` contract DSH expects (`client.js`).
 * - `src/host/index.ts` is emitted as ESM (`index.js`).
 *
 * The build uses the TypeScript compiler API in-process (no bundler, no child
 * processes) so the output is deterministic and the only dev dependency is
 * `typescript` itself. Both artifacts are committed so registry and GitHub
 * installs never need the dev toolchain; CI asserts they match a fresh build.
 */
import ts from 'typescript';
import { writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BANNER = '/* Generated from src/ by `yarn build` - do not edit directly. */\n';
const MODULE_ID = 'dsh-side-memo';
const MAX_CLIENT_BYTES = 512 * 1024;

const BASE_OPTIONS = {
  target: ts.ScriptTarget.ES2022,
  strict: true,
  skipLibCheck: true,
  isolatedModules: true,
  forceConsistentCasingInFileNames: true,
  noEmitOnError: true,
  types: [],
  lib: ['lib.es2022.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'],
  rootDir: resolve(ROOT, 'src'),
  noEmit: false,
  declaration: false,
  sourceMap: false,
};

function formatDiagnostics(diagnostics) {
  const host = {
    getCanonicalFileName: (fileName) => fileName,
    getCurrentDirectory: () => ROOT,
    getNewLine: () => '\n',
  };
  return ts.formatDiagnostics(diagnostics, host);
}

/** Emit `rootNames` in memory and return { relativePath -> text }. */
function emit(rootNames, options) {
  const program = ts.createProgram({ rootNames, options });
  const diagnostics = ts.getPreEmitDiagnostics(program);
  const outputs = new Map();
  const emitResult = program.emit(undefined, (fileName, text) => {
    outputs.set(fileName, text);
  });
  const all = diagnostics.concat(emitResult.diagnostics);
  if (all.length > 0) {
    process.stderr.write(formatDiagnostics(all));
    throw new Error('TypeScript reported ' + all.length + ' diagnostic(s); no artifacts written');
  }
  const relative = new Map();
  for (const [fileName, text] of outputs) {
    relative.set(fileName.split(sep).join('/'), text);
  }
  return relative;
}

function outputFor(outputs, suffix) {
  for (const [fileName, text] of outputs) {
    if (fileName.endsWith(suffix)) return text;
  }
  throw new Error('no emitted output ending in ' + suffix + ' (got: ' + [...outputs.keys()].join(', ') + ')');
}

function wrapClient(moduleText) {
  const body = moduleText.replace(/\n+$/, '');
  if (!body.includes('require("react")')) {
    throw new Error('client module must require("react") from the loader');
  }
  if (body.includes('react/jsx-runtime')) {
    throw new Error('client module must not depend on react/jsx-runtime (no JSX is used)');
  }
  for (const marker of ['window.__dsmTestHooks === true', 'window.__dsmTest = {']) {
    const count = body.split(marker).length - 1;
    if (count !== 1) throw new Error('client module must contain ' + marker + ' exactly once');
  }

  const artifact =
    BANNER +
    'window.__ModuleLoader__.load({\n' +
    "  id: '" + MODULE_ID + "',\n" +
    '  factory: function (require) {\n' +
    '    var module = { exports: {} };\n' +
    '    var exports = module.exports;\n' +
    body.replace(/^/gm, '    ') + '\n' +
    '    return module.exports;\n' +
    '  }\n' +
    '});\n';

  const bytes = Buffer.byteLength(artifact, 'utf8');
  if (bytes > MAX_CLIENT_BYTES) {
    throw new Error('client.js is ' + bytes + ' bytes; ceiling is ' + MAX_CLIENT_BYTES);
  }
  return artifact;
}

const clientOutputs = emit(
  [resolve(ROOT, 'src/client/index.ts'), resolve(ROOT, 'src/client/globals.d.ts')],
  {
    ...BASE_OPTIONS,
    module: ts.ModuleKind.CommonJS,
    moduleResolution: ts.ModuleResolutionKind.Node10,
    outDir: resolve(ROOT, '.build/client'),
    esModuleInterop: false,
  }
);
const clientArtifact = wrapClient(outputFor(clientOutputs, '/client/index.js'));

const hostOutputs = emit([resolve(ROOT, 'src/host/index.ts')], {
  ...BASE_OPTIONS,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  outDir: resolve(ROOT, '.build/host'),
  esModuleInterop: false,
});
const hostArtifact = BANNER + outputFor(hostOutputs, '/host/index.js').replace(/\n+$/, '') + '\n';

await writeFile(resolve(ROOT, 'client.js'), clientArtifact, 'utf8');
await writeFile(resolve(ROOT, 'index.js'), hostArtifact, 'utf8');
process.stderr.write(
  'build: client.js ' +
    Buffer.byteLength(clientArtifact, 'utf8') +
    ' bytes, index.js ' +
    Buffer.byteLength(hostArtifact, 'utf8') +
    ' bytes\n'
);
