'use strict';
/** Small HTTP helpers shared by all API routes (plain Node req/res, no framework). */

const MAX_BODY_BYTES = 4 * 1024 * 1024; // Vercel's own limit is 4.5 MB

function applyApiHeaders(res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
}

function send(res, status, body) {
  res.statusCode = status;
  res.end(JSON.stringify(body));
}

function sendError(res, status, code, message, extra) {
  send(res, status, Object.assign({ ok: false, error: { code, message } }, extra || {}));
}

class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function readJsonBody(req) {
  let raw;
  try {
    if (req.body !== undefined && req.body !== null) {
      if (Buffer.isBuffer(req.body)) raw = req.body.toString('utf8');
      else if (typeof req.body === 'string') raw = req.body;
      else if (typeof req.body === 'object') return req.body;
    }
  } catch (e) {
    // Vercel throws from the body getter on malformed JSON
    throw new HttpError(400, 'invalid_json', 'The request body is not valid JSON.');
  }

  if (raw === undefined) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) throw new HttpError(413, 'too_large', 'The request is too large.');
      chunks.push(chunk);
    }
    raw = Buffer.concat(chunks).toString('utf8');
  }
  if (Buffer.byteLength(raw) > MAX_BODY_BYTES) throw new HttpError(413, 'too_large', 'The request is too large.');
  if (!raw.trim()) throw new HttpError(400, 'invalid_json', 'The request body is empty.');
  try {
    const parsed = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('not an object');
    }
    return parsed;
  } catch (e) {
    throw new HttpError(400, 'invalid_json', 'The request body is not valid JSON.');
  }
}

function getQuery(req) {
  try {
    return new URL(req.url, 'http://localhost').searchParams;
  } catch (e) {
    return new URLSearchParams();
  }
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  String(header).split(';').forEach((part) => {
    const i = part.indexOf('=');
    if (i < 0) return;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k && !(k in out)) out[k] = v;
  });
  return out;
}

function isSecureRequest(req) {
  const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
  if (proto === 'https') return true;
  const env = process.env.VERCEL_ENV;
  return env === 'production' || env === 'preview';
}

function serializeCookie(name, value, opts) {
  const o = opts || {};
  const parts = [`${name}=${value}`, 'Path=/', 'HttpOnly', 'SameSite=Strict'];
  if (typeof o.maxAge === 'number') parts.push(`Max-Age=${Math.max(0, Math.floor(o.maxAge))}`);
  if (o.secure) parts.push('Secure');
  return parts.join('; ');
}

function clientIp(req) {
  const xff = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return xff || (req.socket && req.socket.remoteAddress) || 'unknown';
}

/**
 * CSRF defence for state-changing requests (in addition to SameSite=Strict cookies):
 *  - a custom header that cross-site forms cannot set, and
 *  - an Origin (or Sec-Fetch-Site) that proves the request came from this site.
 */
function assertSameOriginRequest(req) {
  if (req.headers['x-requested-with'] !== 'ajaz-admin') {
    throw new HttpError(403, 'csrf', 'Missing or invalid request header.');
  }
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  const origin = req.headers.origin;
  if (origin) {
    let originHost = '';
    try { originHost = new URL(origin).host; } catch (e) { /* fall through */ }
    if (!originHost || originHost !== host) throw new HttpError(403, 'csrf', 'Cross-site requests are not allowed.');
    return;
  }
  if (req.headers['sec-fetch-site'] !== 'same-origin') {
    throw new HttpError(403, 'csrf', 'Cross-site requests are not allowed.');
  }
}

module.exports = {
  applyApiHeaders, send, sendError, HttpError, readJsonBody, getQuery,
  parseCookies, serializeCookie, isSecureRequest, clientIp, assertSameOriginRequest
};
