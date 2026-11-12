'use strict';
/**
 * Local test server: serves the static site and mounts the real api/*.js
 * handlers, with GitHub replaced by an in-memory fake. Used by tests/e2e.js.
 * (For a real local run against your actual repo use `npx vercel dev` instead.)
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const H = require('./helpers');

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' };

function start(port) {
  H.setEnv();
  const gh = H.createFakeGithub(true);
  const realFetch = global.fetch;
  const fake = (() => { gh.install(); const f = global.fetch; global.fetch = realFetch; return f; })();
  global.fetch = (url, init) => (String(url).startsWith('https://api.github.com') ? fake(url, init) : realFetch(url, init));

  // Mirror what Vercel does: committing to GitHub eventually changes the deployed static files.
  gh.deployed = new Map();
  for (const f of fs.readdirSync(path.join(H.ROOT, 'data'))) gh.deployed.set('data/' + f, fs.readFileSync(path.join(H.ROOT, 'data', f)));
  gh.deployDelayMs = 0;
  const origPut = gh.commits.push.bind(gh.commits);
  gh.commits.push = (c) => { setTimeout(() => { for (const [p, b] of gh.files) gh.deployed.set(p, b); }, gh.deployDelayMs); return origPut(c); };

  const routes = {};
  for (const f of fs.readdirSync(path.join(H.ROOT, 'api'))) if (f.endsWith('.js')) routes['/api/' + f.slice(0, -3)] = require(path.join(H.ROOT, 'api', f));

  // apply the same security headers as vercel.json (incl. the Content-Security-Policy)
  const vj = JSON.parse(fs.readFileSync(path.join(H.ROOT, 'vercel.json'), 'utf8'));
  const globalHeaders = (vj.headers.find((x) => x.source === '/(.*)') || { headers: [] }).headers;
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    globalHeaders.forEach((hd) => res.setHeader(hd.key, hd.value));
    if (routes[url.pathname]) return routes[url.pathname](req, res);
    let rel = decodeURIComponent(url.pathname);
    if (rel === '/') rel = '/index.html';
    const key = rel.slice(1);
    if (gh.deployed.has(key)) { res.setHeader('Content-Type', MIME['.json']); res.setHeader('Cache-Control', 'no-cache'); return res.end(gh.deployed.get(key)); }
    const file = path.join(H.ROOT, rel);
    if (!file.startsWith(H.ROOT) || rel.startsWith('/tests') || rel.startsWith('/api') || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.statusCode = 404; return res.end('not found'); }
    res.setHeader('Content-Type', MIME[path.extname(file)] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-cache');
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(port, () => resolve({ server, gh, url: `http://localhost:${server.address().port}` })));
}

module.exports = { start };
if (require.main === module) start(Number(process.env.PORT) || 3000).then((s) => console.log('test server on', s.url));
