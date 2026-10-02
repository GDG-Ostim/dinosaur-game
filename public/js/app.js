import { Game, loadAssets } from './game.js';
import { sfx } from './sfx.js';

const $ = (id) => document.getElementById(id);
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* yoksay */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* yoksay */ } },
};

const state = {
  token: store.get('dino_token'),
  player: null,
  rank: null,
  runId: null,
  game: null,
  boardTimer: 0,
};

async function api(path, body) {
  const res = await fetch(path, {
    method: body ? 'POST' : 'GET',
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) { logout(); throw new Error(data.error || 'Oturum geçersiz.'); }
  if (!res.ok) throw new Error(data.error || 'Bir şeyler ters gitti.');
  return data;
}

// ---------- ekran yönetimi ----------
function show(id) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === id));
  if (id !== 'screen-game' && state.game) state.game.stop();
  clearInterval(state.boardTimer);
}

function fmt(n) { return Number(n || 0).toLocaleString('tr-TR'); }

function renderMenu() {
  $('menu-name').textContent = state.player?.name || '—';
  $('menu-best').textContent = fmt(state.player?.best);
  $('menu-rank').textContent = state.rank ? `#${state.rank}` : '—';
}

function logout() {
  state.token = null;
  state.player = null;
  store.del('dino_token');
  show('screen-login');
}

// ---------- giriş ----------
$('login-email').value = store.get('dino_email') || '';
$('login-name').value = store.get('dino_name') || '';
$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('login-error');
  err.hidden = true;
  const name = $('login-name').value.trim();
  const email = $('login-email').value.trim().toLowerCase();
  if (!/@atostimteknik\.edu\.tr$/.test(email)) {
    err.textContent = 'Sadece @atostimteknik.edu.tr uzantılı okul mailinle giriş yapabilirsin.';
    err.hidden = false;
    return;
  }
  const btn = e.submitter;
  btn.disabled = true;
  try {
    const data = await api('/api/login', { name, email });
    state.token = data.token;
    state.player = data.player;
    state.rank = data.rank;
    store.set('dino_token', data.token);
    store.set('dino_email', email);
    store.set('dino_name', name);
    renderMenu();
    show('screen-menu');
  } catch (ex) {
    err.textContent = ex.message;
    err.hidden = false;
  } finally {
    btn.disabled = false;
  }
});

$('btn-logout').addEventListener('click', logout);

// ---------- oyun ----------
let assets = null;
const assetsReady = loadAssets().then((a) => { assets = a; });

async function startGame() {
  sfx.unlock();
  $('modal-over').hidden = true;
  show('screen-game');
  await assetsReady;
  if (!state.game) {
    state.game = new Game($('game'), assets, {
      onScore(score, milestone) {
        $('hud-score').textContent = fmt(score);
        if (milestone) {
          const chip = $('hud-score').parentElement;
          chip.classList.add('flash');
          setTimeout(() => chip.classList.remove('flash'), 250);
        }
      },
      onStart() { $('tap-hint').classList.add('hidden'); },
      onGameOver: finishGame,
    });
  }
  state.game.resize();
  state.game.reset();
  $('hud-best').textContent = fmt(state.player?.best);
  $('tap-hint').classList.remove('hidden');
  state.game.start();
  state.runId = null;
  try {
    state.runId = (await api('/api/run/start', {})).runId;
  } catch { /* skor gönderiminde hata gösterilir */ }
}

async function finishGame(score) {
  state.game.stop();
  $('over-score').textContent = fmt(score);
  $('over-best').textContent = fmt(Math.max(score, state.player?.best || 0));
  $('over-rank').textContent = state.rank ? `#${state.rank}` : '—';
  $('over-newbest').hidden = true;
  $('over-error').hidden = true;
  $('modal-over').hidden = false;
  $('btn-again').focus();
  try {
    if (!state.runId) throw new Error('Sunucuya bağlanılamadı, skor kaydedilemedi.');
    const res = await api('/api/run/finish', { runId: state.runId, score });
    state.runId = null;
    state.player.best = res.best;
    state.rank = res.rank;
    $('over-best').textContent = fmt(res.best);
    $('over-rank').textContent = res.rank ? `#${res.rank}` : '—';
    $('over-newbest').hidden = !res.newBest;
    renderMenu();
  } catch (ex) {
    $('over-error').textContent = ex.message;
    $('over-error').hidden = false;
  }
}

$('btn-play').addEventListener('click', startGame);
$('btn-again').addEventListener('click', startGame);
$('btn-board-play').addEventListener('click', startGame);
$('btn-quit').addEventListener('click', () => { state.game?.stop(); show('screen-menu'); });
$('btn-over-menu').addEventListener('click', () => { $('modal-over').hidden = true; show('screen-menu'); });
$('btn-mute').textContent = sfx.muted ? '🔇' : '🔊';
$('btn-mute').addEventListener('click', (e) => {
  e.currentTarget.textContent = sfx.toggle() ? '🔇' : '🔊';
  e.currentTarget.blur();
});
// Oyun bitti ekranında boşluk/enter ile tekrar.
window.addEventListener('keydown', (e) => {
  if (!$('modal-over').hidden && (e.code === 'Enter' || e.code === 'Space')) {
    e.preventDefault();
    startGame();
  }
});

// ---------- liderlik ----------
function rowHtml(r, meId) {
  const cls = r.rank <= 3 ? ` r${r.rank}` : '';
  const me = r.id === meId ? ' me' : '';
  const name = r.id === meId ? `${escapeHtml(r.name)} (Sen)` : escapeHtml(r.name);
  return `<li class="row${me}" style="animation-delay:${Math.min(r.rank, 15) * 30}ms">
    <span class="rank${cls}">${r.rank}</span>
    <span class="name">${name}</span>
    <span class="score"><img src="assets/coin.png" alt="">${fmt(r.best)}</span>
  </li>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function loadBoard() {
  try {
    const data = await api('/api/leaderboard');
    const meId = data.me?.id;
    $('board-total').textContent = data.total ? `· ${data.total} oyuncu` : '';
    $('board-list').innerHTML = data.top.length
      ? data.top.map((r) => rowHtml(r, meId)).join('')
      : '<li class="board-empty">Henüz skor yok. İlk sen ol! 🦖</li>';
    const meInTop = data.top.some((r) => r.id === meId);
    $('board-me').innerHTML = data.me?.rank && !meInTop
      ? `<ol class="board-list" style="min-height:0;padding:6px">${rowHtml({ ...data.me }, meId)}</ol>`
      : '';
  } catch (ex) {
    $('board-list').innerHTML = `<li class="board-empty">${escapeHtml(ex.message)}</li>`;
  }
}

function openBoard() {
  $('modal-over').hidden = true;
  show('screen-board');
  loadBoard();
  state.boardTimer = setInterval(loadBoard, 10000);
}
$('btn-board').addEventListener('click', openBoard);
$('btn-over-board').addEventListener('click', openBoard);
$('btn-board-close').addEventListener('click', () => show(state.token ? 'screen-menu' : 'screen-login'));

// ---------- açılış ----------
(async function init() {
  if (!state.token) return show('screen-login');
  try {
    const data = await api('/api/me');
    state.player = data.player;
    state.rank = data.rank;
    renderMenu();
    show('screen-menu');
  } catch {
    show('screen-login');
  }
})();
