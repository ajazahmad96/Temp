'use strict';
/** Wraps a route so every error becomes a consistent JSON response (never a stack trace). */
const { applyApiHeaders, sendError, HttpError } = require('./http');
const { GitHubError } = require('./github');
const { ValidationError } = require('./validate');

const GH_STATUS = { auth: 502, forbidden: 502, rate_limit: 503, repo_not_found: 502, conflict: 409, invalid: 502, upstream: 502, network: 502 };

function route(fn) {
  return async function handler(req, res) {
    applyApiHeaders(res);
    try {
      await fn(req, res);
    } catch (err) {
      if (err instanceof HttpError) return sendError(res, err.status, err.code, err.message);
      if (err instanceof ValidationError) {
        return sendError(res, 400, 'validation', 'Some fields are missing or invalid.', { errors: err.errors });
      }
      if (err instanceof GitHubError) {
        console.error('[github]', err.kind, err.status, err.message);
        return sendError(res, GH_STATUS[err.kind] || 502, 'github_' + err.kind, err.message);
      }
      console.error('[api] unexpected error:', err && err.message);
      return sendError(res, 500, 'internal', 'Something went wrong on the server.');
    }
  };
}

function allowMethods(req, res, methods) {
  if (methods.includes(req.method)) return;
  res.setHeader('Allow', methods.join(', '));
  throw new HttpError(405, 'method_not_allowed', 'Method not allowed.');
}

module.exports = { route, allowMethods };
