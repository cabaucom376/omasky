import QtQuick
import qs.Commons
import qs.Commons as Commons
import "Model.js" as Model

// The words in a corner of the sky. At the first level: how warm it is and
// what it is doing, and under that where, and when the sun next comes or
// goes. At the second, as Omarchy's own weather panel has them: how it
// feels, the wind, the humidity and today's high and low. (The days ahead
// are the second level too; they go in the opposite corner: Outlook.qml.)
//
// The detail goes under the words where there is room (stacked), and beside
// them, along the top of the sky, where there is not: it is drawn over the
// windows' surface, and must not sit on a window.
Grid {
  id: readout

  // Service.qml's root, and its Commons.Translations.
  required property var service
  required property var words
  // Model.celestial() for the sky this is in.
  required property var sky
  // The tone that reads against that sky.
  property color ink: "white"
  property bool stacked: true

  // How far the detail is showing, 0..1.
  readonly property real detail: service.detailShare
  // The detail is the real weather as last read: how it is now. So it is
  // left out while the sky is not the real one (the demo, a preview, set by
  // hand), where the words above it are not the real weather either.
  readonly property bool real: service.mode === "live" && !!service.forecast
  readonly property var today: service.outlook ? service.outlook.today : null
  // How tall it is with the detail under the words, whichever way it is
  // laid out now: what decides whether there is room to stack it.
  readonly property real tallHeight: head.implicitHeight + (real ? stats.implicitHeight + rowSpacing : 0)
  // And how wide with the detail beside them.
  readonly property real wideWidth: head.implicitWidth + (real ? stats.implicitWidth + columnSpacing : 0)

  columns: stacked ? 1 : 2
  rowSpacing: Style.space(12)
  columnSpacing: Style.space(40)
  verticalItemAlignment: Grid.AlignVCenter

  Column {
    id: head
    spacing: Style.space(2)

    Text {
      textFormat: Text.PlainText
      text: (readout.service.temperatureText ? readout.service.temperatureText + "  " : "") + readout.service.conditionText
      color: readout.ink
      font.family: Style.font.family
      font.pixelSize: Style.font.display
    }

    // Where, or which mode the sky is in when it is not the real one; the
    // moon by night, lit as far as it is; and when the sun next comes up
    // or goes down. Each with a small picture of what it is.
    Row {
      spacing: Style.space(16)

      Note {
        ink: readout.ink
        glyph: readout.service.mode === "demo" ? "\uf04b"
          : readout.service.mode === "manual" ? "\uf1de"
          : readout.service.mode === "preview" ? "\uf06e"
          : readout.service.location.name ? "\uf041" : "\uf071"
        text: readout.service.mode === "demo" ? readout.words.t("info.demo")
          : readout.service.mode === "manual" ? readout.words.t("info.manual")
          : readout.service.mode === "preview" ? readout.words.t("info.preview")
          : readout.service.location.name ? readout.service.location.name
          : (readout.service.forecastFailed && !readout.service.forecast ? readout.words.t("info.offline") : "")
      }
      // With the hour set, the weather is that hour's forecast: said here,
      // so it is not taken for now.
      Note {
        ink: readout.ink
        glyph: "\uf017"
        text: readout.service.mode === "live" ? readout.service.forecastNote : ""
      }
      Note {
        ink: readout.ink
        visible: !readout.sky.isDay
        glyph: Model.moonGlyph(readout.sky.moon.phase)
        text: readout.words.t("moon." + readout.sky.moon.key)
      }
      Note {
        ink: readout.ink
        glyph: readout.sky.isDay ? "\ue34d" : "\ue34c"
        text: readout.words.t(readout.sky.isDay ? "info.sunset" : "info.sunrise").arg(readout.service.clockText(readout.sky.end))
      }
    }
  }

  // Now: how it feels, the wind, the humidity, and today's high and low.
  // It opens downward where it is stacked and sideways where it is not.
  Item {
    visible: readout.real && readout.detail > 0.002
    width: stats.implicitWidth * (readout.stacked ? 1 : readout.detail)
    height: stats.implicitHeight * (readout.stacked ? readout.detail : 1)
    opacity: readout.detail
    clip: true

    Row {
      id: stats
      spacing: Style.space(24)

      Stat { ink: readout.ink; glyph: "\ue350"; label: readout.words.t("info.feels"); value: readout.service.feelsText }
      Stat { ink: readout.ink; glyph: "\ue34b"; label: readout.words.t("info.wind"); value: readout.service.windText }
      Stat { ink: readout.ink; glyph: "\ue373"; label: readout.words.t("info.humid"); value: readout.service.humidityText }
      Stat {
        ink: readout.ink
        glyph: "\uf07d"
        label: readout.words.t("info.today")
        value: readout.today ? readout.service.degreesText(readout.today.high) : ""
        second: readout.today ? readout.service.degreesText(readout.today.low) : ""
      }
    }
  }

  // A few words with a small picture of what they are about before them.
  component Note: Row {
    id: note
    property color ink: "white"
    property string glyph: ""
    property string text: ""

    visible: text !== ""
    spacing: Style.space(6)

    Text {
      anchors.verticalCenter: parent.verticalCenter
      textFormat: Text.PlainText
      text: note.glyph
      color: note.ink
      opacity: 0.72
      font.family: Style.font.family
      font.pixelSize: Style.font.title
    }
    Text {
      anchors.verticalCenter: parent.verticalCenter
      textFormat: Text.PlainText
      text: note.text
      color: note.ink
      opacity: 0.72
      font.family: Style.font.family
      font.pixelSize: Style.font.title
    }
  }

  // One reading: a picture of what it is, and beside that its name in small
  // capitals over its value, the way a day of the forecast is laid out.
  // `second` is a quieter value beside the first, for a pair such as a high
  // and a low.
  component Stat: Row {
    id: stat
    property color ink: "white"
    property string glyph: ""
    property string label: ""
    property string value: ""
    property string second: ""

    visible: value !== ""
    spacing: Style.space(8)

    Text {
      visible: stat.glyph !== ""
      anchors.verticalCenter: parent.verticalCenter
      textFormat: Text.PlainText
      text: stat.glyph
      color: stat.ink
      font.family: Style.font.family
      font.pixelSize: Style.font.display
    }

    Column {
      anchors.verticalCenter: parent.verticalCenter
      spacing: Style.space(2)

      Text {
        textFormat: Text.PlainText
        text: stat.label.toUpperCase()
        color: stat.ink
        opacity: 0.62
        font.family: Style.font.family
        font.pixelSize: Style.font.caption
        font.letterSpacing: 1.2
      }

      Row {
        spacing: Style.space(6)

        Text {
          textFormat: Text.PlainText
          text: stat.value
          color: stat.ink
          font.family: Style.font.family
          font.pixelSize: Style.font.body
        }
        Text {
          visible: stat.second !== ""
          textFormat: Text.PlainText
          text: stat.second
          color: stat.ink
          opacity: 0.6
          font.family: Style.font.family
          font.pixelSize: Style.font.body
        }
      }
    }
  }
}
