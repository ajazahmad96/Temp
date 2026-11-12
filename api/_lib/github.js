'use strict';
/**
 * Minimal GitHub REST client (Contents API). The token only ever lives in this
 * server-side module; it is never returned to the browser.
 */
const API = 'https://api.github.com';
const TIMEOUT_MS = 9000;

class GitHubError extends Error {
  /** kind: auth | forbidden | rate_limit | repo_not_found | conflict | invalid | upstream | network */
  constructor(kind, message, status) {
    super(message);
    this.kind = kind;
    this.status = status;
  }
}

function headers(cfg, extra) {
  return Object.assign({
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${cfg.githubToken}`,
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'ajaz-edits-admin'
  }, extra || {});
}

async function ghFetch(cfg, url, init) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, Object.assign({ cache: 'no-store', signal: ctrl.signal }, init, { headers: headers(cfg, init && init.headers) }));
  } catch (e) {
    const msg = e && e.name === 'AbortError' ? 'GitHub did not respond in time.' : 'Could not reach GitHub.';
    throw new GitHubError('network', msg, 0);
  } finally {
    clearTimeout(timer);
  }
}

async function readJson(res) {
  try { return await res.json(); } catch (e) { return {}; }
}

function mapError(res, body) {
  const status = res.status;
  const apiMsg = body && typeof body.message === 'string' ? body.message : '';
  if (status === 401) return new GitHubError('auth', 'GitHub rejected the access token. It may be invalid or expired.', status);
  if (status === 403) {
    const remaining = res.headers && res.headers.get && res.headers.get('x-ratelimit-remaining');
    if (remaining === '0' || /rate limit/i.test(apiMsg)) {
      return new GitHubError('rate_limit', 'GitHub rate limit reached. Try again in a few minutes.', status);
    }
    return new GitHubError('forbidden', 'The GitHub token does not have permission. It needs "Contents: Read and write" on this repository.', status);
  }
  if (status === 409) return new GitHubError('conflict', 'The file was changed on GitHub by someone else.', status);
  if (status === 422) {
    if (/sha|does not match|is at/i.test(apiMsg)) return new GitHubError('conflict', 'The file was changed on GitHub by someone else.', status);
    return new GitHubError('invalid', 'GitHub rejected the update.', status);
  }
  if (status >= 500) return new GitHubError('upstream', 'GitHub is having problems right now. Try again shortly.', status);
  return new GitHubError('upstream', `Unexpected response from GitHub (${status}).`, status);
}

function repoBase(cfg) {
  return `${API}/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}`;
}
function contentsUrl(cfg, path) {
  return `${repoBase(cfg)}/contents/${path.split('/').map(encodeURIComponent).join('/')}`;
}

/** Returns { exists:false } or { exists:true, sha, text }. */
async function getFile(cfg, path) {
  const res = await ghFetch(cfg, `${contentsUrl(cfg, path)}?ref=${encodeURIComponent(cfg.branch)}`);
  if (res.status === 404) {
    // Distinguish "file not created yet" from "repo/branch not visible to this token"
    const repoRes = await ghFetch(cfg, repoBase(cfg));
    if (repoRes.status === 404) throw new GitHubError('repo_not_found', 'GitHub repository not found. Check GITHUB_OWNER / GITHUB_REPO and that the token can access it.', 404);
    if (repoRes.status === 401) throw mapError(repoRes, await readJson(repoRes));
    const branchRes = await ghFetch(cfg, `${repoBase(cfg)}/branches/${encodeURIComponent(cfg.branch)}`);
    if (branchRes.status === 404) throw new GitHubError('repo_not_found', `Branch "${cfg.branch}" was not found. Check GITHUB_BRANCH.`, 404);
    return { exists: false };
  }
  const body = await readJson(res);
  if (!res.ok) throw mapError(res, body);
  if (Array.isArray(body) || body.type !== 'file') throw new GitHubError('invalid', `${path} is not a file in the repository.`, 422);

  let b64 = body.content;
  if (!b64 || body.encoding !== 'base64') {
    const blobRes = await ghFetch(cfg, `${repoBase(cfg)}/git/blobs/${encodeURIComponent(body.sha)}`);
    const blob = await readJson(blobRes);
    if (!blobRes.ok) throw mapError(blobRes, blob);
    b64 = blob.content;
  }
  return { exists: true, sha: body.sha, text: Buffer.from(String(b64 || '').replace(/\n/g, ''), 'base64').toString('utf8') };
}

/** Creates or updates a file with a commit. Returns { commitSha, commitUrl, contentSha }. */
async function putFile(cfg, path, content, opts) {
  const buf = Buffer.isBuffer(content) ? content : Buffer.from(String(content), 'utf8');
  const payload = { message: opts.message, content: buf.toString('base64'), branch: cfg.branch };
  if (opts.sha) payload.sha = opts.sha;
  const res = await ghFetch(cfg, contentsUrl(cfg, path), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const body = await readJson(res);
  if (!res.ok) throw mapError(res, body);
  return {
    commitSha: body.commit && body.commit.sha,
    commitUrl: body.commit && body.commit.html_url,
    contentSha: body.content && body.content.sha
  };
}

module.exports = { GitHubError, getFile, putFile };
