// Same-origin verification proxy for the isolated DSH web app.
//
// Why this exists: the Side Memo plugin only renders inside the real DSH shell,
// and driving it with arbitrary page JavaScript requires an iframe harness
// served from the *same origin* as the app. This proxy serves the harness at
// /__verify/* and forwards everything else to the isolated DSH web server,
// rewriting Host / Origin / Referer so the upstream keeps its own authority and
// cookies.
//
//   node test/e2e/proxy.mjs              # foreground; Ctrl+C stops it
//   node test/e2e/proxy.mjs --check      # validate configuration only
//   node test/e2e/proxy.mjs --help       # usage
//
// The script only runs when invoked directly (see config.mjs `shouldRunAsMain`),
// so `node --test` accidentally importing it is a harmless no-op.
//
// Environment (all optional, see config.mjs):
//   DSM_PROXY_PORT   proxy port                     (default 56000)
//   DSM_WEB_PORT     isolated DSH web server port   (default 55001)
//   DSM_RUNTIME_DIR  result/log directory           (default test/e2e/.runtime)
//   DSM_FIXTURES_DIR directory served at /__verify/ (default test/e2e/fixtures)
//
// Loopback only. No external network. POST /__verify/result writes the harness
// JSON to <DSM_RUNTIME_DIR>/last-result.json.

import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import {
  resolveConfig,
  validateConfig,
  configSummary,
  ensureRuntimeDir,
  reportValidation,
  shouldRunAsMain,
} from './config.mjs';

const UPSTREAM_HOST = '127.0.0.1';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

function usage() {
  console.log(`Usage: node test/e2e/proxy.mjs [--check|--help]

Same-origin reverse proxy: /__verify/* serves the self-checking fixtures,
everything else is forwarded to the isolated DSH web server.

Environment:
  DSM_PROXY_PORT   proxy port                     (default 56000)
  DSM_WEB_PORT     isolated DSH web server port   (default 55001)
  DSM_RUNTIME_DIR  result/log directory           (default test/e2e/.runtime)
  DSM_FIXTURES_DIR fixture directory              (default test/e2e/fixtures)`);
}

function setCors(res) {
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
  res.setHeader('access-control-allow-headers', 'content-type');
}

function serveFixture(fixturesDir, res, pathname) {
  let rel = decodeURIComponent(pathname.slice('/__verify/'.length));
  if (rel === '' || rel.endsWith('/')) rel += 'index.html';
  const target = path.resolve(fixturesDir, rel);
  if (target !== fixturesDir && !target.startsWith(fixturesDir + path.sep)) {
    res.writeHead(403).end('forbidden');
    return;
  }
  fs.readFile(target, (error, bytes) => {
    if (error) {
      res.writeHead(404, { 'content-type': 'text/plain' }).end(`missing fixture: ${rel}`);
      return;
    }
    res.writeHead(200, {
      'content-type': MIME[path.extname(target).toLowerCase()] || 'application/octet-stream',
      'cache-control': 'no-store',
    });
    res.end(bytes);
  });
}

function handleResult(config, res, req) {
  setCors(res);
  if (req.method === 'OPTIONS') {
    res.writeHead(204).end();
    return;
  }
  if (req.method === 'POST') {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 4 * 1024 * 1024) {
        res.writeHead(413).end('too large');
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const text = Buffer.concat(chunks).toString('utf8');
        JSON.parse(text); // reject malformed payloads
        ensureRuntimeDir(config);
        fs.writeFileSync(config.resultFile, text);
        res.writeHead(204).end();
      } catch (error) {
        res.writeHead(400, { 'content-type': 'text/plain' }).end(`bad result: ${error.message}`);
      }
    });
    return;
  }
  fs.readFile(config.resultFile, (error, bytes) => {
    if (error) {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('no result yet');
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(bytes);
  });
}

function rewriteForwardHeaders(source, config) {
  const headers = {};
  for (const [key, value] of Object.entries(source)) {
    if (key === 'host' || key === 'connection' || key === 'proxy-connection') continue;
    if (key === 'origin') {
      headers.origin = config.upstreamOrigin;
      continue;
    }
    if (key === 'referer' && typeof value === 'string') {
      headers.referer = value
        .replace(`127.0.0.1:${config.proxyPort}`, `${UPSTREAM_HOST}:${config.webPort}`)
        .replace(`localhost:${config.proxyPort}`, `${UPSTREAM_HOST}:${config.webPort}`);
      continue;
    }
    headers[key] = value;
  }
  headers.host = `${UPSTREAM_HOST}:${config.webPort}`;
  return headers;
}

/** Build the loopback-only reverse proxy for one resolved configuration. */
function createProxyServer(config, fixturesDir) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname.startsWith('/__verify/result')) return handleResult(config, res, req);
    if (url.pathname.startsWith('/__verify/')) return serveFixture(fixturesDir, res, url.pathname);
    if (url.pathname === '/__ping') {
      res.writeHead(200, { 'content-type': 'text/plain', 'cache-control': 'no-store' }).end('proxy ok');
      return;
    }

    const headers = rewriteForwardHeaders(req.headers, config);
    const upstream = http.request(
      {
        host: UPSTREAM_HOST,
        port: config.webPort,
        method: req.method,
        path: req.url,
        headers,
      },
      (upstreamResponse) => {
        const responseHeaders = { ...upstreamResponse.headers };
        delete responseHeaders.connection;
        delete responseHeaders['keep-alive'];
        res.writeHead(upstreamResponse.statusCode || 502, upstreamResponse.statusMessage, responseHeaders);
        upstreamResponse.pipe(res);
      },
    );
    upstream.on('error', (error) => {
      if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain' });
      res.end(`upstream error: ${error.message}`);
    });
    req.on('aborted', () => upstream.destroy());
    req.pipe(upstream);
  });

  // WebSocket / upgrade passthrough (the DSH shell opens a socket for session state).
  server.on('upgrade', (req, socket, head) => {
    const socketState = { closed: false };
    const target = net.connect(config.webPort, UPSTREAM_HOST, () => {
      const headers = rewriteForwardHeaders(req.headers, config);
      headers.connection = 'Upgrade';
      headers.upgrade = req.headers.upgrade || 'websocket';
      let raw = `${req.method} ${req.url} HTTP/1.1\r\n`;
      for (const [key, value] of Object.entries(headers)) {
        if (Array.isArray(value)) for (const item of value) raw += `${key}: ${item}\r\n`;
        else raw += `${key}: ${value}\r\n`;
      }
      raw += '\r\n';
      target.write(raw);
      if (head !== null && head !== undefined && head.length > 0) target.write(head);
      socket.pipe(target);
      target.pipe(socket);
    });
    const destroy = (error) => {
      if (socketState.closed) return;
      socketState.closed = true;
      try { socket.destroy(); } catch { /* ignore */ }
      try { target.destroy(); } catch { /* ignore */ }
      if (error) console.error('[proxy] upgrade error:', error.message);
    };
    target.on('error', destroy);
    socket.on('error', destroy);
    socket.on('close', () => destroy());
    target.on('close', () => destroy());
  });

  return server;
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) {
    usage();
    return;
  }

  const config = resolveConfig();
  const fixturesDir = path.resolve(process.env.DSM_FIXTURES_DIR || config.fixturesDir);
  const validation = validateConfig(config, { requireHome: false });
  const hasErrors = reportValidation(validation);

  if (argv.includes('--check')) {
    for (const [key, value] of configSummary(config)) console.log(`${key}: ${value}`);
    console.log(`DSM_FIXTURES_DIR: ${fixturesDir}`);
    console.log(`upstream: ${config.upstreamOrigin}`);
    console.log(hasErrors ? 'config INVALID' : 'config ok (proxy not started)');
    process.exitCode = hasErrors ? 1 : 0;
    return;
  }
  if (hasErrors) {
    console.error('fix the configuration errors above (or pass --check for details)');
    process.exitCode = 1;
    return;
  }

  const server = createProxyServer(config, fixturesDir);
  server.on('error', (error) => {
    console.error(`[proxy] cannot listen on 127.0.0.1:${config.proxyPort}: ${error.message}`);
    if (error.code === 'EADDRINUSE') {
      console.error('[proxy] another process owns the port; stop it or set DSM_PROXY_PORT to a free port');
    }
    process.exitCode = 1;
  });

  server.listen(config.proxyPort, UPSTREAM_HOST, () => {
    ensureRuntimeDir(config);
    console.log(`[proxy] http://127.0.0.1:${config.proxyPort}/  ->  ${config.upstreamOrigin}`);
    console.log(`[proxy] fixtures ${fixturesDir}`);
    console.log(`[proxy] results  ${config.resultFile}`);
  });
}

if (shouldRunAsMain(import.meta.url)) {
  main();
}
