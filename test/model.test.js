// node test/model.test.js
const assert = require("assert")
const path = require("path")
const M = require(path.join(__dirname, "..", "Model.js"))

let ran = 0
function test(name, body) { body(); ran++ }

test("theme colors parse, and a bad line costs only itself", () => {
  const colors = M.parseThemeColors('mode = "dark"\naccent = "#8bcbb1"\nbroken = "nope"\nbackground = "#142620"\n')
  assert.deepStrictEqual(colors, { mode: "dark", accent: "#8bcbb1", background: "#142620" })
})

test("palette follows the theme's mode and survives a missing file", () => {
  const dark = M.derivePalette({ mode: "dark", background: "#142620", foreground: "#dfede5", blue: "#96b7d0" }, {})
  assert.strictEqual(dark.light, false)
  assert.ok(M.luminance(dark.nightTop) < M.luminance(dark.dayTop))
  assert.ok(M.luminance(dark.paper) > M.luminance(dark.ink))
  const light = M.derivePalette({ mode: "light", background: "#eff1f5", foreground: "#4c4f69" }, {})
  assert.strictEqual(light.light, true)
  assert.ok(M.luminance(light.paper) > M.luminance(light.ink))
  const bare = M.derivePalette({}, { background: "#101315", foreground: "#cacccc" })
  assert.strictEqual(M.toHex(bare.background), "#101315")
})

test("weather codes map to what the sky carries", () => {
  assert.strictEqual(M.weatherFromCode(0).cover, 0)
  assert.strictEqual(M.weatherFromCode(0).key, "clear")
  const rain = M.weatherFromCode(63)
  assert.ok(rain.rain > 0.5 && rain.snow === 0 && rain.thunder === 0)
  const storm = M.weatherFromCode(95)
  assert.ok(storm.thunder === 1 && storm.storm > rain.storm)
  assert.ok(M.weatherFromCode(73).snow > 0.5)
  assert.strictEqual(M.weatherFromCode(1234).key, "overcast")
  // Measured cloud cover refines the codes that only say "some cloud", and a
  // missing reading leaves the code's own figure.
  assert.strictEqual(M.weatherFromCode(3, null).cover, 1)
  assert.strictEqual(M.weatherFromCode(2, 100).cover, 0.75)
})

test("wind sets how fast clouds cross and which way", () => {
  const calm = M.weatherFromCode(2, null, 0, 270)
  const gale = M.weatherFromCode(2, null, 60, 270)
  assert.ok(gale.windPx > calm.windPx && calm.windPx > 0)
  // From the east it blows westward: right to left.
  assert.ok(M.weatherFromCode(2, null, 20, 90).windPx < 0)
  assert.ok(M.weatherFromCode(2, null, 20, 90).wind < 0)
})

test("previews resolve by name or code", () => {
  assert.strictEqual(M.previewCode("Heavy Rain"), 65)
  assert.strictEqual(M.previewCode("95"), 95)
  assert.strictEqual(M.previewCode("nonsense"), -1)
  assert.strictEqual(M.previewTemperature("heat"), 39)
  assert.strictEqual(M.previewTemperature("rain"), null)
})

test("a forecast is range-checked", () => {
  const good = M.parseForecast(JSON.stringify({
    current: { weather_code: 61, temperature_2m: 12.4, cloud_cover: 88, wind_speed_10m: 14, wind_direction_10m: 250, is_day: 1 },
    daily: { sunrise: [1794300000, 1794386400, "x"], sunset: [1794336000, 1794422400] }
  }))
  assert.strictEqual(good.code, 61)
  assert.strictEqual(good.temperature, 12.4)
  assert.deepStrictEqual(good.sunrise, [1794300000000, 1794386400000])
  assert.strictEqual(M.parseForecast("not json"), null)
  assert.strictEqual(M.parseForecast(JSON.stringify({ current: { weather_code: 400 } })), null)
  const odd = M.parseForecast(JSON.stringify({ current: { weather_code: 0, temperature_2m: 9999, cloud_cover: "<img>" } }))
  assert.strictEqual(odd.temperature, null)
  assert.strictEqual(odd.cloudCover, null)
})

test("a location is bounded and stripped of markup", () => {
  const place = M.parseLocation(JSON.stringify({ name: "<img src=x> Lisbon", latitude: 38.72, longitude: -9.14 }))
  assert.strictEqual(place.name, "img src=x Lisbon")
  assert.strictEqual(place.latitude, 38.72)
  assert.strictEqual(M.parseLocation(JSON.stringify({ name: "x", latitude: 200, longitude: 0 })).latitude, null)
  assert.strictEqual(M.parseLocation("{").name, "")
  assert.ok(M.forecastUrl(38.7234567, -9.1398765).includes("latitude=38.72&longitude=-9.14"))
  assert.strictEqual(M.forecastUrl("nope", 3), "")
})

test("the moon keeps its phase", () => {
  // Full moon of 2025-01-13 22:27 UTC, new moon of 2025-01-29 12:36 UTC.
  assert.strictEqual(M.moonPhaseKey(M.moonPhase(Date.UTC(2025, 0, 13, 22, 27))), "fullMoon")
  assert.strictEqual(M.moonPhaseKey(M.moonPhase(Date.UTC(2025, 0, 29, 12, 36))), "newMoon")
  assert.strictEqual(M.moonPhaseKey(0.25), "firstQuarter")
  assert.strictEqual(M.moonPhaseKey(0.6), "waningGibbous")
})

test("day and night follow sunrise and sunset, or the clock without them", () => {
  const rise = Date.UTC(2026, 5, 1, 5, 0), set = Date.UTC(2026, 5, 1, 19, 0)
  const next = rise + M.DAY, before = set - M.DAY
  const noon = M.solarDay(Date.UTC(2026, 5, 1, 12, 0), [rise - M.DAY, rise, next], [before, set, set + M.DAY])
  assert.deepStrictEqual([noon.isDay, noon.start, noon.end, noon.estimated], [true, rise, set, false])
  const late = M.solarDay(Date.UTC(2026, 5, 1, 23, 0), [rise - M.DAY, rise, next], [before, set, set + M.DAY])
  assert.deepStrictEqual([late.isDay, late.start, late.end], [false, set, next])
  const guess = M.solarDay(new Date(2026, 5, 1, 12, 0).getTime(), [], [])
  assert.deepStrictEqual([guess.isDay, guess.estimated], [true, true])
})

test("the sun rises beside the desktop, crosses over it and sets on the far side", () => {
  const placement = M.deskPlacement(1600, 1000, 0.62)
  const geometry = { width: 1600, height: 1000, margin: placement.x }
  const radius = 40
  const rise = M.arcPosition(0, geometry, radius), noon = M.arcPosition(0.5, geometry, radius), set = M.arcPosition(1, geometry, radius)
  assert.ok(rise.y - radius > 1000 && set.y - radius > 1000, "below the screen at both ends")
  assert.ok(rise.x < placement.x && set.x > placement.x + placement.width, "in the strips beside the desktop")
  assert.ok(Math.abs(noon.x - 800) < 1 && noon.y < placement.y, "over the middle at noon")
  // It never passes behind the desktop.
  for (let p = 0; p <= 1; p += 0.01) {
    const at = M.arcPosition(p, geometry, radius)
    const overDesk = at.x + radius > placement.x && at.x - radius < placement.x + placement.width
    if (overDesk) assert.ok(at.y + radius < placement.y, "clear of the desktop at " + p)
  }
})

test("the desktop steps back to a centred block with sky around it", () => {
  const placement = M.deskPlacement(1600, 1000, 0.62)
  const whole = M.placed({ x: 0, y: 0, width: 1600, height: 1000 }, placement, 1)
  assert.ok(Math.abs(whole.x - placement.x) < 1e-9 && Math.abs(whole.y - placement.y) < 1e-9)
  assert.ok(Math.abs(whole.width - 992) < 1e-9 && Math.abs(whole.x * 2 + whole.width - 1600) < 1e-9)
  assert.ok(whole.y + whole.height < 1000 && whole.y > 300)
  assert.deepStrictEqual(M.placed({ x: 10, y: 20, width: 300, height: 200 }, placement, 0), { x: 10, y: 20, width: 300, height: 200 })
})

test("windows are read from Hyprland's list, whatever kind of list it is", () => {
  // Qt hands over sequences, not arrays.
  const seq = (...values) => Object.assign(Object.create(null), values, { length: values.length })
  const clients = [
    { workspace: { id: 1 }, at: seq(110, 136), size: seq(900, 600), address: "0x1" },
    { workspace: { id: 1 }, at: seq(400, 300), size: seq(200, 100), floating: true, address: "0x2" },
    { workspace: { id: 2 }, at: seq(0, 0), size: seq(50, 50), address: "0x3" },
    { workspace: { id: 1 }, at: seq(0, 0), size: seq(50, 50), hidden: true, address: "0x4" },
    null
  ]
  const windows = M.deskWindows(clients, 1, 100, 26)
  assert.deepStrictEqual(windows.map(w => [w.index, w.x, w.y, w.floating]), [[0, 10, 110, false], [1, 300, 274, true]])
  assert.deepStrictEqual(M.bounds(windows), { x: 10, y: 110, width: 900, height: 600 })
  assert.strictEqual(M.bounds([]), null)
})

test("a hot, dry, sunlit day shimmers and nothing else does", () => {
  const clear = M.weatherFromCode(0)
  assert.ok(M.heatFor(38, 1, clear) > 0.9)
  assert.strictEqual(M.heatFor(20, 1, clear), 0)
  assert.strictEqual(M.heatFor(38, 0, clear), 0)
  assert.strictEqual(M.heatFor(38, 1, M.weatherFromCode(63)), 0)
  assert.strictEqual(M.heatFor(null, 1, clear), 0)
})

test("scene uniforms hold together", () => {
  const palette = M.derivePalette({ mode: "dark", background: "#142620", foreground: "#dfede5", blue: "#96b7d0", yellow: "#c5cc91" }, {})
  const placement = M.deskPlacement(1600, 1000, 0.62)
  const geometry = { width: 1600, height: 1000, margin: placement.x, deck: placement.y, desk: null }
  const noon = new Date(2026, 5, 1, 12, 0).getTime()
  const sky = M.celestial(noon, [], [], geometry, 40)
  assert.deepStrictEqual([sky.isDay, sky.sun.visible, sky.moon.visible], [true, 1, 0])
  const u = M.sceneUniforms(palette, sky, M.weatherFromCode(81), geometry)
  assert.ok(/^#[0-9a-f]{6}$/.test(u.scene.skyTop) && /^#[0-9a-f]{6}$/.test(u.ink))
  assert.notStrictEqual(u.scrim, u.ink)
  // Rain falls out of the clouds there are: the near lane follows the cover,
  // and how hard it rains is its own matter.
  const showers = M.weatherFromCode(81)
  assert.ok(u.scene.nearCover === Math.max(showers.cover, 0.16) && u.scene.rain > 0.5)
  // A nearly clear sky that pours keeps a cloud or two to pour from, no more;
  // a closed one stays closed. Neither changes how hard it falls.
  const lone = M.sceneUniforms(palette, sky, M.manualWeather({ cover: 0.05, precip: 1, temperature: 15 }), geometry)
  const monsoon = M.sceneUniforms(palette, sky, M.manualWeather({ cover: 1, precip: 1, temperature: 15 }), geometry)
  assert.deepStrictEqual([lone.scene.nearCover, lone.scene.rain, monsoon.scene.nearCover, monsoon.scene.rain], [0.16, 1, 1, 1])
  // And the lone cloud leaves the sky open; the monsoon closes it.
  assert.ok(lone.wash < 0.65 && monsoon.wash === 1)
  // With nothing falling the lane is just the cover.
  assert.strictEqual(M.sceneUniforms(palette, sky, M.manualWeather({ cover: 0.05 }), geometry).scene.nearCover, 0.05)
  assert.strictEqual(M.celestial(noon, [], [], geometry, 40, 0.5).moon.key, "fullMoon")
  const night = M.celestial(new Date(2026, 5, 1, 23, 0).getTime(), [], [], geometry, -33)
  assert.deepStrictEqual([night.isDay, night.moon.visible, night.moon.flip], [false, 1, -1])
})

test("quality follows the machine, and decides what the weather may do", () => {
  assert.strictEqual(M.suggestQuality("llvmpipe (LLVM 19)", 8, 16), "low")
  assert.strictEqual(M.suggestQuality("", 8, 16), "low")
  assert.strictEqual(M.suggestQuality("virgl (Apple M1 Pro)", 8, 7.7), "medium")
  assert.strictEqual(M.suggestQuality("Mesa Intel(R) Xe Graphics", 4, 16), "medium")
  assert.strictEqual(M.suggestQuality("AMD Radeon RX 6700", 12, 32), "high")
  assert.deepStrictEqual([M.qualityFor("low").detail, M.qualityFor("nonsense").name, M.qualityFor("HIGH").detail], [0, "medium", 2])
  assert.ok(!M.qualityFor("low").blur && M.qualityFor("low").frameRate < M.qualityFor("high").frameRate)
})

test("ultra is the only quality that runs on every frame", () => {
  const ultra = M.qualityFor("Ultra")
  assert.deepStrictEqual([ultra.name, ultra.detail, ultra.frameRate], ["ultra", 3, 0])
  assert.ok(ultra.pixel < M.qualityFor("high").pixel && ultra.blur && ultra.shimmer)
  for (const name of ["low", "medium", "high"]) {
    const q = M.qualityFor(name)
    assert.ok(q.frameRate > 0 && q.detail < ultra.detail, name)
  }
  // Never picked for a machine; it is for whoever asks.
  assert.notStrictEqual(M.suggestQuality("NVIDIA GeForce RTX 4090", 32, 128), "ultra")
  // The names that were only for measuring are gone.
  assert.deepStrictEqual(["fine", "native"].map(n => M.qualityFor(n).name), ["medium", "medium"])
})

const SPLIT = [
  { address: "0xa", x: 12, y: 12, width: 655, height: 975, floating: false, fullscreen: false },
  { address: "0xb", x: 677, y: 12, width: 891, height: 975, floating: false, fullscreen: false }
]

test("the frame the windows are kept to", () => {
  const m = M.frameMargins(1580, 999, 0.78)
  const f = M.deskPlacement(1580, 999, 0.78)
  // What is left between the margins is the frame.
  assert.ok(Math.abs(1580 - m.left - m.right - f.width) <= 1 && Math.abs(999 - m.top - m.bottom - f.height) <= 1)
  assert.ok(m.left === m.right && m.top > m.bottom && m.bottom > 0, "the sky gets the most room, the ground a little")
})

test("the sky comes in with the hour and closes in with the weather", () => {
  const clear = M.weatherFromCode(0, 0)
  const noon = M.skyWash(clear, 1, 0), dusk = M.skyWash(clear, 0.5, 1), night = M.skyWash(clear, 0, 0)
  // A clear midday leaves more than half the wallpaper showing; dusk and
  // night bring the sky in, night the most.
  assert.ok(noon > 0.4 && noon < 0.5, "midday " + noon)
  assert.ok(noon < dusk && dusk < night && night > 0.7 && night < 0.85)
  // Weather closes it the rest of the way, at any hour.
  const partly = M.skyWash(M.weatherFromCode(2, 45), 1, 0), overcast = M.skyWash(M.weatherFromCode(3, 100), 1, 0)
  assert.ok(noon <= partly && partly < overcast && overcast > 0.7)
  assert.strictEqual(M.skyWash(M.weatherFromCode(95, 100), 1, 0), 1)
  assert.ok(M.skyWash(M.weatherFromCode(65, 100), 1, 0) > 0.95 && M.skyWash(M.weatherFromCode(75, 100), 0, 0) > 0.95)
  assert.ok(M.skyWash(M.weatherFromCode(45, 100), 1, 0) > 0.8)
  const day = { dayness: 1, twilight: 0, glowX: 0, sun: { x: 0, y: 0, visible: 1 }, moon: { x: 0, y: 0, visible: 0, phase: 0.5, lit: 1, flip: 1 }, isDay: true }
  assert.strictEqual(M.sceneUniforms(M.derivePalette({}), day, clear, { width: 1000, height: 600, margin: 100, deck: 120 }).wash, noon)
})

test("a title bar is part of its window", () => {
  const bars = M.titleBars('{"option": "plugin:hyprbars:enabled", "bool": true, "set": true }\n{"option": "plugin:hyprbars:bar_height", "int": 30, "set": true }\n{"option": "plugin:hyprbars:workspace_tag", "str": "omarchy-floating-workspace", "set": true }\n')
  assert.deepStrictEqual(bars, { height: 30, tag: "omarchy-floating-workspace" })
  // No plugin, or switched off: no bars.
  assert.strictEqual(M.titleBars("no such option\nno such option\nno such option\n"), null)
  assert.strictEqual(M.titleBars('{"option": "plugin:hyprbars:enabled", "bool": false}\n{"option": "plugin:hyprbars:bar_height", "int": 30}\n'), null)
  // Upstream hyprbars has no tag: every window has one.
  assert.deepStrictEqual(M.titleBars('{"option": "plugin:hyprbars:enabled", "int": 1}\n{"option": "plugin:hyprbars:bar_height", "int": 24}\nno such option\n'), { height: 24, tag: "" })

  const clients = [
    { address: "0x1", workspace: { id: 1 }, at: [100, 200], size: [400, 300], floating: true, fullscreen: 0, focusHistoryID: 0, tags: ["omarchy-floating-workspace", "terminal*"] },
    { address: "0x2", workspace: { id: 1 }, at: [50, 80], size: [400, 300], floating: true, fullscreen: 0, focusHistoryID: 2, tags: ["omarchy-floating-workspace"] },
    { address: "0x3", workspace: { id: 1 }, at: [0, 0], size: [800, 600], floating: false, fullscreen: 0, focusHistoryID: 1, tags: [] },
    { address: "0x4", workspace: { id: 1 }, at: [0, 0], size: [800, 600], floating: true, fullscreen: 2, focusHistoryID: 3, tags: ["omarchy-floating-workspace"] }
  ]
  const found = M.deskWindows(clients, 1, 0, 26, bars)
  // The tiled one first and untouched; then the floating ones, the one used last on top.
  assert.deepStrictEqual(found.map(w => w.index), [2, 3, 1, 0])
  assert.deepStrictEqual([found[0].y, found[0].height, found[0].bar], [-26, 600, 0])
  // The bar is added on top: 30 higher, 30 taller.
  assert.deepStrictEqual([found[3].y, found[3].height, found[3].bar], [200 - 26 - 30, 330, 30])
  // A fullscreen window has none.
  assert.deepStrictEqual([found[1].height, found[1].bar], [600, 0])
  // With no bars nothing changes.
  assert.deepStrictEqual(M.deskWindows(clients, 1, 0, 26, null).map(w => w.height), [600, 600, 300, 300])
})

test("the temperature decides what falls", () => {
  // One amount of precipitation; warm it is rain, cold it is snow, and at the line it is both.
  const at = t => M.manualWeather({ cover: 0.9, precip: 0.8, temperature: t })
  assert.deepStrictEqual([at(12).rain, at(12).snow, at(12).key], [0.8, 0, "rain"])
  assert.deepStrictEqual([at(-5).rain, at(-5).snow, at(-5).key], [0, 0.8, "snow"])
  const sleet = at(1)
  assert.ok(sleet.key === "sleet" && sleet.rain > 0.2 && sleet.snow > 0.2 && Math.abs(sleet.rain + sleet.snow - 0.8) < 1e-9)
  assert.deepStrictEqual([M.frozenShare(10, 0), M.frozenShare(-2, 0)], [0, 1])

  // A reading from the service: its code says how hard, the temperature says what.
  assert.deepStrictEqual([M.weatherFromCode(63, 100, 20, 250, { temperature: 12 }).key, M.weatherFromCode(63, 100, 20, 250, { temperature: -3 }).key], ["rain", "snow"])
  assert.ok(M.weatherFromCode(75, 100, 20, 250, { temperature: -8 }).snow > 0.9)
  // A preview picks its temperature to show a kind of weather, and is taken plainly: one degree is sleet.
  const preview = M.weatherFromCode(M.previewCode("sleet"), null, 14, 250, { temperature: M.previewTemperature("sleet"), plain: true })
  assert.ok(preview.key === "sleet" && preview.rain > 0.2 && preview.snow > 0.2)
  assert.strictEqual(M.weatherFromCode(M.previewCode("blizzard"), null, M.previewWind("blizzard"), 250, { temperature: M.previewTemperature("blizzard"), plain: true }).key, "heavySnow")
  // With no temperature the code is taken at its word, as before.
  assert.deepStrictEqual([M.weatherFromCode(73).snow, M.weatherFromCode(73).rain, M.weatherFromCode(63).snow], [0.62, 0, 0])
  // Freezing rain is water below freezing, and stays water.
  const glaze = M.weatherFromCode(67, 100, 20, 250, { temperature: -3 })
  assert.ok(glaze.key === "freezingRain" && glaze.rain > 0.6)
  // Hail comes with the storms that are reported with it, or when it is asked for.
  assert.deepStrictEqual([M.weatherFromCode(99).hail, M.weatherFromCode(96).hail, M.weatherFromCode(95).hail], [1, 0.55, 0])
  assert.deepStrictEqual([M.manualWeather({ precip: 0.7, hail: true, temperature: 18 }).key, M.manualWeather({ hail: true }).hail], ["hail", 0])
})

test("cloud layers, gusts and visibility refine a reading", () => {
  // Each height has its own cover where it is measured; otherwise all have the code's.
  const layered = M.weatherFromCode(2, 50, 10, 250, { coverLow: 10, coverMid: 20, coverHigh: 70 })
  assert.deepStrictEqual([layered.coverLow, layered.coverMid, layered.coverHigh], [0.1, 0.2, 0.7])
  const plain = M.weatherFromCode(2, 50, 10, 250)
  assert.deepStrictEqual([plain.coverLow, plain.coverMid, plain.coverHigh], [plain.cover, plain.cover, plain.cover])
  // What rains is the low cloud, so rain keeps some there.
  assert.ok(M.weatherFromCode(63, 100, 10, 250, { coverLow: 5, coverMid: 90, coverHigh: 100 }).coverLow > 0.8)
  // Gusts are how far the wind runs ahead of itself.
  assert.deepStrictEqual([M.weatherFromCode(2, 50, 20, 250, { gusts: 20 }).gust, M.weatherFromCode(2, 50, 20, 250, { gusts: 80 }).gust], [0, 1])
  // Fog is as thick as the air is seen to be; haze shows in other weather too.
  const thick = M.weatherFromCode(45, 100, 5, 250, { visibility: 150 }), thin = M.weatherFromCode(45, 100, 5, 250, { visibility: 4000 })
  assert.ok(thick.fog > 0.9 && thin.fog < thick.fog && thin.fog >= 0.35)
  assert.strictEqual(M.weatherFromCode(45).fog, 0.75)
  assert.ok(M.weatherFromCode(3, 100, 5, 250, { visibility: 800 }).fog > 0.25 && M.weatherFromCode(3, 100, 5, 250, { visibility: 40000 }).fog === 0)
  // The scene is told each lane's cloud, and the low one is what rain needs.
  const palette = M.derivePalette({ mode: "dark", background: "#142620", foreground: "#dfede5" }, {})
  const geometry = { width: 1600, height: 1000, margin: 200, deck: 180, desk: null }
  const sky = M.celestial(new Date(2026, 5, 1, 12, 0).getTime(), [], [], geometry, 40)
  const scene = M.sceneUniforms(palette, sky, layered, geometry).scene
  assert.deepStrictEqual([scene.nearCover, scene.cover, scene.coverHigh], [0.1, 0.2, 0.7])
  // Turning from one reading to another turns the temperature too.
  const mixed = M.mixWeather(M.manualWeather({ temperature: 10 }), M.manualWeather({ temperature: -10 }), 0.5)
  assert.ok(Math.abs(mixed.temperature) < 1e-9 && !mixed.settled)
  assert.strictEqual(M.mixWeather(M.weatherFromCode(0), M.manualWeather({ temperature: -10 }), 0.5).temperature, -10)
})

test("lying snow goes by the temperature, and the cold grows icicles", () => {
  const snowing = M.manualWeather({ cover: 1, precip: 1, temperature: -4 })
  const cold = M.manualWeather({ cover: 0.3, temperature: -4 }), warm = M.manualWeather({ cover: 0.3, temperature: 8 })
  let depth = 0
  for (let i = 0; i < 50; i++) depth = M.lyingStep(depth, snowing, 0.1)
  assert.ok(depth > 8 && depth < 10, "it deepens while it snows: " + depth)
  // The snow stops: in the cold it stays, in the warm it goes.
  let kept = depth, gone = depth
  for (let i = 0; i < 50; i++) { kept = M.lyingStep(kept, cold, 0.1); gone = M.lyingStep(gone, warm, 0.1) }
  assert.strictEqual(kept, depth)
  assert.strictEqual(gone, 0)
  // Rain at ten degrees over lying snow takes it too; and it never passes its limit.
  assert.ok(M.lyingStep(10, M.manualWeather({ cover: 1, precip: 1, temperature: 10 }), 0.2) < 10)
  for (let i = 0; i < 400; i++) depth = M.lyingStep(depth, snowing, 0.1)
  assert.strictEqual(depth, M.LYING_MOST)
  // With no temperature it is as it was: it melts once the fall is over.
  assert.ok(M.lyingStep(10, M.weatherFromCode(0), 0.2) < 10 && M.lyingStep(10, M.weatherFromCode(73), 0.2) > 10)

  // Icicles: snow lying on a window in the cold feeds them.
  const win = [{ address: "0xa", x: 0, y: 0, width: 500, height: 400, floating: false, fullscreen: false }]
  const freezing = { dt: 0.1, lying: 20, rate: 4, scope: 1, temperature: -6 }
  let s = M.ledgeStep(null, win, freezing)
  for (let i = 0; i < 100; i++) s = M.ledgeStep(s, win, freezing)
  const grown = s.ledges["0xa"].ice
  assert.ok(grown > 5 && grown <= M.ICICLE_MOST, "grown " + grown)
  assert.deepStrictEqual([M.ledgeSlots(s, win).ices[0], M.ledgeSlots(s, win).longest], [grown, grown])
  // Bare and cold, nothing grows; freezing rain grows them fast.
  let bare = M.ledgeStep(null, win, Object.assign({}, freezing, { lying: 0 }))
  for (let i = 0; i < 50; i++) bare = M.ledgeStep(bare, win, Object.assign({}, freezing, { lying: 0 }))
  assert.strictEqual(bare.ledges["0xa"].ice, 0)
  let glazed = bare
  for (let i = 0; i < 50; i++) glazed = M.ledgeStep(glazed, win, Object.assign({}, freezing, { lying: 0, glaze: 0.8 }))
  assert.ok(glazed.ledges["0xa"].ice > grown)
  // The thaw takes them, and moving the window away breaks them off.
  for (let i = 0; i < 100; i++) s = M.ledgeStep(s, win, Object.assign({}, freezing, { temperature: 9 }))
  assert.strictEqual(s.ledges["0xa"].ice, 0)
  glazed = M.ledgeStep(glazed, [Object.assign({}, win[0], { x: 4000 })], Object.assign({}, freezing, { lying: 0 }))
  assert.strictEqual(glazed.ledges["0xa"].ice, 0)
})

test("nothing builds on a window that is above the clouds", () => {
  // The clouds' bases are 115 px down. One window has its top above them, one below.
  const high = { address: "0xh", x: 100, y: 40, width: 400, height: 300, floating: true, fullscreen: false }
  const low = { address: "0xl", x: 600, y: 200, width: 400, height: 300, floating: true, fullscreen: false }
  const snowing = { dt: 0.1, lying: 0, rate: 4, scope: 1, cloudBase: 115, temperature: -5 }
  let s = M.ledgeStep(null, [high, low], snowing)
  for (let i = 1; i <= 60; i++) s = M.ledgeStep(s, [high, low], Object.assign({}, snowing, { lying: Math.min(20, i * 0.4) }))
  assert.strictEqual(s.ledges["0xh"].depth, 0)
  assert.ok(s.ledges["0xl"].depth > 15)
  // Nor do icicles grow there, even in freezing rain; under the clouds they do.
  for (let i = 0; i < 40; i++) s = M.ledgeStep(s, [high, low], Object.assign({}, snowing, { lying: 20, glaze: 0.8 }))
  assert.deepStrictEqual([s.ledges["0xh"].ice, s.ledges["0xl"].ice > 5], [0, true])
  // Brought down under the clouds it starts to build, from nothing.
  const lowered = Object.assign({}, high, { y: 60 })
  let d = M.ledgeStep(s, [lowered, low], Object.assign({}, snowing, { lying: 20 }))
  assert.strictEqual(d.ledges["0xh"].depth, 0, "still above them")
  const down = Object.assign({}, high, { y: 180 })
  for (let i = 0; i < 80; i++) d = M.ledgeStep(d, [down, low], Object.assign({}, snowing, { lying: 20 }))
  assert.ok(d.ledges["0xh"].depth > 10)
  // A sky that arrives with snow already lying does not put it above the clouds either.
  const arrived = M.ledgeStep(null, [high, low], Object.assign({}, snowing, { lying: 20 }))
  assert.deepStrictEqual([arrived.ledges["0xh"].depth, arrived.ledges["0xl"].depth], [0, 20])
  // With no word on where the clouds are, everything is under them, as before.
  assert.strictEqual(M.ledgeStep(null, [high], { dt: 0.1, lying: 20, rate: 4, scope: 1 }).ledges["0xh"].depth, 20)
})

test("thaw, rainbows and a ring round the moon come from the right weather", () => {
  const palette = M.derivePalette({ mode: "dark", background: "#142620", foreground: "#dfede5", red: "#f7768e", yellow: "#e0af68", blue: "#7aa2f7" }, {})
  const geometry = { width: 1600, height: 1000, margin: 200, deck: 180, desk: null }
  const noon = M.celestial(new Date(2026, 5, 1, 12, 0).getTime(), [], [], geometry, 40)
  const evening = M.celestial(new Date(2026, 5, 1, 17, 0).getTime(), [], [], geometry, 40)
  const night = M.celestial(new Date(2026, 5, 1, 23, 0).getTime(), [], [], geometry, 40, 0.5)
  const scene = (sky, w) => M.sceneUniforms(palette, sky, w, geometry).scene
  const shower = M.manualWeather({ cover: 0.5, precip: 0.6, temperature: 16 })
  // A shower with the sun low and out: a rainbow, arched over the middle of the
  // screen and standing on the side of the sky away from the sun.
  const bow = scene(evening, shower)
  assert.ok(bow.rainbow > 0.3 && bow.bowX === 800 && /^#[0-9a-f]{6}$/.test(bow.bowOuter))
  assert.strictEqual(bow.bowSide, evening.sun.x > 800 ? -1 : 1)
  // Not at noon, not under a closed sky, not at night, not when it is snow.
  assert.ok(scene(noon, shower).rainbow < 0.05)
  assert.strictEqual(scene(evening, M.manualWeather({ cover: 1, precip: 0.6, temperature: 16 })).rainbow, 0)
  assert.strictEqual(scene(night, shower).rainbow, 0)
  assert.strictEqual(scene(evening, M.manualWeather({ cover: 0.5, precip: 0.6, temperature: -5 })).rainbow, 0)
  // A ring round the moon: thin high cloud, nothing low, nothing falling.
  const veiled = M.weatherFromCode(1, 30, 5, 250, { coverLow: 0, coverMid: 5, coverHigh: 45 })
  assert.ok(scene(night, veiled).halo > 0.5)
  assert.strictEqual(scene(night, M.weatherFromCode(0, 0, 5, 250, { coverLow: 0, coverMid: 0, coverHigh: 0 })).halo, 0)
  assert.strictEqual(scene(noon, veiled).halo, 0)
  // Thaw goes by the warmth; hail and gusts are passed straight on.
  assert.deepStrictEqual([scene(noon, M.manualWeather({ temperature: -3 })).thaw, scene(noon, M.manualWeather({ temperature: 9 })).thaw], [0, 1])
  const hailing = scene(noon, M.manualWeather({ cover: 1, precip: 0.8, temperature: 17, hail: true, wind: 70 }))
  assert.deepStrictEqual([hailing.hail, hailing.gust], [1, 1])
})

test("stills cross from where a window was to where it is", () => {
  const back = { "0xa": { x: 100, y: 200, width: 500, height: 700 } }
  const rest = { "0xa": SPLIT[0] }
  assert.strictEqual(M.shownWindows(SPLIT, rest, back, -1), SPLIT)
  const at0 = M.shownWindows(SPLIT, rest, back, 0)[0], at1 = M.shownWindows(SPLIT, rest, back, 1)[0]
  assert.deepStrictEqual([at0.x, at0.width, at1.x, at1.y, at1.width, at1.height], [12, 655, 100, 200, 500, 700])
  const half = M.shownWindows(SPLIT, rest, back, 0.5)[0]
  assert.deepStrictEqual([half.x, half.y, half.width, half.address], [56, 106, 577.5, "0xa"])
  // A window with nowhere recorded stays where it is.
  assert.deepStrictEqual(M.shownWindows(SPLIT, rest, back, 0.5)[1].x, 677)
})

test("snow lies on each window on its own account, and melts when disturbed", () => {
  const snowing = { dt: 0.1, lying: 20, rate: 4, scope: 1 }
  // What is there when the sky arrives has the snow already lying.
  let s = M.ledgeStep(null, SPLIT, snowing)
  assert.deepStrictEqual([s.ledges["0xa"].depth, s.ledges["0xb"].depth, s.ledges["0xa"].shelter], [20, 20, 1])
  let slots = M.ledgeSlots(s, SPLIT)
  // Two tiled windows: no place a window has left, none floating.
  assert.deepStrictEqual([slots.depths, slots.ghostFrom, slots.floatFrom, slots.deepest, slots.rects[0], slots.rects[2]],
    [[20, 20, 0, 0, 0, 0], 2, 2, 20, [12, 12, 655, 975], [0, 0, 0, 0]])

  // Nudged a little: some comes off, not at once, and it shelters less.
  const nudged = [Object.assign({}, SPLIT[0], { width: 685 }), Object.assign({}, SPLIT[1], { x: 707, width: 861 })]
  s = M.ledgeStep(s, nudged, snowing)
  const first = s.ledges["0xa"].depth
  assert.ok(first < 20 && first > 12 && s.ledges["0xa"].melt > 0 && s.ledges["0xa"].shelter < 1, "melting has begun, gradually")
  for (let i = 0; i < 30; i++) s = M.ledgeStep(s, nudged, snowing)
  // Then it falls again, at the rate it is given, until it has caught up.
  assert.ok(s.ledges["0xa"].melt === 0 && s.ledges["0xa"].depth > 14 && s.ledges["0xa"].depth <= 20)
  for (let i = 0; i < 40; i++) s = M.ledgeStep(s, nudged, snowing)
  assert.strictEqual(s.ledges["0xa"].depth, 20)

  // Dragged steadily, it keeps nothing.
  let moving = nudged
  for (let i = 0; i < 20; i++) {
    moving = [Object.assign({}, moving[0], { x: moving[0].x + 30 }), moving[1]]
    s = M.ledgeStep(s, moving, snowing)
  }
  assert.ok(s.ledges["0xa"].depth < 1 && s.ghosts.length === 0, "shaken off, with nothing left behind")
  assert.strictEqual(s.ledges["0xb"].depth, 20)

  // Jumping away leaves the snow where it was, melting there; the window starts bare.
  for (let i = 0; i < 200; i++) s = M.ledgeStep(s, moving, snowing)
  const away = [Object.assign({}, moving[0], { x: 5000 }), moving[1]]
  s = M.ledgeStep(s, away, snowing)
  assert.ok(s.ghosts.length === 1 && s.ledges["0xa"].shelter < 0.05)
  assert.ok(s.ledges["0xa"].depth < 1 && s.ghosts[0].depth > 10 && s.ghosts[0].depth < 20 && s.ghosts[0].x === moving[0].x)
  slots = M.ledgeSlots(s, away)
  assert.ok(slots.rects[2][0] === moving[0].x && slots.depths[2] === s.ghosts[0].depth, "what was left behind takes a spare place")
  assert.deepStrictEqual([slots.ghostFrom, slots.floatFrom], [2, 3], "and is marked as not a window")
  for (let i = 0; i < 30; i++) s = M.ledgeStep(s, away, snowing)
  assert.strictEqual(s.ghosts.length, 0)

  // A window that closes leaves its snow behind the same way; one that opens starts bare.
  s = M.ledgeStep(s, [away[1], { address: "0xc", x: 0, y: 0, width: 300, height: 300, floating: true, fullscreen: false }], snowing)
  assert.deepStrictEqual([s.ledges["0xc"].depth > 0 && s.ledges["0xc"].depth < 1, "0xa" in s.ledges], [true, false])
  // The floating one comes last and says where floating begins.
  slots = M.ledgeSlots(s, [{ address: "0xc", x: 0, y: 0, width: 300, height: 300, floating: true }, away[1]])
  assert.ok(slots.rects[0][0] === 707 && slots.ghostFrom === 1 && slots.floatFrom >= 1 && slots.rects[slots.floatFrom][2] === 300)

  // The scene's own glide disturbs nothing; another workspace starts afresh.
  let g = M.ledgeStep(null, SPLIT, snowing)
  g = M.ledgeStep(g, nudged, Object.assign({}, snowing, { carried: true }))
  assert.deepStrictEqual([g.ledges["0xa"].depth, g.ledges["0xa"].width, g.ghosts.length], [20, 685, 0])
  g = M.ledgeStep(g, [Object.assign({}, SPLIT[0], { x: 9000 })], Object.assign({}, snowing, { scope: 2 }))
  assert.deepStrictEqual([g.ledges["0xa"].depth, g.ghosts.length], [20, 0])

  // When it stops snowing and the lying snow melts, every ledge follows it down.
  g = M.ledgeStep(g, [Object.assign({}, SPLIT[0], { x: 9000 })], { dt: 0.1, lying: 6, rate: 0, scope: 2 })
  assert.strictEqual(g.ledges["0xa"].depth, 6)
})

test("windows become rectangles for the weather to land on", () => {
  const placement = M.deskPlacement(1600, 1000, 0.62)
  const rects = M.windowRects([{ x: 10, y: 10, width: 780, height: 980 }, { x: 800, y: 10, width: 790, height: 980 }], placement)
  assert.strictEqual(rects.length, 6)
  assert.ok(rects[0][2] > 400 && rects[1][0] > rects[0][0] + rects[0][2])
  assert.deepStrictEqual(rects[5], [0, 0, 0, 0])
})

test("weather turns rather than jumps", () => {
  const fair = M.weatherFromCode(0), storm = M.weatherFromCode(95)
  const half = M.mixWeather(fair, storm, 0.5)
  assert.ok(half.rain > 0 && half.rain < storm.rain && !half.settled)
  let w = fair
  for (let i = 0; i < 400; i++) w = M.mixWeather(w, storm, 0.06)
  assert.ok(w.settled && w.rain === storm.rain && w.key === "thunderstorm")
  assert.strictEqual(M.mixWeather(null, storm, 0.1), storm)
})

test("a reading set by hand names itself", () => {
  assert.strictEqual(M.manualWeather({ cover: 0 }).key, "clear")
  assert.strictEqual(M.manualWeather({ cover: 1, precip: 0.9, temperature: 12 }).key, "heavyRain")
  assert.strictEqual(M.manualWeather({ cover: 1, precip: 0.6, temperature: -3 }).key, "snow")
  assert.strictEqual(M.manualWeather({ precip: 0.5, thunder: true }).key, "thunderstorm")
  assert.ok(M.manualWeather({ wind: -40 }).windPx < 0 && M.manualWeather({ wind: 40 }).windPx > 0)
})

test("the demo walks a day with weather to suit", () => {
  const start = M.demoState(0)
  assert.deepStrictEqual([start.step, start.code, start.hour], [0, 0, 5.5])
  assert.strictEqual(M.demoState(M.DEMO_SCENE * 3 + 1).temperature, 39)
  assert.strictEqual(M.demoState(M.DEMO_SCENE * M.DEMO.length).step, 0)
  for (const scene of M.DEMO) assert.ok(M.CODE_TABLE[scene.code])
})

test("lightning is brief, and clocks parse", () => {
  assert.ok(M.flashAt(0) > 0.9 && M.flashAt(0.6) === 0 && M.flashAt(-1) === 0)
  assert.strictEqual(M.parseClock("21:30"), 21.5 * 3600000)
  assert.strictEqual(M.parseClock("9pm"), 21 * 3600000)
  assert.strictEqual(M.parseClock("12am"), 0)
  assert.strictEqual(M.parseClock("25:00"), -1)
  assert.strictEqual(M.usesFahrenheit("auto", "en-US"), true)
  assert.strictEqual(M.usesFahrenheit("metric", "en-US"), false)
})

test("the weather switched off is an empty, still sky that the scene can turn toward", () => {
  const calm = M.calmWeather()
  for (const key of ["cover", "coverLow", "coverMid", "coverHigh", "precip", "rain", "snow", "hail", "fog", "thunder", "storm", "gust"])
    assert.strictEqual(calm[key], 0, key)
  assert.strictEqual(M.heatFor(calm.temperature, 1, calm), 0)
  // A storm turns into it and settles there.
  let w = M.weatherFromCode(95)
  for (let i = 0; i < 200 && !w.settled; i++) w = M.mixWeather(w, calm, 0.2)
  assert.strictEqual(w.settled, true)
  assert.strictEqual(w.rain, 0)
  assert.strictEqual(w.cover, 0)
  // And lying snow goes in it.
  assert.ok(M.lyingStep(10, calm, 0.25) < 10)
})

test("the hour switched off leaves a steady daylight with no sun, moon or wash of its own", () => {
  const geometry = { width: 1600, height: 1000, margin: 180, deck: 200, desk: null }
  const palette = M.derivePalette({ mode: "dark", background: "#142620", foreground: "#dfede5", blue: "#96b7d0" }, {})
  const midnight = new Date(2026, 10, 11, 0, 30).getTime()
  const night = M.celestial(midnight, [], [], geometry, 40)
  assert.strictEqual(M.steadySky(night, 0), night)
  const still = M.steadySky(night, 1)
  assert.strictEqual(still.dayness, 1)
  assert.strictEqual(still.twilight, 0)
  assert.strictEqual(still.sun.visible, 0)
  assert.strictEqual(still.moon.visible, 0)
  // The sky it was made from is left as it was.
  assert.strictEqual(night.moon.visible, 1)
  assert.ok(night.dayness < 0.1)

  const clear = M.weatherFromCode(0)
  const plain = M.sceneUniforms(palette, still, clear, geometry)
  assert.strictEqual(plain.wash, 0)
  assert.strictEqual(plain.scene.sunVis, 0)
  assert.strictEqual(plain.scene.moonVis, 0)
  assert.strictEqual(plain.scene.halo, 0)
  assert.strictEqual(plain.scene.rainbow, 0)
  // Lit as by day, from overhead.
  assert.strictEqual(plain.scene.shine, 1)
  assert.ok(plain.scene.lightPos[1] < 0)
  // The weather still closes it in.
  const grey = M.sceneUniforms(palette, still, M.weatherFromCode(3), geometry)
  assert.ok(grey.wash > 0.5)
  // Half way there it is between the two.
  const half = M.sceneUniforms(palette, M.steadySky(night, 0.5), clear, geometry)
  const dark = M.sceneUniforms(palette, night, clear, geometry)
  assert.ok(half.wash > 0 && half.wash < dark.wash)
  assert.ok(half.scene.moonVis > 0 && half.scene.moonVis < 1)
  // With the hour in, nothing has changed.
  assert.strictEqual(M.skyWash(clear, 1, 0), M.skyWash(clear, 1, 0, 0))
})

test("the day's ruler has sunrise and sunset on it", () => {
  const noon = new Date(2026, 5, 21, 12, 0).getTime()
  assert.deepStrictEqual(M.dayMarks(noon, [], []), { rise: 6.5, set: 18.5 })
  const rise = new Date(2026, 5, 21, 5, 15).getTime(), set = new Date(2026, 5, 21, 20, 45).getTime()
  const marks = M.dayMarks(new Date(2026, 5, 21, 23, 0).getTime(), [rise, rise + M.DAY], [set - M.DAY, set, set + M.DAY])
  assert.ok(Math.abs(marks.rise - 5.25) < 1e-9 && Math.abs(marks.set - 20.75) < 1e-9)
})

test("by hand and in a preview the sun is where live has it; only the demo has its own day", () => {
  const geometry = { width: 1600, height: 1000, margin: 180, deck: 200, desk: null }
  const day = (h, m) => new Date(2026, 10, 11, h, m).getTime()
  // A November day: up at 6:56, down at 17:20.
  const forecast = {
    sunrise: [day(6, 55) - M.DAY, day(6, 56), day(6, 57) + M.DAY],
    sunset: [day(17, 21) - M.DAY, day(17, 20), day(17, 19) + M.DAY]
  }
  const live = M.dayEvents("live", forecast)
  for (const mode of ["manual", "preview"]) assert.deepStrictEqual(M.dayEvents(mode, forecast), live)
  assert.deepStrictEqual(M.dayEvents("demo", forecast), { sunrise: [], sunset: [] })
  assert.deepStrictEqual(M.dayEvents("manual", null), { sunrise: [], sunset: [] })

  // Twenty to six in the evening: night by the real day, in live and by hand alike.
  const at = day(17, 40)
  const real = M.celestial(at, live.sunrise, live.sunset, geometry, 40)
  const byHand = M.dayEvents("manual", forecast)
  assert.deepStrictEqual(M.celestial(at, byHand.sunrise, byHand.sunset, geometry, 40), real)
  assert.strictEqual(real.isDay, false)
  // The made-up day still has the sun up then, which is what by hand used to show.
  assert.strictEqual(M.celestial(at, [], [], geometry, 40).isDay, true)
  // And in mid afternoon the two days put the sun in different places.
  const two = day(14, 0)
  const sunReal = M.celestial(two, live.sunrise, live.sunset, geometry, 40).sun
  const sunMade = M.celestial(two, [], [], geometry, 40).sun
  assert.ok(Math.abs(sunReal.x - sunMade.x) > 20)
  assert.deepStrictEqual(M.dayMarks(at, live.sunrise, live.sunset), { rise: 6 + 56 / 60, set: 17 + 20 / 60 })
})

test("the forecast carries the detail and the days ahead, by the date where the place is", () => {
  // New York time, five hours behind UTC: the daily times are its own midnights.
  const offset = -18000
  const midnight = (y, m, d) => Date.UTC(y, m, d) / 1000 - offset
  const raw = JSON.stringify({
    utc_offset_seconds: offset,
    current: { temperature_2m: 18.4, apparent_temperature: 17.1, relative_humidity_2m: 71, weather_code: 3, is_day: 1,
               wind_speed_10m: 11.2, wind_direction_10m: 40, cloud_cover: 96 },
    daily: {
      time: [midnight(2026, 10, 10), midnight(2026, 10, 11), midnight(2026, 10, 12), midnight(2026, 10, 13), midnight(2026, 10, 14), midnight(2026, 10, 15)],
      weather_code: [1, 3, 61, 0, 71, 95],
      temperature_2m_max: [19, 20.5, 14, 12, 3, "nope"],
      temperature_2m_min: [7, 9.2, 8, 2, -4, 1],
      sunrise: [midnight(2026, 10, 11) + 6.9 * 3600], sunset: [midnight(2026, 10, 11) + 17.3 * 3600]
    }
  })
  const f = M.parseForecast(raw)
  assert.strictEqual(f.feels, 17.1)
  assert.strictEqual(f.humidity, 71)
  // The last day's high is not a number: that day is left out, the rest stand.
  assert.strictEqual(f.days.length, 5)

  // Half past eleven at night there, on the 11th: already the 12th in UTC.
  const late = (midnight(2026, 10, 11) + 23.5 * 3600) * 1000
  const ahead = M.forecastDays(f, late)
  assert.deepStrictEqual(ahead.today, { day: f.days[1].day, code: 3, high: 20.5, low: 9.2 })
  assert.deepStrictEqual(ahead.next.map(d => d.code), [61, 0, 71])
  // The 11th of November 2026 is a Wednesday; the days after it follow.
  assert.deepStrictEqual(ahead.next.map(d => d.weekday), [4, 5, 6])
  assert.strictEqual(M.forecastDays(f, late, 2).next.length, 2)
  // Nothing known is nothing shown.
  assert.deepStrictEqual(M.forecastDays(null, late), { today: null, next: [] })
  assert.ok(M.forecastUrl(38.72, -9.14).includes("apparent_temperature") && M.forecastUrl(38.72, -9.14).includes("temperature_2m_max"))
})

test("a typed city is looked up by name alone, and what comes back is cleaned", () => {
  assert.strictEqual(M.geocodeUrl("a"), "")
  assert.strictEqual(M.geocodeUrl("   "), "")
  const url = M.geocodeUrl("  São Paulo & co\n")
  assert.ok(url.startsWith("https://geocoding-api.open-meteo.com/v1/search?name=S%C3%A3o%20Paulo%20%26%20co&"))
  assert.ok(M.geocodeUrl("x".repeat(500)).length < 200)

  const found = M.parseGeocoding(JSON.stringify({ results: [
    { name: "Paris", admin1: "Île-de-France", country: "France", latitude: 48.85341, longitude: 2.3488 },
    { name: "<b>Paris</b>", admin1: "Texas", country: "United States", latitude: "33.66", longitude: "-95.55" },
    { name: "Nowhere", latitude: 123, longitude: 2 },
    { latitude: 1, longitude: 2 },
    "junk"
  ] }))
  assert.deepStrictEqual(found, [
    { name: "Paris", description: "Île-de-France, France", latitude: 48.85341, longitude: 2.3488 },
    { name: "bParis/b", description: "Texas, United States", latitude: 33.66, longitude: -95.55 }
  ])
  assert.deepStrictEqual(M.parseGeocoding("not json"), [])
  assert.deepStrictEqual(M.parseGeocoding("{}"), [])
})

test("the day's ruler is lit where the sky will be, whatever the place's clock", () => {
  const start = new Date(2026, 10, 11).getTime()
  const at = (h) => start + h * 3600000
  // An ordinary day: dark at the ends, light in the middle, dawn and dusk between.
  const band = M.dayBand(start, [at(6.9), at(6.9) + M.DAY], [at(17.3) - M.DAY, at(17.3), at(17.3) + M.DAY], 96)
  assert.strictEqual(band.length, 96)
  assert.ok(band[0].dayness < 0.05 && band[95].dayness < 0.05)
  assert.ok(band[48].dayness > 0.95)
  assert.ok(band[Math.round(6.9 * 4)].twilight > 0.8 && band[48].twilight < 0.05)
  // It agrees with the sky itself at the same moment.
  const geometry = { width: 1600, height: 1000, margin: 180, deck: 200, desk: null }
  const sky = M.celestial(at(10.125), [at(6.9), at(6.9) + M.DAY], [at(17.3) - M.DAY, at(17.3), at(17.3) + M.DAY], geometry, 35)
  assert.strictEqual(band[40].dayness, sky.dayness)
  // A place half a world away: its day falls across this clock's midnight.
  const far = M.dayBand(start, [at(16.3) - M.DAY, at(16.3)], [at(3.2), at(3.2) + M.DAY], 96)
  assert.ok(far[4].dayness > 0.95 && far[90].dayness > 0.95)
  assert.ok(far[40].dayness < 0.05)
})

test("the moon's glyph follows its phase round the icon font's twenty-eight", () => {
  assert.strictEqual(M.moonGlyph(0), "\ue38d")
  assert.strictEqual(M.moonGlyph(0.25), "\ue394")
  assert.strictEqual(M.moonGlyph(0.5), "\ue39b")
  assert.strictEqual(M.moonGlyph(0.75), "\ue3a2")
  // Nearly new again is new, not one past the last.
  assert.strictEqual(M.moonGlyph(0.995), "\ue38d")
  assert.strictEqual(M.moonGlyph(1.25), M.moonGlyph(0.25))
  assert.strictEqual(M.moonGlyph("nope"), "\ue38d")
})

test("the rainbow arches over the desktop, with its feet in the margins beside it", () => {
  const g = { width: 1728, height: 1126, margin: 190, deck: 242 }
  const bow = M.bowShape(g, 1500)
  // Its crown is in the sky above the desktop, on the middle of the screen.
  assert.strictEqual(bow.x, 864)
  const crown = bow.y - bow.radius
  assert.ok(crown > 0 && crown < g.deck, "crown at " + crown)
  // Level with the middle of the desktop it is out in the margins, not behind the windows.
  const level = g.deck + (g.height - g.deck) * 0.55
  const out = Math.sqrt(bow.radius * bow.radius - (bow.y - level) * (bow.y - level))
  assert.ok(bow.x - out > 0 && bow.x - out < g.margin, "left foot at " + (bow.x - out))
  assert.ok(bow.x + out > g.width - g.margin && bow.x + out < g.width)
  // It stands away from the sun.
  assert.strictEqual(bow.side, -1)
  assert.strictEqual(M.bowShape(g, 200).side, 1)
  // A scene that says nothing of its frame (the panel's miniature) still gets one that fits.
  const small = M.bowShape({ width: 400, height: 200 }, 100)
  assert.ok(small.radius > 0 && small.y - small.radius > 0 && small.y - small.radius < 200 * 0.21)
  // And the scene is handed it.
  const colors = M.parseThemeColors('mode = "dark"\nbackground = "#142620"\nforeground = "#dfede5"\n')
  const sky = M.celestial(new Date(2026, 5, 1, 17, 0).getTime(), [], [], g, 40, 0.3)
  const look = M.sceneUniforms(M.derivePalette(colors, {}), sky, M.weatherFromCode(61, 40, 10, 250), g).scene
  assert.strictEqual(look.bowX, bow.x)
  assert.ok(Math.abs(look.bowR - bow.radius) < 1e-9 && Math.abs(look.bowY - bow.y) < 1e-9)
  assert.ok(look.bowSide === 1 || look.bowSide === -1)
})

test("on battery the quality comes down one level, and low stays low", () => {
  assert.strictEqual(M.easedQuality("ultra"), "high")
  assert.strictEqual(M.easedQuality("high"), "medium")
  assert.strictEqual(M.easedQuality("medium"), "low")
  assert.strictEqual(M.easedQuality("low"), "low")
  // Anything it does not know is medium, as qualityFor has it.
  assert.strictEqual(M.easedQuality("nonsense"), "low")
  assert.ok(M.qualityFor(M.easedQuality("ultra")).pixel > M.qualityFor("ultra").pixel)
})

// A forecast with the hours in it: `count` of them from `from` (unix seconds).
function hourly(from, count, fill) {
  const cols = { time: [], weather_code: [], temperature_2m: [], apparent_temperature: [], relative_humidity_2m: [], precipitation: [],
    precipitation_probability: [], cloud_cover: [], cloud_cover_low: [], cloud_cover_mid: [], cloud_cover_high: [],
    wind_speed_10m: [], wind_direction_10m: [], wind_gusts_10m: [], visibility: [] }
  for (let i = 0; i < count; i++) {
    const h = Object.assign({ weather_code: 2, temperature_2m: 15, apparent_temperature: 14, relative_humidity_2m: 70, precipitation: 0,
      precipitation_probability: 10, cloud_cover: 40, cloud_cover_low: 30, cloud_cover_mid: 10, cloud_cover_high: 0,
      wind_speed_10m: 12, wind_direction_10m: 250, wind_gusts_10m: 25, visibility: 20000 }, fill ? fill(i) : {})
    cols.time.push(from + i * 3600)
    for (const k in h) cols[k].push(h[k])
  }
  return JSON.stringify({ utc_offset_seconds: 0, current: { weather_code: 1, temperature_2m: 17 }, hourly: cols })
}

test("the forecast asks for the hours, and reads them as it reads the present", () => {
  const url = M.forecastUrl(38.72, -9.14)
  assert.ok(/&hourly=weather_code,temperature_2m/.test(url) && /precipitation_probability/.test(url))
  assert.ok(/&past_hours=24&forecast_hours=48/.test(url))
  const from = 1794441600
  const f = M.parseForecast(hourly(from, 30, i => i === 5 ? { weather_code: 63, precipitation: 2.4, precipitation_probability: 80, temperature_2m: 11 } : {}))
  assert.strictEqual(f.hours.length, 30)
  assert.strictEqual(f.hours[0].at, from * 1000)
  assert.deepStrictEqual([f.hours[5].code, f.hours[5].precip, f.hours[5].chance, f.hours[5].temperature], [63, 2.4, 0.8, 11])
  assert.strictEqual(f.hours[5].windSpeed, 12)
  // No hours given is no hours, not a failure; and an hour with no code is left out.
  assert.deepStrictEqual(M.parseForecast(JSON.stringify({ current: { weather_code: 1 } })).hours, [])
  const holed = JSON.parse(hourly(from, 4))
  holed.hourly.weather_code[2] = null
  holed.hourly.precipitation[1] = "lots"
  const g = M.parseForecast(JSON.stringify(holed))
  assert.strictEqual(g.hours.length, 3)
  assert.strictEqual(g.hours[1].precip, 0)
})

test("an hour's reading is the nearest hour given, and none when the forecast does not reach", () => {
  const from = 1794441600
  const f = M.parseForecast(hourly(from, 12, i => ({ temperature_2m: i })))
  const at = h => from * 1000 + h * 3600000
  assert.strictEqual(M.readingAt(f, at(3)).temperature, 3)
  assert.strictEqual(M.readingAt(f, at(3.4)).temperature, 3)
  assert.strictEqual(M.readingAt(f, at(3.6)).temperature, 4)
  // An hour past either end is still that end; further than that is nothing.
  assert.strictEqual(M.readingAt(f, at(11.9)).temperature, 11)
  assert.strictEqual(M.readingAt(f, at(13.5)), null)
  assert.strictEqual(M.readingAt(f, at(-2)), null)
  assert.strictEqual(M.readingAt(null, at(3)), null)
  assert.strictEqual(M.readingAt({}, at(3)), null)
  // The sky is made from it the way it is from the present reading.
  const r = M.readingAt(M.parseForecast(hourly(from, 3, () => ({ weather_code: 65, precipitation: 6 }))), at(1))
  const w = M.weatherFromCode(r.code, r.cloudCover, r.windSpeed, r.windDirection, { temperature: r.temperature })
  assert.ok(w.rain > 0.5 && w.key === "heavyRain")
})

test("the day's ruler gets what falls in each of its hours", () => {
  const day = 1794441600000
  // Hours are stamped at their end: the one stamped 15:00 is what fell from 14:00.
  const f = M.parseForecast(hourly(day / 1000, 30, i => i === 15 ? { precipitation: 3, precipitation_probability: 90, weather_code: 63 }
    : i === 23 ? { precipitation: 1, weather_code: 73, temperature_2m: -2 } : {}))
  const strip = M.hourStrip(f, day)
  assert.strictEqual(strip.length, 24)
  assert.deepStrictEqual(strip[14], { amount: 3, chance: 0.9, snow: false })
  assert.deepStrictEqual(strip[22], { amount: 1, chance: 0.1, snow: true })
  assert.strictEqual(strip[3].amount, 0)
  // A day the forecast only partly covers has gaps, and one it does not cover has nothing.
  const late = M.hourStrip(f, day + 20 * 3600000)
  assert.ok(late[2] !== null && late[23] === null)
  assert.deepStrictEqual(M.hourStrip(f, day + 5 * 86400000), [])
  assert.deepStrictEqual(M.hourStrip(null, day), [])
  // A place whose hours fall on the half hour still lines up.
  const half = M.parseForecast(hourly(day / 1000 + 1800, 26, i => i === 9 ? { precipitation: 2 } : {}))
  assert.ok(M.hourStrip(half, day).some(e => e && e.amount === 2))
  // How long a bar: nothing for nothing, something for drizzle, full by four millimetres.
  assert.strictEqual(M.stripLength(0), 0)
  assert.ok(M.stripLength(0.2) > 0.25 && M.stripLength(0.2) < 0.5)
  assert.strictEqual(M.stripLength(8), 1)
  assert.strictEqual(M.stripLength("x"), 0)
})

test("the bar icon is warned of what is about to start falling", () => {
  const now = 1794493800000, q = 900000
  const reading = (code, falls) => ({ code: code, soon: falls.map((mm, i) => ({ at: now + i * q, precip: mm, code: mm > 0 ? 61 : 2 })) })
  // Dry now, rain in the quarter that begins in half an hour.
  assert.deepStrictEqual(M.fallSoon(reading(2, [0, 0, 0, 0.4, 1.2, 0, 0, 0]), now), { minutes: 30, snow: false })
  // In the very next quarter: any minute.
  assert.deepStrictEqual(M.fallSoon(reading(2, [0, 0.3, 0, 0, 0, 0, 0, 0]), now), { minutes: 0, snow: false })
  // Some minutes later it is nearer, to the nearest five.
  assert.strictEqual(M.fallSoon(reading(2, [0, 0, 0, 0.4, 0, 0, 0, 0]), now + 8 * 60000).minutes, 20)
  // Nothing on its way, or more than an hour off: nothing to say.
  assert.strictEqual(M.fallSoon(reading(2, [0, 0, 0, 0, 0, 0, 0, 0]), now), null)
  assert.strictEqual(M.fallSoon(reading(2, [0, 0, 0, 0, 0, 0, 0, 2]), now), null)
  // Already raining: it is a warning of a change, not a report.
  assert.strictEqual(M.fallSoon(reading(63, [1, 1, 1, 1, 1, 1, 1, 1]), now), null)
  // Snow is told apart by the kind of weather.
  const snow = { code: 3, soon: [{ at: now + 2 * q, precip: 0.5, code: 73 }] }
  assert.deepStrictEqual(M.fallSoon(snow, now), { minutes: 15, snow: true })
  // A code that says it falls counts even where no amount is given.
  assert.strictEqual(M.fallSoon({ code: 1, soon: [{ at: now + q, precip: 0, code: 80 }] }, now).minutes, 0)
  assert.strictEqual(M.fallSoon(null, now), null)
  assert.strictEqual(M.fallSoon({ code: 1 }, now), null)
  assert.ok(M.codeFalls(51) && M.codeFalls(67) && M.codeFalls(82) && M.codeFalls(95) && !M.codeFalls(3) && !M.codeFalls(45))
  assert.ok(M.codeSnows(71) && M.codeSnows(86) && !M.codeSnows(61))
})

test("the forecast asks for the next two hours by the quarter and reads them", () => {
  assert.ok(/&minutely_15=precipitation,weather_code&past_minutely_15=0&forecast_minutely_15=8/.test(M.forecastUrl(38.72, -9.14)))
  const f = M.parseForecast(JSON.stringify({ current: { weather_code: 2 },
    minutely_15: { time: [1794493800, 1794494700, "x", 1794496500], precipitation: [0, 0.3, 1, null], weather_code: [2, 61, 61, 2] } }))
  assert.deepStrictEqual(f.soon, [
    { at: 1794493800000, precip: 0, code: 2 }, { at: 1794494700000, precip: 0.3, code: 61 }, { at: 1794496500000, precip: 0, code: 2 }])
  assert.deepStrictEqual(M.parseForecast(JSON.stringify({ current: { weather_code: 2 } })).soon, [])
})

test("the northern lights keep to high latitudes, and to some nights", () => {
  // Nowhere near the equator, on any night.
  for (let night = 0; night < 400; night++) {
    assert.strictEqual(M.auroraFor(40, night), 0)
    assert.strictEqual(M.auroraFor(-35, night), 0)
  }
  // Far north, most nights but not all; further south, fewer; and the far south has them as the far north does.
  const nights = lat => { let n = 0; for (let night = 20000; night < 20400; night++) if (M.auroraFor(lat, night) > 0) n++; return n }
  assert.ok(nights(68) > 250 && nights(68) < 400, "at 68: " + nights(68))
  assert.ok(nights(57) > 40 && nights(57) < nights(68), "at 57: " + nights(57))
  assert.ok(nights(-68) > 250)
  // A night is one thing from dusk to dawn, and a strength worth seeing when it comes.
  assert.strictEqual(M.auroraFor(68, 20001), M.auroraFor(68, 20001))
  for (let night = 20000; night < 20050; night++) { const a = M.auroraFor(68, night); assert.ok(a === 0 || (a >= 0.45 && a <= 1)) }
  assert.strictEqual(M.auroraFor(null, 1), 0)
  assert.strictEqual(M.auroraFor("north", 1), 0)
  // Which night it is does not change at midnight.
  const g = { width: 1600, height: 1000, margin: 200, deck: 180 }
  const late = M.celestial(new Date(2026, 0, 10, 23, 30).getTime(), [], [], g, 68)
  const early = M.celestial(new Date(2026, 0, 11, 2, 0).getTime(), [], [], g, 68)
  assert.strictEqual(late.nightOf, early.nightOf)
  assert.strictEqual(late.latitude, 68)
  assert.strictEqual(M.celestial(Date.now(), [], [], g, undefined).latitude, null)
})

test("the lights and the fireflies want the dark, and the right sky", () => {
  const palette = M.derivePalette({ mode: "dark", background: "#142620", foreground: "#dfede5", green: "#9ece6a", magenta: "#bb9af7", yellow: "#e0af68" }, {})
  const g = { width: 1600, height: 1000, margin: 200, deck: 180, desk: null }
  const night = M.celestial(new Date(2026, 5, 1, 23, 30).getTime(), [], [], g, 40)
  const noon = M.celestial(new Date(2026, 5, 1, 12, 0).getTime(), [], [], g, 40)
  const scene = (sky, w) => M.sceneUniforms(palette, sky, w, g).scene
  const clear = M.manualWeather({ cover: 0.05, precip: 0, temperature: 22, wind: 6, aurora: true, fireflies: true })
  // By hand, on a clear warm night: both, in the theme's colors.
  const both = scene(night, clear)
  assert.ok(both.aurora > 0.8 && both.fireflies > 0.8)
  assert.ok(/^#[0-9a-f]{6}$/.test(both.auroraLow) && /^#[0-9a-f]{6}$/.test(both.auroraHigh) && /^#[0-9a-f]{6}$/.test(both.fireflyColor))
  // Not by day, whatever is switched on.
  assert.ok(scene(noon, clear).aurora < 0.01 && scene(noon, clear).fireflies < 0.01)
  // The lights are lost behind a closed sky; the fireflies are not.
  const closed = scene(night, M.manualWeather({ cover: 1, precip: 0, temperature: 22, wind: 6, aurora: true, fireflies: true }))
  assert.ok(closed.aurora < 0.01 && closed.fireflies > 0.8)
  // Switched off by hand they are off.
  const off = scene(night, M.manualWeather({ cover: 0.05, precip: 0, temperature: 22, wind: 6 }))
  assert.ok(off.aurora === 0 && off.fireflies === 0)
  // Left to the weather, fireflies come with a warm, still, dry night and not otherwise.
  const live = (t, extra) => scene(night, Object.assign(M.weatherFromCode(0, 5, 6, 250, { temperature: t }), extra || {})).fireflies
  assert.ok(live(23) > 0.8)
  assert.strictEqual(live(8), 0)
  assert.ok(M.firefliesFor(M.weatherFromCode(63, 90, 6, 250, { temperature: 23 })) < 0.05)
  assert.ok(M.firefliesFor(M.weatherFromCode(0, 5, 60, 250, { temperature: 23 })) < 0.05)
  assert.strictEqual(M.firefliesFor(M.weatherFromCode(0, 5, 6, 250)), 0)
  // And at forty degrees the live sky has no lights, on any night.
  assert.strictEqual(scene(night, M.weatherFromCode(0, 5, 6, 250, { temperature: 10 })).aurora, 0)
  // With the hour switched out of the sky there is no night for either.
  const steady = M.steadySky(night, 1)
  assert.ok(scene(steady, clear).aurora < 0.01 && scene(steady, clear).fireflies < 0.01)
})

test("a sky turning from live to set by hand brings the lights in, and back out", () => {
  const live = M.weatherFromCode(0, 5, 6, 250, { temperature: 20 })
  const hand = M.manualWeather({ cover: 0.05, precip: 0, temperature: 20, wind: 6, aurora: true })
  // Toward a hand-set sky they are part of what it turns to.
  const part = M.mixWeather(hand, M.manualWeather({ cover: 0.05, precip: 0, temperature: 20, wind: 6 }), 0.5)
  assert.ok(part.aurora > 0.4 && part.aurora < 0.6 && part.settled === false)
  assert.strictEqual(M.mixWeather(live, hand, 1).aurora, 1)
  // Back toward the live sky they are left out again, for the sky to decide.
  assert.strictEqual(M.mixWeather(hand, live, 0.3).aurora, undefined)
})

test("the rain and the wind are as loud as there is of them, and snow is silent", () => {
  const quiet = M.soundLevels(M.weatherFromCode(0, 5, 6, 250))
  assert.deepStrictEqual(quiet, { rain: 0, wind: 0 })
  const drizzle = M.soundLevels(M.manualWeather({ cover: 0.6, precip: 0.15, temperature: 14, wind: 5 }))
  const pour = M.soundLevels(M.manualWeather({ cover: 0.9, precip: 0.95, temperature: 14, wind: 5 }))
  assert.ok(drizzle.rain > 0 && drizzle.rain < 0.3 && pour.rain > 0.85 && pour.wind === 0)
  // The same amount falling as snow makes no sound; with hail it is louder than rain alone.
  assert.strictEqual(M.soundLevels(M.manualWeather({ cover: 0.9, precip: 0.95, temperature: -8, wind: 5 })).rain, 0)
  const rain = M.manualWeather({ cover: 0.9, precip: 0.5, temperature: 14, wind: 5 })
  const hail = M.manualWeather({ cover: 0.9, precip: 0.5, temperature: 14, wind: 5, hail: true })
  assert.ok(M.soundLevels(hail).rain > M.soundLevels(rain).rain)
  // Wind is heard from a stiff breeze up.
  assert.strictEqual(M.soundLevels(M.manualWeather({ cover: 0.2, precip: 0, temperature: 14, wind: 8 })).wind, 0)
  const gale = M.soundLevels(M.manualWeather({ cover: 0.2, precip: 0, temperature: 14, wind: 70 }))
  assert.ok(gale.wind > 0.8 && gale.wind <= 1)
  assert.deepStrictEqual(M.soundLevels(null), { rain: 0, wind: 0 })
})

console.log("ok: " + ran + " tests")
