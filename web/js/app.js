// Интерфейс веб-версии «Погодки»: страницы со свайпом, герой-экран, карточки, листы, предупреждения.

import * as L from './logic.js';
import * as API from './api.js';
import { Scene, Vane } from './scene.js';

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const now = () => Date.now() / 1000;
const T = L.Units.temp;
const N = L.Units.num;
const REDUCE_MOTION = matchMedia('(prefers-reduced-motion: reduce)').matches;
// Проверка анимаций: index.html?demo=rain|snow|hail|storm|sleet
const DEMO = new URLSearchParams(location.search).get('demo');

const scene = new Scene($('#sky'));
const pagesEl = $('#pages');
const badgeEl = $('#alertBadge');
const spotEl = $('#spotlight');

// ---------- Места ----------

function readPlaces() {
  try { return JSON.parse(localStorage.getItem('places') || '[]'); } catch { return []; }
}
function writePlaces() {
  try { localStorage.setItem('places', JSON.stringify(places)); } catch { /* приватный режим */ }
}
let places = readPlaces();

const pageList = () => [{ id: 'current', current: true, name: 'Моё местоположение' }, ...places];

// ---------- Состояние страниц ----------

const states = new Map();
let activeIndex = 0;

function stateFor(page) {
  if (!states.has(page.id)) {
    states.set(page.id, {
      page, snapshot: null, stale: false, error: null, loading: false, loadedAt: 0,
      alerts: [], headline: null, history: null, historyLoading: false, historyError: null, climate: null,
      lat: page.lat ?? null, lon: page.lon ?? null, title: null, subtitle: null, locationDenied: false,
      countStart: null, countedFor: null, el: null, vane: null, tempEl: null,
    });
  }
  const st = states.get(page.id);
  st.page = page;
  return st;
}

const activeState = () => states.get(pageList()[activeIndex]?.id);

function moodFor(st) {
  return st?.snapshot ? L.makeMood(st.snapshot) : L.PLACEHOLDER_MOOD;
}

// ---------- Построение страниц ----------

function buildPages(focusId) {
  const list = pageList();
  for (const id of [...states.keys()]) if (!list.some((p) => p.id === id)) states.delete(id);
  pagesEl.innerHTML = '';
  for (const p of list) {
    const st = stateFor(p);
    const sec = document.createElement('section');
    sec.className = 'page';
    sec.dataset.id = p.id;
    sec.innerHTML = '<div class="page-inner"></div>';
    st.el = sec;
    pagesEl.appendChild(sec);
    render(st);
  }
  const idx = Math.max(0, list.findIndex((p) => p.id === focusId));
  pagesEl.scrollLeft = idx * pagesEl.clientWidth;
  setActive(idx, true);
}

function renderDots() {
  $('#dots').innerHTML = pageList().map((p, i) => `<span class="${p.current ? 'loc' : ''} ${i === activeIndex ? 'on' : ''}"></span>`).join('');
}

const TIME_ICONS = { morning: '🌅', day: '☀️', evening: '🌇', night: '🌙' };
const SEASON_ICONS = { winter: '❄️', spring: '🌱', summer: '🌻', autumn: '🍂' };

function render(st) {
  const inner = $('.page-inner', st.el);
  const p = st.page;
  const s = st.snapshot;
  const title = st.title ?? p.name;
  const subtitle = st.subtitle ?? p.subtitle;
  let html = `<div class="hero"><div class="place">${p.current ? '<span aria-hidden="true">➤</span> ' : ''}${esc(title)}</div>`;
  if (subtitle) html += `<div class="subtitle">${esc(subtitle)}</div>`;

  if (s) {
    if (st.stale) html += `<div class="stale">📡 Нет связи · данные от ${L.Fmt.time(s.fetchedAt, -new Date().getTimezoneOffset() * 60)}</div>`;
    html += heroWeather(s);
  } else if (st.loading) {
    html += '<div class="loading"><div class="spinner"></div>Загружаю погоду…</div>';
  } else {
    html += `<div class="problem">
      <div class="big">${st.locationDenied ? '📍' : '⚠️'}</div>
      <div>${esc(st.error ?? 'Не удалось загрузить погоду')}</div>
      ${st.locationDenied
        ? '<button class="spot-ok" style="background:#0a84ff" data-action="places">Добавить город вручную</button>'
        : '<button class="spot-ok" style="background:#0a84ff" data-action="retry">Повторить</button>'}
    </div>`;
  }
  html += '</div>';
  if (s) html += sections(st);
  inner.innerHTML = html;

  st.tempEl = $('.temp', inner);
  const vaneCanvas = $('canvas.vane', inner);
  st.vane = vaneCanvas ? new Vane(vaneCanvas) : null;
  if (s && st.vane) st.vane.set(s.current.windDir, s.current.windSpeed, s.current.gusts);
  if (s && st.tempEl && st.countStart == null) st.tempEl.textContent = T(st.countedFor === s.fetchedAt ? s.current.temp : -100);
}

function heroWeather(s) {
  const c = s.current;
  const d = L.today(s);
  const m = L.makeMood(s);
  const cond = L.condition(c.code);
  const precipIcon = m.precipitation === 'none' ? '💧' : L.weatherIcon(c.code, c.isDay);
  const sun = d && d.sunrise && d.sunset
    ? `<div class="sun">🌅 Восход ${L.Fmt.time(d.sunrise, s.offset)}<br>🌇 Закат ${L.Fmt.time(d.sunset, s.offset)}<small>Световой день ${L.Fmt.duration(d.sunset - d.sunrise)}</small></div>`
    : '<div></div>';
  return `
    <div class="temp" aria-label="Температура ${T(c.temp)}">${T(c.temp)}</div>
    <div class="cond">${esc(cond.description)}</div>
    <div class="feels"><span>Ощущается ${T(c.apparent)}</span>${d ? `<span>↑${T(d.max)} ↓${T(d.min)}</span>` : ''}</div>
    <div class="chips">
      <div class="chip">${TIME_ICONS[m.timeOfDay]} ${L.TIME_TITLES[m.timeOfDay]}</div>
      <div class="chip">${SEASON_ICONS[m.season]} ${L.SEASON_TITLES[m.season]}</div>
      <div class="chip">🌬️ Ветер: ${L.WIND_TITLES[m.wind].toLowerCase()}</div>
      <div class="chip">${precipIcon} ${L.PRECIP_TITLES[m.precipitation]}</div>
    </div>
    <div class="hero-bottom">
      ${sun}
      <div class="vane-wrap">
        <canvas class="vane" width="120" height="120" aria-label="Ветер ${L.Units.windName(c.windDir)}, ${N(c.windSpeed)} метров в секунду"></canvas>
        <b>${N(c.windSpeed)} м/с, ${L.Units.compass(c.windDir)}</b>
        <small>порывы до ${N(c.gusts)} м/с</small>
      </div>
    </div>`;
}

function alertPeriod(a, s) {
  const k = L.dayKey(now(), s.offset);
  const sk = L.dayKey(a.start, s.offset);
  const ek = L.dayKey(a.end, s.offset);
  const start = sk === k ? 'Сегодня' : sk === k + 1 ? 'Завтра' : L.Fmt.dayMonth(a.start, s.offset);
  return sk === ek ? start : `С ${L.Fmt.shortDayMonth(a.start, s.offset)} по ${L.Fmt.shortDayMonth(a.end, s.offset)}`;
}

function sections(st) {
  const s = st.snapshot;
  const c = s.current;
  const d = L.today(s);
  let html = '';

  if (st.alerts.length) {
    html += `<button class="card" data-action="alerts"><div class="card-title">⚠️ Предупреждения</div>
      ${st.alerts.slice(0, 3).map((a) => `<div class="alert-row"><span class="ic">${L.ALERT_ICONS[a.kind]}</span>
        <div><b class="sev-${a.severity}">${esc(a.title)}</b><small>${alertPeriod(a, s)}</small></div></div>`).join('')}
      ${st.alerts.length > 3 ? `<div class="note">и ещё ${st.alerts.length - 3}…</div>` : ''}</button>`;
  }

  const advice = L.clothing(c, d, st.climate);
  html += `<div class="card"><div class="card-title">👕 Что надеть</div><div class="headline">${esc(advice.headline)}</div>
    ${advice.items.map((i) => `<div class="row"><span class="ic">${i.icon}</span><span>${esc(i.text)}</span></div>`).join('')}
    ${advice.notes.map((n) => `<div class="note">${esc(n)}</div>`).join('')}</div>`;

  html += `<div class="grid">${detailTiles(s, c, d).map(([t, v, sub]) => `<div class="tile"><div class="card-title">${t}</div><div class="value">${v}</div><div class="sub">${sub}</div></div>`).join('')}</div>`;

  const hours = s.hourly.filter((h) => h.time > now() - 3600).slice(0, 25);
  html += `<div class="card"><div class="card-title">🕒 По часам</div><div class="hours">
    ${hours.map((h, i) => {
      const day = L.dayOf(s, h.time);
      const isDay = !day?.sunrise || (h.time >= day.sunrise && h.time <= day.sunset);
      return `<div class="hour"><span class="h">${i === 0 ? 'Сейчас' : L.Fmt.hour(h.time, s.offset)}</span><span class="i">${L.weatherIcon(h.code, isDay)}</span>
        <span class="p">${(h.prob ?? 0) >= 20 ? `${Math.round(h.prob)}%` : ''}</span><span class="t">${T(h.temp)}</span></div>`;
    }).join('')}</div></div>`;

  const lo = Math.min(...s.daily.map((x) => x.min));
  const hi = Math.max(...s.daily.map((x) => x.max));
  const span = Math.max(hi - lo, 1);
  const todayKey = L.dayKey(c.time, s.offset);
  html += `<div class="card"><div class="card-title">📅 Прогноз на ${s.daily.length} дней</div>
    ${s.daily.map((x) => `<div class="day">
      <div class="day-main">
        <span class="wd">${L.dayKey(x.date, s.offset) === todayKey ? 'Сегодня' : L.Fmt.weekday(x.date, s.offset)}</span>
        <span class="ic">${L.weatherIcon(x.code)}${(x.probMax ?? 0) >= 20 ? `<small>${Math.round(x.probMax)}%</small>` : ''}</span>
        <span class="lo">${T(x.min)}</span>
        <span class="bar"><i style="left:${((x.min - lo) / span) * 100}%;width:${Math.max(((x.max - x.min) / span) * 100, 4)}%;background:linear-gradient(90deg,${tempColor(x.min)},${tempColor(x.max)})"></i></span>
        <span>${T(x.max)}</span>
      </div>
      <div class="day-sub"><span>${L.Fmt.shortDayMonth(x.date, s.offset)}</span><span>🌬️ ${N(x.windMax, 0)}–${N(x.gustMax, 0)} м/с</span>
        ${x.precipSum >= 0.1 ? `<span>💧 ${N(x.precipSum)} мм</span>` : ''}${x.snowSum >= 0.1 ? `<span>❄️ ${N(x.snowSum)} см</span>` : ''}</div>
    </div>`).join('')}</div>`;

  const cl = st.climate;
  let hist;
  if (cl && cl.years.length) {
    hist = `${cl.averageMax != null ? `<div class="headline" style="font-size:17px">Обычно днём ${T(cl.averageMax)}, ночью ${T(cl.averageMin)}</div>` : ''}
      <div class="note">🔥 ${T(cl.recordHigh.value)} в ${cl.recordHigh.year} &nbsp; 🥶 ${T(cl.recordLow.value)} в ${cl.recordLow.year}</div>
      <div class="link"><span>Все ${cl.years.length} лет наблюдений</span><span>›</span></div>`;
  } else if (st.historyLoading) {
    hist = '<div class="note">⏳ Загружаю архив за 30 лет…</div>';
  } else {
    hist = `<div class="note">${esc(st.historyError ?? 'Посмотреть, какой была погода в этот день за 30 лет')}</div>`;
  }
  html += `<button class="card" data-action="history"><div class="card-title">🕰️ Этот день в истории</div>${hist}</button>`;

  html += `<div class="footer">Обновлено в ${L.Fmt.time(s.fetchedAt, -new Date().getTimezoneOffset() * 60)} · кнопка ↻ вверху обновляет<br>
    <a href="https://open-meteo.com" target="_blank" rel="noopener">Данные: Open-Meteo.com (CC BY 4.0)</a></div>`;
  return html;
}

function detailTiles(s, c, d) {
  const hum = c.humidity < 30 ? 'Сухо' : c.humidity < 60 ? 'Комфортно' : c.humidity < 80 ? 'Влажно' : 'Очень влажно';
  const pts = s.hourly.filter((h) => h.time >= c.time - 3600);
  let trend = '—';
  if (pts[0]?.pressure != null && pts[3]?.pressure != null) {
    const delta = L.Units.mmHg(pts[3].pressure - pts[0].pressure);
    trend = delta > 0.7 ? '↑ растёт' : delta < -0.7 ? '↓ падает' : 'стабильно';
  }
  const station = L.Units.mmHg(c.pressureSurface ?? c.pressureMsl);
  const uvWord = d?.uv == null ? '' : d.uv < 3 ? 'Низкий' : d.uv < 6 ? 'Умеренный' : d.uv < 8 ? 'Высокий' : d.uv < 11 ? 'Очень высокий' : 'Экстремальный';
  const precipParts = d ? [`За сутки ${N(d.precipSum)} мм`] : [];
  if (d?.snowSum > 0) precipParts.push(`снег ${N(d.snowSum)} см`);
  if (d?.probMax != null) precipParts.push(`вероятность ${Math.round(d.probMax)}%`);
  if (d && L.condition(d.code).precipitation === 'hail') precipParts.push('возможен град');
  const windName = L.Units.windName(c.windDir);
  return [
    ['🌡️ Ощущается', T(c.apparent), `Фактически ${T(c.temp)}`],
    ['💦 Влажность', `${Math.round(c.humidity)}%`, hum],
    ['🌬️ Ветер', `${N(c.windSpeed)} м/с`, `${windName[0].toUpperCase()}${windName.slice(1)}, ${L.WIND_TITLES[L.windLevel(c.windSpeed, c.gusts)].toLowerCase()}`],
    ['🌪️ Порывы', `${N(c.gusts)} м/с`, d ? `Сегодня до ${N(d.gustMax)} м/с` : ''],
    ['⏲️ Давление', `${Math.round(station)} мм`, `${trend} · у моря ${Math.round(L.Units.mmHg(c.pressureMsl))}`],
    ['💧 Осадки', c.snowfall > 0 ? `${N(c.snowfall)} см` : `${N(c.precip)} мм`, precipParts.join(', ')],
    ['☁️ Облачность', `${Math.round(c.cloud)}%`, L.condition(c.code).description],
    ['😎 УФ-индекс', d?.uv != null ? N(d.uv, 0) : '—', uvWord],
  ];
}

function tempColor(t) {
  const stops = [[-30, [140, 89, 242]], [-15, [77, 128, 255]], [0, [89, 217, 255]], [10, [115, 230, 128]], [20, [255, 217, 77]], [30, [255, 140, 51]], [40, [242, 51, 51]]];
  if (t <= stops[0][0]) return `rgb(${stops[0][1]})`;
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i][0]) {
      const [t0, a] = stops[i - 1], [t1, b] = stops[i];
      const k = (t - t0) / (t1 - t0);
      return `rgb(${a.map((v, j) => Math.round(v + (b[j] - v) * k))})`;
    }
  }
  return `rgb(${stops[stops.length - 1][1]})`;
}

// ---------- Загрузка ----------

function getPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) { reject({ code: 2 }); return; }
    navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: false, timeout: 15000, maximumAge: 600000 });
  });
}

function applyDemo(snap) {
  if (!DEMO) return snap;
  const code = { rain: 65, snow: 75, hail: 99, storm: 95, sleet: 67 }[DEMO] ?? 63;
  Object.assign(snap.current, { code, precip: 3, windSpeed: 9, gusts: 17, windDir: 250 });
  if (DEMO === 'snow') Object.assign(snap.current, { temp: -6, apparent: -12, snowfall: 1 });
  if (snap.daily[0]) Object.assign(snap.daily[0], { gustMax: 27, code });
  return snap;
}

async function load(st, force = false) {
  if (st.loading) return;
  if (!force && st.snapshot && !st.stale && now() - st.loadedAt < 15 * 60) return;
  st.loading = true;
  st.error = null;
  if (!st.snapshot) render(st);
  syncRefreshButton();
  try {
    if (st.page.current) {
      try {
        const pos = await getPosition();
        st.lat = pos.coords.latitude; st.lon = pos.coords.longitude; st.locationDenied = false;
      } catch (e) {
        if (e.code === 1) {
          st.locationDenied = true;
          throw new Error('Нет доступа к геопозиции. На iPhone: Настройки → Конфиденциальность → Службы геолокации → Safari / Погодка → «При использовании». Или добавьте город вручную.');
        }
        throw new Error('Не удалось определить местоположение.');
      }
    }
    const [res, name] = await Promise.all([
      API.loadForecast(st.lat, st.lon),
      st.page.current ? API.placeName(st.lat, st.lon) : Promise.resolve(null),
    ]);
    if (name) { st.title = name; st.subtitle = 'Моё местоположение'; }
    st.snapshot = applyDemo(res.snapshot);
    st.stale = res.stale;
    st.error = res.error ?? null;
    st.alerts = L.alerts(st.snapshot);
    st.headline = L.headlineAlert(st.alerts, st.snapshot);
    updateClimate(st);
    if (!res.stale) st.loadedAt = now();
  } catch (e) {
    st.error = e.message || 'Не удалось загрузить погоду';
  } finally {
    st.loading = false;
    render(st);
    syncRefreshButton();
    if (st === activeState()) activate(st);
  }
  loadHistory(st);
}

async function loadHistory(st) {
  if (st.history || st.historyLoading || st.lat == null) return;
  st.historyLoading = true;
  st.historyError = null;
  try {
    st.history = await API.loadHistory(st.lat, st.lon);
    updateClimate(st);
  } catch (e) {
    st.historyError = `Архив не загрузился: ${e.message}`;
  } finally {
    st.historyLoading = false;
    if (st.snapshot) render(st);
    if (historyOpenFor === st) renderHistory(st);
  }
}

function updateClimate(st) {
  if (!st.history || !st.snapshot) return;
  const d = L.localDate(now(), st.snapshot.offset);
  st.climate = L.climate(d.getUTCMonth() + 1, d.getUTCDate(), st.history);
}

// ---------- Активная страница ----------

function setActive(i, force = false) {
  if (i === activeIndex && !force) return;
  activeIndex = i;
  renderDots();
  const st = activeState();
  if (!st) return;
  activate(st);
  load(st);
}

function activate(st) {
  scene.setMood(moodFor(st));
  const s = st.snapshot;
  if (s && st.countedFor !== s.fetchedAt) {
    st.countedFor = s.fetchedAt;
    st.countStart = REDUCE_MOTION ? null : performance.now();
  }
  updateBadge(st);
  maybeSpotlight(st);
}

pagesEl.addEventListener('scroll', () => {
  const i = Math.round(pagesEl.scrollLeft / pagesEl.clientWidth);
  if (i !== activeIndex && i >= 0 && i < pageList().length) setActive(i);
}, { passive: true });

window.addEventListener('resize', () => { pagesEl.scrollLeft = activeIndex * pagesEl.clientWidth; });

// ---------- Анимационный цикл ----------

function loop(t) {
  scene.frame(t);
  const st = activeState();
  if (st?.vane && !REDUCE_MOTION) st.vane.frame(t);
  if (st?.countStart != null && st.tempEl && st.snapshot) {
    const target = st.snapshot.current.temp;
    const p = Math.min(1, (t - st.countStart) / 2600);
    const eased = 1 - (1 - p) ** 4; // сильное торможение у цели
    st.tempEl.textContent = T(-100 + (target + 100) * eased);
    if (p >= 1) { st.countStart = null; st.tempEl.textContent = T(target); }
  }
  requestAnimationFrame(loop);
}
requestAnimationFrame((t) => {
  if (REDUCE_MOTION) { /* статичный кадр всё равно рисуем */ }
  loop(t);
});

// Время суток на сцене меняется — раз в минуту пересчитываем.
setInterval(() => { const st = activeState(); if (st) scene.setMood(moodFor(st)); }, 60000);

// ---------- Предупреждения: значок и показ на весь экран ----------

function updateBadge(st) {
  const top = st.headline ?? st.alerts[0];
  if (!top || !spotEl.hidden) { badgeEl.hidden = true; return; }
  const color = { 1: 'var(--advisory)', 2: 'var(--warning)', 3: 'var(--danger)' }[top.severity];
  badgeEl.style.background = color;
  badgeEl.style.setProperty('--badge-color', color);
  badgeEl.style.setProperty('--badge-glow', color);
  badgeEl.innerHTML = `<span>${L.ALERT_ICONS[top.kind]}</span>${st.alerts.length > 1 ? `<span>${st.alerts.length}</span>` : ''}`;
  badgeEl.dataset.severity = top.severity;
  badgeEl.hidden = false;
}

// Значок напоминает о себе раз в 25 секунд.
setInterval(() => {
  if (badgeEl.hidden || REDUCE_MOTION || Number(badgeEl.dataset.severity) < 2) return;
  badgeEl.classList.remove('remind');
  void badgeEl.offsetWidth;
  badgeEl.classList.add('remind');
}, 25000);

function spotlightSeen() {
  try { return new Set(JSON.parse(sessionStorage.getItem('spotlighted') || '[]')); } catch { return new Set(); }
}

let spotTimer = null;
function maybeSpotlight(st) {
  const h = st.headline;
  if (!h) return;
  const seen = spotlightSeen();
  if (seen.has(h.id)) return;
  seen.add(h.id);
  try { sessionStorage.setItem('spotlighted', JSON.stringify([...seen])); } catch { /* ничего */ }
  setTimeout(() => {
    if (activeState() !== st) return;
    const color = { 2: 'var(--warning)', 3: 'var(--danger)' }[h.severity];
    spotEl.style.setProperty('--spot-color', color);
    spotEl.innerHTML = `<div class="spot-card">
      <div class="spot-icon">${L.ALERT_ICONS[h.kind]}</div>
      <div class="spot-sev" style="color:${color}">${L.SEVERITY_TITLES[h.severity].toUpperCase()}</div>
      <div class="spot-title">${esc(h.title)}</div>
      <div class="spot-when">${alertPeriod(h, st.snapshot)}</div>
      <div class="spot-msg">${esc(h.message)}</div>
      <button class="spot-ok" style="background:${color}">Понятно</button></div>`;
    spotEl.classList.remove('leaving');
    spotEl.hidden = false;
    badgeEl.hidden = true;
    navigator.vibrate?.([200, 100, 200]);
    clearTimeout(spotTimer);
    spotTimer = setTimeout(collapseSpotlight, 6000);
  }, 1200); // пусть сначала «досчитает» температура
}

function collapseSpotlight() {
  if (spotEl.hidden || spotEl.classList.contains('leaving')) return;
  clearTimeout(spotTimer);
  spotEl.classList.add('leaving');
  setTimeout(() => {
    spotEl.hidden = true;
    spotEl.classList.remove('leaving');
    const st = activeState();
    if (st) updateBadge(st);
  }, 550);
}
spotEl.addEventListener('click', collapseSpotlight);

// ---------- Листы ----------

let historyOpenFor = null;

function openSheet(title, html) {
  $('#sheetTitle').textContent = title;
  $('#sheetBody').innerHTML = html;
  $('#sheet').hidden = false;
}
function closeSheet() {
  $('#sheet').hidden = true;
  $('#sheetBody').innerHTML = '';
  historyOpenFor = null;
}
$('#sheetClose').addEventListener('click', closeSheet);
$('#sheet').addEventListener('click', (e) => { if (e.target.id === 'sheet') closeSheet(); });

// --- Предупреждения

function openAlerts(st) {
  const s = st.snapshot;
  openSheet('Предупреждения', `${st.alerts.map((a) => `
    <div class="list" style="margin-top:10px"><div class="list-item" style="cursor:default;align-items:flex-start">
      <span style="font-size:26px">${L.ALERT_ICONS[a.kind]}</span>
      <div class="grow"><div class="sev-${a.severity}" style="font-size:11px;font-weight:800;letter-spacing:.1em">${L.SEVERITY_TITLES[a.severity].toUpperCase()}</div>
        <b>${esc(a.title)}</b><small>${alertPeriod(a, s)}</small><div style="margin-top:4px">${esc(a.message)}</div></div>
    </div></div>`).join('')}
    <p class="small">Предупреждения рассчитывает само приложение по прогнозу Open-Meteo, ориентируясь на критерии Росгидромета. Это не официальные предупреждения МЧС.</p>`);
}

// --- Места

function openPlaces() {
  openSheet('Места', `<input class="search" type="search" placeholder="Город или населённый пункт" autocomplete="off" autocorrect="off" enterkeyhint="search">
    <div id="placesContent"></div>`);
  const input = $('#sheetBody .search');
  renderMyPlaces();
  let timer = null, seq = 0;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < 2) { renderMyPlaces(); return; }
    timer = setTimeout(async () => {
      const my = ++seq;
      $('#placesContent').innerHTML = '<div class="section-label">Результаты поиска</div><div class="hint">Ищу…</div>';
      try {
        const found = await API.searchPlaces(q);
        if (my !== seq) return;
        renderResults(found);
      } catch {
        if (my === seq) $('#placesContent').innerHTML = '<div class="hint">Не удалось выполнить поиск. Проверьте интернет.</div>';
      }
    }, 350);
  });
}

function renderMyPlaces() {
  const el = $('#placesContent');
  if (!el) return;
  el.innerHTML = `<div class="section-label">Мои места</div><div class="list">
    <div class="list-item" data-go="current"><span>➤</span><div class="grow">Моё местоположение</div></div>
    ${places.map((p, i) => `<div class="list-item" data-go="${esc(p.id)}">
      <div class="grow">${esc(p.name)}<small>${esc(p.subtitle)}</small></div>
      ${i > 0 ? `<button class="act" data-up="${i}" aria-label="Выше">↑</button>` : ''}
      <button class="act" data-del="${i}" aria-label="Удалить">✕</button></div>`).join('')}
    </div><div class="hint">Найдите город или посёлок через поиск. Между местами можно листать свайпом.</div>`;
}

let lastResults = [];
function renderResults(found) {
  lastResults = found;
  $('#placesContent').innerHTML = `<div class="section-label">Результаты поиска</div>${found.length
    ? `<div class="list">${found.map((p, i) => `<div class="list-item" data-add="${i}"><div class="grow">${esc(p.name)}<small>${esc(p.subtitle)}</small></div><span class="add">＋</span></div>`).join('')}</div>`
    : '<div class="hint">Ничего не найдено</div>'}`;
}

$('#sheetBody').addEventListener('click', (e) => {
  const up = e.target.closest('[data-up]');
  const del = e.target.closest('[data-del]');
  const add = e.target.closest('[data-add]');
  const go = e.target.closest('[data-go]');
  const activeId = pageList()[activeIndex]?.id;
  if (up) {
    const i = Number(up.dataset.up);
    [places[i - 1], places[i]] = [places[i], places[i - 1]];
    writePlaces(); buildPages(activeId); renderMyPlaces();
  } else if (del) {
    places.splice(Number(del.dataset.del), 1);
    writePlaces(); buildPages(pageList().some((p) => p.id === activeId) ? activeId : 'current'); renderMyPlaces();
  } else if (add) {
    const p = lastResults[Number(add.dataset.add)];
    const key = API.cacheKey(p.lat, p.lon);
    let existing = places.find((x) => API.cacheKey(x.lat, x.lon) === key);
    if (!existing) {
      existing = { id: `p${Date.now()}`, name: p.name, subtitle: p.subtitle, lat: p.lat, lon: p.lon };
      places.push(existing);
      writePlaces();
    }
    closeSheet(); buildPages(existing.id);
  } else if (go) {
    closeSheet();
    const idx = pageList().findIndex((p) => p.id === go.dataset.go);
    pagesEl.scrollTo({ left: idx * pagesEl.clientWidth, behavior: 'smooth' });
  }
});

// --- История

function openHistory(st) {
  historyOpenFor = st;
  const s = st.snapshot;
  const d = L.localDate(now(), s?.offset ?? 0);
  const iso = d.toISOString().slice(0, 10);
  openSheet(st.title ?? st.page.name, `<div class="date-row"><span>День</span><input type="date" id="histDate" value="${iso}"></div><div id="histContent"></div>`);
  $('#histDate').addEventListener('change', () => renderHistory(st));
  renderHistory(st);
  loadHistory(st);
}

function renderHistory(st) {
  const el = $('#histContent');
  if (!el) return;
  if (!st.history) {
    el.innerHTML = st.historyLoading || !st.historyError
      ? '<div class="loading" style="text-align:center;margin-top:40px"><div class="spinner"></div>Загружаю архив за 30 лет…</div>'
      : `<p>${esc(st.historyError)}</p>`;
    return;
  }
  const value = $('#histDate').value || new Date().toISOString().slice(0, 10);
  const [year, month, day] = value.split('-').map(Number);
  const c = L.climate(month, day, st.history);
  if (!c.years.length) { el.innerHTML = '<p>Нет данных за этот день.</p>'; return; }
  const s = st.snapshot;
  const f = s?.daily.find((x) => { const d = L.localDate(x.date, s.offset); return d.getUTCFullYear() === year && d.getUTCMonth() + 1 === month && d.getUTCDate() === day; });
  const rec = (r, fmt) => (r ? `${fmt(r.value)} (${r.year})` : '—');
  const pct = (v) => (v == null ? '—' : `${Math.round(v * 100)}% лет`);
  let html = `<h3 style="margin:16px 0 4px">${L.Fmt.monthDay(month, day)} · ${c.yearSpan[0]}–${c.yearSpan[1]}</h3>
    <div class="stats">
      <div><small>Средний максимум</small><b>${c.averageMax != null ? T(c.averageMax) : '—'}</b></div>
      <div><small>Средний минимум</small><b>${c.averageMin != null ? T(c.averageMin) : '—'}</b></div>
      <div><small>Рекорд тепла</small><b>${rec(c.recordHigh, T)}</b></div>
      <div><small>Рекорд холода</small><b>${rec(c.recordLow, T)}</b></div>
      <div><small>Дни с осадками</small><b>${pct(c.wetDaysShare)}</b></div>
      <div><small>Средние осадки</small><b>${c.averagePrecipitation != null ? `${N(c.averagePrecipitation)} мм` : '—'}</b></div>
      <div><small>Снег выпадал</small><b>${pct(c.snowDaysShare)}</b></div>
      <div><small>Сильнейший порыв</small><b>${rec(c.strongestGust, (v) => `${N(v, 0)} м/с`)}</b></div>
      <div><small>Давление у моря</small><b>${c.averagePressureMmHg != null ? `${Math.round(c.averagePressureMmHg)} мм рт. ст.` : '—'}</b></div>
      <div><small>Влажность</small><b>${c.averageHumidity != null ? `${Math.round(c.averageHumidity)}%` : '—'}</b></div>
    </div>`;
  if (c.trendPerDecade != null) {
    const up = c.trendPerDecade >= 0;
    html += `<div class="trend" style="color:${up ? '#ff9f0a' : 'var(--cyan)'}">${up ? '↗' : '↘'} Тренд: ${up ? '+' : '−'}${N(Math.abs(c.trendPerDecade))}° за 10 лет</div>`;
  }
  if (f && c.averageMax != null) {
    const diff = f.max - c.averageMax;
    html += `<p>Прогноз на этот день: ${T(f.max)} / ${T(f.min)} — ${Math.abs(diff) < 1.5 ? 'около нормы.' : `на ${N(Math.abs(diff), 0)}° ${diff > 0 ? 'теплее' : 'холоднее'} нормы.`}</p>`;
  }
  html += `<h3 style="margin:16px 0 0">Минимум и максимум по годам</h3><canvas class="chart" id="histChart"></canvas>
    <h3 style="margin:8px 0">По годам</h3>
    <table class="table"><tr><th>Год</th><th>Макс / мин</th><th>Осадки</th><th>Порывы</th></tr>
    ${c.years.map((y) => `<tr><td>${y.year}</td>
      <td><span style="color:${tempColor(y.max ?? 0)}">${y.max != null ? T(y.max) : '—'}</span> / <span style="color:${tempColor(y.min ?? 0)}">${y.min != null ? T(y.min) : '—'}</span></td>
      <td>${y.snow != null && y.snow >= 0.5 ? `❄︎ ${N(y.snow)} см` : y.precip != null && y.precip >= 0.1 ? `${N(y.precip)} мм` : '—'}</td>
      <td>${y.gust != null ? `${N(y.gust, 0)} м/с` : '—'}</td></tr>`).join('')}</table>
    <p class="small">Источник: реанализ ERA5 (Copernicus/ECMWF) через Open-Meteo. Это восстановленные по наблюдениям метеостанций, спутников и зондов данные на сетке ~10–25 км, а не показания одной конкретной станции.</p>`;
  el.innerHTML = html;
  drawChart($('#histChart'), c, f, year);
}

function drawChart(canvas, c, forecast, year) {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const w = canvas.clientWidth, h = canvas.clientHeight;
  canvas.width = w * dpr; canvas.height = h * dpr;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const pad = { l: 16, r: 40, t: 18, b: 22 };
  const [y0, y1] = c.yearSpan;
  const xMin = y0 - 1, xMax = Math.max(y1, forecast ? year : y1) + 1;
  const temps = c.years.flatMap((y) => [y.max, y.min]).filter((v) => v != null);
  if (forecast) temps.push(forecast.max, forecast.min);
  const tMin = Math.floor((Math.min(...temps) - 2) / 5) * 5, tMax = Math.ceil((Math.max(...temps) + 2) / 5) * 5;
  const X = (v) => pad.l + ((v - xMin) / (xMax - xMin)) * (w - pad.l - pad.r);
  const Y = (v) => pad.t + (1 - (v - tMin) / (tMax - tMin)) * (h - pad.t - pad.b);

  ctx.font = '11px -apple-system, system-ui, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.lineWidth = 1;
  const step = tMax - tMin > 30 ? 10 : 5;
  for (let v = tMin; v <= tMax; v += step) {
    ctx.beginPath(); ctx.moveTo(pad.l, Y(v)); ctx.lineTo(w - pad.r, Y(v)); ctx.stroke();
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(T(v), w - pad.r + 6, Y(v));
  }
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  for (let v = Math.ceil(xMin / 5) * 5; v <= xMax; v += 5) ctx.fillText(String(v), X(v), h - pad.b + 6);

  const bar = (yr, mx, mn, color) => {
    const g = ctx.createLinearGradient(0, Y(mn), 0, Y(mx));
    g.addColorStop(0, color ?? tempColor(mn)); g.addColorStop(1, color ?? tempColor(mx));
    ctx.strokeStyle = g; ctx.lineWidth = 6; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(X(yr), Y(mn)); ctx.lineTo(X(yr), Y(mx) - 0.01); ctx.stroke();
  };
  for (const y of c.years) if (y.max != null && y.min != null) bar(y.year, y.max, y.min);
  if (forecast) {
    bar(year, forecast.max, forecast.min, '#fff');
    ctx.fillStyle = '#fff'; ctx.textBaseline = 'bottom'; ctx.fillText('прогноз', Math.min(X(year), w - pad.r - 22), Y(forecast.max) - 6);
  }
  ctx.setLineDash([4, 3]); ctx.lineWidth = 1;
  if (c.averageMax != null) { ctx.strokeStyle = 'rgba(255,159,10,.75)'; ctx.beginPath(); ctx.moveTo(pad.l, Y(c.averageMax)); ctx.lineTo(w - pad.r, Y(c.averageMax)); ctx.stroke(); }
  if (c.averageMin != null) { ctx.strokeStyle = 'rgba(100,210,255,.75)'; ctx.beginPath(); ctx.moveTo(pad.l, Y(c.averageMin)); ctx.lineTo(w - pad.r, Y(c.averageMin)); ctx.stroke(); }
  ctx.setLineDash([]);
}

// ---------- Кнопки и действия ----------

pagesEl.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const st = states.get(btn.closest('.page').dataset.id);
  const action = btn.dataset.action;
  if (action === 'alerts') openAlerts(st);
  else if (action === 'history') openHistory(st);
  else if (action === 'retry') load(st, true);
  else if (action === 'places') openPlaces();
});

$('#placesBtn').addEventListener('click', openPlaces);
badgeEl.addEventListener('click', () => { const st = activeState(); if (st?.alerts.length) openAlerts(st); });
$('#refreshBtn').addEventListener('click', () => { const st = activeState(); if (st) load(st, true); });

function syncRefreshButton() {
  $('#refreshBtn').classList.toggle('spinning', [...states.values()].some((s) => s.loading));
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') { const st = activeState(); if (st) load(st); }
});

// ---------- Старт ----------

buildPages('current');

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js').catch(() => { /* офлайн-кэш необязателен */ });
}
