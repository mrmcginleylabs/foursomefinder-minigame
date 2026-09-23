import { createClient } from '@base44/sdk';
import gameHtml from './gameHtml.js';
import { shareCardImage } from './shareCard.js';

const SESSION_SHOTS = 5;
const APP_ID = import.meta.env.VITE_BASE44_APP_ID;
const ALLOWED_PARENT_ORIGINS = (import.meta.env.VITE_ALLOWED_PARENT_ORIGINS || '')
  .split(',').map(s => s.trim()).filter(Boolean);
const GAME_URL = 'https://foursomefinder-minigame.vercel.app';

let base44 = null;
function getClient() {
  if (!base44) base44 = createClient({ appId: APP_ID });
  return base44;
}

// ── ET date + guest helpers (mirrors the core app's logic) ──────────────────
function getDailySeed() {
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
  const p = fmt.formatToParts(new Date());
  const y = p.find(x => x.type === 'year').value;
  const m = p.find(x => x.type === 'month').value;
  const d = p.find(x => x.type === 'day').value;
  return `${y}-${m}-${d}`;
}
function getTodayDateLabel() {
  return new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
}
function getGuestId() {
  let id = localStorage.getItem('4sf_minigame_guest_id');
  if (!id) {
    id = 'g_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem('4sf_minigame_guest_id', id);
  }
  return id;
}
function getGuestDisplayName(gid) {
  let h = 0;
  for (let i = 0; i < gid.length; i++) h = ((h << 5) - h + gid.charCodeAt(i)) | 0;
  return `Guest ${String(Math.abs(h) % 10000).padStart(4, '0')}`;
}
function getGuestName() {
  return localStorage.getItem('4sf_minigame_player_name') || '';
}
function saveGuestName(name) {
  localStorage.setItem('4sf_minigame_player_name', name);
}
// Compute conditions using the EXACT SAME PRNG sequence as the server, so even
// when the server call fails, the game shows identical conditions. Always
// deterministic per day — no randomness per refresh or per player.
function mulberry32(seedStr) {
  let a = 0;
  for (let i = 0; i < seedStr.length; i++) a = (Math.imul(31, a) + seedStr.charCodeAt(i)) | 0;
  a = a >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function deterministicConditions(seedStr) {
  const rand = mulberry32(String(seedStr) + "|conditions");
  const yardage = Math.round(105 + rand() * 90);
  const pinNormX = (rand() * 1.4) - 0.7;
  const pinNormY = (rand() * 1.4) - 0.7;
  const windSpeed = Math.floor(rand() * 21);
  let windAngleDeg = Math.floor(rand() * 360);
  const VA = 25;
  if (windAngleDeg > 90 - VA && windAngleDeg < 90 + VA) windAngleDeg = windAngleDeg < 90 ? 90 - VA : 90 + VA;
  else if (windAngleDeg > 270 - VA && windAngleDeg < 270 + VA) windAngleDeg = windAngleDeg < 270 ? 270 - VA : 270 + VA;
  const slopeX = (rand() * 0.006) - 0.003;
  const slopeY = (rand() * 0.006) - 0.003;
  return { yardage, pinNormX, pinNormY, windSpeed, windAngleDeg, slopeX, slopeY };
}

function getConfigCacheKey() { return `4sf_minigame_config_${getDailySeed()}`; }
function loadCachedConfig() {
  try {
    const raw = localStorage.getItem(getConfigCacheKey());
    if (!raw) return null;
    const d = JSON.parse(raw);
    if (d.daily_seed !== getDailySeed()) { localStorage.removeItem(getConfigCacheKey()); return null; }
    return d.config;
  } catch { return null; }
}
function saveCachedConfig(config) { try { localStorage.setItem(getConfigCacheKey(), JSON.stringify({ daily_seed: getDailySeed(), config })); } catch {} }

function getHeldKey() { return `4sf_minigame_held_${getDailySeed()}`; }
function loadHeld() {
  try {
    const raw = localStorage.getItem(getHeldKey());
    if (!raw) return null;
    const d = JSON.parse(raw);
    if (d.daily_seed !== getDailySeed()) { localStorage.removeItem(getHeldKey()); return null; }
    return d;
  } catch { return null; }
}
function saveHeld(s) { localStorage.setItem(getHeldKey(), JSON.stringify(s)); }
function clearHeld() { localStorage.removeItem(getHeldKey()); }

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// First-time guests pick a display name before the game loads. Stored in
// localStorage so returning visitors are remembered. No account required.
async function ensureGuestName() {
  if (getGuestName()) return;
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(10,38,18,0.98);display:flex;flex-direction:column;align-items:center;justify-content:center;z-index:200;padding:24px;text-align:center;';
    overlay.innerHTML =
      '<h2 style="color:#facc15;font-size:24px;margin:0 0 8px;">Welcome, Golfer!</h2>' +
      '<p style="color:rgba(255,255,255,0.8);font-size:14px;margin:0 0 20px;max-width:280px;line-height:1.5;">Pick a name for the leaderboard. No account needed — just play!</p>' +
      '<input id="guest-name-input" type="text" maxlength="20" placeholder="Your player name" style="width:100%;max-width:280px;padding:14px;border-radius:10px;border:1px solid rgba(250,204,21,0.4);background:rgba(0,0,0,0.4);color:#fff;font-size:16px;outline:none;text-align:center;" />' +
      '<button id="guest-name-submit" style="margin-top:12px;padding:14px 32px;border:0;border-radius:10px;background:#facc15;color:#0a2612;font-weight:800;font-size:16px;cursor:pointer;width:100%;max-width:280px;">Start Playing</button>';
    document.body.appendChild(overlay);
    const input = overlay.querySelector('#guest-name-input');
    const btn = overlay.querySelector('#guest-name-submit');
    input.focus();
    function submit() {
      const name = input.value.trim();
      if (name.length < 2) { input.style.borderColor = '#ef4444'; return; }
      saveGuestName(name);
      overlay.remove();
      resolve();
    }
    btn.onclick = submit;
    input.onkeydown = (e) => { if (e.key === 'Enter') submit(); };
  });
}

// ── Auth pass-through: receive the member token from the FF parent iframe ──
async function requestParentToken() {
  if (window.parent === window) return false; // standalone (direct visit)
  window.parent.postMessage({ type: '4SF_REQUEST_AUTH' }, '*');
  return new Promise(resolve => {
    let done = false;
    const handler = (e) => {
      if (done) return;
      if (e.data && e.data.type === '4SF_AUTH' && ALLOWED_PARENT_ORIGINS.includes(e.origin)) {
        done = true;
        window.removeEventListener('message', handler);
        const token = e.data.token;
        try { localStorage.setItem('base44_access_token', token); } catch {}
        const c = getClient();
        try { if (c.auth.setToken) c.auth.setToken(token); } catch {}
        resolve(true);
      }
    };
    window.addEventListener('message', handler);
    // If the parent doesn't respond (e.g. not embedded in FF), proceed as guest.
    setTimeout(() => { if (!done) { done = true; window.removeEventListener('message', handler); resolve(false); } }, 2500);
  });
}

// ── Background music: "Morning Gold" during play, "The Quiet Stride" for the leaderboard ──
const TRACKS = {
  gameplay: 'https://media.base44.com/files/public/6a80e7c07aa31885a392902e/6d6b22e1d_Morning_Gold_on_Georgia_Soil.mp3',
  leaderboard: 'https://media.base44.com/files/public/6a80e7c07aa31885a392902e/be4256818_The_Quiet_Stride.mp3',
};
let gameplayMusic = null, leaderboardMusic = null, musicStarted = false, musicMuted = false;

function initMusic() {
  if (gameplayMusic) return;
  gameplayMusic = new Audio(TRACKS.gameplay);
  gameplayMusic.loop = true;
  gameplayMusic.volume = 0.35;
  leaderboardMusic = new Audio(TRACKS.leaderboard);
  leaderboardMusic.loop = true;
  leaderboardMusic.volume = 0.55;
}
function startGameplayMusic() {
  if (musicStarted) return;
  musicStarted = true;
  if (musicMuted) return;
  initMusic();
  if (!leaderboardMusic.paused) { leaderboardMusic.pause(); leaderboardMusic.currentTime = 0; }
  gameplayMusic.play().catch(() => {});
}
function resumeGameplayMusic() {
  if (musicMuted) return;
  initMusic();
  if (!leaderboardMusic.paused) leaderboardMusic.pause();
  if (gameplayMusic.paused) gameplayMusic.play().catch(() => {});
}
function playLeaderboardMusic() {
  if (musicMuted) return;
  initMusic();
  if (!gameplayMusic.paused) gameplayMusic.pause();
  if (leaderboardMusic.paused) leaderboardMusic.play().catch(() => {});
}
function updateMuteBtn() {
  const btn = document.getElementById('mute-btn');
  if (btn) btn.textContent = musicMuted ? '🔇' : '🔊';
}
function toggleMute() {
  musicMuted = !musicMuted;
  initMusic();
  gameplayMusic.muted = musicMuted;
  leaderboardMusic.muted = musicMuted;
  if (musicMuted) {
    if (!gameplayMusic.paused) gameplayMusic.pause();
    if (!leaderboardMusic.paused) leaderboardMusic.pause();
  } else if (musicStarted) {
    if (leaderboardMusic.paused) gameplayMusic.play().catch(() => {});
  }
  updateMuteBtn();
}
function buildMuteButton() {
  const existing = document.getElementById('mute-btn');
  if (existing) return;
  const btn = document.createElement('button');
  btn.id = 'mute-btn';
  btn.textContent = '🔊';
  btn.style.cssText = 'position:fixed;bottom:14px;right:14px;width:44px;height:44px;border-radius:50%;border:0;background:rgba(10,38,18,0.85);color:#facc15;font-size:20px;z-index:200;cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(0,0,0,0.45);';
  btn.title = 'Toggle audio';
  btn.onclick = toggleMute;
  document.body.appendChild(btn);
}

async function main() {
  const client = getClient();
  const dailySeed = getDailySeed();
  const dateLabel = getTodayDateLabel();
  const guestId = getGuestId();
  const guestDisplayName = getGuestDisplayName(guestId);

  // Check for a `?date=YYYY-MM-DD` param — used by admin to view past holes.
  // When present and not today, the game renders in view-only mode with that
  // date's conditions and leaderboard.
  const urlDateParam = new URLSearchParams(window.location.search).get('date');
  const isPastDate = urlDateParam && urlDateParam !== dailySeed;

  document.getElementById('date-label').textContent = isPastDate
    ? `${urlDateParam} · Past Challenge`
    : `${dateLabel} · Closest to the Pin`;

  // Read the auth token from the URL hash (passed by the parent iframe).
  // This is the primary, most reliable method — no postMessage round-trip or
  // origin-check env var needed. The hash is cleaned from the URL afterwards.
  const hashParams = new URLSearchParams(window.location.hash.slice(1));
  const hashToken = hashParams.get('token');
  if (hashToken) {
    try { localStorage.setItem('base44_access_token', hashToken); } catch {}
    try { if (client.auth.setToken) client.auth.setToken(hashToken); } catch {}
    history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  // Fall back to postMessage if no hash token (direct visit or older parent)
  if (!hashToken) {
    await requestParentToken();
  }

  let user = null, isMember = false;
  try { user = await client.auth.me(); isMember = !!user; } catch { user = null; isMember = false; }

  // If a returning guest is now a member, convert their server-side guest
  // score to a member score (finds it by anonymous_id + today's date).
  if (isMember) {
    try {
      const r = await client.functions.invoke('migrate-guest-score', {
        anonymous_id: guestId,
      });
      if (r.data && r.data.migrated) {
        // Score was converted — leaderboard will reflect member status.
      }
    } catch { /* silent */ }
  }

  // Guest name gate — first-time visitors pick a name before the game loads.
  if (!isMember && !isPastDate) {
    await ensureGuestName();
  }

  let gameConfig = { dailyNumber: 0, subtitle: '', holeIndex: 1, seed: dailySeed, conditions: null };
  let leaderboard = { top20: [], ownScore: null };
  let hallOfFame = [];
  let memberPlayedToday = false, hasReplayed = false, guestPlayedToday = false;

  if (isPastDate) {
    // View-only mode: fetch the past date's config + leaderboard
    try {
      const r = await client.functions.invoke('get-past-leaderboard', { date: urlDateParam });
      if (r.data) {
        gameConfig = r.data.gameConfig || gameConfig;
        leaderboard = { top20: (r.data.leaderboard && r.data.leaderboard.top20) || [], ownScore: null };
      }
    } catch { /* silent */ }
  } else {
    try {
      const lb = await client.functions.invoke('get-daily-leaderboard', { anonymous_id: isMember ? undefined : guestId });
      leaderboard = lb.data || leaderboard;
      if (isMember && leaderboard.ownScore) {
        memberPlayedToday = true;
        hasReplayed = !!leaderboard.ownScore.has_replayed;
      } else if (!isMember && leaderboard.ownScore) {
        guestPlayedToday = true;
      }
    } catch { /* silent */ }

    try {
      const c = await client.functions.invoke('get-daily-game-config', {});
      if (c.data) {
        gameConfig = c.data;
        saveCachedConfig(c.data);
      }
    } catch {
      // Server call failed — use cached config, then local fallback.
      const cached = loadCachedConfig();
      if (cached) {
        gameConfig = cached;
      } else {
        const seed = getDailySeed();
        const dayJs = new Date();
        const jsDay = dayJs.getDay();
        const dow = jsDay === 0 ? 7 : jsDay;
        gameConfig = {
          dailyNumber: 0,
          subtitle: '',
          sponsorLink: '',
          holeIndex: dow,
          seed,
          conditions: deterministicConditions(seed),
        };
      }
    }

    try {
      const h = await client.functions.invoke('get-hall-of-fame', {});
      hallOfFame = (h.data && h.data.hallOfFame) || [];
    } catch { /* silent */ }
  }

  function applyHeading() {
    const yardage = gameConfig.conditions && gameConfig.conditions.yardage
      ? gameConfig.conditions.yardage : null;
    const numLabel = gameConfig.dailyNumber > 0
      ? `#${String(gameConfig.dailyNumber).padStart(3, '0')}`
      : '';
    const headingText = numLabel && yardage
      ? `${numLabel} - ${yardage} Yards`
      : numLabel
        ? numLabel
        : yardage
          ? `${yardage} Yards`
          : 'Daily Closest to the Pin';
    document.getElementById('heading').textContent = headingText;
    const sub = document.getElementById('subtitle');
    if (gameConfig.subtitle) { sub.textContent = gameConfig.subtitle; sub.style.display = 'block'; }
    else { sub.style.display = 'none'; }
  }
  applyHeading();

  // Reveal the app now that data is ready.
  document.getElementById('boot').style.display = 'none';
  document.getElementById('app').style.display = 'flex';
  buildMuteButton();

  // ── Embed the Canvas game in a same-origin srcDoc iframe ─────────────────
  const iframe = document.getElementById('game');
  const sessionShots = [];
  let sessionComplete = false, sessionResult = null;

  iframe.addEventListener('load', () => {
    const win = iframe.contentWindow;
    win.onShotComplete = (distanceFeet, isHoleInOne) => {
      sessionShots.push({ distance: distanceFeet, isHoleInOne: !!isHoleInOne });
      try { win.setShotsRemaining(sessionShots.length); } catch {}
      if (sessionShots.length >= SESSION_SHOTS) submitSession([...sessionShots]);
    };
    win.onFirstInteraction = () => startGameplayMusic();
    win.onScrollToLeaderboard = () => {
      playLeaderboardMusic();
      document.getElementById('leaderboard').scrollIntoView({ behavior: 'smooth' });
    };
    try { win.setDailyConditions(gameConfig.holeIndex || 1, gameConfig.seed || dailySeed, gameConfig.conditions); } catch {}
    try { win.setShotsRemaining(0); } catch {}
    const numLabel = gameConfig.dailyNumber > 0
      ? `#${String(gameConfig.dailyNumber).padStart(3, '0')}`
      : '';
    const yardage = gameConfig.conditions && gameConfig.conditions.yardage
      ? gameConfig.conditions.yardage : null;
    const gameLabel = numLabel && yardage
      ? `${numLabel} - ${yardage} Yards`
      : numLabel || (yardage ? `${yardage} Yards` : 'Daily Closest to the Pin');
    try { win.setGameHeading(gameLabel, gameConfig.subtitle || ''); } catch {}
  });
  iframe.srcdoc = gameHtml;

  // If the player already completed today's round, lock the game area.
  // Members who still have a replay are NOT locked — they can play again.
  if ((!isMember && guestPlayedToday) || (isMember && memberPlayedToday && hasReplayed)) {
    const wrap = document.getElementById('game-wrap');
    const locked = document.createElement('div');
    locked.style.cssText = 'position:absolute;inset:0;background:rgba(10,38,18,0.95);display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:20px;z-index:5;pointer-events:auto;';
    locked.innerHTML = '<h2 style="color:#facc15;font-size:22px;margin:0 0 10px;">You played today!</h2><p style="color:#fff;font-size:14px;max-width:280px;line-height:1.5;">Come back tomorrow for a new challenge. Scroll down to see today\'s leaderboard.</p>';
    wrap.appendChild(locked);
  }

  async function submitSession(shots) {
    if (isPastDate) return; // view-only mode — no scores for past dates
    const distances = shots.map(s => s.distance);
    const best_distance = Math.min(...distances);
    const ace_count = shots.filter(s => s.isHoleInOne).length;
    const first_achieved_at = new Date().toISOString();

    if (isMember) {
      try {
        const replay = memberPlayedToday && !hasReplayed;
        const r = await client.functions.invoke('submit-game-score', { shot_history: distances, replay });
        const d = r.data;
        if (d && d.allowed) {
          leaderboard = { top20: d.top20, ownScore: d.ownScore };
          memberPlayedToday = true;
          hasReplayed = replay || hasReplayed || !!(d.ownScore && d.ownScore.has_replayed);
          sessionComplete = true;
          sessionResult = { best_distance, ace_count, first_achieved_at };
          try { iframe.contentWindow.playCelebration(); } catch {}
          renderAll();
        }
      } catch { /* silent */ }
      return;
    }

    // Guest: submit to server — score appears on the leaderboard immediately.
    try {
      const r = await client.functions.invoke('submit-game-score', {
        shot_history: distances,
        anonymous_id: guestId,
        player_name: getGuestName(),
      });
      const d = r.data;
      if (d && d.allowed) {
        leaderboard = { top20: d.top20, ownScore: d.ownScore };
        guestPlayedToday = true;
        sessionComplete = true;
        sessionResult = { best_distance, ace_count, first_achieved_at };
        try { iframe.contentWindow.playCelebration(); } catch {}
        renderAll();
      } else if (d && d.lockedMessage) {
        guestPlayedToday = true;
        if (d.top20) leaderboard = { top20: d.top20, ownScore: d.ownScore };
      }
    } catch { /* silent */ }
  }

  function startReplay() {
    sessionShots.length = 0;
    sessionComplete = false;
    sessionResult = null;
    resumeGameplayMusic();
    try { iframe.contentWindow.resetGame(); } catch {}
    try { iframe.contentWindow.setShotsRemaining(0); } catch {}
    renderAll();
  }

  function shareScore() {
    const isHoleInOne = sessionResult.best_distance === 0;
    const shareText = `🎯 ${isHoleInOne ? 'Hole in One' : sessionResult.best_distance + ' ft from pin'} on Closest to the Pin Challenge! Can you beat me?`;
    const shareUrl = 'https://foursomefinder.com/play';

    // If embedded in the parent app, delegate the share via postMessage.
    // navigator.share works reliably from the top-level page context, not
    // inside a cross-origin iframe — so the parent handles the actual share.
    if (window.parent !== window) {
      window.parent.postMessage({ type: '4SF_SHARE', text: shareText, url: shareUrl }, '*');
      return;
    }

    // Standalone (direct visit) — try navigator.share, fall back to image card
    if (navigator.share) {
      navigator.share({ text: shareText, url: shareUrl, title: 'Closest to the Pin Challenge' })
        .catch(() => showImageCard());
    } else {
      showImageCard();
    }
  }

  function showImageCard() {
    const isHoleInOne = sessionResult.best_distance === 0;
    shareCardImage({
      playerName: isMember ? (user?.full_name || 'You') : (getGuestName() || guestDisplayName),
      distance: sessionResult.best_distance,
      isHoleInOne,
      aceCount: sessionResult.ace_count,
      dateLabel,
      dailyNumber: gameConfig.dailyNumber,
    });
  }

  function renderLeaderboard() {
    const root = document.getElementById('leaderboard');
    let html = '<div class="lb-tab"><button id="tab-today" class="active">Today</button><button id="tab-past">Past</button><button id="tab-hof">Hall of Fame</button></div>';
    html += '<div id="lb-body"></div>';
    if (!isMember && !isPastDate) {
      html += '<button class="replay-btn" id="join-ff-lb-btn" style="margin:8px 0;padding:10px;border:1px solid rgba(250,204,21,0.4);border-radius:8px;background:rgba(250,204,21,0.1);color:#facc15;font-weight:bold;cursor:pointer;width:100%">Join Foursome Finder</button>'
        + '<p class="hint">Find golf buddies and schedule rounds together.</p>';
    }
    root.innerHTML = html;

    let tab = isPastDate ? 'past' : 'today';

    async function loadPastBody(selectedDate) {
      const b = document.getElementById('lb-body');
      if (!selectedDate) {
        b.innerHTML = '<input type="date" id="past-date" max="' + new Date().toISOString().slice(0,10) + '" style="width:100%;padding:10px;border-radius:8px;border:1px solid rgba(255,255,255,0.2);background:rgba(0,0,0,0.3);color:#fff;font-size:14px;margin-bottom:10px" />'
          + '<p class="hint">Pick a date to see that day\'s leaderboard.</p>';
        const dp = document.getElementById('past-date');
        if (dp) dp.onchange = () => loadPastBody(dp.value);
        return;
      }
      b.innerHTML = '<p class="hint">Loading...</p>';
      try {
        const r = await client.functions.invoke('get-past-leaderboard', { date: selectedDate });
        const d = r.data;
        if (!d) { b.innerHTML = '<p class="hint">No data for this date.</p>'; return; }
        let rows = '<input type="date" id="past-date" value="' + selectedDate + '" max="' + new Date().toISOString().slice(0,10) + '" style="width:100%;padding:10px;border-radius:8px;border:1px solid rgba(255,255,255,0.2);background:rgba(0,0,0,0.3);color:#fff;font-size:14px;margin-bottom:10px" />';
        const top20 = (d.leaderboard && d.leaderboard.top20) || [];
        const winner = d.winner;
        if (winner) {
          rows += `<div class="lb-row" style="background:rgba(250,204,21,0.18);border:1px solid #facc15"><div class="lb-rank">🏆</div><div class="lb-name">${escapeHtml(winner.player_name)}<span class="lb-ace">WIN</span></div><div class="lb-dist">${winner.is_hole_in_one ? 'HIO' : winner.distance + ' ft'}</div></div>`;
        }
        if (top20.length === 0 && !winner) {
          rows += '<p class="hint">No scores for this date.</p>';
        }
        top20.forEach(e => {
          rows += `<div class="lb-row"><div class="lb-rank">#${e.rank}</div><div class="lb-name">${escapeHtml(e.player_name)}</div><div class="lb-dist">${e.is_hole_in_one ? 'HIO' : e.distance + ' ft'}</div></div>`;
        });
        b.innerHTML = rows;
        const dp = document.getElementById('past-date');
        if (dp) dp.onchange = () => loadPastBody(dp.value);
      } catch {
        b.innerHTML = '<p class="hint">Could not load past leaderboard.</p>';
      }
    }

    function body() {
      const b = document.getElementById('lb-body');
      if (tab === 'today') {
        let rows = '';
        if (leaderboard.top20.length === 0 && !leaderboard.ownScore) {
          rows = '<p class="hint">No scores yet today. Be the first!</p>';
        }
        leaderboard.top20.forEach(e => {
          const aceTag = e.is_hole_in_one ? '<span class="lb-ace">ACE</span>' : (e.ace_count > 1 ? `<span class="lb-ace">${e.ace_count}×</span>` : '');
          rows += `<div class="lb-row"><div class="lb-rank">#${e.rank}</div><div class="lb-name">${escapeHtml(e.player_name)}${aceTag}</div><div class="lb-dist">${e.is_hole_in_one ? 'HIO' : e.distance + ' ft'}</div></div>`;
        });
        if (leaderboard.ownScore && !leaderboard.ownScore.in_top20) {
          const o = leaderboard.ownScore;
          rows += `<div class="lb-row me"><div class="lb-rank">#${o.rank}</div><div class="lb-name">You${o.is_hole_in_one ? '<span class="lb-ace">ACE</span>' : ''}</div><div class="lb-dist">${o.is_hole_in_one ? 'HIO' : o.distance + ' ft'}</div></div>`;
        }
        b.innerHTML = rows;
      } else if (tab === 'hof') {
        let rows = '';
        if (hallOfFame.length === 0) {
          rows = '<p class="hint">No champions yet. Win a day to claim the Hall of Fame!</p>';
        }
        hallOfFame.forEach((p, i) => {
          rows += `<div class="lb-row"><div class="lb-rank">${i + 1}</div><div class="lb-name">${escapeHtml(p.player_name)}</div><div class="lb-dist">${p.win_count} win${p.win_count === 1 ? '' : 's'}</div></div>`;
        });
        b.innerHTML = rows;
      } else {
        // Past tab
        loadPastBody(isPastDate ? urlDateParam : '');
      }
    }
    function setTab(t) {
      tab = t;
      ['today', 'past', 'hof'].forEach(id => {
        const el = document.getElementById('tab-' + id);
        if (el) el.classList.toggle('active', id === t);
      });
      body();
    }
    body();
    const todayBtn = document.getElementById('tab-today');
    if (todayBtn) todayBtn.onclick = () => setTab('today');
    const pastBtn = document.getElementById('tab-past');
    if (pastBtn) pastBtn.onclick = () => setTab('past');
    const hofBtn = document.getElementById('tab-hof');
    if (hofBtn) hofBtn.onclick = () => setTab('hof');
    const claim = document.getElementById('join-ff-lb-btn');
    if (claim) claim.onclick = () => client.auth.redirectToLogin(window.location.href);
  }

  function renderResultOverlay() {
    const ov = document.getElementById('overlay');
    if (!sessionComplete || !sessionResult) { ov.innerHTML = ''; return; }
    const best = sessionResult.best_distance;
    const replayable = isMember && memberPlayedToday && !hasReplayed;
    let html = '<div class="result-overlay"><h2>Round Complete!</h2>';
    html += '<div class="result-stats"><div><div class="lbl">Best</div><div class="big">' + (best === 0 ? '🎯 HIO' : best + ' ft') + '</div></div>';
    if (sessionResult.ace_count >= 1) {
      html += `<div><div class="lbl">Aces</div><div class="big">${sessionResult.ace_count}/5</div></div>`;
    }
    html += '</div>';
    html += '<button class="share-btn" id="share-btn">Share Score</button>';
    html += '<button class="replay-btn" id="view-lb-btn" style="margin-top:8px">View Leaderboard</button>';
    html += '<button class="replay-btn" id="scorecard-btn" style="margin-top:8px">View Scorecard</button>';
    if (isMember) {
      if (replayable) {
        html += '<button class="replay-btn" id="replay-btn">Play Again</button>';
        html += '<p class="replay-warn">Replaying replaces your session and resets your tiebreak time.</p>';
      }
    } else {
      html += '<button class="replay-btn" id="join-ff-btn" style="margin-top:8px">Join Foursome Finder</button>';
      html += '<p class="hint">Find golf buddies, schedule rounds, and share availability.</p>';
    }
    // ── Tag Me: reward-framed social handle capture ──
    html += '<div class="tagme">';
    html += '<h3>🏆 Get tagged if you win</h3>';
    html += '<p class="tagme-sub">Add your socials so we can shout you out the moment you top today\'s board.</p>';
    html += '<div class="tagme-inputs">';
    html += '<input id="tm-ig" type="text" placeholder="Instagram @handle" autocomplete="off" />';
    html += '<input id="tm-x" type="text" placeholder="X @handle" autocomplete="off" />';
    html += '<input id="tm-tt" type="text" placeholder="TikTok @handle" autocomplete="off" />';
    html += '</div>';
    html += '<button class="tagme-btn" id="tm-save">Save &amp; tag me</button>';
    html += '<p class="tagme-saved" id="tm-saved" style="display:none">Saved — you\'re taggable if you win today! 🎉</p>';
    html += '</div>';
    html += '</div>';
    ov.innerHTML = html;
    document.getElementById('share-btn').onclick = shareScore;
    const vl = document.getElementById('view-lb-btn'); if (vl) vl.onclick = () => { playLeaderboardMusic(); document.getElementById('leaderboard').scrollIntoView({ behavior: 'smooth' }); };
    const sc = document.getElementById('scorecard-btn'); if (sc) sc.onclick = showImageCard;
    const rp = document.getElementById('replay-btn'); if (rp) rp.onclick = startReplay;
    const jf = document.getElementById('join-ff-btn'); if (jf) jf.onclick = () => client.auth.redirectToLogin(window.location.href);
    // Pre-fill + wire the Tag Me inputs
    const igI = document.getElementById('tm-ig');
    const xI = document.getElementById('tm-x');
    const ttI = document.getElementById('tm-tt');
    if (igI) {
      const init = isMember ? (user || {}) : (leaderboard.ownScore || {});
      igI.value = init.instagram_handle || '';
      xI.value = init.x_handle || '';
      ttI.value = init.tiktok_handle || '';
    }
    const tmSave = document.getElementById('tm-save');
    if (tmSave) tmSave.onclick = async () => {
      const handles = {
        instagram_handle: (igI?.value || '').trim().replace(/^@/, ''),
        x_handle: (xI?.value || '').trim().replace(/^@/, ''),
        tiktok_handle: (ttI?.value || '').trim().replace(/^@/, ''),
      };
      tmSave.disabled = true; tmSave.textContent = 'Saving…';
      try {
        if (isMember) {
          await client.auth.updateMe(handles);
          const r = await client.functions.invoke('submit-game-score', { update_handles_only: true });
          if (r.data) { leaderboard = { top20: r.data.top20, ownScore: r.data.ownScore }; }
        } else {
          const r = await client.functions.invoke('submit-game-score', { update_handles_only: true, anonymous_id: guestId, ...handles });
          if (r.data) { leaderboard = { top20: r.data.top20, ownScore: r.data.ownScore }; }
        }
        const saved = document.getElementById('tm-saved'); if (saved) saved.style.display = 'block';
        renderLeaderboard();
      } catch { /* silent */ }
      tmSave.disabled = false; tmSave.textContent = 'Save & tag me';
    };
  }

  function renderAll() { renderLeaderboard(); renderResultOverlay(); }

  const lbBtn = document.getElementById('lb-scroll-btn');
  if (lbBtn) lbBtn.onclick = () => { playLeaderboardMusic(); document.getElementById('leaderboard').scrollIntoView({ behavior: 'smooth' }); };

  renderAll();
}

main().catch(err => { console.error('minigame init failed', err); });
