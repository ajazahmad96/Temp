/*
 * Ajaz Edits — admin panel (vanilla JS, loaded on demand from the footer gear).
 *
 * All real security lives on the server (api/*). This file only collects,
 * validates for convenience, previews and sends content to the secure API.
 * No secrets exist in this file; the session is an HttpOnly cookie that
 * JavaScript cannot read.
 */
(function () {
  'use strict';

  var S = window.AjazShared;
  var R = window.AjazRender;
  var FILES = ['projects', 'about', 'experience', 'clients', 'services', 'testimonials'];

  var DEFS = {
    projects: { key: 'projects', label: function (x) { return x.title || '(untitled)'; }, noun: 'project' },
    services: { key: 'services', label: function (x) { return x.title || '(untitled)'; }, noun: 'service' },
    testimonials: { key: 'testimonials', label: function (x) { return x.name || '(unnamed)'; }, noun: 'testimonial' },
    experience: { key: 'experience', label: function (x) { return [x.role, x.company].filter(Boolean).join(' @ ') || '(untitled)'; }, noun: 'experience entry' },
    clients: { key: 'clients', label: function (x) { return x.name || '(unnamed)'; }, noun: 'client' },
    about: { key: null }
  };
  var NAV = [
    ['dashboard', 'Dashboard', 'fa-solid fa-gauge-high'],
    ['projects', 'Projects', 'fa-solid fa-film'],
    ['about', 'About & Info', 'fa-solid fa-user'],
    ['experience', 'Experience', 'fa-solid fa-briefcase'],
    ['clients', 'Clients', 'fa-solid fa-users'],
    ['services', 'Services', 'fa-solid fa-scissors'],
    ['testimonials', 'Testimonials', 'fa-solid fa-quote-left']
  ];
  var SITE_SECTION = { projects: 'work', about: 'about', experience: 'experience', clients: 'clients', services: 'services', testimonials: 'testimonials' };

  var state = {
    authed: false,
    open: false,
    view: 'dashboard',
    server: {},          // name -> { ok, exists, sha, data, error }  (last copy loaded from GitHub)
    draft: {},           // name -> working copy being edited
    loading: false,
    loadError: null,
    pendingFiles: {},    // "pending:<id>" -> { base64 }  (images waiting for Publish)
    previewing: false,
    expiresAt: 0,
    expiryTimer: null
  };

  /* ------------------------------ utilities ------------------------------ */
  function h(tag, attrs) {
    var n = document.createElement(tag);
    var after = {};
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k === 'value' || k === 'checked' || k === 'disabled') after[k] = v;
      else if (k.slice(0, 2) === 'on' && typeof v === 'function') n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? '' : String(v));
    });
    for (var i = 2; i < arguments.length; i++) append(n, arguments[i]);
    if ('value' in after) n.value = after.value;
    if ('checked' in after) n.checked = !!after.checked;
    if ('disabled' in after) n.disabled = !!after.disabled;
    return n;
  }
  function append(n, c) {
    if (c === null || c === undefined || c === false) return;
    if (Array.isArray(c)) { c.forEach(function (x) { append(n, x); }); return; }
    n.appendChild(typeof c === 'object' ? c : document.createTextNode(String(c)));
  }
  function ic(cls) { return h('i', { class: cls, 'aria-hidden': 'true' }); }
  function clone(x) { return JSON.parse(JSON.stringify(x)); }
  function stable(x) {
    if (Array.isArray(x)) return '[' + x.map(stable).join(',') + ']';
    if (x && typeof x === 'object') return '{' + Object.keys(x).sort().map(function (k) { return JSON.stringify(k) + ':' + stable(x[k]); }).join(',') + '}';
    return JSON.stringify(x);
  }
  function uid(prefix) {
    var a = new Uint8Array(4);
    crypto.getRandomValues(a);
    return prefix + '-' + Array.prototype.map.call(a, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
  }
  function items(name, data) {
    var k = DEFS[name].key;
    return data && Array.isArray(data[k]) ? data[k] : [];
  }
  function getPath(obj, path) {
    return path.split('.').reduce(function (o, k) { return o == null ? undefined : o[k]; }, obj);
  }
  function setPath(obj, path, value) {
    var parts = path.split('.');
    var o = obj;
    for (var i = 0; i < parts.length - 1; i++) o = o[parts[i]];
    o[parts[parts.length - 1]] = value;
  }

  /* --------------------------------- API --------------------------------- */
  function ApiError(status, code, message, body) {
    this.status = status; this.code = code; this.message = message; this.body = body;
  }
  ApiError.prototype = Object.create(Error.prototype);

  function api(method, path, body) {
    return fetch(path, {
      method: method,
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'ajaz-admin' },
      body: body === undefined ? undefined : JSON.stringify(body)
    }).then(function (res) {
      return res.json().catch(function () { return null; }).then(function (json) {
        if (!res.ok || !json || json.ok === false) {
          var e = (json && json.error) || {};
          throw new ApiError(res.status, e.code || 'error', e.message || 'The request failed (' + res.status + ').', json);
        }
        return json;
      });
    }, function () {
      throw new ApiError(0, 'network', 'Network error. Check your internet connection and try again.');
    });
  }

  /* ----------------------- toasts, dialogs and sheets --------------------- */
  var toastBox;
  function toast(message, type) {
    if (!toastBox) {
      toastBox = h('div', { class: 'ajz-toasts', role: 'status', 'aria-live': 'polite' });
      document.body.appendChild(toastBox);
    }
    var icon = type === 'error' ? 'fa-solid fa-circle-exclamation' : type === 'success' ? 'fa-solid fa-circle-check' : 'fa-solid fa-circle-info';
    var t = h('div', { class: 'ajz-toast ' + (type || 'info') }, ic(icon), h('span', { text: message }));
    toastBox.appendChild(t);
    setTimeout(function () { t.remove(); }, type === 'error' ? 8000 : 4500);
  }

  function openSheet(opts) {
    var prevFocus = document.activeElement;
    var closed = false;
    var backdrop = h('div', { class: 'ajz-sheet-backdrop' });
    var saveBtn = opts.saveLabel === null ? null : h('button', { type: 'button', class: 'ajz-btn ajz-btn-primary' + (opts.danger ? ' ajz-btn-danger' : '') }, opts.saveLabel || 'Save');
    var cancelBtn = h('button', { type: 'button', class: 'ajz-btn', text: opts.cancelLabel || 'Cancel' });
    var closeBtn = h('button', { type: 'button', class: 'ajz-icon-btn', 'aria-label': 'Close' }, ic('fa-solid fa-xmark'));
    var sheet = h('div', { class: 'ajz-sheet' + (opts.small ? ' small' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': opts.title },
      h('div', { class: 'ajz-sheet-head' }, h('h3', { text: opts.title }), closeBtn),
      h('div', { class: 'ajz-sheet-body' }, opts.content),
      h('div', { class: 'ajz-sheet-foot' }, opts.cancelLabel === null ? null : cancelBtn, saveBtn)
    );
    backdrop.appendChild(sheet);
    document.body.appendChild(backdrop);

    function close(result) {
      if (closed) return;
      closed = true;
      document.removeEventListener('keydown', onKey, true);
      backdrop.remove();
      if (prevFocus && prevFocus.focus) try { prevFocus.focus(); } catch (e) { /* ignore */ }
      if (opts.onClose) opts.onClose(result);
    }
    function onKey(e) {
      if (e.key === 'Escape' && !opts.locked) { e.stopPropagation(); close(false); }
    }
    document.addEventListener('keydown', onKey, true);
    closeBtn.addEventListener('click', function () { if (!opts.locked) close(false); });
    cancelBtn.addEventListener('click', function () { close(false); });
    backdrop.addEventListener('mousedown', function (e) { if (e.target === backdrop && !opts.locked && !opts.noBackdropClose) close(false); });
    if (saveBtn) {
      saveBtn.addEventListener('click', function () {
        var r = opts.onSave ? opts.onSave(api_) : true;
        Promise.resolve(r).then(function (ok) { if (ok !== false) close(true); });
      });
    }
    var api_ = { close: close, saveBtn: saveBtn, cancelBtn: cancelBtn, sheet: sheet, body: sheet.querySelector('.ajz-sheet-body'), foot: sheet.querySelector('.ajz-sheet-foot'), closeBtn: closeBtn };
    var first = sheet.querySelector('input:not([type=hidden]):not([type=file]), textarea, select');
    setTimeout(function () { (first || saveBtn || closeBtn).focus(); }, 30);
    return api_;
  }

  function confirmDialog(o) {
    return new Promise(function (resolve) {
      var decided = false;
      openSheet({
        title: o.title, small: true, danger: !!o.danger, saveLabel: o.confirmLabel || 'Confirm',
        content: h('p', { text: o.message }),
        onSave: function () { decided = true; resolve(true); return true; },
        onClose: function () { if (!decided) resolve(false); }
      });
    });
  }

  function alertDialog(title, contentNode) {
    return new Promise(function (resolve) {
      openSheet({ title: title, small: true, saveLabel: 'OK', cancelLabel: null, content: contentNode, onClose: resolve });
    });
  }

  /* ----------------------------- form helpers ----------------------------- */
  function field(label, input, o) {
    var opts = o || {};
    var err = h('div', { class: 'ajz-err', role: 'alert' });
    var counter = null;
    if (opts.max && (input.tagName === 'TEXTAREA' || opts.counter)) {
      counter = h('div', { class: 'ajz-counter' });
      var upd = function () { counter.textContent = input.value.length + ' / ' + opts.max; };
      input.addEventListener('input', upd); upd();
    }
    var el = h('div', { class: 'ajz-field' },
      h('label', { class: 'ajz-label' }, label, opts.required ? h('span', { class: 'req', text: ' *' }) : null),
      input, opts.hint ? h('div', { class: 'ajz-hint', text: opts.hint }) : null, counter, err);
    return {
      el: el, input: input,
      setError: function (msg) { err.textContent = msg || ''; input.classList.toggle('invalid', !!msg); if (msg) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid'); }
    };
  }
  function textInput(value, o) {
    var opts = o || {};
    return h('input', { class: 'ajz-input', type: opts.type || 'text', value: value || '', maxlength: opts.max, placeholder: opts.placeholder, inputmode: opts.inputmode, autocomplete: opts.autocomplete || 'off', autocapitalize: opts.autocapitalize, spellcheck: opts.spellcheck === undefined ? undefined : String(opts.spellcheck) });
  }
  function textArea(value, o) {
    return h('textarea', { class: 'ajz-textarea', value: value || '', maxlength: (o || {}).max, placeholder: (o || {}).placeholder, rows: (o || {}).rows || 4 });
  }

  /* ---------- image field (URL or upload; uploads wait for Publish) ---------- */
  function resizeImage(file, kind) {
    return new Promise(function (resolve, reject) {
      if (!/^image\/(png|jpe?g|webp|gif)$/i.test(file.type)) return reject(new Error('Choose a PNG, JPEG, WebP or GIF image.'));
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        URL.revokeObjectURL(url);
        var max = kind === 'logo' ? 500 : 1000;
        var scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
        var w = Math.max(1, Math.round(img.naturalWidth * scale));
        var hgt = Math.max(1, Math.round(img.naturalHeight * scale));
        var canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = hgt;
        var ctx = canvas.getContext('2d');
        var mime = kind === 'logo' ? 'image/png' : 'image/jpeg';
        if (mime === 'image/jpeg') { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, hgt); }
        ctx.drawImage(img, 0, 0, w, hgt);
        var dataUrl = canvas.toDataURL(mime, 0.85);
        var base64 = dataUrl.split(',')[1] || '';
        if (base64.length * 0.75 > 2.4 * 1024 * 1024) return reject(new Error('That image is still too large after resizing. Try a smaller one.'));
        resolve({ dataUrl: dataUrl, base64: base64 });
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('That file could not be read as an image.')); };
      img.src = url;
    });
  }

  function imageField(label, value, kind) {
    var val = value || '';
    var urlInput = textInput(val.indexOf('pending:') === 0 ? '' : val, { type: 'url', inputmode: 'url', placeholder: 'https://… (optional)', max: 500 });
    var thumb = h('div', { class: 'ajz-img-thumb' });
    var note = h('div', { class: 'ajz-hint' });
    var fileInput = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif', hidden: true });
    var f = field(label, h('div'), { hint: kind === 'logo' ? 'Paste an https:// image link or upload one.' : 'Leave empty to use the video\u2019s automatic YouTube thumbnail.' });
    var uploadBtn = h('button', { type: 'button', class: 'ajz-btn ajz-btn-sm' }, ic('fa-solid fa-upload'), 'Upload image');
    var removeBtn = h('button', { type: 'button', class: 'ajz-btn ajz-btn-sm ajz-btn-danger' }, ic('fa-solid fa-trash'), 'Remove');

    function refresh() {
      thumb.textContent = '';
      var src = R.imageSrc(val);
      if (src) thumb.appendChild(h('img', { src: src, alt: '' })); else thumb.appendChild(ic('fa-regular fa-image'));
      removeBtn.hidden = !val;
      note.textContent = val.indexOf('pending:') === 0 ? 'Image selected. It is saved to GitHub when you press Publish.' : '';
    }
    urlInput.addEventListener('input', function () { val = urlInput.value.trim(); f.setError(''); refresh(); });
    uploadBtn.addEventListener('click', function () { fileInput.click(); });
    removeBtn.addEventListener('click', function () { val = ''; urlInput.value = ''; fileInput.value = ''; refresh(); });
    fileInput.addEventListener('change', function () {
      var file = fileInput.files && fileInput.files[0];
      if (!file) return;
      uploadBtn.disabled = true;
      resizeImage(file, kind).then(function (out) {
        var id = 'pending:' + uid('img');
        R.pendingImages[id] = out.dataUrl;
        state.pendingFiles[id] = { base64: out.base64 };
        val = id; urlInput.value = ''; f.setError(''); refresh();
      }, function (e) { f.setError(e.message); }).then(function () { uploadBtn.disabled = false; fileInput.value = ''; });
    });

    var controls = h('div', { class: 'ajz-img-controls' }, urlInput, h('div', { class: 'ajz-actions' }, uploadBtn, removeBtn), note);
    var row = h('div', { class: 'ajz-img-field' }, thumb, controls, fileInput);
    var holder = f.el.querySelector('div:not(.ajz-err):not(.ajz-hint)');
    holder.replaceWith(row);
    refresh();
    return {
      el: f.el,
      get: function () { return val; },
      validate: function () {
        if (val && val.indexOf('pending:') !== 0 && !S.isValidImageRef(val)) { f.setError('Use an https:// link, or upload an image.'); return false; }
        if (val.indexOf('pending:') === 0 && !state.pendingFiles[val]) { f.setError('Please choose the image again.'); return false; }
        f.setError(''); return true;
      }
    };
  }

  /* ------------------------ validation (convenience only) ------------------------ */
  var ICONS = ['fa-solid fa-scissors', 'fa-solid fa-palette', 'fa-solid fa-star', 'fa-solid fa-wave-square', 'fa-brands fa-youtube', 'fa-solid fa-mobile-screen',
    'fa-solid fa-film', 'fa-solid fa-video', 'fa-solid fa-camera', 'fa-solid fa-clapperboard', 'fa-solid fa-music', 'fa-solid fa-headphones',
    'fa-solid fa-microphone', 'fa-solid fa-wand-magic-sparkles', 'fa-solid fa-bolt', 'fa-solid fa-pen-nib', 'fa-solid fa-photo-film', 'fa-solid fa-play',
    'fa-solid fa-rocket', 'fa-solid fa-lightbulb', 'fa-solid fa-chart-line', 'fa-solid fa-bullhorn', 'fa-solid fa-paintbrush', 'fa-solid fa-layer-group',
    'fa-solid fa-sliders', 'fa-solid fa-globe', 'fa-solid fa-heart', 'fa-solid fa-fire', 'fa-brands fa-instagram', 'fa-brands fa-tiktok', 'fa-solid fa-image'];

  function len(s, max) { return typeof s === 'string' && s.trim().length > max; }
  var V = {
    projects: function (it) {
      var e = {};
      if (!it.title || !it.title.trim()) e.title = 'Project title is required.';
      else if (len(it.title, 100)) e.title = 'Title must be at most 100 characters.';
      var p = S.parseYouTubeUrl(it.url);
      if (!p.ok) e.url = p.error;
      if (it.type !== 'short' && it.type !== 'long') e.type = 'Choose Short Form or Long Form.';
      if (len(it.description, 300)) e.description = 'Description must be at most 300 characters.';
      if (it.thumbnail && it.thumbnail.indexOf('pending:') !== 0 && !S.isValidImageRef(it.thumbnail)) e.thumbnail = 'Thumbnail must be an https:// link or an uploaded image.';
      return e;
    },
    services: function (it) {
      var e = {};
      if (!it.title || !it.title.trim()) e.title = 'Service title is required.';
      if (len(it.title, 60)) e.title = 'Title must be at most 60 characters.';
      if (len(it.description, 200)) e.description = 'Description must be at most 200 characters.';
      if (!S.isValidIcon(it.icon)) e.icon = 'Choose an icon.';
      return e;
    },
    testimonials: function (it) {
      var e = {};
      if (!it.name || !it.name.trim()) e.name = 'Client name is required.';
      if (!it.text || !it.text.trim()) e.text = 'The testimonial text is required.';
      if (len(it.text, 600)) e.text = 'Testimonial must be at most 600 characters.';
      if (len(it.name, 80) || len(it.role, 80)) e.role = 'Name and role must be at most 80 characters.';
      return e;
    },
    experience: function (it) {
      var e = {};
      if (!it.role || !it.role.trim()) e.role = 'Role is required.';
      if (!it.start || !it.start.trim()) e.start = 'Start date is required.';
      if (len(it.description, 600)) e.description = 'Description must be at most 600 characters.';
      return e;
    },
    clients: function (it) {
      var e = {};
      if (!it.name || !it.name.trim()) e.name = 'Client name is required.';
      if (it.url && !S.isHttpUrl(it.url)) e.url = 'Website must start with http:// or https://.';
      if (len(it.info, 300)) e.info = 'Details must be at most 300 characters.';
      if (it.logo && it.logo.indexOf('pending:') !== 0 && !S.isValidImageRef(it.logo)) e.logo = 'Logo must be an https:// link or an uploaded image.';
      return e;
    }
  };

  var ABOUT_SCHEMA = [
    { title: 'Brand & hero', fields: [
      ['brandName', 'Logo text', { required: true, max: 30 }],
      ['hero.eyebrow', 'Small line above name', { max: 80 }],
      ['hero.greeting', 'Greeting', { max: 20 }],
      ['hero.name', 'Name', { required: true, max: 40 }],
      ['hero.title', 'Professional title', { required: true, max: 60 }],
      ['hero.intro', 'Main introduction', { required: true, max: 400, textarea: true }]
    ] },
    { title: 'About me', fields: [
      ['about.tag', 'Small label', { max: 40 }],
      ['about.heading', 'Heading', { required: true, max: 80 }],
      ['about.text', 'About me description', { required: true, max: 1200, textarea: true, rows: 6 }],
      ['about.signature', 'Signature text', { max: 30 }]
    ] },
    { title: 'Personal information & contact', fields: [
      ['contact.tag', 'Contact label', { max: 40 }],
      ['contact.heading', 'Contact heading', { required: true, max: 80 }],
      ['contact.text', 'Contact text', { max: 300, textarea: true, rows: 3 }],
      ['contact.email', 'Email', { type: 'email', inputmode: 'email', max: 120 }],
      ['contact.whatsapp', 'WhatsApp (number, or a message like “currently unavailable”)', { max: 60 }],
      ['contact.instagram.url', 'Instagram link', { type: 'url', inputmode: 'url', max: 300 }],
      ['contact.instagram.label', 'Instagram label', { max: 60 }],
      ['contact.linkedin.url', 'LinkedIn link', { type: 'url', inputmode: 'url', max: 300 }],
      ['contact.linkedin.label', 'LinkedIn label', { max: 60 }],
      ['contact.youtube.url', 'YouTube channel link', { type: 'url', inputmode: 'url', max: 300 }],
      ['contact.youtube.label', 'YouTube label', { max: 60 }]
    ] },
    { title: 'Stats bar', fields: [0, 1, 2, 3].reduce(function (acc, i) {
      acc.push(['stats.' + i + '.value', 'Stat ' + (i + 1) + ' — number', { required: true, max: 15 }]);
      acc.push(['stats.' + i + '.label', 'Stat ' + (i + 1) + ' — label', { required: true, max: 40 }]);
      return acc;
    }, []) },
    { title: 'Section headings', fields: [['work', 'Projects'], ['services', 'Services'], ['experience', 'Experience'], ['testimonials', 'Testimonials'], ['clients', 'Clients']].reduce(function (acc, s) {
      acc.push(['sections.' + s[0] + '.tag', s[1] + ' — small label', { max: 40 }]);
      acc.push(['sections.' + s[0] + '.title', s[1] + ' — title', { required: true, max: 60 }]);
      return acc;
    }, []) },
    { title: 'Footer', fields: [['footer.copyright', 'Copyright text', { max: 120 }]] }
  ];

  function validateAboutData(d) {
    var errs = {};
    ABOUT_SCHEMA.forEach(function (g) {
      g.fields.forEach(function (fd) {
        var v = getPath(d, fd[0]);
        var o = fd[2] || {};
        v = typeof v === 'string' ? v.trim() : '';
        if (o.required && !v) errs[fd[0]] = 'This field is required.';
        else if (o.max && v.length > o.max) errs[fd[0]] = 'At most ' + o.max + ' characters.';
        else if (/\.url$/.test(fd[0]) && v && !S.isHttpUrl(v)) errs[fd[0]] = 'Must start with http:// or https://.';
        else if (fd[0] === 'contact.email' && v && !/^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/.test(v)) errs[fd[0]] = 'Enter a valid email address.';
      });
    });
    return errs;
  }

  /** Returns [{file, message}] for everything that would be rejected on publish. */
  function validateDraft(name) {
    var out = [];
    if (name === 'about') {
      var errs = validateAboutData(state.draft.about);
      Object.keys(errs).forEach(function (p) { out.push({ file: 'about', message: p + ': ' + errs[p] }); });
      state.aboutErrors = errs;
      return out;
    }
    items(name, state.draft[name]).forEach(function (it) {
      var e = V[name](it);
      var first = Object.keys(e)[0];
      if (first) out.push({ file: name, message: '“' + DEFS[name].label(it) + '” — ' + e[first] });
    });
    return out;
  }

  /* ----------------------------- dirty + diff ----------------------------- */
  function loaded(name) { return state.server[name] && state.server[name].ok && state.draft[name]; }
  function isDirty(name) { return !!loaded(name) && stable(state.draft[name]) !== stable(state.server[name].data); }
  function dirtyNames() { return FILES.filter(isDirty); }
  var ABOUT_KEYS = { brandName: 'Logo text', hero: 'Hero section', stats: 'Stats bar', sections: 'Section headings', about: 'About me', contact: 'Contact & links', footer: 'Footer' };
  var FILE_TITLE = { projects: 'Projects', about: 'About & Info', experience: 'Experience', clients: 'Clients', services: 'Services', testimonials: 'Testimonials' };

  function describeDiff(name) {
    var base = state.server[name].data;
    var cur = state.draft[name];
    var lines = [];
    if (!DEFS[name].key) {
      Object.keys(cur).forEach(function (k) { if (stable(cur[k]) !== stable(base[k])) lines.push({ cls: 'mod', text: 'Edited: ' + (ABOUT_KEYS[k] || k) }); });
      return lines;
    }
    var label = DEFS[name].label;
    var oldList = items(name, base), newList = items(name, cur);
    var oldById = {}; oldList.forEach(function (x) { oldById[x.id] = x; });
    var newIds = {}; newList.forEach(function (x) { newIds[x.id] = true; });
    newList.forEach(function (x) {
      if (!oldById[x.id]) lines.push({ cls: 'add', text: 'Added: ' + label(x) });
      else if (stable(oldById[x.id]) !== stable(x)) lines.push({ cls: 'mod', text: 'Edited: ' + label(x) });
    });
    oldList.forEach(function (x) { if (!newIds[x.id]) lines.push({ cls: 'del', text: 'Removed: ' + label(x) }); });
    if (!lines.length) lines.push({ cls: 'mod', text: 'Order changed' });
    return lines;
  }
  function changesNode(names) {
    return h('ul', { class: 'ajz-changes' }, names.map(function (n) {
      return h('li', null, h('b', { text: FILE_TITLE[n] }), describeDiff(n).map(function (l) { return h('div', { class: l.cls, text: l.text }); }));
    }));
  }

  /* ------------------------------- shell UI ------------------------------- */
  var root, mainEl, titleEl, navEl, actionBar, previewBar, loginEl = null;

  function buildShell() {
    var menuBtn = h('button', { type: 'button', class: 'ajz-icon-btn ajz-menu-btn', 'aria-label': 'Open menu', onclick: function () { root.classList.toggle('nav-open'); } }, ic('fa-solid fa-bars'));
    titleEl = h('h1');
    var viewBtn = h('button', { type: 'button', class: 'ajz-btn', 'aria-label': 'View site', onclick: function () { close(); } }, ic('fa-solid fa-arrow-up-right-from-square'), h('span', { class: 'lbl', text: 'View site' }));
    var logoutBtn = h('button', { type: 'button', class: 'ajz-btn', 'aria-label': 'Log out', onclick: logout }, ic('fa-solid fa-right-from-bracket'), h('span', { class: 'lbl', text: 'Logout' }));
    navEl = h('nav', { class: 'ajz-nav', 'aria-label': 'Admin sections' });
    var side = h('aside', { class: 'ajz-side' }, navEl,
      h('div', { class: 'ajz-side-foot', text: 'Publishing saves your changes to GitHub. Vercel then deploys the website automatically.' }));
    mainEl = h('main', { class: 'ajz-main', id: 'ajzMain', tabindex: '-1' });
    actionBar = h('div', { class: 'ajz-actionbar', hidden: true });
    root = h('div', { class: 'ajz-admin', id: 'ajzAdmin', hidden: true, role: 'region', 'aria-label': 'Admin dashboard' },
      h('header', { class: 'ajz-top' }, menuBtn, titleEl, viewBtn, logoutBtn),
      h('div', { class: 'ajz-body' }, side, h('div', { class: 'ajz-scrim', onclick: function () { root.classList.remove('nav-open'); } }), mainEl),
      actionBar);
    document.body.appendChild(root);

    previewBar = h('div', { class: 'ajz-previewbar', hidden: true, role: 'region', 'aria-label': 'Preview controls' },
      h('div', { class: 'msg', text: 'Previewing unpublished changes — nothing has been saved to GitHub.' }),
      h('button', { type: 'button', class: 'ajz-btn', onclick: endPreview }, ic('fa-solid fa-pen'), 'Back to editor'),
      h('button', { type: 'button', class: 'ajz-btn ajz-btn-primary', onclick: function () { endPreview(); publishAll(); } }, ic('fa-solid fa-cloud-arrow-up'), 'Publish'));
    document.body.appendChild(previewBar);
  }

  function updateNav() {
    navEl.textContent = '';
    NAV.forEach(function (n) {
      var b = h('button', { type: 'button', class: state.view === n[0] ? 'active' : '', 'aria-current': state.view === n[0] ? 'page' : null, onclick: function () { go(n[0]); } },
        ic(n[2]), h('span', { text: n[1] }), n[0] !== 'dashboard' && isDirty(n[0]) ? h('span', { class: 'ajz-dot', title: 'Unpublished changes' }) : null);
      navEl.appendChild(b);
    });
    var cur = NAV.filter(function (n) { return n[0] === state.view; })[0];
    titleEl.textContent = '';
    titleEl.appendChild(h('small', { text: 'Admin panel' }));
    titleEl.appendChild(document.createTextNode(cur ? cur[1] : ''));
  }

  function updateActionBar() {
    var dirty = dirtyNames();
    actionBar.hidden = dirty.length === 0 || state.previewing;
    if (!dirty.length) return;
    actionBar.textContent = '';
    var names = dirty.map(function (n) { return FILE_TITLE[n]; }).join(', ');
    actionBar.appendChild(h('div', { class: 'msg', text: 'Unpublished changes: ' + names }));
    actionBar.appendChild(h('div', { class: 'btns' },
      h('button', { type: 'button', class: 'ajz-btn ajz-btn-danger', onclick: discardAll }, ic('fa-solid fa-rotate-left'), 'Discard'),
      h('button', { type: 'button', class: 'ajz-btn', onclick: startPreview }, ic('fa-solid fa-eye'), 'Preview'),
      h('button', { type: 'button', class: 'ajz-btn ajz-btn-primary', onclick: publishAll }, ic('fa-solid fa-cloud-arrow-up'), 'Publish')));
  }

  function updateChrome() {
    updateNav(); updateActionBar();
    var chip = mainEl.querySelector('.ajz-dirty-chip');
    if (chip) chip.hidden = !isDirty(state.view);
  }

  function go(view) {
    state.view = view;
    root.classList.remove('nav-open');
    render();
    mainEl.scrollTop = 0;
  }

  function render() {
    updateNav(); updateActionBar();
    mainEl.textContent = '';
    var wrap = h('div', { class: 'ajz-wrap' });
    mainEl.appendChild(wrap);
    if (state.loading) {
      wrap.appendChild(h('div', { class: 'ajz-empty' }, h('span', { class: 'ajz-spin light' }), h('div', { text: 'Loading your content from GitHub…', style: 'margin-top:12px' })));
      return;
    }
    if (state.view === 'dashboard') return renderDashboard(wrap);
    if (state.view === 'about') return renderAboutView(wrap);
    renderCollection(wrap, state.view);
  }

  /* ------------------------------- dashboard ------------------------------- */
  function renderDashboard(wrap) {
    wrap.appendChild(h('div', { class: 'ajz-view-head' }, h('div', null, h('h2', { text: 'Dashboard' }),
      h('p', { text: 'Edit your website content here. Changes stay in a draft until you press Publish, which saves them to GitHub and lets Vercel deploy the update.' }))));

    if (state.loadError) {
      wrap.appendChild(h('div', { class: 'ajz-banner error' }, h('b', { text: 'Could not load content from GitHub. ' }), state.loadError,
        h('div', null, h('button', { type: 'button', class: 'ajz-btn', onclick: function () { loadAll(); } }, ic('fa-solid fa-rotate'), 'Try again'))));
    }
    FILES.forEach(function (n) {
      if (state.server[n] && !state.server[n].ok) {
        wrap.appendChild(h('div', { class: 'ajz-banner error', text: FILE_TITLE[n] + ': ' + (state.server[n].error ? state.server[n].error.message : 'could not be loaded.') + ' It is read-only here until fixed in the repository.' }));
      }
    });

    function count(n) { return loaded(n) ? items(n, state.draft[n]).length : '–'; }
    var shorts = loaded('projects') ? items('projects', state.draft.projects).filter(function (p) { return p.type === 'short'; }).length : 0;
    var longs = loaded('projects') ? items('projects', state.draft.projects).length - shorts : 0;
    var stat = function (view, label, extra) {
      return h('button', { type: 'button', class: 'ajz-stat', onclick: function () { go(view); } }, h('b', { text: String(count(view)) }), h('span', { text: label }), extra ? h('em', { text: extra }) : null);
    };
    wrap.appendChild(h('div', { class: 'ajz-stats' },
      stat('projects', 'Projects', shorts + ' short · ' + longs + ' long'), stat('services', 'Services'), stat('testimonials', 'Testimonials'), stat('experience', 'Experience'), stat('clients', 'Clients')));

    var dirty = dirtyNames();
    var status = h('div', { class: 'ajz-card' }, h('h3', { text: 'Publishing status' }));
    if (dirty.length) {
      status.appendChild(h('p', { class: 'ajz-hint', text: 'These changes are only in your draft. Visitors will not see them until you publish.', style: 'margin-bottom:12px' }));
      status.appendChild(changesNode(dirty));
      status.appendChild(h('div', { class: 'ajz-actions', style: 'margin-top:14px' },
        h('button', { type: 'button', class: 'ajz-btn', onclick: startPreview }, ic('fa-solid fa-eye'), 'Preview'),
        h('button', { type: 'button', class: 'ajz-btn ajz-btn-primary', onclick: publishAll }, ic('fa-solid fa-cloud-arrow-up'), 'Publish')));
    } else {
      status.appendChild(h('p', { class: 'ajz-hint', text: state.loadError ? 'Content is not loaded.' : 'Everything is in sync with GitHub. No unpublished changes.' }));
    }
    status.appendChild(h('div', { class: 'ajz-actions', style: 'margin-top:14px' },
      h('button', { type: 'button', class: 'ajz-btn ajz-btn-sm', onclick: reloadAllConfirm }, ic('fa-solid fa-rotate'), 'Refresh from GitHub')));
    wrap.appendChild(status);

    wrap.appendChild(h('div', { class: 'ajz-card' }, h('h3', { text: 'Quick actions' }), h('div', { class: 'ajz-actions' },
      h('button', { type: 'button', class: 'ajz-btn ajz-btn-primary', onclick: function () { go('projects'); projectEditor(-1); } }, ic('fa-solid fa-plus'), 'Add project'),
      h('button', { type: 'button', class: 'ajz-btn', onclick: function () { go('testimonials'); testimonialEditor(-1); } }, ic('fa-solid fa-plus'), 'Add testimonial'),
      h('button', { type: 'button', class: 'ajz-btn', onclick: function () { go('about'); } }, ic('fa-solid fa-pen'), 'Edit about'))));
  }

  /* ----------------------------- collection views ----------------------------- */
  var VIEW_CONF = {
    projects: {
      title: 'Projects', add: 'Add project', desc: 'Videos shown in the portfolio. Short Form and Long Form videos appear under their own tab on the website.',
      empty: 'No projects yet. Add your first project and it will appear in the matching portfolio tab.',
      editor: function (i) { projectEditor(i); },
      media: function (it) { var src = R.imageSrc(it.thumbnail) || R.youtubeThumb(it.videoId); return h('div', { class: 'ajz-item-media ' + it.type }, h('img', { src: src, alt: '', loading: 'lazy' })); },
      body: function (it) { return [h('span', { class: 'ajz-badge', text: it.type === 'long' ? 'Long form' : 'Short form' }), h('h4', { text: it.title }), h('p', { text: it.description || it.url })]; }
    },
    experience: {
      title: 'Experience', add: 'Add experience', desc: 'Work history. The Experience section appears on the website once you add at least one entry.',
      empty: 'No experience added yet. The Experience section stays hidden on the website until you add one.',
      editor: function (i) { experienceEditor(i); },
      media: function () { return h('div', { class: 'ajz-item-media' }, ic('fa-solid fa-briefcase')); },
      body: function (it) { return [h('h4', { text: it.role + (it.company ? ' · ' + it.company : '') }), h('p', { text: [it.start, it.end].filter(Boolean).join(' – ') + (it.description ? ' — ' + it.description : '') })]; }
    },
    clients: {
      title: 'Clients', add: 'Add client', desc: 'Clients you have worked with. The Clients section appears on the website once you add at least one.',
      empty: 'No clients added yet. The Clients section stays hidden on the website until you add one.',
      editor: function (i) { clientEditor(i); },
      media: function (it) { var src = R.imageSrc(it.logo); return h('div', { class: 'ajz-item-media' }, src ? h('img', { src: src, alt: '', style: 'object-fit:contain;padding:4px' }) : ic('fa-solid fa-building')); },
      body: function (it) { return [h('h4', { text: it.name }), h('p', { text: it.info || it.url || '' })]; }
    },
    services: {
      title: 'Services', add: 'Add service', desc: 'What you offer. Each service shows an icon, title and short description.',
      empty: 'No services yet. Add a service to show it on the website.',
      editor: function (i) { serviceEditor(i); },
      media: function (it) { return h('div', { class: 'ajz-item-media' }, ic(S.isValidIcon(it.icon) ? it.icon : 'fa-solid fa-star')); },
      body: function (it) { return [h('h4', { text: it.title }), h('p', { text: it.description })]; }
    },
    testimonials: {
      title: 'Testimonials', add: 'Add testimonial', desc: 'Client quotes shown in the rotating testimonial slider.',
      empty: 'No testimonials yet. The testimonial slider stays hidden until you add one.',
      editor: function (i) { testimonialEditor(i); },
      media: function () { return h('div', { class: 'ajz-item-media' }, ic('fa-solid fa-quote-left')); },
      body: function (it) { return [h('h4', { text: it.name + (it.role ? ' · ' + it.role : '') }), h('p', { text: it.text })]; }
    }
  };

  function renderCollection(wrap, name) {
    var conf = VIEW_CONF[name];
    var head = h('div', { class: 'ajz-view-head' },
      h('div', null, h('h2', { text: conf.title }), h('p', { text: conf.desc })),
      h('div', { class: 'ajz-actions' },
        h('span', { class: 'ajz-chip ajz-dirty-chip', hidden: !isDirty(name) }, ic('fa-solid fa-circle'), 'Unpublished'),
        h('button', { type: 'button', class: 'ajz-btn ajz-btn-primary', disabled: !loaded(name), onclick: function () { conf.editor(-1); } }, ic('fa-solid fa-plus'), conf.add)));
    wrap.appendChild(head);

    if (!loaded(name)) {
      var err = state.server[name] && state.server[name].error;
      wrap.appendChild(h('div', { class: 'ajz-banner error', text: err ? err.message : 'This section could not be loaded.' }));
      return;
    }
    var list = items(name, state.draft[name]);
    if (!list.length) {
      wrap.appendChild(h('div', { class: 'ajz-empty' }, h('div', { text: conf.empty }),
        h('button', { type: 'button', class: 'ajz-btn ajz-btn-primary', onclick: function () { conf.editor(-1); } }, ic('fa-solid fa-plus'), conf.add)));
      return;
    }
    var serverIds = {};
    items(name, state.server[name].data).forEach(function (x) { serverIds[x.id] = true; });
    var box = h('div', { class: 'ajz-list' });
    list.forEach(function (it, i) {
      box.appendChild(h('div', { class: 'ajz-item' + (serverIds[it.id] ? '' : ' is-new') },
        conf.media(it),
        h('div', { class: 'ajz-item-body' }, conf.body(it)),
        h('div', { class: 'ajz-item-tools' },
          h('button', { type: 'button', class: 'ajz-icon-btn', 'aria-label': 'Move up', disabled: i === 0, onclick: function () { move(name, i, -1); } }, ic('fa-solid fa-arrow-up')),
          h('button', { type: 'button', class: 'ajz-icon-btn', 'aria-label': 'Move down', disabled: i === list.length - 1, onclick: function () { move(name, i, 1); } }, ic('fa-solid fa-arrow-down')),
          h('button', { type: 'button', class: 'ajz-btn ajz-btn-sm', onclick: function () { conf.editor(i); } }, ic('fa-solid fa-pen'), 'Edit'),
          h('button', { type: 'button', class: 'ajz-btn ajz-btn-sm ajz-btn-danger', onclick: function () { removeItem(name, i); } }, ic('fa-solid fa-trash'), 'Delete'))));
    });
    wrap.appendChild(box);
  }

  function move(name, i, delta) {
    var list = state.draft[name][DEFS[name].key];
    var j = i + delta;
    if (j < 0 || j >= list.length) return;
    var t = list[i]; list[i] = list[j]; list[j] = t;
    render();
  }

  function removeItem(name, i) {
    var it = state.draft[name][DEFS[name].key][i];
    confirmDialog({
      title: 'Delete ' + DEFS[name].noun + '?', danger: true, confirmLabel: 'Delete',
      message: '“' + DEFS[name].label(it) + '” will be removed from your draft. It only disappears from the website after you press Publish.'
    }).then(function (ok) {
      if (!ok) return;
      state.draft[name][DEFS[name].key].splice(i, 1);
      render();
      toast('Deleted from draft. Press Publish to update the website.', 'info');
    });
  }

  function commitItem(name, item, index) {
    var list = state.draft[name][DEFS[name].key];
    if (index === -1) list.push(item); else list[index] = item;
    render();
    toast(DEFS[name].noun.charAt(0).toUpperCase() + DEFS[name].noun.slice(1) + ' saved to draft. Press Publish to make it live.', 'success');
  }

  function showErrs(map, errs) {
    var first = null;
    Object.keys(map).forEach(function (k) {
      map[k].setError(errs[k] || '');
      if (errs[k] && !first) first = map[k].input;
    });
    if (first) first.focus();
    return !first;
  }

  /* ------------------------------- editors ------------------------------- */
  function sheetFor(title, nodes, onSave) {
    return openSheet({ title: title, content: h('form', { novalidate: true, onsubmit: function (e) { e.preventDefault(); } }, nodes), saveLabel: 'Save to draft', onSave: onSave });
  }

  function projectEditor(index) {
    var list = state.draft.projects.projects;
    var orig = index === -1 ? null : list[index];
    var m = orig ? clone(orig) : { id: uid('p'), title: '', url: '', type: 'short', description: '', thumbnail: '' };
    var type = m.type === 'long' ? 'long' : 'short';

    var title = field('Project title', textInput(m.title, { max: 100, placeholder: 'e.g. Podcast Short' }), { required: true });
    var shortBtn = h('button', { type: 'button', 'aria-pressed': String(type === 'short') }, ic('fa-solid fa-mobile-screen'), 'Short Form');
    var longBtn = h('button', { type: 'button', 'aria-pressed': String(type === 'long') }, ic('fa-solid fa-film'), 'Long Form');
    var typeField = h('div', { class: 'ajz-field' }, h('div', { class: 'ajz-label' }, 'Video category', h('span', { class: 'req', text: ' *' })), h('div', { class: 'ajz-seg' }, shortBtn, longBtn));
    var url = field('YouTube URL', textInput(m.url, { type: 'url', inputmode: 'url', placeholder: 'https://youtube.com/watch?v=…', max: 300, autocapitalize: 'none', spellcheck: false }),
      { required: true, hint: 'Supported: youtube.com/watch?v=… · youtu.be/… · youtube.com/shorts/… · youtube.com/embed/…' });
    var status = h('div', { class: 'ajz-ok' });
    var preview = h('div', { class: 'ajz-yt-preview short' });
    var previewField = h('div', { class: 'ajz-field' }, h('div', { class: 'ajz-label', text: 'Preview' }), preview, status);
    var desc = field('Caption / description', textArea(m.description, { max: 300, rows: 3, placeholder: 'e.g. Talking-head editing, captions, B-roll' }), { max: 300 });
    var thumb = imageField('Custom thumbnail (optional)', m.thumbnail, 'thumb');
    var shownId = null;

    function setPlaceholder(text) { shownId = null; preview.textContent = ''; preview.appendChild(h('span', { text: text })); }
    function updatePreview() {
      preview.className = 'ajz-yt-preview ' + type;
      var raw = url.input.value.trim();
      if (!raw) { url.setError(''); status.textContent = ''; return setPlaceholder('Paste a YouTube link to see a preview here.'); }
      var p = S.parseYouTubeUrl(raw);
      if (!p.ok) { url.setError(p.error); status.textContent = ''; return setPlaceholder('No preview — fix the link first.'); }
      url.setError('');
      status.textContent = '\u2713 Video detected \u00b7 ID ' + p.videoId;
      if (shownId !== p.videoId) {
        shownId = p.videoId;
        preview.textContent = '';
        preview.appendChild(h('iframe', { src: p.embedUrl + '?rel=0&playsinline=1', title: 'Video preview', loading: 'lazy', allow: 'encrypted-media; picture-in-picture; fullscreen', allowfullscreen: true, referrerpolicy: 'strict-origin-when-cross-origin' }));
      }
    }
    function setType(t) {
      type = t;
      shortBtn.setAttribute('aria-pressed', String(t === 'short'));
      longBtn.setAttribute('aria-pressed', String(t === 'long'));
      preview.className = 'ajz-yt-preview ' + t;
    }
    shortBtn.addEventListener('click', function () { setType('short'); });
    longBtn.addEventListener('click', function () { setType('long'); });
    url.input.addEventListener('input', updatePreview);
    updatePreview();

    sheetFor(index === -1 ? 'Add project' : 'Edit project', [title.el, typeField, url.el, previewField, desc.el, thumb.el], function () {
      var item = { id: m.id, title: title.input.value.trim(), url: url.input.value.trim(), videoId: '', embedUrl: '', type: type, description: desc.input.value.trim(), thumbnail: thumb.get() };
      var errs = V.projects(item);
      var p = S.parseYouTubeUrl(item.url);
      if (p.ok) { item.videoId = p.videoId; item.embedUrl = p.embedUrl; }
      var ok = showErrs({ title: title, url: url, description: desc }, errs);
      if (!thumb.validate()) ok = false;
      if (!ok) return false;
      commitItem('projects', item, index);
      return true;
    });
  }

  function experienceEditor(index) {
    var orig = index === -1 ? null : state.draft.experience.experience[index];
    var m = orig ? clone(orig) : { id: uid('e'), role: '', company: '', start: '', end: '', description: '' };
    var role = field('Role / title', textInput(m.role, { max: 100, placeholder: 'e.g. Freelance Video Editor' }), { required: true });
    var company = field('Company / client', textInput(m.company, { max: 100 }));
    var start = field('Start date', textInput(m.start, { max: 30, placeholder: 'e.g. Jan 2024' }), { required: true });
    var present = m.end === 'Present';
    var end = field('End date', textInput(present ? 'Present' : m.end, { max: 30, placeholder: 'e.g. Dec 2025' }));
    var cur = h('input', { type: 'checkbox', checked: present });
    var curLbl = h('label', { class: 'ajz-check' }, cur, 'I currently work here');
    function syncPresent() { end.input.disabled = cur.checked; if (cur.checked) end.input.value = 'Present'; else if (end.input.value === 'Present') end.input.value = ''; }
    cur.addEventListener('change', syncPresent); syncPresent();
    var desc = field('Description', textArea(m.description, { max: 600, rows: 4 }), { max: 600 });
    sheetFor(index === -1 ? 'Add experience' : 'Edit experience', [role.el, company.el, h('div', { class: 'ajz-row2' }, start.el, end.el), curLbl, desc.el], function () {
      var item = { id: m.id, role: role.input.value.trim(), company: company.input.value.trim(), start: start.input.value.trim(), end: cur.checked ? 'Present' : end.input.value.trim(), description: desc.input.value.trim() };
      if (!showErrs({ role: role, start: start, description: desc }, V.experience(item))) return false;
      commitItem('experience', item, index);
      return true;
    });
  }

  function clientEditor(index) {
    var orig = index === -1 ? null : state.draft.clients.clients[index];
    var m = orig ? clone(orig) : { id: uid('c'), name: '', info: '', logo: '', url: '' };
    var name = field('Client name', textInput(m.name, { max: 100 }), { required: true });
    var info = field('Details', textArea(m.info, { max: 300, rows: 3, placeholder: 'e.g. YouTube channel · long-form edits' }), { max: 300 });
    var site = field('Website (optional)', textInput(m.url, { type: 'url', inputmode: 'url', max: 300, placeholder: 'https://…', autocapitalize: 'none' }));
    var logo = imageField('Logo / image (optional)', m.logo, 'logo');
    sheetFor(index === -1 ? 'Add client' : 'Edit client', [name.el, info.el, site.el, logo.el], function () {
      var item = { id: m.id, name: name.input.value.trim(), info: info.input.value.trim(), logo: logo.get(), url: site.input.value.trim() };
      var errs = V.clients(item);
      var ok = showErrs({ name: name, info: info, url: site }, errs);
      if (!logo.validate()) ok = false;
      if (!ok) return false;
      commitItem('clients', item, index);
      return true;
    });
  }

  function serviceEditor(index) {
    var orig = index === -1 ? null : state.draft.services.services[index];
    var m = orig ? clone(orig) : { id: uid('s'), icon: 'fa-solid fa-star', title: '', description: '' };
    var icon = S.isValidIcon(m.icon) ? m.icon : 'fa-solid fa-star';
    var title = field('Service title', textInput(m.title, { max: 60, placeholder: 'e.g. Video Editing' }), { required: true });
    var desc = field('Description', textArea(m.description, { max: 200, rows: 3 }), { max: 200 });
    var grid = h('div', { class: 'ajz-icon-grid', role: 'group', 'aria-label': 'Icon' });
    var btns = ICONS.concat(ICONS.indexOf(icon) === -1 ? [icon] : []).map(function (cls) {
      var b = h('button', { type: 'button', 'aria-pressed': String(cls === icon), 'aria-label': cls.replace(/^fa-\w+ fa-/, '').replace(/-/g, ' '), title: cls.replace(/^fa-\w+ fa-/, '').replace(/-/g, ' ') }, ic(cls));
      b.addEventListener('click', function () { icon = cls; btns.forEach(function (x) { x.b.setAttribute('aria-pressed', String(x.cls === icon)); }); });
      grid.appendChild(b);
      return { b: b, cls: cls };
    });
    var iconField = h('div', { class: 'ajz-field' }, h('div', { class: 'ajz-label', text: 'Icon' }), grid);
    sheetFor(index === -1 ? 'Add service' : 'Edit service', [title.el, desc.el, iconField], function () {
      var item = { id: m.id, icon: icon, title: title.input.value.trim(), description: desc.input.value.trim() };
      if (!showErrs({ title: title, description: desc }, V.services(item))) return false;
      commitItem('services', item, index);
      return true;
    });
  }

  function testimonialEditor(index) {
    var orig = index === -1 ? null : state.draft.testimonials.testimonials[index];
    var m = orig ? clone(orig) : { id: uid('t'), name: '', role: '', text: '' };
    var name = field('Client name', textInput(m.name, { max: 80, placeholder: 'e.g. Rohan Mehta' }), { required: true });
    var role = field('Role / description', textInput(m.role, { max: 80, placeholder: 'e.g. Content Creator' }));
    var text = field('Testimonial', textArea(m.text, { max: 600, rows: 5 }), { required: true, max: 600 });
    sheetFor(index === -1 ? 'Add testimonial' : 'Edit testimonial', [name.el, role.el, text.el], function () {
      var item = { id: m.id, name: name.input.value.trim(), role: role.input.value.trim(), text: text.input.value.trim() };
      if (!showErrs({ name: name, role: role, text: text }, V.testimonials(item))) return false;
      commitItem('testimonials', item, index);
      return true;
    });
  }

  /* ------------------------------- about view ------------------------------- */
  function renderAboutView(wrap) {
    wrap.appendChild(h('div', { class: 'ajz-view-head' },
      h('div', null, h('h2', { text: 'About & Info' }), h('p', { text: 'Your introduction, professional title, about text, contact details and other text on the site.' })),
      h('span', { class: 'ajz-chip ajz-dirty-chip', hidden: !isDirty('about') }, ic('fa-solid fa-circle'), 'Unpublished')));
    if (!loaded('about')) {
      var err = state.server.about && state.server.about.error;
      wrap.appendChild(h('div', { class: 'ajz-banner error', text: err ? err.message : 'about.json could not be loaded.' }));
      return;
    }
    var d = state.draft.about;
    var fields = {};
    ABOUT_SCHEMA.forEach(function (g) {
      var card = h('div', { class: 'ajz-card' }, h('h3', { text: g.title }));
      g.fields.forEach(function (fd) {
        var path = fd[0], o = fd[2] || {};
        var val = getPath(d, path);
        var input = o.textarea ? textArea(typeof val === 'string' ? val : '', { max: o.max, rows: o.rows || 4 }) : textInput(typeof val === 'string' ? val : '', { type: o.type, inputmode: o.inputmode, max: o.max, autocapitalize: o.type === 'url' || o.type === 'email' ? 'none' : undefined });
        var f = field(fd[1], input, { required: o.required, max: o.max });
        input.addEventListener('input', function () { setPath(d, path, input.value); f.setError(''); updateChrome(); });
        fields[path] = f;
        card.appendChild(f.el);
      });
      wrap.appendChild(card);
    });
    state.aboutFields = fields;
    if (state.aboutErrors) showErrs(fields, state.aboutErrors);
  }

  /* ------------------------------ data loading ------------------------------ */
  function isObj(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
  function shapeProblem(name, data) {
    if (name === 'about') {
      var ok = isObj(data) && isObj(data.hero) && Array.isArray(data.stats) && data.stats.length === 4 && isObj(data.sections) && isObj(data.about) && isObj(data.contact) && isObj(data.footer);
      return ok ? '' : 'about.json has an unexpected format.';
    }
    return isObj(data) && Array.isArray(data[DEFS[name].key]) ? '' : name + '.json has an unexpected format.';
  }
  function adopt(name, f) {
    var entry = f || { ok: false, error: { message: 'Missing from the server response.' } };
    if (entry.ok) {
      var problem = shapeProblem(name, entry.data);
      if (problem) entry = { ok: false, error: { message: problem } };
    }
    state.server[name] = entry;
    if (entry.ok) state.draft[name] = clone(entry.data); else delete state.draft[name];
  }

  function loadAll() {
    state.loading = true; state.loadError = null; render();
    return api('GET', '/api/content').then(function (res) {
      FILES.forEach(function (n) { adopt(n, res.files[n]); });
    }).catch(function (e) {
      if (handleAuthError(e)) return;
      state.loadError = e.message;
    }).then(function () { state.loading = false; render(); });
  }
  function reloadFile(name) {
    return api('GET', '/api/content?file=' + encodeURIComponent(name)).then(function (res) { adopt(name, res.files[name]); render(); });
  }
  function reloadAllConfirm() {
    var go_ = function () { state.aboutErrors = null; loadAll(); };
    if (!dirtyNames().length) return go_();
    confirmDialog({ title: 'Reload from GitHub?', danger: true, confirmLabel: 'Discard & reload', message: 'This replaces your unpublished changes with the latest content from GitHub.' }).then(function (ok) { if (ok) go_(); });
  }
  function discardAll() {
    confirmDialog({ title: 'Discard all changes?', danger: true, confirmLabel: 'Discard', message: 'Your unpublished changes will be thrown away. The website is not affected.' }).then(function (ok) {
      if (!ok) return;
      dirtyNames().forEach(function (n) { state.draft[n] = clone(state.server[n].data); });
      state.aboutErrors = null;
      render();
      toast('Changes discarded.', 'info');
    });
  }

  /* --------------------------- login / session / logout --------------------------- */
  function showLogin(o) {
    if (loginEl) return;
    var pw = h('input', { class: 'ajz-input', type: 'password', autocomplete: 'current-password', placeholder: 'Password', 'aria-label': 'Admin password', maxlength: '200', id: 'ajzPassword', autocapitalize: 'none', spellcheck: 'false' });
    var eye = h('button', { type: 'button', class: 'ajz-icon-btn', 'aria-label': 'Show password', 'aria-pressed': 'false' }, ic('fa-regular fa-eye'));
    var err = h('div', { class: 'ajz-err', role: 'alert' });
    var btn = h('button', { type: 'submit', class: 'ajz-btn ajz-btn-primary' }, 'Login');
    var closeBtn = h('button', { type: 'button', class: 'ajz-icon-btn ajz-login-close', 'aria-label': 'Close' }, ic('fa-solid fa-xmark'));
    var busy = false;

    eye.addEventListener('click', function () {
      var show = pw.type === 'password';
      pw.type = show ? 'text' : 'password';
      eye.setAttribute('aria-pressed', String(show));
      eye.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
      eye.textContent = ''; eye.appendChild(ic(show ? 'fa-regular fa-eye-slash' : 'fa-regular fa-eye'));
      pw.focus();
    });
    function setBusy(b) {
      busy = b; btn.disabled = b; pw.disabled = b;
      btn.textContent = '';
      if (b) { btn.appendChild(h('span', { class: 'ajz-spin' })); btn.appendChild(document.createTextNode('Verifying\u2026')); } else btn.appendChild(document.createTextNode('Login'));
    }
    function dismiss() { document.removeEventListener('keydown', onKey, true); loginEl.remove(); loginEl = null; }
    function onKey(e) { if (e.key === 'Escape' && !busy) cancel(); }
    function cancel() { dismiss(); if (!state.authed) { if (root) root.hidden = true; document.body.classList.remove('ajz-lock'); state.open = false; } }
    document.addEventListener('keydown', onKey, true);
    closeBtn.addEventListener('click', function () { if (!busy) cancel(); });

    var form = h('form', { novalidate: true, onsubmit: function (e) {
      e.preventDefault();
      if (busy) return;
      err.textContent = '';
      if (!pw.value) { err.textContent = 'Enter your password.'; pw.focus(); return; }
      setBusy(true);
      api('POST', '/api/login', { password: pw.value }).then(function (res) {
        pw.value = '';
        dismiss();
        onAuthed(res.expiresAt);
        if (o && o.onSuccess) o.onSuccess();
      }, function (e2) {
        setBusy(false);
        err.textContent = e2.message;
        pw.focus(); pw.select();
      });
    } },
      h('div', { class: 'ajz-pw' }, pw, eye), btn, err);

    loginEl = h('div', { class: 'ajz-backdrop', role: 'presentation' },
      h('div', { class: 'ajz-login', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'ajzLoginTitle' },
        closeBtn,
        h('div', { class: 'ajz-login-icon' }, ic('fa-solid fa-lock')),
        h('h2', { id: 'ajzLoginTitle', text: 'Admin Panel' }),
        h('p', { class: 'sub', text: 'Enter your password to activate admin panel' }),
        o && o.notice ? h('div', { class: 'ajz-notice', role: 'status', text: o.notice }) : null,
        form));
    document.body.appendChild(loginEl);
    setTimeout(function () { pw.focus(); }, 40);
  }

  function setExpiry(expiresAt) {
    state.expiresAt = expiresAt;
    clearTimeout(state.expiryTimer);
    var ms = Math.min(2147483000, Math.max(0, expiresAt - Date.now()));
    state.expiryTimer = setTimeout(sessionExpired, ms);
  }

  function onAuthed(expiresAt) {
    state.authed = true;
    setExpiry(expiresAt);
    if (!root) buildShell();
    var needsLoad = FILES.some(function (n) { return !state.server[n]; });
    if (needsLoad || state.loadError) {
      // show the loading state straight away so nothing half-initialised is ever visible
      root.hidden = false;
      document.body.classList.add('ajz-lock');
      loadAll();
    } else {
      showDashboard();
    }
  }

  function handleAuthError(e) {
    if (e && e.status === 401 && e.code === 'unauthorized') { sessionExpired(); return true; }
    return false;
  }

  function sessionExpired() {
    if (!state.authed && loginEl) return;
    state.authed = false;
    clearTimeout(state.expiryTimer);
    if (state.previewing) endPreview();
    showLogin({ notice: 'Your session expired. Log in again to continue \u2014 your unpublished edits are still here.' });
  }

  function logout() {
    var doLogout = function () {
      api('POST', '/api/logout', {}).then(function () {
        state.authed = false; state.server = {}; state.draft = {}; state.pendingFiles = {}; state.uploaded = {}; state.aboutErrors = null; state.loadError = null; state.view = 'dashboard';
        clearTimeout(state.expiryTimer);
        Object.keys(R.pendingImages).forEach(function (k) { delete R.pendingImages[k]; });
        close();
        toast('You have been logged out.', 'info');
      }, function (e) { toast('Could not log out: ' + e.message, 'error'); });
    };
    if (dirtyNames().length) {
      confirmDialog({ title: 'Log out with unpublished changes?', danger: true, confirmLabel: 'Log out', message: 'Your unpublished changes will be lost.' }).then(function (ok) { if (ok) doLogout(); });
    } else doLogout();
  }

  /* ---------------------------- open / close ---------------------------- */
  function showDashboard() {
    root.hidden = false;
    document.body.classList.add('ajz-lock');
    render();
  }
  function open() {
    state.open = true;
    if (!root) buildShell();
    if (state.authed) { showDashboard(); return; }
    api('GET', '/api/session').then(function (res) {
      if (res.authenticated) onAuthed(res.expiresAt); else showLogin({});
    }, function () { showLogin({}); });
  }
  function close() {
    if (state.previewing) endPreview();
    if (root) root.hidden = true;
    document.body.classList.remove('ajz-lock');
    state.open = false;
  }

  window.addEventListener('beforeunload', function (e) {
    if (dirtyNames().length) { e.preventDefault(); e.returnValue = ''; }
  });

  /* -------------------------------- preview -------------------------------- */
  function validateOrShow(names) {
    var problems = [];
    state.aboutErrors = null;
    names.forEach(function (n) { problems = problems.concat(validateDraft(n)); });
    if (!problems.length) return true;
    var list = h('ul', { class: 'ajz-changes' }, problems.slice(0, 8).map(function (p) { return h('li', null, h('b', { text: FILE_TITLE[p.file] }), p.message); }));
    var firstFile = problems[0].file;
    alertDialog('Please fix these first', h('div', null, h('p', { text: 'Some content is missing or invalid, so it cannot be previewed or published yet.', style: 'margin-bottom:12px' }), list)).then(function () {
      go(firstFile);
    });
    return false;
  }

  function startPreview() {
    var dirty = dirtyNames();
    if (!dirty.length) { toast('There are no changes to preview.', 'info'); return; }
    if (!validateOrShow(dirty)) return;
    var map = {};
    FILES.forEach(function (n) { if (loaded(n)) map[n] = clone(state.draft[n]); });
    state.previewing = true;
    root.hidden = true;
    document.body.classList.remove('ajz-lock');
    actionBar.hidden = true;
    previewBar.hidden = false;
    window.AjazSite.applyPreview(map);

    // jump to the first thing that changed (and the right Short/Long tab for projects)
    var target = dirty[0];
    if (dirty.indexOf('projects') !== -1) {
      var changed = describeDiff('projects');
      var base = {}; items('projects', state.server.projects.data).forEach(function (x) { base[x.id] = stable(x); });
      var touched = items('projects', map.projects).filter(function (x) { return base[x.id] !== stable(x); });
      var last = touched[touched.length - 1];
      if (last && changed.length) {
        var tab = document.querySelector('.format-toggle button[data-format="' + last.type + '"]');
        if (tab) tab.click();
      }
    }
    setTimeout(function () {
      var sec = document.getElementById(SITE_SECTION[target]);
      if (sec && !sec.hidden) sec.scrollIntoView({ behavior: 'auto', block: 'start' }); else window.scrollTo(0, 0);
    }, 60);
  }

  function endPreview() {
    if (!state.previewing) return;
    state.previewing = false;
    previewBar.hidden = true;
    window.AjazSite.restore();
    if (state.open) { showDashboard(); }
  }

  /* -------------------------------- publish -------------------------------- */
  state.uploaded = {};

  function stepRow(title) {
    var mark = h('div', { class: 'mark' });
    var small = h('small');
    var el = h('div', { class: 'ajz-step wait' }, mark, h('div', null, h('b', { text: title }), small));
    function set(st, msg, node) {
      el.className = 'ajz-step ' + st;
      mark.textContent = '';
      mark.appendChild(st === 'work' ? h('span', { class: 'ajz-spin light' }) : ic(st === 'ok' ? 'fa-solid fa-circle-check' : st === 'fail' ? 'fa-solid fa-circle-xmark' : 'fa-regular fa-circle'));
      small.textContent = msg || '';
      if (node) small.appendChild(node);
    }
    set('wait', 'Waiting\u2026');
    return { el: el, set: set };
  }

  function collectPending(name, payload) {
    var key = name === 'projects' ? 'thumbnail' : name === 'clients' ? 'logo' : null;
    if (!key) return [];
    return items(name, payload).filter(function (it) { return typeof it[key] === 'string' && it[key].indexOf('pending:') === 0; }).map(function (it) { return { item: it, key: key }; });
  }

  function uploadOne(id) {
    if (state.uploaded[id]) return Promise.resolve(state.uploaded[id]);
    var f = state.pendingFiles[id];
    if (!f) return Promise.reject(new ApiError(0, 'missing_image', 'A selected image is no longer available. Edit the item and choose the image again.'));
    return api('POST', '/api/upload', { data: f.base64 }).then(function (res) {
      state.uploaded[id] = res.path;
      R.pendingImages[res.path] = R.pendingImages[id]; // keep showing the local copy until the deployment is live
      return res.path;
    });
  }

  function publishOne(name, row, force) {
    row.set('work', 'Preparing\u2026');
    var payload = clone(state.draft[name]);
    var pend = collectPending(name, payload);
    var chain = Promise.resolve();
    pend.forEach(function (p, i) {
      chain = chain.then(function () {
        row.set('work', 'Uploading image ' + (i + 1) + ' of ' + pend.length + '\u2026');
        return uploadOne(p.item[p.key]).then(function (path) { p.item[p.key] = path; });
      });
    });
    return chain.then(function () {
      row.set('work', 'Sending to GitHub\u2026');
      return api('PUT', '/api/content', { file: name, data: payload, baseSha: state.server[name].sha || null, force: !!force });
    }).then(function (res) {
      state.server[name] = { ok: true, exists: true, sha: res.sha, data: res.data };
      state.draft[name] = clone(res.data);
      if (res.unchanged) { row.set('ok', 'Nothing to commit \u2014 already matches GitHub.'); return { status: 'ok', data: res.data, committed: false }; }
      var link = res.commit && res.commit.url ? h('a', { href: res.commit.url, target: '_blank', rel: 'noopener noreferrer', text: String(res.commit.sha).slice(0, 7) }) : null;
      row.set('ok', 'Changes committed to GitHub' + (link ? ' (commit ' : '.'), link);
      if (link) row.el.querySelector('small').appendChild(document.createTextNode(').'));
      return { status: 'ok', data: res.data, committed: true };
    }, function (e) {
      if (e.status === 401 && e.code === 'unauthorized') { row.set('fail', 'Your session expired.'); return { status: 'auth', error: e }; }
      if (e.status === 409 && e.code === 'conflict') { row.set('fail', e.message); return { status: 'conflict', error: e }; }
      var detail = e.code === 'validation' && e.body && e.body.errors ? e.body.errors.slice(0, 3).map(function (x) { return x.message; }).join(' ') : '';
      row.set('fail', (detail || e.message) + ' Nothing was published for this section.');
      return { status: 'fail', error: e };
    });
  }

  function publishAll() {
    var names = dirtyNames();
    if (!names.length) { toast('There are no changes to publish.', 'info'); return; }
    if (!validateOrShow(names)) return;
    openSheet({
      title: 'Publish changes?', saveLabel: 'Publish now',
      content: h('div', null, h('p', { text: 'These changes will be saved to your GitHub repository. Vercel then deploys the update automatically.', style: 'margin-bottom:14px' }), changesNode(names)),
      onSave: function () { setTimeout(function () { runPublish(names, {}); }, 0); return true; }
    });
  }

  function runPublish(names, forceMap) {
    var rows = {};
    var stepsEl = h('div', { class: 'ajz-steps' });
    names.forEach(function (n) { rows[n] = stepRow(FILE_TITLE[n]); stepsEl.appendChild(rows[n].el); });
    var finalBox = h('div', { 'aria-live': 'polite' });
    var actions = h('div', { class: 'ajz-actions', style: 'margin-top:12px' });
    var stopped = false;
    var opts = { title: 'Publishing', saveLabel: null, cancelLabel: 'Close', locked: true, noBackdropClose: true, content: h('div', null, stepsEl, finalBox, actions), onClose: function () { stopped = true; } };
    var sheet = openSheet(opts);
    sheet.cancelBtn.disabled = true; sheet.closeBtn.disabled = true;
    function unlock() { opts.locked = false; sheet.cancelBtn.disabled = false; sheet.closeBtn.disabled = false; }
    function box(cls, text) { finalBox.className = 'ajz-final ' + cls; finalBox.textContent = text; }
    var expected = {};
    var anyCommit = false;

    function stopWith(i, r) {
      for (var j = i + 1; j < names.length; j++) rows[names[j]].set('wait', 'Not attempted.');
      var n = names[i];
      unlock(); render();
      if (r.status === 'conflict') {
        box('err', 'Someone changed ' + FILE_TITLE[n] + ' on GitHub since you loaded it. Nothing was overwritten. Choose what to do:');
        actions.appendChild(h('button', { type: 'button', class: 'ajz-btn', onclick: function () {
          sheet.close(false);
          reloadFile(n).then(function () { toast('Loaded the latest ' + FILE_TITLE[n] + ' from GitHub. Re-apply your edits if needed.', 'info'); }, function (e) { if (!handleAuthError(e)) toast(e.message, 'error'); });
        } }, ic('fa-solid fa-rotate'), 'Load latest (discard my edits)'));
        actions.appendChild(h('button', { type: 'button', class: 'ajz-btn ajz-btn-danger', onclick: function () {
          sheet.close(false);
          var fm = {}; fm[n] = true;
          runPublish(dirtyNames(), fm);
        } }, ic('fa-solid fa-triangle-exclamation'), 'Overwrite with my version'));
      } else if (r.status === 'auth') {
        box('err', 'Your admin session expired, so nothing further was published. Log in again, then press Publish again. Your edits are kept.');
        actions.appendChild(h('button', { type: 'button', class: 'ajz-btn ajz-btn-primary', onclick: function () { sheet.close(false); sessionExpired(); } }, ic('fa-solid fa-lock'), 'Log in again'));
      } else {
        box('err', (anyCommit ? 'Publishing stopped. Sections above that show \u201ccommitted\u201d were saved to GitHub; the rest were not. ' : 'Publishing failed. Nothing was saved to GitHub. ') + 'Your edits are still in the draft.');
        actions.appendChild(h('button', { type: 'button', class: 'ajz-btn ajz-btn-primary', onclick: function () { sheet.close(false); runPublish(dirtyNames(), {}); } }, ic('fa-solid fa-rotate'), 'Try again'));
      }
    }

    function next(i) {
      if (stopped) return;
      if (i >= names.length) return finish();
      var n = names[i];
      publishOne(n, rows[n], forceMap[n]).then(function (r) {
        if (r.status !== 'ok') return stopWith(i, r);
        if (r.committed) { anyCommit = true; expected[n] = r.data; }
        next(i + 1);
      });
    }

    function finish() {
      unlock(); render();
      var names2 = Object.keys(expected);
      if (!names2.length) { box('ok', 'Nothing needed publishing \u2014 everything already matches GitHub.'); return; }
      box('warn', 'Changes committed to GitHub. This is not live yet: Vercel is now building the deployment, which usually takes 1\u20132 minutes. Checking for the new version\u2026');
      var start = Date.now();
      var pending = names2.slice();
      (function tick() {
        if (stopped) return;
        Promise.all(pending.map(function (n) {
          return window.AjazSite.fetchPublic(n).then(function (live) { return stable(live) === stable(expected[n]); }, function () { return false; });
        })).then(function (res) {
          pending = pending.filter(function (n, i) { return !res[i]; });
          if (!pending.length) { box('ok', 'Deployment completed \u2014 your changes are now live on the website.'); if (window.AjazSite.reload) window.AjazSite.reload(); return; }
          if (Date.now() - start > 240000) { box('warn', 'Changes are committed to GitHub, but the new deployment has not been detected yet. Check the Vercel dashboard \u2014 it may still be building, or the build may have failed.'); return; }
          setTimeout(tick, 5000);
        });
      })();
    }

    next(0);
  }

  window.AjazAdmin = { open: open, close: close };
})();
