import QtQuick
import qs.Commons
import qs.Commons as Commons
import "Model.js" as Model

// The sky's control panel, opened with a right click on the bar icon. It
// lives inside the scene, under the bar, because that is the surface in
// front. It is worked with the pointer; the keyboard stays with the windows,
// except while a city is being typed into it.
//
// From the top: a miniature of the sky as it is now, drawn by the same
// shaders as the real one, over the wallpaper; under it what it is doing
// out there and where, the place being a button that sets the city; a ruler
// of the day to set the hour on; two switches (the weather, the hour); what
// is written in the corners of the sky; the mode and the quality; and,
// folded away until asked for, a hand on every state the weather has.
Rectangle {
  id: panel

  // Service.qml's root.
  required property var service
  // Its Commons.Translations.
  required property var words
  // The room there is for it under where it sits. Taller than that, it scrolls.
  property real room: 100000

  readonly property bool tuneOpen: service.debugOpen
  // What the sliders show: the hand-set state, or the sky as it is until
  // one of them is touched.
  readonly property var manual: service.sliders
  readonly property int edge: Math.max(1, Style.space(2))
  readonly property int pad: Style.space(14)
  readonly property color ink: Commons.Color.popups.text
  readonly property color paper: Commons.Color.popups.background
  readonly property color accent: Commons.Color.accent

  // Every slider starts with a name, and the tracks line up after the
  // longest of them, whatever language they are in.
  FontMetrics {
    id: nameMetrics
    font.family: Style.font.family
    font.pixelSize: Style.font.bodySmall
  }
  readonly property real labelWidth: {
    var keys = ["clouds", "precip", "temperature", "fog", "wind", "moon"]
    var widest = 0
    for (var i = 0; i < keys.length; i++) widest = Math.max(widest, nameMetrics.advanceWidth(panel.words.t("panel." + keys[i])))
    return Math.ceil(widest) + Style.space(12)
  }

  width: Style.space(448)
  height: Math.min(content.implicitHeight + edge * 2, Math.max(Style.space(220), room))
  color: paper
  border.width: edge
  border.color: Commons.Color.popups.border
  radius: Style.cornerRadius

  // Folding the hand controls in and out is a slide, not a jump.
  Behavior on height {
    enabled: panel.visible
    NumberAnimation { duration: Style.duration(200); easing.type: Easing.OutCubic }
  }

  // The pointer on the panel is the panel's; the sky behind does not hear it.
  MouseArea {
    anchors.fill: parent
    hoverEnabled: true
    acceptedButtons: Qt.AllButtons
  }

  function percent(value) {
    return Commons.I18n.formatNumber(Math.round(value * 100)) + "%"
  }

  function degrees(celsius) {
    var shown = panel.service.fahrenheit ? Model.celsiusToFahrenheit(celsius) : celsius
    return Commons.I18n.formatNumber(Math.round(shown)) + (panel.service.fahrenheit ? "°F" : "°C")
  }

  Flickable {
    id: scroller
    x: panel.edge
    y: panel.edge
    width: panel.width - panel.edge * 2
    height: panel.height - panel.edge * 2
    contentWidth: width
    contentHeight: content.implicitHeight
    clip: true
    interactive: contentHeight > height + 1
    boundsBehavior: Flickable.StopAtBounds
    flickableDirection: Flickable.VerticalFlick

    Column {
      id: content
      width: scroller.width

      // ------------------------------------------------------ the miniature
      //
      // The sky as it is, small: the wallpaper, and over it the same two
      // passes the screen has, handed a scene the size of this strip. So it
      // answers to everything below it the way the real sky does, and shows
      // the whole of the arc the sun and moon ride at a glance.
      Item {
        id: hero
        width: parent.width
        height: Style.space(128)
        clip: true

        readonly property real dpr: Screen.devicePixelRatio > 0 ? Screen.devicePixelRatio : 1
        // One pixel of the miniature's art is a whole number of the
        // screen's, so the picture is as crisp here as it is full size.
        readonly property real cell: Math.max(2, Math.round(1.6 * dpr))
        // The scene is drawn this many times the strip's size and shown
        // scaled down, which is what makes it a miniature and not a crop.
        readonly property real zoom: 4 * dpr / cell
        readonly property real sceneWidth: Math.ceil(width * zoom / 4) * 4
        readonly property real sceneHeight: Math.ceil(height * zoom / 4) * 4
        readonly property var geometry: ({ width: sceneWidth, height: sceneHeight, margin: 0, deck: sceneHeight * 0.62, desk: null })
        readonly property var sky: Model.celestial(panel.service.now, panel.service.sunrises, panel.service.sunsets, geometry,
                                                   panel.service.location.latitude, panel.service.phasePick)
        readonly property var look: Model.sceneUniforms(panel.service.palette, Model.steadySky(sky, 1 - panel.service.cycleShare),
                                                        panel.service.weather, geometry)
        readonly property var none: [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]

        // The wallpaper at the strip's width, showing a band of it from a
        // little above its middle: where most wallpapers have something.
        Image {
          width: hero.width
          height: status === Image.Ready && implicitWidth > 0 ? Math.max(hero.height, width * implicitHeight / implicitWidth) : hero.height
          y: -(height - hero.height) * 0.42
          source: panel.visible && panel.service.wallpaper ? Util.fileUrl(panel.service.wallpaper) : ""
          sourceSize.width: Math.ceil(hero.width * hero.dpr)
          fillMode: Image.PreserveAspectCrop
          asynchronous: true
          smooth: true
        }

        Item {
          // Its bottom edge on the strip's: that is the ground.
          y: hero.height - hero.sceneHeight / hero.zoom
          width: hero.sceneWidth
          height: hero.sceneHeight
          scale: 1 / hero.zoom
          transformOrigin: Item.TopLeft
          visible: panel.visible && panel.service.qualityKnown

          ScenePass {
            anchors.fill: parent
            front: 0
            look: hero.look.scene
            rects: hero.none
            clock: panel.service.time
            laneDrift: panel.service.laneDrift
            pixel: 4
            detail: Math.min(panel.service.quality.detail, 2)
            skyAlpha: panel.service.skyOpacity * hero.look.wash
            flash: panel.service.flash
            boltX: panel.service.boltAt * hero.sceneWidth
            boltSeed: panel.service.boltSeed
            groundDepth: panel.service.snowDepth * 1.6
          }

          ScenePass {
            anchors.fill: parent
            opacity: panel.service.weatherShare
            front: 1
            look: hero.look.scene
            rects: hero.none
            clock: panel.service.time
            laneDrift: panel.service.laneDrift
            pixel: 4
            detail: Math.min(panel.service.quality.detail, 2)
            flash: panel.service.flash
            boltX: panel.service.boltAt * hero.sceneWidth
            boltSeed: panel.service.boltSeed
            groundDepth: panel.service.snowDepth * 1.6
          }
        }
      }

      // What it is doing out there and where, and the hour the sky is
      // showing. The miniature's ground is this band's top edge: rain
      // splashes along it and snow settles on it.
      Item {
        id: facts
        width: parent.width
        height: said.implicitHeight + Style.space(18)

        Column {
          id: said
          anchors.left: parent.left
          anchors.leftMargin: panel.pad
          anchors.right: clock.left
          anchors.rightMargin: Style.space(10)
          anchors.verticalCenter: parent.verticalCenter
          spacing: Style.space(1)

          Row {
            spacing: Style.space(10)

            Text {
              id: warmth
              visible: text !== ""
              textFormat: Text.PlainText
              text: panel.service.temperatureText
              color: panel.ink
              font.family: Style.font.family
              font.pixelSize: Style.font.display
            }

            Text {
              anchors.baseline: warmth.visible ? warmth.baseline : undefined
              textFormat: Text.PlainText
              text: panel.service.conditionText
              color: panel.ink
              font.family: Style.font.family
              font.pixelSize: warmth.visible ? Style.font.title : Style.font.heading
              font.bold: true
            }
          }

          // Where the weather is for, which is pressed to change it; then
          // the moon and when the sun next comes or goes.
          Item {
            width: parent.width
            height: Math.max(where.implicitHeight, cityField.height)

            Row {
              id: where
              visible: !panel.service.cityEditing
              anchors.verticalCenter: parent.verticalCenter
              spacing: 0

              Item {
                id: place
                readonly property bool hot: placeArea.containsMouse
                width: placeRow.implicitWidth
                height: placeRow.implicitHeight

                Row {
                  id: placeRow
                  spacing: Style.space(5)

                  Text {
                    textFormat: Text.PlainText
                    text: "\uf041"
                    color: place.hot ? panel.accent : panel.ink
                    opacity: place.hot ? 1 : 0.6
                    font.family: Style.font.family
                    font.pixelSize: Style.font.caption
                  }
                  Text {
                    textFormat: Text.PlainText
                    text: panel.service.location.name ? panel.service.location.name : panel.words.t("panel.setCity")
                    color: place.hot ? panel.accent : panel.ink
                    opacity: place.hot ? 1 : 0.6
                    font.family: Style.font.family
                    font.pixelSize: Style.font.caption
                    font.underline: place.hot
                  }
                }

                MouseArea {
                  id: placeArea
                  anchors.fill: parent
                  anchors.margins: -Style.space(4)
                  hoverEnabled: true
                  cursorShape: Qt.PointingHandCursor
                  onClicked: panel.service.editCity()
                }
              }

              // The moon by night, lit as far as it is, and when the sun
              // next comes up or goes down.
              Repeater {
                model: [
                  { glyph: "\uf071", text: panel.service.mode === "live" && panel.service.forecastFailed && !panel.service.forecast ? panel.words.t("info.offline") : "" },
                  { glyph: Model.moonGlyph(hero.sky.moon.phase), text: hero.sky.isDay ? "" : panel.words.t("moon." + hero.sky.moon.key) },
                  { glyph: hero.sky.isDay ? "\ue34d" : "\ue34c",
                    text: panel.words.t(hero.sky.isDay ? "info.sunset" : "info.sunrise").arg(panel.service.clockText(hero.sky.end)) }
                ]

                Row {
                  id: aside
                  required property var modelData
                  visible: modelData.text !== ""
                  leftPadding: Style.space(12)
                  spacing: Style.space(5)

                  Text {
                    textFormat: Text.PlainText
                    text: aside.modelData.glyph
                    color: panel.ink
                    opacity: 0.6
                    font.family: Style.font.family
                    font.pixelSize: Style.font.caption
                  }
                  Text {
                    textFormat: Text.PlainText
                    text: aside.modelData.text
                    color: panel.ink
                    opacity: 0.6
                    font.family: Style.font.family
                    font.pixelSize: Style.font.caption
                  }
                }
              }
            }

            // The field a city is typed into. The places the name could be
            // are listed under this band; Enter takes the one picked out,
            // Escape leaves things as they were. Working in a window takes
            // the keyboard back there; a press in the field brings it here
            // again.
            Row {
              id: cityField
              visible: panel.service.cityEditing
              anchors.verticalCenter: parent.verticalCenter
              height: visible ? fieldBox.height : 0
              spacing: Style.space(6)

              Rectangle {
                id: fieldBox
                width: Style.space(190)
                height: cityInput.implicitHeight + Style.space(8)
                radius: Style.cornerRadius
                color: Util.alpha(panel.ink, 0.06)
                border.width: 1
                border.color: panel.service.cityMissing ? Commons.Color.urgent : (cityInput.activeFocus ? panel.accent : Util.alpha(panel.ink, 0.4))

                TextInput {
                  id: cityInput
                  anchors.left: parent.left
                  anchors.right: parent.right
                  anchors.margins: Style.space(7)
                  anchors.verticalCenter: parent.verticalCenter
                  clip: true
                  enabled: !panel.service.citySaving
                  color: panel.ink
                  selectionColor: Util.alpha(panel.accent, 0.5)
                  selectedTextColor: panel.ink
                  font.family: Style.font.family
                  font.pixelSize: Style.font.bodySmall
                  maximumLength: 80
                  inputMethodHints: Qt.ImhNoPredictiveText

                  onTextEdited: panel.service.typeCity(text)
                  Keys.onPressed: function(event) {
                    if (event.key === Qt.Key_Escape) {
                      panel.service.cancelCity()
                      event.accepted = true
                    } else if (event.key === Qt.Key_Down) {
                      panel.service.moveCity(1)
                      event.accepted = true
                    } else if (event.key === Qt.Key_Up) {
                      panel.service.moveCity(-1)
                      event.accepted = true
                    } else if (event.key === Qt.Key_Return || event.key === Qt.Key_Enter) {
                      panel.service.commitCity()
                      event.accepted = true
                    }
                  }
                }

                Text {
                  anchors.left: cityInput.left
                  anchors.verticalCenter: parent.verticalCenter
                  visible: cityInput.text === ""
                  textFormat: Text.PlainText
                  text: panel.words.t("panel.searchCity")
                  color: panel.ink
                  opacity: 0.4
                  font.family: Style.font.family
                  font.pixelSize: Style.font.bodySmall
                }
              }

              Chip {
                anchors.verticalCenter: parent.verticalCenter
                small: true
                visible: !panel.service.citySaving
                text: panel.words.t("panel.autoCity")
                on: panel.service.cityAuto
                onPicked: panel.service.clearCity()
              }
              Chip {
                anchors.verticalCenter: parent.verticalCenter
                small: true
                visible: !panel.service.citySaving
                text: "✕"
                onPicked: panel.service.cancelCity()
              }
              Text {
                anchors.verticalCenter: parent.verticalCenter
                visible: panel.service.citySaving || panel.service.cityMissing
                textFormat: Text.PlainText
                text: panel.service.citySaving ? "…" : panel.words.t("panel.noCity")
                color: panel.service.cityMissing ? Commons.Color.urgent : panel.ink
                font.family: Style.font.family
                font.pixelSize: Style.font.caption
              }
            }

            // The field takes the keyboard as it opens, once the surface
            // has been handed it.
            Connections {
              target: panel.service
              function onCityEditingChanged() {
                if (!panel.service.cityEditing) return
                cityInput.text = ""
                cityInput.forceActiveFocus()
              }
              function onCityPrimedChanged() {
                if (panel.service.cityEditing && panel.service.cityPrimed) cityInput.forceActiveFocus()
              }
            }
          }
        }

        // The hour, and the way back to the real one when it has been set
        // by hand.
        Column {
          id: clock
          anchors.right: parent.right
          anchors.rightMargin: panel.pad
          anchors.verticalCenter: parent.verticalCenter
          spacing: Style.space(4)

          // Over the hour, when what is shown is that hour's forecast and
          // not the weather now.
          Text {
            anchors.right: parent.right
            visible: panel.service.hourReading !== null
            textFormat: Text.PlainText
            text: panel.words.t(panel.service.forecastAhead ? "panel.forecast" : "panel.earlier").toUpperCase()
            color: panel.accent
            font.family: Style.font.family
            font.pixelSize: Style.font.caption
            font.letterSpacing: 1.2
          }

          Text {
            anchors.right: parent.right
            textFormat: Text.PlainText
            text: panel.service.clockText(panel.service.now)
            color: panel.ink
            font.family: Style.font.family
            font.pixelSize: Style.font.heading
            font.bold: true
          }

          Chip {
            anchors.right: parent.right
            visible: panel.service.clockPinned
            small: true
            text: "↺ " + panel.words.t("panel.realTime")
            onPicked: panel.service.realTime()
          }
        }
      }

      // The places the typed name could be. One is picked out, by the
      // arrow keys or the pointer; Enter or a press takes it.
      Column {
        visible: panel.service.cityEditing && !panel.service.citySaving && panel.service.citySuggestions.length > 0
        width: parent.width
        bottomPadding: Style.space(6)

        Repeater {
          model: panel.service.citySuggestions

          Rectangle {
            id: found
            required property var modelData
            required property int index
            readonly property bool picked: index === panel.service.cityIndex
            width: parent.width
            height: foundRow.implicitHeight + Style.space(10)
            color: picked ? Util.alpha(panel.accent, 0.18) : "transparent"

            Row {
              id: foundRow
              x: panel.pad
              anchors.verticalCenter: parent.verticalCenter
              spacing: Style.space(8)

              Text {
                textFormat: Text.PlainText
                text: found.modelData.name
                color: found.picked ? panel.accent : panel.ink
                font.family: Style.font.family
                font.pixelSize: Style.font.bodySmall
                font.bold: found.picked
              }
              Text {
                anchors.baseline: parent.children[0].baseline
                textFormat: Text.PlainText
                text: found.modelData.description
                color: panel.ink
                opacity: 0.55
                font.family: Style.font.family
                font.pixelSize: Style.font.caption
              }
            }

            MouseArea {
              anchors.fill: parent
              hoverEnabled: true
              cursorShape: Qt.PointingHandCursor
              onPositionChanged: panel.service.cityIndex = found.index
              onClicked: panel.service.pickCity(found.modelData)
            }
          }
        }
      }

      // ---------------------------------------------------------- the day
      //
      // The twenty-four hours as a ruler, the day lit along it between
      // sunrise and sunset, and a needle at the hour. Drag it to set the hour.
      Item {
        id: ruler
        width: parent.width
        // The hour labels hang below the band and the forecast strip; the
        // last few points keep them off the tiles under them.
        height: Style.space(42) + strip.height

        readonly property real inset: panel.pad
        readonly property real span: width - inset * 2
        readonly property color night: Model.toHex(Model.mixColor(panel.service.palette.nightTop, panel.service.palette.nightBottom, 0.7))
        readonly property color day: Model.toHex(Model.mixColor(panel.service.palette.dayTop, panel.service.palette.dayBottom, 0.6))
        readonly property color glow: Model.toHex(panel.service.palette.glow)
        // The light of each ten minutes of today, as the sky will have it:
        // by the same sunrise and sunset, wherever the place is.
        readonly property double dayStart: Model.startOfDay(panel.service.now)
        readonly property var light: Model.dayBand(dayStart, panel.service.sunrises, panel.service.sunsets, 144)
        // What is forecast to fall in each hour of it (the demo's day is
        // its own, and has no forecast).
        readonly property var falls: panel.service.mode !== "demo" ? Model.hourStrip(panel.service.forecast, dayStart) : []
        readonly property color rainTone: Model.toHex(panel.service.palette.rain)
        readonly property color snowTone: Model.toHex(panel.service.palette.snow)

        opacity: panel.service.dayNight ? 1 : 0.4
        Behavior on opacity { NumberAnimation { duration: Style.duration(200) } }

        Item {
          id: band
          x: ruler.inset
          y: Style.space(8)
          width: ruler.span
          height: Style.space(7)

          Repeater {
            model: ruler.light

            Rectangle {
              required property var modelData
              required property int index
              // Each slice runs to where the next begins, so none shows a gap.
              x: Math.floor(index * band.width / ruler.light.length)
              width: Math.floor((index + 1) * band.width / ruler.light.length) - x
              height: band.height
              color: Qt.tint(Qt.tint(ruler.night, Util.alpha(ruler.day, modelData.dayness)), Util.alpha(ruler.glow, 0.85 * modelData.twilight))
            }
          }

          Rectangle {
            anchors.fill: parent
            color: "transparent"
            border.width: 1
            border.color: Util.alpha(panel.ink, 0.30)
          }
        }

        // The forecast, hanging from the day: a bar under each hour in which
        // something falls, longer the more of it, fainter the less likely,
        // pale where it is snow.
        Item {
          id: strip
          x: ruler.inset
          y: band.y + band.height
          width: ruler.span
          height: Style.space(8)

          Repeater {
            model: ruler.falls

            Rectangle {
              required property var modelData
              required property int index
              readonly property real slot: strip.width / 24
              visible: !!modelData && height > 0
              x: Math.round(index * slot) + 1
              width: Math.max(1, Math.round((index + 1) * slot) - Math.round(index * slot) - 2)
              height: modelData ? Math.round((strip.height - 1) * Model.stripLength(modelData.amount)) : 0
              color: modelData && modelData.snow ? ruler.snowTone : ruler.rainTone
              opacity: modelData && modelData.chance !== null ? 0.4 + 0.6 * modelData.chance : 0.85
            }
          }
        }

        Repeater {
          model: [0, 6, 12, 18, 24]

          Item {
            id: tick
            required property int modelData
            x: ruler.inset + ruler.span * modelData / 24
            y: band.y + band.height + strip.height

            Rectangle {
              x: tick.modelData === 24 ? -1 : 0
              width: 1
              height: Style.space(4)
              color: Util.alpha(panel.ink, 0.40)
            }

            Text {
              x: tick.modelData === 0 ? 0 : (tick.modelData === 24 ? -width : -width / 2)
              y: Style.space(5)
              textFormat: Text.PlainText
              text: (tick.modelData < 10 ? "0" : "") + tick.modelData
              color: panel.ink
              opacity: 0.5
              font.family: Style.font.family
              font.pixelSize: Style.font.caption
            }
          }
        }

        // The needle: a bar through the band with a block on top.
        Item {
          id: needle
          x: ruler.inset + ruler.span * Math.max(0, Math.min(24, panel.service.hourNow)) / 24
          y: band.y

          Rectangle {
            x: -width / 2
            y: -Style.space(3)
            width: Math.max(2, Style.space(2))
            height: band.height + Style.space(6)
            color: panel.accent
          }
          Rectangle {
            x: -width / 2
            y: -Style.space(6)
            width: Style.space(7)
            height: Style.space(4)
            color: rulerArea.containsMouse || rulerArea.pressed ? Qt.lighter(panel.accent, 1.25) : panel.accent
          }
        }

        MouseArea {
          id: rulerArea
          anchors.fill: parent
          hoverEnabled: true
          preventStealing: true
          cursorShape: Qt.PointingHandCursor
          function set(x) {
            var hour = (x - ruler.inset) / ruler.span * 24
            panel.service.setHour(Math.max(0, Math.min(23.99, hour)))
          }
          onPressed: function(mouse) { set(mouse.x) }
          onPositionChanged: function(mouse) { if (pressed) set(mouse.x) }
        }
      }

      // --------------------------------------------------------- the rest
      Column {
        x: panel.pad
        width: parent.width - panel.pad * 2
        topPadding: Style.space(4)
        bottomPadding: panel.pad
        spacing: Style.space(12)

        // The two halves of the sky, each switched on its own: the weather,
        // and the hour.
        Row {
          id: switches
          width: parent.width
          spacing: Style.space(8)
          readonly property real each: (width - spacing * 2) / 3

          // The weather by a cloud, so that it never shows the same sun or
          // moon as the hour's tile beside it.
          Tile {
            width: switches.each
            glyph: Model.cloudGlyph(panel.service.targetWeather)
            text: panel.words.t("panel.weather")
            on: panel.service.weatherOn
            onPicked: panel.service.setWeatherOn(!panel.service.weatherOn)
          }
          Tile {
            width: switches.each
            glyph: panel.service.night ? "\ue32b" : "\ue30d"
            text: panel.words.t("panel.dayNight")
            on: panel.service.dayNight
            onPicked: panel.service.setDayNight(!panel.service.dayNight)
          }
          // Rain, wind and thunder to be heard as well as seen. Dimmed where
          // the machine has nothing to play it with.
          Tile {
            width: switches.each
            glyph: panel.service.soundOn ? "\uf028" : "\uf026"
            text: panel.words.t(panel.service.soundMissing ? "panel.soundMissing" : "panel.sound")
            on: panel.service.soundOn && !panel.service.soundMissing
            opacity: panel.service.soundMissing ? 0.5 : 1
            onPicked: panel.service.setSoundOn(!panel.service.soundOn)
          }
        }

        // The words in the corner of the sky: none, the temperature and
        // what it is doing, or with those the detail and the days ahead.
        Column {
          width: parent.width
          spacing: Style.space(6)

          Heading { text: panel.words.t("panel.readout") }
          Segments {
            value: String(panel.service.infoLevel)
            options: [
              { value: "0", label: panel.words.t("panel.infoOff") },
              { value: "1", label: panel.words.t("panel.infoSimple") },
              { value: "2", label: panel.words.t("panel.infoDetailed") }
            ]
            onPicked: function(value) { panel.service.setInfoLevel(Number(value)) }
          }
        }

        Column {
          width: parent.width
          spacing: Style.space(6)

          Heading { text: panel.words.t("panel.mode") }
          Segments {
            value: panel.service.mode
            options: [
              { value: "live", label: panel.words.t("panel.live") },
              { value: "demo", label: (panel.service.mode === "demo" ? "■ " : "▶ ") + panel.words.t("panel.demo") },
              { value: "manual", label: panel.words.t("panel.byHand") }
            ]
            // Manual brings up its controls, unfolded; Live and Demo,
            // which have no use for them, take them away again.
            onPicked: function(value) {
              if (value === "live") {
                panel.service.goLive()
                panel.service.debugOpen = false
              } else if (value === "demo") {
                panel.service.setDemo(panel.service.mode !== "demo")
                panel.service.debugOpen = false
              } else {
                panel.service.holdManual()
                panel.service.debugOpen = true
              }
            }
          }
        }

        Column {
          width: parent.width
          spacing: Style.space(6)

          Heading {
            text: panel.words.t("panel.quality") + (panel.service.savingPower ? "  ·  " + panel.words.t("panel.savingPower") : "")
          }
          Segments {
            value: panel.service.qualityAuto ? "auto" : panel.service.qualityChoice
            // What it is drawing at when that is not the level picked: left
            // to itself, what it has settled on for this machine; and on
            // battery, a level under the one picked.
            echo: panel.service.qualityAuto || panel.service.quality.name !== panel.service.qualityChoice ? panel.service.quality.name : ""
            options: [
              { value: "auto", label: panel.words.t("panel.auto") },
              { value: "low", label: panel.words.t("panel.low") },
              { value: "medium", label: panel.words.t("panel.medium") },
              { value: "high", label: panel.words.t("panel.high") },
              { value: "ultra", label: panel.words.t("panel.ultra") }
            ]
            onPicked: function(value) { panel.service.setQuality(value) }
          }
        }

        // Manual: every state the weather has. It is here only while the
        // mode is Manual; Live and Demo have no use for it.
        Column {
          visible: panel.service.mode === "manual"
          width: parent.width
          spacing: Style.space(8)

          Heading {
            text: panel.words.t("panel.tune")
            fold: true
            open: panel.tuneOpen
            onPicked: {
              if (!panel.service.debugOpen) panel.service.seedManual()
              panel.service.debugOpen = !panel.service.debugOpen
            }
          }

          Column {
            visible: panel.tuneOpen
            width: parent.width
            spacing: Style.space(8)

            Grid {
              id: presets
              width: parent.width
              columns: 7
              spacing: Style.space(4)
              readonly property real each: (width - spacing * (columns - 1)) / columns
              opacity: panel.service.weatherOn ? 1 : 0.5

              Repeater {
                model: [
                  { name: "clear", glyph: "" }, { name: "partly", glyph: "" }, { name: "cloudy", glyph: "" },
                  { name: "fog", glyph: "" }, { name: "rain", glyph: "" }, { name: "storm", glyph: "" },
                  { name: "hail", glyph: "" }, { name: "sleet", glyph: "" }, { name: "snow", glyph: "" },
                  { name: "blizzard", glyph: "" }, { name: "ice", glyph: "" }, { name: "thaw", glyph: "" },
                  { name: "heat", glyph: "" }
                ]

                Tile {
                  required property var modelData
                  width: presets.each
                  small: true
                  lamp: false
                  glyph: modelData.glyph
                  text: panel.words.t("preset." + modelData.name)
                  onPicked: panel.service.applyPreset(modelData.name)
                }
              }
            }

            Column {
              width: parent.width
              spacing: Style.space(2)

              Fader {
                labelWidth: panel.labelWidth
                muted: !panel.service.weatherOn
                label: panel.words.t("panel.clouds"); value: panel.manual.cover; valueText: panel.percent(panel.manual.cover)
                onMoved: function(v) { panel.service.setManual("cover", v) }
              }
              // How hard it comes down, and how warm it is. The warmth is what
              // makes it rain, sleet or snow, and what melts or keeps what has
              // fallen: the notch on its track is freezing.
              Fader {
                labelWidth: panel.labelWidth
                muted: !panel.service.weatherOn
                label: panel.words.t("panel.precip"); value: panel.manual.precip; valueText: panel.percent(panel.manual.precip)
                onMoved: function(v) { panel.service.setManual("precip", v) }
              }
              Fader {
                labelWidth: panel.labelWidth
                muted: !panel.service.weatherOn
                label: panel.words.t("panel.temperature"); from: -15; to: 45; notch: 0
                value: panel.manual.temperature; valueText: panel.degrees(panel.manual.temperature)
                onMoved: function(v) { panel.service.setManual("temperature", v) }
              }
              Fader {
                labelWidth: panel.labelWidth
                muted: !panel.service.weatherOn
                label: panel.words.t("panel.fog"); value: panel.manual.fog; valueText: panel.percent(panel.manual.fog)
                onMoved: function(v) { panel.service.setManual("fog", v) }
              }
              // It blows either way: the track fills out from the middle.
              Fader {
                labelWidth: panel.labelWidth
                muted: !panel.service.weatherOn
                label: panel.words.t("panel.wind"); from: -100; to: 100; origin: 0; notch: 0
                value: panel.manual.wind
                valueText: (panel.manual.wind < 0 ? "← " : "→ ") + Commons.I18n.formatNumber(Math.abs(Math.round(panel.manual.wind)))
                onMoved: function(v) { panel.service.setManual("wind", v) }
              }
              Fader {
                labelWidth: panel.labelWidth
                muted: !panel.service.dayNight
                label: panel.words.t("panel.moon"); from: 0; to: 1
                value: panel.manual.phase < 0 ? Model.moonPhase(panel.service.now) : panel.manual.phase
                valueText: panel.manual.phase < 0 ? panel.words.t("panel.real") : panel.percent(0.5 - 0.5 * Math.cos(2 * Math.PI * panel.manual.phase))
                onMoved: function(v) { panel.service.setManual("phase", Math.min(v, 0.999)) }
              }
            }

            Flow {
              width: parent.width
              spacing: Style.space(6)

              Chip {
                text: panel.words.t("panel.thunder"); on: panel.manual.thunder === true
                onPicked: panel.service.setManual("thunder", !panel.manual.thunder)
              }
              Chip {
                text: panel.words.t("panel.hail"); on: panel.manual.hail === true
                onPicked: panel.service.setManual("hail", !panel.manual.hail)
              }
              Chip { text: " " + panel.words.t("panel.strike"); onPicked: panel.service.strike() }
              // What only some nights have, to be had on any: they show
              // after dark, the lights in an open sky.
              Chip {
                text: panel.words.t("panel.aurora"); on: panel.manual.aurora === true
                onPicked: panel.service.setManual("aurora", !panel.manual.aurora)
              }
              Chip {
                text: panel.words.t("panel.fireflies"); on: panel.manual.fireflies === true
                onPicked: panel.service.setManual("fireflies", !panel.manual.fireflies)
              }
              Chip {
                visible: panel.manual.phase >= 0
                text: "↺ " + panel.words.t("panel.realMoon")
                onPicked: panel.service.setManual("phase", -1)
              }
            }

            // How it is running: frames a second now, and how the last glide went.
            Text {
              width: parent.width
              wrapMode: Text.WordWrap
              textFormat: Text.PlainText
              color: panel.ink
              opacity: 0.5
              font.family: Style.font.family
              font.pixelSize: Style.font.caption
              text: panel.words.t("panel.stats").arg(Math.round(panel.service.frameRate)).arg(Math.round(panel.service.refreshHz)).arg(panel.service.lastGlide.frames).arg(panel.service.lastGlide.worst)
            }
          }
        }

        Text {
          width: parent.width
          wrapMode: Text.WordWrap
          textFormat: Text.PlainText
          color: panel.ink
          opacity: 0.45
          font.family: Style.font.family
          font.pixelSize: Style.font.caption
          // With the sky down the panel is on its own, and closes like a menu.
          text: panel.words.t(panel.service.active ? "panel.hint" : "panel.hintAlone")
        }
      }
    }
  }

  // A section's name in small capitals, with a rule running on from it.
  // One that folds (fold) is a button: it carries an arrow and is pressed to
  // open and close what is under it.
  component Heading: Item {
    id: heading
    property string text: ""
    property bool fold: false
    property bool open: false
    signal picked()

    width: parent ? parent.width : 0
    height: Math.max(title.implicitHeight, fold ? Style.space(20) : 0)

    Text {
      id: arrow
      visible: heading.fold
      anchors.verticalCenter: parent.verticalCenter
      rightPadding: Style.space(6)
      textFormat: Text.PlainText
      text: heading.open ? "▼" : "▶"
      color: Commons.Color.accent
      font.family: Style.font.family
      font.pixelSize: Style.font.caption
    }

    Text {
      id: title
      x: heading.fold ? arrow.width : 0
      anchors.verticalCenter: parent.verticalCenter
      textFormat: Text.PlainText
      text: heading.text.toUpperCase()
      color: heading.fold && area.containsMouse ? Commons.Color.accent : Commons.Color.popups.text
      opacity: heading.fold ? (area.containsMouse || heading.open ? 1 : 0.75) : 0.55
      font.family: Style.font.family
      font.pixelSize: Style.font.caption
      font.bold: true
      font.letterSpacing: 1.6
    }

    Rectangle {
      anchors.left: title.right
      anchors.leftMargin: Style.space(8)
      anchors.right: parent.right
      anchors.verticalCenter: parent.verticalCenter
      height: 1
      color: Util.alpha(Commons.Color.popups.text, 0.16)
    }

    MouseArea {
      id: area
      anchors.fill: parent
      enabled: heading.fold
      hoverEnabled: heading.fold
      cursorShape: heading.fold ? Qt.PointingHandCursor : Qt.ArrowCursor
      onClicked: heading.picked()
    }
  }

  // A switch as a tile: a picture, its name under it, and a lamp in the
  // corner that is lit while it is on. With no lamp it is a plain button.
  component Tile: Rectangle {
    id: tile
    property string glyph: ""
    property string text: ""
    property bool on: false
    property bool lamp: true
    property bool small: false
    signal picked()

    readonly property color ink: Commons.Color.popups.text
    readonly property color accent: Commons.Color.accent
    readonly property bool hot: tileArea.containsMouse

    height: small ? Style.space(44) : Style.space(60)
    radius: Style.cornerRadius
    color: tileArea.pressed ? Util.alpha(ink, 0.20)
      : on ? Util.alpha(accent, hot ? 0.26 : 0.18)
      : hot ? Util.alpha(ink, 0.10) : Util.alpha(ink, 0.035)
    border.width: 1
    border.color: on ? accent : Util.alpha(ink, hot ? 0.55 : 0.24)
    Behavior on color { ColorAnimation { duration: Style.duration(130) } }
    Behavior on border.color { ColorAnimation { duration: Style.duration(130) } }

    Column {
      anchors.centerIn: parent
      width: parent.width - Style.space(6)
      spacing: tile.small ? Style.space(2) : Style.space(4)

      Text {
        anchors.horizontalCenter: parent.horizontalCenter
        textFormat: Text.PlainText
        text: tile.glyph
        color: tile.lamp ? (tile.on ? tile.accent : tile.ink) : (tile.hot ? tile.accent : tile.ink)
        opacity: tile.lamp && !tile.on ? 0.5 : 1
        font.family: Style.font.family
        font.pixelSize: tile.small ? Style.font.title : Style.font.iconLarge
        Behavior on color { ColorAnimation { duration: Style.duration(130) } }
      }

      Text {
        width: parent.width
        horizontalAlignment: Text.AlignHCenter
        elide: Text.ElideRight
        textFormat: Text.PlainText
        text: tile.text
        color: tile.ink
        opacity: tile.lamp && !tile.on ? 0.6 : (tile.small ? 0.85 : 1)
        font.family: Style.font.family
        font.pixelSize: tile.small ? Style.font.caption : Style.font.bodySmall
      }
    }

    Rectangle {
      visible: tile.lamp
      x: parent.width - width - Style.space(6)
      y: Style.space(6)
      width: Style.space(5)
      height: Style.space(5)
      color: tile.on ? tile.accent : "transparent"
      border.width: 1
      border.color: tile.on ? tile.accent : Util.alpha(tile.ink, 0.4)
    }

    MouseArea {
      id: tileArea
      anchors.fill: parent
      hoverEnabled: true
      cursorShape: Qt.PointingHandCursor
      onClicked: tile.picked()
    }
  }

  // One choice out of a few, side by side in a single bar. `echo` marks a
  // second one quietly: what Auto has settled on.
  component Segments: Item {
    id: bar
    property var options: []
    property string value: ""
    property string echo: ""
    signal picked(string value)

    readonly property color ink: Commons.Color.popups.text
    readonly property color accent: Commons.Color.accent

    width: parent ? parent.width : 0
    height: Style.space(28)

    Repeater {
      model: bar.options

      Rectangle {
        id: segment
        required property var modelData
        required property int index
        readonly property bool on: modelData.value === bar.value
        readonly property bool hot: segmentArea.containsMouse

        // Neighbours share a border: each starts on the last one's edge.
        x: Math.round(index * (bar.width - 1) / bar.options.length)
        width: Math.round((index + 1) * (bar.width - 1) / bar.options.length) - x + 1
        height: bar.height
        z: on ? 2 : (hot ? 1 : 0)
        color: on ? bar.accent : (segmentArea.pressed ? Util.alpha(bar.ink, 0.20) : hot ? Util.alpha(bar.ink, 0.10) : Util.alpha(bar.ink, 0.035))
        border.width: 1
        border.color: on ? bar.accent : Util.alpha(bar.ink, hot ? 0.55 : 0.24)
        Behavior on color { ColorAnimation { duration: Style.duration(130) } }

        Text {
          anchors.centerIn: parent
          width: parent.width - Style.space(6)
          horizontalAlignment: Text.AlignHCenter
          elide: Text.ElideRight
          textFormat: Text.PlainText
          text: segment.modelData.label
          color: segment.on ? Commons.Color.popups.background : bar.ink
          opacity: segment.on ? 1 : 0.85
          font.family: Style.font.family
          font.pixelSize: Style.font.bodySmall
          font.bold: segment.on
        }

        Rectangle {
          visible: !segment.on && segment.modelData.value === bar.echo
          anchors.horizontalCenter: parent.horizontalCenter
          y: parent.height - Style.space(6)
          width: Style.space(12)
          height: Math.max(1, Style.space(2))
          color: bar.accent
        }

        MouseArea {
          id: segmentArea
          anchors.fill: parent
          hoverEnabled: true
          cursorShape: Qt.PointingHandCursor
          onClicked: bar.picked(segment.modelData.value)
        }
      }
    }
  }

  // A small button; one that is a switch stays lit while it is on.
  component Chip: Rectangle {
    id: chip
    property string text: ""
    property bool on: false
    property bool small: false
    signal picked()

    readonly property color ink: Commons.Color.popups.text
    readonly property color accent: Commons.Color.accent
    readonly property bool hot: chipArea.containsMouse

    implicitWidth: chipText.implicitWidth + Style.space(small ? 10 : 16)
    implicitHeight: chipText.implicitHeight + Style.space(small ? 4 : 8)
    width: implicitWidth
    height: implicitHeight
    radius: Style.cornerRadius
    color: on ? accent : (chipArea.pressed ? Util.alpha(ink, 0.20) : hot ? Util.alpha(ink, 0.12) : Util.alpha(ink, 0.035))
    border.width: 1
    border.color: on ? accent : Util.alpha(ink, hot ? 0.55 : 0.28)
    Behavior on color { ColorAnimation { duration: Style.duration(130) } }

    Text {
      id: chipText
      anchors.centerIn: parent
      textFormat: Text.PlainText
      text: chip.text
      color: chip.on ? Commons.Color.popups.background : chip.ink
      font.family: Style.font.family
      font.pixelSize: chip.small ? Style.font.caption : Style.font.bodySmall
      font.bold: chip.on
    }

    MouseArea {
      id: chipArea
      anchors.fill: parent
      hoverEnabled: true
      cursorShape: Qt.PointingHandCursor
      onClicked: chip.picked()
    }
  }

  // A slider the way a terminal would draw one: a rule, filled as far as it
  // is set, and a bar to take hold of. `origin` is where the fill starts
  // (the middle, for something that goes both ways) and `notch` a mark on
  // the track worth knowing about, such as freezing.
  component Fader: Item {
    id: fader
    property string label: ""
    property string valueText: ""
    property real value: 0
    property real from: 0
    property real to: 1
    property real origin: from
    property real notch: NaN
    property bool muted: false
    // How wide the name is given: the panel's, so every track starts in line.
    property real labelWidth: Style.space(70)
    signal moved(real value)

    readonly property color ink: Commons.Color.popups.text
    readonly property color accent: Commons.Color.accent
    readonly property bool hot: faderArea.containsMouse || faderArea.pressed

    function share(v) { return Math.max(0, Math.min(1, (v - from) / (to - from))) }

    width: parent ? parent.width : 0
    height: Style.space(24)
    opacity: muted ? 0.5 : 1
    Behavior on opacity { NumberAnimation { duration: Style.duration(160) } }

    Text {
      id: name
      anchors.verticalCenter: parent.verticalCenter
      width: fader.labelWidth
      elide: Text.ElideRight
      textFormat: Text.PlainText
      text: fader.label
      color: fader.ink
      opacity: fader.hot ? 1 : 0.85
      font.family: Style.font.family
      font.pixelSize: Style.font.bodySmall
    }

    Item {
      id: track
      anchors.left: name.right
      anchors.right: readout.left
      anchors.rightMargin: Style.space(10)
      height: parent.height
      // The grip's middle runs from one end of this to the other.
      readonly property real lead: grip.width / 2
      readonly property real run: Math.max(1, width - grip.width)
      readonly property real at: lead + fader.share(fader.value) * run
      readonly property real home: lead + fader.share(fader.origin) * run

      Rectangle {
        x: track.lead
        anchors.verticalCenter: parent.verticalCenter
        width: track.run
        height: Style.space(4)
        color: Util.alpha(fader.ink, 0.16)
      }
      Rectangle {
        x: Math.min(track.at, track.home)
        anchors.verticalCenter: parent.verticalCenter
        width: Math.abs(track.at - track.home)
        height: Style.space(4)
        color: fader.accent
      }
      Rectangle {
        visible: !isNaN(fader.notch)
        x: track.lead + fader.share(isNaN(fader.notch) ? fader.from : fader.notch) * track.run
        anchors.verticalCenter: parent.verticalCenter
        width: 1
        height: Style.space(12)
        color: Util.alpha(fader.ink, 0.55)
      }
      Rectangle {
        id: grip
        x: track.at - width / 2
        anchors.verticalCenter: parent.verticalCenter
        width: Style.space(5)
        height: fader.hot ? Style.space(18) : Style.space(14)
        color: fader.hot ? Qt.lighter(fader.accent, 1.2) : fader.ink
        Behavior on height { NumberAnimation { duration: Style.duration(110) } }
        Behavior on color { ColorAnimation { duration: Style.duration(110) } }
      }

      MouseArea {
        id: faderArea
        anchors.fill: parent
        hoverEnabled: true
        preventStealing: true
        cursorShape: Qt.PointingHandCursor
        function set(x) {
          var at = Math.max(0, Math.min(1, (x - track.lead) / track.run))
          fader.moved(fader.from + at * (fader.to - fader.from))
        }
        onPressed: function(mouse) { set(mouse.x) }
        onPositionChanged: function(mouse) { if (pressed) set(mouse.x) }
      }
    }

    Text {
      id: readout
      anchors.right: parent.right
      anchors.verticalCenter: parent.verticalCenter
      width: Style.space(52)
      horizontalAlignment: Text.AlignRight
      textFormat: Text.PlainText
      text: fader.valueText
      color: fader.ink
      opacity: 0.75
      font.family: Style.font.family
      font.pixelSize: Style.font.bodySmall
    }
  }
}
