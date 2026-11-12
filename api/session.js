'use strict';
const { route, allowMethods } = require('./_lib/handler');
const { send } = require('./_lib/http');
const { getConfig } = require('./_lib/config');
const auth = require('./_lib/auth');

module.exports = route(async (req, res) => {
  allowMethods(req, res, ['GET']);
  const cfg = getConfig();
  const session = cfg.problems.length ? null : auth.getSession(req, cfg);
  if (!session) return send(res, 200, { ok: true, authenticated: false });
  send(res, 200, { ok: true, authenticated: true, expiresAt: session.exp * 1000 });
});
