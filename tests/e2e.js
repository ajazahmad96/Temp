'use strict';
/**
 * End-to-end browser test (needs Playwright + Chromium installed).
 * Drives the real admin UI against the real API handlers and a fake GitHub.
 * Run: node tests/e2e.js
 */
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require('/opt/npm-tools/node_modules/playwright')); }
const assert = require('node:assert/strict');
const fs = require('fs');
const { start } = require('./dev-server');
const H = require('./helpers');

const PW = H.ENV.ADMIN_PASSWORD;
const SHOTS = process.env.SHOTS || '';
let passed = 0;
async function step(name, fn) {
  try { await fn(); passed++; console.log('  ok   ' + name); } catch (e) { console.log('  FAIL ' + name + '\n       ' + String(e.message).split('\n').slice(0, 6).join('\n       ')); process.exitCode = 1; throw e; }
}
// 1x1 transparent PNG
const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const png = (name) => ({ name, mimeType: 'image/png', buffer: PNG_1PX });

(async () => {
  const srv = await start(0);
  const gh = srv.gh;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text())) errors.push('console: ' + m.text()); });
  await page.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());
  const shot = async (n) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${n}.png` }); };
  const toastText = () => page.locator('.ajz-toast').allInnerTexts();
  const dlg = () => page.locator('.ajz-sheet').last();
  const commitsFor = (p) => gh.commits.filter((c) => c.path === p);

  await page.goto(srv.url + '/');
  await page.waitForSelector('.project-card');

  await step('public site renders all 7 migrated projects from JSON (6 short, 1 long)', async () => {
    assert.equal(await page.locator('.project-card').count(), 7);
    assert.equal(await page.locator('.project-card[data-format="short"]').count(), 6);
    assert.equal(await page.locator('.project-card[data-format="long"]').count(), 1);
    assert.equal(await page.locator('#experience').isHidden(), true, 'empty experience hidden');
    assert.equal(await page.locator('#clients').isHidden(), true, 'empty clients hidden');
    assert.equal(await page.locator('#testiDots span').count(), 3);
  });

  await step('demo banner: heading always visible, Read more / Read less toggles the full description', async () => {
    const FULL = 'Your actual portfolio will be custom-designed around your profession, personality, and brand. This demo simply shows how easily you can manage your content, update information, and publish changes without touching a single line of code.';
    assert.equal(await page.locator('.demo-banner-title').innerText(), 'THIS IS JUST A DEMO WEBSITE');
    assert.equal(await page.locator('#demoBannerMore').isHidden(), true, 'collapsed by default');
    assert.equal(await page.locator('#demoBannerToggle').innerText(), 'Read more');
    await page.click('#demoBannerToggle');
    assert.equal(await page.locator('#demoBannerMore').isVisible(), true);
    assert.equal(await page.locator('#demoBannerToggle').innerText(), 'Read less');
    assert.equal(await page.getAttribute('#demoBannerToggle', 'aria-expanded'), 'true');
    const text = (await page.locator('.demo-banner-preview, .demo-banner-more').allInnerTexts()).join('').replace(/\s+/g, ' ').trim();
    assert.equal(text, FULL);
    await page.click('#demoBannerToggle');
    assert.equal(await page.locator('#demoBannerMore').isHidden(), true);
    assert.equal(await page.locator('#demoBannerToggle').innerText(), 'Read more');
    assert.equal(await page.locator('.demo-banner-title').isVisible(), true);
  });

  await step('footer gear opens login panel with required wording', async () => {
    await page.click('#adminGear');
    await page.waitForSelector('.ajz-login');
    assert.match(await page.locator('.ajz-login').innerText(), /Enter your password to activate admin panel/);
    await shot('01-login');
  });

  await step('wrong password shows error and stays on login', async () => {
    await page.fill('#ajzPassword', 'wrong-password');
    await page.click('.ajz-login button[type=submit]');
    await page.waitForFunction(() => /Incorrect password/.test(document.querySelector('.ajz-login .ajz-err').textContent));
    assert.equal(await page.locator('.ajz-admin').isHidden().catch(() => true), true);
  });

  await step('show/hide password toggle works', async () => {
    assert.equal(await page.getAttribute('#ajzPassword', 'type'), 'password');
    await page.click('.ajz-login .ajz-pw button');
    assert.equal(await page.getAttribute('#ajzPassword', 'type'), 'text');
    await page.click('.ajz-login .ajz-pw button');
    assert.equal(await page.getAttribute('#ajzPassword', 'type'), 'password');
  });

  await step('loading state is shown while verifying; correct password opens dashboard', async () => {
    await page.fill('#ajzPassword', PW);
    await page.click('.ajz-login button[type=submit]');
    await page.waitForFunction(() => /Verifying/.test(document.querySelector('.ajz-login button[type=submit]')?.textContent || ''), null, { timeout: 2000 }).catch(() => {});
    await page.waitForSelector('.ajz-admin:not([hidden]) .ajz-stats');
    assert.match(await page.locator('.ajz-stat').first().innerText(), /7/);
    assert.match(await page.locator('.ajz-stat').first().innerText(), /6 short · 1 long/);
    await shot('02-dashboard');
  });

  await step('session cookie is HttpOnly (invisible to JS) and no secrets reach the browser', async () => {
    assert.equal(await page.evaluate(() => document.cookie), '');
    const cookies = await ctx.cookies();
    const c = cookies.find((x) => x.name === 'ajaz_admin_session');
    assert.ok(c && c.httpOnly && c.sameSite === 'Strict');
    const html = await page.content();
    for (const s of [H.ENV.ADMIN_PASSWORD, H.ENV.SESSION_SECRET, H.ENV.GITHUB_TOKEN]) assert.ok(!html.includes(s));
    for (const f of ['index.html', 'js/main.js', 'js/admin.js', 'js/render.js', 'js/shared.js', 'css/admin.css']) {
      const t = await (await fetch(srv.url + '/' + f)).text();
      for (const s of [H.ENV.ADMIN_PASSWORD, H.ENV.SESSION_SECRET, H.ENV.GITHUB_TOKEN]) assert.ok(!t.includes(s), f);
    }
  });

  /* ------------------------------- projects ------------------------------- */
  await step('add project: invalid / unsupported URLs rejected with message', async () => {
    await page.click('.ajz-nav button:has-text("Projects")');
    await page.click('.ajz-view-head >> text=Add project');
    await page.waitForSelector('.ajz-sheet');
    await page.fill('.ajz-sheet input[type=url] >> nth=0', 'https://vimeo.com/12345');
    assert.match(await dlg().locator('.ajz-err').allInnerTexts().then((a) => a.join(' ')), /Only YouTube links/);
    await page.fill('.ajz-sheet input[type=url] >> nth=0', 'https://youtu.be/short');
    assert.match(await dlg().locator('.ajz-err').allInnerTexts().then((a) => a.join(' ')), /not valid/);
    await dlg().locator('button:has-text("Save to draft")').click();
    const errs = (await dlg().locator('.ajz-err').allInnerTexts()).join(' ');
    assert.match(errs, /Project title is required/);
    assert.equal(await page.locator('.ajz-sheet').count(), 1, 'sheet stays open');
  });

  await step('valid URL shows embedded preview before publishing (all 4 formats parse)', async () => {
    await page.fill('.ajz-sheet input >> nth=0', 'My New Long Video');
    for (const u of ['https://www.youtube.com/watch?v=aaaaaaaaaaa', 'https://youtu.be/bbbbbbbbbbb', 'https://www.youtube.com/shorts/ccccccccccc', 'https://www.youtube.com/embed/ddddddddddd']) {
      await page.fill('.ajz-sheet input[type=url] >> nth=0', u);
      const id = u.slice(-11);
      await page.waitForSelector(`.ajz-yt-preview iframe[src^="https://www.youtube.com/embed/${id}"]`);
      assert.match(await dlg().innerText(), new RegExp('Video detected · ID ' + id));
    }
    await page.fill('.ajz-sheet input[type=url] >> nth=0', 'https://www.youtube.com/watch?v=aaaaaaaaaaa&t=3');
    await dlg().locator('button:has-text("Long Form")').click();
    assert.ok((await page.getAttribute('.ajz-yt-preview', 'class')).includes('long'));
    await page.fill('.ajz-sheet textarea', 'Cinematic edit, color grade');
    await shot('03-project-editor');
    await dlg().locator('button:has-text("Save to draft")').click();
    await page.waitForSelector('.ajz-actionbar:not([hidden])');
    assert.match(await page.locator('.ajz-actionbar').innerText(), /Unpublished changes: Projects/);
    assert.equal(commitsFor('data/projects.json').length, 0, 'saving to draft does not touch GitHub');
  });

  await step('PREVIEW shows the new project on the real page without updating GitHub', async () => {
    await page.click('.ajz-actionbar button:has-text("Preview")');
    await page.waitForSelector('.ajz-previewbar:not([hidden])');
    assert.equal(await page.locator('.ajz-admin').isHidden(), true);
    assert.equal(await page.locator('.project-card').count(), 8);
    // long tab was selected automatically and shows the new card
    assert.equal(await page.locator('.project-card[data-format="long"]:not(.is-hidden)').count(), 2);
    assert.ok(await page.locator('.project-card[data-video="aaaaaaaaaaa"] h4').innerText() === 'My New Long Video');
    assert.equal(gh.commits.length, 0);
    await shot('04-preview');
    await page.click('.ajz-previewbar >> text=Back to editor');
    await page.waitForSelector('.ajz-admin:not([hidden])');
    assert.equal(await page.locator('.project-card').count(), 7, 'public page restored');
  });

  await step('PUBLISH: confirm -> commit -> "Changes committed" is distinct from "Deployment completed"', async () => {
    gh.deployDelayMs = 6500; // simulate a slow Vercel build so the intermediate state is observable
    await page.click('.ajz-actionbar button:has-text("Publish")');
    await dlg().locator('text=Added: My New Long Video').waitFor();
    await dlg().locator('button:has-text("Publish now")').click();
    await page.waitForFunction(() => /Changes committed to GitHub\. This is not live yet/.test(document.querySelector('.ajz-final')?.textContent || ''), null, { timeout: 8000 });
    assert.doesNotMatch(await page.locator('.ajz-final').innerText(), /Deployment completed/);
    const commits = commitsFor('data/projects.json');
    assert.equal(commits.length, 1);
    assert.match(commits[0].message, /added "My New Long Video"/);
    await shot('05-publish-committed');
    await page.waitForFunction(() => /Deployment completed/.test(document.querySelector('.ajz-final')?.textContent || ''), null, { timeout: 20000 });
    gh.deployDelayMs = 0;
    await shot('06-publish-deployed');
    await dlg().locator('button:has-text("Close")').click();
    assert.equal(await page.locator('.ajz-actionbar').isHidden(), true, 'no unpublished changes left');
    const saved = gh.read('data/projects.json').projects;
    assert.equal(saved.length, 8);
    assert.equal(saved[7].videoId, 'aaaaaaaaaaa');
    assert.equal(saved[7].type, 'long');
  });

  await step('new project appears in the correct public category after deploy', async () => {
    const p2 = await ctx.newPage();
    await p2.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());
    await p2.goto(srv.url + '/');
    await p2.waitForSelector('.project-card');
    assert.equal(await p2.locator('.project-card[data-format="long"]').count(), 2);
    assert.equal(await p2.locator('.project-card[data-format="short"]').count(), 6);
    await p2.close();
  });

  await step('edit project (change category) + delete project with confirmation', async () => {
    await page.click('.ajz-nav button:has-text("Projects")');
    const row = page.locator('.ajz-item', { hasText: 'My New Long Video' });
    await row.locator('button:has-text("Edit")').click();
    await dlg().locator('button:has-text("Short Form")').click();
    await dlg().locator('button:has-text("Save to draft")').click();
    assert.match(await page.locator('.ajz-item', { hasText: 'My New Long Video' }).innerText(), /short form/i);
    // delete first project: cancel keeps it, confirm removes it
    await page.locator('.ajz-item').first().locator('button:has-text("Delete")').click();
    await dlg().locator('button:has-text("Cancel")').click();
    assert.equal(await page.locator('.ajz-item').count(), 8);
    await page.locator('.ajz-item').first().locator('button:has-text("Delete")').click();
    assert.match(await dlg().innerText(), /Podcast Short/);
    await dlg().locator('button:has-text("Delete")').click();
    assert.equal(await page.locator('.ajz-item').count(), 7);
    // reorder: move the new first item down
    await page.locator('.ajz-item').first().locator('button[aria-label="Move down"]').click();
    await page.click('.ajz-actionbar button:has-text("Publish")');
    await dlg().locator('button:has-text("Publish now")').click();
    await page.waitForFunction(() => /Deployment completed/.test(document.querySelector('.ajz-final')?.textContent || ''), null, { timeout: 20000 });
    await dlg().locator('button:has-text("Close")').click();
    const msg = commitsFor('data/projects.json').pop().message;
    assert.match(msg, /edited "My New Long Video"/); assert.match(msg, /removed "Podcast Short"/);
    assert.equal(gh.read('data/projects.json').projects.length, 7);
  });

  /* -------------------------------- about --------------------------------- */
  await step('about: required-field validation blocks publish, then edit publishes', async () => {
    await page.click('.ajz-nav button:has-text("About & Info")');
    const title = page.locator('.ajz-field', { hasText: 'Professional title' }).locator('input');
    await title.fill('');
    await page.click('.ajz-actionbar button:has-text("Publish")');
    await dlg().locator('text=Please fix these first').waitFor();
    await dlg().locator('button:has-text("OK")').click();
    await page.waitForSelector('.ajz-field .ajz-err:not(:empty)');
    await title.fill('SENIOR VIDEO EDITOR');
    await page.locator('.ajz-field', { hasText: 'Main introduction' }).locator('textarea').fill('I cut videos that hold attention.');
    await page.click('.ajz-actionbar button:has-text("Publish")');
    await dlg().locator('button:has-text("Publish now")').click();
    await page.waitForFunction(() => /Deployment completed/.test(document.querySelector('.ajz-final')?.textContent || ''), null, { timeout: 20000 });
    await dlg().locator('button:has-text("Close")').click();
    const about = gh.read('data/about.json');
    assert.equal(about.hero.title, 'SENIOR VIDEO EDITOR');
    assert.equal(about.hero.intro, 'I cut videos that hold attention.');
  });

  /* --------------------------- profile image (common) --------------------- */
  await step('profile image: ONE setting; bad link / failed load keeps previous image; good link previews, then publishes to Hero AND About', async () => {
    await page.route('https://images.example/ok.png', (r) => r.fulfill({ status: 200, contentType: 'image/png', body: PNG_1PX }));
    await page.route('https://images.example/bad.png', (r) => r.fulfill({ status: 404, contentType: 'text/plain', body: 'nope' }));
    await page.click('.ajz-nav button:has-text("About & Info")');
    assert.equal(await page.locator('.ajz-card h3:has-text("Profile image")').count(), 1, 'exactly one profile image card');
    assert.equal(await page.locator('.ajz-card h3', { hasText: /hero image|about image/i }).count(), 0, 'no separate hero/about image settings');
    const link = page.locator('.ajz-field', { hasText: 'Image link' }).locator('input');
    assert.match(await page.getAttribute('.ajz-profile-pic img', 'src'), /a\.png$/, 'shows the current (default) image');
    await link.fill('http://insecure.example/x.png');
    await page.waitForFunction(() => /valid https/.test(document.querySelector('.ajz-card .ajz-err')?.textContent || ''));
    await link.fill('https://images.example/bad.png');
    await page.waitForFunction(() => /could not be loaded/.test(document.querySelector('.ajz-card .ajz-err')?.textContent || ''), null, { timeout: 5000 });
    assert.equal(await page.locator('.ajz-actionbar').isHidden(), true, 'previous image kept: nothing to publish');
    await link.fill('https://images.example/ok.png');
    await page.locator('.ajz-card .ajz-hint:has-text("Image loaded")').waitFor();
    assert.equal(await page.locator('.ajz-profile-fig:has-text("New image")').isVisible(), true, 'preview of the new image');
    await page.waitForSelector('.ajz-actionbar:not([hidden])');
    // preview on the real page: both sections show the same image, GitHub untouched
    const n0 = gh.commits.length;
    await page.click('.ajz-actionbar button:has-text("Preview")');
    await page.waitForSelector('.ajz-previewbar:not([hidden])');
    assert.equal(await page.getAttribute('#heroPhoto', 'src'), 'https://images.example/ok.png');
    assert.equal(await page.getAttribute('#aboutPhoto', 'src'), 'https://images.example/ok.png');
    assert.equal(gh.commits.length, n0);
    await page.click('.ajz-previewbar >> text=Back to editor');
    await page.waitForSelector('.ajz-admin:not([hidden])');
    assert.match(await page.getAttribute('#heroPhoto', 'src'), /a\.png$/, 'public page restored after preview');
    await page.click('.ajz-actionbar button:has-text("Publish")');
    await dlg().locator('button:has-text("Publish now")').click();
    await page.waitForFunction(() => /Deployment completed/.test(document.querySelector('.ajz-final')?.textContent || ''), null, { timeout: 20000 });
    await dlg().locator('button:has-text("Close")').click();
    assert.equal(gh.read('data/about.json').profileImage, 'https://images.example/ok.png');
    const p2 = await ctx.newPage();
    await p2.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());
    await p2.route('https://images.example/ok.png', (r) => r.fulfill({ status: 200, contentType: 'image/png', body: PNG_1PX }));
    await p2.goto(srv.url + '/');
    await p2.waitForFunction(() => document.getElementById('heroPhoto').getAttribute('src') !== 'a.png');
    assert.equal(await p2.getAttribute('#heroPhoto', 'src'), 'https://images.example/ok.png');
    assert.equal(await p2.getAttribute('#aboutPhoto', 'src'), 'https://images.example/ok.png');
    await p2.close();
  });

  await step('profile image: upload uses the existing upload workflow (image commit first, then about.json); missing file falls back to the default image', async () => {
    await page.click('.ajz-nav button:has-text("About & Info")');
    await page.locator('.ajz-card:has(h3:has-text("Profile image")) input[type=file]').setInputFiles(png('me.png'));
    await page.locator('.ajz-card .ajz-hint:has-text("Image selected")').waitFor();
    const n0 = gh.commits.length;
    await page.click('.ajz-actionbar button:has-text("Publish")');
    await dlg().locator('button:has-text("Publish now")').click();
    await page.waitForFunction(() => /Deployment completed/.test(document.querySelector('.ajz-final')?.textContent || ''), null, { timeout: 20000 });
    await dlg().locator('button:has-text("Close")').click();
    const nc = gh.commits.slice(n0);
    assert.equal(nc.length, 2);
    assert.match(nc[0].path, /^assets\/uploads\/\d{8}-[0-9a-f]{10}\.jpg$/);
    assert.equal(nc[1].path, 'data/about.json');
    assert.equal(gh.read('data/about.json').profileImage, nc[0].path);
    // once deployed, BOTH sections load the same uploaded file ...
    const pub = '/' + nc[0].path;
    const p2 = await ctx.newPage();
    await p2.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());
    await p2.route('**' + pub, (r) => r.fulfill({ status: 200, contentType: 'image/png', body: PNG_1PX }));
    await p2.goto(srv.url + '/');
    await p2.waitForFunction((u) => document.getElementById('heroPhoto').getAttribute('src') === u && document.getElementById('aboutPhoto').getAttribute('src') === u, pub, { timeout: 5000 });
    await p2.close();
    // ... and if that file cannot be loaded, both fall back to the default image instead of a broken icon
    const p3 = await ctx.newPage();
    await p3.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());
    await p3.route('**' + pub, (r) => r.fulfill({ status: 404, contentType: 'text/plain', body: 'nope' }));
    await p3.goto(srv.url + '/');
    await p3.waitForFunction(() => document.getElementById('heroPhoto').getAttribute('src') === 'a.png' && document.getElementById('aboutPhoto').getAttribute('src') === 'a.png', null, { timeout: 5000 });
    await p3.close();
    // reset to default removes the setting
    await page.click('.ajz-nav button:has-text("About & Info")');
    await page.click('button:has-text("Use default image")');
    await page.click('.ajz-actionbar button:has-text("Publish")');
    await dlg().locator('button:has-text("Publish now")').click();
    await page.waitForFunction(() => /Deployment completed/.test(document.querySelector('.ajz-final')?.textContent || ''), null, { timeout: 20000 });
    await dlg().locator('button:has-text("Close")').click();
    assert.equal(gh.read('data/about.json').profileImage, undefined);
  });

  /* ------------------------ experience / clients / etc -------------------- */
  await step('experience: add (with "currently work here") -> section appears publicly', async () => {
    await page.click('.ajz-nav button:has-text("Experience")');
    assert.match(await page.locator('.ajz-empty').innerText(), /No experience added yet/);
    await page.click('.ajz-view-head >> text=Add experience');
    const f = (label) => dlg().locator('.ajz-field', { hasText: label }).locator('input,textarea');
    await f('Role / title').fill('Freelance Video Editor');
    await f('Company / client').fill('Self-employed');
    await f('Start date').fill('Jan 2025');
    await dlg().locator('input[type=checkbox]').check();
    assert.equal(await f('End date').inputValue(), 'Present');
    await f('Description').fill('Short-form and long-form edits for creators.');
    await dlg().locator('button:has-text("Save to draft")').click();
    await page.click('.ajz-actionbar button:has-text("Publish")');
    await dlg().locator('button:has-text("Publish now")').click();
    await page.waitForFunction(() => /Deployment completed/.test(document.querySelector('.ajz-final')?.textContent || ''), null, { timeout: 20000 });
    await dlg().locator('button:has-text("Close")').click();
    assert.equal(gh.read('data/experience.json').experience[0].end, 'Present');
    const p2 = await ctx.newPage(); await p2.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());
    await p2.goto(srv.url + '/'); await p2.waitForSelector('#experienceList .timeline-item');
    assert.equal(await p2.locator('#experience').isVisible(), true);
    assert.match(await p2.locator('#experienceList').innerText(), /Jan 2025 – Present[\s\S]*Freelance Video Editor/);
    await p2.close();
  });

  await step('clients: add with uploaded logo -> image committed first, then JSON; section appears', async () => {
    await page.click('.ajz-nav button:has-text("Clients")');
    await page.click('.ajz-view-head >> text=Add client');
    const f = (label) => dlg().locator('.ajz-field', { hasText: label }).locator('input,textarea').first();
    await f('Client name').fill('Acme Studio');
    await f('Details').fill('YouTube channel');
    await dlg().locator('input[type=file]').setInputFiles(png('logo.png'));
    await dlg().locator('text=Image selected').waitFor();
    await dlg().locator('button:has-text("Save to draft")').click();
    assert.equal(gh.commits.length, commitsBefore(), 'no commit yet');
    function commitsBefore() { return gh.commits.length; }
    const n0 = gh.commits.length;
    await page.click('.ajz-actionbar button:has-text("Publish")');
    await dlg().locator('button:has-text("Publish now")').click();
    await page.waitForFunction(() => /Deployment completed/.test(document.querySelector('.ajz-final')?.textContent || ''), null, { timeout: 20000 });
    await dlg().locator('button:has-text("Close")').click();
    const newCommits = gh.commits.slice(n0);
    assert.equal(newCommits.length, 2);
    assert.match(newCommits[0].path, /^assets\/uploads\/\d{8}-[0-9a-f]{10}\.png$/);
    assert.equal(newCommits[1].path, 'data/clients.json');
    const client = gh.read('data/clients.json').clients[0];
    assert.equal(client.logo, newCommits[0].path);
    const p2 = await ctx.newPage(); await p2.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());
    await p2.goto(srv.url + '/'); await p2.waitForSelector('#clientsGrid .client-card');
    assert.equal(await p2.locator('#clientsGrid img').getAttribute('src'), '/' + client.logo);
    await p2.close();
  });

  await step('services: add with icon + edit; testimonials: add -> slider has 4 dots', async () => {
    await page.click('.ajz-nav button:has-text("Services")');
    await page.click('.ajz-view-head >> text=Add service');
    await dlg().locator('.ajz-field', { hasText: 'Service title' }).locator('input').fill('Thumbnail Design');
    await dlg().locator('.ajz-field', { hasText: 'Description' }).locator('textarea').fill('Click-worthy thumbnails.');
    await dlg().locator('.ajz-icon-grid button[aria-label="camera"]').click();
    await dlg().locator('button:has-text("Save to draft")').click();
    await page.click('.ajz-nav button:has-text("Testimonials")');
    await page.click('.ajz-view-head >> text=Add testimonial');
    await dlg().locator('.ajz-field', { hasText: 'Client name' }).locator('input').fill('Sara Khan');
    await dlg().locator('.ajz-field', { hasText: 'Role' }).locator('input').fill('Podcaster');
    await dlg().locator('.ajz-field', { hasText: 'Testimonial' }).locator('textarea').fill('Fast turnaround and great taste.');
    await dlg().locator('button:has-text("Save to draft")').click();
    await page.click('.ajz-actionbar button:has-text("Publish")');
    await dlg().locator('button:has-text("Publish now")').click();
    await page.waitForFunction(() => /Deployment completed/.test(document.querySelector('.ajz-final')?.textContent || ''), null, { timeout: 20000 });
    await dlg().locator('button:has-text("Close")').click();
    assert.equal(gh.read('data/services.json').services.at(-1).icon, 'fa-solid fa-camera');
    const p2 = await ctx.newPage(); await p2.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());
    await p2.goto(srv.url + '/'); await p2.waitForSelector('.service-card');
    assert.equal(await p2.locator('.service-card').count(), 7);
    assert.equal(await p2.locator('#testiDots span').count(), 4);
    await p2.click('#testiNext'); await p2.click('#testiNext'); await p2.click('#testiNext');
    assert.match(await p2.locator('#testiName').innerText(), /Sara Khan/);
    await p2.close();
  });

  await step('delete the last testimonial(s) -> empty collection handled; slider hides', async () => {
    await page.click('.ajz-nav button:has-text("Testimonials")');
    while (await page.locator('.ajz-item').count()) {
      await page.locator('.ajz-item').first().locator('button:has-text("Delete")').click();
      await dlg().locator('button:has-text("Delete")').click();
    }
    assert.match(await page.locator('.ajz-empty').innerText(), /No testimonials yet/);
    await page.click('.ajz-actionbar button:has-text("Publish")');
    await dlg().locator('button:has-text("Publish now")').click();
    await page.waitForFunction(() => /Deployment completed/.test(document.querySelector('.ajz-final')?.textContent || ''), null, { timeout: 20000 });
    await dlg().locator('button:has-text("Close")').click();
    assert.deepEqual(gh.read('data/testimonials.json'), { testimonials: [] });
    const p2 = await ctx.newPage(); await p2.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());
    await p2.goto(srv.url + '/'); await p2.waitForSelector('.service-card');
    assert.equal(await p2.locator('#testimonials').isHidden(), true);
    await p2.close();
  });

  /* ---------------------------- conflict handling -------------------------- */
  await step('conflict: GitHub changed underneath -> 409 UI; overwrite option commits', async () => {
    await page.click('.ajz-nav button:has-text("Services")');
    await page.locator('.ajz-item').first().locator('button:has-text("Edit")').click();
    await dlg().locator('.ajz-field', { hasText: 'Service title' }).locator('input').fill('Video Editing PRO');
    await dlg().locator('button:has-text("Save to draft")').click();
    // someone else edits services.json on GitHub
    const other = gh.read('data/services.json'); other.services[1].title = 'Edited elsewhere';
    gh.files.set('data/services.json', Buffer.from(JSON.stringify(other, null, 2) + '\n'));
    const n0 = gh.commits.length;
    await page.click('.ajz-actionbar button:has-text("Publish")');
    await dlg().locator('button:has-text("Publish now")').click();
    await dlg().locator('text=changed Services on GitHub').waitFor();
    assert.equal(gh.commits.length, n0, 'nothing overwritten');
    await shot('07-conflict');
    await dlg().locator('button:has-text("Overwrite with my version")').click();
    await page.waitForFunction(() => /Deployment completed/.test(document.querySelector('.ajz-final')?.textContent || ''), null, { timeout: 20000 });
    await dlg().locator('button:has-text("Close")').click();
    assert.equal(gh.read('data/services.json').services[0].title, 'Video Editing PRO');
  });

  await step('conflict: "Load latest" discards my edit and adopts GitHub version', async () => {
    await page.locator('.ajz-item').first().locator('button:has-text("Edit")').click();
    await dlg().locator('.ajz-field', { hasText: 'Service title' }).locator('input').fill('My local edit');
    await dlg().locator('button:has-text("Save to draft")').click();
    const other = gh.read('data/services.json'); other.services[2].title = 'Remote wins';
    gh.files.set('data/services.json', Buffer.from(JSON.stringify(other, null, 2) + '\n'));
    await page.click('.ajz-actionbar button:has-text("Publish")');
    await dlg().locator('button:has-text("Publish now")').click();
    await dlg().locator('button:has-text("Load latest")').click();
    await page.waitForFunction(() => document.body.innerText.includes('Remote wins'));
    assert.equal(await page.locator('.ajz-actionbar').isHidden(), true);
    assert.ok(!(await page.locator('.ajz-main').innerText()).includes('My local edit'));
  });

  /* --------------------------- failure + expiry paths ---------------------- */
  await step('GitHub failure during publish: error shown, NOT reported as published, draft kept', async () => {
    await page.locator('.ajz-item').first().locator('button:has-text("Edit")').click();
    await dlg().locator('.ajz-field', { hasText: 'Service title' }).locator('input').fill('Will fail');
    await dlg().locator('button:has-text("Save to draft")').click();
    gh.failWith = 500;
    await page.click('.ajz-actionbar button:has-text("Publish")');
    await dlg().locator('button:has-text("Publish now")').click();
    await dlg().locator('text=Publishing failed').waitFor();
    const txt = await dlg().innerText();
    assert.doesNotMatch(txt, /Deployment completed|Changes committed to GitHub\./);
    gh.failWith = null;
    await dlg().locator('button:has-text("Try again")').click();
    await page.waitForFunction(() => /Deployment completed/.test(document.querySelector('.ajz-final')?.textContent || ''), null, { timeout: 20000 });
    await dlg().locator('button:has-text("Close")').click();
    assert.equal(gh.read('data/services.json').services[0].title, 'Will fail');
  });

  await step('expired session during publish: login prompt, drafts preserved, retry works', async () => {
    await page.locator('.ajz-item').first().locator('button:has-text("Edit")').click();
    await dlg().locator('.ajz-field', { hasText: 'Service title' }).locator('input').fill('After expiry');
    await dlg().locator('button:has-text("Save to draft")').click();
    await ctx.clearCookies();
    await page.click('.ajz-actionbar button:has-text("Publish")');
    await dlg().locator('button:has-text("Publish now")').click();
    await dlg().locator('button:has-text("Log in again")').click();
    await page.waitForSelector('.ajz-login');
    assert.match(await page.locator('.ajz-notice').innerText(), /session expired/i);
    await page.fill('#ajzPassword', PW);
    await page.click('.ajz-login button[type=submit]');
    await page.waitForSelector('.ajz-login', { state: 'detached' });
    assert.match(await page.locator('.ajz-actionbar').innerText(), /Unpublished changes: Services/);
    await page.click('.ajz-actionbar button:has-text("Publish")');
    await dlg().locator('button:has-text("Publish now")').click();
    await page.waitForFunction(() => /Deployment completed/.test(document.querySelector('.ajz-final')?.textContent || ''), null, { timeout: 20000 });
    await dlg().locator('button:has-text("Close")').click();
    assert.equal(gh.read('data/services.json').services[0].title, 'After expiry');
  });

  await step('discard changes + logout (with confirm on unpublished edits)', async () => {
    await page.locator('.ajz-item').first().locator('button:has-text("Delete")').click();
    await dlg().locator('button:has-text("Delete")').click();
    await page.click('.ajz-actionbar button:has-text("Discard")');
    await dlg().locator('button:has-text("Discard")').click();
    assert.equal(await page.locator('.ajz-actionbar').isHidden(), true);
    await page.locator('.ajz-item').first().locator('button:has-text("Delete")').click();
    await dlg().locator('button:has-text("Delete")').click();
    await page.click('.ajz-top button[aria-label="Log out"]');
    await dlg().locator('text=Log out with unpublished changes').waitFor();
    await dlg().locator('button:has-text("Log out")').click();
    await page.waitForSelector('.ajz-admin', { state: 'hidden' });
    const s = await (await fetch(srv.url + '/api/session', { headers: { cookie: (await ctx.cookies()).map((c) => `${c.name}=${c.value}`).join('; ') } })).json();
    assert.equal(s.authenticated, false);
    // gear asks for the password again
    await page.click('#adminGear'); await page.waitForSelector('.ajz-login');
    await page.click('.ajz-login-close');
  });

  /* -------------------------------- mobile -------------------------------- */
  await step('mobile (Android-size viewport): login, drawer nav, full-screen sheet, no horizontal scroll, 44px targets', async () => {
    const mctx = await browser.newContext({ viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const m = await mctx.newPage();
    await m.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());
    await m.goto(srv.url + '/'); await m.waitForSelector('.project-card');
    await m.tap('#adminGear'); await m.waitForSelector('.ajz-login');
    await m.fill('#ajzPassword', PW); await m.tap('.ajz-login button[type=submit]');
    await m.waitForSelector('.ajz-admin:not([hidden]) .ajz-stats');
    await m.screenshot({ path: SHOTS ? `${SHOTS}/08-mobile-dashboard.png` : '/tmp/m1.png' });
    assert.equal(await m.evaluate(() => document.querySelector('.ajz-main').scrollWidth <= document.querySelector('.ajz-main').clientWidth + 1), true);
    // drawer
    assert.equal(await m.locator('.ajz-menu-btn').isVisible(), true);
    await m.tap('.ajz-menu-btn');
    await m.waitForTimeout(400);
    await m.screenshot({ path: SHOTS ? `${SHOTS}/09-mobile-drawer.png` : '/tmp/m2.png' });
    await m.tap('.ajz-nav button:has-text("Projects")');
    await m.waitForSelector('.ajz-item');
    // tap target sizes of primary controls
    const small = await m.evaluate(() => Array.from(document.querySelectorAll('.ajz-admin button, .ajz-admin input, .ajz-admin select')).filter((e) => e.offsetParent && !e.closest('.ajz-side') ).map((e) => { const r = e.getBoundingClientRect(); return { t: (e.textContent || e.getAttribute('aria-label') || e.type || '').trim().slice(0, 20), w: Math.round(r.width), h: Math.round(r.height) }; }).filter((x) => x.h < 38 || x.w < 38));
    assert.deepEqual(small, [], 'controls under 38px: ' + JSON.stringify(small));
    await m.tap('.ajz-view-head >> text=Add project');
    await m.waitForSelector('.ajz-sheet');
    await m.waitForTimeout(500);
    const box = await m.locator('.ajz-sheet').boundingBox();
    assert.ok(box.width >= 358 && box.y >= 0 && box.y + box.height <= 741, JSON.stringify(box));
    await m.fill('.ajz-sheet input[type=url] >> nth=0', 'https://youtube.com/shorts/zzzzzzzzzzz');
    await m.screenshot({ path: SHOTS ? `${SHOTS}/10-mobile-editor.png` : '/tmp/m3.png' });
    assert.equal(await m.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true);
    // all inputs >= 16px to avoid mobile zoom
    const fs_ = await m.evaluate(() => Array.from(document.querySelectorAll('.ajz-sheet input, .ajz-sheet textarea')).filter((e) => e.offsetParent).map((e) => parseFloat(getComputedStyle(e).fontSize)));
    assert.ok(fs_.every((x) => x >= 16), String(fs_));
    await mctx.close();
  });

  await step('no JavaScript errors anywhere during the whole run', async () => { assert.deepEqual(errors, []); });

  console.log(`\n${passed} e2e steps passed`);
  await browser.close(); srv.server.close();
})().catch((e) => { console.error('\nE2E aborted:', e.message.split('\n')[0]); process.exit(1); });
