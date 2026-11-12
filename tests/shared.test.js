'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../js/shared.js');

const ID = 'dQw4w9WgXcQ';
const good = [
  [`https://www.youtube.com/watch?v=${ID}`, 'watch'],
  [`https://youtube.com/watch?v=${ID}&t=42s&list=PL123`, 'watch'],
  [`https://m.youtube.com/watch?feature=share&v=${ID}`, 'watch'],
  [`https://youtu.be/${ID}`, 'youtu.be'],
  [`https://youtu.be/${ID}?si=AbCdEf`, 'youtu.be'],
  [`https://www.youtube.com/shorts/${ID}`, 'shorts'],
  [`https://youtube.com/shorts/${ID}?feature=share`, 'shorts'],
  [`https://www.youtube.com/embed/${ID}`, 'embed'],
  [`https://www.youtube-nocookie.com/embed/${ID}`, 'embed'],
  [`youtube.com/watch?v=${ID}`, 'watch'],           // no scheme
  [`  youtu.be/${ID}  `, 'youtu.be'],               // padded
  [`HTTPS://WWW.YOUTUBE.COM/shorts/${ID}/`, 'shorts'], // case + trailing slash
  [`http://youtu.be/${ID}`, 'youtu.be']
];
for (const [url, kind] of good) {
  test(`youtube: accepts ${url.trim()}`, () => {
    const r = S.parseYouTubeUrl(url);
    assert.equal(r.ok, true, r.error);
    assert.equal(r.videoId, ID);
    assert.equal(r.kind, kind);
    assert.equal(r.embedUrl, `https://www.youtube.com/embed/${ID}`);
  });
}

const bad = [
  '', '   ', null, undefined, 42, 'hello', 'https://vimeo.com/123456789',
  'https://youtube.com.evil.example/watch?v=' + ID, 'https://evil.example/https://youtu.be/' + ID,
  'https://notyoutube.com/watch?v=' + ID, 'https://youtube.com/watch', 'https://youtube.com/watch?v=short',
  'https://youtube.com/watch?v=' + ID + 'extra', 'https://youtu.be/', 'https://youtu.be/a/b',
  'https://www.youtube.com/channel/UC12345678901234567890', 'https://www.youtube.com/playlist?list=PL12345',
  'javascript:alert(1)', 'data:text/html,<script>', 'ftp://youtu.be/' + ID, 'https://user:pw@youtu.be/' + ID,
  'https://youtube.com/watch?v=<script>al', 'https://youtu.be/' + ID + ' extra', 'https://www.youtube.com/shorts/',
  'https://youtu.be/' + 'a'.repeat(400)
];
for (const url of bad) {
  test(`youtube: rejects ${String(JSON.stringify(url)).slice(0, 60)}`, () => {
    const r = S.parseYouTubeUrl(url);
    assert.equal(r.ok, false);
    assert.ok(typeof r.error === 'string' && r.error.length > 0);
  });
}

test('image refs: only empty, https or uploaded paths', () => {
  for (const ok of ['', 'https://img.example/a.png', 'assets/uploads/20261112-abcdef1234.png']) assert.ok(S.isValidImageRef(ok), ok);
  for (const no of ['http://x/a.png', 'javascript:alert(1)', '//x/a.png', 'assets/uploads/../../x.png', 'assets/uploads/a.svg', '/etc/passwd', 'data:image/png;base64,AAAA', 'pending:abc']) assert.ok(!S.isValidImageRef(no), no);
});

test('icons: only font awesome class strings', () => {
  assert.ok(S.isValidIcon('fa-solid fa-scissors'));
  assert.ok(S.isValidIcon('fa-brands fa-youtube'));
  for (const no of ['', 'fa-solid', 'fa-solid fa-x" onclick="alert(1)', '<i>', 'fa-solid fa-a b']) assert.ok(!S.isValidIcon(no), no);
});
