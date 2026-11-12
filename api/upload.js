'use strict';
const crypto = require('crypto');
const { route, allowMethods } = require('./_lib/handler');
const { send, HttpError, readJsonBody, assertSameOriginRequest } = require('./_lib/http');
const { getConfig } = require('./_lib/config');
const auth = require('./_lib/auth');
const github = require('./_lib/github');

const MAX_BYTES = 2.5 * 1024 * 1024;

/** Identify the image type from its first bytes (never trust the client's claim). */
function sniffImage(buf) {
  if (buf.length >= 8 && buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length >= 6 && /^GIF8[79]a$/.test(buf.slice(0, 6).toString('latin1'))) return 'gif';
  if (buf.length >= 12 && buf.slice(0, 4).toString('latin1') === 'RIFF' && buf.slice(8, 12).toString('latin1') === 'WEBP') return 'webp';
  return null;
}

module.exports = route(async (req, res) => {
  allowMethods(req, res, ['POST']);
  assertSameOriginRequest(req);

  const cfg = getConfig();
  if (cfg.problems.length) {
    console.error('[config]', cfg.problems.join('; '));
    throw new HttpError(503, 'not_configured', 'The server is not fully configured. Check the Vercel environment variables (see README).');
  }
  const session = auth.requireAdmin(req, cfg);
  const wait = auth.consumeWriteQuota(session.sid, 40, 10 * 60 * 1000);
  if (wait > 0) {
    res.setHeader('Retry-After', String(wait));
    throw new HttpError(429, 'rate_limited', 'Too many requests. Please wait a moment.');
  }

  const body = await readJsonBody(req);
  if (typeof body.data !== 'string' || !body.data || !/^[A-Za-z0-9+/]+={0,2}$/.test(body.data)) {
    throw new HttpError(400, 'bad_request', 'No valid image data was sent.');
  }
  const buf = Buffer.from(body.data, 'base64');
  if (buf.length > MAX_BYTES) throw new HttpError(413, 'too_large', 'That image is too large (max 2.5 MB).');
  const ext = sniffImage(buf);
  if (!ext) throw new HttpError(400, 'bad_image', 'Only PNG, JPEG, WebP or GIF images are allowed.');

  const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const path = `assets/uploads/${day}-${crypto.randomBytes(5).toString('hex')}.${ext}`;
  const result = await github.putFile(cfg, path, buf, { message: 'Admin: upload image' });
  send(res, 200, { ok: true, path, commit: { sha: result.commitSha, url: result.commitUrl } });
});
