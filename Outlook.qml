import QtQuick
import qs.Commons
import qs.Commons as Commons
import "Model.js" as Model

// The days ahead, in the opposite corner of the sky from the words: each
// with its weather, its high and its low, as Omarchy's own weather panel has
// them. It is the second level of the corner info, with the detail that
// joins the words (Readout.qml).
Row {
  id: outlook

  // Service.qml's root.
  required property var service
  // The tone that reads against the sky this is in.
  property color ink: "white"

  readonly property var ahead: service.outlook && service.outlook.next ? service.outlook.next : []

  spacing: Style.space(24)

  Repeater {
    model: outlook.ahead

    Row {
      id: day
      required property var modelData
      spacing: Style.space(9)

      Text {
        anchors.verticalCenter: parent.verticalCenter
        textFormat: Text.PlainText
        text: Model.glyphFor(Model.weatherFromCode(day.modelData.code), false)
        color: outlook.ink
        font.family: Style.font.family
        font.pixelSize: Style.font.display
      }

      Column {
        anchors.verticalCenter: parent.verticalCenter
        spacing: Style.space(2)

        Text {
          textFormat: Text.PlainText
          text: Qt.locale(Commons.I18n.formatLocale).standaloneDayName(day.modelData.weekday, Locale.ShortFormat).toUpperCase()
          color: outlook.ink
          opacity: 0.62
          font.family: Style.font.family
          font.pixelSize: Style.font.caption
          font.letterSpacing: 1.2
        }

        Row {
          spacing: Style.space(6)

          Text {
            textFormat: Text.PlainText
            text: outlook.service.degreesText(day.modelData.high)
            color: outlook.ink
            font.family: Style.font.family
            font.pixelSize: Style.font.body
          }
          Text {
            textFormat: Text.PlainText
            text: outlook.service.degreesText(day.modelData.low)
            color: outlook.ink
            opacity: 0.6
            font.family: Style.font.family
            font.pixelSize: Style.font.body
          }
        }
      }
    }
  }
}
