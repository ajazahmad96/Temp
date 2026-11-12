'use strict';
/** Test helpers: fake GitHub (in-memory repo with real SHA semantics) + mock req/res. */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ENV = {
  ADMIN_PASSWORD: 'correct horse battery staple',
  SESSION_SECRET: 'x'.repeat(48),
  GITHUB_TOKEN: 'ghp_test_token_value',
  GITHUB_OWNER: 'octo',
  GITHUB_REPO: 'site',
  GITHUB_BRANCH: 'main'
};

function setEnv(extra) { Object.assign(process.env, ENV, extra || {}); }
function clearEnv() { Object.keys(ENV).forEach((k) => delete process.env[k]); }

function blobSha(buf) {
  return crypto.createHash('sha1').update(`blob ${buf.length}\0`).update(buf).digest('hex');
}

/** Fake GitHub. `repo.files` maps path -> Buffer. Install with installFakeGithub(). */
function createFakeGithub(seedFromDisk) {
  const repo = { files: new Map(), commits: [], calls: [], failWith: null, existsRepo: true, token: ENV.GITHUB_TOKEN };
  if (seedFromDisk) {
    for (const f of fs.readdirSync(path.join(ROOT, 'data'))) {
      repo.files.set('data/' + f, fs.readFileSync(path.join(ROOT, 'data', f)));
    }
  }
  const json = (status, body, headers) => ({
    status, ok: status >= 200 && status < 300,
    headers: { get: (k) => (headers || {})[k.toLowerCase()] || null },
    json: async () => body
  });

  async function fakeFetch(url, init) {
    init = init || {};
    const u = new URL(url);
    repo.calls.push({ method: init.method || 'GET', url, headers: init.headers, body: init.body });
    if (repo.failWith === 'network') throw new TypeError('fetch failed');
    if (repo.failWith) return json(repo.failWith, { message: 'forced failure' });
    const auth = (init.headers && init.headers.Authorization) || '';
    if (auth !== `Bearer ${repo.token}`) return json(401, { message: 'Bad credentials' });
    const m = u.pathname.match(/^\/repos\/octo\/site(\/.*)?$/);
    if (!m || !repo.existsRepo) return json(404, { message: 'Not Found' });
    const rest = m[1] || '';
    if (rest === '') return json(200, { full_name: 'octo/site' });
    if (rest.startsWith('/branches/')) return json(rest === '/branches/main' ? 200 : 404, {});
    const c = rest.match(/^\/contents\/(.+)$/);
    if (!c) return json(404, { message: 'Not Found' });
    const p = decodeURIComponent(c[1]).split('/').map((x) => x).join('/');
    const method = init.method || 'GET';
    if (method === 'GET') {
      if (!repo.files.has(p)) return json(404, { message: 'Not Found' });
      const buf = repo.files.get(p);
      return json(200, { type: 'file', sha: blobSha(buf), encoding: 'base64', content: buf.toString('base64').replace(/(.{60})/g, '$1\n') });
    }
    if (method === 'PUT') {
      const body = JSON.parse(init.body);
      if (body.branch !== 'main') return json(404, { message: 'Branch not found' });
      const existing = repo.files.get(p);
      if (existing && body.sha !== blobSha(existing)) {
        return json(409, { message: `${p} does not match ${blobSha(existing)}` });
      }
      if (!existing && body.sha) return json(422, { message: 'sha was supplied but file does not exist' });
      const buf = Buffer.from(body.content, 'base64');
      repo.files.set(p, buf);
      const commit = { sha: crypto.randomBytes(20).toString('hex'), message: body.message, path: p };
      repo.commits.push(commit);
      return json(existing ? 200 : 201, { content: { sha: blobSha(buf) }, commit: { sha: commit.sha, html_url: `https://github.com/octo/site/commit/${commit.sha}` } });
    }
    return json(405, {});
  }
  repo.install = () => { repo._orig = global.fetch; global.fetch = fakeFetch; };
  repo.uninstall = () => { global.fetch = repo._orig; };
  repo.read = (p) => JSON.parse(repo.files.get(p).toString('utf8'));
  return repo;
}

/** Minimal req/res doubles that behave like Node's IncomingMessage/ServerResponse. */
function mockReq({ method = 'GET', url = '/', headers = {}, body, ip = '1.2.3.4', csrf = true, cookie } = {}) {
  const h = Object.assign({ host: 'ajaz.test', 'x-forwarded-for': ip, 'x-forwarded-proto': 'https' }, headers);
  if (csrf && method !== 'GET') { h['x-requested-with'] = 'ajaz-admin'; h.origin = h.origin || 'https://ajaz.test'; }
  if (cookie) h.cookie = cookie;
  const req = { method, url, headers: h, socket: { remoteAddress: ip } };
  if (body !== undefined) req.body = body;
  return req;
}
function mockRes() {
  const res = {
    statusCode: 200, headers: {}, ended: false, _body: '',
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    end(b) { this._body = b || ''; this.ended = true; },
    get json() { return this._body ? JSON.parse(this._body) : null; }
  };
  return res;
}
async function call(handler, reqOpts) {
  const req = mockReq(reqOpts); const res = mockRes();
  await handler(req, res);
  return res;
}
function cookieFrom(res) {
  const sc = res.headers['set-cookie'];
  return sc ? sc.split(';')[0] : '';
}

module.exports = { ROOT, ENV, setEnv, clearEnv, createFakeGithub, mockReq, mockRes, call, cookieFrom, blobSha };
