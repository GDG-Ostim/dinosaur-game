// Chrome dino tarzı sonsuz koşu motoru. Tüm birimler mantıksal piksel / saniye.
import { sfx } from './sfx.js';

const ASSETS = ['dino_run1', 'dino_run2', 'dino_jump', 'dino_duck', 'dino_dead',
  'cactus1', 'cactus2', 'cactus3', 'ptero', 'coin', 'rock'];

export function loadAssets() {
  const imgs = {};
  const load = (name, file) => new Promise((resolve) => {
    const img = new Image();
    img.onload = () => { imgs[name] = img; resolve(); };
    img.onerror = resolve;
    img.src = `assets/${file}`;
  });
  return Promise.all([
    ...ASSETS.map((n) => load(n, `${n}.png`)),
    load('bg', 'bg.jpg'),
  ]).then(() => imgs);
}

const PLAY_H = 400;          // görünür oyun alanı yüksekliği
const MIN_W = 560;         // dar ekranlarda en az bu kadar genişlik
const GRAVITY = 2600;
const JUMP_V = 940;
const JUMP_CUT = 420;        // erken bırakınca kısa zıplama
const SPEED_START = 540;
const SPEED_MAX = 1150;
const SPEED_ACCEL = 9;       // her saniye
const SCORE_RATE = 0.01;     // birim mesafe başına skor
const COIN_VALUE = 10;
const DINO_H = 104;          // koşma pozunun çizim yüksekliği

// Engel tipleri: çizim yüksekliği ve hitbox içe payları (oran).
const OBSTACLES = {
  cactus1: { h: 66, inset: [0.18, 0.12, 0.18, 0.02] },
  cactus2: { h: 92, inset: [0.2, 0.08, 0.2, 0.02] },
  cactus3: { h: 78, inset: [0.12, 0.14, 0.12, 0.02] },
  rock:    { h: 44, inset: [0.12, 0.2, 0.12, 0.02] },
  ptero:   { h: 58, inset: [0.15, 0.25, 0.2, 0.25] },
};

export class Game {
  constructor(canvas, imgs, { onScore, onGameOver, onStart } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.imgs = imgs;
    this.onScore = onScore || (() => {});
    this.onGameOver = onGameOver || (() => {});
    this.onStart = onStart || (() => {});
    this.running = false;
    this.raf = 0;
    this.resize = this.resize.bind(this);
    this.loop = this.loop.bind(this);
    this.bindInput();
    window.addEventListener('resize', this.resize);
    this.reset();
    this.resize();
  }

  // ---------- kurulum ----------
  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    // Ölçek: oyun alanı yüksekliği sığsın, ama genişlik MIN_W'den küçük olmasın.
    this.scale = Math.min(this.canvas.height / PLAY_H, this.canvas.width / MIN_W);
    this.viewW = this.canvas.width / this.scale;
    this.viewH = this.canvas.height / this.scale;
    const extra = this.viewH - PLAY_H;
    this.groundY = this.viewH - Math.max(70, extra * 0.45 + 70);
    if (!this.running) this.draw();
  }

  reset() {
    this.state = 'ready';
    this.t = 0;
    this.speed = SPEED_START;
    this.distance = 0;
    this.bonus = 0;
    this.score = 0;
    this.lastMilestone = 0;
    this.obstacles = [];
    this.coins = [];
    this.particles = [];
    this.nextSpawn = 700;
    this.nextCoin = 1400;
    this.bgX = 0;
    this.groundX = 0;
    this.shake = 0;
    this.dino = { x: 90, y: 0, vy: 0, onGround: true, ducking: false, holding: false, runT: 0, squash: 0 };
    this.onScore(0);
    if (this.scale) this.draw();
  }

  start() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.running = true;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.loop);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  // ---------- giriş ----------
  bindInput() {
    const down = (e) => {
      if (!this.running) return;
      if (['Space', 'ArrowUp', 'KeyW'].includes(e.code)) { e.preventDefault(); if (!e.repeat) this.press(); }
      if (['ArrowDown', 'KeyS'].includes(e.code)) { e.preventDefault(); this.duck(true); }
    };
    const up = (e) => {
      if (['Space', 'ArrowUp', 'KeyW'].includes(e.code)) this.release();
      if (['ArrowDown', 'KeyS'].includes(e.code)) this.duck(false);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);

    let startY = null;
    this.canvas.addEventListener('pointerdown', (e) => {
      if (!this.running) return;
      e.preventDefault();
      startY = e.clientY;
      this.press();
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (startY !== null && e.clientY - startY > 40) this.duck(true);
    });
    const end = () => { startY = null; this.release(); this.duck(false); };
    this.canvas.addEventListener('pointerup', end);
    this.canvas.addEventListener('pointercancel', end);
  }

  press() {
    if (this.state === 'ready') {
      this.state = 'play';
      this.onStart();
    }
    if (this.state !== 'play') return;
    const d = this.dino;
    d.holding = true;
    if (d.onGround) {
      d.vy = -JUMP_V;
      d.onGround = false;
      d.ducking = false;
      d.squash = -0.18;
      sfx.jump();
      this.dust(6);
    }
  }

  release() {
    const d = this.dino;
    d.holding = false;
    if (!d.onGround && d.vy < -JUMP_CUT) d.vy = -JUMP_CUT;
  }

  duck(on) {
    if (this.state !== 'play') return;
    const d = this.dino;
    d.ducking = on;
    if (on && !d.onGround) d.vy = Math.max(d.vy, 900); // havadayken hızlı in
  }

  // ---------- döngü ----------
  loop(now) {
    if (!this.running) return;
    const dt = Math.min((now - this.last) / 1000, 1 / 30);
    this.last = now;
    this.update(dt);
    this.draw();
    this.raf = requestAnimationFrame(this.loop);
  }

  update(dt) {
    const d = this.dino;
    this.t += dt;
    if (this.shake > 0) this.shake = Math.max(0, this.shake - dt);
    this.particles = this.particles.filter((p) => {
      p.life -= dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 900 * dt * (p.g ?? 1);
      return p.life > 0;
    });

    if (this.state === 'ready') {
      d.runT += dt * 0.6;
      return;
    }
    if (this.state === 'over') {
      // Ölünce dinozor küçük bir sıçrayışla yere düşer.
      if (!d.onGround) {
        d.vy += GRAVITY * dt; d.y += d.vy * dt;
        if (d.y >= 0) { d.y = 0; d.vy = 0; d.onGround = true; }
      }
      return;
    }

    this.speed = Math.min(SPEED_MAX, this.speed + SPEED_ACCEL * dt);
    const dx = this.speed * dt;
    this.distance += dx;
    this.bgX += dx * 0.12;
    this.groundX += dx;

    // Fizik
    if (!d.onGround) {
      d.vy += GRAVITY * (d.ducking ? 1.8 : 1) * dt;
      d.y += d.vy * dt;
      if (d.y >= 0) {
        d.y = 0; d.vy = 0; d.onGround = true; d.squash = 0.22;
        this.dust(8);
      }
    }
    d.squash *= Math.pow(0.0005, dt);
    d.runT += dt * (this.speed / 60);
    if (d.onGround && Math.random() < dt * 14) this.dust(1, true);

    // Engeller
    this.nextSpawn -= dx;
    if (this.nextSpawn <= 0) this.spawnObstacle();
    for (const o of this.obstacles) {
      o.x -= dx + (o.vx || 0) * dt;
      o.flap = (o.flap || 0) + dt * 10;
    }
    this.obstacles = this.obstacles.filter((o) => o.x + o.w > -50);

    // Coinler
    this.nextCoin -= dx;
    if (this.nextCoin <= 0) this.spawnCoin();
    for (const c of this.coins) { c.x -= dx; c.spin += dt * 6; }
    const dh = this.dinoHitbox();
    this.coins = this.coins.filter((c) => {
      if (c.x + c.r < -20) return false;
      if (Math.abs(c.x - (dh.x + dh.w / 2)) < c.r + dh.w / 2 && Math.abs(c.y - (dh.y + dh.h / 2)) < c.r + dh.h / 2) {
        this.bonus += COIN_VALUE;
        sfx.coin();
        this.sparkle(c.x, c.y);
        return false;
      }
      return true;
    });

    // Skor
    this.score = Math.floor(this.distance * SCORE_RATE) + this.bonus;
    const milestone = Math.floor(this.score / 100);
    if (milestone > this.lastMilestone) {
      this.lastMilestone = milestone;
      sfx.milestone();
      this.onScore(this.score, true);
    } else {
      this.onScore(this.score, false);
    }

    // Çarpışma
    for (const o of this.obstacles) {
      if (overlap(dh, this.obstacleHitbox(o))) { this.die(); break; }
    }
  }

  spawnObstacle() {
    const g = this.groundY;
    const allowPtero = this.score > 220;
    const r = Math.random();
    let list;
    if (allowPtero && r < 0.22) {
      const high = Math.random() < 0.45;
      // Alçak pterodaktil zıplanarak, yüksek olan altından koşarak geçilir.
      const bottom = high ? g - 118 : g - 26;
      list = [{ type: 'ptero', bottom, vx: 60 }];
    } else if (r < 0.32) {
      list = [{ type: 'rock' }];
    } else {
      const pick = ['cactus1', 'cactus1', 'cactus2', 'cactus3'][Math.floor(Math.random() * 4)];
      list = [{ type: pick }];
      // Hız arttıkça yan yana ikili kaktüs.
      if (this.speed > 720 && Math.random() < 0.3) list.push({ type: 'cactus1', gap: 4 });
    }
    let x = this.viewW + 40;
    for (const item of list) {
      const def = OBSTACLES[item.type];
      const img = this.imgs[item.type];
      const h = def.h;
      const w = img ? (img.width / img.height) * h : h * 0.7;
      x += item.gap || 0;
      this.obstacles.push({ ...item, x, w, h, bottom: item.bottom ?? g });
      x += w;
    }
    // Zıplanabilir minimum boşluk hıza göre ölçeklenir.
    const minGap = this.speed * 0.62 + 160;
    this.nextSpawn = minGap + Math.random() * minGap * 0.9;
  }

  spawnCoin() {
    const heights = [40, 110, 160];
    const y = this.groundY - heights[Math.floor(Math.random() * heights.length)];
    // Engellerin üstüne denk gelmesin.
    const x = this.viewW + 60;
    if (!this.obstacles.some((o) => Math.abs(o.x - x) < 120)) {
      this.coins.push({ x, y, r: 16, spin: 0 });
    }
    this.nextCoin = 900 + Math.random() * 1400;
  }

  die() {
    this.state = 'over';
    this.shake = 0.35;
    const d = this.dino;
    d.vy = -380; d.onGround = false; d.ducking = false;
    sfx.hit();
    for (let i = 0; i < 14; i++) this.sparkle(d.x + 40, this.groundY + d.y - 50, '#fff');
    setTimeout(() => this.onGameOver(this.score), 750);
  }

  // ---------- hitbox ----------
  dinoSize() {
    const d = this.dino;
    const key = this.state === 'over' ? 'dino_dead' : d.ducking && d.onGround ? 'dino_duck' : !d.onGround ? 'dino_jump' : 'dino_run1';
    const img = this.imgs[key];
    const ref = this.imgs.dino_run1;
    const k = ref ? DINO_H / ref.height : 1;
    return { key, img, w: img ? img.width * k : 80, h: img ? img.height * k : DINO_H };
  }

  dinoHitbox() {
    const d = this.dino;
    const { w, h } = this.dinoSize();
    const bottom = this.groundY + d.y;
    if (d.ducking && d.onGround) return { x: d.x + w * 0.1, y: bottom - h * 0.8, w: w * 0.78, h: h * 0.75 };
    return { x: d.x + w * 0.22, y: bottom - h * 0.88, w: w * 0.55, h: h * 0.82 };
  }

  obstacleHitbox(o) {
    const [l, t, r, b] = OBSTACLES[o.type].inset;
    const y = o.bottom - o.h;
    return { x: o.x + o.w * l, y: y + o.h * t, w: o.w * (1 - l - r), h: o.h * (1 - t - b) };
  }

  // ---------- efektler ----------
  dust(n, small = false) {
    const d = this.dino;
    for (let i = 0; i < n; i++) {
      this.particles.push({
        x: d.x + 20 + Math.random() * 30, y: this.groundY - 2,
        vx: -this.speed * 0.3 - Math.random() * 80, vy: -Math.random() * (small ? 60 : 160),
        life: 0.4 + Math.random() * 0.3, r: small ? 3 + Math.random() * 3 : 4 + Math.random() * 5,
        color: 'rgba(222, 190, 140, 0.9)', g: 0.4,
      });
    }
  }

  sparkle(x, y, color = '#ffd23f') {
    for (let i = 0; i < 10; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 120 + Math.random() * 180;
      this.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.5, r: 3 + Math.random() * 3, color, g: 0.3 });
    }
  }

  // ---------- çizim ----------
  draw() {
    const { ctx } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    let sx = 0, sy = 0;
    if (this.shake > 0) { sx = (Math.random() - 0.5) * 14 * this.shake * 3; sy = (Math.random() - 0.5) * 14 * this.shake * 3; }
    ctx.setTransform(this.scale, 0, 0, this.scale, sx * this.scale, sy * this.scale);
    this.drawBackground();
    this.drawGround();
    for (const c of this.coins) this.drawCoin(c);
    for (const o of this.obstacles) this.drawObstacle(o);
    this.drawDino();
    for (const p of this.particles) {
      ctx.globalAlpha = Math.min(1, p.life * 2.5);
      ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  drawBackground() {
    const { ctx } = this;
    const bg = this.imgs.bg;
    const h = this.groundY + 30;
    if (!bg) {
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#8fd3ff'); g.addColorStop(1, '#d8f5c0');
      ctx.fillStyle = g; ctx.fillRect(0, 0, this.viewW, h);
      return;
    }
    const w = (bg.width / bg.height) * h;
    // Ayna-döşeme ile kenar dikişleri gizlenir.
    let i = Math.floor(this.bgX / w);
    let x = -(this.bgX - i * w);
    while (x < this.viewW) {
      if (i % 2 === 0) {
        ctx.drawImage(bg, x, 0, w + 1, h);
      } else {
        ctx.save(); ctx.translate(x + w, 0); ctx.scale(-1, 1);
        ctx.drawImage(bg, 0, 0, w + 1, h); ctx.restore();
      }
      x += w; i++;
    }
  }

  drawGround() {
    const { ctx } = this;
    const g = this.groundY;
    const bottom = this.viewH + 20;
    // toprak
    const soil = ctx.createLinearGradient(0, g, 0, bottom);
    soil.addColorStop(0, '#c98a4b'); soil.addColorStop(1, '#8a5229');
    ctx.fillStyle = soil;
    ctx.fillRect(0, g + 8, this.viewW, bottom - g);
    // taş benekleri
    const tile = 160;
    const off = this.groundX % tile;
    ctx.fillStyle = 'rgba(110, 60, 25, .35)';
    for (let x = -off; x < this.viewW + tile; x += tile) {
      ctx.beginPath(); ctx.ellipse(x + 30, g + 40, 10, 5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(x + 100, g + 66, 7, 4, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(x + 130, g + 30, 5, 3, 0, 0, Math.PI * 2); ctx.fill();
    }
    // çim şeridi (tümsekli)
    const bump = 40;
    const bo = this.groundX % bump;
    ctx.fillStyle = '#4caf2a';
    ctx.beginPath();
    ctx.moveTo(0, g + 16);
    for (let x = -bo; x < this.viewW + bump; x += bump) ctx.quadraticCurveTo(x + bump / 2, g + 26, x + bump, g + 16);
    ctx.lineTo(this.viewW, g - 4); ctx.lineTo(0, g - 4); ctx.closePath(); ctx.fill();
    const grass = ctx.createLinearGradient(0, g - 6, 0, g + 12);
    grass.addColorStop(0, '#9be35a'); grass.addColorStop(1, '#5cbf2f');
    ctx.fillStyle = grass;
    ctx.fillRect(0, g - 6, this.viewW, 16);
    ctx.fillStyle = 'rgba(255,255,255,.35)';
    ctx.fillRect(0, g - 6, this.viewW, 3);
  }

  drawCoin(c) {
    const { ctx } = this;
    const img = this.imgs.coin;
    const sxs = Math.abs(Math.cos(c.spin)) * 0.8 + 0.2;
    const s = c.r * 2.2;
    ctx.save(); ctx.translate(c.x, c.y + Math.sin(c.spin * 0.7) * 4); ctx.scale(sxs, 1);
    if (img) ctx.drawImage(img, -s / 2, -s / 2, s, s);
    else { ctx.fillStyle = '#ffc800'; ctx.beginPath(); ctx.arc(0, 0, c.r, 0, Math.PI * 2); ctx.fill(); }
    ctx.restore();
  }

  drawObstacle(o) {
    const { ctx } = this;
    const img = this.imgs[o.type];
    const y = o.bottom - o.h;
    if (o.type === 'ptero') {
      const flap = 1 + Math.sin(o.flap) * 0.12;
      ctx.save(); ctx.translate(o.x + o.w / 2, y + o.h / 2); ctx.scale(1, flap);
      if (img) ctx.drawImage(img, -o.w / 2, -o.h / 2, o.w, o.h);
      else { ctx.fillStyle = '#a066d8'; ctx.fillRect(-o.w / 2, -o.h / 2, o.w, o.h); }
      ctx.restore();
      // gölge
      ctx.fillStyle = 'rgba(0,0,0,.15)';
      ctx.beginPath(); ctx.ellipse(o.x + o.w / 2, this.groundY + 4, o.w * 0.3, 5, 0, 0, Math.PI * 2); ctx.fill();
      return;
    }
    ctx.fillStyle = 'rgba(0,0,0,.18)';
    ctx.beginPath(); ctx.ellipse(o.x + o.w / 2, o.bottom + 2, o.w * 0.45, 6, 0, 0, Math.PI * 2); ctx.fill();
    if (img) ctx.drawImage(img, o.x, y, o.w, o.h);
    else { ctx.fillStyle = '#3c9a2b'; ctx.fillRect(o.x, y, o.w, o.h); }
  }

  drawDino() {
    const { ctx } = this;
    const d = this.dino;
    let { key, img, w, h } = this.dinoSize();
    if (key === 'dino_run1' && Math.floor(d.runT) % 2 === 1 && this.imgs.dino_run2) img = this.imgs.dino_run2;
    const bottom = this.groundY + d.y;
    // gölge (yükseldikçe küçülür)
    const lift = Math.min(1, -d.y / 160);
    ctx.fillStyle = `rgba(0,0,0,${0.22 - lift * 0.12})`;
    ctx.beginPath(); ctx.ellipse(d.x + w * 0.45, this.groundY + 3, w * 0.38 * (1 - lift * 0.4), 6, 0, 0, Math.PI * 2); ctx.fill();

    const bob = this.state === 'ready' ? Math.sin(d.runT * 4) * 3 : 0;
    const sq = d.squash;
    ctx.save();
    ctx.translate(d.x + w / 2, bottom + bob);
    ctx.scale(1 + sq * 0.6, 1 - sq);
    if (this.state === 'over') ctx.rotate(-0.08);
    // Arka plandan ayrışsın diye hafif beyaz parıltı.
    ctx.shadowColor = 'rgba(255, 255, 255, 0.85)';
    ctx.shadowBlur = 10 * this.scale;
    if (img) ctx.drawImage(img, -w / 2, -h, w, h);
    else { ctx.fillStyle = '#7cc243'; ctx.fillRect(-w / 2, -h, w, h); }
    ctx.restore();
  }
}

function overlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}
