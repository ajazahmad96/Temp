'use strict';
/**
 * Server-side validation + normalisation of every content file.
 * Output objects are rebuilt field by field, so unknown/extra keys from the
 * client are dropped and key order is always stable (clean Git diffs).
 */
const crypto = require('crypto');
const shared = require('../../js/shared.js');

const LIMITS = { projects: 200, services: 24, testimonials: 50, experience: 50, clients: 100 };

class ValidationError extends Error {
  constructor(errors) { super('Validation failed'); this.errors = errors; }
}

function isObj(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }

/* eslint-disable no-control-regex */
function clean(v, multiline) {
  let s = String(v).replace(/\r\n?/g, '\n');
  s = multiline ? s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '') : s.replace(/[\u0000-\u001F\u007F]/g, ' ');
  return s.trim();
}

function makeCtx() {
  const errors = [];
  return {
    errors,
    err: (path, message) => errors.push({ path, message }),
    /** read a string field */
    str(obj, key, path, o) {
      const opts = o || {};
      const v = obj[key];
      const p = `${path}.${key}`;
      if (v === undefined || v === null) {
        if (opts.required) this.err(p, `${opts.label || key} is required.`);
        return '';
      }
      if (typeof v !== 'string') { this.err(p, `${opts.label || key} must be text.`); return ''; }
      const s = clean(v, opts.multiline);
      if (opts.required && !s) this.err(p, `${opts.label || key} is required.`);
      if (s.length > (opts.max || 200)) this.err(p, `${opts.label || key} must be at most ${opts.max || 200} characters.`);
      return s;
    },
    obj(parent, key, path) {
      const v = parent[key];
      if (!isObj(v)) { this.err(`${path}.${key}`, `${key} section is missing.`); return {}; }
      return v;
    }
  };
}

function normaliseId(raw, prefix, seen) {
  let id = typeof raw === 'string' && /^[A-Za-z0-9_-]{1,60}$/.test(raw) ? raw : '';
  if (!id || seen.has(id)) {
    do { id = `${prefix}-${crypto.randomBytes(4).toString('hex')}`; } while (seen.has(id));
  }
  seen.add(id);
  return id;
}

function collection(ctx, data, key, max) {
  if (!isObj(data) || !Array.isArray(data[key])) {
    ctx.err(key, `Expected an object with a "${key}" list.`);
    return [];
  }
  if (data[key].length > max) ctx.err(key, `Too many items (maximum ${max}).`);
  return data[key].slice(0, max);
}

function imageField(ctx, item, key, path, label) {
  const v = item[key] === undefined || item[key] === null ? '' : item[key];
  if (typeof v !== 'string') { ctx.err(`${path}.${key}`, `${label} must be text.`); return ''; }
  const s = v.trim();
  if (!shared.isValidImageRef(s)) {
    ctx.err(`${path}.${key}`, `${label} must be empty, an https:// link, or an image uploaded through the admin panel.`);
    return '';
  }
  return s;
}

/* ------------------------------ projects --------------------------------- */
function validateProjects(data) {
  const ctx = makeCtx();
  const seen = new Set();
  const out = collection(ctx, data, 'projects', LIMITS.projects).map((item, i) => {
    const path = `projects[${i}]`;
    if (!isObj(item)) { ctx.err(path, 'Invalid project.'); return null; }
    const title = ctx.str(item, 'title', path, { required: true, max: 100, label: 'Project title' });
    const description = ctx.str(item, 'description', path, { max: 300, multiline: true, label: 'Description' });
    const url = ctx.str(item, 'url', path, { required: true, max: 300, label: 'YouTube URL' });
    let videoId = '';
    let embedUrl = '';
    if (url) {
      const parsed = shared.parseYouTubeUrl(url);
      if (!parsed.ok) ctx.err(`${path}.url`, parsed.error);
      else { videoId = parsed.videoId; embedUrl = parsed.embedUrl; }
    }
    const type = item.type;
    if (type !== 'short' && type !== 'long') ctx.err(`${path}.type`, 'Video type must be Short Form or Long Form.');
    const thumbnail = imageField(ctx, item, 'thumbnail', path, 'Thumbnail');
    return { id: normaliseId(item.id, 'p', seen), title, url, videoId, embedUrl, type: type === 'long' ? 'long' : 'short', description, thumbnail };
  }).filter(Boolean);
  return finish(ctx, { projects: out });
}

/* ------------------------------- services -------------------------------- */
function validateServices(data) {
  const ctx = makeCtx();
  const seen = new Set();
  const out = collection(ctx, data, 'services', LIMITS.services).map((item, i) => {
    const path = `services[${i}]`;
    if (!isObj(item)) { ctx.err(path, 'Invalid service.'); return null; }
    const title = ctx.str(item, 'title', path, { required: true, max: 60, label: 'Service title' });
    const description = ctx.str(item, 'description', path, { max: 200, multiline: true, label: 'Description' });
    const icon = typeof item.icon === 'string' ? item.icon.trim() : '';
    if (!shared.isValidIcon(icon)) ctx.err(`${path}.icon`, 'Choose a valid icon.');
    return { id: normaliseId(item.id, 's', seen), icon, title, description };
  }).filter(Boolean);
  return finish(ctx, { services: out });
}

/* ----------------------------- testimonials ------------------------------ */
function validateTestimonials(data) {
  const ctx = makeCtx();
  const seen = new Set();
  const out = collection(ctx, data, 'testimonials', LIMITS.testimonials).map((item, i) => {
    const path = `testimonials[${i}]`;
    if (!isObj(item)) { ctx.err(path, 'Invalid testimonial.'); return null; }
    return {
      id: normaliseId(item.id, 't', seen),
      name: ctx.str(item, 'name', path, { required: true, max: 80, label: 'Client name' }),
      role: ctx.str(item, 'role', path, { max: 80, label: 'Role' }),
      text: ctx.str(item, 'text', path, { required: true, max: 600, multiline: true, label: 'Testimonial' })
    };
  }).filter(Boolean);
  return finish(ctx, { testimonials: out });
}

/* ------------------------------ experience ------------------------------- */
function validateExperience(data) {
  const ctx = makeCtx();
  const seen = new Set();
  const out = collection(ctx, data, 'experience', LIMITS.experience).map((item, i) => {
    const path = `experience[${i}]`;
    if (!isObj(item)) { ctx.err(path, 'Invalid experience entry.'); return null; }
    return {
      id: normaliseId(item.id, 'e', seen),
      role: ctx.str(item, 'role', path, { required: true, max: 100, label: 'Role' }),
      company: ctx.str(item, 'company', path, { max: 100, label: 'Company' }),
      start: ctx.str(item, 'start', path, { required: true, max: 30, label: 'Start date' }),
      end: ctx.str(item, 'end', path, { max: 30, label: 'End date' }),
      description: ctx.str(item, 'description', path, { max: 600, multiline: true, label: 'Description' })
    };
  }).filter(Boolean);
  return finish(ctx, { experience: out });
}

/* -------------------------------- clients -------------------------------- */
function validateClients(data) {
  const ctx = makeCtx();
  const seen = new Set();
  const out = collection(ctx, data, 'clients', LIMITS.clients).map((item, i) => {
    const path = `clients[${i}]`;
    if (!isObj(item)) { ctx.err(path, 'Invalid client.'); return null; }
    const url = ctx.str(item, 'url', path, { max: 300, label: 'Website' });
    if (url && !shared.isHttpUrl(url)) ctx.err(`${path}.url`, 'Website must start with http:// or https://.');
    return {
      id: normaliseId(item.id, 'c', seen),
      name: ctx.str(item, 'name', path, { required: true, max: 100, label: 'Client name' }),
      info: ctx.str(item, 'info', path, { max: 300, multiline: true, label: 'Details' }),
      logo: imageField(ctx, item, 'logo', path, 'Logo'),
      url: url && shared.isHttpUrl(url) ? url : ''
    };
  }).filter(Boolean);
  return finish(ctx, { clients: out });
}

/* --------------------------------- about --------------------------------- */
function social(ctx, parent, key, path) {
  const o = ctx.obj(parent, key, path);
  const p = `${path}.${key}`;
  const url = ctx.str(o, 'url', p, { max: 300, label: 'Link' });
  if (url && !shared.isHttpUrl(url)) ctx.err(`${p}.url`, 'Link must start with http:// or https://.');
  return { url: url && shared.isHttpUrl(url) ? url : '', label: ctx.str(o, 'label', p, { max: 60, label: 'Label' }) };
}

function validateAbout(data) {
  const ctx = makeCtx();
  if (!isObj(data)) { ctx.err('', 'Expected an object.'); return finish(ctx, null); }

  const brandName = ctx.str(data, 'brandName', '', { required: true, max: 30, label: 'Brand name' });

  const h = ctx.obj(data, 'hero', '');
  const hero = {
    eyebrow: ctx.str(h, 'eyebrow', 'hero', { max: 80, label: 'Eyebrow text' }),
    greeting: ctx.str(h, 'greeting', 'hero', { max: 20, label: 'Greeting' }),
    name: ctx.str(h, 'name', 'hero', { required: true, max: 40, label: 'Name' }),
    title: ctx.str(h, 'title', 'hero', { required: true, max: 60, label: 'Professional title' }),
    intro: ctx.str(h, 'intro', 'hero', { required: true, max: 400, multiline: true, label: 'Main introduction' })
  };

  let stats = [];
  if (!Array.isArray(data.stats) || data.stats.length !== 4) ctx.err('stats', 'Exactly 4 stats are required.');
  else stats = data.stats.map((s, i) => {
    const o = isObj(s) ? s : {};
    return {
      value: ctx.str(o, 'value', `stats[${i}]`, { required: true, max: 15, label: 'Stat value' }),
      label: ctx.str(o, 'label', `stats[${i}]`, { required: true, max: 40, label: 'Stat label' })
    };
  });

  const secIn = ctx.obj(data, 'sections', '');
  const sections = {};
  ['work', 'services', 'experience', 'testimonials', 'clients'].forEach((k) => {
    const o = ctx.obj(secIn, k, 'sections');
    sections[k] = {
      tag: ctx.str(o, 'tag', `sections.${k}`, { max: 40, label: 'Section tag' }),
      title: ctx.str(o, 'title', `sections.${k}`, { required: true, max: 60, label: 'Section title' })
    };
  });

  const a = ctx.obj(data, 'about', '');
  const about = {
    tag: ctx.str(a, 'tag', 'about', { max: 40, label: 'Tag' }),
    heading: ctx.str(a, 'heading', 'about', { required: true, max: 80, label: 'Heading' }),
    text: ctx.str(a, 'text', 'about', { required: true, max: 1200, multiline: true, label: 'About Me description' }),
    signature: ctx.str(a, 'signature', 'about', { max: 30, label: 'Signature' })
  };

  const c = ctx.obj(data, 'contact', '');
  const email = ctx.str(c, 'email', 'contact', { max: 120, label: 'Email' });
  if (email && !/^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/.test(email)) ctx.err('contact.email', 'Enter a valid email address.');
  const contact = {
    tag: ctx.str(c, 'tag', 'contact', { max: 40, label: 'Tag' }),
    heading: ctx.str(c, 'heading', 'contact', { required: true, max: 80, label: 'Heading' }),
    text: ctx.str(c, 'text', 'contact', { max: 300, multiline: true, label: 'Text' }),
    email,
    whatsapp: ctx.str(c, 'whatsapp', 'contact', { max: 60, label: 'WhatsApp' }),
    instagram: social(ctx, c, 'instagram', 'contact'),
    linkedin: social(ctx, c, 'linkedin', 'contact'),
    youtube: social(ctx, c, 'youtube', 'contact')
  };

  const f = ctx.obj(data, 'footer', '');
  const footer = { copyright: ctx.str(f, 'copyright', 'footer', { max: 120, label: 'Copyright text' }) };

  return finish(ctx, { brandName, hero, stats, sections, about, contact, footer });
}

function finish(ctx, value) {
  if (ctx.errors.length) throw new ValidationError(ctx.errors);
  return value;
}

/* ----------------------------- file registry ----------------------------- */
const FILES = {
  projects: { path: 'data/projects.json', validate: validateProjects, key: 'projects', label: (x) => x.title, empty: { projects: [] } },
  about: { path: 'data/about.json', validate: validateAbout, key: null, empty: null },
  experience: { path: 'data/experience.json', validate: validateExperience, key: 'experience', label: (x) => [x.role, x.company].filter(Boolean).join(' @ '), empty: { experience: [] } },
  clients: { path: 'data/clients.json', validate: validateClients, key: 'clients', label: (x) => x.name, empty: { clients: [] } },
  services: { path: 'data/services.json', validate: validateServices, key: 'services', label: (x) => x.title, empty: { services: [] } },
  testimonials: { path: 'data/testimonials.json', validate: validateTestimonials, key: 'testimonials', label: (x) => x.name, empty: { testimonials: [] } }
};

function serialise(data) { return JSON.stringify(data, null, 2) + '\n'; }

/* ------------------------- commit message builder ------------------------ */
function q(s) { return '"' + String(s).replace(/["\n\r]/g, ' ').slice(0, 40) + '"'; }
function names(list) {
  const shown = list.slice(0, 3).map(q).join(', ');
  return list.length > 3 ? `${shown} +${list.length - 3} more` : shown;
}

function describeChange(file, oldData, newData) {
  const def = FILES[file];
  if (!def.key) {
    const changed = [];
    const o = isObj(oldData) ? oldData : {};
    for (const k of Object.keys(newData)) if (JSON.stringify(o[k]) !== JSON.stringify(newData[k])) changed.push(k);
    return `Admin: update about content${changed.length ? ' (' + changed.join(', ') + ')' : ''}`;
  }
  const oldList = isObj(oldData) && Array.isArray(oldData[def.key]) ? oldData[def.key] : [];
  const newList = newData[def.key];
  const oldById = new Map(oldList.filter(isObj).map((x) => [x.id, x]));
  const newIds = new Set(newList.map((x) => x.id));
  const added = newList.filter((x) => !oldById.has(x.id));
  const removed = oldList.filter((x) => isObj(x) && !newIds.has(x.id));
  const edited = newList.filter((x) => oldById.has(x.id) && JSON.stringify(oldById.get(x.id)) !== JSON.stringify(x));
  const parts = [];
  if (added.length) parts.push(`added ${names(added.map(def.label))}`);
  if (edited.length) parts.push(`edited ${names(edited.map(def.label))}`);
  if (removed.length) parts.push(`removed ${names(removed.map(def.label))}`);
  if (!parts.length) parts.push('reordered items');
  return `Admin: update ${file} - ${parts.join('; ')}`.slice(0, 240);
}

module.exports = { FILES, ValidationError, serialise, describeChange, LIMITS };
