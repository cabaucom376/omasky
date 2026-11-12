// Omasky's brain: pure functions, no QML types. Service.qml drives the scene
// from these, tools/scene.js feeds the same numbers to the offscreen shader
// preview, and test/model.test.js checks them under node.

var MINUTE = 60000
var DAY = 86400000
var SYNODIC_MONTH = 29.530588853 * DAY
// A new moon: 2000-01-06 18:14 UTC.
var NEW_MOON_EPOCH = Date.UTC(2000, 0, 6, 18, 14, 0)

// Lists that arrive from the shell's Hyprland objects are Qt sequences, not
// JS arrays, so Array.isArray does not know them.
function isList(value) {
  return value !== null && value !== undefined && typeof value !== "string" && typeof value.length === "number"
}

function clamp(value, lo, hi) {
  var n = Number(value)
  if (!isFinite(n)) return lo
  return Math.max(lo, Math.min(hi, n))
}

function mix(a, b, t) {
  return a + (b - a) * t
}

function smoothstep(edge0, edge1, x) {
  var t = clamp((x - edge0) / (edge1 - edge0), 0, 1)
  return t * t * (3 - 2 * t)
}

// ------------------------------------------------------------------ colors
// Colors are [r, g, b] in 0..1 until they leave as "#rrggbb".

function parseHex(value) {
  var match = /^#?([0-9a-fA-F]{6})$/.exec(String(value || "").trim())
  if (!match) return null
  var n = parseInt(match[1], 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

function toHex(color) {
  var out = "#"
  for (var i = 0; i < 3; i++) {
    var v = Math.round(clamp(color[i], 0, 1) * 255).toString(16)
    out += v.length < 2 ? "0" + v : v
  }
  return out
}

function mixColor(a, b, t) {
  return [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)]
}

function luminance(color) {
  return 0.2126 * color[0] + 0.7152 * color[1] + 0.0722 * color[2]
}

// colors.toml: `name = "#rrggbb"` lines plus `mode = "dark"|"light"`.
// Anything else in the file is ignored, so a malformed line costs one color.
function parseThemeColors(raw) {
  var out = {}
  var lines = String(raw || "").split("\n")
  for (var i = 0; i < lines.length && i < 400; i++) {
    var match = /^\s*([A-Za-z0-9_-]{1,40})\s*=\s*["']?(#[0-9A-Fa-f]{6}|dark|light)\b/.exec(lines[i])
    if (match) out[match[1]] = match[2]
  }
  return out
}

// The sky is painted only from the theme. `colors` is parseThemeColors' dict;
// `fallback` carries the shell's own foreground/background/accent/urgent/muted
// for a theme file that could not be read.
function derivePalette(colors, fallback) {
  var c = colors || {}
  var f = fallback || {}
  function pick() {
    for (var i = 0; i < arguments.length; i++) {
      var parsed = parseHex(c[arguments[i]]) || parseHex(f[arguments[i]])
      if (parsed) return parsed
    }
    return null
  }

  var background = pick("background", "color0") || [0.07, 0.08, 0.09]
  var foreground = pick("foreground", "color7") || [0.85, 0.86, 0.86]
  var accent = pick("accent", "blue", "color4") || foreground
  var muted = pick("muted", "color8") || mixColor(background, foreground, 0.45)
  var light = c.mode === "light" || (c.mode !== "dark" && luminance(background) > 0.55)

  var black = [0, 0, 0]
  // paper is the lightest tone the theme has and ink the darkest, whichever
  // of background and foreground they come from.
  var paper = light ? (pick("lighter_background") || background) : (pick("bright_foreground") || foreground)
  var ink = light ? foreground : (pick("darker_background") || mixColor(background, black, 0.4))
  if (luminance(paper) < luminance(foreground)) paper = foreground
  if (luminance(ink) > luminance(background)) ink = mixColor(background, black, 0.4)

  var blue = pick("blue", "color4") || accent
  var cyan = pick("cyan", "color6") || blue
  var yellow = pick("yellow", "color3") || mixColor(accent, paper, 0.5)
  var red = pick("red", "color1", "urgent") || accent
  var orange = pick("orange") || mixColor(red, yellow, 0.5)

  var dayTop = mixColor(background, blue, light ? 0.58 : 0.50)
  var dayBottom = light ? mixColor(mixColor(background, cyan, 0.30), paper, 0.35)
                        : mixColor(mixColor(background, cyan, 0.62), paper, 0.14)
  var nightTop = light ? mixColor(ink, black, 0.35) : mixColor(ink, black, 0.15)
  var nightBottom = light ? mixColor(ink, blue, 0.22) : mixColor(background, blue, 0.14)

  return {
    light: light,
    background: background,
    foreground: foreground,
    accent: accent,
    paper: paper,
    ink: ink,
    dayTop: dayTop,
    dayBottom: dayBottom,
    nightTop: nightTop,
    nightBottom: nightBottom,
    overcastDay: mixColor(mixColor(muted, dayBottom, 0.35), paper, light ? 0.25 : 0.05),
    overcastNight: mixColor(nightBottom, muted, 0.16),
    glow: mixColor(orange, red, 0.35),
    sun: mixColor(yellow, paper, light ? 0.10 : 0.30),
    sunLow: mixColor(orange, yellow, 0.35),
    moon: mixColor(paper, blue, 0.10),
    star: paper,
    cloudLightDay: mixColor(paper, dayBottom, 0.08),
    cloudShadeDay: mixColor(mixColor(muted, dayTop, 0.40), paper, light ? 0.30 : 0.0),
    cloudLightNight: mixColor(nightBottom, paper, 0.26),
    cloudShadeNight: mixColor(nightTop, muted, 0.20),
    stormShade: light ? mixColor(muted, ink, 0.45) : mixColor(ink, muted, 0.30),
    fogDay: mixColor(paper, muted, light ? 0.20 : 0.42),
    fogNight: mixColor(nightBottom, muted, 0.45),
    rain: mixColor(mixColor(cyan, blue, 0.4), paper, light ? 0.10 : 0.50),
    snow: paper,
    flash: mixColor(paper, yellow, 0.12),
    // A rainbow, outside in: the theme's red, its yellow, its blue.
    bowOuter: red,
    bowMiddle: yellow,
    bowInner: mixColor(blue, pick("magenta", "color5") || blue, 0.35)
  }
}

// ----------------------------------------------------------------- weather
//
// Open-Meteo reports WMO weather codes. Each maps to how much of everything
// the sky should carry, 0..1, and to the i18n key that names it.
var CODE_TABLE = {
  0: ["clear", 0.0, 0, 0, 0, 0],
  1: ["mostlyClear", 0.2, 0, 0, 0, 0],
  2: ["partlyCloudy", 0.5, 0, 0, 0, 0],
  3: ["overcast", 1.0, 0, 0, 0, 0],
  45: ["fog", 0.55, 0, 0, 0.75, 0],
  48: ["fog", 0.6, 0, 0, 0.85, 0],
  51: ["drizzle", 0.8, 0.18, 0, 0.1, 0],
  53: ["drizzle", 0.85, 0.28, 0, 0.12, 0],
  55: ["drizzle", 0.9, 0.38, 0, 0.15, 0],
  56: ["freezingDrizzle", 0.85, 0.25, 0.08, 0.1, 0],
  57: ["freezingDrizzle", 0.9, 0.38, 0.12, 0.12, 0],
  61: ["lightRain", 0.85, 0.42, 0, 0, 0],
  63: ["rain", 0.95, 0.68, 0, 0.05, 0],
  65: ["heavyRain", 1.0, 0.95, 0, 0.12, 0],
  66: ["freezingRain", 0.9, 0.45, 0.1, 0, 0],
  67: ["freezingRain", 1.0, 0.8, 0.15, 0.08, 0],
  71: ["lightSnow", 0.85, 0, 0.35, 0, 0],
  73: ["snow", 0.92, 0, 0.62, 0.05, 0],
  75: ["heavySnow", 1.0, 0, 0.95, 0.15, 0],
  77: ["snowGrains", 0.8, 0, 0.28, 0, 0],
  80: ["showers", 0.65, 0.5, 0, 0, 0],
  81: ["showers", 0.75, 0.72, 0, 0, 0],
  82: ["heavyShowers", 0.9, 1.0, 0, 0.1, 0],
  85: ["snowShowers", 0.7, 0, 0.5, 0, 0],
  86: ["snowShowers", 0.85, 0, 0.9, 0.1, 0],
  95: ["thunderstorm", 1.0, 0.85, 0, 0.05, 1],
  96: ["thunderstorm", 1.0, 0.9, 0, 0.05, 1],
  99: ["thunderstorm", 1.0, 1.0, 0, 0.1, 1]
}

// Names for `omarchy-shell omasky preview <name>`, each standing for the WMO
// code that best shows it off.
var PREVIEWS = {
  clear: 0, sunny: 0, mostlyclear: 1, partly: 2, partlycloudy: 2, cloudy: 3, overcast: 3,
  fog: 45, drizzle: 53, rain: 63, heavyrain: 65, monsoon: 65, showers: 81, sleet: 63,
  freezingrain: 67, ice: 67, snow: 73, heavysnow: 75, blizzard: 75, thaw: 3,
  thunderstorm: 95, storm: 95, thunder: 95, hail: 99,
  heat: 0, hot: 0, heatwave: 0
}

// The temperature a preview stands for, where the name says something about
// it: what falls, and what becomes of what has fallen, go by the temperature.
var PREVIEW_TEMPERATURES = {
  heat: 39, hot: 39, heatwave: 39, sleet: 1, freezingrain: -3, ice: -3,
  snow: -4, heavysnow: -6, blizzard: -9, thaw: 7, hail: 17, monsoon: 26
}

function previewTemperature(name) {
  var key = String(name || "").toLowerCase().replace(/[^a-z0-9]/g, "")
  return PREVIEW_TEMPERATURES.hasOwnProperty(key) ? PREVIEW_TEMPERATURES[key] : null
}

// The wind a preview stands for, km/h, where the name is about wind.
function previewWind(name) {
  var key = String(name || "").toLowerCase().replace(/[^a-z0-9]/g, "")
  return key === "blizzard" ? 75 : (key === "storm" || key === "thunderstorm" || key === "thunder" || key === "monsoon" ? 38 : null)
}

function previewCode(name) {
  var key = String(name || "").toLowerCase().replace(/[^a-z0-9]/g, "")
  if (PREVIEWS.hasOwnProperty(key)) return PREVIEWS[key]
  if (/^\d{1,2}$/.test(key) && CODE_TABLE.hasOwnProperty(Number(key))) return Number(key)
  return -1
}

function known(value) {
  return value !== null && value !== undefined && isFinite(Number(value))
}

// What falls, by the temperature: the share of it that is frozen. Above a
// couple of degrees it is rain, at freezing and below it is snow, and in
// between it is both at once, which is sleet. `lean` moves the line for a
// reading the weather service has already called one or the other (-1 says
// snow, 1 says rain), and stands in for the temperature when there is none.
function frozenShare(temperature, lean) {
  if (!known(temperature)) return lean < 0 ? 1 : 0
  return 1 - smoothstep(-0.5, 2.5, Number(temperature) + 1.5 * (lean || 0))
}

var SNOW_FOR = { drizzle: "lightSnow", lightRain: "lightSnow", rain: "snow", heavyRain: "heavySnow", showers: "snowShowers", heavyShowers: "snowShowers" }
var RAIN_FOR = { lightSnow: "lightRain", snow: "rain", heavySnow: "heavyRain", snowGrains: "drizzle", snowShowers: "showers" }

// The name for what is falling, once the temperature has had its say.
function fallingKey(base, frozen) {
  if (frozen > 0.3 && frozen < 0.7 && (SNOW_FOR[base] || RAIN_FOR[base])) return "sleet"
  if (frozen >= 0.7 && SNOW_FOR[base]) return SNOW_FOR[base]
  if (frozen <= 0.3 && RAIN_FOR[base]) return RAIN_FOR[base]
  return base
}

// How thick the air is, 0..1, from how far one can see in metres.
function fogFromVisibility(metres) {
  if (!known(metres) || Number(metres) <= 0) return 0
  return 1 - smoothstep(Math.log(200), Math.log(12000), Math.log(Number(metres)))
}

// What the sky carries for one reading. The code says what kind of weather
// it is and how hard; the rest refines it. `cloudCover` (0..100) settles the
// codes that only say "some cloud"; wind is km/h and the compass degrees it
// blows from. `more` is whatever else is known, any of it optional:
//
//   temperature  degrees C: decides whether what falls is rain, sleet or snow
//   gusts        km/h: how unevenly the wind blows
//   coverLow, coverMid, coverHigh   0..100: the cloud at each height
//   visibility   metres: how thick the fog or haze really is
//   plain        true where the temperature is the whole say in what falls:
//                a preview or the demo, which choose a temperature to show a
//                kind of weather. A reading from the service leans toward
//                what its code called it when the temperature is on the line.
function weatherFromCode(code, cloudCover, windSpeed, windDirection, more) {
  var extra = more || {}
  var number = Number(code)
  var row = CODE_TABLE[number] || CODE_TABLE[3]
  var cover = row[1]
  var measured = cloudCover === null || cloudCover === undefined ? NaN : Number(cloudCover)
  if (isFinite(measured) && number <= 3)
    cover = mix(cover, clamp(measured / 100, 0, 1), 0.5)

  var speed = clamp(windSpeed, 0, 150)
  var direction = Number(windDirection)
  // A wind from the east blows westward: right to left on a north-facing sky.
  var heading = isFinite(direction) ? -Math.sin(direction * Math.PI / 180) : 1
  if (Math.abs(heading) < 0.25) heading = heading < 0 ? -0.25 : 0.25

  // How hard it is coming down, and how much of that is frozen. Freezing
  // rain is the one kind that falls as water below freezing; it keeps the
  // share its code gives it.
  var precip = Math.max(row[2], row[3])
  var freezing = row[0] === "freezingRain" || row[0] === "freezingDrizzle"
  var frozen = precip <= 0 ? 0 : freezing ? row[3] / (row[2] + row[3])
    : frozenShare(extra.temperature, extra.plain && known(extra.temperature) ? 0 : (row[3] > row[2] ? -1 : 1))
  var rain = precip * (1 - frozen), snow = precip * frozen
  var thunder = row[5]
  var hail = number === 99 ? 1 : (number === 96 ? 0.55 : 0)

  // The cloud at each height. With nothing measured every lane has the
  // cover; rain and snow come out of the lowest, so while something falls
  // that lane has at least what the middle one has.
  function layer(value) { return known(value) ? clamp(Number(value) / 100, 0, 1) : cover }
  var low = layer(extra.coverLow), mid = layer(extra.coverMid), high = layer(extra.coverHigh)
  if (precip > 0) low = Math.max(low, mid * 0.9)

  var seen = fogFromVisibility(extra.visibility)
  var fog = row[0] === "fog" ? (known(extra.visibility) ? clamp(mix(row[4], seen, 0.7), 0.35, 1) : row[4])
    : Math.max(row[4], seen * 0.45)

  return {
    code: CODE_TABLE[number] ? number : 3,
    key: precip > 0 && !freezing ? fallingKey(row[0], frozen) : row[0],
    cover: cover,
    coverLow: low,
    coverMid: mid,
    coverHigh: high,
    temperature: known(extra.temperature) ? Number(extra.temperature) : null,
    precip: precip,
    rain: rain,
    snow: snow,
    hail: hail,
    fog: fog,
    thunder: thunder,
    storm: clamp(thunder * 0.6 + rain * 0.7 + snow * 0.25 + hail * 0.2, 0, 1),
    // Signed breeze, -1..1: how hard rain leans and snow drifts, and which way.
    wind: heading * clamp(0.18 + speed / 55, 0.18, 1),
    // How unevenly it blows, 0..1: from the gusts where they are known.
    gust: known(extra.gusts) ? clamp((Number(extra.gusts) - speed) / 30, 0, 1) : clamp(0.15 + speed / 90 + 0.3 * thunder, 0, 0.8),
    // How fast the near clouds cross the screen, in pixels a second: a calm
    // day still moves them, a gale sends them over in seconds.
    windPx: (heading < 0 ? -1 : 1) * (6 + Math.min(speed, 120) * 1.5)
  }
}

// Each cloud lane's share of that speed: far clouds cross slower.
var LANE_SPEED = [0.45, 0.68, 1.0]

// 0..1: how much the air shimmers. A really hot, dry, sunlit day.
function heatFor(temperature, dayness, weather) {
  var t = Number(temperature)
  if (temperature === null || temperature === undefined || !isFinite(t)) return 0
  if (weather.rain > 0 || weather.snow > 0) return 0
  return smoothstep(29, 38, t) * dayness * (1 - 0.6 * weather.cover) * (1 - weather.fog)
}

// Open-Meteo's answer, trusted for nothing: every number is range-checked and
// anything missing leaves its field null. Times come back as unix seconds
// (timeformat=unixtime) and leave as milliseconds.
function parseForecast(raw) {
  var data
  try {
    data = JSON.parse(String(raw || ""))
  } catch (e) {
    return null
  }
  if (!data || typeof data !== "object" || !data.current || typeof data.current !== "object") return null

  function number(value, lo, hi) {
    var n = Number(value)
    return value !== null && value !== undefined && isFinite(n) && n >= lo && n <= hi ? n : null
  }

  var current = data.current
  var code = number(current.weather_code, 0, 99)
  if (code === null) return null

  var sunrise = [], sunset = []
  var daily = data.daily && typeof data.daily === "object" ? data.daily : {}
  var rises = Array.isArray(daily.sunrise) ? daily.sunrise : []
  var sets = Array.isArray(daily.sunset) ? daily.sunset : []
  for (var i = 0; i < rises.length && i < 8; i++) {
    var rise = number(rises[i], 1e9, 1e11)
    if (rise !== null) sunrise.push(rise * 1000)
  }
  for (var j = 0; j < sets.length && j < 8; j++) {
    var set = number(sets[j], 1e9, 1e11)
    if (set !== null) sunset.push(set * 1000)
  }

  // The days it gives, each with its weather, high and low. A day is counted
  // by the date where the place is, which its offset from UTC gives: the
  // times are the place's own midnights.
  var offset = number(data.utc_offset_seconds, -86400, 86400) || 0
  var days = []
  var times = Array.isArray(daily.time) ? daily.time : []
  var codes = Array.isArray(daily.weather_code) ? daily.weather_code : []
  var highs = Array.isArray(daily.temperature_2m_max) ? daily.temperature_2m_max : []
  var lows = Array.isArray(daily.temperature_2m_min) ? daily.temperature_2m_min : []
  for (var k = 0; k < times.length && k < 10; k++) {
    var at = number(times[k], 1e9, 1e11), what = number(codes[k], 0, 99)
    var high = number(highs[k], -100, 70), low = number(lows[k], -100, 70)
    if (at === null || what === null || high === null || low === null) continue
    days.push({ day: Math.floor((at + offset) / 86400), code: what, high: high, low: low })
  }
  days.sort(function(a, b) { return a.day - b.day })

  // The hours either side of now. Each is a reading shaped as the present
  // one is, with when it is for, what falls in the hour up to it
  // (millimetres) and the chance of that (0..1).
  var hours = []
  var hourly = data.hourly && typeof data.hourly === "object" ? data.hourly : {}
  function column(name) { return Array.isArray(hourly[name]) ? hourly[name] : [] }
  var stamps = column("time"), hc = column("weather_code"), ht = column("temperature_2m")
  var hf = column("apparent_temperature"), hh = column("relative_humidity_2m")
  var hp = column("precipitation"), hpp = column("precipitation_probability")
  var hcc = column("cloud_cover"), hcl = column("cloud_cover_low"), hcm = column("cloud_cover_mid"), hch = column("cloud_cover_high")
  var hws = column("wind_speed_10m"), hwd = column("wind_direction_10m"), hwg = column("wind_gusts_10m"), hv = column("visibility")
  for (var n = 0; n < stamps.length && n < 120; n++) {
    var hourAt = number(stamps[n], 1e9, 1e11), hourCode = number(hc[n], 0, 99)
    if (hourAt === null || hourCode === null) continue
    var chance = number(hpp[n], 0, 100)
    hours.push({
      at: hourAt * 1000, code: hourCode,
      temperature: number(ht[n], -100, 70), feels: number(hf[n], -100, 70), humidity: number(hh[n], 0, 100),
      precip: number(hp[n], 0, 500) || 0, chance: chance === null ? null : chance / 100,
      cloudCover: number(hcc[n], 0, 100), coverLow: number(hcl[n], 0, 100), coverMid: number(hcm[n], 0, 100), coverHigh: number(hch[n], 0, 100),
      windSpeed: number(hws[n], 0, 500), windDirection: number(hwd[n], 0, 360), gusts: number(hwg[n], 0, 500),
      visibility: number(hv[n], 0, 1000000)
    })
  }
  hours.sort(function(a, b) { return a.at - b.at })

  // The next two hours a quarter of an hour at a time: when each quarter
  // ends, what falls in it (millimetres) and what kind of weather it is.
  var soon = []
  var quarters = data.minutely_15 && typeof data.minutely_15 === "object" ? data.minutely_15 : {}
  var qt = Array.isArray(quarters.time) ? quarters.time : []
  var qp = Array.isArray(quarters.precipitation) ? quarters.precipitation : []
  var qc = Array.isArray(quarters.weather_code) ? quarters.weather_code : []
  for (var q = 0; q < qt.length && q < 16; q++) {
    var quarterAt = number(qt[q], 1e9, 1e11)
    if (quarterAt === null) continue
    soon.push({ at: quarterAt * 1000, precip: number(qp[q], 0, 500) || 0, code: number(qc[q], 0, 99) })
  }
  soon.sort(function(a, b) { return a.at - b.at })

  return {
    code: code,
    hours: hours,
    soon: soon,
    temperature: number(current.temperature_2m, -100, 70),
    feels: number(current.apparent_temperature, -100, 70),
    humidity: number(current.relative_humidity_2m, 0, 100),
    offset: offset,
    days: days,
    cloudCover: number(current.cloud_cover, 0, 100),
    coverLow: number(current.cloud_cover_low, 0, 100),
    coverMid: number(current.cloud_cover_mid, 0, 100),
    coverHigh: number(current.cloud_cover_high, 0, 100),
    windSpeed: number(current.wind_speed_10m, 0, 500),
    windDirection: number(current.wind_direction_10m, 0, 360),
    gusts: number(current.wind_gusts_10m, 0, 500),
    visibility: number(current.visibility, 0, 1000000),
    isDay: number(current.is_day, 0, 1),
    sunrise: sunrise,
    sunset: sunset
  }
}

// Whether a WMO weather code is something falling, and whether that is snow.
function codeFalls(code) {
  var c = Number(code)
  return (c >= 51 && c <= 67) || (c >= 71 && c <= 77) || (c >= 80 && c <= 86) || (c >= 95 && c <= 99)
}
function codeSnows(code) {
  var c = Number(code)
  return (c >= 71 && c <= 77) || c === 85 || c === 86
}

// What is about to start falling: {minutes, snow}, or null. It goes by the
// quarter hours the forecast gives: the first one within the hour in which
// something falls. `minutes` is how long until that quarter begins, to the
// nearest five, 0 for any minute now. Null when nothing is on its way, and
// when it is already coming down: this is a warning of a change.
function fallSoon(forecast, now) {
  if (!forecast || !isList(forecast.soon) || codeFalls(forecast.code)) return null
  for (var i = 0; i < forecast.soon.length; i++) {
    var quarter = forecast.soon[i]
    if (quarter.at <= now) continue
    var begins = quarter.at - 15 * MINUTE
    if (begins - now > 60 * MINUTE) break
    if (quarter.precip >= 0.1 || codeFalls(quarter.code))
      return { minutes: Math.max(0, Math.round((begins - now) / MINUTE / 5) * 5), snow: codeSnows(quarter.code) }
  }
  return null
}

// The reading for an hour: of the hours the forecast gives, the one nearest
// `when`, if there is one within the hour. It has the fields the present
// reading has, so the sky is made from it the same way. Null when the
// forecast does not reach that far.
function readingAt(forecast, when) {
  var hours = forecast && isList(forecast.hours) ? forecast.hours : []
  var best = null, gap = 61 * MINUTE
  for (var i = 0; i < hours.length; i++) {
    var d = Math.abs(hours[i].at - when)
    if (d < gap) {
      best = hours[i]
      gap = d
    }
  }
  return best
}

// What falls through a day, an hour at a time, for drawing along the day's
// ruler: twenty-four entries from `dayStart`, each {amount (millimetres in
// that hour), chance (0..1, or null where none is given), snow} or null
// where the forecast has nothing. An hour's fall is reported at the hour's
// end, so each entry is read from the hour that closes it.
function hourStrip(forecast, dayStart) {
  var out = []
  var any = false
  for (var i = 0; i < 24; i++) {
    var end = dayStart + (i + 1) * 60 * MINUTE
    var hours = forecast && isList(forecast.hours) ? forecast.hours : []
    var hit = null
    for (var j = 0; j < hours.length; j++) {
      if (Math.abs(hours[j].at - end) < 31 * MINUTE) {
        hit = hours[j]
        break
      }
    }
    if (!hit) {
      out.push(null)
      continue
    }
    any = true
    var snowing = (hit.code >= 71 && hit.code <= 77) || hit.code === 85 || hit.code === 86
      || (hit.temperature !== null && hit.temperature <= 0.5 && hit.precip > 0)
    out.push({ amount: hit.precip, chance: hit.chance, snow: snowing })
  }
  return any ? out : []
}

// How long a bar an hour's fall gets on that ruler, 0..1: a drizzle shows,
// and four millimetres an hour is as long as it goes.
function stripLength(amount) {
  var mm = Number(amount)
  if (!isFinite(mm) || mm <= 0.04) return 0
  return 0.3 + 0.7 * smoothstep(0, 4, mm)
}

// weather.json and geo.omarchy.org share a shape: {name, latitude, longitude}.
function parseLocation(raw) {
  var unset = { name: "", latitude: null, longitude: null }
  var data
  try {
    data = JSON.parse(String(raw || ""))
  } catch (e) {
    return unset
  }
  if (!data || typeof data !== "object") return unset
  var latitude = parseFloat(data.latitude)
  var longitude = parseFloat(data.longitude)
  var valid = isFinite(latitude) && isFinite(longitude) && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180
  return {
    // Shown in the sky, so bounded and stripped of anything markup-shaped.
    name: typeof data.name === "string" ? data.name.replace(/[<>&\u0000-\u001f]/g, "").trim().slice(0, 60) : "",
    latitude: valid ? latitude : null,
    longitude: valid ? longitude : null
  }
}

// Coordinates go out rounded to about a kilometre: enough for weather.
function forecastUrl(latitude, longitude) {
  var lat = Number(latitude), lon = Number(longitude)
  if (!isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return ""
  return "https://api.open-meteo.com/v1/forecast"
    + "?latitude=" + lat.toFixed(2)
    + "&longitude=" + lon.toFixed(2)
    + "&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,is_day"
    + ",cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high"
    + ",wind_speed_10m,wind_direction_10m,wind_gusts_10m,visibility"
    + "&daily=sunrise,sunset,weather_code,temperature_2m_max,temperature_2m_min"
    // The hours: a day back, so the whole of today is covered whenever it is
    // asked, and two ahead. Each as the present reading is, with what falls.
    + "&hourly=weather_code,temperature_2m,apparent_temperature,relative_humidity_2m"
    + ",precipitation,precipitation_probability"
    + ",cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high"
    + ",wind_speed_10m,wind_direction_10m,wind_gusts_10m,visibility"
    + "&past_hours=24&forecast_hours=48"
    // And the next two hours a quarter at a time, for what is about to fall.
    + "&minutely_15=precipitation,weather_code&past_minutely_15=0&forecast_minutely_15=8"
    + "&past_days=1&forecast_days=5&timeformat=unixtime&timezone=auto"
}

// ---------------------------------------------------------------- sun, moon

// 0 new, 0.25 first quarter, 0.5 full, 0.75 last quarter.
// The forecast from today on, by the date where the place is: today's own
// reading, and up to `count` of the days after it, each with its weekday
// (0 is Sunday).
function forecastDays(forecast, now, count) {
  return forecastFrom(forecast, placeDay(forecast, now), count)
}

// Which day it is where the forecast's place is, counted from 1970.
function placeDay(forecast, now) {
  return Math.floor((now / 1000 + (forecast ? Number(forecast.offset) || 0 : 0)) / 86400)
}

// forecastDays(), given the day it is there.
function forecastFrom(forecast, today, count) {
  var f = forecast || {}
  var days = isList(f.days) ? f.days : []
  var most = count === undefined ? 4 : count
  var out = { today: null, next: [] }
  for (var i = 0; i < days.length; i++) {
    var d = days[i]
    if (d.day === today) out.today = d
    else if (d.day > today && out.next.length < most)
      out.next.push({ day: d.day, weekday: (((d.day + 4) % 7) + 7) % 7, code: d.code, high: d.high, low: d.low })
  }
  return out
}

// Where to ask which places a typed name could be. The name is whatever was
// typed into the panel's city field; nothing else goes with it.
function geocodeUrl(query) {
  var name = String(query === undefined || query === null ? "" : query).replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 80)
  if (name.length < 2) return ""
  return "https://geocoding-api.open-meteo.com/v1/search?name=" + encodeURIComponent(name) + "&count=5&language=en&format=json"
}

// The places that came back: [{name, description, latitude, longitude}],
// the description being the region and country. Shown in the panel, so
// bounded and stripped of anything markup-shaped, like a location's name.
function parseGeocoding(raw) {
  var data
  try {
    data = JSON.parse(String(raw || ""))
  } catch (e) {
    return []
  }
  var results = data && typeof data === "object" && isList(data.results) ? data.results : []
  function clean(value) {
    return typeof value === "string" ? value.replace(/[<>&\u0000-\u001f]/g, "").trim().slice(0, 60) : ""
  }
  var out = []
  for (var i = 0; i < results.length && out.length < 5; i++) {
    var r = results[i]
    if (!r || typeof r !== "object") continue
    var latitude = parseFloat(r.latitude), longitude = parseFloat(r.longitude)
    var name = clean(r.name)
    if (!name || !isFinite(latitude) || !isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) continue
    var parts = []
    if (clean(r.admin1)) parts.push(clean(r.admin1))
    if (clean(r.country)) parts.push(clean(r.country))
    out.push({ name: name, description: parts.join(", "), latitude: latitude, longitude: longitude })
  }
  return out
}

function moonPhase(now) {
  var phase = ((Number(now) - NEW_MOON_EPOCH) % SYNODIC_MONTH) / SYNODIC_MONTH
  return phase < 0 ? phase + 1 : phase
}

// The moon as a glyph of the icon font, lit as far as it is: the font has
// twenty-eight of them, from new round to new again.
function moonGlyph(phase) {
  var p = Number(phase)
  if (!isFinite(p)) p = 0
  p = ((p % 1) + 1) % 1
  return String.fromCharCode(0xe38d + Math.round(p * 28) % 28)
}

function moonPhaseKey(phase) {
  var p = ((phase % 1) + 1) % 1
  if (p < 0.03 || p > 0.97) return "newMoon"
  if (p < 0.22) return "waxingCrescent"
  if (p < 0.28) return "firstQuarter"
  if (p < 0.47) return "waxingGibbous"
  if (p < 0.53) return "fullMoon"
  if (p < 0.72) return "waningGibbous"
  if (p < 0.78) return "lastQuarter"
  return "waningCrescent"
}

// The sunrise and sunset around `now`: the forecast's when it has them,
// otherwise half past six, morning and evening, by the system clock.
function solarDay(now, sunrises, sunsets) {
  var rises = (sunrises || []).slice().sort(function(a, b) { return a - b })
  var sets = (sunsets || []).slice().sort(function(a, b) { return a - b })

  function clockTime(dayOffset, hours, minutes) {
    var d = new Date(now)
    d.setDate(d.getDate() + dayOffset)
    d.setHours(hours, minutes, 0, 0)
    return d.getTime()
  }

  function lastBefore(list, t) {
    var found = null
    for (var i = 0; i < list.length; i++) if (list[i] <= t) found = list[i]
    return found
  }

  function firstAfter(list, t) {
    for (var i = 0; i < list.length; i++) if (list[i] > t) return list[i]
    return null
  }

  var known = rises.length > 0 && sets.length > 0
  var lastRise = known ? lastBefore(rises, now) : null
  var lastSet = known ? lastBefore(sets, now) : null
  var nextRise = known ? firstAfter(rises, now) : null
  var nextSet = known ? firstAfter(sets, now) : null

  if (!known || (lastRise === null && lastSet === null) || (nextRise === null && nextSet === null)) {
    var today = [clockTime(0, 6, 30), clockTime(0, 18, 30)]
    if (now < today[0]) return { isDay: false, start: clockTime(-1, 18, 30), end: today[0], estimated: true }
    if (now < today[1]) return { isDay: true, start: today[0], end: today[1], estimated: true }
    return { isDay: false, start: today[1], end: clockTime(1, 6, 30), estimated: true }
  }

  // Day when the latest event behind us is a sunrise.
  var isDay = lastRise !== null && (lastSet === null || lastRise > lastSet)
  if (isDay) return { isDay: true, start: lastRise, end: nextSet !== null ? nextSet : lastRise + DAY / 2, estimated: false }
  return {
    isDay: false,
    start: lastSet !== null ? lastSet : nextRise - DAY / 2,
    end: nextRise !== null ? nextRise : lastSet + DAY / 2,
    estimated: false
  }
}

// Where a body rides its arc over the desktop: up from below the bottom of
// the screen beside it, over the top, and down the other side. The path is
// squared off like a rounded box so it clears the desktop's corners rather
// than passing behind them. geometry: {width, height, margin (the strip of
// sky to each side of the desktop)}.
function arcPosition(progress, geometry, radius) {
  var cx = geometry.width / 2
  var side = Math.max(radius * 1.25, (geometry.margin || 0) / 2)
  var rx = Math.max(cx - side, radius)
  var ground = geometry.height + radius * 1.3
  var ry = ground - (radius * 1.35 + 8)
  var angle = Math.PI * clamp(progress, 0, 1)
  var c = Math.cos(angle), s = Math.sin(angle)
  return {
    x: cx - rx * (c < 0 ? -1 : 1) * Math.pow(Math.abs(c), 0.56),
    y: ground - ry * Math.pow(Math.max(s, 0), 0.56)
  }
}

// How light it is at a moment of a solarDay(): dayness 0 (night) to 1 (day),
// and how much of dawn or dusk is in it. Twilight is about half an hour
// either side of sunrise and sunset.
function dayLight(now, day) {
  var sinceStart = (now - day.start) / MINUTE
  var untilEnd = (day.end - now) / MINUTE
  if (day.isDay) {
    return {
      dayness: Math.min(smoothstep(-25, 35, sinceStart), smoothstep(-25, 35, untilEnd)),
      twilight: Math.max(Math.exp(-Math.pow(sinceStart / 42, 2)), Math.exp(-Math.pow(untilEnd / 42, 2)))
    }
  }
  return {
    dayness: Math.max(1 - smoothstep(-35, 25, sinceStart), 1 - smoothstep(-35, 25, untilEnd)),
    twilight: Math.max(Math.exp(-Math.pow(sinceStart / 34, 2)), Math.exp(-Math.pow(untilEnd / 34, 2)))
  }
}

// The light along a whole day, for drawing it as a ruler: `slices` readings
// from `dayStart` on, each as dayLight() has it. It goes by the same sunrises
// and sunsets the sky does, so the ruler shows the day the sky will show,
// even for a place whose day does not line up with this clock's.
function dayBand(dayStart, sunrises, sunsets, slices) {
  var n = Math.max(1, Math.min(288, Math.round(slices) || 96))
  var out = []
  for (var i = 0; i < n; i++) {
    var at = dayStart + (i + 0.5) / n * DAY
    out.push(dayLight(at, solarDay(at, sunrises, sunsets)))
  }
  return out
}

// Everything about the sky that follows from the clock. `phase` overrides the
// moon's real phase when it is 0..1.
function celestial(now, sunrises, sunsets, geometry, latitude, phase) {
  var day = solarDay(now, sunrises, sunsets)
  var span = Math.max(day.end - day.start, MINUTE)
  var progress = clamp((now - day.start) / span, 0, 1)

  var light = dayLight(now, day)
  var dayness = light.dayness, twilight = light.twilight
  var sinceStart = (now - day.start) / MINUTE
  var untilEnd = (day.end - now) / MINUTE

  var radius = clamp(geometry.height * 0.04, 22, 54)
  var arc = arcPosition(progress, geometry, radius)
  var forced = Number(phase)
  phase = phase !== null && phase !== undefined && isFinite(forced) && forced >= 0 ? forced % 1 : moonPhase(now)
  var edge = Math.max(radius * 1.25, (geometry.margin || 0) / 2)
  // The glow pools where the sun is coming up or went down.
  var glowX = day.isDay ? arc.x : (sinceStart < untilEnd ? geometry.width - edge : edge)

  return {
    isDay: day.isDay,
    estimated: day.estimated,
    progress: progress,
    start: day.start,
    end: day.end,
    dayness: dayness,
    twilight: twilight,
    glowX: glowX,
    sun: { x: arc.x, y: arc.y, radius: radius, visible: day.isDay ? 1 : 0, low: 1 - Math.sin(Math.PI * progress) },
    moon: {
      x: arc.x, y: arc.y, radius: radius, visible: day.isDay ? 0 : 1,
      phase: phase, key: moonPhaseKey(phase),
      // How much of the face is lit, 0..1.
      lit: 0.5 - 0.5 * Math.cos(2 * Math.PI * phase),
      // The lit side swaps south of the equator.
      flip: Number(latitude) < 0 ? -1 : 1
    }
  }
}

// The sky with the hour taken out of it: no sun, no moon, no stars, no
// dawn or dusk, and a plain daylight that never changes. It is what is left
// when only the weather is wanted. `amount` runs 0 (the sky as the clock has
// it) to 1 (steady), so that one turns into the other and does not cut.
function steadySky(sky, amount) {
  var k = clamp(amount, 0, 1)
  if (k <= 0) return sky
  var out = {}
  for (var key in sky) out[key] = sky[key]
  var sun = {}, moon = {}
  for (var a in sky.sun) sun[a] = sky.sun[a]
  for (var b in sky.moon) moon[b] = sky.moon[b]
  sun.visible = sky.sun.visible * (1 - k)
  moon.visible = sky.moon.visible * (1 - k)
  out.sun = sun
  out.moon = moon
  out.dayness = mix(sky.dayness, 1, k)
  out.twilight = sky.twilight * (1 - k)
  out.steady = k
  return out
}

// The sunrises and sunsets the sky goes by in a mode. Every mode that keeps
// the day's own clock uses the real ones, as the forecast has them, so that
// at the same hour the sun and moon are in the same place whichever mode is
// on: live, by hand, a preview. Only the demo has a made-up day (none here,
// which solarDay takes as half past six to half past six), because its
// hours are written around one.
function dayEvents(mode, forecast) {
  if (mode === "demo" || !forecast) return { sunrise: [], sunset: [] }
  return { sunrise: forecast.sunrise || [], sunset: forecast.sunset || [] }
}

// When the sun comes up and goes down today, as hours of the day, for
// drawing the day along a ruler. Without real times, half past six both ends.
function dayMarks(now, sunrises, sunsets) {
  var midnight = startOfDay(now)
  var noon = solarDay(midnight + DAY / 2, sunrises, sunsets)
  if (!noon.isDay) return { rise: 6.5, set: 18.5 }
  return {
    rise: clamp((noon.start - midnight) / 3600000, 0, 12),
    set: clamp((noon.end - midnight) / 3600000, 12, 24)
  }
}

// ------------------------------------------------------------------- scene

// The uniforms the shaders take, as plain numbers and "#rrggbb" strings.
//   palette   derivePalette()
//   sky       celestial()
//   weather   weatherFromCode()
//   geometry  {width, height, deck (y of the desktop's top edge once it has
//             stepped back), desk: {x, y, width, height} | null}
// What changes every frame (time, cloud drift, lightning, lying snow) is not
// here: the service sets those itself, so this only reruns when the sky
// really changes.
// How much of the wallpaper the sky covers, as a share of the most it may.
// Two things bring it in. The hour: at midday the sky is a wash that leaves
// the wallpaper plain to see, it deepens as the sun comes up or goes down so
// the glow has something to be in, and at night it is most of the way to
// dark. And the weather: cloud, rain, snow and fog close it in the rest of
// the way, the more the worse they are.
//
// `steady` (0..1) is how far the hour has been switched out of the sky (see
// steadySky): what the hour brings in goes with it, down to nothing, so a
// clear sky with no hour in it is the wallpaper as it is, and only the
// weather is left to close it.
function skyWash(weather, dayness, twilight, steady) {
  var w = weather || {}
  var day = clamp(dayness === undefined ? 1 : dayness, 0, 1)
  var still = clamp(steady || 0, 0, 1)
  var v = Math.max(0.30, 0.62 * clamp(twilight || 0, 0, 1), 0.70 * (1 - day)) * (1 - still)
  v = Math.max(v, 0.7 * smoothstep(0.15, 0.95, w.cover || 0))
  // Rain and snow close it in by how much of the sky their clouds take: a
  // lone cloud pouring leaves the rest of the sky as it was.
  var under = 0.3 + 0.7 * smoothstep(0.15, 0.8, w.cover || 0)
  v = Math.max(v, smoothstep(0, 0.2, w.rain || 0) * (0.6 + 0.4 * (w.rain || 0)) * under)
  v = Math.max(v, smoothstep(0, 0.2, w.snow || 0) * (0.6 + 0.4 * (w.snow || 0)) * under)
  v = Math.max(v, smoothstep(0, 0.25, w.fog || 0) * (0.55 + 0.45 * (w.fog || 0)))
  v = Math.max(v, (w.storm || 0) * under)
  v = clamp(v, 0, 1)
  // With the hour out, a little weather is a little wash, not a quarter.
  return mix(0.25, 1, v) * mix(1, smoothstep(0, 0.2, v), still)
}

// Where the rainbow stands: a circle, drawn from its inmost band outward.
// The desktop fills the middle of the screen, so a bow that only crossed the
// middle would be lost behind the windows. This one is fitted round them:
// its crown halfway up the sky above the desktop, and its feet coming down
// through the middle of the margins beside it, so that it reads as an arch
// over the windows. It stands on the side away from the sun (`side`: -1 the
// left half, 1 the right), and the shader thins it out toward the sun's.
function bowShape(geometry, sunX) {
  var w = geometry.width, h = geometry.height
  var margin = geometry.margin > 0 ? geometry.margin : w * 0.11
  var deck = geometry.deck > 0 ? geometry.deck : h * 0.21
  var crown = deck * 0.5
  var reach = w / 2 - margin * 0.5
  var foot = deck + (h - deck) * 0.55
  // The circle through (middle ± reach, foot) whose top is at `crown`.
  var y = (reach * reach + foot * foot - crown * crown) / (2 * (foot - crown))
  return { x: w / 2, y: y, radius: y - crown, side: sunX > w / 2 ? -1 : 1 }
}

function sceneUniforms(palette, sky, weather, geometry) {
  var d = sky.dayness
  // How far the hour is switched out of this sky (steadySky).
  var steady = sky.steady || 0
  var cover = weather.cover
  var storm = weather.storm

  var top = mixColor(palette.nightTop, palette.dayTop, d)
  var bottom = mixColor(palette.nightBottom, palette.dayBottom, d)
  // Overcast drains the gradient toward grey, and a storm deepens the top.
  var grey = mixColor(palette.overcastNight, palette.overcastDay, d)
  var drained = smoothstep(0.55, 1.0, cover) * 0.8
  top = mixColor(top, mixColor(grey, palette.ink, 0.18 + 0.32 * storm), drained)
  bottom = mixColor(bottom, grey, drained)

  var cloudLight = mixColor(palette.cloudLightNight, palette.cloudLightDay, d)
  var cloudShade = mixColor(palette.cloudShadeNight, palette.cloudShadeDay, d)
  // Sunrise and sunset light the cloud tops; a storm puts them out.
  cloudLight = mixColor(cloudLight, palette.glow, sky.twilight * 0.38 * (1 - storm * 0.6))
  cloudShade = mixColor(cloudShade, palette.stormShade, storm * 0.75)
  cloudLight = mixColor(cloudLight, cloudShade, storm * 0.5)

  var sunColor = mixColor(palette.sun, palette.sunLow, smoothstep(0.55, 1.0, sky.sun.low) * 0.85)
  var sunCore = mixColor(sunColor, palette.paper, 0.6)
  // With the hour out the light is plain day, from high overhead where no
  // sun is drawn.
  var daylight = steady > 0.5
  var sunUp = sky.sun.visible > 0 || daylight
  var up = daylight ? { x: geometry.width * 0.5, y: -geometry.height * 0.25, radius: sky.sun.radius }
                    : (sky.sun.visible > 0 ? sky.sun : sky.moon)
  var desk = geometry.desk
  var falling = weather.rain > 0 || weather.snow > 0 || weather.hail > 0
  // The cloud at each height, where it is known apart: the high lane is
  // thin wisps, the middle one cumulus, and the low one is what rains.
  var lowCover = weather.coverLow === undefined ? cover : weather.coverLow
  var midCover = weather.coverMid === undefined ? cover : weather.coverMid
  var highCover = weather.coverHigh === undefined ? cover : weather.coverHigh
  // Rain and snow fall only out of the near lane's clouds, and how hard is
  // not a matter of how many there are: a few clouds can pour. So the lane
  // follows the cover; while anything is falling it only keeps enough for
  // there to be a cloud to fall from.
  var nearCover = falling ? Math.max(lowCover, 0.16) : lowCover
  // How fast lying snow is going, 0..1: it drips off the windows as it does.
  var thaw = known(weather.temperature) ? smoothstep(0.5, 5, weather.temperature) : (weather.snow > 0.01 ? 0 : 0.7)
  // A rainbow wants rain falling and the sun out and low, behind the viewer:
  // it stands on the side of the sky away from the sun.
  var rainbow = sunUp ? smoothstep(0.04, 0.3, weather.rain) * (1 - smoothstep(0.5, 0.92, cover))
                        * smoothstep(0.22, 0.55, sky.sun.low) * (1 - weather.fog) * (1 - steady) : 0
  var bow = bowShape(geometry, sky.sun.x)
  // A ring round the moon wants thin high cloud in front of it and nothing
  // thicker below.
  var halo = !sunUp && !falling ? smoothstep(0.12, 0.4, highCover) * (1 - smoothstep(0.7, 0.95, Math.max(lowCover, midCover)))
                                   * (0.3 + 0.7 * sky.moon.lit) * (1 - steady) : 0
  var veil = smoothstep(0.72, 1.0, cover)
  var fogColor = toHex(mixColor(palette.fogNight, palette.fogDay, d))

  return {
    // Text laid over the sky: the theme's lightest tone on a dark sky, its
    // darkest on a light one.
    // The share of its opacity the sky is drawn at in this weather.
    wash: skyWash(weather, d, sky.twilight, steady),
    ink: toHex(luminance(top) < 0.5 ? palette.paper : palette.ink),
    // What goes behind that text to set it off: the opposite tone.
    scrim: toHex(luminance(top) < 0.5 ? palette.ink : palette.paper),
    glowColor: toHex(palette.glow),
    scene: {
      dayness: d,
      twilight: sky.twilight * (1 - drained * 0.7),
      glowX: sky.glowX,
      sunVis: sky.sun.visible,
      moonVis: sky.moon.visible,
      moonPhase: sky.moon.phase,
      moonFlip: sky.moon.flip,
      bodyRadius: up.radius,
      cover: midCover,
      coverHigh: highCover,
      nearCover: nearCover,
      veil: veil,
      hail: weather.hail || 0,
      gust: weather.gust || 0,
      thaw: thaw,
      rainbow: rainbow,
      bowX: bow.x,
      bowY: bow.y,
      bowR: bow.radius,
      bowSide: bow.side,
      halo: halo,
      bowOuter: toHex(palette.bowOuter),
      bowMiddle: toHex(palette.bowMiddle),
      bowInner: toHex(palette.bowInner),
      storm: storm,
      deck: geometry.deck,
      // The moon lights clouds too, by how much of it is lit.
      shine: (sunUp ? 1 : 0.2 + 0.4 * sky.moon.lit) * (1 - storm * 0.55),
      rain: weather.rain,
      snow: weather.snow,
      fog: weather.fog,
      wind: weather.wind,
      sunPos: [sky.sun.x, sky.sun.y],
      moonPos: [sky.moon.x, sky.moon.y],
      lightPos: [up.x, up.y],
      skyTop: toHex(top),
      skyBottom: toHex(bottom),
      glowColor: toHex(palette.glow),
      sunColor: toHex(sunColor),
      sunCore: toHex(sunCore),
      moonColor: toHex(palette.moon),
      starColor: toHex(palette.star),
      cloudLight: toHex(cloudLight),
      cloudShade: toHex(cloudShade),
      hazeColor: toHex(mixColor(top, bottom, 0.35)),
      lightColor: toHex(sunUp ? sunCore : palette.moon),
      rainColor: toHex(mixColor(palette.rain, palette.nightBottom, (1 - d) * 0.25)),
      snowColor: toHex(mixColor(palette.snow, palette.nightBottom, (1 - d) * 0.12)),
      shadeColor: toHex(mixColor(cloudShade, palette.snow, 0.45)),
      fogColor: fogColor,
      flashColor: toHex(palette.flash)
    }
  }
}

// What a quality setting turns on. Low keeps the weather behind the windows
// on a coarser canvas at half the frame rate; medium brings some of it in
// front and lets a hot day shimmer; high makes it physical, landing on each
// window; ultra adds more of it, steps it on every frame the screen shows,
// and draws the shapes (clouds, sun, moon, lying snow) on a canvas twice as
// fine. What falls or flashes is never drawn finer than four pixels,
// whatever `pixel` says: the shader holds it to the art's grid.
//
// frameRate 0 is every frame. `blur` is the soft patch behind the words in
// the corner.
function qualityFor(name) {
  var q = String(name || "").toLowerCase()
  if (q === "low") return { name: "low", detail: 0, pixel: 5, frameRate: 30, blur: false, shimmer: false }
  if (q === "high") return { name: "high", detail: 2, pixel: 4, frameRate: 60, blur: true, shimmer: true }
  if (q === "ultra") return { name: "ultra", detail: 3, pixel: 2, frameRate: 0, blur: true, shimmer: true }
  return { name: "medium", detail: 1, pixel: 4, frameRate: 60, blur: true, shimmer: true }
}

// The quality a machine can carry, from what the installer can see of it:
// `renderer` is the GL renderer's name, memory is in GiB.
// One level down from a quality, for running on battery: the sky costs the
// most of anything the shell draws. Low is as low as it goes.
function easedQuality(name) {
  var q = qualityFor(name).name
  return q === "ultra" ? "high" : q === "high" ? "medium" : "low"
}

function suggestQuality(renderer, cores, memory) {
  var r = String(renderer || "").toLowerCase()
  var software = r === "" || /llvmpipe|softpipe|software/.test(r)
  if (software || cores <= 2 || memory < 3.5) return "low"
  // A GPU reached through a virtual machine works, at a cost.
  var virtual = /virgl|virtio|vmware|svga|venus|parallels/.test(r)
  if (virtual || cores < 6 || memory < 7) return "medium"
  return "high"
}

// Up to six windows for the weather to land on, as [x, y, width, height]
// each, where they lie once the desktop has stepped back. Unused slots are
// zeros. Fullscreen and floating windows are in the list too: rain does not
// know the difference.
function windowRects(windows, placement) {
  var out = []
  var list = windows || []
  for (var i = 0; i < 6; i++) {
    if (i < list.length) {
      var r = placed(list[i], placement, 1)
      out.push([r.x, r.y, r.width, r.height])
    } else {
      out.push([0, 0, 0, 0])
    }
  }
  return out
}

// One reading eased toward another: the sky does not jump from fair to
// storm, it turns. Numbers blend; the name follows whichever is nearer.
function mixWeather(a, b, t) {
  if (!a) return b
  var k = clamp(t, 0, 1)
  var out = {}
  var fields = ["cover", "coverLow", "coverMid", "coverHigh", "precip", "rain", "snow", "hail", "fog", "thunder", "storm",
                "wind", "gust", "windPx"]
  var settled = true
  for (var i = 0; i < fields.length; i++) {
    var f = fields[i]
    var from = a[f] === undefined ? b[f] : a[f]
    var v = mix(from, b[f], k)
    if (Math.abs(v - b[f]) < 0.004 * (f === "windPx" ? 50 : 1)) v = b[f]
    else settled = false
    out[f] = v
  }
  // The temperature turns too, where there is one at both ends.
  if (known(a.temperature) && known(b.temperature)) {
    var warm = mix(a.temperature, b.temperature, k)
    if (Math.abs(warm - b.temperature) < 0.05) warm = b.temperature
    else settled = false
    out.temperature = warm
  } else {
    out.temperature = b.temperature
  }
  out.key = k > 0.5 || settled ? b.key : a.key
  out.code = k > 0.5 || settled ? b.code : a.code
  out.settled = settled
  return out
}

// Every state set by hand, as the debug panel has it: how much cloud, how
// hard it is coming down, how warm it is (which decides what comes down),
// fog, wind in km/h (negative blows left), and whether there is thunder or
// hail in it.
function manualWeather(m) {
  var s = m || {}
  var precip = clamp(s.precip, 0, 1), fog = clamp(s.fog, 0, 1)
  var cover = clamp(s.cover, 0, 1), thunder = s.thunder ? 1 : 0, hail = s.hail ? 1 : 0
  var temperature = known(s.temperature) ? Number(s.temperature) : 15
  var frozen = precip > 0 ? frozenShare(temperature, 0) : 0
  var rain = precip * (1 - frozen), snow = precip * frozen
  var speed = clamp(Math.abs(Number(s.wind) || 0), 0, 150)
  var heading = Number(s.wind) < 0 ? -1 : 1
  var falling = precip > 0.8 ? "heavyRain" : precip > 0.5 ? "rain" : precip > 0.3 ? "lightRain" : "drizzle"
  var key = thunder ? "thunderstorm"
    : hail && precip > 0.02 ? "hail"
    : precip > 0.02 ? fallingKey(falling, frozen)
    : fog > 0.4 ? "fog"
    : cover > 0.8 ? "overcast" : cover > 0.35 ? "partlyCloudy" : cover > 0.1 ? "mostlyClear" : "clear"
  return {
    code: -1,
    key: key,
    cover: cover,
    coverLow: cover,
    coverMid: cover,
    coverHigh: cover,
    temperature: temperature,
    precip: precip,
    rain: rain,
    snow: snow,
    hail: precip > 0.02 ? hail : 0,
    fog: fog,
    thunder: thunder,
    storm: clamp(thunder * 0.6 + rain * 0.7 + snow * 0.25 + hail * 0.2, 0, 1),
    wind: heading * clamp(0.18 + speed / 55, 0.18, 1),
    gust: smoothstep(12, 70, speed),
    windPx: heading * (6 + Math.min(speed, 120) * 1.5)
  }
}

// No weather at all: an empty, still sky. It is what the scene turns toward
// when the weather is switched off and only the hour is left to show. Mild,
// so that nothing in it freezes or shimmers.
function calmWeather() {
  return {
    code: -1, key: "clear", cover: 0, coverLow: 0, coverMid: 0, coverHigh: 0, temperature: 12,
    precip: 0, rain: 0, snow: 0, hail: 0, fog: 0, thunder: 0, storm: 0, wind: 0.18, gust: 0, windPx: 6
  }
}

// How deep snow lies where nothing disturbs it, a moment later. It deepens
// with the fall; it goes with the warmth, faster the warmer it is, and in
// the cold it stays where it fell after the snow has stopped. With no
// temperature to go by it simply melts once the fall is over.
var LYING_MOST = 26
function lyingStep(depth, weather, dt) {
  var w = weather || {}
  var snow = w.snow || 0
  var grow = snow > 0.01 ? 0.25 + 1.6 * snow : 0
  var melt = known(w.temperature) ? clamp((Number(w.temperature) - 0.5) * 0.35, 0, 4) : (snow > 0.01 ? 0 : 1.2)
  return clamp((depth || 0) + (grow - melt) * clamp(dt || 0, 0, 0.25), 0, LYING_MOST)
}

// The demo: a day and a night in a minute and a half, with weather to suit
// each hour. Every scene holds for DEMO_SCENE seconds while the clock sweeps
// two hours.
var DEMO_SCENE = 7
var DEMO = [
  { code: 0, temperature: 14 }, { code: 2, temperature: 19 }, { code: 81, temperature: 21 },
  { code: 0, temperature: 39 }, { code: 3, temperature: 24 }, { code: 99, temperature: 19, wind: 40 },
  { code: 80, temperature: 15 }, { code: 63, temperature: 1 }, { code: 73, temperature: -4 },
  { code: 75, temperature: -9, wind: 75 }, { code: 45, temperature: -2 }, { code: 1, temperature: 6 }
]

// Where the demo is `seconds` in: which weather, and what hour of the day.
function demoState(seconds) {
  var s = Math.max(0, Number(seconds) || 0)
  var step = Math.floor(s / DEMO_SCENE) % DEMO.length
  return {
    step: step,
    code: DEMO[step].code,
    temperature: DEMO[step].temperature === undefined ? null : DEMO[step].temperature,
    wind: DEMO[step].wind === undefined ? 16 : DEMO[step].wind,
    // It opens at dawn.
    hour: (5.5 + (s / DEMO_SCENE) * 2) % 24
  }
}

// Where the desktop goes when it steps back: scaled to `scale` about a point
// low on the screen, so it ends up centred with a small margin beneath it and
// the sky above and beside. width and height are the scene's.
function deskPlacement(width, height, scale) {
  var s = clamp(scale, 0.35, 0.94)
  var beneath = Math.round(height * 0.045)
  var pivotY = height - beneath / (1 - s)
  return {
    scale: s,
    pivotX: width / 2,
    pivotY: pivotY,
    // The frame the whole desktop lands in.
    x: width * (1 - s) / 2,
    y: pivotY * (1 - s),
    width: width * s,
    height: height * s
  }
}

// A rectangle of the full-size desktop, as it lies once stepped back by
// `amount` (0 where it was, 1 fully back).
function placed(rect, placement, amount) {
  var s = 1 - (1 - placement.scale) * amount
  return {
    x: placement.pivotX + (rect.x - placement.pivotX) * s,
    y: placement.pivotY + (rect.y - placement.pivotY) * s,
    width: rect.width * s,
    height: rect.height * s
  }
}

// The room the sky takes from the workspace on each side, in whole pixels:
// what is left is the frame of `deskPlacement`. A strip along each edge of
// the screen keeps that much to itself, so Hyprland lays the windows out in
// the frame: they are the real windows, only smaller.
function frameMargins(width, height, scale) {
  var f = deskPlacement(width, height, scale)
  var left = Math.round(f.x), top = Math.round(f.y)
  return { left: left, top: top,
           right: Math.max(0, Math.round(width - f.x - f.width)),
           bottom: Math.max(0, Math.round(height - f.y - f.height)) }
}

// Where each window is drawn while the scene glides. The real windows jump
// to their new places at once; a still of each crosses from where it was to
// where it now is. `rest` and `back` are the windows' rectangles by address
// with the room given back and with it taken; one missing is taken to be
// where the window is now. `presence` under 0 is no glide: the windows as
// they are.
function shownWindows(windows, rest, back, presence) {
  var list = windows || []
  if (!(presence >= 0)) return list
  var k = clamp(presence, 0, 1)
  var out = []
  for (var i = 0; i < list.length; i++) {
    var w = list[i]
    var a = (rest && rest[w.address]) || w, b = (back && back[w.address]) || w
    out.push({ address: w.address, index: w.index, toplevel: w.toplevel, floating: w.floating, fullscreen: w.fullscreen, bar: w.bar || 0,
               x: mix(a.x, b.x, k), y: mix(a.y, b.y, k), width: mix(a.width, b.width, k), height: mix(a.height, b.height, k) })
  }
  return out
}

// ------------------------------------------------------------------ ledges
//
// Snow lies on each window on its own account. Left alone it deepens with
// the fall; moved or resized it is shaken off and has to fall again; and
// where a window jumps away or closes, what lay on it is left hanging for a
// moment and melts where it was. The ground under a window is kept clear
// only once the window has been over it a while, and fills back in once it
// has gone.

// How many the shader takes.
var LEDGES = 6
// The longest an icicle gets, in pixels.
var ICICLE_MOST = 24

function overlapShare(a, b) {
  var w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
  var h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
  var area = a.width * a.height
  return w > 0 && h > 0 && area > 0 ? w * h / area : 0
}

// One step of the snow on a workspace's windows. `state` is what the last
// step returned (null to begin); `windows` where they are now.
//
//   dt       seconds since the last step
//   lying    how deep snow lies on a ledge nothing has disturbed
//   rate     how fast a disturbed one catches up, pixels a second
//   scope    the workspace; a different one starts afresh
//   carried  the scene itself is moving the windows (its glide), which
//            disturbs nothing
//   temperature  degrees C, or null: below freezing, water running off a
//            window's bottom edge freezes there into icicles, which need
//            snow lying on the window to melt or rain falling to feed them
//   glaze    how hard rain is falling while it is below freezing
//   cloudBase  how far down the screen the clouds that snow and rain fall
//            from have their bases. A window whose top is above that is
//            above the weather: nothing lands on it, so nothing builds
function ledgeStep(state, windows, opts) {
  var o = opts || {}
  var s = state && state.scope === o.scope ? state : { scope: o.scope, fresh: true, ledges: {}, ghosts: [] }
  var dt = clamp(o.dt || 0, 0, 0.25)
  var lying = Math.max(0, o.lying || 0)
  var rate = Math.max(0, o.rate || 0)
  var cold = known(o.temperature) ? Number(o.temperature) : null
  var glaze = clamp(o.glaze || 0, 0, 1)
  var base = known(o.cloudBase) ? Number(o.cloudBase) : -1e9
  var list = windows || []
  var next = {}

  function leave(l) {
    if (o.carried || (l.depth <= 1 && l.shelter <= 0.05)) return
    s.ghosts.push({ x: l.x, y: l.y, width: l.width, height: l.height, depth: l.depth, shelter: l.shelter })
  }

  for (var i = 0; i < list.length; i++) {
    var w = list[i]
    var l = s.ledges[w.address]
    if (!l) {
      // What is here when the sky arrives has the snow that is lying, if it
      // is under the clouds; what turns up later starts bare.
      l = { depth: s.fresh ? lying * smoothstep(base - 24, base + 12, w.y) : 0, melt: 0, shelter: s.fresh ? 1 : 0, ice: 0 }
    } else if (!o.carried) {
      var moved = Math.abs(w.x - l.x) + Math.abs(w.y - l.y) + Math.abs(w.width - l.width) + Math.abs(w.height - l.height)
      if (moved > 0.5) {
        if (overlapShare(l, w) < 0.5) {
          // Gone somewhere else: the snow stays behind.
          leave(l)
          l.depth = 0
          l.melt = 0
          l.shelter = 0
          // And its icicles have broken off.
          l.ice = 0
        } else {
          // Shaken: the further it moves the more comes off.
          l.melt = Math.min(l.depth, l.melt + l.depth * (1 - Math.exp(-moved / 90)))
          l.shelter *= Math.exp(-moved / 140)
          l.ice = (l.ice || 0) * Math.exp(-moved / 60)
        }
      }
    }
    l.x = w.x
    l.y = w.y
    l.width = w.width
    l.height = w.height
    // How far under the clouds its top is: 0 above their bases, where
    // nothing falls, 1 once it is clear of them.
    var under = smoothstep(base - 24, base + 12, w.y)
    if (l.melt > 0.01) {
      var step = Math.min(l.melt, Math.max(l.melt * (1 - Math.exp(-dt / 0.2)), 12 * dt))
      l.depth = Math.max(0, l.depth - step)
      l.melt -= step
    } else {
      l.melt = 0
      l.depth = l.depth < lying ? Math.min(lying, l.depth + rate * under * dt) : lying
      l.shelter = Math.min(1, l.shelter + dt / 8)
    }
    // Icicles grow in the cold while there is something to feed them, and go
    // in the warm, faster the warmer it is.
    var ice = l.ice || 0
    if (cold === null) ice = Math.max(0, ice - 1.5 * dt)
    else if (cold < -0.5 && (l.depth > 2 || glaze * under > 0.05))
      ice = Math.min(ICICLE_MOST, ice + dt * (0.5 + 0.6 * clamp(-cold / 8, 0, 1) + 2.4 * glaze * under))
    else if (cold > 0.5) ice = Math.max(0, ice - dt * (0.6 + 0.35 * cold))
    l.ice = ice
    next[w.address] = l
  }
  for (var address in s.ledges) if (!next[address]) leave(s.ledges[address])

  var kept = []
  for (var g = 0; g < s.ghosts.length; g++) {
    var ghost = s.ghosts[g]
    ghost.depth = Math.max(0, ghost.depth - Math.max(ghost.depth * (1 - Math.exp(-dt / 0.3)), 10 * dt))
    ghost.shelter = Math.max(0, ghost.shelter - dt / 1.5)
    if (ghost.depth > 0.3 || ghost.shelter > 0.01) kept.push(ghost)
  }
  s.ghosts = kept.length > 4 ? kept.slice(kept.length - 4) : kept
  s.ledges = next
  s.fresh = false
  return s
}

// What the shader is given: up to six ledges as [x, y, width, height], the
// snow on each, how far each shelters the ground, and the deepest. Tiled
// windows come first, then what snow has been left behind where there is
// room for it (from `ghostFrom`), then the floating windows (from
// `floatFrom`). Only the first and last are windows, which matters: nothing
// of the weather is ever drawn on a window.
function ledgeSlots(state, windows) {
  var list = windows || []
  var tiled = [], floating = []
  for (var i = 0; i < list.length; i++) (list[i].floating || list[i].fullscreen ? floating : tiled).push(list[i])
  tiled = tiled.slice(0, LEDGES)
  floating = floating.slice(0, LEDGES - tiled.length)
  var ghosts = state && state.ghosts ? state.ghosts : []
  var room = LEDGES - tiled.length - floating.length
  ghosts = room > 0 ? ghosts.slice(Math.max(0, ghosts.length - room)) : []

  var out = { rects: [], depths: [], shelters: [], ices: [], ghostFrom: LEDGES, floatFrom: LEDGES, deepest: 0, longest: 0 }
  function put(r, depth, shelter, ice) {
    out.rects.push([r.x, r.y, r.width, r.height])
    out.depths.push(depth)
    out.shelters.push(shelter)
    out.ices.push(ice)
    out.deepest = Math.max(out.deepest, depth)
    out.longest = Math.max(out.longest, ice)
  }
  function ledgeOf(w) {
    var l = state && state.ledges ? state.ledges[w.address] : null
    put(w, l ? l.depth : 0, l ? l.shelter : 1, l ? l.ice || 0 : 0)
  }
  for (var t = 0; t < tiled.length; t++) ledgeOf(tiled[t])
  out.ghostFrom = out.rects.length
  for (var g = 0; g < ghosts.length; g++) put(ghosts[g], ghosts[g].depth, ghosts[g].shelter, 0)
  out.floatFrom = out.rects.length
  for (var f = 0; f < floating.length; f++) ledgeOf(floating[f])
  while (out.rects.length < LEDGES) put({ x: 0, y: 0, width: 0, height: 0 }, 0, 0, 0)
  return out
}

// The windows Hyprland lists for a workspace, in the scene's coordinates:
// tiled ones first, floating on top. `clients` holds each window's `hyprctl
// clients -j` object and `index` points back into it; offsetX and offsetY are
// where the scene's own corner sits in Hyprland's layout.
function deskWindows(clients, workspaceId, offsetX, offsetY, bars) {
  var tiled = [], floating = []
  var list = clients || []
  for (var i = 0; i < list.length; i++) {
    var w = list[i]
    if (!w || !w.workspace || w.workspace.id !== workspaceId) continue
    if (w.hidden || w.mapped === false) continue
    if (!isList(w.at) || !isList(w.size) || w.at.length < 2 || w.size.length < 2) continue
    var x = Number(w.at[0]) - offsetX, y = Number(w.at[1]) - offsetY
    var width = Number(w.size[0]), height = Number(w.size[1])
    if (!isFinite(x) || !isFinite(y) || !(width > 0) || !(height > 0)) continue
    var entry = { index: i, x: x, y: y, width: width, height: height, floating: !!w.floating, fullscreen: (w.fullscreen || 0) >= 2,
                  bar: 0, recent: Number(w.focusHistoryID) }
    // A title bar sits on top of the window Hyprland reports and is as much
    // the window as the rest of it: the weather lands on the bar, not under.
    if (bars && bars.height > 0 && !entry.fullscreen && (!bars.tag || tagged(w.tags, bars.tag))) {
      entry.bar = bars.height
      entry.y -= bars.height
      entry.height += bars.height
    }
    if (entry.floating || entry.fullscreen) floating.push(entry)
    else tiled.push(entry)
  }
  // Floating windows lie over one another; the one used last is on top, and
  // goes last.
  floating.sort(function(a, b) {
    var ra = isFinite(a.recent) ? a.recent : 1e9, rb = isFinite(b.recent) ? b.recent : 1e9
    return rb - ra
  })
  return tiled.concat(floating)
}

function tagged(tags, tag) {
  if (!isList(tags)) return false
  for (var i = 0; i < tags.length; i++) if (String(tags[i]).replace(/\*$/, "") === tag) return true
  return false
}

// The title bars Hyprland's hyprbars plugin puts on windows, read from its
// options as `hyprctl getoption ... -j` prints them, one to a line: how tall
// they are, and the tag a window must carry to have one ("" for every
// window). Null where there are none.
function titleBars(raw) {
  var lines = String(raw || "").split("\n")
  var on = false, height = 0, tag = ""
  for (var i = 0; i < lines.length && i < 12; i++) {
    var o
    try {
      o = JSON.parse(lines[i])
    } catch (e) {
      continue
    }
    if (!o || typeof o.option !== "string") continue
    if (/:enabled$/.test(o.option)) on = o.bool === true || o.int === 1
    else if (/:bar_height$/.test(o.option)) height = clamp(Number(o.int) || 0, 0, 200)
    else if (/:workspace_tag$/.test(o.option)) tag = typeof o.str === "string" && /^[\w.:-]{1,80}$/.test(o.str) ? o.str : ""
  }
  return on && height > 0 ? { height: height, tag: tag } : null
}

// The box around a list of rectangles, or null for none.
function bounds(rects) {
  var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  var list = rects || []
  for (var i = 0; i < list.length; i++) {
    x0 = Math.min(x0, list[i].x); y0 = Math.min(y0, list[i].y)
    x1 = Math.max(x1, list[i].x + list[i].width); y1 = Math.max(y1, list[i].y + list[i].height)
  }
  if (!isFinite(x0) || x1 - x0 < 1 || y1 - y0 < 1) return null
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
}

// A lightning strike's brightness `age` seconds in: a hard flash, a flicker
// or two, gone inside half a second.
function flashAt(age) {
  if (age < 0 || age > 0.55) return 0
  var envelope = Math.exp(-age * 7.5)
  var flicker = 0.62 + 0.38 * Math.cos(age * 58)
  var restrike = age > 0.16 && age < 0.24 ? 0.55 : 0
  return clamp(envelope * flicker + restrike * Math.exp(-(age - 0.16) * 14), 0, 1)
}

// The Nerd Font weather glyph for a reading, as Omarchy's own weather widget
// picks them.
function glyphFor(weather, night) {
  var w = weather || {}
  if (w.thunder > 0) return "\ue31d"
  if (w.snow > 0 && w.rain > 0) return "\ue3ad"
  if (w.snow > 0) return w.cover < 0.8 ? (night ? "\ue327" : "\ue30a") : "\ue31a"
  if (w.rain > 0) return w.cover < 0.8 ? (night ? "\ue333" : "\ue308") : "\ue318"
  if (w.fog > 0.4) return night ? "\ue346" : "\ue313"
  if (w.cover > 0.75) return "\ue33d"
  if (w.cover > 0.3) return night ? "\ue32e" : "\ue302"
  return night ? "\ue32b" : "\ue30d"
}

// "21:30", "9pm", "7:05 am" -> ms since midnight, or -1.
function parseClock(text) {
  var match = /^\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*$/i.exec(String(text || ""))
  if (!match) return -1
  var hours = Number(match[1]), minutes = match[2] ? Number(match[2]) : 0
  var half = (match[3] || "").toLowerCase()
  if (half) {
    if (hours < 1 || hours > 12) return -1
    hours = hours % 12 + (half === "pm" ? 12 : 0)
  }
  if (hours > 23 || minutes > 59) return -1
  return (hours * 60 + minutes) * MINUTE
}

function startOfDay(now) {
  var d = new Date(now)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

function celsiusToFahrenheit(value) {
  return value * 9 / 5 + 32
}

function usesFahrenheit(unit, localeName) {
  var u = String(unit || "").toLowerCase()
  if (u === "imperial" || u === "fahrenheit" || u === "f") return true
  if (u === "metric" || u === "celsius" || u === "c") return false
  return /^(en[_-]US|en[_-]LR|my)\b/.test(String(localeName || ""))
}

if (typeof module !== "undefined") {
  module.exports = {
    clamp: clamp, mix: mix, smoothstep: smoothstep, isList: isList,
    parseHex: parseHex, toHex: toHex, mixColor: mixColor, luminance: luminance,
    parseThemeColors: parseThemeColors, derivePalette: derivePalette,
    CODE_TABLE: CODE_TABLE, previewCode: previewCode, previewTemperature: previewTemperature,
    weatherFromCode: weatherFromCode, LANE_SPEED: LANE_SPEED, heatFor: heatFor,
    parseForecast: parseForecast, parseLocation: parseLocation, forecastUrl: forecastUrl,
    moonPhase: moonPhase, moonPhaseKey: moonPhaseKey, moonGlyph: moonGlyph, solarDay: solarDay,
    arcPosition: arcPosition, celestial: celestial, sceneUniforms: sceneUniforms, bowShape: bowShape,
    deskPlacement: deskPlacement, placed: placed, deskWindows: deskWindows, bounds: bounds,
    frameMargins: frameMargins, shownWindows: shownWindows, skyWash: skyWash, titleBars: titleBars,
    ledgeStep: ledgeStep, ledgeSlots: ledgeSlots, LEDGES: LEDGES, ICICLE_MOST: ICICLE_MOST,
    qualityFor: qualityFor, suggestQuality: suggestQuality, easedQuality: easedQuality, windowRects: windowRects,
    mixWeather: mixWeather, manualWeather: manualWeather, lyingStep: lyingStep, frozenShare: frozenShare,
    fogFromVisibility: fogFromVisibility, previewWind: previewWind, LYING_MOST: LYING_MOST, demoState: demoState, DEMO: DEMO, DEMO_SCENE: DEMO_SCENE,
    flashAt: flashAt, glyphFor: glyphFor, parseClock: parseClock, startOfDay: startOfDay,
    steadySky: steadySky, dayMarks: dayMarks, calmWeather: calmWeather, dayEvents: dayEvents,
    forecastDays: forecastDays, placeDay: placeDay, forecastFrom: forecastFrom,
    readingAt: readingAt, hourStrip: hourStrip, stripLength: stripLength,
    codeFalls: codeFalls, codeSnows: codeSnows, fallSoon: fallSoon,
    geocodeUrl: geocodeUrl, parseGeocoding: parseGeocoding,
    dayLight: dayLight, dayBand: dayBand,
    celsiusToFahrenheit: celsiusToFahrenheit, usesFahrenheit: usesFahrenheit,
    DAY: DAY, MINUTE: MINUTE
  }
}
