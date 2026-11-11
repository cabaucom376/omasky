import QtQuick
import qs.Commons
import qs.Commons as Commons
import qs.Ui

// The sky's switch: the current weather as an icon. A click steps the desktop
// back under it and another brings it forward again; a right click opens its
// control panel (quality, the demo, debug); a middle click returns it to the
// real weather.
BarWidget {
  id: root
  moduleName: "omasky"

  readonly property var service: bar && bar.shell ? bar.shell.serviceFor("omasky") : null

  Commons.Translations { id: strings; directory: Qt.resolvedUrl("i18n") }

  // The service has no shell.json entry of its own, so it takes this one's.
  function handOver() {
    if (service) service.settings = settings
  }
  onServiceChanged: handOver()
  onSettingsChanged: handOver()

  implicitWidth: button.implicitWidth
  implicitHeight: button.implicitHeight

  BarIconButton {
    id: button
    anchors.fill: parent
    bar: root.bar
    text: root.service ? root.service.glyph : ""
    active: root.service ? root.service.active : false
    tooltipText: root.service && root.service.active ? root.service.summary : strings.t("widget.tooltip")

    onPressed: function(b) {
      if (!root.service) return
      if (b === Qt.RightButton) {
        // Where this icon is along the bar, so the panel opens under it.
        var at = button.mapToItem(null, button.width / 2, 0)
        root.service.toggleControls(at ? at.x : -1)
      } else if (b === Qt.MiddleButton) {
        root.service.goLive()
      } else {
        root.service.toggle()
      }
    }
  }
}
