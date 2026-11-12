import QtQuick
import QtQuick.Effects
import Quickshell
import Quickshell.Io
import Quickshell.Wayland
import Quickshell.Hyprland
import Quickshell.Services.UPower
import qs.Commons
import qs.Commons as Commons
import "Model.js" as Model

// Omasky: the weather takes over the desktop, as pixel art.
//
// Switched on, the workspace gets a little smaller and the weather moves in
// around it. The windows are the real ones: invisible strips along the
// screen's edges keep a margin to themselves, the way a bar does, so the
// windows are laid out in a smaller frame and stay exactly as usable as
// they were. Each screen has two surfaces of its own besides: one under the
// windows for the sky, where the sun or moon rides
// an arc over the frame by the clock and clouds cross at the speed the wind
// is blowing, and one over them, which takes no input, for the weather that
// meets the windows. At high quality that is physical: drops land on the
// windows, splash, and run off their edges, and snow piles up on them.
//
// Getting there and back is a glide. A still of each window crosses from
// where it was to where it now is, covering the real ones, which have
// already jumped; then the stills are put away.
//
// It talks to the network only while it or its panel is showing: Omarchy's own location
// lookup (unless a weather location is set) and Open-Meteo for the conditions.
Item {
  id: root

  // Injected by the shell's service loader.
  property var shell: null
  property var manifest: null

  // The bar widget hands over its shell.json entry; with no widget in the bar
  // the defaults stand.
  property var settings: ({})
  // What the panel has just set, until the bar entry has it saved and hands
  // it back: a switch answers at once, not when the file has been written.
  property var picks: ({})

  function setting(name, fallback) {
    if (picks[name] !== undefined) return picks[name]
    var value = settings ? settings[name] : undefined
    return value === undefined || value === null ? fallback : value
  }

  // Set one setting and save the bar entry with it.
  function saveSetting(name, value) {
    var one = {}
    one[name] = value
    saveSettings(one)
  }

  // Or several at once.
  function saveSettings(values) {
    var held = {}
    for (var k in picks) held[k] = picks[k]
    for (var name in values) held[name] = values[name]
    picks = held
    saveEntry()
  }

  function saveEntry() {
    var merged = {}
    for (var key in settings) merged[key] = settings[key]
    for (var p in picks) merged[p] = picks[p]
    if (qualityPick !== "") merged.quality = qualityPick
    if (shell && shell.updateEntryInline) shell.updateEntryInline("omasky", merged)
  }

  // Once the saved entry agrees with a pick the pick is done with, so a
  // later change to the file is heard.
  onSettingsChanged: {
    var held = {}, any = false, dropped = false
    for (var k in picks) {
      if (settings && settings[k] === picks[k]) dropped = true
      else { held[k] = picks[k]; any = true }
    }
    if (dropped) picks = any ? held : ({})
  }

  // How much of the screen the windows keep, each way.
  readonly property real shrink: Model.clamp(setting("shrink", 0.78), 0.4, 0.94)
  // The most of the wallpaper the sky may cover, which it does in the worst
  // weather; on a fair day it covers a quarter of that.
  readonly property real skyOpacity: Model.clamp(setting("skyOpacity", 0.9), 0.3, 1)
  readonly property bool animate: setting("animate", true) !== false
  // The words in the corner of the sky: how warm it is and what it is doing.
  readonly property bool showInfo: setting("showInfo", true) !== false
  // The sky is two things that are switched apart. The weather: clouds, what
  // falls from them, fog, wind, heat, and what lies and hangs on the windows.
  // And the hour: the sun and moon on their arc, the stars, and the color of
  // the sky by the time of day. Either is shown without the other.
  readonly property bool weatherOn: setting("weather", true) !== false
  readonly property bool dayNight: setting("dayNight", true) !== false

  // They come at two levels: the temperature and what it is doing; or, with
  // that, the detail (how it feels, the wind, the humidity, today's high and
  // low) and the days ahead, as Omarchy's own weather panel has them.
  readonly property bool infoDetail: setting("infoDetail", false) === true
  // 0 none, 1 the words, 2 the words and the detail.
  readonly property int infoLevel: !showInfo ? 0 : (infoDetail ? 2 : 1)

  function setShowInfo(on) { saveSetting("showInfo", on === true) }
  function setInfoLevel(level) {
    var n = Math.max(0, Math.min(2, Math.round(Number(level) || 0)))
    // Switched off, it keeps the level it had for when it is switched on again.
    if (n === 0) saveSetting("showInfo", false)
    else saveSettings({ showInfo: true, infoDetail: n > 1 })
  }
  function setWeatherOn(on) { saveSetting("weather", on === true) }
  function setDayNight(on) { saveSetting("dayNight", on === true) }

  // How much of each is showing, 0..1. A switch turns it over a moment: the
  // clouds thin out and the sun fades, nothing is cut.
  property real weatherShare: weatherOn ? 1 : 0
  property real cycleShare: dayNight ? 1 : 0
  property real infoShare: showInfo ? 1 : 0
  property real detailShare: showInfo && infoDetail ? 1 : 0
  Behavior on detailShare { enabled: root.watched; NumberAnimation { duration: 320; easing.type: Easing.InOutQuad } }
  Behavior on weatherShare { enabled: root.watched; NumberAnimation { duration: 700; easing.type: Easing.InOutQuad } }
  Behavior on cycleShare { enabled: root.watched; NumberAnimation { duration: 900; easing.type: Easing.InOutQuad } }
  Behavior on infoShare { enabled: root.watched; NumberAnimation { duration: 320; easing.type: Easing.InOutQuad } }
  readonly property int refreshMinutes: Math.round(Model.clamp(setting("refreshMinutes", 15), 5, 180))
  readonly property string unit: String(setting("unit", "auto"))

  // Low, medium, high or ultra: what the weather is allowed to do. Picked in
  // the panel it holds here until the bar entry has saved it. Left alone the
  // setting is "auto", which is whatever this machine can carry: the plugin
  // looks at what draws the screen, how many cores there are and how much
  // memory, once, when it starts.
  property string qualityPick: ""
  property string suggestedQuality: ""
  readonly property string qualitySetting: String(setting("quality", "auto") || "auto")
  readonly property bool qualityAuto: qualityPick === "" && qualitySetting === "auto"
  // Until the machine has been looked at there is nothing to draw with, and
  // nothing is drawn: no shader is compiled for a quality that is about to
  // change.
  readonly property bool qualityKnown: !qualityAuto || suggestedQuality !== ""
  // The level chosen: by hand, or for the machine.
  readonly property string qualityChoice: Model.qualityFor(qualityPick || (qualityAuto ? (suggestedQuality || "medium") : qualitySetting)).name
  // Running on the battery, or with the power-saver profile on, the sky is
  // drawn one level lower than that, and comes back up when the power does.
  // (Nothing is compiled for it: the level is a number the shaders are handed.)
  readonly property bool easeOnBattery: setting("easeOnBattery", true) !== false
  readonly property bool savingPower: easeOnBattery && (UPower.onBattery || PowerProfiles.profile === PowerProfile.PowerSaver)
  readonly property var quality: Model.qualityFor(savingPower ? Model.easedQuality(qualityChoice) : qualityChoice)

  Process {
    id: machineProbe
    // The renderer's name, the cores, the memory in GiB, one to a line.
    // Without Omarchy's own way of asking what draws the screen the name is
    // "unknown", which is taken to be a real GPU.
    command: ["sh", "-c", '(command -v omarchy-hw-software-rendering >/dev/null 2>&1 && omarchy-hw-software-rendering --print 2>/dev/null; echo unknown) | head -n 1; '
      + "nproc 2>/dev/null || echo 4; awk '/^MemTotal:/ { printf \"%.1f\\n\", $2 / 1048576 }' /proc/meminfo 2>/dev/null || echo 8"]
    stdout: StdioCollector {
      onStreamFinished: {
        var lines = String(text || "").split("\n")
        root.suggestedQuality = Model.suggestQuality(String(lines[0] || "unknown").trim(), Number(lines[1]) || 4, Number(lines[2]) || 8)
      }
    }
  }
  // Should the question never be answered, the middle is a safe guess.
  Timer {
    interval: 2000
    running: root.suggestedQuality === ""
    onTriggered: if (root.suggestedQuality === "") root.suggestedQuality = "medium"
  }

  // low, medium, high or ultra; or auto, to go back to what suits the machine.
  function setQuality(name) {
    if (String(name) === "auto") {
      qualityPick = ""
      saveSetting("quality", "auto")
      return
    }
    qualityPick = Model.qualityFor(name).name
    if (picks.quality !== undefined) {
      var held = {}
      for (var k in picks) if (k !== "quality") held[k] = picks[k]
      picks = held
    }
    saveEntry()
  }

  // --------------------------------------------------------------- showing
  //
  // active: the sky is wanted. mounted: its surfaces are up. staged: a still
  // of every window has arrived, so the glide can begin. presence runs 0
  // (the desktop as it was) to 1 (fully stepped back).
  //
  // reserve: the windows are being kept to the frame. Hyprland moves them
  // there at once, so while the scene glides it hides them under a cover:
  // the wallpaper, the sky, and the stills crossing from where the windows
  // were to where they are. frozen: a glide is under way, and each still
  // has kept how its window looked when it began; oldAmount is how much of
  // that still shows over the fresh one, which is how the picture gets from
  // a window at one size to the same window at another without a jump.

  property bool active: false
  property bool mounted: false
  // Somebody is looking: at the sky, or at the panel, which opens on its own
  // too and has the sky in miniature. The clock runs and the weather is
  // kept fresh for either.
  readonly property bool watched: mounted || controlsOpen
  property bool staged: false
  property real presence: 0
  property bool reserve: false
  property bool cover: false
  property bool frozen: false
  property real oldAmount: 0
  property real oldFrom: 0
  // Leaving from the settled sky takes two short waits: for fresh stills of
  // the windows (departing), then for the cover to be on screen (leaving).
  property bool departing: false
  property bool leaving: false
  property int leaveFrames: 0
  property int leaveTicks: 0
  // How many window stills have not had their first frame yet.
  property int pendingCopies: 0

  // The sky arrives over the first part of the step back, the weather after.
  // It also gets a head start: the moment the sky is asked for it begins to
  // show, faintly, while the windows are being moved under the cover, so
  // the wait before the glide is not a wait with nothing happening.
  property real skyLead: 0
  readonly property real skyAmount: Math.max(Model.smoothstep(0, 0.75, presence), skyLead)
  readonly property real weatherAmount: Model.smoothstep(0.3, 1, presence)

  // The glide is stepped once a frame from the frame clock, so it cannot run
  // ahead of what is drawn. It moves even where system animations are off,
  // because that is what was asked of it; `animate: false` makes it cut.
  property bool gliding: false
  property real glideFrom: 0
  property real glideTo: 0
  property real glideTime: 0
  property real glideLength: 0
  // The glide waits until the scene itself has been on screen for a few
  // frames, so that shaders are compiled and textures are on the GPU before
  // anything moves. sceneFrames counts frames the scene's own surface has
  // presented since staging; warmFrames counts animation ticks, which other
  // surfaces keep coming, as a way out should those never be reported.
  property int warmFrames: -1
  property int sceneFrames: 0
  // How the last entry went, in milliseconds from the request: when the
  // scene was staged, when its first frame reached the screen, and when it
  // began to glide. For the debug panel and `status`.
  property double shownAt: 0
  property var entry: ({ staged: 0, firstFrame: 0, glide: 0 })
  // The longest single frame in the last few seconds.
  property real hitch: 0
  property real hitchAge: 0
  // How the last glide went, for the debug panel and `status`: frames drawn
  // and the longest any one of them took, in milliseconds.
  property int glideFrames: 0
  property real glideWorst: 0
  property var lastGlide: ({ frames: 0, worst: 0 })
  // Frames a second the scene's own surface is putting on screen, counted
  // from its buffer swaps over the last second. This is the real figure: the
  // shell's frame clock is shared with the bar and keeps ticking at the
  // screen's rate whatever the scene is doing.
  property real frameRate: 0
  property int swaps: 0
  // What the screen can show: the most frameRate can ever read.
  property real refreshHz: 0

  Timer {
    interval: 1000
    repeat: true
    running: root.mounted
    onTriggered: {
      root.frameRate = root.swaps
      root.swaps = 0
    }
  }

  function glide(to, milliseconds) {
    glideFrom = presence
    glideTo = to
    glideTime = 0
    glideFrames = 0
    glideWorst = 0
    glideLength = animate ? milliseconds / 1000 : 0
    gliding = true
    if (glideLength <= 0) stepGlide(0)
  }

  function stepGlide(frameSeconds) {
    if (frameSeconds > 0) {
      glideFrames += 1
      glideWorst = Math.max(glideWorst, frameSeconds * 1000)
    }
    // A hitch stretches the glide rather than skipping part of it.
    glideTime += Math.min(frameSeconds, 0.034)
    var p = glideLength > 0 ? Math.min(1, glideTime / glideLength) : 1
    var eased = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2
    presence = glideFrom + (glideTo - glideFrom) * eased
    oldAmount = oldFrom * (1 - Model.smoothstep(0.1, 0.7, p))
    if (p < 1) return
    gliding = false
    lastGlide = { frames: glideFrames, worst: Math.round(glideWorst * 10) / 10 }
    if (!active) {
      gone()
      return
    }
    // Arrived. One more still of each window as it now is, and when those
    // have landed the cover comes off the real ones.
    captureTick += 1
    revealTimer.restart()
  }

  // A glide begins in two steps. First, under a cover that is not moving,
  // the stills keep what they have and the room changes hands: the real
  // windows jump, and every application draws itself again at its new size.
  // That costs a long frame or two, and nobody sees them. Then, once a few
  // frames have come through cleanly, the glide itself.
  property bool primed: false
  property real primeTo: 0
  property int primeFrames: 0
  property int primeTicks: 0
  // Frames in a row that came on time since the windows jumped.
  property int primeCalm: 0

  function prime(to) {
    frozen = true
    oldFrom = 1
    oldAmount = 1
    primeTo = to
    primeFrames = 0
    primeTicks = 0
    primeCalm = 0
    primed = true
    reserve = to > 0.5
  }

  // Caught part way: turn round where it is, without the old stills.
  function turnGlide(to, milliseconds) {
    primed = false
    oldFrom = 0
    oldAmount = 0
    reserve = to > 0.5
    glide(to, milliseconds)
  }

  function gone() {
    revealTimer.stop()
    departTimer.stop()
    reserve = false
    mounted = false
    staged = false
    gliding = false
    cover = false
    frozen = false
    primed = false
    departing = false
    leaving = false
    oldAmount = 0
    skyLead = 0
    controlsOpen = false
    presence = 0
    snowDepth = 0
  }

  Timer {
    id: revealTimer
    interval: 70
    onTriggered: {
      if (!root.active || root.gliding || root.presence < 1) return
      root.cover = false
      root.frozen = false
      root.oldAmount = 0
    }
  }

  // Leaving the settled sky: the stills have had time to land. Put the
  // cover up; the glide begins once it is on screen.
  Timer {
    id: departTimer
    interval: 70
    onTriggered: {
      if (!root.departing) return
      root.departing = false
      if (root.active) return
      root.frozen = false
      root.oldFrom = 1
      root.oldAmount = 1
      root.leaveFrames = 0
      root.leaveTicks = 0
      root.leaving = true
      root.cover = true
    }
  }

  function show() {
    if (active) return
    if (mounted && staged) {
      active = true
      if (departing) {
        // Not left yet.
        departing = false
      } else if (leaving) {
        // The cover is up but nothing has moved.
        leaving = false
        cover = false
        oldAmount = 0
      } else {
        // Caught on its way out: turn it round where it is.
        turnGlide(1, 250 + 450 * (1 - presence))
      }
      revealTimer.stop()
      return
    }
    time = 0
    frameDebt = 0
    strikeAge = -1
    flash = 0
    nextStrike = 2.5 + Math.random() * 3
    // The clouds are already somewhere when the sky arrives.
    laneDrift = [Math.random() * 4000, Math.random() * 4000, Math.random() * 4000]
    wallNow = Date.now()
    shownAt = wallNow
    weather = targetWeather
    heat = 0
    Hyprland.refreshToplevels()
    Hyprland.refreshMonitors()
    wallpaperProbe.running = true
    barsProbe.running = true
    active = true
    staged = false
    gliding = false
    cover = false
    frozen = false
    primed = false
    departing = false
    leaving = false
    reserve = false
    oldAmount = 0
    presence = 0
    warmFrames = -1
    pendingCopies = 0
    mounted = true
    stageWait = 0
    stageTimer.restart()
    if (mode !== "demo" && Date.now() - forecastAt > 10 * Model.MINUTE) refresh()
  }

  function hide() {
    if (!active) return
    active = false
    stageTimer.stop()
    revealTimer.stop()
    if (!staged || (presence <= 0 && !gliding)) {
      // Nothing has moved yet.
      gone()
      return
    }
    if (cover) {
      // On its way in, or only just arrived: the stills are still up.
      turnGlide(0, 520 * Math.max(presence, 0.35))
      return
    }
    // Settled, with the real windows showing. Take a still of each as it is
    // now; departTimer goes on from there.
    departing = true
    captureTick += 1
    departTimer.restart()
  }

  function toggle() {
    if (active) hide()
    else show()
  }

  // When the room last changed hands (see `reserve`, and the frame's strips
  // among the surfaces). Window positions read straight after are from
  // before Hyprland laid them out again.
  property double reserveChangedAt: 0
  onReserveChanged: reserveChangedAt = Date.now()

  // For `status`: the windows the weather is landing on, on the focused
  // screen, and how many closed ones were found lingering and left out.
  property var seenWindows: []
  property int lingering: 0

  // Hyprland says when a window opens, closes or changes workspace, but not
  // when one is moved or resized. The weather has to know where the windows
  // are, so while the sky is up it asks: every other frame during a glide,
  // often while they are moving, ten times a second while they are not.
  // geometryQuiet counts the askings since anything last moved.
  signal geometryTicked()
  property int geometryQuiet: 99
  Timer {
    interval: root.cover ? 30 : (root.geometryQuiet < 12 ? 33 : 100)
    repeat: true
    running: root.mounted && root.staged
    onTriggered: {
      root.geometryQuiet += 1
      Hyprland.refreshToplevels()
      root.geometryTicked()
    }
  }

  // Stage once every window's still has a frame, or after half a second
  // regardless. The cover goes up with it, showing at first exactly what
  // was already there.
  property int stageWait: 0
  Timer {
    id: stageTimer
    interval: 40
    repeat: true
    onTriggered: {
      root.stageWait += 1
      if (root.stageWait < 3 || (root.pendingCopies > 0 && root.stageWait < 13)) return
      stop()
      root.warmFrames = 0
      root.sceneFrames = 0
      root.entry = { staged: Math.round(Date.now() - root.shownAt), firstFrame: 0, glide: 0 }
      root.frozen = false
      root.oldFrom = 1
      root.oldAmount = 1
      root.cover = true
      root.staged = true
    }
  }

  // The stills are only on screen during a glide, under the cover. They are
  // retaken a few times as it goes, so that by the end each shows its window
  // as it now is and the cover can come off without anything changing.
  property int captureTick: 0
  Timer {
    interval: 90
    repeat: true
    running: root.cover && root.staged
    onTriggered: root.captureTick += 1
  }

  // Title bars. On Omarchy's floating workspaces a Hyprland plugin puts one
  // on top of each window, outside the rectangle Hyprland reports for it;
  // the weather has to know, or it treats the bar as open air. Omarchy only
  // switches them on once something floats, which can be while the sky is
  // already up, so this is asked again whenever the windows change and
  // every few seconds besides.
  property var titleBars: null
  // Asked along with them: how each screen's workspace lays its windows out.
  signal surroundingsAsked()
  function probeBars() {
    if (!barsProbe.running) barsProbe.running = true
    surroundingsAsked()
  }
  Timer {
    interval: 4000
    repeat: true
    running: root.mounted
    onTriggered: root.probeBars()
  }
  Process {
    id: barsProbe
    command: ["sh", "-c", 'for o in enabled bar_height workspace_tag; do hyprctl getoption "plugin:hyprbars:$o" -j 2>/dev/null | tr -d "\n"; echo; done']
    stdout: StdioCollector {
      onStreamFinished: {
        // Only when the answer is a different one: every window's place
        // hangs off this.
        var next = Model.titleBars(text)
        if (JSON.stringify(next) !== JSON.stringify(root.titleBars)) root.titleBars = next
      }
    }
  }
  // The colour Omarchy gives them.
  readonly property color titleBarColor: themeColors.lighter_background && themeColors.lighter_background !== themeColors.background
    ? themeColors.lighter_background : (themeColors.selection || Commons.Color.background)

  // The wallpaper the shell is showing, to draw again under the sky.
  property string wallpaper: ""
  Process {
    id: wallpaperProbe
    command: ["readlink", "-f", Quickshell.env("HOME") + "/.local/state/omarchy/current/background"]
    stdout: StdioCollector {
      onStreamFinished: {
        var path = String(text || "").trim()
        root.wallpaper = /\.(jpe?g|png|webp|bmp|gif)$/i.test(path) ? path : ""
      }
    }
  }
  Component.onCompleted: {
    machineProbe.running = true
    wallpaperProbe.running = true
    barsProbe.running = true
    // Where the bar ends, which the panel is placed under even when it is
    // opened with the sky down.
    Hyprland.refreshMonitors()
  }

  // ------------------------------------------------------------ the panel

  property bool controlsOpen: false
  // Whether its debug section is unfolded.
  property bool debugOpen: false
  // Where along the screen the bar icon is, or -1.
  property real controlsX: -1
  // The bar icon itself, which the bar widget hands over; null with no
  // widget in the bar.
  property Item barIcon: null

  // Where the middle of the icon is along its bar, or -1 with no icon. The
  // panel opens under it, however it was asked for.
  function iconX() {
    if (!barIcon) return -1
    var at = barIcon.mapToItem(null, barIcon.width / 2, 0)
    return at ? at.x : -1
  }

  // The panel opens and closes on its own: with the sky up it sits in the
  // sky, and with the sky down it is all there is, so settings can be
  // changed without the scene. (When the sky leaves, the panel goes too.)
  function toggleControls(x) {
    controlsX = x
    controlsOpen = !controlsOpen
  }

  // Opened with the sky down, its miniature starts from the sky as it is
  // now, with the weather asked for if the last reading is old.
  function wakePanel() {
    if (mounted) return
    // Where the bar is: Hyprland's monitor reading is otherwise only asked
    // for when the sky comes up, and without it the panel would open over
    // the bar.
    Hyprland.refreshMonitors()
    wallNow = Date.now()
    weather = targetWeather
    wallpaperProbe.running = true
    if (mode !== "demo" && Date.now() - forecastAt > 10 * Model.MINUTE) refresh()
  }

  // ------------------------------------------------------------------ mode
  //
  // live: the real weather at the real time. preview: one condition forced.
  // manual: every state set by hand in the panel. demo: a day and a night
  // with weather to suit, in a minute and a half.

  property string mode: "live"
  property int previewCode: -1
  property var previewTemperature: null
  property var previewWind: null
  // What the debug panel's sliders hold: how much cloud, how hard it is
  // coming down, how warm it is (which is what makes that rain, sleet or
  // snow, melts what has fallen and grows the icicles), and the rest.
  property var manual: ({ cover: 0.3, precip: 0, fog: 0, thunder: false, hail: false, wind: 14, temperature: 15, hour: -1, phase: -1 })
  property real demoElapsed: 0
  property int demoStep: 0
  property real demoHour: 5.5
  readonly property bool previewing: mode !== "live"
  // Leaving the demo for a mode that keeps the real day asks for it.
  onModeChanged: if (watched && mode !== "demo" && Date.now() - forecastAt > 10 * Model.MINUTE) refresh()

  function goLive() {
    mode = "live"
    previewCode = -1
    previewTemperature = null
    previewWind = null
    pinnedClock = -1
    timelapse = false
    if (watched && Date.now() - forecastAt > 10 * Model.MINUTE) refresh()
  }

  function setDemo(on) {
    if (!on) {
      goLive()
      return
    }
    demoElapsed = 0
    demoStep = 0
    demoHour = Model.demoState(0).hour
    pinnedClock = -1
    timelapse = false
    mode = "demo"
    show()
  }

  // What the sliders would hold to make the sky that is up now.
  function slidersNow() {
    // With the weather switched off, what it would be showing.
    var w = weatherOn ? weather : targetWeather
    return {
      cover: w.cover, precip: w.precip || 0, fog: w.fog,
      thunder: w.thunder > 0.5, hail: w.hail > 0.5,
      // The northern lights and the fireflies start off: by hand they are
      // switches, whatever the night outside is doing.
      aurora: false, fireflies: false,
      wind: (w.windPx < 0 ? -1 : 1) * Math.max(0, (Math.abs(w.windPx) - 6) / 1.5),
      // With no temperature known, one that suits what is falling.
      temperature: temperature === null || temperature === undefined ? (w.snow > w.rain ? -3 : 15) : temperature,
      // The hour and the moon as they stand: the real ones, unless the demo
      // or a pinned clock has them somewhere else. (Not whatever was last
      // set by hand: that sky is gone.)
      hour: mode === "manual" ? manual.hour : (mode === "demo" || pinnedClock >= 0 || timelapse ? hourNow : -1),
      phase: phasePick
    }
  }

  // What the panel's sliders show: what was set by hand, or until something
  // is, the sky as it is, so they follow the real weather as it turns.
  readonly property var sliders: mode === "manual" ? manual : slidersNow()

  // Where each manual slider would be for the real weather.
  readonly property var realSliders: {
    var w = liveWeather
    var t = reading && reading.temperature !== null && reading.temperature !== undefined ? reading.temperature : (w.snow > w.rain ? -3 : 15)
    return {
      cover: w.cover, precip: w.precip || 0, fog: w.fog, temperature: t,
      wind: (w.windPx < 0 ? -1 : 1) * Math.max(0, (Math.abs(w.windPx) - 6) / 1.5)
    }
  }
  // Whether a slider has been moved off the real weather, in manual mode:
  // then it offers the way back (resetSlider).
  function offReal(key) {
    if (mode !== "manual" || realSliders[key] === undefined) return false
    var near = key === "temperature" || key === "wind" ? 0.5 : 0.01
    return Math.abs(Number(manual[key]) - realSliders[key]) > near
  }
  function resetSlider(key) {
    if (realSliders[key] !== undefined) setManual(key, realSliders[key])
  }

  // Start the sliders from what the sky is doing now.
  function seedManual() {
    if (mode === "manual") return
    manual = slidersNow()
  }

  // Take the sky as it stands into hand: it stops following the weather and
  // keeps what it has until something is changed.
  function holdManual() {
    if (mode === "manual") return
    seedManual()
    pinnedClock = -1
    timelapse = false
    mode = "manual"
  }

  function setManual(key, value) {
    // Setting the weather by hand asks to see it, and the same for the hour.
    if (key === "hour" || key === "phase") {
      if (!dayNight) setDayNight(true)
    } else if (!weatherOn) {
      setWeatherOn(true)
    }
    seedManual()
    var next = {}
    for (var k in manual) next[k] = manual[k]
    next[key] = value
    manual = next
    pinnedClock = -1
    timelapse = false
    mode = "manual"
  }

  function applyPreset(name) {
    var code = Model.previewCode(name)
    if (code < 0) return
    if (!weatherOn) setWeatherOn(true)
    var w = Model.weatherFromCode(code, null, 14, 250)
    var warmth = Model.previewTemperature(name), blowing = Model.previewWind(name)
    manual = {
      cover: w.cover, precip: w.precip, fog: w.fog, thunder: w.thunder > 0.5, hail: w.hail > 0.5,
      wind: blowing !== null ? blowing : 14,
      temperature: warmth !== null ? warmth : (w.snow > w.rain ? -4 : 18), hour: manual.hour, phase: manual.phase
    }
    pinnedClock = -1
    timelapse = false
    mode = "manual"
  }

  // ----------------------------------------------------------------- clock
  //
  // The sky keeps the system's time unless a mode says otherwise.

  property double wallNow: Date.now()
  property double pinnedClock: -1
  property bool timelapse: false
  property double lapseStart: 0
  property double lapseFrom: 0
  // A day in a minute.
  readonly property double lapseRate: 1440

  readonly property double now: {
    var midnight = Model.startOfDay(wallNow)
    if (mode === "demo") return midnight + demoHour * 3600000
    if (mode === "manual" && manual.hour >= 0) return midnight + manual.hour * 3600000
    if (timelapse) return midnight + ((lapseFrom + (wallNow - lapseStart) * lapseRate) % Model.DAY)
    if (pinnedClock >= 0) return midnight + pinnedClock
    return wallNow
  }
  readonly property real hourNow: (now - Model.startOfDay(now)) / 3600000
  // Whether the hour has been set, by hand or over IPC, and is not the real one.
  readonly property bool clockPinned: (mode === "manual" && manual.hour >= 0) || (mode !== "demo" && (pinnedClock >= 0 || timelapse))

  // The hour, as the panel's ruler sets it. In manual mode it is one more
  // thing set by hand. Otherwise the sky stays live and goes to that hour
  // of today, and the weather with it: what is forecast for then.
  function setHour(hour) {
    var h = Math.max(0, Math.min(23.99, Number(hour) || 0))
    if (mode === "manual") {
      setManual("hour", h)
      return
    }
    if (!dayNight) setDayNight(true)
    timelapse = false
    pinnedClock = h * 3600000
    if (mode === "demo") mode = previewCode >= 0 ? "preview" : "live"
  }

  // Back to the real hour, leaving the rest as it is.
  function realTime() {
    if (mode === "manual" && manual.hour >= 0) {
      var next = {}
      for (var k in manual) next[k] = manual[k]
      next.hour = -1
      manual = next
    }
    pinnedClock = -1
    timelapse = false
  }
  // The moon's phase when a mode sets it, or -1 for the real one. The demo
  // gives the night a moon worth looking at.
  readonly property real phasePick: mode === "demo" ? 0.42 : (mode === "manual" ? manual.phase : -1)

  Timer {
    interval: 1000
    repeat: true
    running: root.watched && !root.timelapse
    onTriggered: root.wallNow = Date.now()
  }

  // --------------------------------------------------------------- weather

  // Omarchy's own weather location, when one is set (omarchy-weather-location).
  property var configuredLocation: ({ name: "", latitude: null, longitude: null })
  // Otherwise where geo.omarchy.org places this network.
  property var detectedLocation: ({ name: "", latitude: null, longitude: null })
  readonly property var location: configuredLocation.latitude !== null ? configuredLocation : detectedLocation
  readonly property bool hasLocation: location.latitude !== null

  property var forecast: null
  property double forecastAt: 0
  property bool forecastFailed: false

  // Live, with the hour set (on the panel's ruler, with `clock`, or by the
  // time lapse), the weather is the forecast for that hour of today rather
  // than what it is doing now: the hour's own reading, or null where the
  // forecast gives none near enough.
  readonly property var hourReading: mode === "live" && clockPinned && forecast ? Model.readingAt(forecast, now) : null
  // The reading the sky and the words are made from: that hour's, or the
  // present one.
  readonly property var reading: hourReading || forecast

  // What the sky is heading for, by mode.
  readonly property var targetWeather: mode === "manual" ? Model.manualWeather(manual)
    : mode === "demo" ? Model.weatherFromCode(Model.DEMO[demoStep].code, null, Model.DEMO[demoStep].wind || 16, 250,
                                              { temperature: Model.DEMO[demoStep].temperature, plain: true })
    : mode === "preview" ? Model.weatherFromCode(previewCode, null, previewWind !== null ? previewWind : 14, 250,
                                                 { temperature: previewTemperature, plain: true })
    : liveWeather
  // The real weather, whatever the mode: what live shows, and what each of
  // the manual sliders goes back to.
  readonly property var liveWeather: reading ? Model.weatherFromCode(reading.code, reading.cloudCover, reading.windSpeed, reading.windDirection,
                                      { temperature: reading.temperature, gusts: reading.gusts, visibility: reading.visibility,
                                        coverLow: reading.coverLow, coverMid: reading.coverMid, coverHigh: reading.coverHigh })
    // Nothing known yet: a fair sky rather than a blank one.
    : Model.weatherFromCode(1, null, 8, 250)
  // What the scene is heading for: that, or with the weather switched off
  // an empty, still sky. (The bar icon and the words in the corner go on
  // saying what it is doing out there either way.)
  readonly property var sceneTarget: weatherOn ? targetWeather : Model.calmWeather()
  // What it is showing: it turns toward the target rather than jumping.
  property var weather: sceneTarget
  property bool weatherSettled: true
  onSceneTargetChanged: weatherSettled = false

  // Celsius, or null when it is not known.
  readonly property var temperature: mode === "manual" ? manual.temperature
    : mode === "demo" ? Model.DEMO[demoStep].temperature === undefined ? null : Model.DEMO[demoStep].temperature
    : mode === "preview" ? previewTemperature
    : (reading ? reading.temperature : null)
  // How much the air shimmers, eased like the weather.
  property real heat: 0

  // The day's real sunrise and sunset, in every mode that keeps the day's
  // own clock: live, and by hand and a preview too, so that at the same hour
  // the sun and moon are where live has them. Only the demo has a made-up
  // day, half past six to half past six, which its hours are written around.
  readonly property var dayEvents: Model.dayEvents(mode, forecast)
  readonly property var sunrises: dayEvents.sunrise
  readonly property var sunsets: dayEvents.sunset
  readonly property var solar: Model.solarDay(now, sunrises, sunsets)
  readonly property bool night: !solar.isDay
  readonly property string glyph: Model.glyphFor(targetWeather, night)

  function refresh() {
    // For the sky, for the panel open on its own, or for the heads-up on the
    // bar icon. (Asked of the first two themselves, not of `watched`: this
    // is called from the handler of one of them changing, before a binding
    // on them has caught up.)
    if (!(mounted || controlsOpen || headsUp) || forecastProc.running || geoProc.running) return
    if (!hasLocation) {
      geoProc.running = true
      return
    }
    var url = Model.forecastUrl(location.latitude, location.longitude)
    if (!url) return
    // curl is held to HTTPS, a short timeout and a small answer.
    forecastProc.command = ["curl", "-fsS", "--proto", "=https", "--max-time", "6", "--max-filesize", "65536", url]
    forecastProc.running = true
  }

  FileView {
    id: locationFile
    path: Quickshell.env("HOME") + "/.local/state/omarchy/settings/weather.json"
    watchChanges: true
    printErrors: false
    onFileChanged: reload()
    onLoaded: root.configuredLocation = Model.parseLocation(text())
    onLoadFailed: root.configuredLocation = Model.parseLocation("")
  }

  onLocationChanged: {
    // A new place: the old reading is for somewhere else.
    forecastAt = 0
    if (watched && mode !== "demo") Qt.callLater(refresh)
  }

  // --------------------------------------------------------------- the city
  //
  // The place the weather is for is Omarchy's own setting, shared with its
  // weather widget (omarchy-weather-location): a name and its coordinates,
  // or nothing, which means wherever this network is. The panel sets it the
  // way that widget does: a name is typed, the places it could be are looked
  // up, and one is picked. What is typed goes to Open-Meteo's place search,
  // and nowhere else.

  // No place is set: it goes by the network.
  readonly property bool cityAuto: configuredLocation.latitude === null
  property bool cityEditing: false
  property bool citySaving: false
  // What is in the field, and what the places below it were looked up for.
  property string cityQuery: ""
  property string cityAsked: ""
  property var citySuggestions: []
  property int cityIndex: 0
  // Enter was pressed before the places had come back: take the first.
  property bool cityCommit: false
  // The search found no such place.
  property bool cityMissing: false
  // The surface takes the keyboard while a name is typed. It asks for all
  // of it for a moment, which is what makes the compositor hand it over,
  // then only while it is the one being worked in.
  property bool cityPrimed: false

  function editCity() {
    cityQuery = ""
    cityAsked = ""
    citySuggestions = []
    cityIndex = 0
    cityCommit = false
    cityMissing = false
    citySaving = false
    cityPrimed = false
    cityEditing = true
    cityPrime.restart()
  }

  function cancelCity() {
    cityEditing = false
    citySaving = false
    cityCommit = false
    cityMissing = false
    citySuggestions = []
    cityPrimed = false
    cityPrime.stop()
    citySearch.stop()
  }

  function typeCity(text) {
    cityQuery = String(text || "")
    cityMissing = false
    cityCommit = false
    if (cityQuery.trim().length < 2) {
      citySearch.stop()
      citySuggestions = []
      return
    }
    citySearch.restart()
  }

  function moveCity(step) {
    cityIndex = Math.max(0, Math.min(citySuggestions.length - 1, cityIndex + step))
  }

  function lookUpCity() {
    var url = Model.geocodeUrl(cityQuery)
    if (!url || cityLookup.running) return
    cityAsked = cityQuery
    // curl is held to HTTPS, a short timeout and a small answer.
    cityLookup.command = ["curl", "-fsS", "--proto", "=https", "--max-time", "5", "--max-filesize", "65536", url]
    cityLookup.running = true
  }

  // Enter: the place picked from the list, or the first the name finds. An
  // empty name goes back to wherever the network is.
  function commitCity() {
    if (citySaving) return
    if (cityQuery.trim() === "") {
      clearCity()
      return
    }
    if (citySuggestions.length > 0 && cityAsked === cityQuery) {
      pickCity(citySuggestions[Math.max(0, Math.min(citySuggestions.length - 1, cityIndex))])
      return
    }
    cityCommit = true
    citySearch.stop()
    lookUpCity()
  }

  function pickCity(place) {
    if (!place || citySaving) return
    citySaving = true
    saveCity("set", place.name, place.latitude + "," + place.longitude,
             JSON.stringify({ name: place.name, latitude: place.latitude, longitude: place.longitude }))
  }

  function clearCity() {
    if (citySaving) return
    citySaving = true
    saveCity("clear", "", "", "")
  }

  // Through Omarchy's own command where there is one, which owns the file;
  // otherwise the file is written here, in the same shape.
  function saveCity(what, name, coordinates, json) {
    citySave.command = ["sh", "-c",
      'if command -v omarchy-weather-location >/dev/null 2>&1; then '
      + 'if [ "$1" = set ]; then exec omarchy-weather-location --set "$3" "$4"; else exec omarchy-weather-location --clear; fi; '
      + 'elif [ "$1" = set ]; then mkdir -p "$(dirname "$2")" && printf "%s\\n" "$5" > "$2"; '
      + 'else rm -f "$2"; fi',
      "omasky", what, Quickshell.env("HOME") + "/.local/state/omarchy/settings/weather.json", name, coordinates, json]
    citySave.running = true
  }

  Timer {
    id: cityPrime
    interval: 75
    onTriggered: if (root.cityEditing) root.cityPrimed = true
  }

  // Looked up once the typing pauses, not on every letter.
  Timer {
    id: citySearch
    interval: 300
    onTriggered: root.lookUpCity()
  }

  Process {
    id: cityLookup
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: {
        var found = Model.parseGeocoding(text)
        // The name moved on while this was out: ask again for what it is now.
        if (root.cityAsked !== root.cityQuery) {
          if (root.cityEditing || root.cityCommit) Qt.callLater(root.lookUpCity)
          return
        }
        root.citySuggestions = found
        root.cityIndex = 0
        if (!root.cityCommit) return
        root.cityCommit = false
        if (found.length > 0) root.pickCity(found[0])
        else root.cityMissing = true
      }
    }
  }

  Process {
    id: citySave
    onExited: function(exitCode) {
      root.citySaving = false
      if (exitCode !== 0) return
      locationFile.reload()
      root.cancelCity()
    }
  }

  // Closing the panel, or the sky, closes the field with it.
  onControlsOpenChanged: {
    if (controlsOpen) wakePanel()
    else if (cityEditing) cancelCity()
  }
  onActiveChanged: if (!active && cityEditing) cancelCity()

  Process {
    id: geoProc
    command: ["curl", "-fsS", "--proto", "=https", "--max-time", "4", "--max-filesize", "4096", "https://geo.omarchy.org/"]
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: {
        var found = Model.parseLocation(text)
        if (found.latitude !== null) {
          var same = found.latitude === root.detectedLocation.latitude && found.longitude === root.detectedLocation.longitude
          root.detectedLocation = found
          // A changed place refreshes through onLocationChanged.
          if (same) Qt.callLater(root.refresh)
        } else {
          root.forecastFailed = true
        }
      }
    }
  }

  Process {
    id: forecastProc
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: {
        var parsed = Model.parseForecast(text)
        if (parsed) {
          root.forecast = parsed
          root.forecastAt = Date.now()
          root.forecastFailed = false
        } else {
          root.forecastFailed = true
        }
      }
    }
  }

  Timer {
    interval: root.refreshMinutes * 60000
    repeat: true
    // By hand and in a preview too: the sunrise and sunset come with it.
    running: root.watched && root.mode !== "demo"
    onTriggered: root.refresh()
  }

  // ------------------------------------------------------------ heads-up
  //
  // With the sky down the bar icon is all there is of the weather, so it
  // gives warning: when rain or snow is due to start within the hour it
  // turns into an umbrella or a snowflake and says how long there is. For
  // that the weather has to be read while nothing is showing, which it
  // otherwise is not: every twenty minutes at the most often, and once
  // shortly after the shell starts. Switched off (the headsUp setting), the
  // plugin goes back to asking for nothing while nothing is on screen.
  readonly property bool headsUp: setting("headsUp", true) !== false
  // {minutes, snow} or null; only from a reading fresh enough to go by.
  readonly property var soon: headsUp && forecast && wallNow - forecastAt < 45 * Model.MINUTE ? Model.fallSoon(forecast, wallNow) : null
  readonly property string soonText: !soon ? ""
    : soon.minutes > 0 ? strings.t(soon.snow ? "widget.snowSoon" : "widget.rainSoon").arg(Commons.I18n.formatNumber(soon.minutes))
    : strings.t(soon.snow ? "widget.snowNow" : "widget.rainNow")
  // What the bar icon shows: the weather, or that warning.
  readonly property string barGlyph: soon ? (soon.snow ? "\ue36f" : "\ue220") : glyph

  Timer {
    interval: Math.max(root.refreshMinutes, 20) * 60000
    repeat: true
    running: root.headsUp && !root.watched
    onTriggered: root.refresh()
  }
  Timer {
    interval: 15000
    running: root.headsUp
    onTriggered: if (!root.watched && root.forecastAt === 0) root.refresh()
  }
  // The minute, so that the warning counts down and the icon turns from day
  // to night; with the sky or the panel up the clock runs by itself.
  Timer {
    interval: 60000
    repeat: true
    running: root.headsUp && !root.watched
    onTriggered: root.wallNow = Date.now()
  }

  // One early second try, for a network that was not up yet.
  Timer {
    interval: 20000
    running: root.watched && root.mode !== "demo" && root.forecast === null
    onTriggered: root.refresh()
  }

  // ----------------------------------------------------------------- theme

  property var themeColors: ({})
  readonly property var palette: Model.derivePalette(themeColors, {
    foreground: String(Commons.Color.foreground),
    background: String(Commons.Color.background),
    accent: String(Commons.Color.accent),
    urgent: String(Commons.Color.urgent),
    muted: String(Commons.Color.muted)
  })

  FileView {
    id: colorsFile
    path: Quickshell.env("HOME") + "/.local/state/omarchy/current/theme/colors.toml"
    watchChanges: true
    printErrors: false
    onFileChanged: reload()
    onLoaded: root.themeColors = Model.parseThemeColors(text())
    onLoadFailed: root.themeColors = ({})
  }

  // A theme switch swaps the directory under that path, which the watch can
  // miss; the shell's own colors changing is the sure sign of one.
  Connections {
    target: Commons.Color
    function onBackgroundChanged() { themeSettle.restart() }
    function onForegroundChanged() { themeSettle.restart() }
    function onAccentChanged() { themeSettle.restart() }
  }

  Timer {
    id: themeSettle
    interval: 350
    onTriggered: {
      colorsFile.reload()
      wallpaperProbe.running = true
    }
  }

  // ------------------------------------------------------------- animation

  property real time: 0
  property real frameDebt: 0
  property real slowDebt: 0
  // How far each cloud lane has blown downwind, in pixels.
  property var laneDrift: [0, 0, 0]
  // Pixels of snow lying on a window that has not been disturbed.
  property real snowDepth: 0
  // The weather has moved on by this many seconds.
  signal stepped(real elapsed)
  property real flash: 0
  property real boltAt: 0.4
  property real boltSeed: 1
  property real strikeAge: -1
  property real nextStrike: 3
  property bool strikeNow: false

  function strike() {
    if (!weatherOn) setWeatherOn(true)
    strikeNow = true
  }
  // Lightning has just struck: what the thunder waits for.
  signal struck()

  // ---------------------------------------------------------------- sound
  //
  // Rain, wind and thunder, as loud as there is of each, while the sky is
  // up. Off unless asked for. The part that makes it (Sound.qml) is loaded
  // only then, and apart, because it needs Qt's multimedia module, which
  // the shell itself does not: where that is missing the sound is, and the
  // panel says so.
  readonly property bool soundOn: setting("sound", false) === true
  readonly property real soundVolume: Model.clamp(Number(setting("soundVolume", 0.5)) || 0, 0, 1)
  property bool soundMissing: false
  function setSoundOn(on) { saveSetting("sound", on === true) }

  Loader {
    id: soundLoader
    active: root.soundOn && root.mounted && !root.soundMissing
    source: Qt.resolvedUrl("Sound.qml")
    onLoaded: item.service = root
    onStatusChanged: if (status === Loader.Error) root.soundMissing = true
  }
  // The files are there but will not play: no sound here either.
  Connections {
    target: soundLoader.item
    function onBrokenChanged() { if (soundLoader.item.broken) root.soundMissing = true }
  }

  FrameAnimation {
    running: root.watched
    onTriggered: root.advance(frameTime)
  }

  function advance(frameSeconds) {
    hitchAge += frameSeconds
    if (hitchAge > 4) {
      hitchAge = 0
      hitch = 0
    }
    if (presence >= 1 && frameSeconds * 1000 > hitch) hitch = Math.round(frameSeconds * 1000)
    var lead = active && staged ? 0.3 : 0
    if (Math.abs(lead - skyLead) > 0.002) skyLead += (lead - skyLead) * (1 - Math.exp(-frameSeconds / 0.12))
    else skyLead = lead

    // The glide moves on every frame; the weather keeps its own rate.
    if (gliding) {
      stepGlide(frameSeconds)
    } else if (primed) {
      // Wait out the long frames the jump costs: go once the surface has
      // drawn again and two frames running have come on time.
      primeTicks += 1
      primeCalm = frameSeconds < 0.03 ? primeCalm + 1 : 0
      if ((primeFrames >= 2 && primeCalm >= 2) || primeTicks >= 45) {
        primed = false
        if (primeTo > 0.5) entry = { staged: entry.staged, firstFrame: entry.firstFrame, glide: Math.round(Date.now() - shownAt) }
        glide(primeTo, primeTo > 0.5 ? 700 : 520)
      }
    } else if (staged && active && cover && warmFrames >= 0 && presence <= 0) {
      // The cover has to be on screen before the real windows jump.
      warmFrames += 1
      if (sceneFrames >= 3 || warmFrames >= 240) {
        warmFrames = -1
        prime(1)
      }
    } else if (leaving) {
      leaveTicks += 1
      if (leaveFrames >= 2 || leaveTicks >= 60) {
        leaving = false
        prime(0)
      }
    }

    frameDebt += Math.min(frameSeconds, 0.1)
    // A rate of 0 steps the weather on every frame.
    if (quality.frameRate > 0 && frameDebt < 0.95 / quality.frameRate) return
    var elapsed = frameDebt
    frameDebt = 0
    time += elapsed

    // The wind carries each lane its own share of the way.
    var speed = weather.windPx
    laneDrift = [
      laneDrift[0] + speed * Model.LANE_SPEED[0] * elapsed,
      laneDrift[1] + speed * Model.LANE_SPEED[1] * elapsed,
      laneDrift[2] + speed * Model.LANE_SPEED[2] * elapsed
    ]

    // What changes slowly is stepped twenty times a second.
    slowDebt += elapsed
    if (slowDebt >= 0.05) {
      var slow = slowDebt
      slowDebt = 0
      if (timelapse) wallNow = Date.now()
      if (mode === "demo") {
        demoElapsed += slow
        var at = Model.demoState(demoElapsed)
        demoStep = at.step
        demoHour = at.hour
      }
      if (!weatherSettled) {
        var turned = Model.mixWeather(weather, sceneTarget, 1 - Math.exp(-slow / 0.9))
        weather = turned
        weatherSettled = turned.settled === true || turned === sceneTarget
      }
      var wanted = quality.shimmer && weatherOn ? Model.heatFor(temperature, solar.isDay ? 1 : 0, weather) : 0
      if (Math.abs(wanted - heat) > 0.002) heat += (wanted - heat) * (1 - Math.exp(-slow / 1.2))
      else heat = wanted
    }

    // Snow builds slowly, faster the harder it falls, and melts when it
    // stops. This is what lies where nothing disturbs it; each screen keeps
    // its windows' own, which answer to their being moved (see the surfaces).
    // And it goes by the temperature: warmth takes it, cold keeps it.
    // With the weather switched off and faded from view, none is left lying.
    if (!weatherOn && weatherShare <= 0.001) snowDepth = 0
    else if (presence > 0.9) snowDepth = Model.lyingStep(snowDepth, weather, elapsed)
    stepped(elapsed)

    if ((weather.thunder > 0.3 || strikeNow || strikeAge >= 0) && presence > 0.9) {
      if (strikeAge >= 0) {
        strikeAge += elapsed
        flash = Model.flashAt(strikeAge)
        if (strikeAge > 0.55) {
          strikeAge = -1
          flash = 0
          nextStrike = time + 3.5 + Math.random() * 9
        }
      } else if (strikeNow || time >= nextStrike) {
        strikeNow = false
        strikeAge = 0
        struck()
        boltAt = 0.10 + Math.random() * 0.80
        boltSeed = 1 + Math.random() * 90
        flash = Model.flashAt(0)
      }
    } else if (flash !== 0) {
      flash = 0
    }
  }

  // ----------------------------------------------------------------- words

  Commons.Translations { id: strings; directory: Qt.resolvedUrl("i18n") }

  readonly property bool fahrenheit: Model.usesFahrenheit(unit, Commons.I18n.formatLocale)
  readonly property string temperatureText: {
    if (temperature === null || temperature === undefined) return ""
    var value = fahrenheit ? Model.celsiusToFahrenheit(temperature) : temperature
    return Commons.I18n.formatNumber(Math.round(value)) + "°"
  }
  readonly property string conditionText: strings.t("condition." + targetWeather.key)

  // The detail under the words in the corner: the real weather as last read,
  // in the units the temperature is shown in.
  function degreesText(celsius) {
    if (celsius === null || celsius === undefined) return ""
    return Commons.I18n.formatNumber(Math.round(fahrenheit ? Model.celsiusToFahrenheit(celsius) : celsius)) + "°"
  }
  readonly property string feelsText: reading ? degreesText(reading.feels) : ""
  readonly property string windText: {
    if (!reading || reading.windSpeed === null || reading.windSpeed === undefined) return ""
    return fahrenheit ? Commons.I18n.formatNumber(Math.round(reading.windSpeed * 0.621371)) + " mph"
                      : Commons.I18n.formatNumber(Math.round(reading.windSpeed)) + " km/h"
  }
  readonly property string humidityText: reading && reading.humidity !== null && reading.humidity !== undefined
    ? Commons.I18n.formatNumber(Math.round(reading.humidity)) + "%" : ""
  // Said beside the weather when it is an hour's forecast, or an hour gone
  // by, so that it is not taken for now.
  readonly property bool forecastAhead: hourReading !== null && hourReading.at > wallNow
  readonly property string forecastNote: hourReading
    ? strings.t(forecastAhead ? "info.forecast" : "info.earlier").arg(clockText(hourReading.at)) : ""
  // Which day it is where the place is. It only changes at that place's
  // midnight, so what hangs off it is not worked out again every second.
  readonly property int placeDay: Model.placeDay(forecast, wallNow)
  // Today's high and low there, and the days after: {today, next}.
  readonly property var outlook: Model.forecastFrom(forecast, placeDay, 4)
  readonly property string summary: {
    var parts = []
    if (temperatureText) parts.push(temperatureText)
    parts.push(conditionText)
    if (mode === "live" && location.name) parts.push(location.name)
    return parts.join(" · ")
  }

  function clockText(ms) {
    return new Date(ms).toLocaleTimeString(Qt.locale(Commons.I18n.formatLocale), Locale.ShortFormat)
  }

  // ------------------------------------------------------------------- IPC

  // What a switch should be after "on", "off" or anything else (toggle).
  function switched(state, now) {
    var word = String(state || "").trim().toLowerCase()
    if (word === "on" || word === "true" || word === "1" || word === "yes") return true
    if (word === "off" || word === "false" || word === "0" || word === "no") return false
    return !now
  }

  ShellIpc {
    target: "omasky"

    function toggle(): string {
      root.toggle()
      return root.active ? "on" : "off"
    }

    function show(): string {
      root.show()
      return "on"
    }

    function hide(): string {
      root.hide()
      return "off"
    }

    function refresh(): void {
      root.forecastAt = 0
      root.refresh()
    }

    // The control panel: quality, the demo, debug.
    function controls(): string {
      root.toggleControls(root.iconX())
      return root.controlsOpen ? "open" : "closed"
    }

    // The panel in manual mode, with its controls open.
    function debug(): string {
      root.holdManual()
      root.debugOpen = true
      if (!root.controlsOpen) root.controlsX = root.iconX()
      root.controlsOpen = true
      root.show()
      return "open"
    }

    // auto, low, medium, high or ultra.
    function quality(name: string): string {
      root.setQuality(name)
      return root.quality.name
    }

    // The weather on its own: on, off or toggle. Clouds, what falls, fog,
    // wind and heat; the hour is left as it is.
    function weather(state: string): string {
      root.setWeatherOn(root.switched(state, root.weatherOn))
      return root.weatherOn ? "on" : "off"
    }

    // The sky's sound, rain, wind and thunder: on, off or toggle.
    function sound(state: string): string {
      root.setSoundOn(root.switched(state, root.soundOn))
      return root.soundOn ? (root.soundMissing ? "on, but this machine has no Qt multimedia module to play it" : "on") : "off"
    }

    // The hour on its own: on, off or toggle. Sun, moon, stars and the
    // sky's color by the time of day; the weather is left as it is.
    function daynight(state: string): string {
      root.setDayNight(root.switched(state, root.dayNight))
      return root.dayNight ? "on" : "off"
    }

    // The words in the corner of the sky: off, simple (the temperature and
    // what it is doing) or detailed (with how it feels, the wind, the
    // humidity and the days ahead). on brings back whichever it was;
    // anything else steps through the three.
    function info(state: string): string {
      var word = String(state || "").trim().toLowerCase()
      if (word === "simple" || word === "basic") root.setInfoLevel(1)
      else if (word === "detailed" || word === "detail" || word === "full") root.setInfoLevel(2)
      else if (word === "on" || word === "true" || word === "1" || word === "yes") root.setShowInfo(true)
      else if (word === "off" || word === "false" || word === "0" || word === "no") root.setInfoLevel(0)
      else root.setInfoLevel((root.infoLevel + 1) % 3)
      return ["off", "simple", "detailed"][root.infoLevel]
    }

    // The place the weather is for, by name: the first place the name finds
    // is taken. "auto" goes back to wherever this network is. It is Omarchy's
    // own setting, the one its weather widget uses.
    function city(name: string): string {
      var wanted = String(name || "").trim()
      if (wanted === "" || wanted.toLowerCase() === "auto") {
        root.clearCity()
        return "auto"
      }
      root.cityQuery = wanted
      root.cityMissing = false
      root.cityCommit = true
      root.lookUpCity()
      return "looking up " + wanted
    }

    // One of the by-hand controls, as the panel's sliders have them: clouds,
    // precip and fog from 0 to 1; temperature in degrees Celsius; wind in
    // km/h (negative blows left); hour from 0 to 24 and moon from 0 to 1
    // (-1 for the real one); thunder, hail, aurora and fireflies on or off. Like the sliders,
    // it takes the sky into hand, and shows it.
    function set(name: string, value: string): string {
      var keys = {
        clouds: "cover", cover: "cover", precip: "precip", precipitation: "precip", fog: "fog",
        temperature: "temperature", temp: "temperature", wind: "wind", hour: "hour", time: "hour",
        moon: "phase", phase: "phase", thunder: "thunder", hail: "hail",
        aurora: "aurora", lights: "aurora", fireflies: "fireflies"
      }
      var key = keys[String(name || "").trim().toLowerCase()]
      if (!key) return "unknown control: " + name
      var to
      if (key === "thunder" || key === "hail" || key === "aurora" || key === "fireflies") {
        to = root.switched(value, root.sliders[key] === true)
      } else {
        to = Number(value)
        if (String(value).trim() === "" || !isFinite(to)) return "not a number: " + value
        if (key === "cover" || key === "precip" || key === "fog") to = Model.clamp(to, 0, 1)
        else if (key === "temperature") to = Model.clamp(to, -40, 50)
        else if (key === "wind") to = Model.clamp(to, -150, 150)
        else if (key === "hour") to = to < 0 ? -1 : Math.min(to, 23.99)
        else to = to < 0 ? -1 : Math.min(to, 0.999)
      }
      root.setManual(key, to)
      root.show()
      return key + " " + to
    }

    // Lightning, now.
    function strike(): string {
      root.strike()
      return "struck"
    }

    // A day and a night with weather to suit; again to stop.
    function demo(): string {
      root.setDemo(root.mode !== "demo")
      return root.mode === "demo" ? "on" : "off"
    }

    // Force a condition and show it: clear, partly, cloudy, fog, drizzle,
    // rain, heavyrain, monsoon, showers, sleet, ice, snow, heavysnow,
    // blizzard, thaw, storm, hail, heat, or a WMO code.
    function preview(name: string): string {
      var code = Model.previewCode(name)
      if (code < 0) return "unknown condition: " + name
      root.previewTemperature = Model.previewTemperature(name)
      root.previewWind = Model.previewWind(name)
      root.previewCode = code
      root.mode = "preview"
      root.show()
      return root.targetWeather.key
    }

    // Pin the sky to an hour ("21:30", "9pm"), or "now" to let it run.
    function clock(when: string): string {
      if (String(when).toLowerCase() === "now") {
        root.pinnedClock = -1
        root.timelapse = false
        return "now"
      }
      var at = Model.parseClock(when)
      if (at < 0) return "unknown time: " + when
      root.timelapse = false
      root.pinnedClock = at
      if (root.mode === "demo" || root.mode === "manual") root.mode = root.previewCode >= 0 ? "preview" : "live"
      root.show()
      return root.clockText(root.now)
    }

    // Run a whole day through the sky in a minute; again to stop.
    function timelapse(): string {
      if (root.timelapse) {
        root.timelapse = false
        return "off"
      }
      if (root.mode === "demo" || root.mode === "manual") root.mode = root.previewCode >= 0 ? "preview" : "live"
      var from = root.now
      root.wallNow = Date.now()
      root.lapseFrom = from - Model.startOfDay(from)
      root.lapseStart = root.wallNow
      root.pinnedClock = -1
      root.timelapse = true
      root.show()
      return "on"
    }

    // Back to the real weather at the real time.
    function live(): string {
      root.goLive()
      return root.targetWeather.key
    }

    function status(): string {
      return JSON.stringify({
        active: root.active,
        mode: root.mode,
        quality: root.quality.name,
        qualityAuto: root.qualityAuto,
        // The level chosen, and whether it is being held a level lower to save power.
        qualityChoice: root.qualityChoice,
        savingPower: root.savingPower,
        weather: root.weatherOn,
        dayNight: root.dayNight,
        info: ["off", "simple", "detailed"][root.infoLevel],
        city: root.cityAuto ? "auto" : root.location.name,
        cityMissing: root.cityMissing,
        fps: Math.round(root.frameRate),
        screenHz: Math.round(root.refreshHz),
        glide: root.lastGlide,
        entry: root.entry,
        hitch: root.hitch,
        condition: root.targetWeather.key,
        clock: root.mode === "demo" ? "demo" : root.timelapse ? "timelapse" : (root.pinnedClock >= 0 || (root.mode === "manual" && root.manual.hour >= 0) ? "pinned" : "live"),
        // The hour whose forecast is on show, when the hour is set in live mode.
        forecastFor: root.hourReading ? new Date(root.hourReading.at).toISOString() : null,
        // The warning on the bar icon: what is about to start falling, or null.
        soon: root.soon,
        // Whether sound is asked for, and whether this machine can play it.
        sound: root.soundOn,
        soundMissing: root.soundMissing,
        night: root.night,
        // Sunrise and sunset as the sky has them today, in hours.
        daylight: (function() {
          var marks = Model.dayMarks(root.now, root.sunrises, root.sunsets)
          return [Math.round(marks.rise * 100) / 100, Math.round(marks.set * 100) / 100]
        })(),
        temperature: root.temperature,
        windows: root.seenWindows,
        lingering: root.lingering,
        windPx: root.targetWeather.windPx,
        location: root.location.name,
        updated: root.forecastAt > 0 ? new Date(root.forecastAt).toISOString() : null
      })
    }
  }

  // ------------------------------------------------------------- surfaces
  //
  // Each screen keeps two surfaces for as long as the plugin runs: one under
  // the windows for the sky, one over them for the weather that meets them.
  // The one in front takes the pointer only on its control panel, and the
  // keyboard only while a city is being typed into that panel; otherwise
  // neither takes either, so the windows between them are worked exactly as
  // they always are. While the sky is up there are four more, a pixel wide,
  // one along each edge of the screen: the frame. Each keeps its margin of
  // the screen to itself the way a bar does, which is what makes Hyprland
  // lay the windows out smaller. They sit on the topmost layer because
  // layers are given their room from the bottom up: the bar, lower down,
  // has its place before these are counted, and stays in it.
  //
  // Idle, each is a single transparent pixel in a corner that is never
  // redrawn. Its only work is done once, when the shell starts: it draws its
  // weather passes into that pixel so their shaders are compiled and stay
  // compiled. Showing the sky then only has to make the surfaces big, which
  // is why it starts at once instead of after a compile.

  Variants {
    model: Quickshell.screens

    Scope {
      id: view
      required property var modelData
      readonly property var screen: modelData
      readonly property var monitor: Hyprland.monitorFor(screen)
      readonly property int workspaceId: monitor && monitor.activeWorkspace ? monitor.activeWorkspace.id : -1
      readonly property bool focusedMonitor: Hyprland.focusedMonitor === monitor
      // The panel on its own, on this screen: open while the sky is down.
      readonly property bool panelAlone: root.controlsOpen && !root.mounted && focusedMonitor
      // The surface in front is up: for the sky, or for the panel alone.
      readonly property bool frontUp: root.mounted || panelAlone
      readonly property real hz: monitor && monitor.lastIpcObject && monitor.lastIpcObject.refreshRate ? Number(monitor.lastIpcObject.refreshRate) : 0
      onHzChanged: if (hz > 0 && (focusedMonitor || root.refreshHz <= 0)) root.refreshHz = hz

      // What the bar keeps of the screen: the scene is drawn inside the rest.
      // The surfaces themselves span the whole screen, because anything
      // laid out "inside what is reserved" would be squeezed into the frame
      // by the frame's own strips. Hyprland's reading of the reserve counts
      // those strips too, so it is only taken while they are down.
      property var inset: ({ left: 0, top: 0, right: 0, bottom: 0 })
      readonly property var reservedNow: monitor && monitor.lastIpcObject ? monitor.lastIpcObject.reserved : null
      onReservedNowChanged: noteInset()
      function noteInset() {
        if (root.reserve || Date.now() - root.reserveChangedAt < 400) return
        var r = reservedNow
        if (!Model.isList(r) || r.length !== 4) return
        var next = { left: Number(r[0]) || 0, top: Number(r[1]) || 0, right: Number(r[2]) || 0, bottom: Number(r[3]) || 0 }
        // A bar does not take half the screen; a reading that says so is
        // from a moment when something else was up.
        if (next.left + next.right > screen.width * 0.4 || next.top + next.bottom > screen.height * 0.4) return
        if (next.left === inset.left && next.top === inset.top && next.right === inset.right && next.bottom === inset.bottom) return
        inset = next
      }
      readonly property point origin: Qt.point(inset.left, inset.top)
      // The room under the bar, which is what the scene fills.
      readonly property real areaWidth: Math.max(1, screen.width - inset.left - inset.right)
      readonly property real areaHeight: Math.max(1, screen.height - inset.top - inset.bottom)

      // The workspace's windows in the surfaces' coordinates, where Hyprland
      // has them. `windows` is replaced when one comes, goes, moves or
      // changes size; `windowIds`, which the stills are made from, only when
      // one comes or goes.
      readonly property var liveWindows: {
        if (!root.mounted) return []
        var all = Hyprland.toplevels.values
        var toplevels = [], clients = [], gone = []
        for (var i = 0; i < all.length; i++) {
          // A window that has closed can linger in this list with the last
          // thing Hyprland said about it, and asking again does not clear
          // it. What it no longer has is a surface: only windows that still
          // have one are there to be rained on.
          if (all[i].wayland) {
            toplevels.push(all[i])
            clients.push(all[i].lastIpcObject)
          } else {
            gone.push(all[i].lastIpcObject)
          }
        }
        var found = Model.deskWindows(clients, workspaceId, screen.x + origin.x, screen.y + origin.y, root.titleBars)
        for (var j = 0; j < found.length; j++) {
          found[j].toplevel = toplevels[found[j].index]
          found[j].address = String(clients[found[j].index].address || j)
          found[j].name = String(clients[found[j].index]["class"] || "")
        }
        // For `status`: what was left out, had it been believed.
        if (focusedMonitor) root.lingering = Model.deskWindows(gone, workspaceId, screen.x + origin.x, screen.y + origin.y, null).length
        return found
      }
      property var windows: []
      property var windowIds: []
      property string windowsKey: "-"
      property string floatsKey: "-"
      function syncWindows() {
        var parts = [], ids = []
        for (var i = 0; i < liveWindows.length; i++) {
          var w = liveWindows[i]
          parts.push([w.address, w.x, w.y, w.width, w.height, w.fullscreen, w.floating, w.bar].join(","))
          ids.push(w.address)
        }
        var key = parts.join(";")
        if (key === windowsKey) return
        windowsKey = key
        windows = liveWindows
        if (focusedMonitor) root.seenWindows = windows.map(function(w) {
          return [w.name, Math.round(w.x), Math.round(w.y), Math.round(w.width), Math.round(w.height), w.floating ? "floating" : "tiled"]
        })
        root.geometryQuiet = 0
        if (ids.join(";") !== windowIds.join(";")) windowIds = ids
        // A window has come, gone or changed between tiled and floating:
        // the title bars may have changed with it.
        var floats = liveWindows.map(function(w) { return w.address + (w.floating ? "f" : "t") }).join(";")
        if (floats !== floatsKey) {
          floatsKey = floats
          root.probeBars()
        }
        noteRects()
      }
      onLiveWindowsChanged: syncWindows()

      readonly property bool fullscreen: {
        for (var i = 0; i < windows.length; i++) if (windows[i].fullscreen) return true
        return false
      }

      // Where each window lies with its room given back (rest) and with it
      // taken (back), by address, as last seen each way. A glide draws each
      // still between the two.
      property var restRects: ({})
      property var backRects: ({})
      property int rectsRev: 0
      function noteRects() {
        // Straight after the room changes hands, what is read is still the
        // layout from before.
        if (Date.now() - root.reserveChangedAt < 90) return
        var seen = {}, other = {}
        var was = root.reserve ? restRects : backRects
        for (var i = 0; i < windows.length; i++) {
          var w = windows[i]
          seen[w.address] = { x: w.x, y: w.y, width: w.width, height: w.height }
          if (was[w.address]) other[w.address] = was[w.address]
        }
        if (root.reserve) {
          backRects = seen
          restRects = other
        } else {
          restRects = seen
          backRects = other
        }
        rectsRev += 1
      }

      // The windows as they are drawn: where they are, or during a glide
      // where their stills are.
      readonly property var shown: {
        rectsRev
        return Model.shownWindows(windows, restRects, backRects, root.cover ? root.presence : -1)
      }

      // The frame the windows are kept to, and what the sky needs to know
      // about it.
      readonly property var placement: Model.deskPlacement(areaWidth, areaHeight, root.shrink)
      readonly property var margins: Model.frameMargins(areaWidth, areaHeight, root.shrink)
      readonly property var geometry: ({ width: areaWidth, height: areaHeight, margin: placement.x, deck: placement.y, desk: null })
      readonly property var sky: Model.celestial(root.now, root.sunrises, root.sunsets, geometry, root.location.latitude, root.phasePick)
      // What is drawn has the hour in it only as far as the hour is switched on.
      readonly property var look: Model.sceneUniforms(root.palette, Model.steadySky(sky, 1 - root.cycleShare), root.weather, geometry)
      readonly property real heat: root.heat * root.weatherAmount
      // Omarchy's own word for how this workspace lays its windows out:
      // dwindle, scrolling or floating. Hyprland does not say (floating is
      // not one of its layouts), so Omarchy's command is asked, where there
      // is one.
      property string layoutMode: ""
      property int layoutAskedFor: -1
      Process {
        id: layoutProbe
        command: ["sh", "-c", 'command -v omarchy-hyprland-workspace-layout-current >/dev/null 2>&1 && omarchy-hyprland-workspace-layout-current "$1"',
                  "omasky", String(view.layoutAskedFor)]
        stdout: StdioCollector {
          onStreamFinished: {
            var mode = String(text || "").trim()
            if (view.layoutAskedFor === view.workspaceId && /^[a-z]{1,20}$/.test(mode)) view.layoutMode = mode
            // The workspace changed while it was being asked about.
            if (view.layoutAskedFor !== view.workspaceId) view.probeLayout()
          }
        }
      }
      function probeLayout() {
        if (workspaceId < 1 || layoutProbe.running) return
        layoutAskedFor = workspaceId
        layoutProbe.running = true
      }
      onWorkspaceIdChanged: probeLayout()
      Component.onCompleted: probeLayout()

      // Whether this screen's frame is up. Not on a floating workspace:
      // there is no tiling there for a frame to make smaller, and there is
      // a dock along the bottom of the screen, which a frame would push up
      // and in along with everything else. The windows float where they
      // are and the weather finds them there.
      readonly property bool framed: root.reserve && root.mounted && layoutMode !== "floating"
      // The patch of sky behind the words in the corner. Generous: its
      // falloff needs room to be gradual.
      // (Twice as far as the words reach where they are spread out along
      // the top, so the far end of them still has it behind them.)
      readonly property real plateWidth: root.infoShare > 0.002
        ? Math.round(Math.max(info.x + info.width + Style.space(420), (info.x + info.width) * 2)) : 0
      readonly property real plateHeight: root.infoShare > 0.002 ? Math.round(info.y + info.height + Style.space(300)) : 0
      // The same behind the days ahead in the top right corner, measured
      // from that corner. It grows out of the corner as they come in.
      readonly property real outlookReach: outlook.width + Style.space(22)
      readonly property real farWidth: outlook.visible
        ? Math.round(Math.max(outlookReach + Style.space(420), outlookReach * 2) * root.detailShare) : 0
      readonly property real farHeight: outlook.visible
        ? Math.round((outlook.y + outlook.height + Style.space(300)) * root.detailShare) : 0
      // With the detail showing there is more written in each corner, and
      // further from it. So each patch keeps its full strength under most
      // of what is written, and only falls away from there: the far end of
      // a row reads as well as the near one.
      // The words alone (no detail) get a core too: their second line, with
      // the mode, the moon and the next sunrise in it, can run long.
      readonly property real nearCoreWidth: Math.round((info.x + info.width) * (0.85 - 0.25 * root.detailShare))
      readonly property real nearCoreHeight: Math.round((info.y + info.height) * (0.85 - 0.25 * root.detailShare))
      readonly property real farCoreWidth: outlook.visible ? Math.round(outlookReach * 0.75 * root.detailShare) : 0
      readonly property real farCoreHeight: outlook.visible ? Math.round((outlook.y + outlook.height) * 0.75 * root.detailShare) : 0

      // The snow on this screen's windows, each on its own account.
      property var ledgeState: null
      property int ledgeRev: 0
      readonly property var ledges: {
        ledgeRev
        return Model.ledgeSlots(ledgeState, shown)
      }

      Connections {
        target: root
        function onGeometryTicked() { view.noteRects() }
        function onSurroundingsAsked() { view.probeLayout() }
        function onStepped(elapsed) {
          // With the weather switched off and faded out, nothing is left lying.
          if (!root.weatherOn && root.weatherShare <= 0.001) {
            if (view.ledgeState !== null) {
              view.ledgeState = null
              view.ledgeRev += 1
            }
            return
          }
          var snow = root.weather.snow
          view.ledgeState = Model.ledgeStep(view.ledgeState, view.shown, {
            dt: elapsed,
            lying: root.snowDepth,
            // What was shaken off falls again faster than the first snow did.
            rate: snow > 0.01 ? 2.5 * (0.25 + 1.6 * snow) : 0,
            scope: view.workspaceId,
            // The glide moves the stills, not the snow.
            carried: root.cover,
            // Where the clouds that it falls from have their bases: the
            // near lane's level above the frame (shaders/common.glsl). A
            // window above that is above the weather.
            cloudBase: view.placement.y * 0.64,
            // Icicles: the cold, and rain falling into it.
            temperature: root.weather.temperature,
            glaze: root.weather.temperature !== null && root.weather.temperature < 0 ? root.weather.rain : 0
          })
          view.ledgeRev += 1
        }
        function onMountedChanged() {
          if (root.mounted) return
          view.ledgeState = null
          view.ledgeRev += 1
        }
      }

      // -------------------------------------------------------- the frame

      PanelWindow {
        screen: view.screen
        visible: view.framed
        anchors { left: true; top: true; bottom: true }
        implicitWidth: 1
        color: "transparent"
        exclusiveZone: view.margins.left
        mask: Region {}
        WlrLayershell.namespace: "omasky-frame"
        WlrLayershell.layer: WlrLayer.Overlay
        WlrLayershell.keyboardFocus: WlrKeyboardFocus.None
      }

      PanelWindow {
        screen: view.screen
        visible: view.framed
        anchors { right: true; top: true; bottom: true }
        implicitWidth: 1
        color: "transparent"
        exclusiveZone: view.margins.right
        mask: Region {}
        WlrLayershell.namespace: "omasky-frame"
        WlrLayershell.layer: WlrLayer.Overlay
        WlrLayershell.keyboardFocus: WlrKeyboardFocus.None
      }

      PanelWindow {
        screen: view.screen
        visible: view.framed
        anchors { top: true; left: true; right: true }
        implicitHeight: 1
        color: "transparent"
        exclusiveZone: view.margins.top
        mask: Region {}
        WlrLayershell.namespace: "omasky-frame"
        WlrLayershell.layer: WlrLayer.Overlay
        WlrLayershell.keyboardFocus: WlrKeyboardFocus.None
      }

      PanelWindow {
        screen: view.screen
        visible: view.framed
        anchors { bottom: true; left: true; right: true }
        implicitHeight: 1
        color: "transparent"
        exclusiveZone: view.margins.bottom
        mask: Region {}
        WlrLayershell.namespace: "omasky-frame"
        WlrLayershell.layer: WlrLayer.Overlay
        WlrLayershell.keyboardFocus: WlrKeyboardFocus.None
      }

      // ------------------------------------------------ under the windows

      PanelWindow {
        id: under
        screen: view.screen
        // The whole screen while the sky is up; one pixel in the corner
        // otherwise.
        anchors { top: true; left: true; bottom: root.mounted; right: root.mounted }
        implicitWidth: 1
        implicitHeight: 1
        color: "transparent"
        exclusionMode: ExclusionMode.Ignore
        mask: Region {}
        WlrLayershell.namespace: "omasky-sky"
        // Over the wallpaper, under every window.
        WlrLayershell.layer: WlrLayer.Bottom
        WlrLayershell.keyboardFocus: WlrKeyboardFocus.None

        // Everything a hot day bends: the background, which is the wallpaper
        // and the sky over it. The windows are real, in front of this, and
        // stay straight.
        Item {
          id: heaven
          // Under the bar, not behind it.
          x: root.mounted ? view.origin.x : 0
          y: root.mounted ? view.origin.y : 0
          width: root.mounted ? view.areaWidth : 1
          height: root.mounted ? view.areaHeight : 1
          // Heat waves. They wait for the wallpaper's copy below, so the
          // background is never bent with half of it missing.
          readonly property bool bent: root.staged && view.heat > 0.01 && (root.wallpaper === "" || hotPaper.status === Image.Ready)
          layer.enabled: bent
          layer.effect: ShaderEffect {
            fragmentShader: Qt.resolvedUrl("shaders/shimmer.frag.qsb")
            property real time: root.time
            property real heat: view.heat
            property real pixel: root.quality.pixel
            property vector2d resolution: Qt.vector2d(heaven.width, heaven.height)
            property color glowColor: view.look.glowColor
          }

          // The real wallpaper is another program's and cannot be bent, and
          // on a hot, clear day the sky over it is too thin to carry the
          // heat on its own. So while it is hot, and only then, the
          // wallpaper is drawn again here at full size, exactly over the
          // real one, to be bent together with the sky.
          Image {
            id: hotPaper
            x: -view.origin.x
            y: -view.origin.y
            width: view.screen.width
            height: view.screen.height
            visible: heaven.bent
            source: root.mounted && view.heat > 0.004 && root.wallpaper ? Util.fileUrl(root.wallpaper) : ""
            sourceSize.width: Math.ceil(view.screen.width * Screen.devicePixelRatio)
            sourceSize.height: Math.ceil(view.screen.height * Screen.devicePixelRatio)
            fillMode: Image.PreserveAspectCrop
            asynchronous: true
            smooth: true
          }

          // The sky, and what falls behind the windows. It is always drawn,
          // all but invisibly: into one pixel while idle, which is what
          // compiles its shader ahead of time, and across the screen as the
          // sky arrives.
          ScenePass {
            anchors.fill: parent
            visible: root.qualityKnown
            opacity: Math.max(root.skyAmount, 0.004)
            front: 0
            look: view.look.scene
            rects: view.ledges.rects
            depths: view.ledges.depths
            shelters: view.ledges.shelters
            ghostFrom: view.ledges.ghostFrom
            ices: view.ledges.ices
            floatFrom: view.ledges.floatFrom
            clock: root.time
            laneDrift: root.laneDrift
            pixel: root.quality.pixel
            detail: root.quality.detail
            // Thin on a fair day, so the wallpaper shows; closing in with
            // the weather.
            skyAlpha: root.skyOpacity * view.look.wash
            flash: root.flash
            boltX: root.boltAt * view.areaWidth
            boltSeed: root.boltSeed
            snowDepth: view.ledges.deepest
            groundDepth: root.snowDepth * 1.6
            // Behind the words in the corner the sky is blurred and pulled
            // toward the tone that sets them off, most in the corner and
            // easing away to nothing well before the patch's bounds, so
            // they read against any weather and any wallpaper and no edge
            // shows. The words themselves are on the surface in front.
            plateWidth: view.plateWidth
            plateHeight: view.plateHeight
            plateRightWidth: view.farWidth
            plateRightHeight: view.farHeight
            plateCoreWidth: view.nearCoreWidth
            plateCoreHeight: view.nearCoreHeight
            plateRightCoreWidth: view.farCoreWidth
            plateRightCoreHeight: view.farCoreHeight
            plateBlur: root.quality.blur
            plateTint: 0.46 * root.infoShare
            scrim: view.look.scrim
          }
        }
      }

      // ------------------------------------------------- over the windows

      PanelWindow {
        id: win
        screen: view.screen
        anchors { top: true; left: true; bottom: view.frontUp; right: view.frontUp }
        implicitWidth: 1
        implicitHeight: 1
        color: "transparent"
        exclusionMode: ExclusionMode.Ignore
        // With the sky up, the pointer goes straight through to the windows,
        // except on the control panel. With only the panel up, everything
        // under the bar is this surface's, so that a click away from the
        // panel closes it; the bar itself is left to the bar.
        mask: view.panelAlone ? stageArea : (root.controlsOpen && view.focusedMonitor ? panelArea : nothing)
        WlrLayershell.namespace: "omasky"
        // A fullscreen window would cover the top layer.
        WlrLayershell.layer: view.frontUp && view.fullscreen ? WlrLayer.Overlay : WlrLayer.Top
        // The keyboard is the windows'. The one time this surface takes it
        // is while a city is being typed into the panel.
        WlrLayershell.keyboardFocus: root.cityEditing && root.controlsOpen && view.focusedMonitor
          ? (root.cityPrimed ? WlrKeyboardFocus.OnDemand : WlrKeyboardFocus.Exclusive)
          : WlrKeyboardFocus.None

        Region { id: nothing }
        Region {
          id: panelArea
          item: panel
        }
        Region {
          id: stageArea
          item: stage
        }

        Item {
          id: stage
          // Under the bar, and nothing drawn here strays over it.
          x: view.frontUp ? view.origin.x : 0
          y: view.frontUp ? view.origin.y : 0
          width: view.frontUp ? view.areaWidth : 1
          height: view.frontUp ? view.areaHeight : 1
          clip: true

          // Frames this surface has put on screen: the scene's frame rate,
          // and what a glide waits for before it moves anything.
          Connections {
            target: stage.Window.window
            ignoreUnknownSignals: true
            function onFrameSwapped() {
              if (view.focusedMonitor || Quickshell.screens.length === 1) root.swaps += 1
              if (root.leaving) root.leaveFrames += 1
              if (root.primed) root.primeFrames += 1
              if (!root.staged || root.gliding || root.presence > 0) return
              if (root.sceneFrames === 0)
                root.entry = { staged: root.entry.staged, firstFrame: Math.round(Date.now() - root.shownAt), glide: 0 }
              root.sceneFrames += 1
            }
          }

          // The cover: this surface's own picture of the desktop, up only
          // while the scene glides. The real windows have already jumped to
          // where they are going; this hides them and shows a still of each
          // crossing over instead. Idle, its sky is drawn into the one
          // pixel, which is what compiles that shader for this surface too.
          Item {
            id: coverItem
            // The whole stage while the sky is up; otherwise the one pixel,
            // and that goes for when the surface is up for the panel alone.
            width: root.mounted ? parent.width : 1
            height: root.mounted ? parent.height : 1
            visible: root.cover || !root.mounted
            layer.enabled: root.cover && view.heat > 0.01
            layer.effect: ShaderEffect {
              fragmentShader: Qt.resolvedUrl("shaders/shimmer.frag.qsb")
              property real time: root.time
              property real heat: view.heat
              property real pixel: root.quality.pixel
              property vector2d resolution: Qt.vector2d(coverItem.width, coverItem.height)
              property color glowColor: view.look.glowColor
            }

            // The wallpaper again, lined up with the real one under the bar.
            // It is kept decoded, small, for as long as the plugin runs, so
            // showing the sky never waits for it. Small is enough: it lies
            // under the sky and is only up for the glide.
            Rectangle {
              anchors.fill: parent
              visible: root.cover
              color: Commons.Color.background
            }

            Image {
              x: -view.origin.x
              y: -view.origin.y
              width: view.screen.width
              height: view.screen.height
              visible: root.cover
              source: root.wallpaper ? Util.fileUrl(root.wallpaper) : ""
              readonly property real fit: Math.min(1, 1600 / Math.max(1, view.screen.width)) * (root.quality.detail < 0.5 ? 0.5 : 0.75)
              sourceSize.width: Math.ceil(view.screen.width * fit)
              sourceSize.height: Math.ceil(view.screen.height * fit)
              fillMode: Image.PreserveAspectCrop
              asynchronous: true
              smooth: true
            }

            ScenePass {
              anchors.fill: parent
              visible: root.qualityKnown
              opacity: Math.max(root.skyAmount, 0.004)
              front: 0
              look: view.look.scene
              rects: view.ledges.rects
              depths: view.ledges.depths
              shelters: view.ledges.shelters
              ghostFrom: view.ledges.ghostFrom
              ices: view.ledges.ices
              floatFrom: view.ledges.floatFrom
              clock: root.time
              laneDrift: root.laneDrift
              pixel: root.quality.pixel
              detail: root.quality.detail
              skyAlpha: root.skyOpacity * view.look.wash
              flash: root.flash
              boltX: root.boltAt * view.areaWidth
              boltSeed: root.boltSeed
              snowDepth: view.ledges.deepest
              groundDepth: root.snowDepth * 1.6
              plateWidth: view.plateWidth
              plateHeight: view.plateHeight
              plateRightWidth: view.farWidth
              plateRightHeight: view.farHeight
              plateCoreWidth: view.nearCoreWidth
              plateCoreHeight: view.nearCoreHeight
              plateRightCoreWidth: view.farCoreWidth
              plateRightCoreHeight: view.farCoreHeight
              plateBlur: root.quality.blur
              plateTint: 0.46 * root.infoShare
              scrim: view.look.scrim
            }

            // A still of each window, where the glide has it.
            Item {
              anchors.fill: parent
              visible: root.cover

              Repeater {
                model: view.windowIds

                Item {
                  id: copy
                  // The window's address. Where it is drawn comes from the
                  // list the glide moves.
                  required property string modelData
                  readonly property var info: {
                    var all = view.shown
                    for (var i = 0; i < all.length; i++) if (all[i].address === modelData) return all[i]
                    return null
                  }
                  readonly property var toplevel: info ? info.toplevel : null
                  readonly property bool focused: !!toplevel && toplevel.activated
                  // A title bar's height: the capture is the window under it.
                  readonly property real bar: info ? info.bar : 0
                  visible: info !== null
                  x: info ? info.x : 0
                  y: info ? info.y : 0
                  width: info ? info.width : 0
                  height: info ? info.height : 0

                  // Hyprland ends a capture for good when the window changes
                  // size under it, which a glide makes it do. Letting go of
                  // the window and taking hold again starts a fresh one.
                  // That is done from a timer, a step at a time, never from
                  // inside the capture's own signals: letting go and taking
                  // hold both set those signals off, and answering them on
                  // the spot goes round in circles.
                  property bool armed: true
                  property double armedAt: 0
                  function recapture() {
                    if (rearm.running || !armed || Date.now() - armedAt < 200) return
                    rearm.takeHold = false
                    rearm.restart()
                  }
                  Timer {
                    id: rearm
                    interval: 30
                    property bool takeHold: false
                    onTriggered: {
                      if (!takeHold) {
                        copy.armed = false
                        takeHold = true
                        restart()
                      } else {
                        copy.armedAt = Date.now()
                        copy.armed = true
                      }
                    }
                  }

                  // A still: live only until its first frame lands, then
                  // retaken on the service's beat. It is drawn through the
                  // two snapshots below, not directly.
                  ScreencopyView {
                    id: still
                    anchors.fill: parent
                    anchors.topMargin: copy.bar
                    captureSource: copy.armed && copy.toplevel ? copy.toplevel.wayland : null
                    live: !hasContent

                    // The stage waits for every still's first frame.
                    property bool awaited: false
                    // Whether a frame has ever landed.
                    property bool seen: false
                    Component.onCompleted: {
                      if (hasContent) {
                        seen = true
                        return
                      }
                      awaited = true
                      root.pendingCopies += 1
                    }
                    onHasContentChanged: {
                      if (hasContent) {
                        seen = true
                        if (awaited) {
                          awaited = false
                          root.pendingCopies -= 1
                        }
                      } else if (seen) {
                        // Lost, not let go of.
                        copy.recapture()
                      }
                    }
                    // A capture that should be running has been ended.
                    onStopped: if (seen && live) copy.recapture()
                    Component.onDestruction: if (awaited) root.pendingCopies -= 1
                  }

                  // On the service's beat: a fresh frame, or, for a still
                  // that has lost its capture and not got it back, another
                  // go at one.
                  Connections {
                    target: root
                    function onCaptureTickChanged() {
                      if (still.hasContent) still.captureFrame()
                      else if (still.seen) copy.recapture()
                    }
                  }

                  // The window as it is now. It stops following the capture
                  // the moment that is lost and keeps what it had until a
                  // fresh one arrives, so nothing blinks out.
                  ShaderEffectSource {
                    anchors.fill: parent
                    anchors.topMargin: copy.bar
                    sourceItem: still
                    hideSource: true
                    live: still.hasContent
                    smooth: true
                    visible: still.seen
                  }

                  // The window as it was when the glide began, fading out
                  // over the one above as it goes: a window that has been
                  // laid out again at another size is not the old picture
                  // scaled, and this is how one turns into the other.
                  ShaderEffectSource {
                    anchors.fill: parent
                    anchors.topMargin: copy.bar
                    sourceItem: still
                    live: still.hasContent && !root.frozen
                    smooth: true
                    visible: still.seen && root.oldAmount > 0.003
                    opacity: root.oldAmount
                  }

                  // The title bar, for the length of the glide: its colour,
                  // without its words.
                  Rectangle {
                    width: parent.width
                    height: copy.bar
                    visible: copy.bar > 0
                    color: root.titleBarColor
                  }

                  // Hyprland's border, which the capture does not include.
                  Rectangle {
                    anchors.fill: parent
                    anchors.margins: -2
                    color: "transparent"
                    border.width: 2
                    border.color: copy.focused ? Commons.Color.accent : Util.alpha(Commons.Color.muted, 0.6)
                  }
                }
              }
            }
          }

          // The weather that meets the windows: what lands on them, lies
          // on them and falls past them. It is drawn over the real ones but
          // never on them; the shader leaves every window's own pixels
          // alone.
          ScenePass {
            // As the cover is: the stage with the sky up, a pixel without.
            width: root.mounted ? parent.width : 1
            height: root.mounted ? parent.height : 1
            visible: root.qualityKnown
            // All of it is weather, and goes when the weather is switched off.
            opacity: Math.max(root.weatherAmount * root.weatherShare, 0.004)
            front: 1
            look: view.look.scene
            rects: view.ledges.rects
            depths: view.ledges.depths
            shelters: view.ledges.shelters
            ghostFrom: view.ledges.ghostFrom
            ices: view.ledges.ices
            floatFrom: view.ledges.floatFrom
            clock: root.time
            laneDrift: root.laneDrift
            pixel: root.quality.pixel
            detail: root.quality.detail
            flash: root.flash
            boltX: root.boltAt * view.areaWidth
            boltSeed: root.boltSeed
            snowDepth: view.ledges.deepest
            groundDepth: root.snowDepth * 1.6
            // The rain, snow and fog that cross the words in the corner are
            // blurred with the sky behind them and thinned out toward the
            // corner, so the words keep their contrast in any weather.
            plateWidth: view.plateWidth
            plateHeight: view.plateHeight
            plateRightWidth: view.farWidth
            plateRightHeight: view.farHeight
            plateCoreWidth: view.nearCoreWidth
            plateCoreHeight: view.nearCoreHeight
            plateRightCoreWidth: view.farCoreWidth
            plateRightCoreHeight: view.farCoreHeight
            plateBlur: root.quality.blur
            plateTint: 0
            plateFade: 0.6 * root.infoShare
            plateGuard: true
          }

          // What it is doing out there, in a corner of the sky.
          Readout {
            id: info
            visible: root.infoShare > 0.002 && root.staged
            opacity: root.skyAmount * root.infoShare
            x: Style.space(22)
            y: Style.space(16)
            service: root
            words: strings
            sky: view.sky
            ink: view.look.ink
            // The detail goes under the words where the sky above the
            // windows is tall enough to hold it, and beside them where it
            // is not, so that it stays off the windows either way. With no
            // frame up there is nothing to stay off; and on a screen too
            // narrow to have it beside them without running into the days
            // ahead, under them is the lesser trouble.
            stacked: !view.framed || y + tallHeight + Style.space(12) <= view.placement.y
                     || x + wideWidth + Style.space(40) > outlook.x
          }

          // And the days ahead, in the other top corner, at the second
          // level of the corner info.
          Outlook {
            id: outlook
            visible: root.infoShare > 0.002 && root.detailShare > 0.002 && root.staged && ahead.length > 0
            opacity: root.skyAmount * root.infoShare * root.detailShare
            x: view.areaWidth - width - Style.space(22)
            y: Style.space(16)
            service: root
            ink: view.look.ink
          }

          // With only the panel up, a click anywhere away from it closes
          // it, as it closes any menu. (With the sky up the pointer goes
          // through to the windows instead: see the mask.)
          MouseArea {
            anchors.fill: parent
            visible: view.panelAlone
            acceptedButtons: Qt.AllButtons
            onPressed: root.controlsOpen = false
          }

          // The control panel, under the bar icon that opened it. It is
          // there whether the sky is up or not, and goes out with the sky
          // when the sky is switched off.
          Controls {
            id: panel
            visible: root.controlsOpen && view.focusedMonitor
            opacity: root.active || !root.mounted ? 1 : root.skyAmount
            service: root
            words: strings
            y: Style.space(10)
            room: view.areaHeight - y - Style.space(10)
            x: {
              var wanted = root.controlsX >= 0 ? root.controlsX - view.origin.x - width / 2 : view.areaWidth - width - Style.space(16)
              return Math.max(Style.space(10), Math.min(view.areaWidth - width - Style.space(10), wanted))
            }
          }
        }
      }
    }
  }
}
