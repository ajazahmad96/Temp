'use strict';
/** Static project checks (no dependencies):  node tests/check-project.js */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
let failures = 0;
const ok = (m) => console.log('  ok   ' + m);
const bad = (m) => { failures++; console.log('  FAIL ' + m); };
const rel = (p) => path.relative(ROOT, p);
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['.git', 'node_modules', '.vercel'].includes(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out); else out.push(full);
  }
  return out;
}
const all = walk(ROOT, []);

// 1. required files
for (const f of ['index.html', 'css/styles.css', 'css/admin.css', 'js/main.js', 'js/render.js', 'js/shared.js', 'js/admin.js', 'vercel.json', 'package.json', 'README.md', '.env.example', '.gitignore',
  'data/projects.json', 'data/about.json', 'data/experience.json', 'data/clients.json', 'data/services.json', 'data/testimonials.json',
  'api/login.js', 'api/logout.js', 'api/session.js', 'api/content.js', 'api/upload.js']) {
  fs.existsSync(path.join(ROOT, f)) ? ok('exists: ' + f) : bad('missing: ' + f);
}

// 2. JavaScript syntax
for (const f of all.filter((p) => p.endsWith('.js'))) {
  try { execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' }); ok('JS syntax: ' + rel(f)); } catch (e) { bad('JS syntax error in ' + rel(f) + '\n' + e.stderr.toString().split('\n').slice(0, 4).join('\n')); }
}

// 3. JSON validity
for (const f of all.filter((p) => p.endsWith('.json'))) {
  try { JSON.parse(fs.readFileSync(f, 'utf8')); ok('JSON valid: ' + rel(f)); } catch (e) { bad('Invalid JSON ' + rel(f) + ': ' + e.message); }
}

// 4. HTML: references, tag balance, ids
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
for (const f of all.filter((p) => p.endsWith('.html'))) {
  const html = fs.readFileSync(f, 'utf8');
  const stripped = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<script[\s\S]*?<\/script>/gi, '<script></script>').replace(/<style[\s\S]*?<\/style>/gi, '<style></style>');
  const stack = [];
  let problem = '';
  const re = /<\/?([a-zA-Z][a-zA-Z0-9-]*)\b[^>]*?(\/?)>/g;
  let m;
  while ((m = re.exec(stripped))) {
    const tag = m[1].toLowerCase();
    if (VOID.has(tag) || m[2] === '/') continue;
    if (m[0][1] === '/') {
      const top = stack.pop();
      if (top !== tag) { problem = `closing </${tag}> but expected </${top}> near "${stripped.slice(Math.max(0, m.index - 40), m.index + 20).replace(/\s+/g, ' ')}"`; break; }
    } else stack.push(tag);
  }
  if (!problem && stack.length) problem = 'unclosed: ' + stack.slice(-3).join(', ');
  problem ? bad(`HTML structure ${rel(f)}: ${problem}`) : ok(`HTML tags balanced: ${rel(f)}`);

  const ids = new Set(); const dup = new Set();
  for (const x of html.matchAll(/\sid="([^"]+)"/g)) { if (ids.has(x[1])) dup.add(x[1]); ids.add(x[1]); }
  dup.size ? bad('duplicate ids: ' + [...dup].join(', ')) : ok('no duplicate ids');

  if (path.basename(f) === 'index.html') {
    for (const x of html.matchAll(/(?:src|href)="([^"#:]+?)(?:\?[^"]*)?"/g)) {
      const t = x[1];
      if (/^(https?:|mailto:|javascript:|\/\/)/.test(t)) continue;
      const file = path.join(ROOT, t.replace(/^\//, ''));
      fs.existsSync(file) ? ok('reference resolves: ' + t) : bad('broken reference in index.html: ' + t);
    }
    // every getElementById() used by the site scripts exists in index.html (admin-created ones excluded)
    const used = new Set();
    for (const js of ['js/main.js', 'js/render.js']) for (const x of read(js).matchAll(/getElementById\('([^']+)'\)|\$\('([^']+)'\)|setText\('([^']+)'/g)) used.add(x[1] || x[2] || x[3]);
    const missing = [...used].filter((id) => !ids.has(id));
    missing.length ? bad('ids used by scripts but not in index.html: ' + missing.join(', ')) : ok(`all ${used.size} element ids used by scripts exist in index.html`);
  }
}

// 5. CSS: balanced braces + url() references
for (const f of all.filter((p) => p.endsWith('.css'))) {
  const css = fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const open = (css.match(/\{/g) || []).length, close = (css.match(/\}/g) || []).length;
  open === close ? ok(`CSS braces balanced: ${rel(f)} (${open} blocks)`) : bad(`CSS braces unbalanced in ${rel(f)}: ${open} vs ${close}`);
  for (const x of css.matchAll(/url\(([^)]+)\)/g)) {
    const u = x[1].replace(/['"]/g, '');
    if (/^(https?:|data:)/.test(u)) continue;
    fs.existsSync(path.resolve(path.dirname(f), u)) ? ok('CSS url resolves: ' + u) : bad('broken CSS url(): ' + u);
  }
}

// 6. security hygiene
const textFiles = all.filter((p) => /\.(js|json|html|css|md|example)$/.test(p) || p.endsWith('.gitignore'));
const secretPatterns = [/ghp_[A-Za-z0-9]{20,}/, /github_pat_[A-Za-z0-9_]{20,}/, /gh[ousr]_[A-Za-z0-9]{30,}/, /-----BEGIN [A-Z ]*PRIVATE KEY-----/];
let leaked = 0;
for (const f of textFiles) for (const p of secretPatterns) if (p.test(fs.readFileSync(f, 'utf8'))) { bad('possible secret in ' + rel(f)); leaked++; }
if (!leaked) ok('no GitHub tokens / private keys in any file');
const envFiles = all.filter((p) => /(^|\/)\.env(\.|$)/.test(rel(p)) && !rel(p).endsWith('.env.example'));
envFiles.length ? bad('.env file present: ' + envFiles.map(rel)) : ok('no .env files included');
for (const f of ['index.html', 'js/main.js', 'js/render.js', 'js/shared.js', 'js/admin.js']) {
  const src = read(f);
  if (/process\.env|ADMIN_PASSWORD|SESSION_SECRET|GITHUB_TOKEN/.test(src)) bad('secret variable name referenced in frontend file ' + f); else ok('no server secrets referenced in ' + f);
  // main.js keeps three original player-icon swaps built from hardcoded constants (vcPlay/vcMute/vcFull); nothing else may use innerHTML
  const isAllowedLine = (l) => f === 'js/main.js' && /^\s*(vcPlay|vcMute|vcFull)\.innerHTML = '<i class=/.test(l);
  const allowed = src.split('\n').filter(isAllowedLine).length;
  const checked = src.split('\n').filter((l) => !isAllowedLine(l)).join('\n');
  if (/\.innerHTML\s*=|insertAdjacentHTML|document\.write|eval\(/.test(checked)) bad('unsafe DOM API in ' + f); else ok('no unsafe innerHTML/eval in ' + f + (allowed ? ` (${allowed} constant icon swaps allowed)` : ''));
}
const html = read('index.html');
/localStorage|sessionStorage/.test(read('js/admin.js')) ? bad('admin.js stores data in browser storage') : ok('admin.js does not use localStorage/sessionStorage (session is an HttpOnly cookie)');

console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll static checks passed');
process.exit(failures ? 1 : 0);
