// Loads the REAL client.js inside Node for the unit suite.
//
// client.js is a browser/DHS client plugin: at module scope it calls
// `window.__ModuleLoader__.load({ id, factory })`, and the factory only talks to
// React and the browser lazily (inside components / handlers). This loader
// installs the minimum global surface needed to evaluate the file, captures the
// module definition, and invokes the factory so every helper the opt-in test
// hook exposes is the genuine production implementation.
//
// The import uses a per-process cache-busting query, so one Node process can
// load the plugin repeatedly (each call gets a fresh module instance and a fresh
// fake window). Each `node --test` file runs in its own worker process, so this
// also works across the whole suite.
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const supportDirectory = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(supportDirectory, '..', '..');
const clientPath = join(repoRoot, 'client.js');
const clientUrl = pathToFileURL(clientPath).href;
const packageName = 'dsh-side-memo';

let importCounter = 0;

/** In-memory `localStorage` look-alike over a Map. */
export function memoryLocalStorage(seed = undefined) {
  const data = new Map();
  if (seed !== undefined && seed !== null && typeof seed === 'object') {
    for (const key of Object.keys(seed)) data.set(String(key), String(seed[key]));
  }
  return {
    getItem(key) {
      const value = data.get(String(key));
      return value === undefined ? null : value;
    },
    setItem(key, value) {
      data.set(String(key), String(value));
    },
    removeItem(key) {
      data.delete(String(key));
    },
    clear() {
      data.clear();
    },
    key(index) {
      const keys = Array.from(data.keys());
      return index >= 0 && index < keys.length ? keys[index] : null;
    },
    get length() {
      return data.size;
    },
    /** Escape hatch for assertions about what was persisted. */
    _data: data
  };
}

/**
 * Minimal IndexedDB stand-in: open succeeds, every store starts empty, and
 * put/delete complete asynchronously like the real thing. Enough for
 * createNotesStore() to reach `imagesReady` without noise; image payload
 * handling itself stays untested (it needs canvas/FileReader).
 */
export function createFakeIndexedDB() {
  const records = new Map();

  function makeRequest(result) {
    return {
      result,
      error: null,
      onsuccess: null,
      onerror: null,
      onupgradeneeded: null,
      onblocked: null
    };
  }

  const db = {
    objectStoreNames: { contains: () => true },
    createObjectStore: () => ({}),
    close() {},
    transaction() {
      const transaction = {
        error: null,
        oncomplete: null,
        onerror: null,
        onabort: null
      };
      const objectStore = {
        getAll() {
          const request = makeRequest(Array.from(records.values()));
          setTimeout(() => {
            if (typeof request.onsuccess === 'function') request.onsuccess();
          }, 0);
          return request;
        },
        put(record) {
          if (record !== null && typeof record === 'object' && record.id !== undefined) {
            records.set(String(record.id), record);
          }
          const request = makeRequest(undefined);
          setTimeout(() => {
            if (typeof transaction.oncomplete === 'function') transaction.oncomplete();
          }, 0);
          return request;
        },
        delete(id) {
          records.delete(String(id));
          setTimeout(() => {
            if (typeof transaction.oncomplete === 'function') transaction.oncomplete();
          }, 0);
          return makeRequest(undefined);
        }
      };
      transaction.objectStore = () => objectStore;
      return transaction;
    }
  };

  return {
    open() {
      const request = makeRequest(db);
      setTimeout(() => {
        if (typeof request.onupgradeneeded === 'function') request.onupgradeneeded();
        if (typeof request.onsuccess === 'function') request.onsuccess();
      }, 0);
      return request;
    },
    /** Direct access for tests that pre-seed image records. */
    _records: records
  };
}

function createReactStub() {
  // Any property is a callable that returns a value; createElement/Fragment get
  // browser-shaped answers. Nothing is rendered by the unit suite.
  return new Proxy(
    {},
    {
      get(_target, property) {
        if (property === 'createElement') return () => ({ type: 'stub-element' });
        if (property === 'Fragment') return 'Fragment';
        if (property === '__esModule') return false;
        return () => ({});
      }
    }
  );
}

function buildRequire(react) {
  return function require(id) {
    if (id === 'react') return react;
    throw new Error('client.js required an unexpected module: ' + String(id));
  };
}

function installGlobals(state) {
  globalThis.window = state.window;
  if (state.localStorage === undefined) delete globalThis.localStorage;
  else globalThis.localStorage = state.localStorage;
  if (state.indexedDB === undefined) delete globalThis.indexedDB;
  else globalThis.indexedDB = state.indexedDB;
}

/**
 * Load client.js once and call its factory.
 *
 * @param {object} [options]
 * @param {boolean} [options.hooks=true] set `window.__dsmTestHooks` before load;
 *   pass false to prove the hook stays inert without the opt-in.
 * @param {object} [options.localStorage] fake localStorage (see memoryLocalStorage);
 *   defaults to a fresh in-memory store.
 * @param {object|undefined} [options.indexedDB] fake IndexedDB; defaults to
 *   createFakeIndexedDB(). Pass `undefined` explicitly to leave it absent? (no:
 *   omit for the stub, pass `null` to remove the global).
 * @returns {Promise<{hook: object|undefined, moduleExports: object, window: object,
 *   moduleDefinition: object, localStorage: object|undefined, indexedDB: object|undefined}>}
 */
export async function loadClient(options = {}) {
  const hooks = options.hooks === undefined ? true : options.hooks === true;
  const localStorage = options.localStorage === undefined ? memoryLocalStorage() : options.localStorage;
  const indexedDB = options.indexedDB === undefined ? createFakeIndexedDB() : options.indexedDB;

  const loadedDefinitions = [];
  const window = {
    __dsmTestHooks: hooks,
    __ModuleLoader__: {
      load(definition) {
        loadedDefinitions.push(definition);
      }
    },
    addEventListener() {},
    removeEventListener() {},
    localStorage,
    indexedDB
  };

  const state = {
    window,
    localStorage: localStorage === null ? undefined : localStorage,
    indexedDB: indexedDB === null ? undefined : indexedDB
  };

  // The globals stay installed for the rest of the process: the factory body
  // (which attaches the hook and later creates the notes store) reads them when
  // it runs, and store tests may swap `globalThis.localStorage` per test.
  installGlobals(state);
  importCounter += 1;
  await import(clientUrl + '?dsm-test-load=' + importCounter);

  if (loadedDefinitions.length !== 1) {
    throw new Error('expected exactly one __ModuleLoader__.load() call, saw ' + loadedDefinitions.length);
  }
  const moduleDefinition = loadedDefinitions[0];
  if (moduleDefinition.id !== packageName) {
    throw new Error('client.js registered module id "' + moduleDefinition.id + '", expected "' + packageName + '"');
  }
  if (typeof moduleDefinition.factory !== 'function') {
    throw new Error('client.js module definition has no factory function');
  }

  const moduleExports = moduleDefinition.factory(buildRequire(createReactStub()));

  // The factory only attaches the hook when the gate was true at load time.
  const hook = window.__dsmTest;

  return {
    hook,
    moduleExports,
    window,
    moduleDefinition,
    localStorage: state.localStorage,
    indexedDB: state.indexedDB
  };
}

export { clientPath, clientUrl, repoRoot, packageName };
