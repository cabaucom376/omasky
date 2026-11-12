import QtQuick
import QtMultimedia
import "Model.js" as Model

// The sky's sound: rain, wind and thunder, each as loud as there is of it.
//
// It is loaded only when sound is switched on and the sky is up, and on its
// own, because it needs Qt's multimedia module: the shell does not, so a
// machine without it loses the sound and nothing else (see the Loader in
// Service.qml).
//
// The sounds are short loops made by tools/sounds.py. Snow falls silent.
// Everything follows the sky in and out, and goes with the weather when the
// weather is switched off.
Item {
  id: sound

  // Service.qml's root.
  property var service: null
  // Everything running but nothing heard: for trying it out.
  property bool muted: false
  // Whether the sounds have loaded, and whether any is to be heard now.
  readonly property bool ready: rain.status === SoundEffect.Ready && wind.status === SoundEffect.Ready && thunder.status === SoundEffect.Ready
  readonly property bool broken: rain.status === SoundEffect.Error || wind.status === SoundEffect.Error || thunder.status === SoundEffect.Error
  readonly property bool playing: rain.playing || wind.playing || thunder.playing

  // How loud the whole is: the setting, by how far the sky is up and how
  // much of the weather is showing.
  readonly property real master: service ? service.soundVolume * service.presence * service.weatherShare : 0
  readonly property var levels: Model.soundLevels(service ? service.weather : null)
  // Loudness is heard by its square, more or less: halfway up the control
  // should sound like half.
  readonly property real rainLevel: master * levels.rain * levels.rain
  readonly property real windLevel: master * levels.wind * levels.wind

  // A loop runs only while there is something of it to hear.
  function keep(effect, level) {
    if (level > 0.003 && !effect.playing) effect.play()
    else if (level <= 0.003 && effect.playing) effect.stop()
  }
  onRainLevelChanged: keep(rain, rainLevel)
  onWindLevelChanged: keep(wind, windLevel)
  Component.onCompleted: {
    keep(rain, rainLevel)
    keep(wind, windLevel)
  }

  SoundEffect {
    id: rain
    source: Qt.resolvedUrl("sounds/rain.wav")
    muted: sound.muted
    loops: SoundEffect.Infinite
    volume: Math.min(1, sound.rainLevel)
  }

  SoundEffect {
    id: wind
    source: Qt.resolvedUrl("sounds/wind.wav")
    muted: sound.muted
    loops: SoundEffect.Infinite
    volume: Math.min(1, sound.windLevel)
  }

  // Thunder follows its lightning by a moment, a different one each time,
  // the way it does from a strike a little way off.
  SoundEffect {
    id: thunder
    source: Qt.resolvedUrl("sounds/thunder.wav")
    muted: sound.muted
  }
  Timer {
    id: roll
    onTriggered: {
      if (sound.master <= 0.003) return
      thunder.volume = Math.min(1, sound.master * (0.65 + 0.35 * Math.random()))
      thunder.play()
    }
  }
  Connections {
    target: sound.service
    function onStruck() {
      roll.interval = 200 + Math.random() * 1500
      roll.restart()
    }
  }
}
