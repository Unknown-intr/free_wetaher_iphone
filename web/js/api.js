// Open-Meteo: прогноз, архив ERA5 и поиск мест. Бесплатно, без ключа, некоммерческое использование.

const HISTORY_YEARS = 30;
const fix4 = (v) => Number(v).toFixed(4);

export const cacheKey = (lat, lon) => `${Number(lat).toFixed(2)}_${Number(lon).toFixed(2)}`;

export function forecastURL(lat, lon) {
  const p = new URLSearchParams({
    latitude: fix4(lat),
    longitude: fix4(lon),
    current: 'temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,rain,showers,snowfall,weather_code,cloud_cover,pressure_msl,surface_pressure,wind_speed_10m,wind_direction_10m,wind_gusts_10m',
    hourly: 'temperature_2m,precipitation_probability,precipitation,weather_code,wind_speed_10m,wind_gusts_10m,pressure_msl',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,apparent_temperature_max,apparent_temperature_min,sunrise,sunset,precipitation_sum,rain_sum,snowfall_sum,precipitation_probability_max,wind_speed_10m_max,wind_gusts_10m_max,wind_direction_10m_dominant,uv_index_max',
    wind_speed_unit: 'ms',
    timezone: 'auto',
    timeformat: 'unixtime',
    forecast_days: '7',
  });
  return `https://api.open-meteo.com/v1/forecast?${p}`;
}

export function historyURL(lat, lon, now = new Date()) {
  const year = now.getUTCFullYear();
  const end = new Date(now.getTime() - 7 * 86400 * 1000); // архив запаздывает примерно на 5 дней
  const p = new URLSearchParams({
    latitude: fix4(lat),
    longitude: fix4(lon),
    start_date: `${year - HISTORY_YEARS}-01-01`,
    end_date: end.toISOString().slice(0, 10),
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,temperature_2m_mean,precipitation_sum,snowfall_sum,wind_speed_10m_max,wind_gusts_10m_max,pressure_msl_mean,relative_humidity_2m_mean',
    wind_speed_unit: 'ms',
    timezone: 'auto',
  });
  return `https://archive-api.open-meteo.com/v1/archive?${p}`;
}

export function searchURL(q) {
  const p = new URLSearchParams({ name: q, count: '15', language: 'ru', format: 'json' });
  return `https://geocoding-api.open-meteo.com/v1/search?${p}`;
}

export function parseForecast(j, lat, lon, fetchedAt = Date.now() / 1000) {
  const c = j.current;
  const h = j.hourly ?? {};
  const d = j.daily ?? {};
  const at = (arr, i) => (arr ? arr[i] ?? null : null);
  const hourly = [];
  (h.time ?? []).forEach((time, i) => {
    const temp = at(h.temperature_2m, i);
    if (temp == null) return;
    hourly.push({
      time, temp,
      prob: at(h.precipitation_probability, i),
      precip: at(h.precipitation, i) ?? 0,
      code: at(h.weather_code, i) ?? 0,
      wind: at(h.wind_speed_10m, i) ?? 0,
      gusts: at(h.wind_gusts_10m, i) ?? 0,
      pressure: at(h.pressure_msl, i),
    });
  });
  const daily = [];
  (d.time ?? []).forEach((date, i) => {
    const max = at(d.temperature_2m_max, i), min = at(d.temperature_2m_min, i);
    if (max == null || min == null) return;
    daily.push({
      date, max, min,
      code: at(d.weather_code, i) ?? 0,
      appMax: at(d.apparent_temperature_max, i) ?? max,
      appMin: at(d.apparent_temperature_min, i) ?? min,
      sunrise: at(d.sunrise, i),
      sunset: at(d.sunset, i),
      precipSum: at(d.precipitation_sum, i) ?? 0,
      rainSum: at(d.rain_sum, i) ?? 0,
      snowSum: at(d.snowfall_sum, i) ?? 0,
      probMax: at(d.precipitation_probability_max, i),
      windMax: at(d.wind_speed_10m_max, i) ?? 0,
      gustMax: at(d.wind_gusts_10m_max, i) ?? 0,
      windDir: at(d.wind_direction_10m_dominant, i),
      uv: at(d.uv_index_max, i),
    });
  });
  return {
    lat, lon,
    tz: j.timezone,
    offset: j.utc_offset_seconds ?? 0,
    fetchedAt,
    current: {
      time: c.time,
      temp: c.temperature_2m,
      apparent: c.apparent_temperature ?? c.temperature_2m,
      humidity: c.relative_humidity_2m ?? 0,
      isDay: (c.is_day ?? 1) === 1,
      precip: c.precipitation ?? 0,
      rain: c.rain ?? 0,
      showers: c.showers ?? 0,
      snowfall: c.snowfall ?? 0,
      code: c.weather_code ?? 0,
      cloud: c.cloud_cover ?? 0,
      pressureMsl: c.pressure_msl ?? 1013.25,
      pressureSurface: c.surface_pressure ?? null,
      windSpeed: c.wind_speed_10m ?? 0,
      windDir: c.wind_direction_10m ?? 0,
      gusts: c.wind_gusts_10m ?? c.wind_speed_10m ?? 0,
    },
    hourly,
    daily,
  };
}

export function parseHistory(j) {
  const d = j.daily ?? {};
  const at = (arr, i) => (arr ? arr[i] ?? null : null);
  return (d.time ?? []).map((t, i) => {
    const [year, month, day] = t.split('-').map(Number);
    return {
      year, month, day,
      code: at(d.weather_code, i),
      max: at(d.temperature_2m_max, i),
      min: at(d.temperature_2m_min, i),
      mean: at(d.temperature_2m_mean, i),
      precip: at(d.precipitation_sum, i),
      snow: at(d.snowfall_sum, i),
      wind: at(d.wind_speed_10m_max, i),
      gust: at(d.wind_gusts_10m_max, i),
      pressure: at(d.pressure_msl_mean, i),
      humidity: at(d.relative_humidity_2m_mean, i),
    };
  });
}

export function parsePlaces(j) {
  return (j.results ?? []).map((r) => ({
    id: `${r.latitude.toFixed(3)},${r.longitude.toFixed(3)}`,
    name: r.name,
    subtitle: [r.admin1, r.country].filter(Boolean).join(', '),
    lat: r.latitude,
    lon: r.longitude,
  }));
}

async function getJSON(url) {
  const res = await fetch(url);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Сервис погоды ответил ошибкой ${res.status}${body.reason ? `: ${body.reason}` : ''}`);
  return body;
}

// ---------- Кэш (localStorage) ----------

function cacheRead(key, maxAgeSec = Infinity) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const { savedAt, data } = JSON.parse(raw);
    return Date.now() / 1000 - savedAt <= maxAgeSec ? data : null;
  } catch { return null; }
}

function cacheWrite(key, data) {
  try {
    localStorage.setItem(key, JSON.stringify({ savedAt: Date.now() / 1000, data }));
  } catch {
    // Место кончилось — выбрасываем старые архивы и пробуем ещё раз.
    try {
      Object.keys(localStorage).filter((k) => k.startsWith('hd:') || k.startsWith('hist:')).forEach((k) => localStorage.removeItem(k));
      localStorage.setItem(key, JSON.stringify({ savedAt: Date.now() / 1000, data }));
    } catch { /* без кэша тоже работаем */ }
  }
}

/** Прогноз; без сети — последний сохранённый с флагом stale. */
export async function loadForecast(lat, lon) {
  const key = `fc:${cacheKey(lat, lon)}`;
  try {
    const j = await getJSON(forecastURL(lat, lon));
    cacheWrite(key, j);
    return { snapshot: parseForecast(j, lat, lon), stale: false };
  } catch (e) {
    const cached = localStorage.getItem(key) ? JSON.parse(localStorage.getItem(key)) : null;
    if (cached) return { snapshot: parseForecast(cached.data, lat, lon, cached.savedAt), stale: true, error: e.message };
    throw e;
  }
}

/**
 * Даты «этого дня» за последние 30 лет (29 февраля в невисокосные годы → 28-е).
 * Последние ~7 дней в архиве ещё нет — такие даты пропускаем.
 */
export function historyDates(month, day, now = new Date()) {
  const latest = now.getTime() - 7 * 86400 * 1000;
  const year = now.getUTCFullYear();
  const dates = [];
  for (let y = year - HISTORY_YEARS; y <= year; y++) {
    const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
    const d = month === 2 && day === 29 && !leap ? 28 : day;
    if (Date.UTC(y, month - 1, d) > latest) continue;
    dates.push(`${y}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
  }
  return dates.slice(-HISTORY_YEARS);
}

/**
 * Один календарный день за 30 лет. Open-Meteo считает длинный архив как сотни запросов
 * (30 лет одним запросом ≈ 780 из лимита 600 в минуту), поэтому берём по одному дню
 * на каждый год — это 30 «дешёвых» запросов. Кэш 30 дней.
 */
export async function loadDayHistory(lat, lon, month, day) {
  const key = `hd:${cacheKey(lat, lon)}:${month}-${day}`;
  const cached = cacheRead(key, 30 * 86400);
  if (cached) return parseHistory(cached);
  const urls = historyDates(month, day).map((date) => {
    const url = new URL(historyURL(lat, lon));
    url.searchParams.set('start_date', date);
    url.searchParams.set('end_date', date);
    return url.toString();
  });
  // Сервис не любит много одновременных запросов: по 4 за раз, с повтором при отказе.
  const responses = new Array(urls.length);
  let next = 0;
  const worker = async () => {
    while (next < urls.length) {
      const i = next++;
      for (let attempt = 0; ; attempt++) {
        try { responses[i] = await getJSON(urls[i]); break; } catch (e) {
          if (attempt >= 3) throw e;
          await new Promise((r) => setTimeout(r, 700 * (attempt + 1)));
        }
      }
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  // Склеиваем ответы в один ежедневный ряд того же формата, что у архива.
  const daily = {};
  for (const r of responses) {
    for (const [k, v] of Object.entries(r.daily ?? {})) (daily[k] ??= []).push(...v);
  }
  const compact = { daily };
  cacheWrite(key, compact);
  return parseHistory(compact);
}

export async function searchPlaces(q) {
  return parsePlaces(await getJSON(searchURL(q)));
}

/** Название места по координатам (BigDataCloud, бесплатно и без ключа для браузерных приложений). */
export async function placeName(lat, lon) {
  try {
    const p = new URLSearchParams({ latitude: lat, longitude: lon, localityLanguage: 'ru' });
    const j = await getJSON(`https://api.bigdatacloud.net/data/reverse-geocode-client?${p}`);
    return j.city || j.locality || j.principalSubdivision || null;
  } catch { return null; }
}
