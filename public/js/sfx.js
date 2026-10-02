// Dosyasız, WebAudio ile küçük ses efektleri.
let ctx = null;
let muted = localStorageGet('dino_muted') === '1';

function localStorageGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function localStorageSet(k, v) { try { localStorage.setItem(k, v); } catch { /* yoksay */ } }

function audio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function tone(freq, to, dur, type = 'square', vol = 0.08, delay = 0) {
  if (muted) return;
  const a = audio();
  if (!a) return;
  const t = a.currentTime + delay;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  o.frequency.exponentialRampToValueAtTime(to, t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(a.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}

export const sfx = {
  get muted() { return muted; },
  toggle() { muted = !muted; localStorageSet('dino_muted', muted ? '1' : '0'); return muted; },
  unlock() { audio(); },
  jump() { tone(380, 760, 0.12, 'square', 0.05); },
  coin() { tone(988, 988, 0.07, 'square', 0.05); tone(1319, 1319, 0.18, 'square', 0.05, 0.07); },
  milestone() { tone(660, 660, 0.08, 'triangle', 0.09); tone(880, 880, 0.08, 'triangle', 0.09, 0.09); tone(1175, 1175, 0.2, 'triangle', 0.09, 0.18); },
  hit() { tone(300, 60, 0.35, 'sawtooth', 0.09); },
};
