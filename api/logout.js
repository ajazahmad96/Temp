'use strict';
const { route, allowMethods } = require('./_lib/handler');
const { send, assertSameOriginRequest } = require('./_lib/http');
const auth = require('./_lib/auth');

module.exports = route(async (req, res) => {
  allowMethods(req, res, ['POST']);
  assertSameOriginRequest(req);
  res.setHeader('Set-Cookie', auth.clearedCookie(req));
  send(res, 200, { ok: true });
});
