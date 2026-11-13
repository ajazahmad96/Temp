// ============ Mobile Menu Toggle ============
const menuToggle = document.getElementById('menuToggle');
const navLinks = document.getElementById('navLinks');
if (menuToggle && navLinks) {
  menuToggle.addEventListener('click', () => {
    navLinks.classList.toggle('open');
  });
  navLinks.querySelectorAll('a').forEach(link => {
    link.addEventListener('click', () => navLinks.classList.remove('open'));
  });
}

// ============ Active Nav Link on Scroll (Fixed for #testimonials) ============
const navA = document.querySelectorAll('.nav-links a');

function updateActiveNav() {
  let current = '';
  const scrollPos = window.scrollY + 140;

  // Only sections that are visible and have a nav link (Experience/Clients are optional)
  const navTargets = Array.from(document.querySelectorAll('section[id], #testimonials')).filter(t =>
    !t.hidden && t.getClientRects().length && document.querySelector('.nav-links a[href="#' + t.id + '"]'));

  navTargets.forEach(target => {
    const top = target.getBoundingClientRect().top + window.scrollY;
    if (scrollPos >= top) {
      current = target.getAttribute('id');
    }
  });

  navA.forEach(a => {
    a.classList.remove('active');
    if (a.getAttribute('href') === '#' + current) {
      a.classList.add('active');
    }
  });
}
window.addEventListener('scroll', updateActiveNav);
updateActiveNav();

// ============ Reveal on Scroll ============
const observer = new IntersectionObserver((entries) => {
  entries.forEach((entry, i) => {
    if (entry.isIntersecting) {
      setTimeout(() => entry.target.classList.add('in-view'), (i * 60) % 300);
      observer.unobserve(entry.target);
    }
  });
}, { threshold: 0.1 });
function observeReveals() {
  document.querySelectorAll('.reveal:not(.in-view)').forEach(el => observer.observe(el));
}
observeReveals();

// ============ Video Modal (YouTube embeds with custom controls) ============
const videoModal = document.getElementById('videoModal');
const videoModalInner = document.getElementById('videoModalInner');
const videoPlayer = document.getElementById('videoPlayer');
const videoShield = document.getElementById('videoShield');
const videoBigPlay = document.getElementById('videoBigPlay');
const videoClose = document.getElementById('videoClose');
const vcPlay = document.getElementById('vcPlay');
const vcMute = document.getElementById('vcMute');
const vcFull = document.getElementById('vcFull');
const vcProgress = document.getElementById('vcProgress');
const vcFill = document.getElementById('vcFill');
const vcCurrent = document.getElementById('vcCurrent');
const vcDuration = document.getElementById('vcDuration');

let ytPlayer = null;
let ytApiLoading = false;
let pendingVideoId = null;
let progressTimer = null;
let idleTimer = null;
let isSeeking = false;

function loadYouTubeApi(){
  if (ytApiLoading) return;
  ytApiLoading = true;
  const previous = window.onYouTubeIframeAPIReady;
  window.onYouTubeIframeAPIReady = () => {
    if (typeof previous === 'function') previous();
    if (pendingVideoId) createPlayer(pendingVideoId);
  };
  const tag = document.createElement('script');
  tag.src = 'https://www.youtube.com/iframe_api';
  document.head.appendChild(tag);
}

function ensurePlayerHost(){
  if (!document.getElementById('videoFrame')) {
    const host = document.createElement('div');
    host.id = 'videoFrame';
    videoPlayer.insertBefore(host, videoPlayer.firstChild);
  }
}

function createPlayer(videoId){
  ensurePlayerHost();
  const playerVars = {
    autoplay: 1, controls: 0, disablekb: 1, fs: 0,
    rel: 0, playsinline: 1, iv_load_policy: 3, cc_load_policy: 0, modestbranding: 1
  };
  if (window.location.protocol.indexOf('http') === 0) playerVars.origin = window.location.origin;
  ytPlayer = new YT.Player('videoFrame', {
    videoId: videoId,
    playerVars: playerVars,
    events: {
      onReady: (e) => {
        e.target.getIframe().setAttribute('title', 'Project video');
        e.target.playVideo();
        updateMuteIcon();
        startProgressTimer();
      },
      onStateChange: onPlayerStateChange
    }
  });
}

function destroyPlayer(){
  stopProgressTimer();
  if (ytPlayer && typeof ytPlayer.destroy === 'function') {
    try { ytPlayer.destroy(); } catch (err) {}
  }
  ytPlayer = null;
  ensurePlayerHost();
}

function playerReady(){
  return ytPlayer && typeof ytPlayer.getPlayerState === 'function';
}

function formatTime(sec){
  sec = Math.max(0, Math.floor(sec || 0));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m + ':' + (s < 10 ? '0' : '') + s;
}

function setPlayIcons(playing){
  const icon = playing ? 'fa-pause' : 'fa-play';
  vcPlay.innerHTML = '<i class="fa-solid ' + icon + '"></i>';
  videoPlayer.classList.toggle('is-playing', playing);
}

function onPlayerStateChange(e){
  const state = e.data;
  if (state === YT.PlayerState.PLAYING || state === YT.PlayerState.BUFFERING) {
    setPlayIcons(true);
    scheduleIdle();
  } else {
    setPlayIcons(false);
    showControls();
    if (state === YT.PlayerState.ENDED) {
      ytPlayer.seekTo(0, true);
      ytPlayer.pauseVideo();
    }
  }
}

function togglePlay(){
  if (!playerReady()) return;
  if (ytPlayer.getPlayerState() === YT.PlayerState.PLAYING) ytPlayer.pauseVideo();
  else ytPlayer.playVideo();
}

function updateProgress(){
  if (!playerReady() || isSeeking || typeof ytPlayer.getDuration !== 'function') return;
  const duration = ytPlayer.getDuration();
  const current = ytPlayer.getCurrentTime();
  vcFill.style.width = (duration ? (current / duration) * 100 : 0) + '%';
  vcCurrent.textContent = formatTime(current);
  vcDuration.textContent = formatTime(duration);
}
function startProgressTimer(){
  stopProgressTimer();
  progressTimer = setInterval(updateProgress, 250);
}
function stopProgressTimer(){
  if (progressTimer) clearInterval(progressTimer);
  progressTimer = null;
}

function seekFraction(e){
  const rect = vcProgress.getBoundingClientRect();
  return Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
}
function previewSeek(e){
  if (!playerReady()) return;
  const frac = seekFraction(e);
  vcFill.style.width = (frac * 100) + '%';
  vcCurrent.textContent = formatTime(frac * ytPlayer.getDuration());
}

function updateMuteIcon(){
  const muted = playerReady() && typeof ytPlayer.isMuted === 'function' && ytPlayer.isMuted();
  vcMute.innerHTML = '<i class="fa-solid ' + (muted ? 'fa-volume-xmark' : 'fa-volume-high') + '"></i>';
}

function getFullscreenElement(){
  return document.fullscreenElement || document.webkitFullscreenElement || null;
}
function toggleFullscreen(){
  if (getFullscreenElement()) {
    (document.exitFullscreen || document.webkitExitFullscreen).call(document);
  } else {
    const req = videoModalInner.requestFullscreen || videoModalInner.webkitRequestFullscreen;
    if (req) req.call(videoModalInner);
  }
}
function updateFullscreenIcon(){
  const isFull = getFullscreenElement() === videoModalInner;
  vcFull.innerHTML = '<i class="fa-solid ' + (isFull ? 'fa-compress' : 'fa-expand') + '"></i>';
}

function showControls(){
  videoPlayer.classList.remove('is-idle');
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = null;
}
function scheduleIdle(){
  showControls();
  idleTimer = setTimeout(() => {
    if (playerReady() && ytPlayer.getPlayerState() === YT.PlayerState.PLAYING && !isSeeking) {
      videoPlayer.classList.add('is-idle');
    }
  }, 2500);
}

function resetPlayerUi(){
  vcFill.style.width = '0%';
  vcCurrent.textContent = '0:00';
  vcDuration.textContent = '0:00';
  setPlayIcons(true); // autoplay starts right away, so hide the big play button while loading
  showControls();
  updateMuteIcon();
}

function openVideo(card){
  if (!videoModal || !videoModalInner || !videoPlayer) return;
  const videoId = card.getAttribute('data-video');
  const format = card.getAttribute('data-format');
  videoModalInner.classList.toggle('format-short', format === 'short');
  videoModal.classList.add('active');
  resetPlayerUi();
  pendingVideoId = videoId;
  destroyPlayer();
  if (window.YT && typeof YT.Player === 'function') createPlayer(videoId);
  else loadYouTubeApi();
}

// Cards are rendered from data/projects.json, so clicks are delegated from the grid.
// (YouTube thumbnails are generated automatically in js/render.js unless a custom one is set.)
const portfolioGridEl = document.getElementById('portfolioGrid');
if (portfolioGridEl) {
  portfolioGridEl.addEventListener('click', (e) => {
    const card = e.target.closest('.project-card');
    if (card) openVideo(card);
  });
}

function closeVideo(){
  if (!videoModal || !videoPlayer) return;
  if (getFullscreenElement()) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
  videoModal.classList.remove('active');
  pendingVideoId = null;
  destroyPlayer();
}

// Custom player controls
if (videoShield) videoShield.addEventListener('click', () => { togglePlay(); scheduleIdle(); });
if (videoBigPlay) videoBigPlay.addEventListener('click', togglePlay);
if (vcPlay) vcPlay.addEventListener('click', togglePlay);
if (vcMute) vcMute.addEventListener('click', () => {
  if (!playerReady()) return;
  if (ytPlayer.isMuted()) ytPlayer.unMute(); else ytPlayer.mute();
  updateMuteIcon();
});
if (vcFull) {
  if (!(videoModalInner.requestFullscreen || videoModalInner.webkitRequestFullscreen)) {
    vcFull.style.display = 'none'; // e.g. iPhone Safari does not allow fullscreen on custom elements
  }
  vcFull.addEventListener('click', toggleFullscreen);
}
document.addEventListener('fullscreenchange', updateFullscreenIcon);
document.addEventListener('webkitfullscreenchange', updateFullscreenIcon);

if (vcProgress) {
  vcProgress.addEventListener('pointerdown', (e) => {
    isSeeking = true;
    vcProgress.setPointerCapture(e.pointerId);
    previewSeek(e);
  });
  vcProgress.addEventListener('pointermove', (e) => { if (isSeeking) previewSeek(e); });
  vcProgress.addEventListener('pointerup', (e) => {
    if (!isSeeking) return;
    isSeeking = false;
    if (playerReady()) ytPlayer.seekTo(seekFraction(e) * ytPlayer.getDuration(), true);
  });
  vcProgress.addEventListener('pointercancel', () => { isSeeking = false; });
}
if (videoPlayer) {
  ['mousemove', 'touchstart', 'pointerdown'].forEach(evt => {
    videoPlayer.addEventListener(evt, () => {
      if (playerReady() && ytPlayer.getPlayerState() === YT.PlayerState.PLAYING) scheduleIdle();
      else showControls();
    }, { passive: true });
  });
}

if (videoClose) videoClose.addEventListener('click', closeVideo);
if (videoModal) {
  videoModal.addEventListener('click', (e) => {
    if (e.target === videoModal) closeVideo();
  });
}
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && videoModal && videoModal.classList.contains('active')) {
    closeVideo();
  }
});

// ============ Short Form / Long Form Toggle ============
const portfolioGrid = document.getElementById('portfolioGrid');
const formatButtons = document.querySelectorAll('.format-toggle button');

let currentFormat = 'short';
function setFormat(format){
  if (!portfolioGrid) return;
  currentFormat = format;
  formatButtons.forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-format') === format);
  });
  document.querySelectorAll('.project-card').forEach(card => {
    const matches = card.getAttribute('data-format') === format;
    card.classList.toggle('is-hidden', !matches);
  });
  portfolioGrid.classList.toggle('mode-short', format === 'short');
  portfolioGrid.classList.toggle('mode-long', format === 'long');
  portfolioGrid.scrollTo({ left: 0, behavior: 'smooth' });
  const emptyNote = document.getElementById('portfolioEmpty');
  if (emptyNote) emptyNote.hidden = !!portfolioGrid.querySelector('.project-card:not(.is-hidden)');
}

formatButtons.forEach(btn => {
  btn.addEventListener('click', () => setFormat(btn.getAttribute('data-format')));
});
setFormat('short');

// ============ Portfolio Carousel Scroll Buttons ============
const prevBtn = document.getElementById('prevBtn');
const nextBtn = document.getElementById('nextBtn');
const viewAllBtn = document.getElementById('viewAllBtn');

function getScrollAmount() {
  if (!portfolioGrid) return 300;
  const visibleCard = portfolioGrid.querySelector('.project-card:not(.is-hidden)');
  return visibleCard ? visibleCard.offsetWidth + 20 : 300;
}

if (nextBtn && portfolioGrid) {
  nextBtn.addEventListener('click', () => {
    portfolioGrid.scrollBy({ left: getScrollAmount(), behavior: 'smooth' });
  });
}
if (prevBtn && portfolioGrid) {
  prevBtn.addEventListener('click', () => {
    portfolioGrid.scrollBy({ left: -getScrollAmount(), behavior: 'smooth' });
  });
}
if (viewAllBtn) {
  viewAllBtn.addEventListener('click', (e) => {
    e.preventDefault();
    const firstCard = portfolioGrid.querySelector('.project-card:not(.is-hidden)');
    if (firstCard) {
      portfolioGrid.scrollTo({ left: 0, behavior: 'smooth' });
    }
  });
}

// ============ Testimonials Rotator (data-driven) ============
let testimonials = [];
let testiIndex = 0;
let testiTimer = null;
const testiText = document.getElementById('testiText');
const testiName = document.getElementById('testiName');
const testiRole = document.getElementById('testiRole');
const testiDotsWrap = document.getElementById('testiDots');
const testiNext = document.getElementById('testiNext');
const testiPrev = document.getElementById('testiPrev');
const testiSection = document.getElementById('testimonials');

function renderTestimonial(i){
  if (!testiText || !testiName || !testiRole || !testimonials.length) return;
  const t = testimonials[i];
  testiText.textContent = t.text;
  testiName.textContent = '\u2013 ' + t.name;
  testiRole.textContent = t.role || '';
  if (testiDotsWrap) {
    testiDotsWrap.querySelectorAll('span').forEach((d, idx) => d.classList.toggle('active', idx === i));
  }
}

function startTestimonialTimer(){
  if (testiTimer) clearInterval(testiTimer);
  testiTimer = null;
  if (testimonials.length > 1) {
    testiTimer = setInterval(() => {
      testiIndex = (testiIndex + 1) % testimonials.length;
      renderTestimonial(testiIndex);
    }, 6000);
  }
}

function setTestimonials(list){
  testimonials = Array.isArray(list) ? list : [];
  testiIndex = 0;
  if (testiSection) testiSection.hidden = testimonials.length === 0;
  if (testiDotsWrap) {
    testiDotsWrap.textContent = '';
    testimonials.forEach((_, idx) => {
      const dot = document.createElement('span');
      if (idx === 0) dot.classList.add('active');
      testiDotsWrap.appendChild(dot);
    });
    testiDotsWrap.style.display = testimonials.length > 1 ? '' : 'none';
  }
  [testiPrev, testiNext].forEach(b => { if (b) b.style.display = testimonials.length > 1 ? '' : 'none'; });
  renderTestimonial(0);
  startTestimonialTimer();
}

if (testiNext) {
  testiNext.addEventListener('click', () => {
    if (!testimonials.length) return;
    testiIndex = (testiIndex + 1) % testimonials.length;
    renderTestimonial(testiIndex);
    startTestimonialTimer();
  });
}
if (testiPrev) {
  testiPrev.addEventListener('click', () => {
    if (!testimonials.length) return;
    testiIndex = (testiIndex - 1 + testimonials.length) % testimonials.length;
    renderTestimonial(testiIndex);
    startTestimonialTimer();
  });
}

// ============ Header shrink on scroll ============
const header = document.querySelector('header');
window.addEventListener('scroll', () => {
  if (!header) return;
  if (window.scrollY > 40) {
    header.style.boxShadow = '0 10px 30px rgba(0,0,0,0.4)';
  } else {
    header.style.boxShadow = 'none';
  }
});


// ============ Content loading (data/*.json) ============
// Public content lives in data/*.json (edited through the admin panel, which
// commits to GitHub). The page renders from those files on every visit.
const CONTENT_FILES = ['projects', 'about', 'experience', 'clients', 'services', 'testimonials'];
let siteData = {};

function applyContent(data){
  const R = window.AjazRender;
  if (!R || !data) return;
  if (data.about) R.renderAbout(data.about);
  if (data.projects) { R.renderProjects(data.projects.projects); setFormat(currentFormat); }
  if (data.services) R.renderServices(data.services.services);
  if (data.experience) R.renderExperience(data.experience.experience);
  if (data.clients) R.renderClients(data.clients.clients);
  if (data.testimonials) setTestimonials(data.testimonials.testimonials);
  observeReveals();
  updateActiveNav();
}

async function fetchContent(name, bust){
  const url = 'data/' + name + '.json' + (bust ? '?t=' + Date.now() : '');
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(name + ' ' + res.status);
  return res.json();
}

async function loadContent(){
  const results = await Promise.allSettled(CONTENT_FILES.map(n => fetchContent(n)));
  const loaded = {};
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') loaded[CONTENT_FILES[i]] = r.value;
    else console.error('Could not load content file:', CONTENT_FILES[i], r.reason);
  });
  siteData = loaded;
  applyContent(loaded);
  if (results.some(r => r.status === 'rejected') && !loaded.projects) {
    const note = document.getElementById('portfolioEmpty');
    if (note) { note.textContent = 'Projects could not be loaded right now. Please refresh the page.'; note.hidden = false; }
  }
}

// Small API the admin panel uses to preview unpublished changes on the real page
window.AjazSite = {
  getData: () => siteData,
  applyPreview: (data) => applyContent(data),
  restore: () => applyContent(siteData),
  fetchPublic: (name) => fetchContent(name, true),
  reload: loadContent
};

loadContent();


// ============ Admin panel (loaded only when the footer gear is clicked) ============
const adminGear = document.getElementById('adminGear');
let adminLoading = null;

function loadAdminAssets(){
  if (window.AjazAdmin) return Promise.resolve();
  if (adminLoading) return adminLoading;
  adminLoading = new Promise((resolve, reject) => {
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = 'css/admin.css';
    document.head.appendChild(css);
    const js = document.createElement('script');
    js.src = 'js/admin.js';
    js.onload = () => resolve();
    js.onerror = () => { adminLoading = null; js.remove(); reject(new Error('Could not load the admin panel.')); };
    document.body.appendChild(js);
  });
  return adminLoading;
}

if (adminGear) {
  adminGear.addEventListener('click', () => {
    adminGear.disabled = true;
    loadAdminAssets()
      .then(() => window.AjazAdmin.open())
      .catch(() => alert('The admin panel could not be loaded. Check your connection and try again.'))
      .then(() => { adminGear.disabled = false; });
  });
}


// ============ Demo announcement banner: Read more / Read less ============
(function(){
  const toggle = document.getElementById('demoBannerToggle');
  const more = document.getElementById('demoBannerMore');
  if (!toggle || !more) return;
  toggle.addEventListener('click', () => {
    const expand = more.hidden;
    more.hidden = !expand;
    toggle.setAttribute('aria-expanded', String(expand));
    toggle.textContent = expand ? 'Read less' : 'Read more';
  });
})();
