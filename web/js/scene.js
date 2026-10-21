// Живой фон: небо, солнце/луна, облака, холм с деревом, дождь/снег/град, листья/пух/лепестки,
// капли на стекле, молнии, туман. Перенос SceneEngine.swift на Canvas 2D.

import { PLACEHOLDER_MOOD } from './logic.js';

const rnd = (a, b) => a + Math.random() * (b - a);
const mix = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
const scale = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
const css = (c, alpha = 1) => `rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},${alpha})`;

export function skyColors(m) {
  let top, bottom;
  switch (m.timeOfDay) {
    case 'morning': top = [0.33, 0.52, 0.85]; bottom = [0.99, 0.76, 0.56]; break;
    case 'day': top = [0.16, 0.46, 0.88]; bottom = [0.58, 0.80, 0.98]; break;
    case 'evening': top = [0.22, 0.20, 0.48]; bottom = [0.98, 0.52, 0.34]; break;
    default: top = [0.02, 0.04, 0.13]; bottom = [0.10, 0.14, 0.30];
  }
  const gray = m.timeOfDay === 'night' ? [0.10, 0.11, 0.14] : [0.52, 0.55, 0.60];
  const o = overcastOf(m);
  top = mix(top, scale(gray, 0.8), o);
  bottom = mix(bottom, gray, o);
  if (m.season === 'winter') top = mix(top, [0.55, 0.65, 0.85], 0.1);
  return [top, bottom];
}

const overcastOf = (m) => Math.min(0.85, m.cloudiness * 0.55 + (m.precipitation !== 'none' ? 0.2 : 0) + (m.isThunderstorm ? 0.15 : 0));

const LEAF_COLORS = [[0.95, 0.55, 0.12], [0.86, 0.25, 0.12], [0.97, 0.80, 0.22], [0.62, 0.38, 0.18]];

export class Scene {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.mood = PLACEHOLDER_MOOD;
    this.reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.w = 0; this.h = 0;
    this.t = 0; this.last = null; this.wind = 0;
    this.precip = []; this.ambient = []; this.ambientKind = null; this.glass = []; this.clouds = []; this.stars = [];
    this.flash = 0; this.bolt = []; this.nextFlash = 1.5;
    this.skyTop = null; this.skyBottom = null;
  }

  setMood(m) { this.mood = m ?? PLACEHOLDER_MOOD; }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth, h = window.innerHeight;
    if (w === this.w && h === this.h) return;
    this.w = w; this.h = h;
    this.canvas.width = w * dpr; this.canvas.height = h * dpr;
    this.canvas.style.width = `${w}px`; this.canvas.style.height = `${h}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.stars = Array.from({ length: 90 }, () => ({ x: Math.random(), y: rnd(0, 0.62), size: rnd(0.6, 1.9), phase: rnd(0, 6.28), speed: rnd(0.5, 2.5) }));
    this.precip = []; this.ambient = []; this.glass = []; this.clouds = [];
  }

  get groundY() { return this.h * 0.86; }

  /** Ветер «с запада» несёт частицы вправо, пикселей в секунду. */
  get drift() {
    let s = Math.sin(((this.mood.windDirection + 180) * Math.PI) / 180);
    if (Math.abs(s) < 0.35) s = s < 0 ? -0.35 : 0.35;
    return this.wind * 16 * s;
  }

  get windFactor() { return Math.min(1, this.wind / 12); }

  get light() {
    const base = { morning: 0.85, day: 1, evening: 0.68, night: 0.32 }[this.mood.timeOfDay];
    return base * (1 - overcastOf(this.mood) * 0.3);
  }

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
    this.draw();
  }

  // ---------- Обновление ----------

  updateClouds(dt) {
    const target = Math.round(this.mood.cloudiness * 7);
    while (this.clouds.length < target) this.clouds.push({ x: rnd(-0.2, 1.2) * this.w, y: rnd(0.04, 0.45) * this.h, scale: rnd(0.7, 1.5), speed: rnd(0.5, 1) });
    this.clouds.length = Math.min(this.clouds.length, target);
    const v = this.drift * 0.25 + (this.drift >= 0 ? 5 : -5);
    for (const c of this.clouds) {
      c.x += v * c.speed * dt;
      const span = 140 * c.scale;
      if (c.x > this.w + span) c.x = -span;
      if (c.x < -span) c.x = this.w + span;
    }
  }

  get precipTarget() {
    const i = this.mood.precipitationIntensity;
    const base = { none: 0, drizzle: 60 + 80 * i, rain: 80 + 260 * i, sleet: 80 + 160 * i, snow: 50 + 200 * i, hail: 40 + 110 * i }[this.mood.precipitation];
    return Math.floor(base * (this.reduceMotion ? 0.3 : 1) * Math.min(1.5, Math.max(0.6, this.w / 400)));
  }

  spawnPrecip(initial) {
    const kind = this.mood.precipitation;
    const p = { x: rnd(-0.4, 1.4) * this.w, y: initial ? rnd(-this.h, this.h) : rnd(-0.25 * this.h, -10), vx: 0, vy: 0, size: 1, angle: 0, spin: 0, phase: rnd(0, Math.PI * 2), bounces: 0 };
    p.isSnow = kind === 'snow' || (kind === 'sleet' && Math.random() < 0.5);
    if (p.isSnow) { p.vy = rnd(45, 110); p.size = rnd(1.5, 4.8); p.spin = rnd(-1.5, 1.5); }
    else if (kind === 'hail') { p.vy = rnd(600, 850); p.size = rnd(2.2, 4.5); }
    else if (kind === 'drizzle') { p.vy = rnd(380, 520); p.size = rnd(0.6, 1); }
    else { p.vy = rnd(900, 1300); p.size = rnd(0.9, 1.6); }
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
      if (p.isSnow) { p.vx = d * 0.9 + Math.sin(this.t * 1.4 + p.phase) * 22; p.angle += p.spin * dt; }
      else if (hail) {
        p.vy += 900 * dt;
        if (p.bounces === 0) p.vx = d * 0.5;
        const floor = this.groundY + (p.phase / (Math.PI * 2)) * this.h * 0.12;
        if (p.y > floor && p.vy > 0 && p.bounces < 2) { p.y = floor; p.vy = -p.vy * rnd(0.22, 0.38); p.vx = rnd(-70, 70); p.bounces++; }
      } else p.vx = d * 1.1;
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.y > this.h + 20 || p.x < -this.w * 0.5 || p.x > this.w * 1.5) p = this.spawnPrecip(false);
      this.precip[i] = p;
    }
  }

  get currentAmbientKind() {
    return { autumn: 'leaf', summer: 'seed', spring: 'petal', winter: 'sparkle' }[this.mood.season];
  }

  get ambientTarget() {
    const kind = this.currentAmbientKind;
    let n = kind === 'leaf' ? 6 + this.wind * 2.2 : kind === 'sparkle' ? 22 : 8 + this.wind * 1.6;
    n = Math.min(n, 45);
    if (this.mood.precipitation !== 'none') n *= kind === 'sparkle' ? 0 : 0.35;
    if (this.mood.timeOfDay === 'night' && kind !== 'sparkle') n *= 0.5;
    return Math.floor(n * (this.reduceMotion ? 0.3 : 1));
  }

  spawnAmbient(kind, initial) {
    const d = this.drift;
    const p = { x: 0, y: 0, vx: 0, vy: 0, size: 1, angle: rnd(0, Math.PI * 2), spin: 0, phase: rnd(0, Math.PI * 2), tint: Math.floor(rnd(0, 4)) };
    if (initial) { p.x = rnd(0, this.w); p.y = rnd(0, this.groundY); }
    else if (Math.abs(d) > 40) { p.x = d > 0 ? -20 : this.w + 20; p.y = rnd(0, this.groundY * 0.95); }
    else { p.x = rnd(0, this.w); p.y = kind === 'seed' ? this.groundY + 10 : -20; }
    if (kind === 'leaf') { p.size = rnd(7, 13); p.vy = rnd(35, 70); p.spin = rnd(-3, 3); }
    else if (kind === 'petal') { p.size = rnd(3, 6); p.vy = rnd(20, 45); p.spin = rnd(-4, 4); }
    else if (kind === 'seed') { p.size = rnd(5, 9); p.vy = rnd(-25, -5); }
    else { p.size = rnd(0.8, 2.2); p.vy = rnd(6, 20); }
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
      if (kind === 'leaf') {
        p.x += (d * 1.3 + flutter * 25) * dt;
        p.y += (p.vy * (1 - 0.5 * wf) + Math.cos(t * 2.3 + p.phase) * 30) * dt;
        p.angle += p.spin * (0.5 + wf * 2) * dt;
      } else if (kind === 'petal') {
        p.x += (d * 1.2 + flutter * 18) * dt;
        p.y += (p.vy + Math.cos(t * 2 + p.phase) * 15) * dt;
        p.angle += p.spin * dt;
      } else if (kind === 'seed') {
        p.x += (d * 1.4 + flutter * 10 + 6) * dt;
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
      ? Math.floor((6 + 22 * this.mood.precipitationIntensity) * (this.reduceMotion ? 0.4 : 1)) : 0;
  }

  updateGlass(dt) {
    const target = this.glassTarget;
    if (this.glass.length < target && Math.random() < dt * 5) {
      const y = rnd(0, this.h * 0.8);
      this.glass.push({ x: rnd(0, this.w), y, r: rnd(2.5, 7), stuckFor: rnd(0.5, 5), vy: 0, trailTop: y, sliding: false });
    }
    if (this.glass.length > target) { const g = this.glass.find((x) => !x.sliding); if (g) g.sliding = true; }
    for (const g of this.glass) {
      if (!g.sliding) {
        g.stuckFor -= dt;
        // Мелкие капли набирают воду, крупные срываются и текут вниз.
        if (g.stuckFor <= 0) { if (g.r > 5) g.sliding = true; else { g.r += 1.2; g.stuckFor = rnd(0.8, 3); } }
      } else {
        g.vy = Math.min(g.vy + 160 * dt, 60 + g.r * 18);
        g.y += g.vy * dt;
        g.x += Math.sin(this.t * 3 + g.r) * 6 * dt;
        if (Math.random() < dt * 0.8) g.vy *= 0.2;
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
      while (y < this.h * 0.62) { pts.push([x, y]); x += rnd(-30, 30); y += rnd(20, 45); }
      this.bolt = pts;
    }
  }

  // ---------- Отрисовка ----------

  circle(x, y, r) { this.ctx.beginPath(); this.ctx.arc(x, y, Math.max(r, 0.1), 0, Math.PI * 2); }

  draw() {
    const { ctx, w, h } = this;
    const g = ctx.createLinearGradient(0, 0, 0, this.groundY);
    g.addColorStop(0, css(this.skyTop)); g.addColorStop(1, css(this.skyBottom));
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    this.drawStars(); this.drawCelestial(); this.drawClouds(); this.drawGround(); this.drawTree();
    this.drawAmbient(); this.drawPrecip(); this.drawFog(); this.drawGlass(); this.drawFlash();
  }

  drawStars() {
    if (this.mood.timeOfDay !== 'night') return;
    const vis = 1 - this.mood.cloudiness;
    if (vis <= 0.05) return;
    for (const s of this.stars) {
      const a = vis * (0.45 + 0.55 * (0.5 + 0.5 * Math.sin(this.t * s.speed + s.phase)));
      this.ctx.fillStyle = `rgba(255,255,255,${a})`;
      this.circle(s.x * this.w, s.y * this.h, s.size / 2); this.ctx.fill();
    }
  }

  drawCelestial() {
    const { ctx, w, h } = this;
    const vis = Math.max(0, 1 - this.mood.cloudiness * 0.85);
    if (vis <= 0.05) return;
    const [fx, fy] = { morning: [0.15, 0.33], day: [0.80, 0.13], evening: [0.86, 0.35], night: [0.80, 0.14] }[this.mood.timeOfDay];
    const x = fx * w, y = fy * h;
    if (this.mood.timeOfDay === 'night') {
      const glow = ctx.createRadialGradient(x, y, 0, x, y, 70);
      glow.addColorStop(0, `rgba(255,255,255,${0.18 * vis})`); glow.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = glow; this.circle(x, y, 70); ctx.fill();
      // Серп: луна минус смещённый круг.
      ctx.save();
      ctx.beginPath(); ctx.arc(x, y, 20, 0, Math.PI * 2); ctx.clip();
      ctx.beginPath(); ctx.arc(x, y, 20, 0, Math.PI * 2); ctx.moveTo(x + 27, y - 6); ctx.arc(x + 9, y - 6, 18, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(245,242,219,${vis})`; ctx.fill('evenodd');
      ctx.restore();
    } else {
      const sun = this.mood.timeOfDay === 'day' ? [1, 0.95, 0.72] : [1, 0.72, 0.38];
      const r = 110 * (1 + 0.04 * Math.sin(this.t * 1.3));
      const glow = ctx.createRadialGradient(x, y, 0, x, y, r);
      glow.addColorStop(0, css(sun, 0.55 * vis)); glow.addColorStop(1, css(sun, 0));
      ctx.fillStyle = glow; this.circle(x, y, r); ctx.fill();
      ctx.fillStyle = css(sun, vis); this.circle(x, y, 30); ctx.fill();
    }
  }

  drawClouds() {
    if (!this.clouds.length) return;
    const { ctx } = this;
    const night = this.mood.timeOfDay === 'night';
    const dark = this.mood.precipitation !== 'none' || this.mood.isThunderstorm;
    let base = night ? [0.32, 0.34, 0.40] : dark ? [0.55, 0.57, 0.62] : [1, 1, 1];
    if (this.mood.timeOfDay === 'evening') base = mix(base, [1, 0.75, 0.65], 0.25);
    const alpha = night ? 0.55 : 0.8;
    const puffs = [[-52, 8, 40], [0, -12, 56], [50, 4, 44], [-22, 18, 38], [26, 20, 40]];
    // Мягкие края радиальным градиентом: canvas-фильтр blur в Safari ненадёжен.
    for (const c of this.clouds) {
      for (const [dx, dy, r] of puffs) {
        const rr = r * c.scale, x = c.x + dx * c.scale, y = c.y + dy * c.scale;
        const g = ctx.createRadialGradient(x, y, 0, x, y, rr);
        g.addColorStop(0, css(base, alpha)); g.addColorStop(0.6, css(base, alpha * 0.8)); g.addColorStop(1, css(base, 0));
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.ellipse(x, y, rr, rr * 0.8, 0, 0, Math.PI * 2); ctx.fill();
      }
    }
  }

  hillY(x) {
    const gy = this.groundY, w = this.w;
    let best = gy, bestDist = Infinity;
    for (let i = 0; i <= 50; i++) {
      const s = i / 50;
      const px = 2 * (1 - s) * s * 0.55 * w + s * s * w;
      const py = (1 - s) * (1 - s) * (gy + 10) + 2 * (1 - s) * s * (gy - 50) + s * s * (gy - 14);
      if (Math.abs(px - x) < bestDist) { bestDist = Math.abs(px - x); best = py; }
    }
    return best;
  }

  drawGround() {
    const { ctx, w, h } = this;
    const gy = this.groundY;
    let top, bottom;
    if (this.mood.snowOnGround) { top = [0.93, 0.96, 1]; bottom = [0.74, 0.81, 0.92]; }
    else ({ top, bottom } = {
      spring: { top: [0.48, 0.78, 0.36], bottom: [0.30, 0.55, 0.25] },
      summer: { top: [0.30, 0.62, 0.25], bottom: [0.18, 0.42, 0.16] },
      autumn: { top: [0.72, 0.55, 0.22], bottom: [0.48, 0.36, 0.16] },
      winter: { top: [0.50, 0.50, 0.42], bottom: [0.35, 0.35, 0.30] },
    }[this.mood.season]);
    const k = this.light;
    const g = ctx.createLinearGradient(0, gy - 50, 0, h);
    g.addColorStop(0, css(scale(top, k))); g.addColorStop(1, css(scale(bottom, k)));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0, gy + 10);
    ctx.quadraticCurveTo(w * 0.55, gy - 50, w, gy - 14);
    ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath(); ctx.fill();
  }

  drawTree() {
    const { ctx } = this;
    const bx = this.w * 0.8, by = this.hillY(bx) + 6;
    const th = Math.min(this.h * 0.26, 210);
    const k = this.light;
    const dir = this.drift >= 0 ? 1 : -1;
    const sway = Math.min(0.25, this.wind * 0.012 + Math.sin(this.t * 1.6) * this.wind * 0.004) * dir;
    const bark = css(scale([0.36, 0.25, 0.17], k));
    ctx.save();
    ctx.translate(bx, by); ctx.rotate(sway * 0.35);
    ctx.fillStyle = bark;
    ctx.beginPath(); ctx.moveTo(-7, 0); ctx.lineTo(-3, -th * 0.85); ctx.lineTo(3, -th * 0.85); ctx.lineTo(7, 0); ctx.closePath(); ctx.fill();

    const tips = [];
    ctx.strokeStyle = bark; ctx.lineWidth = 3; ctx.lineCap = 'round';
    ctx.beginPath();
    for (const [a, len, yf] of [[-0.75, 0.36, 0.5], [0.65, 0.32, 0.58], [-0.5, 0.26, 0.72], [0.45, 0.24, 0.8], [0.05, 0.22, 0.85]]) {
      const sx = 0, sy = -th * yf;
      const angle = a + sway * 0.8 + Math.sin(this.t * 2.1 + a * 3) * this.windFactor * 0.06;
      const ex = sx + Math.sin(angle) * th * len, ey = sy - Math.cos(angle) * th * len;
      ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); tips.push([ex, ey]);
    }
    ctx.stroke();

    if (this.mood.season === 'winter') {
      if (this.mood.snowOnGround) {
        ctx.fillStyle = `rgba(255,255,255,${0.9 * Math.max(k, 0.5)})`;
        for (const [x, y] of tips) { ctx.beginPath(); ctx.ellipse(x, y - 0.5, 7, 2.5, 0, 0, Math.PI * 2); ctx.fill(); }
      }
      ctx.restore();
      return;
    }
    const autumn = this.mood.season === 'autumn';
    const blobs = autumn
      ? [[0, -0.72, 0.30], [-0.28, -0.6, 0.24], [0.28, -0.62, 0.22], [0.05, -0.92, 0.22]]
      : [[0, -0.75, 0.36], [-0.3, -0.62, 0.28], [0.3, -0.64, 0.28], [-0.14, -0.95, 0.27], [0.16, -0.93, 0.26]];
    const palette = { spring: [[0.45, 0.76, 0.35], [0.52, 0.82, 0.40]], summer: [[0.18, 0.52, 0.20], [0.24, 0.60, 0.24]] }[this.mood.season]
      ?? [[0.93, 0.55, 0.15], [0.85, 0.30, 0.15], [0.95, 0.78, 0.25]];
    ctx.rotate(sway * 0.4);
    blobs.forEach(([ox, oy, r], i) => {
      const wob = Math.sin(this.t * 2.4 + i) * this.windFactor * 4;
      ctx.fillStyle = css(scale(palette[i % palette.length], k), 0.95);
      this.circle(ox * th + wob, oy * th, r * th); ctx.fill();
    });
    if (this.mood.season === 'spring') {
      ctx.fillStyle = css(scale([1, 0.78, 0.86], k));
      for (let i = 0; i < 14; i++) {
        const a = i * 2.4, rr = th * 0.3 * (0.4 + 0.6 * ((i * 37) % 10) / 10);
        this.circle(Math.sin(a) * rr, -th * 0.75 + Math.cos(a) * rr * 0.8, 3); ctx.fill();
      }
    }
    ctx.restore();
  }

  drawAmbient() {
    const { ctx } = this;
    const kind = this.ambientKind;
    const k = Math.max(this.light, 0.45);
    for (const p of this.ambient) {
      if (kind === 'sparkle') {
        ctx.fillStyle = `rgba(255,255,255,${(0.4 + 0.6 * (0.5 + 0.5 * Math.sin(this.t * 3 + p.phase))) * 0.8})`;
        this.circle(p.x, p.y, p.size); ctx.fill();
        continue;
      }
      ctx.save();
      ctx.translate(p.x, p.y); ctx.rotate(p.angle);
      const s = p.size;
      if (kind === 'leaf') {
        ctx.scale(Math.max(0.15, Math.abs(Math.cos(this.t * 2.2 + p.phase))), 1);
        ctx.fillStyle = css(scale(LEAF_COLORS[p.tint], k));
        ctx.beginPath(); ctx.moveTo(0, -s); ctx.quadraticCurveTo(s * 0.85, 0, 0, s); ctx.quadraticCurveTo(-s * 0.85, 0, 0, -s); ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 0.7;
        ctx.beginPath(); ctx.moveTo(0, -s * 0.9); ctx.lineTo(0, s * 1.3); ctx.stroke();
      } else if (kind === 'petal') {
        ctx.fillStyle = css(scale(p.tint % 2 === 0 ? [1, 0.78, 0.86] : [1, 0.95, 0.97], k), 0.95);
        ctx.beginPath(); ctx.ellipse(0, 0, s, s * 0.55, 0, 0, Math.PI * 2); ctx.fill();
      } else {
        ctx.strokeStyle = `rgba(255,255,255,${0.85 * k + 0.1})`; ctx.lineWidth = 0.6;
        ctx.beginPath();
        for (let j = 0; j < 9; j++) { const a = -Math.PI / 2 + (j - 4) * 0.3; ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a) * s, Math.sin(a) * s); }
        ctx.moveTo(0, 0); ctx.lineTo(0, s * 1.3);
        ctx.stroke();
        ctx.fillStyle = css([0.5, 0.4, 0.3]);
        ctx.beginPath(); ctx.ellipse(0, s * 1.25 + 1.75, 1.2, 1.75, 0, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    }
  }

  drawPrecip() {
    if (!this.precip.length) return;
    const { ctx } = this;
    const hail = this.mood.precipitation === 'hail';
    const night = this.mood.timeOfDay === 'night';
    const streaks = new Path2D(), flakes = new Path2D(), big = new Path2D(), stones = new Path2D();
    for (const p of this.precip) {
      if (p.isSnow) {
        if (p.size > 3.8) {
          for (let j = 0; j < 3; j++) {
            const a = p.angle + (j * Math.PI) / 3, dx = Math.cos(a) * p.size, dy = Math.sin(a) * p.size;
            big.moveTo(p.x - dx, p.y - dy); big.lineTo(p.x + dx, p.y + dy);
          }
        } else { flakes.moveTo(p.x + p.size / 2, p.y); flakes.arc(p.x, p.y, p.size / 2, 0, Math.PI * 2); }
      } else if (hail) { stones.moveTo(p.x + p.size / 2, p.y); stones.arc(p.x, p.y, p.size / 2, 0, Math.PI * 2); }
      else { streaks.moveTo(p.x, p.y); streaks.lineTo(p.x - p.vx * 0.028, p.y - p.vy * 0.028); }
    }
    ctx.lineCap = 'round';
    ctx.strokeStyle = `rgba(255,255,255,${night ? 0.3 : 0.5})`; ctx.lineWidth = this.mood.precipitation === 'drizzle' ? 0.8 : 1.2; ctx.stroke(streaks);
    ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.fill(flakes);
    ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 1.3; ctx.stroke(big);
    ctx.fillStyle = 'rgb(235,245,255)'; ctx.fill(stones);
    ctx.strokeStyle = 'rgb(153,191,230)'; ctx.lineWidth = 0.6; ctx.stroke(stones);
  }

  drawFog() {
    if (!this.mood.isFog) return;
    const { ctx } = this;
    for (let i = 0; i < 4; i++) {
      const y = this.h * (0.35 + i * 0.15), x = Math.sin(this.t * 0.15 + i) * 60;
      const g = ctx.createLinearGradient(0, y - 50, 0, y + 50);
      g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.5, 'rgba(255,255,255,0.32)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g; ctx.fillRect(x - 80, y - 50, this.w + 160, 100);
    }
  }

  drawGlass() {
    const { ctx } = this;
    for (const g of this.glass) {
      if (g.sliding) {
        // Короткий влажный след за каплей, тающий кверху.
        const top = Math.max(g.trailTop, g.y - g.r - 90);
        const grad = ctx.createLinearGradient(g.x, top, g.x, g.y);
        grad.addColorStop(0, 'rgba(255,255,255,0)'); grad.addColorStop(1, 'rgba(255,255,255,0.14)');
        ctx.strokeStyle = grad; ctx.lineWidth = g.r * 0.5; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(g.x, top); ctx.lineTo(g.x, g.y - g.r); ctx.stroke();
      }
      ctx.beginPath(); ctx.ellipse(g.x, g.y, g.r, g.r * 1.1, 0, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.14)'; ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 0.8; ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.75)'; this.circle(g.x - g.r * 0.35, g.y - g.r * 0.5, g.r * 0.28); ctx.fill();
    }
  }

  drawFlash() {
    if (this.flash <= 0) return;
    const { ctx } = this;
    const flicker = 0.7 + 0.3 * Math.sin(this.t * 45);
    ctx.fillStyle = `rgba(255,255,255,${this.flash * 0.45 * flicker})`;
    ctx.fillRect(0, 0, this.w, this.h);
    if (this.flash > 0.55 && this.bolt.length > 1) {
      ctx.save();
      ctx.beginPath(); this.bolt.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.lineJoin = 'round';
      ctx.shadowColor = 'rgb(204,217,255)'; ctx.shadowBlur = 14;
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.2; ctx.stroke();
      ctx.restore();
    }
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
