import { createClient } from '@base44/sdk';
import gameHtml from './gameHtml.js';

const SESSION_SHOTS = 5;
const APP_ID = import.meta.env.VITE_BASE44_APP_ID;
const ALLOWED_PARENT_ORIGINS = (import.meta.env.VITE_ALLOWED_PARENT_ORIGINS || '')
  .split(',').map(s => s.trim()).filter(Boolean);
const GAME_URL = 'https://play.foursomefinder.com';

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

async function main() {
  const client = getClient();
  const dailySeed = getDailySeed();
  const dateLabel = getTodayDateLabel();
  const guestId = getGuestId();
  const guestDisplayName = getGuestDisplayName(guestId);

  document.getElementById('date-label').textContent = `${dateLabel} · Closest to the Pin`;

  await requestParentToken();

  let user = null, isMember = false;
  try { user = await client.auth.me(); isMember = !!user; } catch { user = null; isMember = false; }

  // If a guest played earlier today and is now a member, migrate the held session.
  if (isMember) {
    const held = loadHeld();
    if (held) {
      try {
        const r = await client.functions.invoke('migrate-guest-score', {
          anonymous_id: held.anonymous_id,
          best_distance: held.best_distance,
          ace_count: held.ace_count,
          shot_history: held.shot_history,
          first_achieved_at: held.first_achieved_at,
          daily_seed: held.daily_seed,
          instagram_handle: held.instagram_handle || '',
          x_handle: held.x_handle || '',
          tiktok_handle: held.tiktok_handle || '',
        });
        if (r.data && r.data.migrated) {
          // Persist the guest's captured handles onto the new member's profile
          // so future score snapshots include them.
          try {
            await client.auth.updateMe({
              instagram_handle: held.instagram_handle || '',
              x_handle: held.x_handle || '',
              tiktok_handle: held.tiktok_handle || '',
            });
          } catch { /* silent */ }
          clearHeld();
        }
      } catch { /* silent */ }
    }
  }

  let gameConfig = { dailyNumber: 0, subtitle: '', holeIndex: 1, seed: dailySeed, conditions: null };
  let leaderboard = { top20: [], ownScore: null };
  let hallOfFame = [];
  let memberPlayedToday = false, hasReplayed = false;

  try {
    const lb = await client.functions.invoke('get-daily-leaderboard', { anonymous_id: isMember ? undefined : guestId });
    leaderboard = lb.data || leaderboard;
    if (isMember && leaderboard.ownScore) {
      memberPlayedToday = true;
      hasReplayed = !!leaderboard.ownScore.has_replayed;
    }
  } catch { /* silent */ }

  try {
    const c = await client.functions.invoke('get-daily-game-config', {});
    if (c.data) gameConfig = c.data;
  } catch { /* silent */ }

  try {
    const h = await client.functions.invoke('get-hall-of-fame', {});
    hallOfFame = (h.data && h.data.hallOfFame) || [];
  } catch { /* silent */ }

  function applyHeading() {
    const yardage = gameConfig.conditions && gameConfig.conditions.yardage
      ? gameConfig.conditions.yardage : null;
    const dayLabel = gameConfig.dailyNumber > 0
      ? `Daily Par 3 - #${String(gameConfig.dailyNumber).padStart(3, '0')}`
      : 'Daily Par 3 - Coming Soon';
    document.getElementById('heading').textContent = yardage
      ? `${dayLabel} · ${yardage} yds`
      : dayLabel;
    const sub = document.getElementById('subtitle');
    if (gameConfig.subtitle) { sub.textContent = gameConfig.subtitle; sub.style.display = 'block'; }
    else { sub.style.display = 'none'; }
  }
  applyHeading();

  // Reveal the app now that data is ready.
  document.getElementById('boot').style.display = 'none';
  document.getElementById('app').style.display = 'flex';

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
    win.onScrollToLeaderboard = () => {
      document.getElementById('leaderboard').scrollIntoView({ behavior: 'smooth' });
    };
    try { win.setDailyConditions(gameConfig.holeIndex || 1, gameConfig.seed || dailySeed, gameConfig.conditions); } catch {}
    try { win.setShotsRemaining(0); } catch {}
    const label = gameConfig.dailyNumber > 0
      ? `Daily Par 3 - #${String(gameConfig.dailyNumber).padStart(3, '0')}`
      : 'Daily Par 3 - Coming Soon';
    try { win.setGameHeading(label, gameConfig.subtitle || ''); } catch {}
  });
  iframe.srcdoc = gameHtml;

  async function submitSession(shots) {
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

    // Guest: hold the session (same-day expiry) until they sign up.
    saveHeld({
      anonymous_id: guestId, best_distance, ace_count, shot_history: distances,
      first_achieved_at, daily_seed: getDailySeed(), player_name: guestDisplayName,
    });
    sessionResult = { best_distance, ace_count, first_achieved_at };
    sessionComplete = true;
    renderAll();
  }

  function startReplay() {
    sessionShots.length = 0;
    sessionComplete = false;
    sessionResult = null;
    try { iframe.contentWindow.resetGame(); } catch {}
    try { iframe.contentWindow.setShotsRemaining(0); } catch {}
    renderAll();
  }

  function shareScore() {
    const dist = sessionResult.best_distance === 0 ? 'Hole in One' : `${sessionResult.best_distance} ft from pin`;
    const cond = gameConfig.conditions ? `${gameConfig.conditions.yardage} yds · ${gameConfig.conditions.windSpeed}mph wind` : '';
    const text = `4SF Daily Par 3 #${String(gameConfig.dailyNumber).padStart(3, '0')} — ${dist}${sessionResult.ace_count > 0 ? ` · ${sessionResult.ace_count} ace(s)` : ''}.${cond ? ` ${cond}.` : ''}\nPlay: ${GAME_URL}`;
    if (navigator.share) {
      navigator.share({ title: '4SF Par 3 Challenge', text, url: GAME_URL }).catch(() => {});
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(() => alert('Score copied to clipboard!'), () => alert(text));
    } else {
      alert(text);
    }
  }

  function renderLeaderboard() {
    const root = document.getElementById('leaderboard');
    let html = '<div class="lb-tab"><button id="tab-today" class="active">Today</button><button id="tab-hof">Hall of Fame</button></div>';
    html += '<div id="lb-body"></div>';
    if (!isMember) {
      html += '<button class="login-btn" id="claim-btn">Sign up to post your score</button>'
        + '<p class="hint">Your guest session is held until midnight. Sign up to claim it.</p>';
    }
    root.innerHTML = html;

    let tab = 'today';
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
        if (leaderboard.ownScore) {
          const o = leaderboard.ownScore;
          rows += `<div class="lb-row me"><div class="lb-rank">#${o.rank}</div><div class="lb-name">You${o.is_hole_in_one ? '<span class="lb-ace">ACE</span>' : ''}</div><div class="lb-dist">${o.is_hole_in_one ? 'HIO' : o.distance + ' ft'}</div></div>`;
        }
        b.innerHTML = rows;
      } else {
        let rows = '';
        if (hallOfFame.length === 0) {
          rows = '<p class="hint">No champions yet. Win a day to claim the Hall of Fame!</p>';
        }
        hallOfFame.forEach((p, i) => {
          rows += `<div class="lb-row"><div class="lb-rank">${i + 1}</div><div class="lb-name">${escapeHtml(p.player_name)}</div><div class="lb-dist">${p.win_count} win${p.win_count === 1 ? '' : 's'}</div></div>`;
        });
        b.innerHTML = rows;
      }
    }
    body();
    document.getElementById('tab-today').onclick = () => {
      tab = 'today';
      document.getElementById('tab-today').classList.add('active');
      document.getElementById('tab-hof').classList.remove('active');
      body();
    };
    document.getElementById('tab-hof').onclick = () => {
      tab = 'hof';
      document.getElementById('tab-hof').classList.add('active');
      document.getElementById('tab-today').classList.remove('active');
      body();
    };
    const claim = document.getElementById('claim-btn');
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
    if (isMember) {
      if (replayable) {
        html += '<button class="replay-btn" id="replay-btn">Play Again</button>';
        html += '<p class="replay-warn">Replaying replaces your session and resets your tiebreak time.</p>';
      }
    } else {
      html += '<button class="login-btn" id="claim-btn2" style="margin-top:8px">Claim your score</button>';
      html += '<p class="hint">Sign up to join today\'s leaderboard.</p>';
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
    const rp = document.getElementById('replay-btn'); if (rp) rp.onclick = startReplay;
    const c2 = document.getElementById('claim-btn2'); if (c2) c2.onclick = () => client.auth.redirectToLogin(window.location.href);
    // Pre-fill + wire the Tag Me inputs
    const igI = document.getElementById('tm-ig');
    const xI = document.getElementById('tm-x');
    const ttI = document.getElementById('tm-tt');
    if (igI) {
      const init = isMember ? (user || {}) : (loadHeld() || {});
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
          const held = loadHeld() || { anonymous_id: guestId, best_distance: sessionResult.best_distance, ace_count: sessionResult.ace_count, shot_history: [], first_achieved_at: sessionResult.first_achieved_at, daily_seed: getDailySeed(), player_name: guestDisplayName };
          saveHeld({ ...held, ...handles });
        }
        const saved = document.getElementById('tm-saved'); if (saved) saved.style.display = 'block';
        if (isMember) renderLeaderboard();
      } catch { /* silent */ }
      tmSave.disabled = false; tmSave.textContent = 'Save & tag me';
    };
  }

  function renderAll() { renderLeaderboard(); renderResultOverlay(); }

  renderAll();
}

main().catch(err => { console.error('minigame init failed', err); });
