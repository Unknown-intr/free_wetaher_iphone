// Живой фон в реалистичном стиле: сцена как снимок камеры с малой глубиной резкости.
// Три слоя:
//   bg    — небо, солнце, облака, холмы, дерево и ближние «расфокусированные» частицы.
//           Рисуется в половинном разрешении и размывается через CSS — грубые детали исчезают.
//   fx    — средний план: дождь, снег, листья, луна и звёзды, брызги. Почти резкий.
//   glass — капли на стекле и вспышка молнии. Резкие, поверх всего.

import { PLACEHOLDER_MOOD } from './logic.js';

const rnd = (a, b) => a + Math.random() * (b - a);
const mix = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
const scale = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
const css = (c, alpha = 1) => `rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},${alpha})`;
/** Детерминированный генератор: пейзаж и дерево одинаковые при каждом запуске. */
function seeded(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

const BG_SCALE = 0.5;
const TAU = Math.PI * 2;

const overcastOf = (m) => Math.min(0.85, m.cloudiness * 0.55 + (m.precipitation !== 'none' ? 0.2 : 0) + (m.isThunderstorm ? 0.15 : 0));

export function skyColors(m) {
  let top, bottom;
  switch (m.timeOfDay) {
    case 'morning': top = [0.36, 0.55, 0.82]; bottom = [0.98, 0.80, 0.62]; break;
    case 'day': top = [0.20, 0.45, 0.80]; bottom = [0.70, 0.84, 0.96]; break;
    case 'evening': top = [0.19, 0.21, 0.44]; bottom = [0.99, 0.60, 0.38]; break;
    default: top = [0.01, 0.03, 0.09]; bottom = [0.07, 0.11, 0.22];
  }
  const gray = m.timeOfDay === 'night' ? [0.08, 0.09, 0.12] : [0.56, 0.59, 0.63];
  const o = overcastOf(m);
  top = mix(top, scale(gray, 0.82), o);
  bottom = mix(bottom, gray, o);
  if (m.season === 'winter') top = mix(top, [0.55, 0.65, 0.85], 0.08);
  return [top, bottom];
}

function groundColor(m) {
  if (m.snowOnGround) return [0.90, 0.93, 0.97];
  return { spring: [0.40, 0.60, 0.28], summer: [0.26, 0.46, 0.19], autumn: [0.55, 0.45, 0.22], winter: [0.42, 0.40, 0.33] }[m.season];
}

const LEAF_COLORS = [[0.86, 0.50, 0.14], [0.74, 0.26, 0.10], [0.90, 0.70, 0.22], [0.55, 0.36, 0.16]];

/** Фаза Луны 0…1 (0 — новолуние, 0.5 — полнолуние). */
export function moonPhase(date = new Date()) {
  const days = (date.getTime() - Date.UTC(2000, 0, 6, 18, 14)) / 86400000;
  const p = (days / 29.530588853) % 1;
  return p < 0 ? p + 1 : p;
}

export class Scene {
  constructor(root) {
    this.c = {};
    this.x = {};
    for (const name of ['bg', 'fx', 'glass']) {
      const canvas = document.createElement('canvas');
      canvas.className = `sky-${name}`;
      root.appendChild(canvas);
      this.c[name] = canvas;
      this.x[name] = canvas.getContext('2d');
    }
    this.mood = PLACEHOLDER_MOOD;
    this.reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.w = 0; this.h = 0;
    this.t = 0; this.last = null; this.wind = 0;
    this.precip = []; this.splashes = []; this.ambient = []; this.ambientKind = null; this.glass = []; this.clouds = []; this.stars = [];
    this.flash = 0; this.bolt = []; this.nextFlash = 1.5;
    this.skyTop = null; this.skyBottom = null;
    this.phase = moonPhase();
  }

  setMood(m) { this.mood = m ?? PLACEHOLDER_MOOD; this.phase = moonPhase(); }

  get groundY() { return this.h * 0.86; }

  /** Ветер «с запада» несёт частицы вправо, пикселей в секунду. */
  get drift() {
    let s = Math.sin(((this.mood.windDirection + 180) * Math.PI) / 180);
    if (Math.abs(s) < 0.35) s = s < 0 ? -0.35 : 0.35;
    return this.wind * 16 * s;
  }

  get windFactor() { return Math.min(1, this.wind / 12); }

  get light() {
    const base = { morning: 0.85, day: 1, evening: 0.66, night: 0.28 }[this.mood.timeOfDay];
    return base * (1 - overcastOf(this.mood) * 0.3);
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    if (w === this.w && h === this.h) return;
    this.w = w; this.h = h;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const set = (name, k) => {
      const c = this.c[name];
      c.width = Math.round(w * k); c.height = Math.round(h * k);
      this.x[name].setTransform(k, 0, 0, k, 0, 0);
    };
    set('bg', BG_SCALE); set('fx', dpr); set('glass', dpr);
    this.stars = Array.from({ length: 140 }, () => ({ x: Math.random(), y: rnd(0, 0.6) ** 1.3, size: rnd(0.4, 1.5), phase: rnd(0, TAU), speed: rnd(0.5, 2.5) }));
    this.buildLandscape();
    this.precip = []; this.splashes = []; this.ambient = []; this.glass = []; this.clouds = [];
  }

  // ---------- Пейзаж ----------

  buildLandscape() {
    const r = seeded(7);
    const { w, h } = this;
    const gy = this.groundY;
    const ridge = (base, waves) => {
      const ph = waves.map(() => r() * TAU);
      const pts = [];
      for (let x = -12; x <= w + 12; x += 6) {
        let y = base;
        waves.forEach(([amp, freq], i) => { y += amp * Math.sin((x / w) * freq * TAU + ph[i]); });
        pts.push([x, y]);
      }
      return pts;
    };
    this.hills = [
      ridge(gy - h * 0.10, [[16, 1.1], [7, 2.9], [2, 9]]),                   // дальние холмы в дымке
      ridge(gy - h * 0.045, [[11, 1.7], [5, 4.3], [3.5, 19], [2, 41]]),     // кромка леса
      ridge(gy + 8, [[8, 0.8], [4, 2.3]]),                                    // ближний склон
    ];

    // Дерево: ветвление с небольшим разбросом, листва — множество мазков на концах веток.
    const tr = seeded(42);
    const th = Math.min(h * 0.3, 240);
    const segs = [], blobs = [];
    const grow = (x, y, ang, len, wd, depth) => {
      const x2 = x + Math.sin(ang) * len, y2 = y - Math.cos(ang) * len;
      segs.push({ x1: x, y1: y, x2, y2, wd: Math.max(wd, 0.6) });
      if (depth <= 3) {
        for (let i = 0; i < (depth === 0 ? 3 : 1); i++) {
          blobs.push({ x: x2 + (tr() - 0.5) * th * 0.08, y: y2 + (tr() - 0.5) * th * 0.08, r: th * (0.035 + tr() * 0.04), shade: tr(), pick: tr(), tint: Math.floor(tr() * 4) });
        }
      }
      if (depth === 0) return;
      const n = depth > 4 ? 2 : tr() < 0.35 ? 3 : 2;
      for (let i = 0; i < n; i++) {
        const spread = (i - (n - 1) / 2) * 0.42 + (tr() - 0.5) * 0.4;
        grow(x2, y2, ang * 0.85 + spread, len * (0.74 + tr() * 0.1), wd * 0.68, depth - 1);
      }
    };
    grow(0, 0, (tr() - 0.5) * 0.08, th * 0.26, 11, 7);
    const x0 = w * 0.8;
    this.tree = { x: x0, y: this.ridgeY(2, x0) + 4, th, segs, blobs };
  }

  ridgeY(layer, x) {
    const pts = this.hills[layer];
    const i = Math.max(0, Math.min(pts.length - 1, Math.round((x + 12) / 6)));
    return pts[i][1];
  }

  // ---------- Кадр ----------

  frame(nowMs) {
    this.resize();
    const dt = this.last == null ? 0 : Math.min(Math.max((nowMs - this.last) / 1000, 0), 0.05);
    this.last = nowMs;
    this.t += dt;
    const m = this.mood;
    const gustiness = Math.max(0, m.windGusts - m.windSpeed);
    const pulse = Math.max(0, Math.sin(this.t * 0.8) * Math.sin(this.t * 2.3 + 1.3));
    this.wind = m.windSpeed + gustiness * pulse;

    const [top, bottom] = skyColors(m);
    const k = Math.min(1, dt * 1.5);
    this.skyTop = this.skyTop ? mix(this.skyTop, top, k) : top;
    this.skyBottom = this.skyBottom ? mix(this.skyBottom, bottom, k) : bottom;

    this.updateClouds(dt); this.updatePrecip(dt); this.updateAmbient(dt); this.updateGlass(dt); this.updateLightning(dt);

    const { bg, fx, glass } = this.x;
    fx.clearRect(0, 0, this.w, this.h);
    glass.clearRect(0, 0, this.w, this.h);
    this.drawSky(bg); this.drawSun(bg); this.drawClouds(bg); this.drawHills(bg); this.drawTree(bg); this.drawNearParticles(bg);
    this.drawStars(fx); this.drawMoon(fx); this.drawAmbient(fx); this.drawPrecip(fx); this.drawSplashes(fx); this.drawFog(fx); this.drawBolt(fx);
    this.drawGlass(glass); this.drawFlash(glass);
  }

  // ---------- Обновление ----------

  makeCloud(initial) {
    const s = rnd(0.8, 1.8);
    const n = 10 + Math.floor(rnd(0, 8));
    const puffs = [];
    for (let i = 0; i < n; i++) {
      const t = (i / (n - 1)) * 2 - 1;
      puffs.push([t * 95 * s + rnd(-10, 10), -Math.cos(t * 1.3) * 22 * s * rnd(0.6, 1.2) + rnd(-6, 6), (26 + (1 - Math.abs(t)) * 24) * s * rnd(0.8, 1.15)]);
    }
    const span = 150 * s;
    return { x: initial ? rnd(-0.2, 1.2) * this.w : (this.drift >= 0 ? -span : this.w + span), y: rnd(0.05, 0.42) * this.h, speed: rnd(0.5, 1), puffs, span };
  }

  updateClouds(dt) {
    const target = Math.round(this.mood.cloudiness * 8);
    while (this.clouds.length < target) this.clouds.push(this.makeCloud(true));
    this.clouds.length = Math.min(this.clouds.length, target);
    const v = this.drift * 0.25 + (this.drift >= 0 ? 5 : -5);
    for (const c of this.clouds) {
      c.x += v * c.speed * dt;
      if (c.x > this.w + c.span) c.x = -c.span;
      if (c.x < -c.span) c.x = this.w + c.span;
    }
  }

  get precipTarget() {
    const i = this.mood.precipitationIntensity;
    const base = { none: 0, drizzle: 90 + 110 * i, rain: 120 + 380 * i, sleet: 100 + 220 * i, snow: 70 + 260 * i, hail: 40 + 110 * i }[this.mood.precipitation];
    return Math.floor(base * (this.reduceMotion ? 0.3 : 1) * Math.min(1.5, Math.max(0.6, this.w / 400)));
  }

  /** Где частица с глубиной z «касается земли»: дальние — у горизонта, ближние — внизу экрана. */
  floorFor(z) { return this.groundY - this.h * 0.03 + z * this.h * 0.15; }

  spawnPrecip(initial) {
    const kind = this.mood.precipitation;
    const z = Math.random();
    const p = { x: rnd(-0.4, 1.4) * this.w, y: 0, vx: 0, vy: 0, z, size: 1, phase: rnd(0, TAU), bounces: 0 };
    p.isSnow = kind === 'snow' || (kind === 'sleet' && Math.random() < 0.5);
    const depth = 0.5 + z * 0.7;
    if (p.isSnow) { p.vy = rnd(40, 90) * depth; p.size = rnd(1, 2.4) * (0.5 + z * 1.4); }
    else if (kind === 'hail') { p.vy = rnd(600, 850) * depth; p.size = rnd(1.8, 3.8) * (0.6 + z * 0.8); }
    else if (kind === 'drizzle') { p.vy = rnd(380, 520) * depth; p.size = 0.6; }
    else { p.vy = rnd(950, 1300) * depth; p.size = 1; }
    p.y = initial ? rnd(-this.h * 0.3, this.floorFor(z)) : rnd(-0.3 * this.h, -10);
    return p;
  }

  updatePrecip(dt) {
    const target = this.precipTarget;
    if (!this.precip.length) this.precip = Array.from({ length: target }, () => this.spawnPrecip(true));
    else if (this.precip.length < target) for (let i = 0; i < Math.min(target - this.precip.length, Math.max(1, target / 30)); i++) this.precip.push(this.spawnPrecip(false));
    this.precip.length = Math.min(this.precip.length, target);

    const d = this.drift;
    const hail = this.mood.precipitation === 'hail';
    for (let i = 0; i < this.precip.length; i++) {
      let p = this.precip[i];
      const floor = this.floorFor(p.z);
      if (p.isSnow) p.vx = d * (0.5 + p.z * 0.6) + Math.sin(this.t * 1.3 + p.phase) * 18 * (0.5 + p.z);
      else if (hail) {
        p.vy += 900 * dt;
        if (p.bounces === 0) p.vx = d * 0.5;
      } else p.vx = d * (0.7 + p.z * 0.6);
      p.x += p.vx * dt; p.y += p.vy * dt;

      if (p.y >= floor) {
        if (hail && p.bounces < 2 && p.vy > 0) {
          p.y = floor; p.vy = -p.vy * rnd(0.22, 0.38); p.vx = rnd(-70, 70); p.bounces++;
        } else if (!(hail && p.vy < 0)) {
          // Дождь разбивается брызгами о землю, снег ложится.
          if (!p.isSnow && !hail && p.z > 0.35 && this.splashes.length < 80) this.splashes.push({ x: p.x, y: floor, z: p.z, age: 0 });
          p = this.spawnPrecip(false);
        }
      }
      if (p.x < -this.w * 0.5 || p.x > this.w * 1.5) p = this.spawnPrecip(false);
      this.precip[i] = p;
    }
    for (const s of this.splashes) s.age += dt;
    this.splashes = this.splashes.filter((s) => s.age < 0.32);
  }

  get currentAmbientKind() {
    return { autumn: 'leaf', summer: 'seed', spring: 'petal', winter: 'sparkle' }[this.mood.season];
  }

  get ambientTarget() {
    const kind = this.currentAmbientKind;
    let n = kind === 'leaf' ? 6 + this.wind * 2.2 : kind === 'sparkle' ? 26 : 8 + this.wind * 1.6;
    n = Math.min(n, 45);
    if (this.mood.precipitation !== 'none') n *= kind === 'sparkle' ? 0 : 0.35;
    if (this.mood.timeOfDay === 'night' && kind !== 'sparkle') n *= 0.5;
    return Math.floor(n * (this.reduceMotion ? 0.3 : 1));
  }

  spawnAmbient(kind, initial) {
    const d = this.drift;
    const p = { x: 0, y: 0, vy: 0, z: rnd(0.2, 1), size: 1, angle: rnd(0, TAU), spin: 0, phase: rnd(0, TAU), tint: Math.floor(rnd(0, 4)) };
    if (initial) { p.x = rnd(0, this.w); p.y = rnd(0, this.groundY); }
    else if (Math.abs(d) > 40) { p.x = d > 0 ? -20 : this.w + 20; p.y = rnd(0, this.groundY * 0.95); }
    else { p.x = rnd(0, this.w); p.y = kind === 'seed' ? this.groundY + 10 : -20; }
    const depth = 0.45 + p.z * 0.8;
    if (kind === 'leaf') { p.size = rnd(5, 9) * depth; p.vy = rnd(35, 70) * depth; p.spin = rnd(-3, 3); }
    else if (kind === 'petal') { p.size = rnd(2.2, 4) * depth; p.vy = rnd(20, 45) * depth; p.spin = rnd(-4, 4); }
    else if (kind === 'seed') { p.size = rnd(4, 7) * depth; p.vy = rnd(-25, -5); }
    else { p.size = rnd(0.6, 1.8) * depth; p.vy = rnd(6, 20); }
    return p;
  }

  updateAmbient(dt) {
    const kind = this.currentAmbientKind;
    if (kind !== this.ambientKind) { this.ambient = []; this.ambientKind = kind; }
    const target = this.ambientTarget;
    if (!this.ambient.length) this.ambient = Array.from({ length: target }, () => this.spawnAmbient(kind, true));
    else if (this.ambient.length < target) this.ambient.push(this.spawnAmbient(kind, false));
    this.ambient.length = Math.min(this.ambient.length, target);
    const d = this.drift, wf = this.windFactor, t = this.t;
    for (let i = 0; i < this.ambient.length; i++) {
      let p = this.ambient[i];
      const flutter = Math.sin(t * 1.7 + p.phase);
      const depth = 0.5 + p.z * 0.7;
      if (kind === 'leaf') {
        p.x += (d * 1.2 * depth + flutter * 25) * dt;
        p.y += (p.vy * (1 - 0.5 * wf) + Math.cos(t * 2.3 + p.phase) * 30) * dt;
        p.angle += p.spin * (0.5 + wf * 2) * dt;
      } else if (kind === 'petal') {
        p.x += (d * 1.1 * depth + flutter * 18) * dt;
        p.y += (p.vy + Math.cos(t * 2 + p.phase) * 15) * dt;
        p.angle += p.spin * dt;
      } else if (kind === 'seed') {
        p.x += (d * 1.3 * depth + flutter * 10 + 6) * dt;
        p.y += (p.vy + Math.cos(t * 0.9 + p.phase) * 12) * dt;
        p.angle = Math.sin(t * 1.2 + p.phase) * 0.35 + d * 0.002;
      } else {
        p.x += (d * 0.6 + flutter * 8) * dt;
        p.y += p.vy * dt;
      }
      if (p.x < -40 || p.x > this.w + 40 || p.y > this.h + 20 || p.y < -40) p = this.spawnAmbient(kind, false);
      this.ambient[i] = p;
    }
  }

  get glassTarget() {
    return ['rain', 'drizzle', 'sleet'].includes(this.mood.precipitation)
      ? Math.floor((8 + 26 * this.mood.precipitationIntensity) * (this.reduceMotion ? 0.4 : 1)) : 0;
  }

  updateGlass(dt) {
    const target = this.glassTarget;
    if (this.glass.length < target && Math.random() < dt * 6) {
      const y = rnd(0, this.h * 0.85);
      this.glass.push({ x: rnd(0, this.w), y, r: rnd(1.5, 6.5), stuckFor: rnd(0.5, 5), vy: 0, trailTop: y, sliding: false, beads: [] });
    }
    if (this.glass.length > target) { const g = this.glass.find((x) => !x.sliding); if (g) g.sliding = true; }
    for (const g of this.glass) {
      if (!g.sliding) {
        g.stuckFor -= dt;
        // Мелкие капли набирают воду, крупные срываются и текут вниз.
        if (g.stuckFor <= 0) { if (g.r > 5) g.sliding = true; else { g.r += 0.9; g.stuckFor = rnd(0.8, 3); } }
      } else {
        g.vy = Math.min(g.vy + 160 * dt, 60 + g.r * 18);
        g.y += g.vy * dt;
        g.x += Math.sin(this.t * 3 + g.r) * 6 * dt;
        if (Math.random() < dt * 0.8) g.vy *= 0.2;
        // Стекая, капля оставляет крошечные бусинки.
        if (Math.random() < dt * 3 && g.beads.length < 6) g.beads.push([g.x + rnd(-1, 1), g.y - g.r * 1.5, rnd(0.6, 1.3)]);
      }
    }
    this.glass = this.glass.filter((g) => g.y - g.r <= this.h + 10);
  }

  updateLightning(dt) {
    this.flash = Math.max(0, this.flash - dt * 2.5);
    if (!this.mood.isThunderstorm || this.reduceMotion) return;
    if (this.t >= this.nextFlash) {
      this.flash = 1;
      this.nextFlash = this.t + rnd(3.5, 9);
      const pts = [];
      let x = rnd(0.2, 0.8) * this.w, y = this.h * 0.05;
      const end = this.groundY - this.h * 0.08;
      while (y < end) { pts.push([x, y]); x += rnd(-26, 26); y += rnd(14, 34); }
      pts.push([x, end]);
      this.bolt = pts;
    }
  }

  // ---------- Дальний план (bg, размыт) ----------

  drawSky(ctx) {
    const { w, h } = this;
    const horizon = this.groundY - h * 0.1;
    const g = ctx.createLinearGradient(0, 0, 0, horizon);
    g.addColorStop(0, css(this.skyTop));
    g.addColorStop(0.55, css(mix(this.skyTop, this.skyBottom, 0.55)));
    g.addColorStop(1, css(this.skyBottom));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    // Заря или закат подсвечивают горизонт.
    const tod = this.mood.timeOfDay;
    if (tod === 'morning' || tod === 'evening') {
      const sx = tod === 'morning' ? w * 0.15 : w * 0.86;
      const glow = ctx.createRadialGradient(sx, horizon, 0, sx, horizon, w * 0.9);
      const warm = tod === 'morning' ? [1, 0.78, 0.55] : [1, 0.55, 0.30];
      const a = 0.55 * (1 - overcastOf(this.mood));
      glow.addColorStop(0, css(warm, a)); glow.addColorStop(1, css(warm, 0));
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, w, h);
    }
  }

  drawSun(ctx) {
    const tod = this.mood.timeOfDay;
    if (tod === 'night') return;
    const vis = Math.max(0, 1 - this.mood.cloudiness * 0.85);
    if (vis <= 0.03) return;
    const [fx, fy] = { morning: [0.15, 0.36], day: [0.80, 0.13], evening: [0.86, 0.38] }[tod];
    const x = fx * this.w, y = fy * this.h;
    const sun = tod === 'day' ? [1, 0.97, 0.86] : [1, 0.78, 0.48];
    const R = Math.min(this.w, this.h) * 0.5;
    const halo = ctx.createRadialGradient(x, y, 0, x, y, R);
    halo.addColorStop(0, css(sun, 0.75 * vis));
    halo.addColorStop(0.08, css(sun, 0.45 * vis));
    halo.addColorStop(0.3, css(sun, 0.12 * vis));
    halo.addColorStop(1, css(sun, 0));
    ctx.fillStyle = halo;
    ctx.fillRect(x - R, y - R, R * 2, R * 2);
    ctx.fillStyle = css([1, 1, 0.96], vis);
    ctx.beginPath(); ctx.arc(x, y, 22, 0, TAU); ctx.fill();
  }

  drawClouds(ctx) {
    const night = this.mood.timeOfDay === 'night';
    const dark = this.mood.precipitation !== 'none' || this.mood.isThunderstorm;
    let base = night ? [0.24, 0.26, 0.31] : dark ? [0.60, 0.62, 0.66] : [0.98, 0.98, 1];
    if (this.mood.timeOfDay === 'evening') base = mix(base, [1, 0.72, 0.58], 0.3);
    if (this.mood.timeOfDay === 'morning') base = mix(base, [1, 0.88, 0.80], 0.2);
    const shadow = scale(base, dark ? 0.62 : 0.78);
    const lit = mix(base, [1, 1, 1], night ? 0.05 : 0.35);
    const a = night ? 0.7 : 0.92;

    // Сплошная облачность — «потолок» сверху.
    const o = overcastOf(this.mood);
    if (o > 0.35) {
      const deck = ctx.createLinearGradient(0, 0, 0, this.h * 0.55);
      deck.addColorStop(0, css(shadow, Math.min(0.85, (o - 0.3) * 1.4)));
      deck.addColorStop(1, css(shadow, 0));
      ctx.fillStyle = deck;
      ctx.fillRect(0, 0, this.w, this.h * 0.55);
    }

    // Каждый клуб — мягкий радиальный градиент: снизу тень, сверху подсветка, края растворяются.
    for (const c of this.clouds) {
      for (const [dx, dy, r] of c.puffs) {
        const x = c.x + dx, y = c.y + dy + r * 0.22;
        const g = ctx.createRadialGradient(x, y, 0, x, y, r * 1.05);
        g.addColorStop(0, css(shadow, a)); g.addColorStop(0.65, css(shadow, a * 0.75)); g.addColorStop(1, css(shadow, 0));
        ctx.fillStyle = g;
        ctx.fillRect(x - r * 1.05, y - r * 1.05, r * 2.1, r * 2.1);
      }
      for (const [dx, dy, r] of c.puffs) {
        const x = c.x + dx, y = c.y + dy;
        const g = ctx.createRadialGradient(x, y - r * 0.35, 0, x, y, r);
        g.addColorStop(0, css(lit, a)); g.addColorStop(0.45, css(base, a * 0.9)); g.addColorStop(1, css(base, 0));
        ctx.fillStyle = g;
        ctx.fillRect(x - r, y - r, r * 2, r * 2);
      }
    }
  }

  drawHills(ctx) {
    const k = this.light;
    const ground = scale(groundColor(this.mood), k);
    const haze = this.skyBottom;
    const snow = this.mood.snowOnGround;
    const colors = [
      mix(ground, haze, snow ? 0.45 : 0.62),                  // дальние — почти цвета неба
      mix(scale(ground, snow ? 0.92 : 0.72), haze, snow ? 0.2 : 0.28), // лес — темнее
      ground,
    ];
    this.hills.forEach((pts, i) => {
      ctx.beginPath();
      ctx.moveTo(pts[0][0], this.h);
      for (const [x, y] of pts) ctx.lineTo(x, y);
      ctx.lineTo(pts[pts.length - 1][0], this.h);
      ctx.closePath();
      if (i === 2) {
        const g = ctx.createLinearGradient(0, this.groundY - 20, 0, this.h);
        g.addColorStop(0, css(ground)); g.addColorStop(1, css(scale(ground, 0.62)));
        ctx.fillStyle = g;
      } else ctx.fillStyle = css(colors[i]);
      ctx.fill();
    });
    if (this.mood.isFog || overcastOf(this.mood) > 0.5) {
      // Влажная дымка над землёй.
      const y = this.groundY - this.h * 0.12;
      const g = ctx.createLinearGradient(0, y, 0, this.groundY + 10);
      g.addColorStop(0, css(haze, 0)); g.addColorStop(1, css(haze, this.mood.isFog ? 0.6 : 0.3));
      ctx.fillStyle = g;
      ctx.fillRect(0, y, this.w, this.groundY + 10 - y);
    }
  }

  drawTree(ctx) {
    const T = this.tree;
    const k = this.light;
    const dir = this.drift >= 0 ? 1 : -1;
    const sway = (Math.min(0.16, this.wind * 0.009) + Math.sin(this.t * 1.6) * this.wind * 0.003) * dir;
    const wf = this.windFactor;
    const t = this.t;
    // Ветер гнёт дерево тем сильнее, чем выше точка.
    const bend = (x, y) => {
      const hgt = Math.max(0, -y / T.th);
      return x + sway * T.th * hgt * hgt * 0.7 + Math.sin(t * 2.3 + y * 0.05) * wf * hgt * 4;
    };
    ctx.save();
    ctx.translate(T.x, T.y);
    ctx.lineCap = 'round';
    ctx.strokeStyle = css(scale([0.27, 0.20, 0.15], k));
    for (const s of T.segs) {
      ctx.lineWidth = s.wd;
      ctx.beginPath(); ctx.moveTo(bend(s.x1, s.y1), s.y1); ctx.lineTo(bend(s.x2, s.y2), s.y2); ctx.stroke();
    }
    const season = this.mood.season;
    if (season === 'winter') {
      if (this.mood.snowOnGround) {
        ctx.strokeStyle = `rgba(245,248,255,${0.85 * Math.max(k, 0.45)})`;
        for (const s of T.segs) {
          if (s.wd < 2) continue;
          ctx.lineWidth = s.wd * 0.45;
          ctx.beginPath(); ctx.moveTo(bend(s.x1, s.y1), s.y1 - s.wd * 0.4); ctx.lineTo(bend(s.x2, s.y2), s.y2 - s.wd * 0.4); ctx.stroke();
        }
      }
      ctx.restore();
      return;
    }
    for (const b of T.blobs) {
      if (season === 'autumn' && b.pick > 0.62) continue; // листва уже облетает
      const hgt = Math.max(0, -b.y / T.th);
      const light = (0.72 + 0.4 * hgt) * k;
      let col;
      if (season === 'autumn') col = LEAF_COLORS[b.tint];
      else if (season === 'spring') col = b.pick < 0.28 ? [0.98, 0.80, 0.86] : mix([0.33, 0.55, 0.22], [0.56, 0.76, 0.36], b.shade);
      else col = mix([0.13, 0.30, 0.11], [0.32, 0.52, 0.20], b.shade);
      ctx.fillStyle = css(scale(col, light), 0.92);
      ctx.beginPath(); ctx.arc(bend(b.x, b.y), b.y, b.r, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }

  /** Ближние частицы проходят «перед объективом» — на размытом слое они становятся боке. */
  drawNearParticles(ctx) {
    const snowBokeh = new Path2D();
    const rainBokeh = new Path2D();
    for (const p of this.precip) {
      if (p.z < 0.9) continue;
      if (p.isSnow) { snowBokeh.moveTo(p.x + p.size * 2.6, p.y); snowBokeh.arc(p.x, p.y, p.size * 2.6, 0, TAU); }
      else if (this.mood.precipitation !== 'hail') { rainBokeh.moveTo(p.x, p.y); rainBokeh.lineTo(p.x - p.vx * 0.05, p.y - p.vy * 0.05); }
    }
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.fill(snowBokeh);
    ctx.strokeStyle = 'rgba(220,232,255,0.35)';
    ctx.lineWidth = 3; ctx.lineCap = 'round';
    ctx.stroke(rainBokeh);
  }

  // ---------- Средний план (fx) ----------

  drawStars(ctx) {
    if (this.mood.timeOfDay !== 'night') return;
    const vis = 1 - this.mood.cloudiness;
    if (vis <= 0.05) return;
    for (const s of this.stars) {
      const a = vis * (0.35 + 0.65 * (0.5 + 0.5 * Math.sin(this.t * s.speed + s.phase)));
      ctx.fillStyle = `rgba(235,240,255,${a})`;
      ctx.beginPath(); ctx.arc(s.x * this.w, s.y * this.groundY, s.size / 2, 0, TAU); ctx.fill();
    }
  }

  drawMoon(ctx) {
    if (this.mood.timeOfDay !== 'night') return;
    const vis = Math.max(0, 1 - this.mood.cloudiness * 0.85);
    if (vis <= 0.03) return;
    const x = this.w * 0.8, y = this.h * 0.14, r = 17;
    const glow = ctx.createRadialGradient(x, y, r * 0.5, x, y, r * 6);
    glow.addColorStop(0, `rgba(220,230,255,${0.22 * vis})`); glow.addColorStop(1, 'rgba(220,230,255,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(x - r * 6, y - r * 6, r * 12, r * 12);

    // Пепельный свет неосвещённой части.
    ctx.fillStyle = `rgba(150,160,180,${0.12 * vis})`;
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();

    // Освещённая часть по настоящей фазе Луны.
    let phase = this.phase;
    ctx.save();
    ctx.translate(x, y);
    if (phase > 0.5) { ctx.scale(-1, 1); phase = 1 - phase; } // убывающая — зеркально
    const kx = Math.cos(phase * TAU) * r;
    ctx.beginPath();
    ctx.arc(0, 0, r, -Math.PI / 2, Math.PI / 2);
    ctx.ellipse(0, 0, Math.abs(kx), r, 0, Math.PI / 2, -Math.PI / 2, kx > 0);
    const lit = ctx.createRadialGradient(-r * 0.3, -r * 0.3, 0, 0, 0, r);
    lit.addColorStop(0, `rgba(250,248,235,${vis})`); lit.addColorStop(1, `rgba(215,215,205,${vis})`);
    ctx.fillStyle = lit;
    ctx.fill();
    // Лунные «моря».
    ctx.clip();
    ctx.fillStyle = `rgba(150,150,150,${0.18 * vis})`;
    for (const [mx, my, mr] of [[-5, -4, 5], [4, 3, 4], [-2, 7, 3.5], [6, -6, 3]]) { ctx.beginPath(); ctx.arc(mx, my, mr, 0, TAU); ctx.fill(); }
    ctx.restore();
  }

  drawAmbient(ctx) {
    const kind = this.ambientKind;
    const k = Math.max(this.light, 0.4);
    for (const p of this.ambient) {
      const alpha = 0.55 + p.z * 0.45;
      if (kind === 'sparkle') {
        ctx.fillStyle = `rgba(255,255,255,${(0.35 + 0.65 * (0.5 + 0.5 * Math.sin(this.t * 3 + p.phase))) * 0.75 * alpha})`;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, TAU); ctx.fill();
        continue;
      }
      ctx.save();
      ctx.translate(p.x, p.y); ctx.rotate(p.angle);
      ctx.globalAlpha = alpha;
      const s = p.size;
      if (kind === 'leaf') {
        ctx.scale(Math.max(0.15, Math.abs(Math.cos(this.t * 2.2 + p.phase))), 1);
        const col = scale(LEAF_COLORS[p.tint], k);
        const g = ctx.createLinearGradient(-s, 0, s, 0);
        g.addColorStop(0, css(scale(col, 0.75))); g.addColorStop(1, css(col));
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.moveTo(0, -s); ctx.bezierCurveTo(s * 0.9, -s * 0.5, s * 0.7, s * 0.6, 0, s); ctx.bezierCurveTo(-s * 0.7, s * 0.6, -s * 0.9, -s * 0.5, 0, -s); ctx.fill();
        ctx.strokeStyle = 'rgba(60,35,15,0.35)'; ctx.lineWidth = 0.5;
        ctx.beginPath(); ctx.moveTo(0, -s * 0.85); ctx.lineTo(0, s * 1.25); ctx.stroke();
      } else if (kind === 'petal') {
        ctx.fillStyle = css(scale(p.tint % 2 === 0 ? [1, 0.82, 0.88] : [1, 0.95, 0.96], k), 0.9);
        ctx.beginPath(); ctx.ellipse(0, 0, s, s * 0.55, 0, 0, TAU); ctx.fill();
      } else {
        ctx.strokeStyle = `rgba(255,255,255,${0.7 * k + 0.15})`; ctx.lineWidth = 0.4;
        ctx.beginPath();
        for (let j = 0; j < 13; j++) { const a = -Math.PI / 2 + (j - 6) * 0.22; ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a) * s, Math.sin(a) * s); }
        ctx.moveTo(0, 0); ctx.lineTo(0, s * 1.3);
        ctx.stroke();
        ctx.fillStyle = 'rgba(120,95,70,0.9)';
        ctx.beginPath(); ctx.ellipse(0, s * 1.3 + 1.2, 0.8, 1.4, 0, 0, TAU); ctx.fill();
      }
      ctx.restore();
    }
  }

  drawPrecip(ctx) {
    if (!this.precip.length) return;
    const night = this.mood.timeOfDay === 'night';
    const hail = this.mood.precipitation === 'hail';
    const drizzle = this.mood.precipitation === 'drizzle';
    // Три плана глубины: дальние капли тонкие и бледные, ближние длиннее и ярче.
    const rain = [new Path2D(), new Path2D(), new Path2D()];
    const snow = [new Path2D(), new Path2D(), new Path2D()];
    const stones = new Path2D();
    for (const p of this.precip) {
      if (p.z >= 0.9 && !hail) continue; // нарисованы на размытом слое
      const b = p.z < 0.35 ? 0 : p.z < 0.7 ? 1 : 2;
      if (p.isSnow) { snow[b].moveTo(p.x + p.size, p.y); snow[b].arc(p.x, p.y, p.size, 0, TAU); }
      else if (hail) { stones.moveTo(p.x + p.size, p.y); stones.arc(p.x, p.y, p.size, 0, TAU); }
      else {
        const len = drizzle ? 0.018 : 0.03;
        rain[b].moveTo(p.x, p.y); rain[b].lineTo(p.x - p.vx * len, p.y - p.vy * len);
      }
    }
    ctx.lineCap = 'round';
    const rainAlpha = night ? [0.10, 0.17, 0.26] : [0.16, 0.26, 0.40];
    const widths = drizzle ? [0.4, 0.6, 0.8] : [0.5, 0.8, 1.2];
    rain.forEach((path, i) => { ctx.strokeStyle = `rgba(215,228,245,${rainAlpha[i]})`; ctx.lineWidth = widths[i]; ctx.stroke(path); });
    [0.55, 0.75, 0.92].forEach((a, i) => { ctx.fillStyle = `rgba(255,255,255,${a})`; ctx.fill(snow[i]); });
    if (hail) {
      ctx.fillStyle = 'rgb(232,240,250)'; ctx.fill(stones);
      ctx.strokeStyle = 'rgba(140,170,205,0.8)'; ctx.lineWidth = 0.5; ctx.stroke(stones);
    }
  }

  drawSplashes(ctx) {
    ctx.lineWidth = 0.7;
    for (const s of this.splashes) {
      const p = s.age / 0.32;
      const rx = (1.5 + p * 9) * s.z;
      ctx.strokeStyle = `rgba(225,235,250,${(1 - p) * 0.45 * s.z})`;
      ctx.beginPath(); ctx.ellipse(s.x, s.y, rx, rx * 0.3, 0, Math.PI, TAU); ctx.stroke();
      // Пара отскочивших капелек.
      ctx.fillStyle = `rgba(225,235,250,${(1 - p) * 0.5 * s.z})`;
      const up = Math.sin(p * Math.PI) * 6 * s.z;
      ctx.fillRect(s.x - rx * 0.7, s.y - up, 1, 1);
      ctx.fillRect(s.x + rx * 0.6, s.y - up * 0.8, 1, 1);
    }
  }

  drawFog(ctx) {
    if (!this.mood.isFog) return;
    ctx.fillStyle = 'rgba(220,225,232,0.18)';
    ctx.fillRect(0, 0, this.w, this.h);
    for (let i = 0; i < 4; i++) {
      const y = this.h * (0.4 + i * 0.13), x = Math.sin(this.t * 0.12 + i) * 70;
      const g = ctx.createLinearGradient(0, y - 60, 0, y + 60);
      g.addColorStop(0, 'rgba(230,235,240,0)'); g.addColorStop(0.5, 'rgba(230,235,240,0.3)'); g.addColorStop(1, 'rgba(230,235,240,0)');
      ctx.fillStyle = g; ctx.fillRect(x - 90, y - 60, this.w + 180, 120);
    }
  }

  drawBolt(ctx) {
    if (this.flash <= 0.5 || this.bolt.length < 2) return;
    ctx.save();
    ctx.beginPath(); this.bolt.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.shadowColor = 'rgb(190,205,255)'; ctx.shadowBlur = 24;
    ctx.strokeStyle = 'rgba(235,240,255,0.95)'; ctx.lineWidth = 1.8; ctx.stroke();
    ctx.restore();
  }

  // ---------- Стекло (glass, резко) ----------

  drawGlass(ctx) {
    for (const g of this.glass) {
      for (const [bx, by, br] of g.beads) {
        ctx.fillStyle = 'rgba(255,255,255,0.22)';
        ctx.beginPath(); ctx.arc(bx, by, br, 0, TAU); ctx.fill();
      }
      if (g.sliding) {
        const top = Math.max(g.trailTop, g.y - g.r - 90);
        const grad = ctx.createLinearGradient(g.x, top, g.x, g.y);
        grad.addColorStop(0, 'rgba(255,255,255,0)'); grad.addColorStop(1, 'rgba(255,255,255,0.10)');
        ctx.strokeStyle = grad; ctx.lineWidth = g.r * 0.45; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(g.x, top); ctx.lineTo(g.x, g.y - g.r); ctx.stroke();
      }
      const r = g.r;
      // Тень под каплей.
      ctx.fillStyle = 'rgba(0,0,0,0.14)';
      ctx.beginPath(); ctx.ellipse(g.x + 0.6, g.y + 1.2, r, r * 1.1, 0, 0, TAU); ctx.fill();
      // Тело капли: прозрачное в середине, светлее по краю — как линза.
      const body = ctx.createRadialGradient(g.x - r * 0.25, g.y - r * 0.35, r * 0.1, g.x, g.y, r * 1.1);
      body.addColorStop(0, 'rgba(255,255,255,0.04)');
      body.addColorStop(0.7, 'rgba(255,255,255,0.08)');
      body.addColorStop(1, 'rgba(255,255,255,0.32)');
      ctx.fillStyle = body;
      ctx.beginPath(); ctx.ellipse(g.x, g.y, r, r * 1.1, 0, 0, TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(20,30,45,0.22)'; ctx.lineWidth = 0.5; ctx.stroke();
      // Блик сверху и отсвет снизу.
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.beginPath(); ctx.ellipse(g.x - r * 0.35, g.y - r * 0.45, r * 0.22, r * 0.14, -0.6, 0, TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.lineWidth = Math.max(0.5, r * 0.15);
      ctx.beginPath(); ctx.arc(g.x, g.y + r * 0.1, r * 0.75, 0.25 * Math.PI, 0.75 * Math.PI); ctx.stroke();
    }
  }

  drawFlash(ctx) {
    if (this.flash <= 0) return;
    const flicker = 0.7 + 0.3 * Math.sin(this.t * 45);
    ctx.fillStyle = `rgba(225,232,255,${this.flash * 0.4 * flicker})`;
    ctx.fillRect(0, 0, this.w, this.h);
  }
}

/** Флюгер: стрелка — откуда дует ветер, вертушка крутится тем быстрее, чем сильнее ветер. */
export class Vane {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.direction = 0; this.speed = 0; this.gusts = 0;
    this.spin = 0; this.t = 0; this.last = null;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = 120 * dpr; canvas.height = 120 * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  set(direction, speed, gusts) { this.direction = direction; this.speed = speed; this.gusts = gusts; }

  frame(nowMs) {
    const dt = this.last == null ? 0 : Math.min((nowMs - this.last) / 1000, 0.05);
    this.last = nowMs; this.t += dt;
    const t = this.t;
    const rps = Math.min(0.15 + this.speed * 0.32, 7);
    const gustBoost = Math.max(0, this.gusts - this.speed) * 0.08 * Math.max(0, Math.sin(t * 0.8) * Math.sin(t * 2.3 + 1.3));
    this.spin += (rps + gustBoost) * Math.PI * 2 * dt;

    const { ctx } = this;
    const c = 60, r = 58;
    ctx.clearRect(0, 0, 120, 120);
    ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.beginPath(); ctx.arc(c, c, r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.4)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.beginPath();
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2, inner = i % 4 === 0 ? r - 9 : r - 5;
      ctx.moveTo(c + Math.sin(a) * inner, c - Math.cos(a) * inner); ctx.lineTo(c + Math.sin(a) * r, c - Math.cos(a) * r);
    }
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.font = 'bold 11px -apple-system, system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    [['С', 0], ['В', 90], ['Ю', 180], ['З', 270]].forEach(([l, a]) => {
      const rad = (a * Math.PI) / 180; ctx.fillText(l, c + Math.sin(rad) * (r - 18), c - Math.cos(rad) * (r - 18));
    });

    const wobble = Math.sin(t * 3.1) * Math.min(this.speed, 15) * 0.6 + Math.sin(t * 7.3) * Math.min(Math.max(this.gusts - this.speed, 0), 10) * 0.4;
    const len = r - 14;
    ctx.save();
    ctx.translate(c, c); ctx.rotate(((this.direction + wobble) * Math.PI) / 180);
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(0, -len); ctx.lineTo(0, len); ctx.stroke();
    ctx.fillStyle = 'rgb(255,107,77)'; ctx.beginPath(); ctx.moveTo(0, -len - 4); ctx.lineTo(-7, -len + 10); ctx.lineTo(7, -len + 10); ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.beginPath(); ctx.moveTo(0, len - 14); ctx.lineTo(-9, len + 2); ctx.lineTo(0, len - 2); ctx.lineTo(9, len + 2); ctx.closePath(); ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.translate(c, c); ctx.rotate(this.spin);
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = i % 2 === 0 ? 'rgb(255,204,77)' : 'rgb(89,179,255)';
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(10, -12, 0, -24); ctx.quadraticCurveTo(-2, -12, 0, 0); ctx.fill();
      ctx.rotate(Math.PI / 2);
    }
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(0, 0, 4, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
}
