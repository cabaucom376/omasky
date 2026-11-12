import Quickshell
import Quickshell.Io
import Quickshell.Wayland
import QtQuick
import qs.Commons
import qs.Commons as Commons
import "plugin" as Plugin
import "plugin/Model.js" as Model

// tools/panel.sh runs this: the control panel drawn offscreen with a stand-in
// for the service, and saved as a picture. Nothing is shown: the window is
// one transparent pixel under everything, and the panel is grabbed from it.
//
// `mock` below answers for everything Controls.qml asks of Service.qml. When
// the panel starts asking for something new, add it here too.
ShellRoot {
  id: shell

  // PANEL_SCENE may list several, comma separated: each is drawn in turn
  // and saved beside the others, so the shaders are built once for all.
  readonly property var wanted: String(Quickshell.env("PANEL_SCENE") || "rain").split(",")
  property int turn: 0
  readonly property string scene: wanted[Math.min(turn, wanted.length - 1)]
  readonly property string out: Quickshell.env("PANEL_OUT") || "/tmp/panel.png"
  readonly property bool flat: Quickshell.env("PANEL_FLAT") === "1"
  readonly property bool tune: Quickshell.env("PANEL_TUNE") === "1"
  // The screen's scale to draw it at.
  readonly property real scale: Number(Quickshell.env("PANEL_SCALE")) || 1.25

  readonly property var scenes: ({
    rain:  { code: 63, hour: 15.5, temperature: 15, mode: "live", snowDepth: 0 },
    night: { code: 1, hour: 22.6, temperature: 9, mode: "live", snowDepth: 0, phase: 0.42 },
    snow:  { code: 75, hour: 9.2, temperature: -6, mode: "manual", snowDepth: 18 },
    tune:  { code: 75, hour: 9.2, temperature: -6, mode: "manual", snowDepth: 22, tune: true },
    dusk:  { code: 2, hour: 18.3, temperature: 21, mode: "demo", snowDepth: 0 },
    storm: { code: 95, hour: 13, temperature: 18, mode: "live", snowDepth: 0, flash: 0.7 },
    clear: { code: 0, hour: 11, temperature: 24, mode: "live", snowDepth: 0 },
    forecast: { code: 63, hour: 16, temperature: 14, mode: "live", snowDepth: 0, forecast: true, detail: true },
    battery: { code: 2, hour: 10, temperature: 17, mode: "live", snowDepth: 0, battery: true },
    alone: { code: 2, hour: 16, temperature: 19, mode: "live", snowDepth: 0, alone: true },
    noweather: { code: 63, hour: 20.5, temperature: 15, mode: "live", snowDepth: 0, weather: false, phase: 0.3 },
    nocycle: { code: 2, hour: 22, temperature: 15, mode: "live", snowDepth: 0, cycle: false, info: false, tune: true, auto: true },
    off: { code: 63, hour: 15.5, temperature: 15, mode: "live", snowDepth: 0, weather: false, cycle: false, info: false },
    // The city field open, with the places a name has found under it.
    city: { code: 2, hour: 14, temperature: 17, mode: "live", snowDepth: 0, city: true, detail: true },
    // The words in the corner on their own, over a stand-in for the sky:
    // simple, detailed with room under them, and detailed without.
    readout: { code: 3, hour: 14, temperature: 18, mode: "live", snowDepth: 0, detail: true, readout: "stacked" },
    "readout-wide": { code: 61, hour: 21, temperature: 9, mode: "live", snowDepth: 0, detail: true, readout: "wide" },
    "readout-simple": { code: 3, hour: 14, temperature: 18, mode: "live", snowDepth: 0, readout: "stacked" },
    "readout-demo": { code: 75, hour: 9, temperature: -6, mode: "demo", snowDepth: 0, detail: true, readout: "stacked" },
    "readout-forecast": { code: 63, hour: 16, temperature: 14, mode: "live", snowDepth: 0, detail: true, forecast: true, readout: "stacked" }
  })
  readonly property var at: scenes[scene] || scenes.rain

  FileView {
    id: colorsFile
    path: Quickshell.env("HOME") + "/.local/state/omarchy/current/theme/colors.toml"
    printErrors: false
    onLoaded: mock.themeColors = Model.parseThemeColors(text())
  }

  Process {
    id: wallpaperProbe
    running: true
    command: ["readlink", "-f", Quickshell.env("HOME") + "/.local/state/omarchy/current/background"]
    stdout: StdioCollector { onStreamFinished: mock.wallpaper = String(text || "").trim() }
  }

  QtObject {
    id: mock
    property var themeColors: ({})
    readonly property var palette: Model.derivePalette(themeColors, {
      foreground: String(Commons.Color.foreground), background: String(Commons.Color.background),
      accent: String(Commons.Color.accent), urgent: String(Commons.Color.urgent), muted: String(Commons.Color.muted)
    })
    property string wallpaper: ""
    property bool debugOpen: shell.tune || shell.at.tune === true
    property string mode: shell.at.mode
    property bool weatherOn: shell.at.weather !== false
    property bool dayNight: shell.at.cycle !== false
    property bool showInfo: shell.at.info !== false
    readonly property int infoLevel: !showInfo ? 0 : (shell.at.detail === true ? 2 : 1)
    readonly property real detailShare: infoLevel === 2 ? 1 : 0
    readonly property bool cityEditing: shell.at.city === true
    readonly property bool citySaving: false
    readonly property bool cityMissing: false
    readonly property bool cityAuto: false
    readonly property bool cityPrimed: false
    readonly property int cityIndex: 1
    readonly property var citySuggestions: cityEditing ? [
      { name: "Paris", description: "Île-de-France, France", latitude: 48.85, longitude: 2.35 },
      { name: "Paris", description: "Texas, United States", latitude: 33.66, longitude: -95.55 },
      { name: "Paris", description: "Tennessee, United States", latitude: 36.3, longitude: -88.33 }
    ] : []
    // A reading with the detail in it and five days of it.
    readonly property var forecast: ({
      feels: shell.at.temperature - 1.4, humidity: 71, windSpeed: 11.2, offset: 0,
      // Today by the hour: showers through the afternoon, snow late on.
      hours: (function() {
        var start = Model.startOfDay(Date.now()), out = []
        for (var h = 1; h <= 24; h++) {
          var fall = h >= 13 && h <= 18 ? [0.3, 1.2, 3.6, 5.5, 2.0, 0.6][h - 13] : (h >= 22 ? 0.9 : 0)
          out.push({ at: start + h * 3600000, code: fall > 0 ? (h >= 22 ? 73 : 63) : 2, temperature: h >= 22 ? -1 : shell.at.temperature,
                     feels: shell.at.temperature - 2, humidity: 80, precip: fall, chance: fall > 0 ? Math.min(1, 0.35 + fall / 5) : 0.05,
                     cloudCover: 60, coverLow: 50, coverMid: 20, coverHigh: 10, windSpeed: 14, windDirection: 250, gusts: 30, visibility: 20000 })
        }
        return out
      })(),
      days: [0, 1, 2, 3, 4].map(function(i) {
        return { day: Math.floor(Date.now() / 86400000) + i, code: [3, 61, 0, 2, 71][i], high: shell.at.temperature + [2, -3, 1, 4, -9][i], low: shell.at.temperature - [8, 6, 9, 5, 14][i] }
      })
    })
    readonly property var outlook: Model.forecastDays(forecast, Date.now())
    function degreesText(celsius) {
      return celsius === null || celsius === undefined ? "" : Math.round(Model.celsiusToFahrenheit(celsius)) + "°"
    }
    readonly property string feelsText: degreesText(forecast.feels)
    readonly property string windText: Math.round(forecast.windSpeed * 0.621371) + " mph"
    readonly property string humidityText: forecast.humidity + "%"
    readonly property real weatherShare: weatherOn ? 1 : 0
    readonly property real cycleShare: dayNight ? 1 : 0
    readonly property var targetWeather: Model.weatherFromCode(shell.at.code, null, 16, 250, { temperature: shell.at.temperature, plain: true })
    readonly property var weather: weatherOn ? targetWeather : Model.calmWeather()
    readonly property var temperature: shell.at.temperature
    property var manual: ({ cover: targetWeather.cover, precip: targetWeather.precip, fog: targetWeather.fog, thunder: targetWeather.thunder > 0.5,
                            hail: false, aurora: shell.at.aurora === true, fireflies: false, wind: 16, temperature: shell.at.temperature, hour: mode === "manual" ? shell.at.hour : -1, phase: -1 })
    readonly property var sliders: manual
    readonly property double now: Model.startOfDay(Date.now()) + shell.at.hour * 3600000
    readonly property real hourNow: shell.at.hour
    readonly property real phasePick: shell.at.phase === undefined ? -1 : shell.at.phase
    readonly property var sunrises: []
    readonly property var sunsets: []
    readonly property var solar: Model.solarDay(now, sunrises, sunsets)
    readonly property bool night: !solar.isDay
    readonly property string glyph: Model.glyphFor(targetWeather, night)
    readonly property var soon: null
    readonly property string soonText: ""
    readonly property string barGlyph: glyph
    readonly property var location: ({ name: "Lisbon", latitude: 38.72, longitude: -9.14 })
    readonly property bool forecastFailed: false
    readonly property bool qualityKnown: !shell.flat
    readonly property bool qualityAuto: shell.at.auto === true
    // The `forecast` scene has the hour set in live mode: an hour's forecast.
    readonly property var hourReading: shell.at.forecast === true ? Model.readingAt(forecast, now) : null
    readonly property bool forecastAhead: hourReading !== null
    readonly property string forecastNote: hourReading ? strings.t("info.forecast").arg(clockText(hourReading.at)) : ""
    // The sky is up; the `alone` scene is the panel opened without it.
    readonly property bool active: shell.at.alone !== true
    // What is picked, and what is drawn: a level lower in the `battery` scene.
    readonly property string qualityChoice: Model.qualityFor(Quickshell.env("PANEL_QUALITY") || "high").name
    readonly property bool savingPower: shell.at.battery === true
    readonly property var quality: Model.qualityFor(savingPower ? Model.easedQuality(qualityChoice) : qualityChoice)
    readonly property real skyOpacity: 0.9
    readonly property real time: 37.4
    readonly property var laneDrift: [120, 180, 260]
    readonly property real flash: shell.at.flash || 0
    readonly property real boltAt: 0.42
    readonly property real boltSeed: 4.2
    readonly property real snowDepth: shell.at.snowDepth
    readonly property bool fahrenheit: true
    readonly property string temperatureText: Math.round(Model.celsiusToFahrenheit(shell.at.temperature)) + "°"
    readonly property string conditionText: strings.t("condition." + targetWeather.key)
    readonly property bool clockPinned: mode === "manual" && manual.hour >= 0
    readonly property real frameRate: 60
    readonly property real refreshHz: 60
    readonly property var lastGlide: ({ frames: 42, worst: 11 })
    function clockText(ms) { return new Date(ms).toLocaleTimeString(Qt.locale(), Locale.ShortFormat) }
    function setManual(k, v) {}
    function seedManual() {}
    function holdManual() {}
    function applyPreset(n) {}
    function setQuality(n) {}
    function setDemo(on) {}
    function goLive() {}
    function strike() {}
    function realTime() {}
    function setWeatherOn(on) {}
    function setDayNight(on) {}
    function setShowInfo(on) {}
    function setInfoLevel(level) {}
    function setHour(hour) {}
    function editCity() {}
    function cancelCity() {}
    function typeCity(text) {}
    function moveCity(step) {}
    function commitCity() {}
    function pickCity(place) {}
    function clearCity() {}
  }

  Commons.Translations { id: strings; directory: Qt.resolvedUrl("plugin/i18n") }

  PanelWindow {
    implicitWidth: 1
    implicitHeight: 1
    color: "transparent"
    exclusionMode: ExclusionMode.Ignore
    WlrLayershell.layer: WlrLayer.Bottom
    WlrLayershell.namespace: "omasky-panel-preview"
    anchors { top: true; left: true }

    Plugin.Controls {
      id: panel
      service: mock
      words: strings
    }

    // The words in one corner and the days ahead in the other, on a
    // stand-in for the strip of sky they sit in.
    Rectangle {
      id: corner
      x: 600
      width: 1100
      height: Math.max(readout.height, outlook.height) + 60
      color: Model.toHex(Model.mixColor(mock.palette.dayTop, mock.palette.dayBottom, mock.night ? 0 : 0.5))

      Plugin.Readout {
        id: readout
        x: 22
        y: 16
        service: mock
        words: strings
        sky: Model.celestial(mock.now, mock.sunrises, mock.sunsets, { width: 1600, height: 1000, margin: 180, deck: 200, desk: null }, 35, mock.phasePick)
        ink: Model.toHex(mock.palette.paper)
        stacked: shell.at.readout !== "wide"
      }

      Plugin.Outlook {
        id: outlook
        visible: mock.detailShare > 0
        x: parent.width - width - 22
        y: 16
        service: mock
        ink: Model.toHex(mock.palette.paper)
      }
    }
  }

  Timer {
    id: shoot
    interval: 2200
    running: true
    onTriggered: {
      var scale = shell.scale
      var path = shell.wanted.length > 1 ? shell.out.replace(/\.png$/, "-" + shell.scene + ".png") : shell.out
      var subject = shell.at.readout ? corner : panel
      subject.grabToImage(function(result) {
        result.saveToFile(path)
        console.log("panel: saved " + path + " " + subject.width + "x" + subject.height)
        if (shell.turn + 1 >= shell.wanted.length) {
          Qt.quit()
          return
        }
        shell.turn += 1
        shoot.interval = 700
        shoot.restart()
      }, Qt.size(Math.ceil(subject.width * scale), Math.ceil(subject.height * scale)))
    }
  }
  Timer { interval: 22000; running: true; onTriggered: Qt.quit() }
}
