'use strict';
/**
 * Stateless signed sessions + password checking + rate limiting.
 *
 * Session token = base64url(JSON payload) + "." + base64url(HMAC-SHA256(payload, SESSION_SECRET))
 * The payload also carries a fingerprint of ADMIN_PASSWORD, so changing the
 * password (or rotating SESSION_SECRET) immediately invalidates every session.
 */
const crypto = require('crypto');
const { parseCookies, serializeCookie, isSecureRequest, HttpError } = require('./http');

const COOKIE_NAME = 'ajaz_admin_session';
const SESSION_TTL_SECONDS = 8 * 60 * 60; // 8 hours, absolute

const b64u = (buf) => Buffer.from(buf).toString('base64url');

function hmac(secret, data) {
  return crypto.createHmac('sha256', secret).update(data).digest();
}

function passwordFingerprint(cfg) {
  return hmac(cfg.sessionSecret, 'pw:' + cfg.adminPassword).toString('hex').slice(0, 16);
}

function safeEqual(a, b) {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

/** Constant-time password comparison (hash both sides so lengths always match). */
function passwordMatches(input, expected) {
  const h = (s) => crypto.createHash('sha256').update(String(s), 'utf8').digest();
  return crypto.timingSafeEqual(h(input), h(expected));
}

function createSessionToken(cfg, nowMs) {
  const now = Math.floor((nowMs === undefined ? Date.now() : nowMs) / 1000);
  const payload = {
    v: 1,
    sid: crypto.randomBytes(12).toString('hex'),
    iat: now,
    exp: now + SESSION_TTL_SECONDS,
    pv: passwordFingerprint(cfg)
  };
  const body = b64u(JSON.stringify(payload));
  const sig = b64u(hmac(cfg.sessionSecret, body));
  return { token: `${body}.${sig}`, payload };
}

function verifySessionToken(token, cfg, nowMs) {
  if (typeof token !== 'string' || token.length > 1000) return null;
  const dot = token.indexOf('.');
  if (dot < 1 || token.indexOf('.', dot + 1) !== -1) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = b64u(hmac(cfg.sessionSecret, body));
  if (!safeEqual(sig, expected)) return null;

  let payload;
  try { payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch (e) { return null; }
  if (!payload || payload.v !== 1 || typeof payload.exp !== 'number' || typeof payload.sid !== 'string') return null;
  const now = Math.floor((nowMs === undefined ? Date.now() : nowMs) / 1000);
  if (payload.exp <= now) return null;
  if (typeof payload.pv !== 'string' || !safeEqual(payload.pv, passwordFingerprint(cfg))) return null;
  return payload;
}

function getSession(req, cfg) {
  const cookies = parseCookies(req.headers.cookie);
  return verifySessionToken(cookies[COOKIE_NAME], cfg);
}

function requireAdmin(req, cfg) {
  const session = getSession(req, cfg);
  if (!session) throw new HttpError(401, 'unauthorized', 'Your admin session has expired. Please log in again.');
  return session;
}

function sessionCookie(req, token) {
  return serializeCookie(COOKIE_NAME, token, { maxAge: SESSION_TTL_SECONDS, secure: isSecureRequest(req) });
}
function clearedCookie(req) {
  return serializeCookie(COOKIE_NAME, '', { maxAge: 0, secure: isSecureRequest(req) });
}

/* ---------------------------------------------------------------------------
 * Rate limiting (in-memory, per serverless instance — best effort, see README)
 * ------------------------------------------------------------------------- */
const LOGIN_MAX_FAILURES = 5;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const GLOBAL_MAX_FAILURES = 40;

const failures = new Map(); // key -> { count, resetAt }

function prune(now) {
  if (failures.size < 500) return;
  for (const [k, v] of failures) if (v.resetAt <= now) failures.delete(k);
}

function bucket(key, now) {
  let b = failures.get(key);
  if (!b || b.resetAt <= now) { b = { count: 0, resetAt: now + LOGIN_WINDOW_MS }; failures.set(key, b); }
  return b;
}

function loginBlockedFor(ip, now) {
  const t = now === undefined ? Date.now() : now;
  for (const [key, max] of [['ip:' + ip, LOGIN_MAX_FAILURES], ['global', GLOBAL_MAX_FAILURES]]) {
    const b = failures.get(key);
    if (b && b.resetAt > t && b.count >= max) return Math.ceil((b.resetAt - t) / 1000);
  }
  return 0;
}
function recordLoginFailure(ip, now) {
  const t = now === undefined ? Date.now() : now;
  prune(t);
  bucket('ip:' + ip, t).count++;
  bucket('global', t).count++;
}
function resetLoginFailures(ip) { failures.delete('ip:' + ip); }
function _resetAllForTests() { failures.clear(); writes.clear(); }

const writes = new Map(); // sid -> number[] timestamps
function consumeWriteQuota(sid, limit, windowMs, now) {
  const t = now === undefined ? Date.now() : now;
  const list = (writes.get(sid) || []).filter((x) => x > t - windowMs);
  if (list.length >= limit) {
    writes.set(sid, list);
    return Math.ceil((list[0] + windowMs - t) / 1000);
  }
  list.push(t);
  writes.set(sid, list);
  if (writes.size > 500) for (const [k, v] of writes) if (!v.some((x) => x > t - windowMs)) writes.delete(k);
  return 0;
}

module.exports = {
  COOKIE_NAME, SESSION_TTL_SECONDS,
  passwordMatches, createSessionToken, verifySessionToken, getSession, requireAdmin,
  sessionCookie, clearedCookie,
  loginBlockedFor, recordLoginFailure, resetLoginFailures, consumeWriteQuota, _resetAllForTests
};
