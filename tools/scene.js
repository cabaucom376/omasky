#!/usr/bin/env node
// Build a scene for tools/preview.py from the same Model.js the plugin runs.
//
//   node tools/scene.js [--weather rain] [--hour 14.5] [--date 2026-11-11]
//     [--size 1625x1025] [--theme <colors.toml>] [--time 12] [--quality high]
//     [--windows one|two|three|float|none] [--snow-depth 12] [--flash 0.8]
//     [--alpha 0.9] [--cover 0.4] [--windspeed 14] [--winddir 250]
//     [--phase 0.3] [--south] [--plate] > scene.json
//
// --weather takes a preview name (clear, partly, cloudy, fog, rain, snow,
// storm, ...) or a WMO code. Sunrise and sunset fall back to 6:30 and 18:30.
// The windows are plain boxes here: the blur and the heat shimmer need the
// live ones, so they are only seen in the running plugin.

const fs = require("fs")
const path = require("path")
const Model = require(path.join(__dirname, "..", "Model.js"))

const args = {}
for (let i = 2; i < process.argv.length; i++) {
  const key = process.argv[i].replace(/^--/, "")
  const next = process.argv[i + 1]
  if (next === undefined || next.startsWith("--")) args[key] = true
  else { args[key] = next; i++ }
}

const [width, height] = String(args.size || "1625x1025").split("x").map(Number)
const themePath = args.theme || path.join(process.env.HOME, ".local/state/omarchy/current/theme/colors.toml")
const colors = Model.parseThemeColors(fs.readFileSync(themePath, "utf8"))
const palette = Model.derivePalette(colors, {})
const quality = Model.qualityFor(args.quality || "high")

const code = Model.previewCode(args.weather || "clear")
if (code < 0) { console.error("unknown weather: " + args.weather); process.exit(1) }
const weather = Model.weatherFromCode(code, args.cover !== undefined ? Number(args.cover) * 100 : null,
  args.windspeed !== undefined ? Number(args.windspeed) : 14, args.winddir !== undefined ? Number(args.winddir) : 250)

// --clouds 0.1, --rain 1, --snow 1: set those outright, whatever the weather
// asked for brought with it, the way the debug panel's sliders do. Rain and
// snow fall from the clouds there are, as hard as they are told to.
if (args.clouds !== undefined) weather.cover = weather.coverLow = weather.coverMid = weather.coverHigh = Number(args.clouds)
// --high 0.6: thin high cloud alone. --hail 1, --gust 1, --temp -5.
if (args.high !== undefined) weather.coverHigh = Number(args.high)
if (args.hail !== undefined) weather.hail = Number(args.hail)
if (args.gust !== undefined) weather.gust = Number(args.gust)
if (args.temp !== undefined) weather.temperature = Number(args.temp)
if (args.rain !== undefined) weather.rain = Number(args.rain)
if (args.snow !== undefined) weather.snow = Number(args.snow)
if (args.clouds !== undefined || args.rain !== undefined || args.snow !== undefined)
  weather.storm = Math.max(0, Math.min(1, (weather.thunder || 0) * 0.6 + weather.rain * 0.7 + weather.snow * 0.25))

const hour = args.hour !== undefined ? Number(args.hour) : 13
const now = args.date ? new Date(args.date + "T00:00:00") : new Date()
now.setHours(Math.floor(hour), Math.round((hour % 1) * 60), 0, 0)

// A tiled workspace: Hyprland's gaps around and between the windows.
const gap = 10, between = 10
const layouts = {
  none: [],
  one: [{ x: gap, y: gap, width: width - gap * 2, height: height - gap * 2 }],
  two: [
    { x: gap, y: gap, width: (width - gap * 2 - between) / 2, height: height - gap * 2 },
    { x: gap + (width - gap * 2 - between) / 2 + between, y: gap, width: (width - gap * 2 - between) / 2, height: height - gap * 2 }
  ],
  // Two tiled, and one floating across the top edge of both.
  float: [
    { x: gap, y: gap, width: (width - gap * 2 - between) / 2, height: height - gap * 2 },
    { x: gap + (width - gap * 2 - between) / 2 + between, y: gap, width: (width - gap * 2 - between) / 2, height: height - gap * 2 },
    { x: width * 0.30, y: -height * 0.12, width: width * 0.36, height: height * 0.5 }
  ],
  three: [
    { x: gap, y: gap, width: (width - gap * 2 - between) * 0.55, height: height - gap * 2 },
    { x: gap + (width - gap * 2 - between) * 0.55 + between, y: gap, width: (width - gap * 2 - between) * 0.45, height: (height - gap * 2 - between) * 0.4 },
    { x: gap + (width - gap * 2 - between) * 0.55 + between, y: gap + (height - gap * 2 - between) * 0.4 + between, width: (width - gap * 2 - between) * 0.45, height: (height - gap * 2 - between) * 0.6 }
  ]
}
const windows = layouts[args.windows || "three"]
const placement = Model.deskPlacement(width, height, args.shrink !== undefined ? Number(args.shrink) : 0.78)
const rects = Model.windowRects(windows, placement)
const box = Model.bounds(windows)
const geometry = { width, height, margin: placement.x, deck: placement.y, desk: box ? Model.placed(box, placement, 1) : null }
const sky = Model.celestial(now.getTime(), [], [], geometry, args.south ? -30 : 40)
if (args.phase !== undefined) {
  sky.moon.phase = Number(args.phase)
  sky.moon.key = Model.moonPhaseKey(sky.moon.phase)
  sky.moon.lit = 0.5 - 0.5 * Math.cos(2 * Math.PI * sky.moon.phase)
}

// Windows from here on float; with --ghost-from, the places between the two
// are where a window was, and only its snow is left.
const floatFrom = args["float-from"] !== undefined ? Number(args["float-from"]) : 6

function each(name, index, fallback) {
  if (args[name] === undefined) return fallback
  const parts = String(args[name]).split(",")
  return index < parts.length && parts[index] !== "" ? Number(parts[index]) : fallback
}

const time = args.time !== undefined ? Number(args.time) : 12
const flash = args.flash !== undefined ? Number(args.flash) : 0
const u = Model.sceneUniforms(palette, sky, weather, geometry)
const snowDepth = args["snow-depth"] !== undefined ? Number(args["snow-depth"]) : (weather.snow > 0 ? 14 : 0)

// What the service sets itself, frame by frame.
const uniforms = Object.assign({}, u.scene, {
  time, slowTime: time, pixel: quality.pixel, detail: quality.detail,
  skyAlpha: (args.alpha !== undefined ? Number(args.alpha) : 0.9) * (args.wash !== undefined ? Number(args.wash) : u.wash),
  flash, boltX: width * (args.bolt !== undefined ? Number(args.bolt) : 0.36), boltSeed: 4.2,
  snowDepth, groundDepth: (args["ground-depth"] !== undefined ? Number(args["ground-depth"]) : snowDepth) * 1.6,
  canvas: [Math.ceil(width / quality.pixel), Math.ceil(height / quality.pixel)],
  laneDrift: Model.LANE_SPEED.map(share => weather.windPx * share * time).concat([0]),
  w0: rects[0], w1: rects[1], w2: rects[2], w3: rects[3], w4: rects[4], w5: rects[5],
  // --depths "26,4,0": the snow on each window, where they differ.
  // --shelters "1,0": how far each keeps it off the ground beneath.
  // --float-from 2: the first window that floats over the rest.
  depthA: [0, 1, 2, 3].map(i => each("depths", i, snowDepth)),
  depthB: [each("depths", 4, snowDepth), each("depths", 5, snowDepth), floatFrom, args["ghost-from"] !== undefined ? Number(args["ghost-from"]) : floatFrom],
  shelterA: [0, 1, 2, 3].map(i => each("shelters", i, 1)),
  shelterB: [each("shelters", 4, 1), each("shelters", 5, 1), 0, 0],
  // --ices "18,6": how long the icicles under each window have grown.
  iceA: [0, 1, 2, 3].map(i => each("ices", i, 0)),
  iceB: [each("ices", 4, 0), each("ices", 5, 0), 0, 0]
})

const layers = [{ shader: "scene-back", uniforms: Object.assign({}, uniforms, { front: 0 }) }]
for (const r of rects) {
  if (r[2] > 0) layers.push({ rect: r, color: colors.background, border: colors.accent })
}
layers.push({ shader: "scene-front", uniforms: Object.assign({}, uniforms, { front: 1 }) })

// The plate behind the words in the corner, about the size it is on screen.
if (args.plate) {
  const region = [0, 0, 800, 380]
  // Over the finished frame here, so the picture is already at the screen's
  // size: one pixel to a pixel, and the patch is the whole of the region.
  const none = [0, 0, 0, 0]
  layers.push({ shader: "plate", region, uniforms: { blur: quality.blur ? 1 : 0, tint: 0.46, grain: 1, fade: 0, guard: 0, pixel: 1,
    canvas: [region[2], region[3]], texel: [1 / region[2], 1 / region[3]], extent: [1, 1], extentRight: [0, 0], core: [0, 0], coreRight: [0, 0], scrim: u.scrim,
    spare: [6, 6, 0, 0], w0: none, w1: none, w2: none, w3: none, w4: none, w5: none } })
}

process.stderr.write(JSON.stringify({ weather: weather.key, isDay: sky.isDay, dayness: +sky.dayness.toFixed(2),
  twilight: +sky.twilight.toFixed(2), moon: sky.moon.key, windPx: weather.windPx, quality: quality.name }) + "\n")
process.stdout.write(JSON.stringify({ size: [width, height], backdrop: args.backdrop || colors.lighter_background || colors.background, layers }))
