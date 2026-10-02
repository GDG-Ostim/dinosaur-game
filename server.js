import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const EMAIL_DOMAIN = (process.env.EMAIL_DOMAIN || 'atostimteknik.edu.tr').toLowerCase();

// Oyunda mesafe skoru en fazla ~11.5/sn, coinler (10 puan) en fazla ~1/sn; biraz pay bırakıyoruz.
const MAX_SCORE_PER_SEC = 25;
const RUN_TTL_MS = 60 * 60 * 1000;

fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(path.join(DATA_DIR, 'dino.db'));
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS players (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    email      TEXT NOT NULL UNIQUE,
    name       TEXT NOT NULL,
    best       INTEGER NOT NULL DEFAULT 0,
    games      INTEGER NOT NULL DEFAULT 0,
    best_at    INTEGER,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS players_best ON players (best DESC, best_at ASC);
`);

// Token imzası için gizli anahtar: env yoksa DB'de saklanan kalıcı bir anahtar üret.
function getSecret() {
  if (process.env.SECRET) return process.env.SECRET;
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get('secret');
  if (row) return row.value;
  const secret = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)').run('secret', secret);
  return secret;
}
const SECRET = getSecret();

const sign = (v) => crypto.createHmac('sha256', SECRET).update(String(v)).digest('base64url');
const makeToken = (id) => `${id}.${sign(id)}`;
function verifyToken(token) {
  if (typeof token !== 'string') return null;
  const [id, sig] = token.split('.');
  if (!id || !sig) return null;
  const expected = sign(id);
  if (sig.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  return Number(id);
}

const q = {
  byEmail: db.prepare('SELECT * FROM players WHERE email = ?'),
  byId: db.prepare('SELECT * FROM players WHERE id = ?'),
  insert: db.prepare('INSERT INTO players (email, name, created_at) VALUES (?, ?, ?)'),
  rename: db.prepare('UPDATE players SET name = ? WHERE id = ?'),
  played: db.prepare('UPDATE players SET games = games + 1 WHERE id = ?'),
  setBest: db.prepare('UPDATE players SET best = ?, best_at = ? WHERE id = ? AND best < ?'),
  top: db.prepare('SELECT id, name, best FROM players WHERE best > 0 ORDER BY best DESC, best_at ASC LIMIT ?'),
  rank: db.prepare('SELECT COUNT(*) + 1 AS rank FROM players WHERE best > ? OR (best = ? AND best_at < ?)'),
  count: db.prepare('SELECT COUNT(*) AS n FROM players WHERE best > 0'),
};

const publicPlayer = (p) => ({ id: p.id, name: p.name, best: p.best, games: p.games });
function rankOf(p) {
  if (!p.best) return null;
  return q.rank.get(p.best, p.best, p.best_at ?? Date.now()).rank;
}

// Aktif oyun oturumları (bellekte; kısa ömürlü proje için yeterli).
const runs = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [id, r] of runs) if (now - r.startedAt > RUN_TTL_MS) runs.delete(id);
}, 5 * 60 * 1000).unref();

const app = Fastify({ logger: { level: 'info' }, trustProxy: true });

function auth(req, reply) {
  const header = req.headers.authorization || '';
  const id = verifyToken(header.replace(/^Bearer\s+/i, ''));
  const player = id ? q.byId.get(id) : null;
  if (!player) {
    reply.code(401).send({ error: 'Oturum geçersiz, lütfen tekrar giriş yap.' });
    return null;
  }
  return player;
}

app.post('/api/login', async (req, reply) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const name = String(req.body?.name || '').trim().replace(/\s+/g, ' ');
  const emailRe = new RegExp(`^[a-z0-9._%+-]+@${EMAIL_DOMAIN.replace(/\./g, '\\.')}$`);
  if (!emailRe.test(email)) {
    return reply.code(400).send({ error: `Sadece @${EMAIL_DOMAIN} adresleriyle giriş yapılabilir.` });
  }
  if (name.length < 2 || name.length > 20) {
    return reply.code(400).send({ error: 'İsim 2-20 karakter olmalı.' });
  }
  let player = q.byEmail.get(email);
  if (!player) {
    const { lastInsertRowid } = q.insert.run(email, name, Date.now());
    player = q.byId.get(Number(lastInsertRowid));
  } else if (player.name !== name) {
    q.rename.run(name, player.id);
    player.name = name;
  }
  return { token: makeToken(player.id), player: publicPlayer(player), rank: rankOf(player) };
});

app.get('/api/me', async (req, reply) => {
  const player = auth(req, reply);
  if (!player) return;
  return { player: publicPlayer(player), rank: rankOf(player) };
});

app.post('/api/run/start', async (req, reply) => {
  const player = auth(req, reply);
  if (!player) return;
  // Oyuncu başına tek aktif oturum.
  for (const [id, r] of runs) if (r.playerId === player.id) runs.delete(id);
  const runId = crypto.randomUUID();
  runs.set(runId, { playerId: player.id, startedAt: Date.now() });
  q.played.run(player.id);
  return { runId };
});

app.post('/api/run/finish', async (req, reply) => {
  const player = auth(req, reply);
  if (!player) return;
  const runId = String(req.body?.runId || '');
  const score = Math.floor(Number(req.body?.score));
  const run = runs.get(runId);
  if (!run || run.playerId !== player.id) {
    return reply.code(400).send({ error: 'Oyun oturumu bulunamadı.' });
  }
  runs.delete(runId);
  const elapsed = (Date.now() - run.startedAt) / 1000;
  if (!Number.isFinite(score) || score < 0 || score > elapsed * MAX_SCORE_PER_SEC + 30) {
    req.log.warn({ player: player.id, score, elapsed }, 'şüpheli skor reddedildi');
    return reply.code(400).send({ error: 'Skor doğrulanamadı.' });
  }
  const previousBest = player.best;
  const now = Date.now();
  q.setBest.run(score, now, player.id, score);
  const updated = q.byId.get(player.id);
  return {
    score,
    best: updated.best,
    newBest: score > previousBest,
    rank: rankOf(updated),
  };
});

app.get('/api/leaderboard', async (req) => {
  const limit = Math.min(Number(req.query?.limit) || 50, 100);
  const rows = q.top.all(limit).map((r, i) => ({ rank: i + 1, id: r.id, name: r.name, best: r.best }));
  const header = req.headers.authorization || '';
  const id = verifyToken(header.replace(/^Bearer\s+/i, ''));
  const me = id ? q.byId.get(id) : null;
  return {
    top: rows,
    total: q.count.get().n,
    me: me ? { id: me.id, name: me.name, best: me.best, rank: rankOf(me) } : null,
  };
});

app.get('/healthz', async () => ({ ok: true }));

await app.register(fastifyStatic, {
  root: path.join(__dirname, 'public'),
  setHeaders(res, filePath) {
    if (/\.(png|webp|jpg|svg|mp3|ogg)$/.test(filePath)) {
      res.setHeader('Cache-Control', 'public, max-age=86400');
    } else {
      res.setHeader('Cache-Control', 'no-cache');
    }
  },
});

app.listen({ port: PORT, host: '0.0.0.0' });
