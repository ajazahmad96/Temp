'use strict';
const { route, allowMethods } = require('./_lib/handler');
const { send, HttpError, readJsonBody, assertSameOriginRequest, clientIp } = require('./_lib/http');
const { getConfig } = require('./_lib/config');
const auth = require('./_lib/auth');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = route(async (req, res) => {
  allowMethods(req, res, ['POST']);
  assertSameOriginRequest(req);

  const cfg = getConfig();
  if (cfg.problems.length) {
    console.error('[config]', cfg.problems.join('; '));
    throw new HttpError(503, 'not_configured', 'The server is not fully configured. Check the Vercel environment variables (see README).');
  }

  const ip = clientIp(req);
  const wait = auth.loginBlockedFor(ip);
  if (wait > 0) {
    res.setHeader('Retry-After', String(wait));
    throw new HttpError(429, 'rate_limited', `Too many failed attempts. Try again in ${Math.ceil(wait / 60)} minute(s).`);
  }

  const body = await readJsonBody(req);
  const password = body.password;
  if (typeof password !== 'string' || !password || password.length > 200) {
    throw new HttpError(400, 'bad_request', 'Enter your password.');
  }

  if (!auth.passwordMatches(password, cfg.adminPassword)) {
    auth.recordLoginFailure(ip);
    await sleep(500); // slows down online guessing
    throw new HttpError(401, 'invalid_credentials', 'Incorrect password.');
  }

  auth.resetLoginFailures(ip);
  const { token, payload } = auth.createSessionToken(cfg);
  res.setHeader('Set-Cookie', auth.sessionCookie(req, token));
  send(res, 200, { ok: true, expiresAt: payload.exp * 1000 });
});
