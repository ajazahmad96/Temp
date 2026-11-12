'use strict';
/**
 * Reads and validates server configuration from Vercel Environment Variables.
 * Values are never returned to the browser and never logged.
 */

const REQUIRED = ['ADMIN_PASSWORD', 'SESSION_SECRET', 'GITHUB_TOKEN', 'GITHUB_OWNER', 'GITHUB_REPO'];

function getConfig() {
  const env = process.env;
  const problems = [];

  for (const name of REQUIRED) {
    if (!env[name] || !String(env[name]).trim()) problems.push(`${name} is not set`);
  }

  const owner = String(env.GITHUB_OWNER || '').trim();
  const repo = String(env.GITHUB_REPO || '').trim();
  const branch = String(env.GITHUB_BRANCH || 'main').trim() || 'main';
  const secret = String(env.SESSION_SECRET || '');

  if (owner && !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(owner)) problems.push('GITHUB_OWNER looks invalid');
  if (repo && !/^[A-Za-z0-9._-]{1,100}$/.test(repo)) problems.push('GITHUB_REPO looks invalid');
  if (!/^[A-Za-z0-9._\/-]{1,100}$/.test(branch) || branch.includes('..')) problems.push('GITHUB_BRANCH looks invalid');
  if (secret && secret.length < 32) problems.push('SESSION_SECRET must be at least 32 characters');

  return {
    problems,
    adminPassword: String(env.ADMIN_PASSWORD || ''),
    sessionSecret: secret,
    githubToken: String(env.GITHUB_TOKEN || '').trim(),
    owner,
    repo,
    branch
  };
}

module.exports = { getConfig, REQUIRED };
