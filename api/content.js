'use strict';
const { route, allowMethods } = require('./_lib/handler');
const { send, sendError, HttpError, readJsonBody, getQuery, assertSameOriginRequest } = require('./_lib/http');
const { getConfig } = require('./_lib/config');
const auth = require('./_lib/auth');
const github = require('./_lib/github');
const { FILES, serialise, describeChange } = require('./_lib/validate');

const FATAL_KINDS = new Set(['auth', 'forbidden', 'rate_limit', 'repo_not_found', 'network', 'upstream']);

function requireConfig() {
  const cfg = getConfig();
  if (cfg.problems.length) {
    console.error('[config]', cfg.problems.join('; '));
    throw new HttpError(503, 'not_configured', 'The server is not fully configured. Check the Vercel environment variables (see README).');
  }
  return cfg;
}

/** Load one content file straight from GitHub (always the latest committed version). */
async function loadFile(cfg, name) {
  const def = FILES[name];
  const file = await github.getFile(cfg, def.path);
  if (!file.exists) return { ok: true, exists: false, sha: null, data: def.empty };
  try {
    return { ok: true, exists: true, sha: file.sha, data: JSON.parse(file.text) };
  } catch (e) {
    return { ok: false, exists: true, sha: file.sha, error: { code: 'invalid_json', message: `${def.path} in the repository is not valid JSON.` } };
  }
}

async function handleGet(req, res, cfg) {
  const only = getQuery(req).get('file');
  if (only && !FILES[only]) throw new HttpError(400, 'bad_request', 'Unknown content file.');
  const names = only ? [only] : Object.keys(FILES);

  const settled = await Promise.allSettled(names.map((n) => loadFile(cfg, n)));
  const fatal = settled.find((s) => s.status === 'rejected' && s.reason instanceof github.GitHubError && FATAL_KINDS.has(s.reason.kind));
  if (fatal) throw fatal.reason;

  const files = {};
  settled.forEach((s, i) => {
    if (s.status === 'fulfilled') files[names[i]] = s.value;
    else {
      console.error('[content] load failed for', names[i], s.reason && s.reason.message);
      files[names[i]] = { ok: false, error: { code: 'load_failed', message: `Could not load ${FILES[names[i]].path}.` } };
    }
  });
  send(res, 200, { ok: true, files });
}

async function handlePut(req, res, cfg, session) {
  assertSameOriginRequest(req);
  const wait = auth.consumeWriteQuota(session.sid, 40, 10 * 60 * 1000);
  if (wait > 0) {
    res.setHeader('Retry-After', String(wait));
    throw new HttpError(429, 'rate_limited', 'Too many publish requests. Please wait a moment.');
  }

  const body = await readJsonBody(req);
  const name = body.file;
  if (typeof name !== 'string' || !Object.prototype.hasOwnProperty.call(FILES, name)) {
    throw new HttpError(400, 'bad_request', 'Unknown content file.');
  }
  const def = FILES[name];
  const clean = def.validate(body.data); // throws ValidationError -> 400

  const current = await github.getFile(cfg, def.path);
  const baseSha = typeof body.baseSha === 'string' ? body.baseSha : null;
  const force = body.force === true;

  if (current.exists && !force && baseSha !== current.sha) {
    return sendError(res, 409, 'conflict',
      'This content was changed on GitHub since you loaded it. Reload the latest version, or overwrite it with your changes.',
      { currentSha: current.sha });
  }

  let oldData = null;
  if (current.exists) {
    try { oldData = JSON.parse(current.text); } catch (e) { oldData = null; }
    if (oldData && JSON.stringify(oldData) === JSON.stringify(clean)) {
      return send(res, 200, { ok: true, unchanged: true, file: name, sha: current.sha, data: clean });
    }
  }

  const message = describeChange(name, oldData, clean);
  let result;
  try {
    result = await github.putFile(cfg, def.path, serialise(clean), { sha: current.exists ? current.sha : undefined, message });
  } catch (e) {
    if (e instanceof github.GitHubError && e.kind === 'conflict') {
      const latest = await github.getFile(cfg, def.path).catch(() => null);
      return sendError(res, 409, 'conflict',
        'This content was changed on GitHub while you were publishing. Reload the latest version, or overwrite it with your changes.',
        { currentSha: latest && latest.exists ? latest.sha : null });
    }
    throw e;
  }

  send(res, 200, {
    ok: true,
    file: name,
    sha: result.contentSha,
    commit: { sha: result.commitSha, url: result.commitUrl, message },
    data: clean
  });
}

module.exports = route(async (req, res) => {
  allowMethods(req, res, ['GET', 'PUT']);
  const cfg = requireConfig();
  const session = auth.requireAdmin(req, cfg);
  if (req.method === 'GET') return handleGet(req, res, cfg);
  return handlePut(req, res, cfg, session);
});
