/* Side Memo UI verification harness.
 *
 * Loaded from the same origin as the DSH web app through proxy.mjs. The real
 * plugin UI runs inside an iframe and this script drives it the way a user
 * would, then POSTs a machine-readable report to /__verify/result (written to
 * <DSM_RUNTIME_DIR>/last-result.json by the proxy; default test/e2e/.runtime)
 * and sets body[data-verify-done] so the browser runner can wait on it.
 *
 * Suites (query parameter `?suite=...`):
 *   labels (default) — the labels/tags round: editor label chips (Enter, comma
 *     and blur commits), duplicate + 12-label cap, immediate persistence,
 *     removal, search by label and #label, filter bar with AND semantics and
 *     "All labels" clear, group-by-label sections with the untagged section
 *     last, reload persistence, and an .xlsx export/import round-trip that
 *     checks the Labels column.
 *   images — the previous paste-image regression suite (unchanged checks):
 *     create memo, paste a real PNG at caret offset 0, reload, remove image.
 *   newmemo — the editor top-bar "New memo" button: (1) New from an existing
 *     memo redirects to a blank draft (empty title/body, title focused, note
 *     count +1, previous memo untouched), (2) New on an empty draft creates no
 *     extra note and keeps that draft focused, (3) New after typing in the
 *     draft creates exactly one new blank draft and keeps earlier text, (4)
 *     back returns to the list showing all non-empty notes.
 *
 * Flags: ?token=<TOKEN> (required), ?suite=labels|images|newmemo, ?noreset=1
 * (do not clear localStorage/IndexedDB before boot), ?keep=1 (images suite:
 * keep the memo + image for a screenshot instead of removing it).
 *
 * Every step is self-checking: a failed assertion is recorded as a step with
 * ok:false and the suite continues with independent sections where safe. The
 * first failure lands in results.failed / results.error; results.failures has
 * all of them. PASS = failed:null && error:null and the last step is
 * "all-passed".
 */
// Node's test runner (`node --test`) discovers every `.js`/`.mjs` file under
// `test/` and would execute this browser-only driver in Node, where `window`
// and `document` do not exist. Stay inert there so test discovery cannot fail
// on a browser fixture; the real suite only ever runs inside a page.
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
(function () {
  'use strict';

  const t0 = Date.now();
  const params = new URLSearchParams(location.search);
  const token = params.get('token') || '';
  const suite = params.get('suite') || 'labels';
  const resultEl = document.getElementById('verify-result');
  const frame = document.getElementById('app');
  const NOTES_KEY = 'dsh.side-memo.notes.v1';
  const LABELS_SUITE = 'labels';
  const IMAGES_SUITE = 'images';
  const NEWMEMO_SUITE = 'newmemo';

  const results = {
    suite: suite,
    startedAt: new Date().toISOString(),
    token: token === '' ? '(missing)' : '(set)',
    steps: [],
    failures: [],
    consoleNotes: [],
    failed: null,
    error: null,
    evidence: {},
  };
  let finished = false;
  // Captured xlsx bytes live in memory (not in results.evidence) so the
  // VERIFY_RESULT console payload stays small; the import step reuses them.
  let capturedXlsxBytes = null;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function elapsed() { return Date.now() - t0; }

  function renderSteps() {
    if (resultEl === null) return;
    resultEl.textContent = results.steps
      .map((s) => `${s.at}ms ${s.ok === false ? 'FAIL ' : ''}${s.step}${s.detail ? ': ' + s.detail : ''}`)
      .join('\n');
  }

  function pushStep(name, detail, ok) {
    results.steps.push({
      at: elapsed(),
      step: name,
      detail: detail === undefined ? '' : String(detail),
      ok: ok !== false,
    });
    renderSteps();
  }

  function errorText(error) {
    if (error instanceof Error) return error.message || String(error);
    return String(error);
  }

  /** Section abort marker: the step failure is already recorded. */
  function Halt(name) {
    this.name = 'Halt';
    this.step = name;
    this.message = 'section aborted after failed step: ' + name;
  }
  Halt.prototype = Object.create(Error.prototype);

  async function must(name, fn) {
    try {
      const detail = await fn();
      pushStep(name, detail === undefined ? 'ok' : detail);
      return detail;
    } catch (error) {
      if (error instanceof Halt) throw error;
      const message = errorText(error);
      results.failures.push({ step: name, message: message });
      results.evidence['failure_' + name] = {
        message: message,
        stack: error && error.stack ? String(error.stack).slice(0, 1200) : '',
      };
      pushStep(name, 'FAILED: ' + message, false);
      await diagnostics();
      throw new Halt(name);
    }
  }

  /** Run a section; its aborts do not stop the remaining sections. */
  async function section(name, fn) {
    try {
      await fn();
      pushStep('section-' + name, 'ok');
    } catch (error) {
      if (error instanceof Halt) {
        pushStep('section-' + name, 'aborted after ' + error.step, false);
        return;
      }
      const message = errorText(error);
      results.failures.push({ step: 'section-' + name, message: message });
      pushStep('section-' + name, 'FAILED: ' + message, false);
      await diagnostics();
    }
  }

  function assert(condition, message) {
    if (!condition) throw new Error(message);
  }

  function assertEqual(actual, expected, message) {
    const actualText = JSON.stringify(actual);
    const expectedText = JSON.stringify(expected);
    if (actualText !== expectedText) throw new Error(message + ' (expected ' + expectedText + ', got ' + actualText + ')');
  }

  function describeCounts() {
    const counts = {};
    const selectors = [
      '.dsm-toggle', '.dsm-header-toggle', '[data-side-memo]', '.dsm-drawer', '.dsm-root', 'button',
      'textarea', '[contenteditable="true"]', 'img[data-image-id]', '.dsm-image-block',
      '.dsm-labels-editor', 'input.dsm-label-input', '.dsm-label-chip', '.dsm-label-remove',
      '.dsm-labels-bar', '.dsm-label-filter', 'button.dsm-group-toggle', '.dsm-group', '.dsm-row-labels',
      '[data-side-memo="editor"] .dsm-editor-head', 'button[data-side-memo-new="true"]',
      'button.dsm-new-memo', '.dsm-editor-title',
    ];
    for (const selector of selectors) {
      try { counts[selector] = doc().querySelectorAll(selector).length; } catch (error) { counts[selector] = 'err'; }
    }
    return counts;
  }

  async function diagnostics() {
    try {
      const docNode = frame.contentDocument;
      if (docNode === null) { results.evidence.frame = 'no contentDocument (cross-origin or not loaded)'; return; }
      results.evidence.frameUrl = docNode.URL;
      results.evidence.frameTitle = docNode.title;
      results.evidence.readyState = docNode.readyState;
      results.evidence.bodyLength = docNode.body ? docNode.body.innerHTML.length : -1;
      results.evidence.selectorCounts = describeCounts();
      const editor = docNode.querySelector('[data-side-memo="editor"]');
      if (editor !== null) results.evidence.editorHtml = editor.outerHTML.slice(0, 6000);
      const list = docNode.querySelector('[data-side-memo="list"]');
      if (list !== null) results.evidence.listHtml = list.outerHTML.slice(0, 8000);
      const drawer = docNode.querySelector('[data-side-memo="drawer"]');
      if (drawer !== null) results.evidence.drawerText = (drawer.textContent || '').slice(0, 1500);
      const bar = docNode.querySelector('.dsm-labels-bar');
      if (bar !== null) results.evidence.labelsBarHtml = bar.outerHTML.slice(0, 3000);
      const groups = Array.from(docNode.querySelectorAll('.dsm-group'));
      results.evidence.groupSummary = groups.map((g) => ({
        label: g.getAttribute('data-label'),
        untagged: g.getAttribute('data-untagged'),
        head: (g.querySelector('.dsm-group-head') || {}).textContent || '',
        rows: Array.from(g.querySelectorAll('.dsm-row-title-text')).map((n) => (n.textContent || '').trim()),
      }));
      results.evidence.notices = Array.from(docNode.querySelectorAll('.dsm-notice')).map((n) => (n.textContent || '').slice(0, 240));
      results.evidence.notesRaw = readNotesRaw().slice(0, 6000);
    } catch (error) {
      results.evidence.diagnosticsError = String(error);
    }
  }

  // -------------------------------------------------------------------------
  // DOM plumbing
  // -------------------------------------------------------------------------

  function doc() {
    const d = frame.contentDocument;
    if (d === null) throw new Error('iframe contentDocument unavailable');
    return d;
  }

  function q(selector) {
    try { return doc().querySelector(selector); } catch (error) { return null; }
  }

  function qa(selector) {
    try { return Array.from(doc().querySelectorAll(selector)); } catch (error) { return []; }
  }

  function qaWithin(root, selector) {
    if (root === null || root === undefined) return [];
    try { return Array.from(root.querySelectorAll(selector)); } catch (error) { return []; }
  }

  async function waitFor(selector, timeoutMs, label) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const node = q(selector);
      if (node !== null) return node;
      await sleep(100);
    }
    throw new Error('timed out after ' + timeoutMs + 'ms waiting for ' + (label || selector));
  }

  async function waitUntil(fn, timeoutMs, label) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      let value;
      try { value = fn(); } catch (error) { value = null; }
      if (value) return value;
      await sleep(100);
    }
    throw new Error('timed out after ' + timeoutMs + 'ms waiting for ' + label);
  }

  function click(node) {
    if (node === null || node === undefined) throw new Error('cannot click missing node');
    node.scrollIntoView && node.scrollIntoView({ block: 'nearest' });
    node.click();
  }

  function setNativeValue(element, value) {
    const win = doc().defaultView;
    const proto = element instanceof win.HTMLTextAreaElement ? win.HTMLTextAreaElement.prototype : win.HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
    if (descriptor !== undefined && descriptor.set !== undefined) descriptor.set.call(element, value);
    else element.value = value;
    const event = new win.Event('input', { bubbles: true });
    element.dispatchEvent(event);
  }

  function dispatchKey(node, key) {
    const win = doc().defaultView;
    const options = { key: key, bubbles: true, cancelable: true, composed: true, view: win };
    if (key === 'Enter') { options.code = 'Enter'; options.keyCode = 13; options.which = 13; }
    else if (key === ',') { options.code = 'Comma'; options.keyCode = 188; options.which = 188; }
    else if (key === 'Backspace') { options.code = 'Backspace'; options.keyCode = 8; options.which = 8; }
    const event = new win.KeyboardEvent('keydown', options);
    if (key === 'Enter' || key === ',') {
      try {
        Object.defineProperty(event, 'keyCode', { value: key === 'Enter' ? 13 : 188 });
        Object.defineProperty(event, 'which', { value: key === 'Enter' ? 13 : 188 });
      } catch (error) { /* ignore */ }
    }
    node.dispatchEvent(event);
    return { key: key, defaultPrevented: event.defaultPrevented === true };
  }

  function bodyEditor() {
    return q('[data-side-memo="editor"] [contenteditable="true"]')
      || q('[data-side-memo="editor"] textarea.dsm-editor-body')
      || q('[data-side-memo="editor"] .dsm-editor-body');
  }

  function typeIntoEditor(body, text) {
    const win = doc().defaultView;
    if (body.getAttribute('contenteditable') !== 'true') {
      throw new Error('editor not editable (contenteditable=' + body.getAttribute('contenteditable') + ')');
    }
    body.focus();
    // Normalize the editor to a single plain paragraph, the shape real typing
    // produces (<div>text</div>), instead of the initial placeholder <div><br></div>.
    const direct = String(location.search).indexOf('nodiv') !== -1;
    if (body.querySelector('.dsm-image-block') === null && (body.textContent || '').trim() === '') {
      body.innerHTML = direct ? '' : '<div></div>';
    }
    const range = win.document.createRange();
    let block = body.lastElementChild;
    while (block !== null && block.className && String(block.className).indexOf('dsm-image-block') !== -1) block = block.previousElementSibling;
    if (block === null) block = body;
    let textNode = null;
    for (let index = block.childNodes.length - 1; index >= 0; index -= 1) {
      const node = block.childNodes[index];
      if (node.nodeType === 3) { textNode = node; break; }
    }
    if (textNode === null) {
      textNode = win.document.createTextNode('');
      block.appendChild(textNode);
    }
    range.setStart(textNode, textNode.data.length);
    range.collapse(true);
    const selection = win.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    textNode.insertData(textNode.data.length, text);
    range.setStart(textNode, textNode.data.length);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    body.dispatchEvent(new win.InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
  }

  function findTextNode(root, needle) {
    const docNode = doc();
    const walker = docNode.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */);
    let node = walker.nextNode();
    while (node !== null) {
      if (node.data && node.data.indexOf(needle) !== -1) return node;
      node = walker.nextNode();
    }
    return null;
  }

  function setCaretAtOffset(root, textNode, offset) {
    const win = doc().defaultView;
    const range = win.document.createRange();
    range.setStart(textNode, offset);
    range.collapse(true);
    const selection = win.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    return { text: textNode.data, offset: offset, inRoot: root.contains(textNode) };
  }

  // -------------------------------------------------------------------------
  // console / storage / event taps (both suites)
  // -------------------------------------------------------------------------

  function installConsoleCapture() {
    const win = frame.contentWindow;
    if (win === null || win === undefined) return;
    if (win.__verifyErrorHooked !== true) {
      win.__verifyErrorHooked = true;
      win.addEventListener('error', (event) => {
        results.consoleNotes.push({ at: elapsed(), method: 'iframe.error', text: String(event.message || '') + ' @ ' + String(event.filename || '') });
      });
      win.addEventListener('unhandledrejection', (event) => {
        results.consoleNotes.push({ at: elapsed(), method: 'iframe.unhandledrejection', text: String(event.reason) });
      });
    }
    for (const method of ['log', 'info', 'warn', 'error']) {
      const original = win.console[method];
      if (typeof original !== 'function' || original.__verifyWrapped === true) continue;
      const wrapped = function () {
        try {
          const text = Array.from(arguments).map((value) => {
            if (typeof value === 'string') return value;
            try { return JSON.stringify(value); } catch (error) { return String(value); }
          }).join(' ').slice(0, 500);
          results.consoleNotes.push({ at: elapsed(), method: method, text: text });
          if (results.consoleNotes.length > 200) results.consoleNotes.shift();
        } catch (error) { /* ignore capture failures */ }
        return original.apply(win.console, arguments);
      };
      wrapped.__verifyWrapped = true;
      win.console[method] = wrapped;
    }
  }

  function installStorageTap() {
    const win = frame.contentWindow;
    if (win === null || win === undefined) return;
    try {
      if (win.__verifyStorageHooked === true) return;
      win.__verifyStorageHooked = true;
      win.__verifyWrites = [];
      const proto = win.Storage.prototype;
      const original = proto.setItem;
      proto.setItem = function (key, value) {
        try {
          win.__verifyWrites.push({ at: Date.now(), key: String(key), value: String(value).slice(0, 600) });
          if (win.__verifyWrites.length > 60) win.__verifyWrites.shift();
        } catch (error) { /* ignore */ }
        return original.call(this, key, value);
      };
    } catch (error) {
      results.consoleNotes.push({ at: elapsed(), method: 'storage-tap', text: String(error) });
    }
  }

  function readStorageWrites() {
    const win = frame.contentWindow;
    if (win === null || win === undefined || !Array.isArray(win.__verifyWrites)) return [];
    return win.__verifyWrites.slice(-30);
  }

  function readEventTap() {
    const win = frame.contentWindow;
    if (win === null || win === undefined || !Array.isArray(win.__verifyEvents)) return [];
    return win.__verifyEvents.slice(-40);
  }

  function installEventTap() {
    const win = frame.contentWindow;
    if (win === null || win === undefined) return;
    try {
      if (win.__verifyEventHooked === true) return;
      win.__verifyEventHooked = true;
      win.__verifyEvents = [];
      for (const type of ['input', 'beforeinput', 'paste', 'keydown', 'focusin', 'focusout']) {
        win.document.addEventListener(type, (event) => {
          try {
            const target = event.target;
            win.__verifyEvents.push({
              at: Date.now(),
              type: type,
              trusted: event.isTrusted === true,
              defaultPrevented: event.defaultPrevented === true,
              target: target === null || target === undefined ? 'null' : ((target.tagName || '') + '.' + String(target.className || '')).slice(0, 80),
              inputType: event.inputType || '',
            });
            if (win.__verifyEvents.length > 120) win.__verifyEvents.shift();
          } catch (error) { /* ignore */ }
        }, true);
      }
    } catch (error) {
      results.consoleNotes.push({ at: elapsed(), method: 'event-tap', text: String(error) });
    }
  }

  // -------------------------------------------------------------------------
  // storage helpers (notes payload lives in the iframe origin == harness origin)
  // -------------------------------------------------------------------------

  async function resetStorage() {
    const win = window;
    const out = { clearedLocalStorageKeys: 0, deletedDatabases: [] };
    try {
      out.clearedLocalStorageKeys = win.localStorage.length;
      win.localStorage.clear();
    } catch (error) {
      out.localStorageError = String(error);
    }
    try {
      const idb = win.indexedDB;
      if (idb !== undefined && typeof idb.databases === 'function') {
        const databases = await Promise.race([idb.databases(), sleep(1500).then(() => [])]);
        for (const entry of databases || []) {
          if (entry === null || entry === undefined || typeof entry.name !== 'string') continue;
          await new Promise((resolve) => {
            const request = idb.deleteDatabase(entry.name);
            request.onsuccess = () => resolve();
            request.onerror = () => resolve();
            request.onblocked = () => resolve();
            setTimeout(resolve, 1500);
          });
          out.deletedDatabases.push(entry.name);
        }
      }
    } catch (error) {
      out.indexedDbError = String(error);
    }
    return out;
  }

  function readNotesRaw() {
    try { return doc().defaultView.localStorage.getItem(NOTES_KEY) || ''; } catch (error) { return ''; }
  }

  function readNotes() {
    const raw = readNotesRaw();
    if (raw === '') return { raw: '', parsed: null, notes: [] };
    try {
      const parsed = JSON.parse(raw);
      return { raw: raw, parsed: parsed, notes: parsed !== null && Array.isArray(parsed.notes) ? parsed.notes : [] };
    } catch (error) {
      return { raw: raw, parsed: null, notes: [], parseError: String(error) };
    }
  }

  function readLocalStorage() {
    try {
      const win = doc().defaultView;
      const keys = [];
      for (let index = 0; index < win.localStorage.length; index += 1) keys.push(win.localStorage.key(index));
      const out = { keys: keys };
      for (const key of keys) {
        const value = win.localStorage.getItem(key) || '';
        out[key] = value.length > 800 ? value.slice(0, 800) + '…' : value;
      }
      return out;
    } catch (error) {
      return { error: String(error) };
    }
  }

  function notesWithTitle(title) {
    return readNotes().notes.filter((note) => note !== null && typeof note === 'object' && note.title === title);
  }

  function labelsOf(note) {
    return note !== null && note !== undefined && Array.isArray(note.labels) ? note.labels.slice() : null;
  }

  async function waitForNotes(predicate, timeoutMs, label) {
    return waitUntil(() => {
      const state = readNotes();
      return predicate(state) ? state : null;
    }, timeoutMs, label);
  }

  // -------------------------------------------------------------------------
  // iframe boot / reload
  // -------------------------------------------------------------------------

  async function iframeLoad(timeoutMs) {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('iframe load timed out after ' + timeoutMs + 'ms')), timeoutMs);
      const onLoad = () => { clearTimeout(timer); resolve(); };
      if (frame.contentDocument !== null && frame.contentDocument.readyState === 'complete' && frame.contentWindow.location.href !== 'about:blank') {
        clearTimeout(timer); resolve(); return;
      }
      frame.addEventListener('load', onLoad, { once: true });
    });
  }

  async function boot() {
    if (params.get('noreset') !== '1') {
      const reset = await resetStorage();
      pushStep('storage-reset', JSON.stringify(reset));
      results.evidence.storageReset = reset;
    }
    frame.src = '/?token=' + encodeURIComponent(token);
    await iframeLoad(30000);
    const loadDoc = frame.contentDocument;
    pushStep('iframe-load', loadDoc === null ? 'no-doc' : String(loadDoc.URL).slice(0, 160));
    installConsoleCapture();
    installStorageTap();
    installEventTap();
    const toggle = await waitUntil(() => q('[data-side-memo-toggle]') || q('.dsm-toggle'), 30000, 'Side Memo toggle');
    if (frame.contentDocument !== loadDoc) {
      results.evidence.reloadedDuringBoot = true;
      pushStep('reload-during-boot', 'contentDocument replaced after boot');
    }
    pushStep('toggle-found', (toggle.className || '') + ' title=' + (toggle.getAttribute('title') || ''));
    results.evidence.toggleOuter = toggle.outerHTML.slice(0, 400);
    return toggle;
  }

  async function ensureDrawer() {
    const toggle = await waitUntil(() => q('[data-side-memo-toggle]') || q('.dsm-toggle'), 30000, 'Side Memo toggle');
    const existing = q('[data-side-memo="drawer"]');
    if (existing !== null) return existing;
    click(toggle);
    return waitFor('[data-side-memo="drawer"]', 8000, 'drawer');
  }

  async function reloadFrame() {
    pushStep('reload-start', '');
    const oldDoc = frame.contentDocument;
    await new Promise((resolve) => {
      frame.addEventListener('load', () => resolve(), { once: true });
      frame.contentWindow.location.reload();
    });
    await waitUntil(() => {
      const docNode = frame.contentDocument;
      return docNode !== null && docNode !== oldDoc && docNode.readyState !== 'loading';
    }, 30000, 'reloaded iframe document');
    installConsoleCapture();
    installStorageTap();
    installEventTap();
    await waitUntil(() => q('[data-side-memo-toggle]') || q('.dsm-toggle'), 30000, 'toggle after reload');
  }

  // -------------------------------------------------------------------------
  // list / editor helpers
  // -------------------------------------------------------------------------

  function listRoot() { return q('[data-side-memo="list"]'); }
  function editorRoot() { return q('[data-side-memo="editor"]'); }
  function rowNodes() { return qa('[data-side-memo="list"] .dsm-row'); }
  function rowTitleNodes() { return qa('[data-side-memo="list"] .dsm-row-title-text'); }
  function rowTitles() { return rowTitleNodes().map((node) => (node.textContent || '').trim()); }
  function visibleRowCount() { return rowTitles().length; }
  function rowForTitle(title) {
    const rows = rowNodes();
    for (const row of rows) {
      const titleNode = row.querySelector('.dsm-row-title-text');
      if (titleNode !== null && (titleNode.textContent || '').trim() === title) return row;
    }
    return null;
  }
  function rowLabelChips(title) {
    const row = rowForTitle(title);
    if (row === null) return null;
    return qaWithin(row, '.dsm-row-labels .dsm-label-chip[data-label]').map((node) => node.getAttribute('data-label'));
  }

  function notices() {
    const seen = [];
    for (const node of qa('.dsm-notice, .dsm-label-notice')) {
      const text = (node.textContent || '').trim();
      if (text !== '' && seen.indexOf(text) === -1) seen.push(text);
    }
    return seen;
  }
  function liveRegionText() {
    return qa('[role="status"]').map((node) => (node.textContent || '').trim()).filter((text) => text !== '');
  }
  function announcementText() {
    return notices().concat(liveRegionText()).join(' | ');
  }
  function footText() {
    const foot = q('[data-side-memo="list"] .dsm-foot');
    return foot === null ? '' : (foot.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function searchInput() {
    return q('[data-side-memo="list"] .dsm-search input');
  }

  async function setSearch(text) {
    const input = searchInput();
    if (input === null) throw new Error('search input (.dsm-search input) not found');
    setNativeValue(input, text);
    await sleep(300);
  }

  async function clearSearch() {
    const clear = q('[data-side-memo="list"] .dsm-search-clear');
    if (clear !== null) {
      click(clear);
      await sleep(300);
      return 'clicked .dsm-search-clear';
    }
    await setSearch('');
    return 'set search value to ""';
  }

  async function waitForRowCount(count, timeoutMs, label) {
    await waitUntil(() => visibleRowCount() === count, timeoutMs || 6000, label || (count + ' visible rows'));
    return rowTitles();
  }

  async function backToList() {
    const editor = editorRoot();
    if (editor === null) {
      await waitFor('[data-side-memo="list"]', 4000, 'list');
      return;
    }
    const back = editor.querySelector('.dsm-editor-head button.dsm-icon-btn');
    if (back === null) throw new Error('editor back button (.dsm-editor-head button.dsm-icon-btn) not found');
    click(back);
    await waitFor('[data-side-memo="list"]', 6000, 'list after back');
    await sleep(200);
  }

  // Recovery helper so one failed section does not cascade into later,
  // independent sections: bring the plugin back to the list view.
  async function ensureList() {
    if (editorRoot() !== null) {
      await backToList();
    }
    await waitFor('[data-side-memo="list"]', 4000, 'list (ensureList)');
    await sleep(120);
  }

  async function openNewMemo() {
    const drawer = q('[data-side-memo="drawer"]');
    if (drawer === null) throw new Error('drawer not open');
    const candidates = qaWithin(drawer, '.dsm-toolbar-actions button.dsm-btn')
      .concat(qaWithin(drawer, '.dsm-toolbar button.dsm-btn'));
    const newButton = candidates.length > 0 ? candidates[0] : null;
    if (newButton === null) throw new Error('new-note button (.dsm-toolbar button.dsm-btn) not found');
    click(newButton);
    await waitFor('[data-side-memo="editor"]', 8000, 'editor');
    const start = Date.now();
    await waitUntil(() => {
      const el = q('[data-side-memo="editor"] .dsm-editor-body');
      return el !== null && el.getAttribute('contenteditable') === 'true';
    }, 15000, 'editor contenteditable (imagesReady)');
    results.evidence.imagesReadyWaitMs = Date.now() - start;
    await sleep(250);
    return q('[data-side-memo="editor"]');
  }

  async function setTitle(text) {
    const input = q('.dsm-editor-title');
    if (input === null) throw new Error('.dsm-editor-title not found');
    setNativeValue(input, text);
    await sleep(250);
    return input.value;
  }

  async function setBodyText(text) {
    const body = bodyEditor();
    if (body === null) throw new Error('editor body not found');
    typeIntoEditor(body, text);
    await sleep(400);
    return (body.textContent || '').slice(0, 200);
  }

  // -------------------------------------------------------------------------
  // newmemo suite helpers: editor top-bar "New memo" button
  // -------------------------------------------------------------------------

  // Stable DOM contract agreed for the editor New button. The host locale
  // picks the label, so accept the exact English pair (primary contract) and
  // the shipped Chinese pair; anything else is a real mismatch.
  const NEW_BUTTON_CONTRACT = {
    selector: '[data-side-memo="editor"] button[data-side-memo-new="true"]',
    classes: ['dsm-btn', 'dsm-new-memo'],
    locales: [
      { locale: 'en', text: 'New', label: 'New memo' },
      { locale: 'zh', text: '新建', label: '新建便签' },
    ],
  };

  function describeNewButton(button) {
    const classes = String(button.className || '').split(/\s+/);
    const facts = {
      className: String(button.className || ''),
      hasSvg: button.querySelector('svg') !== null,
      text: (button.textContent || '').trim(),
      title: button.getAttribute('title'),
      ariaLabel: button.getAttribute('aria-label'),
      disabled: button.disabled === true,
      type: button.getAttribute('type'),
      outerHtml: String(button.outerHTML || '').slice(0, 500),
    };
    facts.missingClasses = NEW_BUTTON_CONTRACT.classes.filter(function (name) {
      return classes.indexOf(name) === -1;
    });
    const expected = NEW_BUTTON_CONTRACT.locales.filter(function (candidate) {
      return facts.text.indexOf(candidate.text) !== -1
        && (facts.title === candidate.label || facts.ariaLabel === candidate.label);
    });
    facts.locale = expected.length > 0 ? expected[0].locale : null;
    facts.expected = NEW_BUTTON_CONTRACT.locales;
    return facts;
  }

  function editorHead() {
    return q('[data-side-memo="editor"] .dsm-editor-head');
  }

  /**
   * Locate the editor New button. The strict contract selector wins; if the
   * shipped DOM drifts, fall back (recording the mismatch as evidence) instead
   * of turning a selector rename into a spurious product failure.
   */
  function findNewButton() {
    const strict = q(NEW_BUTTON_CONTRACT.selector);
    if (strict !== null) return { node: strict, selector: NEW_BUTTON_CONTRACT.selector, adapted: false };
    const byClass = q('[data-side-memo="editor"] .dsm-editor-head button.dsm-new-memo');
    if (byClass !== null) return { node: byClass, selector: 'button.dsm-new-memo (fallback)', adapted: true };
    const head = editorHead();
    if (head !== null) {
      for (const button of qaWithin(head, 'button')) {
        const aria = button.getAttribute('aria-label') || '';
        const title = button.getAttribute('title') || '';
        const text = (button.textContent || '').trim();
        for (const candidate of NEW_BUTTON_CONTRACT.locales) {
          if (aria === candidate.label || title === candidate.label || text === candidate.label) {
            return { node: button, selector: 'editor-head button by accessible name "' + candidate.label + '" (fallback)', adapted: true };
          }
        }
      }
    }
    return null;
  }

  function requireNewButton() {
    const found = findNewButton();
    if (found !== null) return found;
    const head = editorHead();
    throw new Error('editor New button not found: contract selector ' + NEW_BUTTON_CONTRACT.selector
      + ' missing; editor-head buttons='
      + JSON.stringify(head === null ? null : qaWithin(head, 'button').map(function (button) {
        return {
          text: (button.textContent || '').trim(),
          title: button.getAttribute('title'),
          ariaLabel: button.getAttribute('aria-label'),
          className: String(button.className || ''),
        };
      })));
  }

  function describeActiveElement() {
    const active = doc().activeElement;
    if (active === null || active === undefined) return { tag: 'none', isTitleInput: false };
    return {
      tag: String(active.tagName || '').toUpperCase(),
      className: String(active.className || ''),
      placeholder: typeof active.getAttribute === 'function' ? String(active.getAttribute('placeholder') || '') : '',
      isTitleInput: active === editorTitleInput(),
    };
  }

  function editorTitleInput() {
    return q('[data-side-memo="editor"] .dsm-editor-title');
  }

  function editorTitleValue() {
    const input = editorTitleInput();
    return input === null ? null : String(input.value);
  }

  function editorBodyText() {
    const body = bodyEditor();
    return body === null ? null : String(body.textContent || '');
  }

  function noteIds() {
    return readNotes().notes.map(function (note) { return note.id; });
  }

  function noteById(id) {
    const notes = readNotes().notes;
    for (const note of notes) if (note.id === id) return note;
    return null;
  }

  function noteState(note) {
    if (note === null || note === undefined) return null;
    return { id: note.id, title: note.title, body: note.body };
  }

  async function clickEditorNewButton() {
    const found = requireNewButton();
    click(found.node);
    return found;
  }

  /** Wait until the open editor shows a blank memo (empty title value + body). */
  async function waitForBlankEditor(timeoutMs) {
    await waitUntil(function () {
      const input = editorTitleInput();
      if (input === null || input.value !== '') return null;
      const body = bodyEditor();
      if (body === null) return null;
      if (String(body.textContent || '').trim() !== '') return null;
      return true;
    }, timeoutMs || 8000, 'blank draft editor (empty title and body)');
    return { titleValue: editorTitleValue(), bodyText: editorBodyText() };
  }

  /** Wait until the title input is the iframe document's active element. */
  async function waitForTitleFocus(timeoutMs) {
    return waitUntil(function () {
      const active = doc().activeElement;
      const input = editorTitleInput();
      return input !== null && active === input ? { focused: true } : null;
    }, timeoutMs || 5000, 'title input focused after New');
  }

  /**
   * Focus diagnostics. Distinguishes a product defect (the shipped redirect
   * did not leave focus in the title although focus works in this frame) from
   * a harness/environment artifact (programmatic focus is a no-op here).
   * Side effect: performs ONE direct input.focus() attempt as a capability
   * check. Never call it before the focus assertion has already been taken,
   * because it can change the active element.
   */
  function focusProbeReport(context) {
    const d = doc();
    const title = editorTitleInput();
    let frameHasFocus = null;
    try {
      frameHasFocus = frame !== null && frame.contentWindow !== null && typeof frame.contentWindow.hasFocus === 'function'
        ? frame.contentWindow.hasFocus()
        : null;
    } catch (error) {
      frameHasFocus = 'unavailable: ' + String(error && error.message ? error.message : error);
    }
    const report = {
      context: context,
      activeElement: describeActiveElement(),
      rootInert: (function () {
        const root = d.getElementById('root');
        return root === null ? null : root.hasAttribute('inert');
      })(),
      docHasFocus: typeof d.hasFocus === 'function' ? d.hasFocus() : null,
      frameHasFocus: frameHasFocus,
      parentHasFocus: typeof window.hasFocus === 'function' ? window.hasFocus() : null,
      titlePresent: title !== null,
      titleConnected: title !== null ? title.isConnected !== false : null,
      titleDisabled: title !== null ? title.disabled : null,
      titleReadOnly: title !== null ? title.readOnly : null,
      titleTabIndex: title !== null ? title.tabIndex : null,
      titleRect: null,
      forcedFocus: { attempted: false, error: null, changedActiveElement: null, after: null },
      environment: {},
    };
    if (title !== null) {
      try {
        const rect = title.getBoundingClientRect();
        report.titleRect = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      } catch (error) {
        report.titleRect = 'unavailable: ' + String(error && error.message ? error.message : error);
      }
      report.titleOwnerDocumentMatches = title.ownerDocument === d;
      report.titleRootNodeIsDocument = title.getRootNode() === d;
      report.titleAncestors = [];
      try {
        let node = title.parentElement;
        let depth = 0;
        while (node !== null && depth < 12) {
          report.titleAncestors.push({
            tag: String(node.tagName || '').toUpperCase(),
            className: String(node.className || '').slice(0, 80),
            id: String(node.id || ''),
            inert: node.hasAttribute('inert'),
            ariaHidden: node.getAttribute('aria-hidden'),
            display: d.defaultView.getComputedStyle(node).display,
            visibility: d.defaultView.getComputedStyle(node).visibility,
            pointerEvents: d.defaultView.getComputedStyle(node).pointerEvents,
          });
          node = node.parentElement;
          depth += 1;
        }
      } catch (error) {
        report.titleAncestors = 'unavailable: ' + String(error && error.message ? error.message : error);
      }
      const before = d.activeElement;
      report.forcedFocus.attempted = true;
      try {
        title.focus();
      } catch (error) {
        report.forcedFocus.error = String(error && error.message ? error.message : error);
      }
      report.forcedFocus.changedActiveElement = d.activeElement !== before;
      report.forcedFocus.after = describeActiveElement();
    }
    // Which app-owned elements in the editor can take focus at all? A container
    // with `inert` (or another focus-blocking ancestor) makes every descendant
    // unfocusable while the rest of the document still focuses normally.
    report.appFocusTargets = {};
    for (const entry of [
      { name: 'title', selector: '[data-side-memo="editor"] .dsm-editor-title' },
      { name: 'body', selector: '[data-side-memo="editor"] .dsm-editor-body' },
      { name: 'labelInput', selector: '[data-side-memo="editor"] input.dsm-label-input' },
      { name: 'newButton', selector: '[data-side-memo="editor"] button[data-side-memo-new="true"]' },
      { name: 'toggle', selector: '[data-side-memo-toggle]' },
    ]) {
      const node = q(entry.selector);
      if (node === null) {
        report.appFocusTargets[entry.name] = 'absent';
        continue;
      }
      const before = d.activeElement;
      try {
        node.focus();
      } catch (error) {
        report.appFocusTargets[entry.name] = { focused: false, error: String(error && error.message ? error.message : error) };
        continue;
      }
      report.appFocusTargets[entry.name] = { focused: d.activeElement === node, changed: d.activeElement !== before };
    }
    // Isolate the environment question: can ANY programmatic focus in this
    // frame take effect at all? A throwaway input appended to the document.
    try {
      const probe = d.createElement('input');
      probe.type = 'text';
      probe.setAttribute('data-verify-focus-probe', 'true');
      probe.style.position = 'fixed';
      probe.style.left = '-100px';
      probe.style.top = '-100px';
      d.body.appendChild(probe);
      probe.focus();
      report.environment.focusWorks = d.activeElement === probe;
      report.environment.activeElementAfterProbe = describeActiveElement();
      if (probe.parentNode !== null) probe.parentNode.removeChild(probe);
    } catch (error) {
      report.environment.error = String(error && error.message ? error.message : error);
    }
    return report;
  }

  /**
   * Snapshot of the HOST page state that can block focus inside the app shell.
   * The DSH web shell renders the plugin UI under `div#root`; if the shell
   * marks that root `inert` (e.g. while a first-run/overlay dialog is open in
   * a fresh DSH_HOME), every app element becomes unfocusable even though the
   * document itself can focus nodes appended to <body>.
   */
  function hostPageStateReport(context) {
    const d = doc();
    const root = d.getElementById('root');
    const summarize = function (element) {
      return {
        tag: String(element.tagName || '').toUpperCase(),
        id: String(element.id || ''),
        className: String(element.className || '').slice(0, 120),
        inert: element.hasAttribute('inert'),
        role: element.getAttribute('role'),
        ariaModal: element.getAttribute('aria-modal'),
        open: element.hasAttribute('open'),
        outerHtml: String(element.outerHTML || '').slice(0, 300),
      };
    };
    const dialogs = qa('[role="dialog"], [aria-modal="true"], dialog[open]').map(summarize);
    const overlayHosts = qa('[class*="overlayLayer"], [class*="overlay"], .dsm-drawer-layer').slice(0, 12).map(summarize);
    const bodyChildren = Array.from(d.body.children).map(summarize);
    return {
      context: context,
      url: String(d.location.href),
      rootInert: root === null ? null : root.hasAttribute('inert'),
      root: root === null ? null : summarize(root),
      dialogs: dialogs,
      overlayHosts: overlayHosts,
      bodyChildren: bodyChildren,
      activeElement: describeActiveElement(),
    };
  }

  /**
   * Record every attempt to set/remove the `inert` attribute inside the app
   * frame, with the JS stack of the caller. Used to explain why `div#root`
   * becomes inert when the plugin drawer opens (host-shell state, not the New
   * button): the stack names the bundle/function responsible.
   */
  function installInertTrace() {
    const d = doc();
    const win = d.defaultView;
    if (win === null || win === undefined) return false;
    if (win.__dsmInertTraceInstalled === true) return true;
    win.__dsmInertTraceInstalled = true;
    const trace = [];
    win.__dsmInertTrace = trace;
    const label = function (element) {
      if (element === null || element === undefined) return '<none>';
      return String(element.tagName || '') + (element.id ? '#' + element.id : '') + (element.className ? '.' + String(element.className).split(/\s+/).join('.') : '');
    };
    const stackOf = function () {
      const err = new Error('inert-trace');
      return String(err.stack || '').split('\n').slice(1, 8).join('\n');
    };
    const record = function (via, element, value) {
      trace.push({ via: via, target: label(element), value: value, stack: stackOf(), at: Date.now() });
      if (trace.length > 40) trace.shift();
    };
    const proto = win.Element.prototype;
    const originalSetAttribute = proto.setAttribute;
    proto.setAttribute = function (name, value) {
      if (String(name).toLowerCase() === 'inert') record('setAttribute', this, String(value));
      return originalSetAttribute.call(this, name, value);
    };
    const originalRemoveAttribute = proto.removeAttribute;
    proto.removeAttribute = function (name) {
      if (String(name).toLowerCase() === 'inert') record('removeAttribute', this, null);
      return originalRemoveAttribute.call(this, name);
    };
    const root = d.getElementById('root');
    if (root !== null) {
      try {
        let current = root.hasAttribute('inert');
        Object.defineProperty(root, 'inert', {
          configurable: true,
          enumerable: true,
          get: function () { return current; },
          set: function (value) {
            record('inert-property', root, Boolean(value));
            current = Boolean(value);
            if (current) originalSetAttribute.call(root, 'inert', '');
            else originalRemoveAttribute.call(root, 'inert');
          },
        });
      } catch (error) {
        trace.push({ via: 'install-error', target: '#root', value: String(error) });
      }
    }
    return true;
  }

  function readInertTrace() {
    const win = doc().defaultView;
    if (win === null || win === undefined || !Array.isArray(win.__dsmInertTrace)) return [];
    return win.__dsmInertTrace.slice();
  }

  /**
   * The isolated (fresh DSH_HOME) web shell shows a modal "Preview Notice"
   * dialog on first load. While that modal is open the shell marks `div#root`
   * inert, so nothing inside the app can take focus (the app's own title-focus
   * effect is fine, it just cannot apply). Close the dialog through its own
   * button so the app reaches the same interactive state as a normal session.
   */
  async function dismissHostDialogs() {
    const log = [];
    for (let round = 0; round < 3; round += 1) {
      const dialogs = qa('[role="dialog"][aria-modal="true"]');
      if (dialogs.length === 0) break;
      const dialog = dialogs[0];
      const label = String(dialog.getAttribute('aria-label') || '');
      const buttons = Array.from(dialog.querySelectorAll('button')).map(function (button) {
        return {
          text: String(button.textContent || '').replace(/\s+/g, ' ').trim(),
          ariaLabel: String(button.getAttribute('aria-label') || ''),
          className: String(button.className || ''),
          disabled: button.disabled === true,
          button: button,
        };
      });
      log.push({
        round: round,
        dialogLabel: label,
        dialogText: String(dialog.textContent || '').replace(/\s+/g, ' ').slice(0, 160),
        buttons: buttons.map(function (entry) { return entry.text; }),
      });
      let target = null;
      let action = null;
      if (/preview notice/i.test(label)) {
        // The only host dialog that marks `#root` inert: close it through its
        // own Continue button, exactly like a first-run user would.
        target = buttons.filter(function (entry) { return entry.disabled === false && /continue/i.test(entry.text); })[0] || null;
        action = 'continue';
      }
      if (target === null || target === undefined) {
        // Any other host dialog (e.g. the sign-in prompt) does not set inert;
        // close it only through an explicit close control, never by starting a
        // sign-in flow.
        target = buttons.filter(function (entry) {
          return entry.disabled === false && (/^close$/i.test(entry.ariaLabel) || /close/i.test(entry.className) || entry.text === '');
        })[0] || null;
        action = 'close-control';
        if (target === null || target === undefined) {
          log[log.length - 1].action = 'left-open:no-close-control';
          break;
        }
      }
      log[log.length - 1].action = action;
      log[log.length - 1].clicked = target.text === '' ? '(icon:' + target.className + ')' : target.text;
      target.button.click();
      await sleep(350);
    }
    const remaining = qa('[role="dialog"][aria-modal="true"]');
    const root = doc().getElementById('root');
    log.push({
      round: 'final',
      remainingDialogs: remaining.length,
      remainingLabels: remaining.map(function (dialog) { return String(dialog.getAttribute('aria-label') || ''); }),
      rootInert: root === null ? null : root.hasAttribute('inert'),
    });
    return log;
  }

  function findEditorChip(label) {
    const chips = qa('[data-side-memo="editor"] .dsm-label-chip[data-label]');
    for (const chip of chips) if (chip.getAttribute('data-label') === label) return chip;
    return null;
  }
  function editorChips() {
    return qa('[data-side-memo="editor"] .dsm-label-chip[data-label]').map((chip) => chip.getAttribute('data-label'));
  }
  function findEditorRemove(label) {
    // The remove button carries data-label-remove="<label>" (not data-label);
    // the chip itself carries data-label.
    const buttons = qa('[data-side-memo="editor"] .dsm-label-remove[data-label-remove]');
    for (const button of buttons) if (button.getAttribute('data-label-remove') === label) return button;
    return null;
  }
  function labelInput() {
    return q('[data-side-memo="editor"] input.dsm-label-input');
  }
  function labelsEditor() {
    return q('[data-side-memo="editor"] .dsm-labels-editor');
  }

  function normalizeExpectedLabel(value) {
    let text = String(value === undefined || value === null ? '' : value).trim();
    text = text.replace(/^[#＃]/, '').trim();
    text = text.replace(/[,，;；]/g, ' ').replace(/\s+/g, ' ').trim();
    return text.slice(0, 24);
  }

  /**
   * Type a label draft and commit it the way a user does.
   * method: 'enter' | 'comma' | 'blur'.
   */
  async function addLabel(text, method) {
    const input = labelInput();
    if (input === null) throw new Error('editor label input (input.dsm-label-input) not found');
    const expected = normalizeExpectedLabel(text);
    assert(expected !== '', 'normalized label is empty for ' + JSON.stringify(text));
    input.focus();
    if (method === 'enter') {
      setNativeValue(input, text);
      dispatchKey(input, 'Enter');
    } else if (method === 'comma') {
      setNativeValue(input, text + ',');
      dispatchKey(input, ',');
    } else if (method === 'blur') {
      setNativeValue(input, text);
      // Give React a beat to commit the controlled value before blur fires the
      // onBlur handler that reads labelDraft from the latest render.
      await sleep(80);
      input.focus();
      input.blur();
      try {
        input.dispatchEvent(new (doc().defaultView).FocusEvent('focusout', { bubbles: true }));
      } catch (error) { /* ignore */ }
    } else {
      throw new Error('unknown label commit method: ' + method);
    }
    await waitUntil(() => findEditorChip(expected) !== null, 5000, 'editor chip "' + expected + '" after ' + method + ' commit');
    results.evidence['labelCommit-' + method] = {
      typed: text,
      expected: expected,
      method: method,
      chips: editorChips(),
      inputValue: input.value,
    };
    return { expected: expected, method: method, chips: editorChips(), inputValue: input.value };
  }

  async function attemptAddLabelExpectNoChange(typed) {
    const input = labelInput();
    if (input === null) throw new Error('editor label input (input.dsm-label-input) not found');
    const before = editorChips();
    input.focus();
    setNativeValue(input, typed);
    dispatchKey(input, 'Enter');
    await sleep(500);
    return {
      before: before,
      after: editorChips(),
      inputValue: input.value,
      notices: notices(),
      announcement: announcementText(),
    };
  }

  async function removeLabel(label) {
    const remove = findEditorRemove(label);
    if (remove === null) throw new Error('.dsm-label-remove[data-label-remove="' + label + '"] not found');
    click(remove);
    await waitUntil(() => findEditorChip(label) === null, 5000, 'editor chip "' + label + '" removed');
    return { chips: editorChips(), notices: notices() };
  }

  function labelBar() {
    return q('[data-side-memo="list"] .dsm-labels-bar');
  }
  function filterChips() {
    return qa('[data-side-memo="list"] .dsm-labels-bar .dsm-label-filter[data-label]');
  }
  function filterChip(label) {
    for (const chip of filterChips()) if (chip.getAttribute('data-label') === label) return chip;
    return null;
  }
  function filterBarLabels() {
    return filterChips().map((chip) => chip.getAttribute('data-label'));
  }
  function isChipPressed(chip) {
    if (chip === null) return false;
    const pressed = chip.getAttribute('aria-pressed');
    const active = chip.getAttribute('data-active');
    return pressed === 'true' && (active === 'true' || active === '');
  }
  function findClearFilterChip() {
    const bar = labelBar();
    if (bar === null) return null;
    const candidates = Array.from(bar.querySelectorAll('button, [role="button"], .dsm-label-filter-clear'));
    for (const node of candidates) {
      if (node.classList && node.classList.contains('dsm-label-filter-clear')) return node;
      if (node.hasAttribute('data-all')) return node;
      if (node.getAttribute('data-label') === '') return node;
      const text = (node.textContent || '').replace(/\s+/g, ' ').trim();
      if (text === 'All labels' || text === 'All' || text === '全部标签') return node;
    }
    // Last resort: any non-filter element inside the bar whose text is "All labels".
    for (const node of Array.from(bar.querySelectorAll('*'))) {
      if (node.closest && node.closest('.dsm-label-filter') !== null) continue;
      const text = (node.textContent || '').replace(/\s+/g, ' ').trim();
      if (text === 'All labels') return node;
    }
    return null;
  }

  async function clickFilterChip(label) {
    const chip = await waitUntil(() => filterChip(label), 4000, 'label filter chip "' + label + '"');
    click(chip);
    await sleep(350);
    return filterChip(label);
  }

  function groupToggle() {
    return q('[data-side-memo="list"] button.dsm-group-toggle');
  }
  function groupNodes() {
    return qa('[data-side-memo="list"] .dsm-group');
  }
  function groupForLabel(label) {
    for (const group of groupNodes()) if (group.getAttribute('data-label') === label) return group;
    return null;
  }
  function groupRows(group) {
    return qaWithin(group, '.dsm-row-title-text').map((node) => (node.textContent || '').trim());
  }

  // -------------------------------------------------------------------------
  // xlsx plumbing: createObjectURL interception + minimal zip/sheet reader
  // -------------------------------------------------------------------------

  function collectTextRuns(xml) {
    let text = '';
    const pattern = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
    let match;
    while ((match = pattern.exec(xml)) !== null) text += decodeXmlEntities(match[1]);
    return text;
  }

  function decodeXmlEntities(value) {
    return String(value)
      .replace(/&#x([0-9a-fA-F]+);/g, (match, hex) => {
        try { return String.fromCodePoint(parseInt(hex, 16)); } catch (error) { return ''; }
      })
      .replace(/&#(\d+);/g, (match, decimal) => {
        try { return String.fromCodePoint(parseInt(decimal, 10)); } catch (error) { return ''; }
      })
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  }

  function stripXmlPrefixes(xml) {
    return String(xml).replace(/<(\/?)[A-Za-z_][\w.-]*:/g, '<$1');
  }

  function columnIndex(letters) {
    let number = 0;
    for (const character of letters) number = number * 26 + (character.charCodeAt(0) - 64);
    return number - 1;
  }

  function parseSheetTable(xml, sharedStrings) {
    const rows = [];
    const rowPattern = /<row\b[^>]*>([\s\S]*?)<\/row>/g;
    let rowMatch;
    while ((rowMatch = rowPattern.exec(xml)) !== null) {
      const cells = [];
      const cellPattern = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
      let cellMatch;
      while ((cellMatch = cellPattern.exec(rowMatch[1])) !== null) {
        const attributes = cellMatch[1] || '';
        const inner = cellMatch[2] === undefined ? '' : cellMatch[2];
        const refMatch = /\br="([A-Z]+)\d+"/.exec(attributes);
        const column = refMatch ? columnIndex(refMatch[1]) : cells.length;
        const typeMatch = /\bt="([^"]+)"/.exec(attributes);
        const type = typeMatch ? typeMatch[1] : '';
        let value = '';
        if (type === 's') {
          const sharedMatch = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(inner);
          const sharedIndex = sharedMatch ? parseInt(decodeXmlEntities(sharedMatch[1]), 10) : NaN;
          value = Number.isFinite(sharedIndex) && sharedStrings[sharedIndex] !== undefined ? sharedStrings[sharedIndex] : '';
        } else if (type === 'inlineStr') {
          value = collectTextRuns(inner);
        } else if (type === 'b') {
          const booleanMatch = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(inner);
          value = booleanMatch !== null && decodeXmlEntities(booleanMatch[1]) === '1' ? 'TRUE' : 'FALSE';
        } else {
          const valueMatch = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(inner);
          value = valueMatch !== null ? decodeXmlEntities(valueMatch[1]) : collectTextRuns(inner);
        }
        cells[column] = value;
      }
      const dense = [];
      for (let index = 0; index < cells.length; index += 1) dense.push(cells[index] === undefined ? '' : cells[index]);
      rows.push(dense);
    }
    return rows;
  }

  async function inflateRawBytes(raw) {
    const Decompression = window.DecompressionStream || (frame.contentWindow && frame.contentWindow.DecompressionStream);
    if (typeof Decompression !== 'function') throw new Error('DecompressionStream unavailable; cannot read deflated zip entries');
    const stream = new Blob([raw]).stream().pipeThrough(new Decompression('deflate-raw'));
    const buffer = await new Response(stream).arrayBuffer();
    return new Uint8Array(buffer);
  }

  async function readZipEntries(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let eocd = -1;
    for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 66000); at -= 1) {
      if (view.getUint32(at, true) === 0x06054b50) { eocd = at; break; }
    }
    if (eocd < 0) throw new Error('zip end-of-central-directory not found (not an .xlsx?)');
    const count = view.getUint16(eocd + 10, true);
    const centralSize = view.getUint32(eocd + 12, true);
    const centralOffset = view.getUint32(eocd + 16, true);
    if (centralOffset + centralSize > bytes.length) throw new Error('bad zip central directory bounds');
    const decoder = new TextDecoder('utf-8');
    const entries = {};
    let cursor = centralOffset;
    for (let index = 0; index < count; index += 1) {
      if (cursor + 46 > bytes.length || view.getUint32(cursor, true) !== 0x02014b50) throw new Error('bad zip central directory entry');
      const method = view.getUint16(cursor + 10, true);
      const compressedSize = view.getUint32(cursor + 20, true);
      const nameLength = view.getUint16(cursor + 28, true);
      const extraLength = view.getUint16(cursor + 30, true);
      const commentLength = view.getUint16(cursor + 32, true);
      const localOffset = view.getUint32(cursor + 42, true);
      const name = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
      cursor += 46 + nameLength + extraLength + commentLength;
      if (name.charAt(name.length - 1) === '/') continue;
      if (view.getUint32(localOffset, true) !== 0x04034b50) throw new Error('bad zip local header for ' + name);
      const localNameLength = view.getUint16(localOffset + 26, true);
      const localExtraLength = view.getUint16(localOffset + 28, true);
      const dataStart = localOffset + 30 + localNameLength + localExtraLength;
      const raw = bytes.subarray(dataStart, dataStart + compressedSize);
      if (method === 0) entries[name] = raw.slice();
      else if (method === 8) entries[name] = await inflateRawBytes(raw);
      else throw new Error('unsupported zip compression method ' + method + ' for ' + name);
      }
    return entries;
  }

  async function readXlsxTable(bytes) {
    const entries = await readZipEntries(bytes);
    const names = Object.keys(entries);
    let sheetName = names.filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name)).sort()[0];
    if (sheetName === undefined) throw new Error('workbook has no worksheet part; entries: ' + names.join(', '));
    const decoder = new TextDecoder('utf-8');
    const sharedStrings = entries['xl/sharedStrings.xml'] === undefined
      ? []
      : (function parseShared(xml) {
        const values = [];
        const pattern = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
        let match;
        while ((match = pattern.exec(xml)) !== null) values.push(collectTextRuns(match[1]));
        return values;
      })(stripXmlPrefixes(decoder.decode(entries['xl/sharedStrings.xml'])));
    const table = parseSheetTable(stripXmlPrefixes(decoder.decode(entries[sheetName])), sharedStrings);
    return { entries: names, sheetName: sheetName, table: table };
  }

  /**
   * Click the Export button and capture the exact Blob the plugin hands to the
   * browser via URL.createObjectURL. The anchor click is intercepted so the
   * headless runner does not have to handle a real download; everything after
   * the Blob (which is the workbook byte-for-byte) is still the real code path.
   */
  async function captureExportBlob() {
    const win = frame.contentWindow;
    const docNode = frame.contentDocument;
    const originalCreateObjectURL = win.URL.createObjectURL;
    const originalRevokeObjectURL = win.URL.revokeObjectURL;
    const originalAnchorClick = win.HTMLAnchorElement.prototype.click;
    let captured = null;
    let anchorInfo = null;
    win.URL.createObjectURL = function (blob) {
      captured = blob;
      return 'blob:dsm-verify-intercepted';
    };
    win.URL.revokeObjectURL = function () { /* no-op: nothing was created */ };
    win.HTMLAnchorElement.prototype.click = function () {
      anchorInfo = {
        download: this.getAttribute('download'),
        href: String(this.getAttribute('href') || '').slice(0, 60),
        intercepted: true,
      };
    };
    try {
      const button = docNode.querySelector('[data-side-memo="list"] button[title="Export"]')
        || docNode.querySelector('[data-side-memo="list"] .dsm-toolbar-actions button.dsm-icon-btn:last-of-type');
      if (button === null) throw new Error('export button (button[title="Export"]) not found');
      click(button);
      await waitUntil(() => captured !== null, 10000, 'xlsx export blob via URL.createObjectURL');
      const buffer = await captured.arrayBuffer();
      return {
        bytes: new Uint8Array(buffer),
        blobType: captured.type,
        blobSize: captured.size,
        anchorInfo: anchorInfo,
      };
    } finally {
      win.URL.createObjectURL = originalCreateObjectURL;
      win.URL.revokeObjectURL = originalRevokeObjectURL;
      win.HTMLAnchorElement.prototype.click = originalAnchorClick;
    }
  }

  function findCell(table, title) {
    for (let index = 0; index < table.length; index += 1) {
      const row = table[index];
      if (row !== undefined && row.length > 0 && String(row[0]).trim() === title) return row;
    }
    return null;
  }

  // -------------------------------------------------------------------------
  // image suite (previous round, unchanged behavior)
  // -------------------------------------------------------------------------

  async function makePngFile(width, height) {
    const win = doc().defaultView;
    const canvas = win.document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    const gradient = context.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, '#ff2d55');
    gradient.addColorStop(0.5, '#ffd60a');
    gradient.addColorStop(1, '#0a84ff');
    context.fillStyle = gradient;
    context.fillRect(0, 0, width, height);
    context.fillStyle = '#111';
    context.font = Math.round(height / 4) + 'px sans-serif';
    context.fillText('PASTE', Math.round(width * 0.12), Math.round(height * 0.62));
    const blob = await new Promise((resolve, reject) => canvas.toBlob((value) => (value ? resolve(value) : reject(new Error('canvas.toBlob returned null'))), 'image/png'));
    return { file: new win.File([blob], 'pasted-image.png', { type: 'image/png' }), bytes: blob.size, type: blob.type, width: width, height: height };
  }

  function dispatchPaste(editorNode, file) {
    const win = doc().defaultView;
    const dataTransfer = new win.DataTransfer();
    dataTransfer.items.add(file);
    let event;
    try {
      event = new win.ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dataTransfer });
    } catch (error) {
      event = new win.Event('paste', { bubbles: true, cancelable: true });
    }
    if (event.clipboardData === null || event.clipboardData === undefined) {
      Object.defineProperty(event, 'clipboardData', { value: dataTransfer, configurable: true });
    }
    event.__verifySynthetic = true;
    editorNode.focus();
    const delivered = editorNode.dispatchEvent(event);
    return { delivered: delivered, clipboardDataPresent: event.clipboardData !== null && event.clipboardData !== undefined, items: event.clipboardData && event.clipboardData.items ? event.clipboardData.items.length : -1 };
  }

  function readIndexedDb() {
    const win = doc().defaultView;
    const idb = win.indexedDB;
    if (idb === undefined) return Promise.resolve({ unavailable: true });
    return new Promise((resolve) => {
      let settled = false;
      const done = (value) => { if (!settled) { settled = true; resolve(value); } };
      const timer = setTimeout(() => done({ timeout: true, databases: [] }), 4000);
      const list = typeof idb.databases === 'function' ? idb.databases() : Promise.resolve([]);
      Promise.resolve(list).then(async (databases) => {
        const names = (databases || []).map((entry) => entry.name);
        const out = { databases: names, records: 0, imageIds: [], srcPrefixes: [], sizes: [] };
        if (names.indexOf('dsh-side-memo-images') === -1) { clearTimeout(timer); done(out); return; }
        const open = idb.open('dsh-side-memo-images');
        open.onerror = () => { clearTimeout(timer); done({ error: 'open failed', databases: names }); };
        open.onsuccess = () => {
          const db = open.result;
          const stores = Array.from(db.objectStoreNames);
          out.stores = stores;
          if (stores.indexOf('images') === -1) { clearTimeout(timer); done(out); return; }
          const tx = db.transaction('images', 'readonly');
          const request = tx.objectStore('images').getAll();
          request.onsuccess = () => {
            const records = request.result || [];
            out.records = records.length;
            for (const record of records) {
              if (record && typeof record === 'object') {
                out.imageIds.push(record.id);
                out.sizes.push(record.size === undefined ? -1 : record.size);
                out.srcPrefixes.push(typeof record.src === 'string' ? record.src.slice(0, 32) : String(record.src));
              }
            }
            clearTimeout(timer);
            done(out);
          };
          request.onerror = () => { clearTimeout(timer); done({ error: 'getAll failed', stores: stores }); };
        };
      });
    });
  }

  function describeInstances() {
    const docNode = frame.contentDocument;
    if (docNode === null) return { error: 'no-document' };
    const describe = (selector) => Array.from(docNode.querySelectorAll(selector)).map((node) => {
      const rect = node.getBoundingClientRect();
      return {
        tag: node.tagName,
        className: String(node.className || '').slice(0, 60),
        rect: Math.round(rect.width) + 'x' + Math.round(rect.height),
        connected: node.isConnected === true,
        editableChild: node.querySelector('[contenteditable="true"]') !== null,
      };
    });
    return {
      editors: describe('[data-side-memo="editor"]'),
      lists: describe('[data-side-memo="list"]'),
      drawers: describe('[data-side-memo="drawer"]'),
      drawerLayers: describe('.dsm-drawer-layer'),
      bodyEditors: describe('[data-side-memo="editor"] [contenteditable="true"]'),
    };
  }

  async function probeEventDelegation() {
    const win = frame.contentWindow;
    const body = bodyEditor();
    const probe = { writesBefore: readStorageWrites().length };
    results.evidence.reactProbe = probe;
    body.focus();
    probe.activeAfterFocus = String((win.document.activeElement && (win.document.activeElement.tagName + '.' + win.document.activeElement.className)) || '');
    const before = new win.InputEvent('beforeinput', { bubbles: true, cancelable: true, composed: true, inputType: 'insertText', data: 'X' });
    body.dispatchEvent(before);
    probe.beforeInputPrevented = before.defaultPrevented;
    const inputEvent = new win.InputEvent('input', { bubbles: true, cancelable: true, composed: true, inputType: 'insertText', data: 'X' });
    body.dispatchEvent(inputEvent);
    await sleep(600);
    probe.writesAfterInput = readStorageWrites().length;
    probe.lastWrites = readStorageWrites().slice(-2).map((write) => String(write.value).slice(0, 240));
    probe.events = readEventTap();
  }

  async function createMemoForImageSuite(title, text) {
    const drawer = q('[data-side-memo="drawer"]');
    const newButton = drawer.querySelector('.dsm-toolbar button.dsm-btn') || drawer.querySelector('button.dsm-btn');
    if (newButton === null) throw new Error('new-note button not found in drawer');
    pushStep('new-button', (newButton.textContent || '').trim() || '(icon only)');
    click(newButton);
    await waitFor('[data-side-memo="editor"]', 8000, 'editor');
    const editableStart = Date.now();
    await waitUntil(() => {
      const el = q('[data-side-memo="editor"] .dsm-editor-body');
      return el !== null && el.getAttribute('contenteditable') === 'true';
    }, 12000, 'editor contenteditable (imagesReady)');
    results.evidence.imagesReadyWaitMs = Date.now() - editableStart;
    await sleep(250);
    await probeEventDelegation();
    const titleInput = q('.dsm-editor-title');
    if (titleInput !== null) setNativeValue(titleInput, title);
    const body = bodyEditor();
    if (body === null) throw new Error('editor body not found');
    results.evidence.bodyEditor = {
      tag: body.tagName,
      className: body.className,
      contentEditable: body.getAttribute('contenteditable'),
    };
    const writesBeforeTyping = readStorageWrites();
    typeIntoEditor(body, text);
    await sleep(600);
    const writesAfterTyping = readStorageWrites();
    results.evidence.writesBeforeTyping = writesBeforeTyping;
    results.evidence.writesAfterTyping = writesAfterTyping;
    results.evidence.eventsAfterTyping = readEventTap();
    results.evidence.activeElementAfterTyping = String((frame.contentDocument && frame.contentDocument.activeElement && frame.contentDocument.activeElement.className) || '');
    if (writesAfterTyping.length === writesBeforeTyping.length) {
      const win = frame.contentWindow;
      try { win.focus(); } catch (error) { /* ignore */ }
      const range = win.document.createRange();
      range.selectNodeContents(body);
      range.collapse(false);
      const selection = win.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      body.focus();
      const commandResult = win.document.execCommand('insertText', false, text);
      results.evidence.execCommandFallback = { result: commandResult, html: body.innerHTML.slice(0, 300) };
      await sleep(600);
      results.evidence.writesAfterExecCommand = readStorageWrites();
      results.evidence.eventsAfterExecCommand = readEventTap();
    }
    results.evidence.instancesAfterTyping = describeInstances();
    results.evidence.afterTyping = {
      html: body.innerHTML.slice(0, 1200),
      text: (body.textContent || '').slice(0, 400),
      bodyTextTag: body.tagName,
      localStorage: readLocalStorage(),
    };
    pushStep('typed', 'title=' + title + ' body=' + text + ' domText=' + JSON.stringify((body.textContent || '').slice(0, 80)));
  }

  async function pasteImageForSuite(options) {
    options = options || {};
    const expectedText = options.expectedText || 'paste target text';
    const editorNode = bodyEditor();
    if (editorNode === null) throw new Error('no editor body for paste');
    results.evidence.instancesBeforePaste = describeInstances();
    const pasteDoc = frame.contentDocument;
    let startCaret = null;
    if (options.caretAtStart) {
      const textNode = findTextNode(editorNode, expectedText);
      if (textNode === null) throw new Error('caret-at-start: text node "' + expectedText + '" not found');
      const offset = options.caretOffset !== undefined ? options.caretOffset : 0;
      startCaret = setCaretAtOffset(editorNode, textNode, offset);
      results.evidence.startCaret = startCaret;
      pushStep('caret-at-start', JSON.stringify(startCaret));
    }
    pushStep('editor-before-paste', editorNode.tagName + ' html=' + JSON.stringify(editorNode.innerHTML.slice(0, 120)));
    const png = await makePngFile(160, 100);
    results.evidence.pastedFile = { bytes: png.bytes, type: png.type, width: png.width, height: png.height };
    const delivery = dispatchPaste(editorNode, png.file);
    pushStep('paste-dispatched', JSON.stringify(delivery));
    results.evidence.pasteDelivery = delivery;
    const start = Date.now();
    const waitSamples = [];
    let image = null;
    while (Date.now() - start < 12000) {
      if (frame.contentDocument !== pasteDoc) {
        results.evidence.pasteWait = { samples: waitSamples, documentReplaced: true };
        throw new Error('iframe document was replaced during the paste wait (navigation/reload)');
      }
      image = q('[data-side-memo="editor"] img[data-image-id]') || q('[data-side-memo="editor"] .dsm-image-block img');
      if (image !== null) break;
      await sleep(150);
      const at = Date.now() - start;
      if (at - (waitSamples.length === 0 ? 0 : waitSamples[waitSamples.length - 1].at) >= 1000) {
        waitSamples.push({
          at: at,
          hasEditor: q('[data-side-memo="editor"]') !== null,
          hasDrawer: q('[data-side-memo="drawer"]') !== null,
          hasImageInput: q('input.dsm-image-input') !== null,
          notices: qa('.dsm-notice').map((n) => (n.textContent || '').slice(0, 120)),
        });
      }
    }
    results.evidence.pasteWait = { samples: waitSamples, documentReplaced: false };
    if (image === null) throw new Error('no image block appeared after synthetic paste');
    results.evidence.imageBlock = {
      srcPrefix: (image.getAttribute('src') || '').slice(0, 64),
      imageId: image.getAttribute('data-image-id'),
      naturalWidth: image.naturalWidth,
      naturalHeight: image.naturalHeight,
    };
    const editorAfterPaste = q('[data-side-memo="editor"] .dsm-editor-body');
    results.evidence.afterPaste = {
      html: editorAfterPaste === null ? null : editorAfterPaste.innerHTML.slice(0, 1500),
      text: editorAfterPaste === null ? null : (editorAfterPaste.textContent || '').slice(0, 400),
      localStorageNow: readLocalStorage(),
      writesSoFar: readStorageWrites(),
    };
    pushStep('image-block', 'id=' + (image.getAttribute('data-image-id') || '') + ' ' + image.naturalWidth + 'x' + image.naturalHeight);
    const bodyAfterPaste = q('[data-side-memo="editor"] .dsm-editor-body');
    if (bodyAfterPaste !== null) {
      bodyAfterPaste.dispatchEvent(new (frame.contentWindow).InputEvent('input', { bubbles: true, inputType: 'insertFromPaste' }));
      await sleep(350);
      results.evidence.afterPasteInputDispatch = { html: bodyAfterPaste.innerHTML.slice(0, 1500), noteJson: readLocalStorage()['dsh.side-memo.notes.v1'] || null };
    }
    const frames = [];
    const sampleStart = Date.now();
    while (Date.now() - sampleStart < 1800) {
      frames.push({
        at: Date.now() - sampleStart,
        imageBlocks: qa('[data-side-memo="editor"] .dsm-image-block').length,
        imageImgs: qa('[data-side-memo="editor"] img[data-image-id]').length,
        editorHtml: (q('[data-side-memo="editor"] .dsm-editor-body') || {}).innerHTML ? q('[data-side-memo="editor"] .dsm-editor-body').innerHTML.length : -1,
        noteJson: readLocalStorage()['dsh.side-memo.notes.v1'] || null,
      });
      await sleep(150);
    }
    results.evidence.afterPasteFrames = frames;
    await sleep(400);
    results.evidence.storageWrites = readStorageWrites();
    results.evidence.indexedDb = await readIndexedDb();
    results.evidence.localStorage = readLocalStorage();
    if (options.caretAtStart) {
      const noteJson = readLocalStorage()['dsh.side-memo.notes.v1'] || '';
      let parsed = null;
      try { parsed = JSON.parse(noteJson); } catch (error) { parsed = null; }
      const note = parsed !== null && Array.isArray(parsed.notes) ? parsed.notes[0] : null;
      const blocks = note !== null && Array.isArray(note.content) ? note.content : [];
      const textFromBlocks = blocks.filter((block) => block !== null && block.type === 'text').map((block) => block.text || '').join('');
      const hasImageBlock = blocks.some((block) => block !== null && block.type === 'image');
      const liveEditor = bodyEditor();
      const domText = liveEditor === null ? '' : (liveEditor.textContent || '');
      const preservedDom = domText.indexOf(expectedText) !== -1;
      const preservedModel = textFromBlocks.indexOf(expectedText) !== -1;
      const liveImage = q('[data-side-memo="editor"] img[data-image-id]');
      results.evidence.startOfLinePaste = {
        expectedText: expectedText,
        caretOffset: startCaret === null ? null : startCaret.offset,
        preservedDom: preservedDom,
        preservedModel: preservedModel,
        hasImageBlock: hasImageBlock,
        imageId: results.evidence.imageBlock ? results.evidence.imageBlock.imageId : null,
        imageAlt: liveImage === null ? null : (liveImage.getAttribute('alt') || ''),
        domText: domText.slice(0, 400),
        blocks: blocks,
        noteJson: noteJson,
      };
      if (!preservedDom || !preservedModel || !hasImageBlock) {
        throw new Error('start-of-line paste lost content: dom=' + preservedDom + ' model=' + preservedModel + ' image=' + hasImageBlock);
      }
      pushStep('startline-text-preserved', 'dom=' + preservedDom + ' model=' + preservedModel + ' image=' + hasImageBlock);
    }
    pushStep('storage-after-paste', 'idbRecords=' + (results.evidence.indexedDb.records === undefined ? 'n/a' : results.evidence.indexedDb.records));
  }

  async function reloadPersistenceForImageSuite() {
    await reloadFrame();
    const drawer = await ensureDrawer();
    pushStep('drawer-open-after-reload', (drawer.textContent || '').slice(0, 80));
    const row = await waitFor('.dsm-row-main', 10000, 'memo row after reload');
    results.evidence.rowAfterReload = (row.textContent || '').slice(0, 200);
    pushStep('row-after-reload', results.evidence.rowAfterReload);
    results.evidence.localStorageAfterReload = readLocalStorage();
    click(row);
    await waitFor('[data-side-memo="editor"]', 8000, 'editor after reload');
    await sleep(1500);
    const image = q('[data-side-memo="editor"] img[data-image-id]') || q('[data-side-memo="editor"] .dsm-image-block img');
    if (image === null) {
      const editorAfterReload = q('[data-side-memo="editor"] .dsm-editor-body');
      results.evidence.afterReload = {
        html: editorAfterReload === null ? null : editorAfterReload.innerHTML.slice(0, 1500),
        text: editorAfterReload === null ? null : (editorAfterReload.textContent || '').slice(0, 400),
        localStorage: readLocalStorage(),
        indexedDb: await readIndexedDb(),
      };
      throw new Error('image block missing after reload (persistence check)');
    }
    results.evidence.imageAfterReload = {
      imageId: image.getAttribute('data-image-id'),
      naturalWidth: image.naturalWidth,
      naturalHeight: image.naturalHeight,
    };
    const reloadedBody = q('[data-side-memo="editor"] .dsm-editor-body');
    results.evidence.textAfterReload = reloadedBody === null ? null : (reloadedBody.textContent || '').slice(0, 400);
    if (reloadedBody !== null && (reloadedBody.textContent || '').indexOf('paste target text') === -1) {
      throw new Error('text missing from editor after reload: ' + JSON.stringify(results.evidence.textAfterReload));
    }
    pushStep('image-after-reload', image.getAttribute('data-image-id') || '');
    results.evidence.indexedDbAfterReload = await readIndexedDb();
  }

  async function removeImageForSuite() {
    const remove = q('.dsm-image-remove');
    if (remove === null) throw new Error('.dsm-image-remove not found');
    click(remove);
    await waitUntil(() => q('[data-side-memo="editor"] img[data-image-id]') === null, 6000, 'image block removal');
    await sleep(1200);
    results.evidence.indexedDbAfterRemove = await readIndexedDb();
    pushStep('image-removed', 'idbRecords=' + (results.evidence.indexedDbAfterRemove.records === undefined ? 'n/a' : results.evidence.indexedDbAfterRemove.records));
  }

  async function runImagesSuite() {
    pushStep('harness-start', 'suite=' + IMAGES_SUITE + ' token=' + (token === '' ? 'missing' : 'set'));
    if (token === '') throw new Error('missing ?token= query parameter');
    await boot();
    await ensureDrawer();
    pushStep('drawer-open', String((q('[data-side-memo="drawer"]') || {}).textContent || '').slice(0, 120));
    await createMemoForImageSuite('Verify memo', 'paste target text');
    await pasteImageForSuite({ caretAtStart: true, expectedText: 'paste target text', caretOffset: 0 });
    await reloadPersistenceForImageSuite();
    if (String(location.search).indexOf('keep') === -1) await removeImageForSuite();
    pushStep('all-passed', '');
  }

  // -------------------------------------------------------------------------
  // labels suite
  // -------------------------------------------------------------------------

  const MEMO_A = 'Alpha memo';
  const MEMO_B = 'Beta memo';
  const MEMO_C = 'Gamma memo';
  const CAP_LABELS = ['cap01', 'cap02', 'cap03', 'cap04', 'cap05', 'cap06', 'cap07', 'cap08', 'cap09'];

  async function openEditorFor(title) {
    const row = await waitUntil(() => rowForTitle(title), 8000, 'row "' + title + '"');
    click(row.querySelector('.dsm-row-main') || row);
    await waitFor('[data-side-memo="editor"]', 8000, 'editor for "' + title + '"');
    await sleep(400);
    return editorRoot();
  }

  async function runLabelsSuite() {
    pushStep('harness-start', 'suite=' + LABELS_SUITE + ' token=' + (token === '' ? 'missing' : 'set'));
    if (token === '') throw new Error('missing ?token= query parameter');
    await boot();

    // ---- boot / drawer -----------------------------------------------------
    await section('boot', async () => {
      await must('drawer-open', async () => {
        const drawer = await ensureDrawer();
        return String((drawer.textContent || '')).replace(/\s+/g, ' ').slice(0, 100);
      });
    });

    // ---- editor labels on memo A ------------------------------------------
    let memoAReady = false;
    await section('editor-labels', async () => {
      await must('memo-a-create', async () => {
        await openNewMemo();
        await setTitle(MEMO_A);
        await setBodyText('alpha body');
        const created = await waitForNotes((state) => state.notes.some((note) => note.title === MEMO_A), 5000, 'memo A in localStorage');
        results.evidence.memoACreated = {
          version: created.parsed === null ? null : created.parsed.version,
          note: created.notes.find((note) => note.title === MEMO_A),
        };
        return 'title=' + MEMO_A + ' version=' + (created.parsed === null ? 'n/a' : created.parsed.version);
      });

      await must('memo-a-content', async () => {
        const state = readNotes();
        const note = state.notes.find((item) => item.title === MEMO_A);
        assert(note !== undefined, 'memo A not in localStorage');
        assert((note.body || '').indexOf('alpha body') !== -1, 'memo A body not persisted: ' + JSON.stringify(note.body));
        assert(state.parsed !== null && state.parsed.version === 3, 'localStorage payload version should bump to 3, got ' + JSON.stringify(state.parsed === null ? null : state.parsed.version));
        assert(Array.isArray(note.labels) && note.labels.length === 0, 'new memo labels should be [] (got ' + JSON.stringify(note.labels) + ')');
        assert(labelsEditor() !== null, '.dsm-labels-editor not found in editor');
        assert(labelInput() !== null, 'input.dsm-label-input not found in editor');
        return 'version=3 labels=[] title/body persisted';
      });

      await must('label-add-enter', async () => {
        const added = await addLabel('work', 'enter');
        return 'chips=' + JSON.stringify(added.chips);
      });

      await must('label-add-comma', async () => {
        const added = await addLabel('urgent', 'comma');
        return 'chips=' + JSON.stringify(added.chips);
      });

      await must('label-add-blur', async () => {
        const added = await addLabel('#idea', 'blur');
        assert(added.chips.indexOf('idea') !== -1, 'blur commit with "#idea" should normalize to "idea", chips=' + JSON.stringify(added.chips));
        return 'typed "#idea" -> chip "idea"; chips=' + JSON.stringify(added.chips);
      });

      await must('label-order', async () => {
        assertEqual(editorChips(), ['work', 'urgent', 'idea'], 'editor label chips order/markup');
        return JSON.stringify(editorChips());
      });

      await must('label-persist-immediate', async () => {
        const state = await waitForNotes((value) => {
          const note = value.notes.find((item) => item.title === MEMO_A);
          return note !== undefined && Array.isArray(note.labels) && note.labels.length === 3;
        }, 5000, 'memo A labels persisted immediately');
        const note = state.notes.find((item) => item.title === MEMO_A);
        assertEqual(labelsOf(note), ['work', 'urgent', 'idea'], 'memo A labels in localStorage');
        results.evidence.memoALabels3 = note.labels;
        return JSON.stringify(note.labels);
      });

      await must('label-duplicate', async () => {
        const outcome = await attemptAddLabelExpectNoChange('WORK');
        assertEqual(outcome.after, outcome.before, 'duplicate/case-insensitive label must not add a chip');
        assert(outcome.inputValue === '', 'label input should be cleared after duplicate, got ' + JSON.stringify(outcome.inputValue));
        assert(/already|duplicate|已存在/i.test(outcome.announcement), 'duplicate should be announced, announcement=' + JSON.stringify(outcome.announcement));
        results.evidence.duplicateAttempt = outcome;
        return 'chips unchanged ' + JSON.stringify(outcome.after) + '; announcement=' + JSON.stringify(outcome.announcement.slice(0, 120));
      });

      await must('label-cap-add', async () => {
        for (const name of CAP_LABELS) await addLabel(name, 'enter');
        const chips = editorChips();
        assertEqual(chips.length, 12, 'label cap should be 12 after adding 9 more, chips=' + JSON.stringify(chips));
        // Persistence is debounced (SAVE_DELAY_MS = 250), so wait for the write
        // instead of reading localStorage synchronously.
        const state = await waitForNotes((value) => {
          const note = value.notes.find((item) => item.title === MEMO_A);
          return note !== undefined && Array.isArray(note.labels) && note.labels.length === 12;
        }, 6000, 'memo A labels length 12 in localStorage');
        const note = state.notes.find((item) => item.title === MEMO_A);
        assertEqual(labelsOf(note) === null ? null : labelsOf(note).length, 12, 'memo A labels length in localStorage');
        results.evidence.memoALabels12 = note.labels;
        return 'chips=' + chips.length;
      });

      await must('label-cap-refuse', async () => {
        const outcome = await attemptAddLabelExpectNoChange('overflow');
        assertEqual(outcome.after.length, 12, '13th label must be refused (cap 12), chips=' + JSON.stringify(outcome.after));
        assert(outcome.after.indexOf('overflow') === -1, 'refused label must not appear as chip');
        assert(/12/.test(outcome.announcement) && /up to|最多|limit|max/i.test(outcome.announcement), 'cap notice should mention the limit, announcement=' + JSON.stringify(outcome.announcement));
        results.evidence.capAttempt = outcome;
        return 'still ' + outcome.after.length + ' chips; announcement=' + JSON.stringify(outcome.announcement.slice(0, 120));
      });

      await must('label-cap-cleanup', async () => {
        for (const name of CAP_LABELS) await removeLabel(name);
        assertEqual(editorChips(), ['work', 'urgent', 'idea'], 'chips after removing cap labels');
        return JSON.stringify(editorChips());
      });

      await must('label-remove', async () => {
        const outcome = await removeLabel('idea');
        assertEqual(outcome.chips, ['work', 'urgent'], 'chips after removing "idea"');
        const state = await waitForNotes((value) => {
          const note = value.notes.find((item) => item.title === MEMO_A);
          return note !== undefined && Array.isArray(note.labels) && note.labels.length === 2;
        }, 5000, 'memo A labels after removal');
        const note = state.notes.find((item) => item.title === MEMO_A);
        assertEqual(labelsOf(note), ['work', 'urgent'], 'memo A labels in localStorage after removal');
        results.evidence.removalNotices = outcome.notices;
        return 'chips=' + JSON.stringify(outcome.chips) + ' storage=' + JSON.stringify(note.labels);
      });

      await must('label-batch-comma', async () => {
        // A single draft with a comma separator must commit ALL parts in one
        // batch (client.js commitLabelDraft splits on , ， ; ；).
        const input = labelInput();
        if (input === null) throw new Error('editor label input not found');
        input.focus();
        setNativeValue(input, 'batch1,batch2');
        await sleep(120);
        dispatchKey(input, 'Enter');
        await waitUntil(() => editorChips().length === 4, 5000, 'both comma-separated labels committed');
        assertEqual(editorChips(), ['work', 'urgent', 'batch1', 'batch2'], 'comma-separated draft commits both labels in order');
        const state = await waitForNotes((value) => {
          const note = value.notes.find((item) => item.title === MEMO_A);
          return note !== undefined && Array.isArray(note.labels) && note.labels.length === 4;
        }, 5000, 'all four labels in localStorage');
        const note = state.notes.find((item) => item.title === MEMO_A);
        assertEqual(labelsOf(note), ['work', 'urgent', 'batch1', 'batch2'], 'batch commit stored in localStorage');
        results.evidence.batchCommit = note.labels;
        await removeLabel('batch1');
        await removeLabel('batch2');
        await waitUntil(() => editorChips().length === 2, 5000, 'batch labels removed');
        await waitForNotes((value) => {
          const item = value.notes.find((entry) => entry.title === MEMO_A);
          return item !== undefined && Array.isArray(item.labels) && item.labels.length === 2;
        }, 5000, 'labels after batch cleanup');
        assertEqual(editorChips(), ['work', 'urgent'], 'chips after batch cleanup');
        return 'batch1+batch2 committed in one update, then removed';
      });

      await must('label-backspace', async () => {
        // Backspace on an empty draft removes the last chip (spec behaviour).
        await addLabel('temp', 'enter');
        assertEqual(editorChips(), ['work', 'urgent', 'temp'], 'chips after adding "temp"');
        const input = labelInput();
        if (input === null) throw new Error('editor label input not found');
        input.focus();
        setNativeValue(input, '');
        await sleep(120);
        const dispatched = dispatchKey(input, 'Backspace');
        await waitUntil(() => editorChips().indexOf('temp') === -1, 5000, 'last chip removed by Backspace');
        const state = await waitForNotes((value) => {
          const note = value.notes.find((item) => item.title === MEMO_A);
          return note !== undefined && Array.isArray(note.labels) && note.labels.length === 2;
        }, 5000, 'labels after Backspace removal');
        const note = state.notes.find((item) => item.title === MEMO_A);
        assertEqual(labelsOf(note), ['work', 'urgent'], 'labels in localStorage after Backspace');
        results.evidence.backspaceRemoval = { dispatched: dispatched, chips: editorChips(), labels: note.labels };
        return 'dispatched=' + JSON.stringify(dispatched) + ' chips=' + JSON.stringify(editorChips());
      });

      await must('label-escape', async () => {
        // Escape with a non-empty draft clears the draft and keeps the editor open.
        const input = labelInput();
        if (input === null) throw new Error('editor label input not found');
        const before = editorChips();
        input.focus();
        setNativeValue(input, 'half');
        await sleep(120);
        dispatchKey(input, 'Escape');
        await waitUntil(() => input.value === '', 5000, 'label draft cleared by Escape');
        await sleep(150);
        assertEqual(editorChips(), before, 'Escape must not change committed chips');
        assert(editorRoot() !== null, 'Escape with a pending draft must keep the editor open');
        return 'draft cleared, editor still open, chips=' + JSON.stringify(editorChips());
      });

      await must('editor-back', async () => {
        await backToList();
        return 'list visible';
      });
      memoAReady = true;
    });
    results.evidence.memoAReady = memoAReady;

    // ---- memos B (work) and C (untagged) ---------------------------------
    let memosReady = false;
    await section('memo-fixtures', async () => {
      await ensureList();
      await must('memo-b-create', async () => {
        await openNewMemo();
        await setTitle(MEMO_B);
        await setBodyText('beta body');
        await addLabel('work', 'enter');
        assertEqual(editorChips(), ['work'], 'memo B chips');
        await backToList();
        const state = await waitForNotes((value) => value.notes.filter((note) => note.title === MEMO_B).length === 1, 5000, 'memo B in localStorage');
        const note = state.notes.find((item) => item.title === MEMO_B);
        assertEqual(labelsOf(note), ['work'], 'memo B labels in localStorage');
        return 'labels=' + JSON.stringify(note.labels);
      });

      await must('memo-c-create', async () => {
        await openNewMemo();
        await setTitle(MEMO_C);
        await setBodyText('gamma body');
        assertEqual(editorChips(), [], 'memo C should start with no labels');
        await backToList();
        const state = await waitForNotes((value) => value.notes.length === 3, 5000, 'three memos in localStorage');
        const note = state.notes.find((item) => item.title === MEMO_C);
        assert(Array.isArray(note.labels) && note.labels.length === 0, 'memo C labels should be [], got ' + JSON.stringify(note.labels));
        results.evidence.notesAfterFixtures = state.notes.map((item) => ({ title: item.title, labels: item.labels }));
        return 'labels=' + JSON.stringify(note.labels);
      });

      await must('notes-total', async () => {
        const titles = await waitForRowCount(3, 6000, 'three list rows');
        assertEqual(titles.slice().sort(), [MEMO_A, MEMO_B, MEMO_C].sort(), 'list rows should be the three memos');
        const bars = labelBar();
        assert(bars !== null, '.dsm-labels-bar (label filter bar) not found when memos have labels');
        assertEqual(filterBarLabels().slice().sort(), ['urgent', 'work'], 'label filter bar chips');
        results.evidence.filterBarInitialHtml = bars === null ? null : bars.outerHTML.slice(0, 2000);
        return 'rows=' + JSON.stringify(titles) + ' bar=' + JSON.stringify(filterBarLabels());
      });
      memosReady = true;
    });
    results.evidence.memosReady = memosReady;

    // ---- search by label ---------------------------------------------------
    if (memosReady) {
      await section('search', async () => {
        await ensureList();
        await must('search-placeholder', async () => {
          const input = searchInput();
          assert(input !== null, '.dsm-search input not found');
          const placeholder = input.getAttribute('placeholder') || '';
          assert(placeholder === 'Search notes or labels', 'search placeholder should be "Search notes or labels", got ' + JSON.stringify(placeholder));
          return JSON.stringify(placeholder);
        });

        await must('search-label', async () => {
          await setSearch('work');
          const titles = await waitForRowCount(2, 6000, 'search "work" narrows to 2 rows');
          assertEqual(titles.slice().sort(), [MEMO_A, MEMO_B].sort(), 'search by label name should match memos A and B, got ' + JSON.stringify(titles));
          return 'rows=' + JSON.stringify(titles);
        });

        await must('search-hash', async () => {
          await setSearch('#work');
          const titles = await waitForRowCount(2, 6000, 'search "#work" narrows to 2 rows');
          assertEqual(titles.slice().sort(), [MEMO_A, MEMO_B].sort(), 'search "#work" should match memos A and B, got ' + JSON.stringify(titles));
          return 'rows=' + JSON.stringify(titles);
        });

        await must('search-nomatch', async () => {
          await setSearch('#nosuchlabel');
          await waitUntil(() => visibleRowCount() === 0, 6000, 'no rows for non-matching label search');
          const empty = q('[data-side-memo="list"] .dsm-empty');
          assert(empty !== null, '.dsm-empty empty state missing for non-matching search');
          results.evidence.searchEmptyText = (empty.textContent || '').replace(/\s+/g, ' ').trim();
          assert(/no notes match/i.test(results.evidence.searchEmptyText), 'search empty state should use search.empty wording, got ' + JSON.stringify(results.evidence.searchEmptyText));
          return JSON.stringify(results.evidence.searchEmptyText);
        });

        await must('search-clear', async () => {
          const how = await clearSearch();
          const titles = await waitForRowCount(3, 6000, 'three rows after clearing search');
          assertEqual(titles.slice().sort(), [MEMO_A, MEMO_B, MEMO_C].sort(), 'clearing search restores all rows');
          return how + ' rows=' + JSON.stringify(titles);
        });
      });
    }

    // ---- label filter bar --------------------------------------------------
    if (memosReady) {
      await section('filter', async () => {
        await ensureList();
        await must('filter-select', async () => {
          const chip = await clickFilterChip('work');
          const titles = await waitForRowCount(2, 6000, 'filter "work" narrows to 2 rows');
          assertEqual(titles.slice().sort(), [MEMO_A, MEMO_B].sort(), 'filtering by "work" should show A and B, got ' + JSON.stringify(titles));
          assert(isChipPressed(chip), 'filter chip "work" should be aria-pressed=true with data-active, got aria-pressed=' + JSON.stringify(chip.getAttribute('aria-pressed')) + ' data-active=' + JSON.stringify(chip.getAttribute('data-active')));
          const foot = footText();
          assert(/2/.test(foot) && /3/.test(foot) && /of|\//.test(foot), 'footer should show visible/total while filtering, got ' + JSON.stringify(foot));
          results.evidence.filterWork = { titles: titles, foot: foot, chipHtml: chip.outerHTML.slice(0, 300) };
          return 'rows=' + JSON.stringify(titles) + ' foot=' + JSON.stringify(foot);
        });

        await must('filter-and', async () => {
          const chip = await clickFilterChip('urgent');
          const titles = await waitForRowCount(1, 6000, 'filter "work"+"urgent" (AND) narrows to 1 row');
          assertEqual(titles, [MEMO_A], 'multi-select labels are AND: only Alpha (work+urgent) should remain, got ' + JSON.stringify(titles));
          assert(isChipPressed(chip), 'filter chip "urgent" should be pressed');
          assert(isChipPressed(filterChip('work')), 'filter chip "work" should stay pressed');
          const foot = footText();
          assert(/1/.test(foot) && /3/.test(foot), 'footer should show 1 of 3 while two labels are active, got ' + JSON.stringify(foot));
          results.evidence.filterAnd = { titles: titles, foot: foot };
          return 'rows=' + JSON.stringify(titles) + ' foot=' + JSON.stringify(foot);
        });

        await must('filter-all', async () => {
          const clear = findClearFilterChip();
          assert(clear !== null, '"All labels" clear chip not found in .dsm-labels-bar; bar html=' + JSON.stringify(labelBar() === null ? null : labelBar().outerHTML.slice(0, 800)));
          click(clear);
          const titles = await waitForRowCount(3, 6000, 'all rows after "All labels"');
          assertEqual(titles.slice().sort(), [MEMO_A, MEMO_B, MEMO_C].sort(), '"All labels" should clear the filter');
          const work = filterChip('work');
          const urgent = filterChip('urgent');
          assert(work !== null && work.getAttribute('aria-pressed') === 'false', 'filter chip "work" should be aria-pressed=false after clear, got ' + JSON.stringify(work === null ? null : work.getAttribute('aria-pressed')));
          assert(urgent !== null && urgent.getAttribute('aria-pressed') === 'false', 'filter chip "urgent" should be aria-pressed=false after clear');
          results.evidence.filterCleared = { titles: titles, foot: footText() };
          return 'rows=' + JSON.stringify(titles) + ' foot=' + JSON.stringify(footText());
        });
      });
    }

    // ---- group by label ----------------------------------------------------
    if (memosReady) {
      await section('group', async () => {
        await ensureList();
        await must('group-on', async () => {
          const toggle = groupToggle();
          assert(toggle !== null, 'button.dsm-group-toggle not found in list toolbar');
          click(toggle);
          await waitUntil(() => groupNodes().length >= 3, 6000, 'group sections');
          assert(toggle.getAttribute('aria-pressed') === 'true', 'group toggle should be aria-pressed=true, got ' + JSON.stringify(toggle.getAttribute('aria-pressed')));
          const active = toggle.getAttribute('data-active');
          assert(active === 'true' || active === '', 'group toggle should expose data-active, got ' + JSON.stringify(active));
          results.evidence.groupToggleHtml = toggle.outerHTML.slice(0, 400);
          return 'sections=' + groupNodes().length;
        });

        await must('group-sections', async () => {
          const sections = groupNodes();
          const summary = sections.map((group) => ({
            label: group.getAttribute('data-label'),
            untagged: group.getAttribute('data-untagged'),
            rows: groupRows(group),
          }));
          results.evidence.groupSections = summary;
          assertEqual(summary.map((entry) => entry.label).filter((label) => label !== null).sort(), ['urgent', 'work'], 'group sections for labels in use');
          const work = summary.filter((entry) => entry.label === 'work')[0];
          const urgent = summary.filter((entry) => entry.label === 'urgent')[0];
          const untagged = summary.filter((entry) => entry.untagged === 'true')[0];
          assert(work !== undefined, 'group section [data-label="work"] missing');
          assert(urgent !== undefined, 'group section [data-label="urgent"] missing');
          assert(untagged !== undefined, 'untagged group section [data-untagged="true"] missing');
          assertEqual(work.rows.slice().sort(), [MEMO_A, MEMO_B].sort(), 'work section should contain Alpha and Beta');
          assertEqual(urgent.rows, [MEMO_A], 'urgent section should contain Alpha only');
          assertEqual(untagged.rows, [MEMO_C], 'untagged section should contain Gamma only');
          assert(summary[summary.length - 1].untagged === 'true', 'untagged group must be last, got order ' + JSON.stringify(summary.map((entry) => entry.label === null ? 'untagged:' + entry.untagged : entry.label)));
          const totalRows = qa('[data-side-memo="list"] .dsm-row-main').length;
          assertEqual(totalRows, 4, 'memo with two labels should appear in both sections (4 rows for 3 memos), got ' + totalRows);
          return 'sections=' + JSON.stringify(summary.map((entry) => entry.label === null ? 'untagged' : entry.label));
        });

        await must('group-off', async () => {
          const toggle = groupToggle();
          assert(toggle !== null, 'group toggle disappeared');
          click(toggle);
          await waitUntil(() => groupNodes().length === 0, 6000, 'group sections removed');
          const titles = await waitForRowCount(3, 6000, 'flat list restored');
          assertEqual(titles.slice().sort(), [MEMO_A, MEMO_B, MEMO_C].sort(), 'toggling grouping off should restore the flat list');
          assert(toggle.getAttribute('aria-pressed') === 'false', 'group toggle should be aria-pressed=false after off');
          return 'rows=' + JSON.stringify(titles);
        });
      });
    }

    // ---- reload persistence ------------------------------------------------
    await section('reload', async () => {
      await must('reload', async () => {
        await ensureList();
        // Confirm the debounced writer flushed before the iframe is destroyed.
        await waitForNotes((value) => value.notes.length === 3, 8000, 'three memos persisted before reload');
        await sleep(300);
        await reloadFrame();
        await ensureDrawer();
        return 'reloaded iframe';
      });

      await must('reload-storage', async () => {
        const state = await waitForNotes((value) => value.notes.length === 3, 10000, 'three memos after reload');
        assert(state.parsed !== null && state.parsed.version === 3, 'localStorage version should stay 3 after reload, got ' + JSON.stringify(state.parsed === null ? null : state.parsed.version));
        const alpha = state.notes.find((note) => note.title === MEMO_A);
        const beta = state.notes.find((note) => note.title === MEMO_B);
        const gamma = state.notes.find((note) => note.title === MEMO_C);
        assert(alpha !== undefined && beta !== undefined && gamma !== undefined, 'memos missing after reload');
        assertEqual(labelsOf(alpha), ['work', 'urgent'], 'alpha labels after reload');
        assertEqual(labelsOf(beta), ['work'], 'beta labels after reload');
        assertEqual(labelsOf(gamma), [], 'gamma labels after reload');
        results.evidence.labelsAfterReload = {
          alpha: labelsOf(alpha), beta: labelsOf(beta), gamma: labelsOf(gamma), version: state.parsed.version,
        };
        return 'alpha=' + JSON.stringify(labelsOf(alpha)) + ' beta=' + JSON.stringify(labelsOf(beta)) + ' gamma=' + JSON.stringify(labelsOf(gamma));
      });

      await must('reload-list-chips', async () => {
        await waitForRowCount(3, 10000, 'three rows after reload');
        const alphaChips = rowLabelChips(MEMO_A);
        const betaChips = rowLabelChips(MEMO_B);
        const gammaChips = rowLabelChips(MEMO_C);
        assert(alphaChips !== null, 'Alpha row missing after reload');
        assertEqual(alphaChips.slice().sort(), ['urgent', 'work'], 'Alpha row label chips after reload');
        assertEqual(betaChips, ['work'], 'Beta row label chips after reload');
        assertEqual(gammaChips, [], 'Gamma row should have no label chips');
        assert(labelBar() !== null, '.dsm-labels-bar missing after reload');
        assertEqual(filterBarLabels().slice().sort(), ['urgent', 'work'], 'filter bar chips after reload');
        results.evidence.rowChipsAfterReload = { alpha: alphaChips, beta: betaChips, gamma: gammaChips };
        return 'alpha=' + JSON.stringify(alphaChips) + ' beta=' + JSON.stringify(betaChips);
      });

      await must('reload-editor-chips', async () => {
        await openEditorFor(MEMO_A);
        await waitUntil(() => editorChips().length === 2, 5000, 'editor chips after reload');
        assertEqual(editorChips(), ['work', 'urgent'], 'editor chips for Alpha after reload');
        await backToList();
        return JSON.stringify(editorChips());
      });
    });

    // ---- xlsx export / import ---------------------------------------------
    await section('xlsx', async () => {
      await ensureList();
      await must('xlsx-export', async () => {
        const captured = await captureExportBlob();
        assert(captured.blobSize > 0, 'exported blob is empty');
        assert(captured.bytes.length >= 4 && captured.bytes[0] === 0x50 && captured.bytes[1] === 0x4b, 'exported blob is not a zip/xlsx (PK signature), got ' + JSON.stringify(Array.from(captured.bytes.slice(0, 8))));
        results.evidence.xlsxExport = {
          blobType: captured.blobType,
          blobSize: captured.blobSize,
          anchorInfo: captured.anchorInfo,
          signature: Array.from(captured.bytes.slice(0, 4)),
        };
        const parsed = await readXlsxTable(captured.bytes);
        results.evidence.xlsxExport.sheetName = parsed.sheetName;
        results.evidence.xlsxExport.entries = parsed.entries;
        results.evidence.xlsxExport.headerRow = parsed.table[0];
        results.evidence.xlsxExport.rowCount = parsed.table.length;
        results.evidence.xlsxExport.table = parsed.table;
        capturedXlsxBytes = captured.bytes; // reused by the import step
        return 'bytes=' + captured.blobSize + ' entries=' + parsed.entries.length + ' rows=' + parsed.table.length;
      });

      await must('xlsx-labels-column', async () => {
        const exportEvidence = results.evidence.xlsxExport;
        const table = exportEvidence.table;
        assert(table.length >= 1, 'workbook sheet has no rows');
        assertEqual(table[0], ['Title', 'Body', 'Favorite', 'Labels', 'Created', 'Updated', 'Images'], 'export column order (spec: Title, Body, Favorite, Labels, Created, Updated, Images)');
        const labelsIndex = table[0].indexOf('Labels');
        const alphaRow = findCell(table, MEMO_A);
        const betaRow = findCell(table, MEMO_B);
        const gammaRow = findCell(table, MEMO_C);
        assert(alphaRow !== null, 'Alpha memo row missing from export');
        assert(betaRow !== null, 'Beta memo row missing from export');
        assert(gammaRow !== null, 'Gamma memo row missing from export');
        const alphaLabels = alphaRow[labelsIndex];
        const betaLabels = betaRow[labelsIndex];
        const gammaLabels = gammaRow[labelsIndex];
        assertEqual(alphaLabels, 'work, urgent', 'Alpha Labels cell should be ", "-joined labels');
        assertEqual(betaLabels, 'work', 'Beta Labels cell');
        assertEqual(gammaLabels, '', 'Gamma Labels cell should be empty');
        results.evidence.xlsxLabelsColumn = {
          header: table[0],
          labelsIndex: labelsIndex,
          alpha: alphaLabels,
          beta: betaLabels,
          gamma: gammaLabels,
        };
        return 'alpha=' + JSON.stringify(alphaLabels) + ' beta=' + JSON.stringify(betaLabels) + ' gamma=' + JSON.stringify(gammaLabels);
      });

      await must('xlsx-import', async () => {
        const win = frame.contentWindow;
        const bytes = capturedXlsxBytes;
        assert(bytes !== undefined && bytes !== null && bytes.length > 0, 'no captured xlsx bytes to import');
        const input = q('[data-side-memo="list"] input[type="file"][accept*="xlsx"]')
          || q('[data-side-memo="list"] input[type="file"]');
        assert(input !== null, 'xlsx import file input not found in list toolbar');
        const file = new win.File([bytes], 'verify-labels.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const dataTransfer = new win.DataTransfer();
        dataTransfer.items.add(file);
        input.files = dataTransfer.files;
        assert(input.files !== null && input.files.length === 1, 'could not assign the exported file to the import input');
        input.dispatchEvent(new win.Event('change', { bubbles: true }));
        const state = await waitForNotes((value) => value.notes.length === 6, 15000, 'six memos after importing the exported workbook');
        results.evidence.importResult = {
          noteCount: state.notes.length,
          announcement: announcementText(),
          notices: notices(),
        };
        assert(/import/i.test(announcementText()) || notices().length > 0, 'import should announce a result, announcement=' + JSON.stringify(announcementText()));
        return 'notes=' + state.notes.length + ' announcement=' + JSON.stringify(announcementText().slice(0, 120));
      });

      await must('xlsx-import-labels', async () => {
        const state = readNotes();
        const alphaNotes = state.notes.filter((note) => note.title === MEMO_A);
        const betaNotes = state.notes.filter((note) => note.title === MEMO_B);
        assertEqual(alphaNotes.length, 2, 'import should add a second Alpha memo (no in-place merge expected)');
        assertEqual(betaNotes.length, 2, 'import should add a second Beta memo');
        for (const note of alphaNotes) {
          assert(Array.isArray(note.labels), 'imported Alpha memo is missing labels[] (importMany must carry labels)');
          assertEqual(note.labels, ['work', 'urgent'], 'imported Alpha labels round-trip');
        }
        for (const note of betaNotes) assertEqual(note.labels, ['work'], 'imported Beta labels round-trip');
        const gammaNotes = state.notes.filter((note) => note.title === MEMO_C);
        assertEqual(gammaNotes.length, 2, 'import should add a second Gamma memo');
        for (const note of gammaNotes) assertEqual(note.labels, [], 'imported Gamma labels stay empty');
        results.evidence.importLabels = {
          notes: state.notes.map((note) => ({ title: note.title, labels: note.labels })),
          version: state.parsed === null ? null : state.parsed.version,
        };
        return 'alpha x2 ' + JSON.stringify(alphaNotes[0].labels) + '; beta x2 ' + JSON.stringify(betaNotes[0].labels) + '; gamma x2 []';
      });
    });
  }

  // -------------------------------------------------------------------------
  // newmemo suite: "New memo" button in the editor top bar
  //
  // Contract (English locale):
  //   [data-side-memo="editor"] button[data-side-memo-new="true"].dsm-btn.dsm-new-memo
  //   plus an svg icon + visible "New", title/aria-label "New memo".
  // The suite drives everything through the real UI: create memo A in the
  // editor, click New, and assert the redirect/dedupe/persistence semantics.
  // -------------------------------------------------------------------------

  const NEWMEMO_A = 'Alpha memo';
  const NEWMEMO_A_BODY = 'alpha body';
  const NEWMEMO_B = 'Second memo';
  const NEWMEMO_B_BODY = 'second body';

  async function runNewMemoSuite() {
    pushStep('harness-start', 'suite=' + NEWMEMO_SUITE + ' token=' + (token === '' ? 'missing' : 'set'));
    if (token === '') throw new Error('missing ?token= query parameter');
    await boot();

    // One ordered section: the four checks build on each other, so the first
    // failing step is the precise abort point and later steps are not run.
    await section('new-memo', async () => {
      // Host-page state: the DSH web shell renders the plugin under `div#root`.
      // A fresh isolated DSH_HOME shows the shell's modal "Preview Notice"
      // dialog on load; while that modal is open the shell marks `#root` inert
      // and EVERY app element (including the pre-existing drawer toggle) is
      // unable to take focus. That is host-shell state, not a property of the
      // New button, so dismiss the dialog through its own button first and
      // record the resulting state. If the shell still keeps `#root` inert
      // after dismissal, lift it as an explicit, recorded harness fallback.
      await must('host-page-state', async () => {
        installInertTrace();
        const report = hostPageStateReport('before drawer open');
        results.evidence.hostPageStateBeforeDrawer = report;
        const dismissal = await dismissHostDialogs();
        results.evidence.hostDialogDismissal = dismissal;
        const root = doc().getElementById('root');
        const toggle = q('[data-side-memo-toggle]');
        const experiment = {
          rootInertBeforeDismiss: report.rootInert,
          dialogsBeforeDismiss: report.dialogs.length,
          rootInertAfterDismiss: root === null ? null : root.hasAttribute('inert'),
          inertRemovedAsFallback: false,
          focusToggleAfterFallback: null,
          inertReAdded: null,
        };
        if (root !== null && root.hasAttribute('inert')) {
          root.removeAttribute('inert');
          experiment.inertRemovedAsFallback = true;
          await sleep(80);
          if (toggle !== null) {
            toggle.focus();
            experiment.focusToggleAfterFallback = doc().activeElement === toggle;
          }
          await sleep(500);
          experiment.inertReAdded = root.hasAttribute('inert');
        }
        results.evidence.hostFocusExperiment = experiment;
        return JSON.stringify({ experiment: experiment, dismissal: dismissal });
      });

      await must('drawer-open', async () => {
        const drawer = await ensureDrawer();
        const root = doc().getElementById('root');
        results.evidence.rootInertAfterDrawer = root === null ? null : root.hasAttribute('inert');
        results.evidence.inertTrace = readInertTrace();
        // Fallback: if the shell still holds `#root` inert after the host
        // dialog was dismissed (and after the drawer open), lift it and record
        // whether the shell puts it back. The product does not control this
        // host-shell flag; it only checks that focus works once the app is
        // interactive again.
        const experiment = { rootInertAfterDrawer: results.evidence.rootInertAfterDrawer, inertRemoved: false, focusToggleAfterRemove: null, inertReAdded: null };
        if (root !== null && root.hasAttribute('inert')) {
          root.removeAttribute('inert');
          experiment.inertRemoved = true;
          await sleep(120);
          const toggle = q('[data-side-memo-toggle]');
          if (toggle !== null) {
            toggle.focus();
            experiment.focusToggleAfterRemove = doc().activeElement === toggle;
          }
          await sleep(600);
          experiment.inertReAdded = root.hasAttribute('inert');
        }
        results.evidence.postDrawerInertExperiment = experiment;
        return String(drawer.textContent || '').replace(/\s+/g, ' ').slice(0, 100);
      });

      // Informational environment check: can programmatic focus take effect at
      // all inside the harness iframe? Not a product assertion - it tells the
      // report whether a later title-focus failure is a product defect or a
      // harness/frame artifact.
      await must('focus-capability-probe', async () => {
        const report = focusProbeReport('before memo A');
        results.evidence.focusCapability = report;
        return 'focusWorks=' + JSON.stringify(report.environment.focusWorks)
          + ' docHasFocus=' + JSON.stringify(report.docHasFocus)
          + ' frameHasFocus=' + JSON.stringify(report.frameHasFocus)
          + ' activeElement=' + JSON.stringify(report.activeElement);
      });

      // ---- memo A, created through the normal (list toolbar) UI ----------
      await must('memo-a-create', async () => {
        await openNewMemo();
        // The same shipped effect focuses the title whenever a memo is opened;
        // capture it before typing so the report can compare open vs. New.
        results.evidence.focusAfterOpenMemoA = describeActiveElement();
        await setTitle(NEWMEMO_A);
        await setBodyText(NEWMEMO_A_BODY);
        const state = await waitForNotes(function (value) {
          const note = value.notes.find(function (item) { return item.title === NEWMEMO_A; });
          return note !== undefined && (note.body || '').indexOf(NEWMEMO_A_BODY) !== -1;
        }, 6000, 'memo A persisted');
        const note = state.notes.find(function (item) { return item.title === NEWMEMO_A; });
        results.evidence.newMemoA = noteState(note);
        return 'notes=' + state.notes.length + ' title=' + NEWMEMO_A + ' body=' + JSON.stringify(note.body);
      });

      // ---- the agreed DOM contract of the editor New button --------------
      await must('new-button-contract', async () => {
        const found = requireNewButton();
        const facts = describeNewButton(found.node);
        facts.selector = found.selector;
        facts.adaptedSelector = found.adapted;
        const mismatches = [];
        if (found.adapted) mismatches.push('contract selector missing; adapted to ' + found.selector);
        for (const className of facts.missingClasses) mismatches.push('missing class ' + className);
        if (!facts.hasSvg) mismatches.push('no plus svg icon');
        if (facts.locale === null) {
          mismatches.push('visible text / title / aria-label do not match ' + JSON.stringify(facts.expected));
        }
        facts.mismatches = mismatches;
        results.evidence.newButton = facts;
        // Hard requirements (behavioural core); harmless markup drift is only
        // recorded as evidence so the report can name the exact mismatch.
        assert(facts.hasSvg, 'editor New button has no svg icon: ' + facts.outerHtml);
        assert(facts.locale !== null, 'editor New button label mismatch: text=' + JSON.stringify(facts.text)
          + ' title=' + JSON.stringify(facts.title) + ' aria-label=' + JSON.stringify(facts.ariaLabel)
          + ' expected one of ' + JSON.stringify(facts.expected));
        assert(facts.disabled === false, 'editor New button must be enabled below the 300-note cap');
        return 'locale=' + facts.locale + ' selector=' + found.selector + ' classes=' + JSON.stringify(facts.className)
          + ' mismatches=' + JSON.stringify(mismatches);
      });

      // ---- 1. New from an existing memo redirects to a blank draft -------
      let memoASnapshot = null;
      let firstDraftId = null;
      await must('new-click-blank-draft', async () => {
        const beforeState = readNotes();
        memoASnapshot = noteState(beforeState.notes.find(function (note) { return note.title === NEWMEMO_A; }) || null);
        assert(memoASnapshot !== null, 'memo A not in localStorage before clicking New');
        results.evidence.memoABeforeNew = memoASnapshot;

        await clickEditorNewButton();

        const afterState = await waitForNotes(function (value) {
          return value.notes.length === beforeState.notes.length + 1;
        }, 6000, 'note count +1 after clicking the editor New button');
        const blank = await waitForBlankEditor(6000);
        try {
          await waitForTitleFocus(5000);
        } catch (focusError) {
          const diagnostics = focusProbeReport('after editor New click');
          results.evidence.focusDiagnostics = diagnostics;
          throw new Error(focusError.message
            + ' | activeElement=' + JSON.stringify(diagnostics.activeElement)
            + ' docHasFocus=' + JSON.stringify(diagnostics.docHasFocus)
            + ' frameHasFocus=' + JSON.stringify(diagnostics.frameHasFocus)
            + ' directFocusWorks=' + JSON.stringify(diagnostics.environment.focusWorks)
            + ' directTitleFocusChanged=' + JSON.stringify(diagnostics.forcedFocus.changedActiveElement)
            + ' appFocusTargets=' + JSON.stringify(diagnostics.appFocusTargets)
            + ' inertAncestors=' + JSON.stringify(Array.isArray(diagnostics.titleAncestors)
              ? diagnostics.titleAncestors.filter(function (ancestor) { return ancestor.inert === true; })
              : diagnostics.titleAncestors)
            + ' title=' + JSON.stringify({
              present: diagnostics.titlePresent,
              connected: diagnostics.titleConnected,
              disabled: diagnostics.titleDisabled,
              readOnly: diagnostics.titleReadOnly,
              tabIndex: diagnostics.titleTabIndex,
              rect: diagnostics.titleRect,
            }));
        }
        const activeElement = describeActiveElement();

        assertEqual(blank.titleValue, '', 'new draft title input value');
        assert(blank.bodyText.trim() === '', 'new draft body should be empty, got ' + JSON.stringify(blank.bodyText));
        assert(activeElement.isTitleInput, 'title input (.dsm-editor-title) should be document.activeElement, got ' + JSON.stringify(activeElement));

        const stillA = noteById(memoASnapshot.id);
        assert(stillA !== null, 'memo A disappeared after clicking New');
        assert(stillA.title === memoASnapshot.title, 'memo A title changed: ' + JSON.stringify(stillA.title));
        assert(stillA.body === memoASnapshot.body, 'memo A body changed: ' + JSON.stringify(stillA.body));

        const fresh = afterState.notes.filter(function (note) { return note.id !== memoASnapshot.id; });
        assert(fresh.length === 1, 'expected exactly one new note, got ' + fresh.length);
        firstDraftId = fresh[0].id;
        results.evidence.firstNewClick = {
          beforeCount: beforeState.notes.length,
          afterCount: afterState.notes.length,
          draftId: firstDraftId,
          titleValue: blank.titleValue,
          bodyText: blank.bodyText,
          activeElement: activeElement,
          memoA: noteState(stillA),
        };
        return 'count ' + beforeState.notes.length + '->' + afterState.notes.length + ', blank draft, title focused';
      });

      // ---- 2. New on the blank draft: dedupe, same draft, still focused ---
      await must('new-blank-no-duplicate', async () => {
        const beforeState = readNotes();
        const idsBefore = beforeState.notes.map(function (note) { return note.id; }).sort();
        assert(firstDraftId !== null, 'no blank draft id captured in the previous step');

        await clickEditorNewButton();
        await sleep(900); // longer than the 250 ms store persistence debounce
        const afterState = readNotes();
        const idsAfter = afterState.notes.map(function (note) { return note.id; }).sort();
        const blank = await waitForBlankEditor(4000);
        await waitForTitleFocus(4000);
        const activeElement = describeActiveElement();

        assertEqual(afterState.notes.length, beforeState.notes.length, 'clicking New on a blank draft must not create a note');
        assertEqual(idsAfter, idsBefore, 'clicking New on a blank draft must keep the same note ids (no replacement draft)');
        assert(idsAfter.indexOf(firstDraftId) !== -1, 'the blank draft ' + firstDraftId + ' disappeared');
        assertEqual(blank.titleValue, '', 'blank draft title value after second New');
        assert(blank.bodyText.trim() === '', 'blank draft body should stay empty, got ' + JSON.stringify(blank.bodyText));
        assert(activeElement.isTitleInput, 'title input should stay document.activeElement, got ' + JSON.stringify(activeElement));

        const noteA = noteById(memoASnapshot.id);
        assert(noteA !== null && noteA.title === memoASnapshot.title && noteA.body === memoASnapshot.body,
          'memo A changed after the second New click');
        results.evidence.secondNewClick = {
          beforeCount: beforeState.notes.length,
          afterCount: afterState.notes.length,
          idsUnchanged: JSON.stringify(idsBefore) === JSON.stringify(idsAfter),
          draftId: firstDraftId,
          titleValue: blank.titleValue,
          bodyText: blank.bodyText,
          activeElement: activeElement,
        };
        return 'count stayed ' + afterState.notes.length + ', same blank draft ' + firstDraftId + ' focused';
      });

      // ---- 3. Type in the draft, New: one more blank draft, text kept -----
      await must('new-after-typing-draft', async () => {
        await setTitle(NEWMEMO_B);
        await setBodyText(NEWMEMO_B_BODY);
        const typedState = await waitForNotes(function (value) {
          const note = value.notes.find(function (item) { return item.id === firstDraftId; });
          return note !== undefined && note.title === NEWMEMO_B && (note.body || '').indexOf(NEWMEMO_B_BODY) !== -1;
        }, 6000, 'typed draft persisted');
        const typedDraft = noteState(typedState.notes.find(function (note) { return note.id === firstDraftId; }) || null);

        const beforeState = readNotes();
        await clickEditorNewButton();
        const afterState = await waitForNotes(function (value) {
          return value.notes.length === beforeState.notes.length + 1;
        }, 6000, 'note count +1 after New from a typed draft');
        const blank = await waitForBlankEditor(6000);
        await waitForTitleFocus(5000);
        const activeElement = describeActiveElement();

        assert(activeElement.isTitleInput, 'title input should be document.activeElement after New, got ' + JSON.stringify(activeElement));
        assertEqual(blank.titleValue, '', 'new draft title input value');
        assert(blank.bodyText.trim() === '', 'new draft body should be empty, got ' + JSON.stringify(blank.bodyText));

        const noteA = noteById(memoASnapshot.id);
        assert(noteA !== null && noteA.title === memoASnapshot.title && noteA.body === memoASnapshot.body,
          'memo A changed after the third New click');
        const second = noteById(firstDraftId);
        assert(second !== null, 'the typed draft ' + firstDraftId + ' disappeared');
        assertEqual(noteState(second), typedDraft, 'the typed draft title/body must be unchanged');

        results.evidence.thirdNewClick = {
          beforeCount: beforeState.notes.length,
          afterCount: afterState.notes.length,
          typedDraft: typedDraft,
          memoA: noteState(noteA),
          titleValue: blank.titleValue,
          bodyText: blank.bodyText,
          activeElement: activeElement,
        };
        return 'count ' + beforeState.notes.length + '->' + afterState.notes.length + '; earlier drafts kept their text';
      });

      // ---- 4. Back returns to the list with all (non-empty) notes ---------
      await must('back-to-list-shows-all', async () => {
        const editor = editorRoot();
        assert(editor !== null, 'editor is not open');
        const head = editor.querySelector('.dsm-editor-head');
        const back = head === null
          ? null
          : (head.querySelector('button[aria-label="Back to notes"]') || head.querySelector('button.dsm-icon-btn'));
        assert(back !== null, 'editor back button not found in .dsm-editor-head');
        click(back);
        await waitFor('[data-side-memo="list"]', 6000, 'list after clicking back');
        await sleep(700); // let the flushed store write / render settle

        const rows = rowTitles();
        const storage = readNotes();
        const storedTitles = storage.notes.map(function (note) { return note.title; });
        results.evidence.backToList = {
          rowTitles: rows,
          storedTitles: storedTitles,
          storedCount: storage.notes.length,
          foot: footText(),
          editorOpen: editorRoot() !== null,
        };
        assert(editorRoot() === null, 'editor should close after clicking back');
        assert(rows.indexOf(NEWMEMO_A) !== -1, 'list should show "' + NEWMEMO_A + '", rows=' + JSON.stringify(rows));
        assert(rows.indexOf(NEWMEMO_B) !== -1, 'list should show "' + NEWMEMO_B + '", rows=' + JSON.stringify(rows));
        // The empty draft opened by the last New click is discarded by the
        // existing closeEditor() behaviour; every non-empty note must remain.
        assertEqual(rows.length, storage.notes.length, 'visible rows vs stored notes after back (rows=' + JSON.stringify(rows) + ', stored=' + JSON.stringify(storedTitles) + ')');
        assert(storage.notes.length === 2, 'after discarding the empty draft exactly 2 notes should remain, got ' + storage.notes.length + ' ' + JSON.stringify(storedTitles));
        // Locale-independent "no blank row" check: both stored notes must be
        // exactly the two non-empty memos, and the visible rows match them.
        const sortedTitles = storedTitles.slice().sort();
        assertEqual(sortedTitles, [NEWMEMO_A, NEWMEMO_B].sort(), 'stored note titles after back');
        const sortedRows = rows.slice().sort();
        assertEqual(sortedRows, [NEWMEMO_A, NEWMEMO_B].sort(), 'visible row titles after back');
        return 'rows=' + JSON.stringify(rows) + ' stored=' + JSON.stringify(storedTitles);
      });
    });
  }

  // -------------------------------------------------------------------------
  // finish
  // -------------------------------------------------------------------------

  async function finish() {
    if (finished) return;
    finished = true;
    results.finishedAt = new Date().toISOString();
    results.durationMs = elapsed();
    const failed = results.failed === null ? 'none' : results.failed;
    document.title = 'VERIFY_DONE failed=' + failed;
    document.body.setAttribute('data-verify-done', 'true');
    document.body.setAttribute('data-verify-failed', results.failed === null ? '' : String(results.failed));
    try {
      const response = await fetch('/__verify/result', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(results),
      });
      if (!response.ok) results.postError = 'HTTP ' + response.status;
    } catch (error) {
      results.postError = String(error);
    }
    renderSteps();
    resultEl.textContent = 'DONE ' + JSON.stringify({
      suite: results.suite,
      failed: results.failed,
      failures: results.failures.length,
      steps: results.steps.length,
      durationMs: results.durationMs,
      postError: results.postError || null,
    }, null, 1);
    console.log('VERIFY_RESULT ' + JSON.stringify({
      suite: results.suite,
      failed: results.failed,
      error: results.error,
      failures: results.failures,
      durationMs: results.durationMs,
      evidence: results.evidence,
      steps: results.steps.map((step) => step.step + (step.ok === false ? ' [FAIL]' : '')),
      consoleNotes: results.consoleNotes,
    }));
  }

  function collectConsoleErrors() {
    results.consoleErrors = results.consoleNotes
      .filter((note) => note.method === 'error' || String(note.method).indexOf('iframe.') === 0 || note.method === 'window.error')
      .filter((note) => String(note.text || '').indexOf('favicon.ico') === -1)
      .filter((note) => String(note.text || '').indexOf('VERIFY_RESULT') === -1);
    return results.consoleErrors;
  }

  function finalize() {
    const consoleErrors = collectConsoleErrors();
    if (results.failures.length > 0) {
      results.failed = results.failures[0].step;
      results.error = results.failures.map((failure) => failure.step + ': ' + failure.message).join('\n');
      pushStep('failures', results.failures.map((failure) => failure.step).join(', '), false);
    } else {
      pushStep('all-passed', '');
    }
    if (consoleErrors.length > 0) results.evidence.consoleErrors = consoleErrors;
  }

  async function main() {
    if (suite !== LABELS_SUITE && suite !== IMAGES_SUITE && suite !== NEWMEMO_SUITE) {
      throw new Error('unknown ?suite=' + suite + ' (expected labels, images or newmemo)');
    }
    if (token === '') throw new Error('missing ?token= query parameter');
    if (suite === IMAGES_SUITE) {
      await runImagesSuite();
      finalize();
      await finish();
      return;
    }
    if (suite === NEWMEMO_SUITE) {
      await runNewMemoSuite();
      finalize();
      await finish();
      return;
    }
    await runLabelsSuite();
    finalize();
    await finish();
  }

  main().catch(async (error) => {
    const stack = error instanceof Error ? (error.stack || error.message) : String(error);
    results.failed = 'harness';
    results.error = String(stack);
    pushStep('FAILED harness', String(stack).split('\n').slice(0, 3).join(' | '), false);
    await diagnostics();
    await finish();
  });
})();
}
