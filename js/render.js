/*
 * Renders the JSON content (data/*.json) into the existing page markup.
 * The generated markup is identical to the original hand-written HTML so all
 * existing CSS/JS keeps working. User content is only ever inserted with
 * textContent / setAttribute (never innerHTML), so it cannot inject markup.
 */
(function (root) {
  'use strict';
  var S = root.AjazShared;

  // Images chosen in the admin panel but not uploaded yet: "pending:<id>" -> data URL
  var pendingImages = {};

  function $(id) { return document.getElementById(id); }

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'text') node.textContent = attrs[k];
      else if (k === 'class') node.className = attrs[k];
      else node.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { if (c) node.appendChild(c); });
    return node;
  }

  function setText(id, value) {
    var n = $(id);
    if (n && typeof value === 'string') n.textContent = value;
  }

  /** Turns a stored image reference into something an <img> can load. */
  function imageSrc(ref) {
    if (!ref) return '';
    // local copy of an image chosen/uploaded in the admin panel (not deployed yet)
    if (pendingImages[ref]) return pendingImages[ref];
    if (ref.indexOf('pending:') === 0) return '';
    if (S.isUploadPath(ref)) return '/' + ref;
    return S.isHttpsUrl(ref) ? ref : '';
  }

  function youtubeThumb(videoId) {
    return 'https://img.youtube.com/vi/' + videoId + '/hqdefault.jpg';
  }

  /* ------------------------------ about ---------------------------------- */
  function setLink(a, url) {
    if (!a) return;
    if (url) { a.setAttribute('href', url); a.hidden = false; }
    else { a.hidden = true; }
  }

  function renderAbout(d) {
    if (!d || !d.hero) return;
    document.querySelectorAll('[data-brand]').forEach(function (n) { n.textContent = d.brandName; });

    setText('heroEyebrow', d.hero.eyebrow);
    setText('heroGreeting', d.hero.greeting);
    setText('heroName', d.hero.name);
    setText('heroTitle', d.hero.title);
    setText('heroIntro', d.hero.intro);

    (d.stats || []).forEach(function (s, i) {
      var v = document.querySelector('[data-stat-value="' + i + '"]');
      var l = document.querySelector('[data-stat-label="' + i + '"]');
      if (v) v.textContent = s.value;
      if (l) l.textContent = s.label;
    });

    var sec = d.sections || {};
    Object.keys(sec).forEach(function (k) {
      var t = document.querySelector('[data-sec-tag="' + k + '"]');
      var h = document.querySelector('[data-sec-title="' + k + '"]');
      if (t) { t.textContent = sec[k].tag; t.hidden = !sec[k].tag; }
      if (h) h.textContent = sec[k].title;
    });

    if (d.about) {
      setText('aboutTag', d.about.tag);
      setText('aboutHeading', d.about.heading);
      setText('aboutText', d.about.text);
      setText('aboutSignature', d.about.signature);
    }

    var c = d.contact || {};
    setText('contactTag', c.tag);
    setText('contactHeading', c.heading);
    setText('contactText', c.text);

    // Email, Instagram, LinkedIn, YouTube (links + labels)
    setLinkGroup('email', c.email ? 'mailto:' + c.email : '', c.email);
    ['instagram', 'linkedin', 'youtube'].forEach(function (k) {
      var o = c[k] || {};
      setLinkGroup(k, o.url, o.label);
    });

    // WhatsApp: shows the text; becomes a link when it looks like a phone number
    var wa = $('contactWhatsapp');
    var waVal = $('contactWhatsappValue');
    if (wa && waVal) {
      var text = c.whatsapp || '';
      waVal.textContent = text;
      var digits = text.replace(/[^\d]/g, '');
      var looksLikeNumber = /^[+\d][\d\s().-]{6,}$/.test(text) && digits.length >= 7 && digits.length <= 15;
      if (looksLikeNumber) {
        wa.setAttribute('href', 'https://wa.me/' + digits);
        wa.setAttribute('target', '_blank');
        wa.setAttribute('rel', 'noopener');
        wa.style.cursor = '';
      } else {
        wa.setAttribute('href', 'javascript:void(0)'); // eslint-disable-line no-script-url
        wa.removeAttribute('target');
        wa.style.cursor = 'default';
      }
      wa.hidden = !text;
    }

    if (d.footer) setText('footerCopyright', d.footer.copyright);
  }

  function setLinkGroup(key, url, label) {
    document.querySelectorAll('[data-link="' + key + '"]').forEach(function (a) { setLink(a, url); });
    document.querySelectorAll('[data-link-label="' + key + '"]').forEach(function (n) { n.textContent = label || ''; });
  }

  /* ----------------------------- projects -------------------------------- */
  function projectCard(p) {
    var thumb = imageSrc(p.thumbnail) || youtubeThumb(p.videoId);
    var img = el('img', { src: thumb, alt: p.title, loading: 'lazy' });
    img.addEventListener('error', function () {
      // custom thumbnail failed -> fall back to the YouTube thumbnail once
      var fb = youtubeThumb(p.videoId);
      if (img.src !== fb) img.src = fb;
    });
    var play = el('div', { class: 'play-btn' }, [el('i', { class: 'fa-solid fa-play' })]);
    return el('div', {
      class: 'project-card reveal',
      'data-format': p.type === 'long' ? 'long' : 'short',
      'data-video': p.videoId
    }, [
      el('div', { class: 'project-thumb' }, [img, play]),
      el('div', { class: 'project-info' }, [el('h4', { text: p.title }), el('p', { text: p.description || '' })])
    ]);
  }

  function renderProjects(list) {
    var grid = $('portfolioGrid');
    if (!grid) return;
    grid.textContent = '';
    (list || []).forEach(function (p) { grid.appendChild(projectCard(p)); });
  }

  /* ----------------------------- services -------------------------------- */
  function renderServices(list) {
    var grid = $('servicesGrid');
    if (!grid) return;
    grid.textContent = '';
    (list || []).forEach(function (s) {
      var icon = S.isValidIcon(s.icon) ? s.icon : 'fa-solid fa-star';
      grid.appendChild(el('div', { class: 'service-card reveal' }, [
        el('div', { class: 'service-icon' }, [el('i', { class: icon })]),
        el('h4', { text: s.title }),
        el('p', { text: s.description || '' })
      ]));
    });
  }

  /* ---------------------------- experience ------------------------------- */
  function renderExperience(list) {
    var sec = $('experience');
    var wrap = $('experienceList');
    if (!sec || !wrap) return;
    wrap.textContent = '';
    (list || []).forEach(function (e) {
      var dates = [e.start, e.end].filter(Boolean).join(' – ');
      var head = el('div', { class: 'timeline-head' }, [
        el('h4', { text: e.role }),
        e.company ? el('span', { class: 'timeline-company', text: e.company }) : null
      ]);
      wrap.appendChild(el('div', { class: 'timeline-item reveal' }, [
        el('div', { class: 'timeline-dates', text: dates }),
        el('div', { class: 'timeline-body' }, [head, e.description ? el('p', { text: e.description }) : null])
      ]));
    });
    sec.hidden = !(list && list.length);
  }

  /* ------------------------------ clients -------------------------------- */
  function renderClients(list) {
    var sec = $('clients');
    var wrap = $('clientsGrid');
    if (!sec || !wrap) return;
    wrap.textContent = '';
    (list || []).forEach(function (c) {
      var logoSrc = imageSrc(c.logo);
      var visual = logoSrc
        ? el('div', { class: 'client-logo' }, [el('img', { src: logoSrc, alt: c.name + ' logo', loading: 'lazy' })])
        : el('div', { class: 'client-logo client-initial', text: (c.name || '?').trim().charAt(0).toUpperCase() });
      var body = el('div', { class: 'client-body' }, [
        el('h4', { text: c.name }),
        c.info ? el('p', { text: c.info }) : null
      ]);
      var card;
      if (c.url && S.isHttpUrl(c.url)) {
        card = el('a', { class: 'client-card reveal', href: c.url, target: '_blank', rel: 'noopener noreferrer' }, [visual, body]);
      } else {
        card = el('div', { class: 'client-card reveal' }, [visual, body]);
      }
      wrap.appendChild(card);
    });
    sec.hidden = !(list && list.length);
  }

  root.AjazRender = {
    renderAbout: renderAbout,
    renderProjects: renderProjects,
    renderServices: renderServices,
    renderExperience: renderExperience,
    renderClients: renderClients,
    imageSrc: imageSrc,
    youtubeThumb: youtubeThumb,
    pendingImages: pendingImages
  };
})(window);
