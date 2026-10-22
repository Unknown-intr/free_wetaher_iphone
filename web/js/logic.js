// Чистая логика «Погодки»: единицы, коды погоды, сцена, предупреждения, одежда, история.
// Перенесена один в один из нативной версии (Pogodka/Logic/*.swift).
// Все времена — unix-секунды; «местное» время точки = время + offset (сдвиг часового пояса точки).

// ---------- Единицы и форматирование ----------

export const Units = {
  mmHg: (hPa) => hPa * 0.750061683,

  normalized(deg) {
    const r = deg % 360;
    return r < 0 ? r + 360 : r;
  },

  sector(deg) {
    return Math.floor((Units.normalized(deg) + 22.5) / 45) % 8;
  },

  compass: (deg) => ['С', 'СВ', 'В', 'ЮВ', 'Ю', 'ЮЗ', 'З', 'СЗ'][Units.sector(deg)],

  windName: (deg) => ['северный', 'северо-восточный', 'восточный', 'юго-восточный',
    'южный', 'юго-западный', 'западный', 'северо-западный'][Units.sector(deg)],

  /** «+6°», «0°», «−12°» (округление как в Swift: половинки — от нуля). */
  temp(v) {
    const r = Math.sign(v) * Math.round(Math.abs(v));
    if (r > 0) return `+${r}°`;
    if (r < 0) return `−${-r}°`;
    return '0°';
  },

  num(v, digits = 1) {
    return v.toLocaleString('ru-RU', { maximumFractionDigits: digits, minimumFractionDigits: 0 });
  },
};

/** Дата в «местном» времени точки: читать её через getUTC*(). */
export const localDate = (t, offset) => new Date((t + offset) * 1000);
export const dayKey = (t, offset) => Math.floor((t + offset) / 86400);

const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const MONTHS_SHORT = ['янв.', 'февр.', 'мар.', 'апр.', 'мая', 'июн.', 'июл.', 'авг.', 'сент.', 'окт.', 'нояб.', 'дек.'];
const WEEKDAYS = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
const pad = (n) => String(n).padStart(2, '0');

export const Fmt = {
  time: (t, offset) => { const d = localDate(t, offset); return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`; },
  hour: (t, offset) => pad(localDate(t, offset).getUTCHours()),
  weekday: (t, offset) => WEEKDAYS[localDate(t, offset).getUTCDay()],
  dayMonth: (t, offset) => { const d = localDate(t, offset); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`; },
  shortDayMonth: (t, offset) => { const d = localDate(t, offset); return `${d.getUTCDate()} ${MONTHS_SHORT[d.getUTCMonth()]}`; },
  monthDay: (month, day) => `${day} ${MONTHS[month - 1]}`,
  duration(sec) { const m = Math.floor(sec / 60); return `${Math.floor(m / 60)} ч ${m % 60} мин`; },
};

// ---------- Коды погоды WMO ----------

const DESCRIPTIONS = {
  0: 'Ясно', 1: 'Преимущественно ясно', 2: 'Переменная облачность', 3: 'Пасмурно',
  45: 'Туман', 48: 'Туман с изморозью', 51: 'Слабая морось', 53: 'Морось', 55: 'Сильная морось',
  56: 'Слабая ледяная морось', 57: 'Ледяная морось', 61: 'Небольшой дождь', 63: 'Дождь', 65: 'Сильный дождь',
  66: 'Слабый ледяной дождь', 67: 'Ледяной дождь', 71: 'Небольшой снег', 73: 'Снег', 75: 'Сильный снег',
  77: 'Снежная крупа', 80: 'Небольшой ливень', 81: 'Ливень', 82: 'Сильный ливень', 85: 'Снегопад',
  86: 'Сильный снегопад', 95: 'Гроза', 96: 'Гроза с градом', 99: 'Гроза с сильным градом',
};
export const KNOWN_CODES = Object.keys(DESCRIPTIONS).map(Number);

export const PRECIP_TITLES = { none: 'Без осадков', drizzle: 'Морось', rain: 'Дождь', sleet: 'Ледяной дождь', snow: 'Снег', hail: 'Град' };

export function condition(code) {
  const has = (...list) => list.includes(code);
  let precipitation = 'none';
  if (has(51, 53, 55)) precipitation = 'drizzle';
  else if (has(56, 57, 66, 67)) precipitation = 'sleet';
  else if (has(61, 63, 65, 80, 81, 82, 95)) precipitation = 'rain';
  else if (has(71, 73, 75, 77, 85, 86)) precipitation = 'snow';
  else if (has(96, 99)) precipitation = 'hail';

  let intensity = 0;
  if (has(51, 56, 61, 66, 71, 77, 80, 85)) intensity = 0.3;
  else if (has(53, 63, 73, 81, 95, 96)) intensity = 0.6;
  else if (has(55, 57, 65, 67, 75, 82, 86, 99)) intensity = 1;

  let cloudiness;
  if (code === 0) cloudiness = 0;
  else if (code === 1) cloudiness = 0.2;
  else if (code === 2) cloudiness = 0.5;
  else if (has(3, 45, 48)) cloudiness = 0.9;
  else cloudiness = precipitation === 'none' ? 0.5 : 0.95;

  return {
    code,
    description: DESCRIPTIONS[code] ?? '—',
    precipitation,
    intensity,
    cloudiness,
    isThunderstorm: code >= 95 && code <= 99,
    isFreezing: has(56, 57, 66, 67),
    isFog: has(45, 48),
  };
}

export function weatherIcon(code, isDay = true) {
  if (code === 0) return isDay ? '☀️' : '🌙';
  if (code === 1 || code === 2) return isDay ? '🌤️' : '☁️';
  if (code === 3) return '☁️';
  if (code === 45 || code === 48) return '🌫️';
  if ([51, 53, 55, 61, 63, 80, 81].includes(code)) return isDay ? '🌦️' : '🌧️';
  if ([65, 82, 56, 57, 66, 67].includes(code)) return '🌧️';
  if ([71, 73, 75, 77, 85, 86].includes(code)) return '🌨️';
  if (code === 95) return '⛈️';
  if (code === 96 || code === 99) return '⛈️';
  return '☁️';
}

// ---------- Сцена ----------

export const TIME_TITLES = { morning: 'Утро', day: 'День', evening: 'Вечер', night: 'Ночь' };
export const SEASON_TITLES = { winter: 'Зима', spring: 'Весна', summer: 'Лето', autumn: 'Осень' };
export const WIND_TITLES = ['Штиль', 'Умеренный', 'Порывистый', 'Сильный', 'Ураганный'];

export function timeOfDay(t, sunrise, sunset, offset) {
  if (sunrise && sunset && sunset > sunrise) {
    if (t < sunrise - 40 * 60 || t > sunset + 40 * 60) return 'night';
    if (t < sunrise + 3 * 3600) return 'morning';
    if (t > sunset - 2.5 * 3600) return 'evening';
    return 'day';
  }
  const h = localDate(t, offset).getUTCHours();
  if (h >= 5 && h < 11) return 'morning';
  if (h >= 11 && h < 17) return 'day';
  if (h >= 17 && h < 22) return 'evening';
  return 'night';
}

export function season(t, latitude, offset) {
  const month = localDate(t, offset).getUTCMonth() + 1;
  const m = latitude < 0 ? ((month + 5) % 12) + 1 : month;
  if ([12, 1, 2].includes(m)) return 'winter';
  if ([3, 4, 5].includes(m)) return 'spring';
  if ([6, 7, 8].includes(m)) return 'summer';
  return 'autumn';
}

/** 0 штиль, 1 умеренный, 2 порывистый, 3 сильный, 4 ураганный. Скорости в м/с. */
export function windLevel(speed, gusts) {
  if (speed >= 25 || gusts >= 33) return 4;
  if (speed >= 14 || gusts >= 20) return 3;
  if (gusts >= 12 || (speed >= 3 && gusts - speed >= 6)) return 2;
  if (speed < 1.5 && gusts < 4) return 0;
  return 1;
}

export function today(s) {
  const k = dayKey(s.current.time, s.offset);
  return s.daily.find((d) => dayKey(d.date, s.offset) === k) ?? s.daily[0];
}

export function dayOf(s, t) {
  const k = dayKey(t, s.offset);
  return s.daily.find((d) => dayKey(d.date, s.offset) === k);
}

/**
 * Насколько видны звёзды, 0…1: проявляются за ~40 минут после заката и гаснут к рассвету.
 * Без восхода/заката (полярные день и ночь) — по времени суток.
 */
export function starLight(t, sunrise, sunset, tod) {
  const FADE = 40 * 60;
  if (sunrise && sunset && sunset > sunrise) {
    if (t >= sunset) return Math.min(1, (t - sunset) / FADE);
    if (t <= sunrise) return Math.min(1, (sunrise - t) / FADE);
    return 0;
  }
  return tod === 'night' ? 1 : 0;
}

export const PLACEHOLDER_MOOD = {
  timeOfDay: 'day', season: 'summer', precipitation: 'none', precipitationIntensity: 0, wind: 1,
  windSpeed: 3, windGusts: 5, windDirection: 270, cloudiness: 0.3, isThunderstorm: false, isFog: false,
  snowOnGround: false, temperature: 18, starLight: 0,
};

export function makeMood(s, now = Date.now() / 1000) {
  const c = s.current;
  const d = today(s);
  const cond = condition(c.code);
  let kind = cond.precipitation;
  if (kind === 'none' && c.precip >= 0.1) kind = c.snowfall > 0 ? 'snow' : 'rain';
  let intensity = Math.max(cond.intensity, Math.min(1, c.precip / 4));
  intensity = kind !== 'none' ? Math.max(intensity, 0.25) : 0;
  const sea = season(now, s.lat, s.offset);
  const tod = timeOfDay(now, d?.sunrise, d?.sunset, s.offset);
  return {
    timeOfDay: tod,
    starLight: starLight(now, d?.sunrise, d?.sunset, tod),
    season: sea,
    precipitation: kind,
    precipitationIntensity: intensity,
    wind: windLevel(c.windSpeed, c.gusts),
    windSpeed: c.windSpeed,
    windGusts: c.gusts,
    windDirection: c.windDir,
    cloudiness: Math.max(c.cloud / 100, cond.cloudiness),
    isThunderstorm: cond.isThunderstorm,
    isFog: cond.isFog,
    snowOnGround: (sea === 'winter' && c.temp <= 2) || kind === 'snow' || c.temp <= -3,
    temperature: c.temp,
  };
}

// ---------- Предупреждения ----------

export const SEVERITY_TITLES = { 1: 'Внимание', 2: 'Предупреждение', 3: 'Опасно' };
export const ALERT_ICONS = {
  wind: '🌬️', rain: '🌧️', snow: '❄️', heat: '🌡️', cold: '🥶', highPressure: '⏲️', lowPressure: '⏲️',
  pressureSwing: '⏲️', thunderstorm: '⛈️', hail: '🧊', ice: '⚠️', fog: '🌫️', uv: '😎',
};
const ALERT_KINDS = Object.keys(ALERT_ICONS);

/** Пороги близки к критериям Росгидромета для неблагоприятных и опасных явлений. */
export const THRESHOLDS = {
  gustWarning: 15, gustDanger: 25,          // м/с
  rainWarning: 15, rainDanger: 50,          // мм/сутки
  snowWarning: 7, snowDanger: 20,           // см/сутки
  heatWarning: 30, heatDanger: 35,          // °C, максимум
  coldWarning: -25, coldDanger: -35,        // °C, минимум
  highPressure: 770, highPressureDanger: 780, // мм рт. ст. (у моря)
  lowPressure: 735, lowPressureDanger: 725,
  pressureSwing: 8,                         // мм рт. ст. за сутки
  uvHigh: 8,
};

export function alerts(s, now = Date.now() / 1000, t = THRESHOLDS) {
  const todayKey = dayKey(now, s.offset);
  const raw = [];
  const add = (kind, severity, title, message, date) => raw.push({ kind, severity, title, message, start: date, end: date });
  const T = Units.temp;
  const R = Math.round;

  for (const d of s.daily) {
    if (dayKey(d.date, s.offset) < todayKey) continue;

    if (d.gustMax >= t.gustDanger) add('wind', 3, 'Ураганный ветер', `Порывы до ${R(d.gustMax)} м/с. Держитесь подальше от деревьев, рекламных щитов и шатких конструкций.`, d.date);
    else if (d.gustMax >= t.gustWarning) add('wind', 2, 'Сильный ветер', `Порывы до ${R(d.gustMax)} м/с, средний ветер до ${R(d.windMax)} м/с.`, d.date);

    if (d.snowSum >= t.snowDanger) add('snow', 3, 'Очень сильный снег', `До ${R(d.snowSum)} см снега за сутки. Возможны заносы на дорогах.`, d.date);
    else if (d.snowSum >= t.snowWarning) add('snow', 2, 'Сильный снег', `До ${R(d.snowSum)} см снега за сутки.`, d.date);
    else if (d.precipSum >= t.rainDanger) add('rain', 3, 'Очень сильный дождь', `До ${R(d.precipSum)} мм осадков за сутки. Возможны подтопления.`, d.date);
    else if (d.precipSum >= t.rainWarning) add('rain', 2, 'Обильные осадки', `До ${R(d.precipSum)} мм осадков за сутки.`, d.date);

    if (d.max >= t.heatDanger) add('heat', 3, 'Аномальная жара', `До ${T(d.max)}. Избегайте солнца днём, пейте больше воды.`, d.date);
    else if (d.max >= t.heatWarning) add('heat', 2, 'Сильная жара', `До ${T(d.max)}, ощущается как ${T(d.appMax)}.`, d.date);

    if (d.min <= t.coldDanger) add('cold', 3, 'Аномальный мороз', `До ${T(d.min)}. Сократите время на улице, берегите лицо и руки.`, d.date);
    else if (d.min <= t.coldWarning) add('cold', 2, 'Сильный мороз', `До ${T(d.min)}, ощущается как ${T(d.appMin)}.`, d.date);

    const c = condition(d.code);
    if (d.code === 96 || d.code === 99) add('hail', 2, 'Гроза с градом', 'Ожидается гроза, возможен град. Не оставляйте машину под открытым небом.', d.date);
    else if (c.isThunderstorm) add('thunderstorm', 1, 'Гроза', 'Ожидается гроза. Не стойте под одиночными деревьями.', d.date);

    if (c.isFreezing) add('ice', 2, 'Ледяной дождь', 'Гололёд на дорогах и тротуарах, возможно обледенение проводов.', d.date);
    else if (d.min < 0 && d.max > 0 && d.precipSum >= 1) add('ice', 1, 'Возможен гололёд', 'Осадки при переходе температуры через ноль.', d.date);

    if (c.isFog) add('fog', 1, 'Туман', 'Ухудшение видимости, будьте осторожны на дороге.', d.date);
    if (d.uv != null && d.uv >= t.uvHigh) add('uv', 1, 'Высокий УФ-индекс', `УФ-индекс до ${R(d.uv)}. Нужны солнцезащитный крем и очки.`, d.date);

    const k = dayKey(d.date, s.offset);
    const pressures = s.hourly.filter((h) => dayKey(h.time, s.offset) === k && h.pressure != null).map((h) => Units.mmHg(h.pressure));
    if (pressures.length) {
      const maxP = Math.max(...pressures), minP = Math.min(...pressures);
      if (maxP >= t.highPressure) add('highPressure', maxP >= t.highPressureDanger ? 2 : 1, 'Высокое давление', `До ${R(maxP)} мм рт. ст. (норма около 760). Метеозависимым стоит поберечься.`, d.date);
      if (minP <= t.lowPressure) add('lowPressure', minP <= t.lowPressureDanger ? 2 : 1, 'Низкое давление', `До ${R(minP)} мм рт. ст. (норма около 760). Метеозависимым стоит поберечься.`, d.date);
    }
  }

  const swing = pressureSwing(s.hourly, now, t.pressureSwing);
  if (swing) {
    const startOfDay = (dayKey(swing.at, s.offset) * 86400) - s.offset;
    add('pressureSwing', 1, 'Резкий перепад давления', `За сутки давление ${swing.delta > 0 ? 'вырастет' : 'упадёт'} на ${R(Math.abs(swing.delta))} мм рт. ст.`, startOfDay);
  }

  return merge(raw, s.offset).sort((a, b) => (a.severity !== b.severity ? b.severity - a.severity : a.start - b.start));
}

export function pressureSwing(hourly, now, threshold) {
  const pts = hourly.filter((h) => h.time >= now - 3600 && h.time <= now + 72 * 3600);
  let best = null;
  pts.forEach((p, i) => {
    const q = pts[i + 24];
    if (p.pressure == null || !q || q.pressure == null) return;
    const delta = Units.mmHg(q.pressure - p.pressure);
    if (Math.abs(delta) >= threshold && Math.abs(delta) > Math.abs(best?.delta ?? 0)) best = { delta, at: q.time };
  });
  return best;
}

/** Склеивает одинаковые явления в соседние дни в одно предупреждение с периодом. */
export function merge(list, offset) {
  const out = [];
  for (const kind of ALERT_KINDS) {
    const items = list.filter((a) => a.kind === kind).sort((a, b) => a.start - b.start);
    let cur = null;
    for (const a of items) {
      if (cur && dayKey(a.start, offset) === dayKey(cur.end, offset) + 1) {
        cur.end = a.end;
        if (a.severity > cur.severity) Object.assign(cur, { severity: a.severity, title: a.title, message: a.message });
      } else {
        if (cur) out.push(cur);
        cur = { ...a };
      }
    }
    if (cur) out.push(cur);
  }
  return out.map((a) => ({ ...a, id: `${a.kind}-${a.start}-${a.severity}` }));
}

export function headlineAlert(list, s, now = Date.now() / 1000) {
  const horizon = dayKey(now, s.offset) + 3;
  return list.filter((a) => a.severity >= 2 && dayKey(a.start, s.offset) < horizon)
    .sort((a, b) => (b.severity - a.severity) || (a.start - b.start))[0] ?? null;
}

// ---------- Одежда ----------

export function clothing(current, d, normal) {
  const feels = current.apparent;
  const items = [];
  const notes = [];
  const add = (icon, text) => items.push({ icon, text });
  let headline;

  if (feels >= 24) {
    headline = 'Верхняя одежда не нужна';
    add('👕', 'Футболка, шорты или лёгкое платье'); add('🧢', 'Головной убор от солнца');
  } else if (feels >= 17) {
    headline = 'Лёгкая одежда';
    add('👕', 'Футболка или рубашка');
    if (d && d.appMin < 14) add('🧥', 'Кофта или лёгкая куртка на вечер');
  } else if (feels >= 11) {
    headline = 'Ветровка или лёгкая куртка';
    add('👕', 'Лонгслив, худи или свитшот'); add('👟', 'Закрытая обувь');
  } else if (feels >= 5) {
    headline = 'Демисезонная куртка или плащ';
    add('🧶', 'Свитер или толстовка под куртку'); add('👟', 'Закрытая обувь');
  } else if (feels >= 0) {
    headline = 'Тёплая демисезонная куртка';
    add('🧶', 'Тёплый свитер'); add('🧤', 'Лёгкая шапка и перчатки'); add('🥾', 'Утеплённая обувь');
  } else if (feels >= -10) {
    headline = 'Зимняя куртка';
    add('🧣', 'Шапка, шарф и перчатки'); add('🥾', 'Зимняя обувь');
  } else if (feels >= -20) {
    headline = 'Пуховик';
    add('🧣', 'Тёплая шапка, шарф и варежки'); add('🩲', 'Термобельё'); add('🥾', 'Зимняя обувь с тёплой стелькой');
  } else {
    headline = 'Тёплый пуховик или парка';
    add('🩲', 'Термобельё и шерстяной слой'); add('🧤', 'Варежки, балаклава, закрытое лицо'); add('🥾', 'Валенки или сапоги для сильного мороза');
    notes.push('Не задерживайтесь подолгу на улице — риск обморожения.');
  }

  const cond = condition(current.code);
  const windy = current.windSpeed >= 8 || current.gusts >= 12;
  const wetNow = ['rain', 'drizzle', 'sleet', 'hail'].includes(cond.precipitation) || current.rain + current.showers > 0.1;
  const wetLater = d ? (d.probMax ?? 0) >= 50 && d.rainSum >= 0.5 : false;
  const snowy = cond.precipitation === 'snow' || (d?.snowSum ?? 0) >= 1;

  if (wetNow || wetLater) {
    if (windy) add('🧥', 'Непромокаемая куртка с капюшоном — зонт вывернет ветром');
    else add('☂️', wetNow ? 'Зонт' : 'Зонт — днём вероятен дождь');
    add('💧', 'Непромокаемая обувь');
  } else if (windy) {
    add('🌬️', 'Ветрозащитный слой и капюшон');
  }
  if (snowy || cond.isFreezing || (d && d.min < 0 && d.max > 0)) add('🚶', 'Обувь с нескользящей подошвой');
  if (d?.uv != null && d.uv >= 6) add('🕶️', 'Солнцезащитные очки и крем');
  if (d && d.appMax - d.appMin >= 10) notes.push(`Днём до ${Units.temp(d.max)}, ночью до ${Units.temp(d.min)} — одевайтесь слоями.`);
  if (d && normal?.averageMax != null) {
    const diff = d.max - normal.averageMax;
    if (Math.abs(diff) >= 3) {
      notes.push(`Сегодня на ${Math.round(Math.abs(diff))}° ${diff > 0 ? 'теплее' : 'холоднее'} обычного для этого дня (средний максимум ${Units.temp(normal.averageMax)}).`);
    }
  }
  return { headline, items, notes };
}

// ---------- История ----------

export function climate(month, day, days) {
  const leap = month === 2 && day === 29;
  const byYear = new Map();
  for (const d of days) {
    if (d.month !== month) continue;
    if (d.day === day) byYear.set(d.year, d);
    else if (leap && d.day === 28 && !byYear.has(d.year)) byYear.set(d.year, d);
  }
  const years = [...byYear.values()].sort((a, b) => b.year - a.year);
  const vals = (k) => years.map((y) => y[k]).filter((v) => v != null);
  const avg = (k) => { const v = vals(k); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  const record = (k, highest) => {
    let best = null;
    for (const y of years) {
      if (y[k] == null) continue;
      if (!best || (highest ? y[k] > best.value : y[k] < best.value)) best = { value: y[k], year: y.year };
    }
    return best;
  };
  const share = (k, test) => { const v = vals(k); return v.length ? v.filter(test).length / v.length : null; };
  const trendPts = years
    .map((y) => [y.year, y.mean ?? (y.max != null && y.min != null ? (y.max + y.min) / 2 : null)])
    .filter((p) => p[1] != null);
  const slope = linearSlope(trendPts);
  const pressure = avg('pressure');
  return {
    month, day, years,
    yearSpan: years.length ? [years[years.length - 1].year, years[0].year] : null,
    averageMax: avg('max'), averageMin: avg('min'), averageMean: avg('mean'),
    recordHigh: record('max', true), recordLow: record('min', false),
    averagePrecipitation: avg('precip'),
    wetDaysShare: share('precip', (v) => v >= 1),
    snowDaysShare: share('snow', (v) => v >= 0.5),
    strongestGust: record('gust', true),
    averagePressureMmHg: pressure == null ? null : Units.mmHg(pressure),
    averageHumidity: avg('humidity'),
    trendPerDecade: slope == null ? null : slope * 10,
  };
}

export function linearSlope(points) {
  if (points.length < 5) return null;
  const n = points.length;
  const mx = points.reduce((a, p) => a + p[0], 0) / n;
  const my = points.reduce((a, p) => a + p[1], 0) / n;
  const sxx = points.reduce((a, p) => a + (p[0] - mx) ** 2, 0);
  if (sxx === 0) return null;
  return points.reduce((a, p) => a + (p[0] - mx) * (p[1] - my), 0) / sxx;
}
