'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const H = require('./helpers');

const API = path.join(H.ROOT, 'api');
const login = require(path.join(API, 'login.js'));
const logout = require(path.join(API, 'logout.js'));
const session = require(path.join(API, 'session.js'));
const content = require(path.join(API, 'content.js'));
const upload = require(path.join(API, 'upload.js'));
const auth = require(path.join(API, '_lib/auth.js'));

let gh;
test.beforeEach(() => { H.setEnv(); auth._resetAllForTests(); gh = H.createFakeGithub(true); gh.install(); });
test.afterEach(() => { gh.uninstall(); H.clearEnv(); });

async function doLogin(ip) {
  const res = await H.call(login, { method: 'POST', body: { password: H.ENV.ADMIN_PASSWORD }, ip });
  assert.equal(res.statusCode, 200);
  return H.cookieFrom(res);
}

/* ------------------------------- login ---------------------------------- */
test('login: wrong password -> 401 and no cookie', async () => {
  const res = await H.call(login, { method: 'POST', body: { password: 'nope' } });
  assert.equal(res.statusCode, 401);
  assert.equal(res.json.error.code, 'invalid_credentials');
  assert.equal(res.headers['set-cookie'], undefined);
});

test('login: correct password sets signed HttpOnly SameSite=Strict Secure cookie', async () => {
  const res = await H.call(login, { method: 'POST', body: { password: H.ENV.ADMIN_PASSWORD } });
  assert.equal(res.statusCode, 200);
  const sc = res.headers['set-cookie'];
  assert.match(sc, /HttpOnly/); assert.match(sc, /SameSite=Strict/); assert.match(sc, /Secure/); assert.match(sc, /Max-Age=28800/);
  assert.ok(!res._body.includes(H.ENV.ADMIN_PASSWORD) && !res._body.includes(H.ENV.SESSION_SECRET));
});

test('login: not Secure on plain http without Vercel env (local dev)', async () => {
  const res = await H.call(login, { method: 'POST', body: { password: H.ENV.ADMIN_PASSWORD }, headers: { 'x-forwarded-proto': 'http' } });
  assert.doesNotMatch(res.headers['set-cookie'], /Secure/);
});

test('login: rate limited after 5 failures, then even the right password is refused', async () => {
  for (let i = 0; i < 5; i++) {
    const r = await H.call(login, { method: 'POST', body: { password: 'bad' + i }, ip: '9.9.9.9' });
    assert.equal(r.statusCode, 401);
  }
  const blocked = await H.call(login, { method: 'POST', body: { password: H.ENV.ADMIN_PASSWORD }, ip: '9.9.9.9' });
  assert.equal(blocked.statusCode, 429);
  assert.ok(Number(blocked.headers['retry-after']) > 0);
  const other = await H.call(login, { method: 'POST', body: { password: H.ENV.ADMIN_PASSWORD }, ip: '8.8.8.8' });
  assert.equal(other.statusCode, 200); // other IPs unaffected
});

test('login: CSRF protections (missing header / foreign origin)', async () => {
  let r = await H.call(login, { method: 'POST', body: { password: 'x' }, csrf: false });
  assert.equal(r.statusCode, 403);
  r = await H.call(login, { method: 'POST', body: { password: 'x' }, headers: { origin: 'https://evil.example' } });
  assert.equal(r.statusCode, 403);
});

test('login: server not configured -> 503 without leaking details', async () => {
  delete process.env.SESSION_SECRET;
  const r = await H.call(login, { method: 'POST', body: { password: 'x' } });
  assert.equal(r.statusCode, 503);
  assert.ok(!/SESSION_SECRET/.test(r._body));
});

test('login: short SESSION_SECRET is rejected as misconfiguration', async () => {
  process.env.SESSION_SECRET = 'short';
  const r = await H.call(login, { method: 'POST', body: { password: H.ENV.ADMIN_PASSWORD } });
  assert.equal(r.statusCode, 503);
});

test('login: wrong method -> 405', async () => {
  const r = await H.call(login, { method: 'GET' });
  assert.equal(r.statusCode, 405);
});

test('login: invalid JSON body -> 400', async () => {
  const r = await H.call(login, { method: 'POST', body: '{not json' });
  assert.equal(r.statusCode, 400);
});

/* ------------------------------ sessions -------------------------------- */
test('session endpoint reflects cookie state; logout clears it', async () => {
  let r = await H.call(session, { method: 'GET' });
  assert.equal(r.json.authenticated, false);
  const cookie = await doLogin();
  r = await H.call(session, { method: 'GET', cookie });
  assert.equal(r.json.authenticated, true);
  const out = await H.call(logout, { method: 'POST', body: {}, cookie });
  assert.match(out.headers['set-cookie'], /Max-Age=0/);
});

test('session: tampered, expired and password-rotated tokens are rejected', () => {
  const cfg = require(path.join(API, '_lib/config.js')).getConfig();
  const { token } = auth.createSessionToken(cfg, Date.now());
  assert.ok(auth.verifySessionToken(token, cfg));
  const [body, sig] = token.split('.');
  const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, 'base64url')), exp: 9999999999 })).toString('base64url');
  assert.equal(auth.verifySessionToken(`${forged}.${sig}`, cfg), null);
  assert.equal(auth.verifySessionToken(token + 'x', cfg), null);
  assert.equal(auth.verifySessionToken('garbage', cfg), null);
  assert.equal(auth.verifySessionToken(token, cfg, Date.now() + 9 * 3600 * 1000), null, 'expires after 8h');
  assert.ok(auth.verifySessionToken(token, cfg, Date.now() + 7 * 3600 * 1000), 'valid at 7h');
  assert.equal(auth.verifySessionToken(token, { ...cfg, adminPassword: 'changed' }), null, 'password change invalidates');
  assert.equal(auth.verifySessionToken(token, { ...cfg, sessionSecret: 'y'.repeat(48) }), null, 'secret rotation invalidates');
});

/* ------------------------- content: authorisation ------------------------ */
test('content: GET/PUT/upload require a valid session (401)', async () => {
  assert.equal((await H.call(content, { method: 'GET', url: '/api/content' })).statusCode, 401);
  assert.equal((await H.call(content, { method: 'PUT', body: { file: 'services', data: { services: [] } } })).statusCode, 401);
  assert.equal((await H.call(upload, { method: 'POST', body: { data: 'AAAA' } })).statusCode, 401);
  assert.equal(gh.calls.length, 0, 'no GitHub request made for unauthenticated callers');
  assert.equal(gh.commits.length, 0);
});

test('content: forged cookie rejected', async () => {
  const r = await H.call(content, { method: 'GET', url: '/api/content', cookie: 'ajaz_admin_session=abc.def' });
  assert.equal(r.statusCode, 401);
});

test('content: PUT without CSRF header/origin rejected even with a valid cookie', async () => {
  const cookie = await doLogin();
  const r = await H.call(content, { method: 'PUT', cookie, csrf: false, body: { file: 'services', data: { services: [] } } });
  assert.equal(r.statusCode, 403);
  assert.equal(gh.commits.length, 0);
});

/* ---------------------------- content: reading --------------------------- */
test('content: GET returns all six files with shas, token never exposed', async () => {
  const cookie = await doLogin();
  const r = await H.call(content, { method: 'GET', url: '/api/content', cookie });
  assert.equal(r.statusCode, 200);
  assert.deepEqual(Object.keys(r.json.files).sort(), ['about', 'clients', 'experience', 'projects', 'services', 'testimonials']);
  assert.equal(r.json.files.projects.data.projects.length, 7);
  assert.match(r.json.files.projects.sha, /^[0-9a-f]{40}$/);
  assert.ok(!r._body.includes(H.ENV.GITHUB_TOKEN));
});

test('content: GET single file + unknown file', async () => {
  const cookie = await doLogin();
  const ok = await H.call(content, { method: 'GET', url: '/api/content?file=services', cookie });
  assert.deepEqual(Object.keys(ok.json.files), ['services']);
  const bad = await H.call(content, { method: 'GET', url: '/api/content?file=../../etc/passwd', cookie });
  assert.equal(bad.statusCode, 400);
});

test('content: missing file in repo -> empty collection (exists:false)', async () => {
  gh.files.delete('data/clients.json');
  const cookie = await doLogin();
  const r = await H.call(content, { method: 'GET', url: '/api/content?file=clients', cookie });
  assert.equal(r.json.files.clients.exists, false);
  assert.deepEqual(r.json.files.clients.data, { clients: [] });
});

test('content: invalid JSON in repo is reported per file, not silently replaced', async () => {
  gh.files.set('data/clients.json', Buffer.from('{oops'));
  const cookie = await doLogin();
  const r = await H.call(content, { method: 'GET', url: '/api/content', cookie });
  assert.equal(r.json.files.clients.ok, false);
  assert.equal(r.json.files.clients.error.code, 'invalid_json');
  assert.equal(r.json.files.projects.ok, true);
});

/* ---------------------------- content: writing --------------------------- */
async function loadFile(cookie, name) {
  const r = await H.call(content, { method: 'GET', url: `/api/content?file=${name}`, cookie });
  return r.json.files[name];
}

test('publish: adds a project, derives videoId/embedUrl server-side, commits with meaningful message', async () => {
  const cookie = await doLogin();
  const f = await loadFile(cookie, 'projects');
  const data = JSON.parse(JSON.stringify(f.data));
  data.projects.push({ title: 'New Reel', url: 'https://youtu.be/dQw4w9WgXcQ?si=abc', type: 'short', description: 'Cuts', thumbnail: '', videoId: 'HACKED00000', embedUrl: 'https://evil.example' });
  const r = await H.call(content, { method: 'PUT', cookie, body: { file: 'projects', data, baseSha: f.sha } });
  assert.equal(r.statusCode, 200, r._body);
  assert.equal(gh.commits.length, 1);
  assert.equal(gh.commits[0].path, 'data/projects.json');
  assert.match(gh.commits[0].message, /added "New Reel"/);
  const saved = gh.read('data/projects.json').projects;
  assert.equal(saved.length, 8);
  assert.equal(saved[7].videoId, 'dQw4w9WgXcQ');
  assert.equal(saved[7].embedUrl, 'https://www.youtube.com/embed/dQw4w9WgXcQ');
  assert.ok(saved[7].id.startsWith('p-'));
  assert.equal(r.json.commit.sha, gh.commits[0].sha);
  assert.ok(!r._body.includes(H.ENV.GITHUB_TOKEN));
});

test('publish: existing 7 projects preserved byte-for-byte in order after adding one', async () => {
  const cookie = await doLogin();
  const f = await loadFile(cookie, 'projects');
  const before = JSON.parse(JSON.stringify(f.data.projects));
  const data = { projects: [...before, { title: 'X', url: 'youtube.com/embed/aaaaaaaaaaa', type: 'long', description: '', thumbnail: '' }] };
  await H.call(content, { method: 'PUT', cookie, body: { file: 'projects', data, baseSha: f.sha } });
  assert.deepEqual(gh.read('data/projects.json').projects.slice(0, 7), before);
});

test('publish: edit + delete produce edit/remove commit message', async () => {
  const cookie = await doLogin();
  const f = await loadFile(cookie, 'services');
  const data = JSON.parse(JSON.stringify(f.data));
  data.services[0].title = 'Pro Video Editing';
  data.services.pop();
  const r = await H.call(content, { method: 'PUT', cookie, body: { file: 'services', data, baseSha: f.sha } });
  assert.equal(r.statusCode, 200);
  assert.match(gh.commits[0].message, /edited "Pro Video Editing"; removed "Short Form Editing"/);
  assert.equal(gh.read('data/services.json').services.length, 5);
});

test('publish: allows emptying a collection (empty content collections)', async () => {
  const cookie = await doLogin();
  const f = await loadFile(cookie, 'testimonials');
  const r = await H.call(content, { method: 'PUT', cookie, body: { file: 'testimonials', data: { testimonials: [] }, baseSha: f.sha } });
  assert.equal(r.statusCode, 200);
  assert.deepEqual(gh.read('data/testimonials.json'), { testimonials: [] });
});

test('publish: unchanged data makes no commit', async () => {
  const cookie = await doLogin();
  const f = await loadFile(cookie, 'services');
  const r = await H.call(content, { method: 'PUT', cookie, body: { file: 'services', data: f.data, baseSha: f.sha } });
  assert.equal(r.statusCode, 200);
  assert.equal(r.json.unchanged, true);
  assert.equal(gh.commits.length, 0);
});

test('publish: invalid data -> 400 with field errors, nothing committed', async () => {
  const cookie = await doLogin();
  const f = await loadFile(cookie, 'projects');
  const bad = { projects: [{ title: '', url: 'https://vimeo.com/123', type: 'medium', description: 'x', thumbnail: 'http://insecure.example/a.png' }] };
  const r = await H.call(content, { method: 'PUT', cookie, body: { file: 'projects', data: bad, baseSha: f.sha } });
  assert.equal(r.statusCode, 400);
  const paths = r.json.errors.map((e) => e.path).sort();
  assert.deepEqual(paths, ['projects[0].thumbnail', 'projects[0].title', 'projects[0].type', 'projects[0].url']);
  assert.equal(gh.commits.length, 0);
});

test('publish: unknown file, prototype keys and path traversal rejected', async () => {
  const cookie = await doLogin();
  for (const file of ['../../.env', 'package', '__proto__', 'constructor', 5, null]) {
    const r = await H.call(content, { method: 'PUT', cookie, body: { file, data: {} } });
    assert.equal(r.statusCode, 400, String(file));
  }
  assert.equal(gh.commits.length, 0);
});

test('publish: stale baseSha -> 409 conflict with currentSha; force overwrites', async () => {
  const cookie = await doLogin();
  const f = await loadFile(cookie, 'services');
  // someone else commits in the meantime
  const other = JSON.parse(JSON.stringify(f.data)); other.services[0].title = 'Changed elsewhere';
  gh.files.set('data/services.json', Buffer.from(JSON.stringify(other, null, 2) + '\n'));

  const mine = JSON.parse(JSON.stringify(f.data)); mine.services[1].title = 'Mine';
  const r = await H.call(content, { method: 'PUT', cookie, body: { file: 'services', data: mine, baseSha: f.sha } });
  assert.equal(r.statusCode, 409);
  assert.equal(r.json.error.code, 'conflict');
  assert.equal(r.json.currentSha, H.blobSha(gh.files.get('data/services.json')));
  assert.equal(gh.commits.length, 0);

  const forced = await H.call(content, { method: 'PUT', cookie, body: { file: 'services', data: mine, baseSha: r.json.currentSha, force: true } });
  assert.equal(forced.statusCode, 200);
  assert.equal(gh.read('data/services.json').services[1].title, 'Mine');
});

test('publish: race between our read and write (GitHub 409) is reported as conflict', async () => {
  const cookie = await doLogin();
  const f = await loadFile(cookie, 'services');
  const orig = global.fetch;
  global.fetch = async (url, init) => {
    if ((init && init.method) === 'PUT') { // simulate a push landing right before our PUT
      const other = JSON.parse(JSON.stringify(f.data)); other.services[0].title = 'sneaky';
      gh.files.set('data/services.json', Buffer.from(JSON.stringify(other)));
    }
    return orig(url, init);
  };
  const mine = JSON.parse(JSON.stringify(f.data)); mine.services[2].title = 'Mine';
  const r = await H.call(content, { method: 'PUT', cookie, body: { file: 'services', data: mine, baseSha: f.sha } });
  global.fetch = orig;
  assert.equal(r.statusCode, 409);
  assert.equal(r.json.error.code, 'conflict');
});

test('publish: about file validation (stats count, bad email, bad link)', async () => {
  const cookie = await doLogin();
  const f = await loadFile(cookie, 'about');
  const bad = JSON.parse(JSON.stringify(f.data));
  bad.stats.pop(); bad.contact.email = 'not-an-email'; bad.contact.instagram.url = 'javascript:alert(1)'; bad.hero.title = '';
  const r = await H.call(content, { method: 'PUT', cookie, body: { file: 'about', data: bad, baseSha: f.sha } });
  assert.equal(r.statusCode, 400);
  const paths = r.json.errors.map((e) => e.path);
  for (const p of ['stats', 'contact.email', 'contact.instagram.url', 'hero.title']) assert.ok(paths.includes(p), p);
});

test('publish: about edit commits and drops unknown keys', async () => {
  const cookie = await doLogin();
  const f = await loadFile(cookie, 'about');
  const next = JSON.parse(JSON.stringify(f.data));
  next.hero.title = 'SENIOR VIDEO EDITOR'; next.evil = '<script>';
  const r = await H.call(content, { method: 'PUT', cookie, body: { file: 'about', data: next, baseSha: f.sha } });
  assert.equal(r.statusCode, 200, r._body);
  const saved = gh.read('data/about.json');
  assert.equal(saved.hero.title, 'SENIOR VIDEO EDITOR');
  assert.equal(saved.evil, undefined);
  assert.match(gh.commits[0].message, /update about content \(hero\)/);
});

test('publish: creates file that does not exist yet (no sha)', async () => {
  gh.files.delete('data/clients.json');
  const cookie = await doLogin();
  const r = await H.call(content, { method: 'PUT', cookie, body: { file: 'clients', data: { clients: [{ name: 'Acme', info: 'Reels', logo: '', url: 'https://acme.example' }] }, baseSha: null } });
  assert.equal(r.statusCode, 200, r._body);
  assert.equal(gh.read('data/clients.json').clients[0].name, 'Acme');
});

test('publish: html/script text stays inert data (stored as text, never interpreted server-side)', async () => {
  const cookie = await doLogin();
  const f = await loadFile(cookie, 'testimonials');
  const data = { testimonials: [{ name: '<b>Eve</b>', role: '', text: '<img src=x onerror=alert(1)>' }] };
  const r = await H.call(content, { method: 'PUT', cookie, body: { file: 'testimonials', data, baseSha: f.sha } });
  assert.equal(r.statusCode, 200);
  assert.equal(gh.read('data/testimonials.json').testimonials[0].text, '<img src=x onerror=alert(1)>');
});

/* ------------------------- GitHub failure mapping ------------------------ */
test('github errors map to clear messages and never leak the token', async () => {
  const cookie = await doLogin();
  const cases = [[401, 'github_auth', 502], [403, 'github_forbidden', 502], [500, 'github_upstream', 502]];
  for (const [status, code, http] of cases) {
    gh.failWith = status;
    const r = await H.call(content, { method: 'GET', url: '/api/content', cookie });
    assert.equal(r.statusCode, http);
    assert.equal(r.json.error.code, code);
    assert.ok(!r._body.includes(H.ENV.GITHUB_TOKEN));
  }
  gh.failWith = 'network';
  const n = await H.call(content, { method: 'GET', url: '/api/content', cookie });
  assert.equal(n.json.error.code, 'github_network');
  gh.failWith = null;
  gh.token = 'different'; // token revoked
  const a = await H.call(content, { method: 'GET', url: '/api/content', cookie });
  assert.equal(a.json.error.code, 'github_auth');
});

test('github: wrong repo reported as repo_not_found', async () => {
  const cookie = await doLogin();
  gh.existsRepo = false;
  const r = await H.call(content, { method: 'GET', url: '/api/content', cookie });
  assert.equal(r.json.error.code, 'github_repo_not_found');
});

test('github: publish failure surfaces error and nothing is reported as success', async () => {
  const cookie = await doLogin();
  const f = await loadFile(cookie, 'services');
  const orig = global.fetch;
  global.fetch = async (url, init) => ((init && init.method) === 'PUT' ? { status: 500, ok: false, headers: { get: () => null }, json: async () => ({}) } : orig(url, init));
  const next = JSON.parse(JSON.stringify(f.data)); next.services[0].title = 'Z';
  const r = await H.call(content, { method: 'PUT', cookie, body: { file: 'services', data: next, baseSha: f.sha } });
  global.fetch = orig;
  assert.equal(r.statusCode, 502);
  assert.equal(r.json.ok, false);
});

/* -------------------------------- uploads -------------------------------- */
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40)]);

test('upload: accepts a real PNG and commits to assets/uploads with a server-chosen name', async () => {
  const cookie = await doLogin();
  const r = await H.call(upload, { method: 'POST', cookie, body: { data: PNG.toString('base64'), filename: '../../evil.php' } });
  assert.equal(r.statusCode, 200, r._body);
  assert.match(r.json.path, /^assets\/uploads\/\d{8}-[0-9a-f]{10}\.png$/);
  assert.ok(gh.files.has(r.json.path));
});

test('upload: rejects SVG/HTML/text, bad base64 and oversize', async () => {
  const cookie = await doLogin();
  for (const buf of [Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), Buffer.from('<html>'), Buffer.from('MZ\x90\x00')]) {
    const r = await H.call(upload, { method: 'POST', cookie, body: { data: buf.toString('base64') } });
    assert.equal(r.statusCode, 400);
  }
  assert.equal((await H.call(upload, { method: 'POST', cookie, body: { data: 'not base64!!' } })).statusCode, 400);
  const big = Buffer.concat([PNG, Buffer.alloc(3 * 1024 * 1024)]);
  assert.equal((await H.call(upload, { method: 'POST', cookie, body: { data: big.toString('base64') } })).statusCode, 413);
  assert.equal(gh.commits.length, 0);
});

/* ---------------- shipped data files must satisfy the validators ---------- */
test('shipped data/*.json files are valid and pass server validation unchanged', () => {
  const { FILES } = require(path.join(API, '_lib/validate.js'));
  for (const [name, def] of Object.entries(FILES)) {
    const raw = fs.readFileSync(path.join(H.ROOT, def.path), 'utf8');
    const parsed = JSON.parse(raw);
    const clean = def.validate(parsed);
    assert.deepEqual(clean, parsed, `${name}.json should already be in normalised form`);
  }
});
