/*
 * Shared helpers used by BOTH the browser (public site + admin panel) and the
 * Vercel serverless API. Keeping a single copy guarantees that what the admin
 * panel accepts is exactly what the server accepts.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AjazShared = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;
  var YT_HOSTS = ['youtube.com', 'www.youtube.com', 'm.youtube.com'];
  var YT_NOCOOKIE_HOSTS = ['youtube-nocookie.com', 'www.youtube-nocookie.com'];

  /**
   * Extract the 11-character YouTube video ID from a supported URL.
   * Supported:
   *   youtube.com/watch?v=ID   youtu.be/ID
   *   youtube.com/shorts/ID    youtube.com/embed/ID
   * Returns { ok: true, videoId, embedUrl, watchUrl, kind } or { ok: false, error }.
   */
  function parseYouTubeUrl(input) {
    if (typeof input !== 'string') return fail('Enter a YouTube URL.');
    var raw = input.trim();
    if (!raw) return fail('Enter a YouTube URL.');
    if (raw.length > 300) return fail('That URL is too long.');
    if (/\s/.test(raw)) return fail('A URL cannot contain spaces.');

    // Accept links pasted without a scheme, e.g. "youtu.be/abc..."
    var candidate = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : 'https://' + raw;

    var u;
    try { u = new URL(candidate); } catch (e) { return fail('That does not look like a valid URL.'); }

    if (u.protocol !== 'https:' && u.protocol !== 'http:') return fail('Only http(s) links are supported.');
    if (u.username || u.password) return fail('URLs with credentials are not supported.');

    var host = u.hostname.toLowerCase();
    var path = u.pathname.replace(/\/+$/, '');
    var id = null;
    var kind = null;

    if (host === 'youtu.be') {
      var m = path.match(/^\/([^/]+)$/);
      if (m) { id = m[1]; kind = 'youtu.be'; }
    } else if (YT_HOSTS.indexOf(host) !== -1) {
      if (path === '/watch') {
        id = u.searchParams.get('v'); kind = 'watch';
      } else {
        var s = path.match(/^\/shorts\/([^/]+)$/);
        var e2 = path.match(/^\/embed\/([^/]+)$/);
        if (s) { id = s[1]; kind = 'shorts'; }
        else if (e2) { id = e2[1]; kind = 'embed'; }
      }
    } else if (YT_NOCOOKIE_HOSTS.indexOf(host) !== -1) {
      var e3 = path.match(/^\/embed\/([^/]+)$/);
      if (e3) { id = e3[1]; kind = 'embed'; }
    } else {
      return fail('Only YouTube links are supported (youtube.com or youtu.be).');
    }

    if (!id) {
      return fail('Unsupported YouTube link. Use a watch, youtu.be, shorts or embed link.');
    }
    if (!VIDEO_ID_RE.test(id)) return fail('The video ID in that link is not valid.');

    return {
      ok: true,
      videoId: id,
      kind: kind,
      embedUrl: 'https://www.youtube.com/embed/' + id,
      watchUrl: 'https://www.youtube.com/watch?v=' + id
    };
  }

  function fail(error) { return { ok: false, error: error }; }

  /** true for absolute https URLs (used for external image links). */
  function isHttpsUrl(value) {
    if (typeof value !== 'string' || value.length > 500 || /\s/.test(value)) return false;
    try {
      var u = new URL(value);
      return u.protocol === 'https:' && !u.username && !u.password;
    } catch (e) { return false; }
  }

  /** true for http(s) or mailto-free external links (social profiles). */
  function isHttpUrl(value) {
    if (typeof value !== 'string' || value.length > 500 || /\s/.test(value)) return false;
    try {
      var u = new URL(value);
      return (u.protocol === 'https:' || u.protocol === 'http:') && !u.username && !u.password;
    } catch (e) { return false; }
  }

  /** Images uploaded through the admin panel live here in the repository. */
  var UPLOAD_PATH_RE = /^assets\/uploads\/[A-Za-z0-9._-]{1,100}\.(png|jpg|jpeg|webp|gif)$/;
  function isUploadPath(value) {
    return typeof value === 'string' && UPLOAD_PATH_RE.test(value) && value.indexOf('..') === -1;
  }

  /** An image reference is either empty, an https URL or an uploaded asset path. */
  function isValidImageRef(value) {
    return value === '' || isHttpsUrl(value) || isUploadPath(value);
  }

  /** Font Awesome class string such as "fa-solid fa-scissors". */
  var ICON_RE = /^fa-(solid|regular|brands) fa-[a-z0-9]+(-[a-z0-9]+)*$/;
  function isValidIcon(value) { return typeof value === 'string' && value.length <= 60 && ICON_RE.test(value); }

  return {
    parseYouTubeUrl: parseYouTubeUrl,
    isHttpsUrl: isHttpsUrl,
    isHttpUrl: isHttpUrl,
    isUploadPath: isUploadPath,
    isValidImageRef: isValidImageRef,
    isValidIcon: isValidIcon,
    VIDEO_ID_RE: VIDEO_ID_RE
  };
});
