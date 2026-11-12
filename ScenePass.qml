import QtQuick

// One pass of shaders/scene.frag: the sky and what falls behind the windows
// (front 0), or the near clouds and the weather in front of them (front 1).
//
// The pass is drawn on a canvas `pixel` times smaller than the screen and
// scaled up without smoothing. That is the look, and it is also why this is
// cheap: a 1600x1000 screen is a 400x250 picture.
Item {
  id: pass

  // Model.sceneUniforms().scene
  required property var look
  // Model.ledgeSlots(): six ledges as [x, y, width, height], the snow lying
  // on each, how far each shelters the ground under it, and where among
  // them the places a window has left begin (ghostFrom) and the floating
  // windows begin (floatFrom).
  required property var rects
  property var depths: [0, 0, 0, 0, 0, 0]
  property var shelters: [1, 1, 1, 1, 1, 1]
  // How long the icicles under each window have grown, in pixels.
  property var ices: [0, 0, 0, 0, 0, 0]
  property real ghostFrom: 6
  property real floatFrom: 6
  // Seconds the sky has been up.
  required property real clock
  // How far each cloud lane has blown downwind, in pixels.
  required property var laneDrift
  property real front: 0
  property real pixel: 4
  property real detail: 1
  property real skyAlpha: 0.9
  property real flash: 0
  property real boltX: 0
  property real boltSeed: 1
  // The words in the corner of the sky sit over a patch of it that is
  // blurred and toned (shaders/plate.frag). This is that patch's size from
  // the pass's top left corner, or 0 for none. It is not a copy laid over
  // the sky, which would show now that the sky lets the wallpaper through:
  // it is how this pass is put on screen in that corner.
  property real plateWidth: 0
  property real plateHeight: 0
  // A second patch the same, out of the top right corner, for what is
  // written there: its size from that corner, or 0 for none.
  property real plateRightWidth: 0
  property real plateRightHeight: 0
  // How far from its corner each patch keeps its full strength: the reach
  // of what is written there. Beyond that it falls away. 0 has it falling
  // away from the corner itself.
  property real plateCoreWidth: 0
  property real plateCoreHeight: 0
  property real plateRightCoreWidth: 0
  property real plateRightCoreHeight: 0
  property bool plateBlur: true
  // How far toward `scrim` the patch goes: for the sky, which is behind the
  // windows. The pass in front thins out instead (plateFade), because a tone
  // there would fall on the windows, and guards them (plateGuard) so the
  // blur does not carry what is beside a window onto it.
  property real plateTint: 0.46
  property real plateFade: 0
  property bool plateGuard: false
  property color scrim: "black"
  readonly property bool plateOn: (plateWidth > 0 && plateHeight > 0) || (plateRightWidth > 0 && plateRightHeight > 0)

  // The deepest snow on any window, and what lies on the ground.
  property real snowDepth: 0
  property real groundDepth: 0

  readonly property size canvas: Qt.size(Math.max(1, Math.ceil(width / pixel)), Math.max(1, Math.ceil(height / pixel)))

  Component {
    id: plateEffect

    ShaderEffect {
      fragmentShader: Qt.resolvedUrl("shaders/plate.frag.qsb")
      property var source
      property real blur: pass.plateBlur ? 1 : 0
      property real tint: pass.plateTint
      property real fade: pass.plateFade
      property real guard: pass.plateGuard ? 1 : 0
      property real pixel: pass.pixel
      property real grain: pass.pixel * Screen.devicePixelRatio
      property vector4d spare: Qt.vector4d(pass.ghostFrom, pass.floatFrom, 0, 0)
      property vector4d w0: Qt.vector4d(pass.rects[0][0], pass.rects[0][1], pass.rects[0][2], pass.rects[0][3])
      property vector4d w1: Qt.vector4d(pass.rects[1][0], pass.rects[1][1], pass.rects[1][2], pass.rects[1][3])
      property vector4d w2: Qt.vector4d(pass.rects[2][0], pass.rects[2][1], pass.rects[2][2], pass.rects[2][3])
      property vector4d w3: Qt.vector4d(pass.rects[3][0], pass.rects[3][1], pass.rects[3][2], pass.rects[3][3])
      property vector4d w4: Qt.vector4d(pass.rects[4][0], pass.rects[4][1], pass.rects[4][2], pass.rects[4][3])
      property vector4d w5: Qt.vector4d(pass.rects[5][0], pass.rects[5][1], pass.rects[5][2], pass.rects[5][3])
      property vector2d canvas: Qt.vector2d(pass.canvas.width, pass.canvas.height)
      property vector2d texel: Qt.vector2d(1 / pass.canvas.width, 1 / pass.canvas.height)
      property vector2d extent: Qt.vector2d(pass.plateWidth / Math.max(1, picture.width), pass.plateHeight / Math.max(1, picture.height))
      property vector2d extentRight: Qt.vector2d(pass.plateRightWidth / Math.max(1, picture.width), pass.plateRightHeight / Math.max(1, picture.height))
      property vector2d core: Qt.vector2d(pass.plateCoreWidth / Math.max(1, picture.width), pass.plateCoreHeight / Math.max(1, picture.height))
      property vector2d coreRight: Qt.vector2d(pass.plateRightCoreWidth / Math.max(1, picture.width), pass.plateRightCoreHeight / Math.max(1, picture.height))
      property color scrim: pass.scrim
    }
  }

  Item {
    id: picture
    // Exactly canvas x pixel, so every canvas pixel lands the same size.
    width: pass.canvas.width * pass.pixel
    height: pass.canvas.height * pass.pixel
    layer.enabled: true
    // Scaled up without smoothing. With the patch on, the patch's shader
    // does the scaling itself, and needs the smoothing and the mipmaps for
    // its blur.
    layer.smooth: pass.plateOn
    layer.mipmap: pass.plateOn
    layer.effect: pass.plateOn ? plateEffect : null
    layer.textureSize: pass.canvas

    ShaderEffect {
      anchors.fill: parent
      // One shader for each pass, whatever the quality: the detail is a
      // number it is handed. Changing quality therefore compiles nothing,
      // which matters where a compile stalls the screen.
      fragmentShader: Qt.resolvedUrl("shaders/scene-" + (pass.front > 0.5 ? "front" : "back") + ".frag.qsb")

      // Rain moves fast enough to lose precision in a float within the
      // hour, so its clock wraps; nobody can see rain jump. Clouds and snow
      // would, so they keep one that does not.
      property real time: pass.clock % 512
      property real slowTime: pass.clock
      property real front: pass.front
      property real pixel: pass.pixel
      property real detail: pass.detail

      property real dayness: pass.look.dayness
      property real twilight: pass.look.twilight
      property real glowX: pass.look.glowX
      property real sunVis: pass.look.sunVis
      property real moonVis: pass.look.moonVis
      property real moonPhase: pass.look.moonPhase
      property real moonFlip: pass.look.moonFlip
      property real bodyRadius: pass.look.bodyRadius
      property real skyAlpha: pass.skyAlpha

      property real cover: pass.look.cover
      property real nearCover: pass.look.nearCover
      property real veil: pass.look.veil
      property real storm: pass.look.storm
      property real deck: pass.look.deck
      property real shine: pass.look.shine

      property real coverHigh: pass.look.coverHigh
      property real hail: pass.look.hail
      property real gust: pass.look.gust
      property real thaw: pass.look.thaw
      property real rainbow: pass.look.rainbow
      property real bowX: pass.look.bowX
      property real bowY: pass.look.bowY
      property real bowR: pass.look.bowR
      property real bowSide: pass.look.bowSide
      property real halo: pass.look.halo
      property real aurora: pass.look.aurora
      property real fireflies: pass.look.fireflies
      property real rain: pass.look.rain
      property real snow: pass.look.snow
      property real fog: pass.look.fog
      property real wind: pass.look.wind
      property real flash: pass.flash
      property real boltX: pass.boltX
      property real boltSeed: pass.boltSeed
      property real snowDepth: pass.snowDepth
      property real groundDepth: pass.groundDepth

      property vector2d canvas: Qt.vector2d(pass.canvas.width, pass.canvas.height)
      property vector2d sunPos: Qt.vector2d(pass.look.sunPos[0], pass.look.sunPos[1])
      property vector2d moonPos: Qt.vector2d(pass.look.moonPos[0], pass.look.moonPos[1])
      property vector2d lightPos: Qt.vector2d(pass.look.lightPos[0], pass.look.lightPos[1])
      property vector4d laneDrift: Qt.vector4d(pass.laneDrift[0], pass.laneDrift[1], pass.laneDrift[2], 0)
      property vector4d w0: Qt.vector4d(pass.rects[0][0], pass.rects[0][1], pass.rects[0][2], pass.rects[0][3])
      property vector4d w1: Qt.vector4d(pass.rects[1][0], pass.rects[1][1], pass.rects[1][2], pass.rects[1][3])
      property vector4d w2: Qt.vector4d(pass.rects[2][0], pass.rects[2][1], pass.rects[2][2], pass.rects[2][3])
      property vector4d w3: Qt.vector4d(pass.rects[3][0], pass.rects[3][1], pass.rects[3][2], pass.rects[3][3])
      property vector4d w4: Qt.vector4d(pass.rects[4][0], pass.rects[4][1], pass.rects[4][2], pass.rects[4][3])
      property vector4d w5: Qt.vector4d(pass.rects[5][0], pass.rects[5][1], pass.rects[5][2], pass.rects[5][3])
      property vector4d depthA: Qt.vector4d(pass.depths[0], pass.depths[1], pass.depths[2], pass.depths[3])
      property vector4d depthB: Qt.vector4d(pass.depths[4], pass.depths[5], pass.floatFrom, pass.ghostFrom)
      property vector4d shelterA: Qt.vector4d(pass.shelters[0], pass.shelters[1], pass.shelters[2], pass.shelters[3])
      property vector4d shelterB: Qt.vector4d(pass.shelters[4], pass.shelters[5], 0, 0)
      property vector4d iceA: Qt.vector4d(pass.ices[0], pass.ices[1], pass.ices[2], pass.ices[3])
      property vector4d iceB: Qt.vector4d(pass.ices[4], pass.ices[5], 0, 0)

      property color skyTop: pass.look.skyTop
      property color skyBottom: pass.look.skyBottom
      property color glowColor: pass.look.glowColor
      property color sunColor: pass.look.sunColor
      property color sunCore: pass.look.sunCore
      property color moonColor: pass.look.moonColor
      property color starColor: pass.look.starColor
      property color cloudLight: pass.look.cloudLight
      property color cloudShade: pass.look.cloudShade
      property color hazeColor: pass.look.hazeColor
      property color lightColor: pass.look.lightColor
      property color rainColor: pass.look.rainColor
      property color snowColor: pass.look.snowColor
      property color shadeColor: pass.look.shadeColor
      property color fogColor: pass.look.fogColor
      property color flashColor: pass.look.flashColor
      property color bowOuter: pass.look.bowOuter
      property color bowMiddle: pass.look.bowMiddle
      property color bowInner: pass.look.bowInner
      property color auroraLow: pass.look.auroraLow
      property color auroraHigh: pass.look.auroraHigh
      property color fireflyColor: pass.look.fireflyColor
    }
  }
}
