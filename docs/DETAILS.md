# Omasky in detail

What the [README](../README.md) leaves out: everything the weather does, how
the workspace stays a real one, the control panel and the quality levels at
length, how it is kept smooth, and how to work on it.

## What the weather does

- **Sun and moon** ride an arc over the desktop by the clock: up from the
  bottom of the screen beside it at sunrise, over the top, down the far side
  at sunset. The moon shows its real phase.
- **Clouds** are real ones, lit from where the sun or moon actually is, and
  they cross at the speed the wind is blowing.
- **Rain and snow** fall out of those clouds and nowhere else, and how hard
  they fall has nothing to do with how many clouds there are. A lone cloud
  can pour while the sun shines beside it; a sky packed with cloud from
  edge to edge, where neither sun nor moon shows, is a monsoon or a
  blizzard. Lightning only ever comes out of a cloud too: a bare sky cannot
  strike.
- **The temperature decides what falls.** There is one amount of
  precipitation; above a couple of degrees it is rain, at freezing and
  below it is snow, and on the line it is sleet, drops and flakes together.
  It decides what becomes of it too: lying snow goes in the warm, faster the
  warmer it is, dripping off the windows as it does, and in the cold it
  stays where it fell after the snow has stopped.
- **Ice.** Below freezing, water running off a window's bottom edge freezes
  there: icicles grow under the windows while there is snow on them to melt
  or rain to feed them, fastest in freezing rain. They break off when a
  window is moved away, and drip and shrink in a thaw.
- **Hail** comes with the storms that carry it: hard stones, faster than
  rain, that bounce off the windows instead of splashing.
- **The wind is a force.** It comes in gusts, which sweep rain and snow into
  bands; it leans lying snow into drifts, deep at the end of a window it
  blows toward and scoured thin at the other; and a gale drives snow across
  rather than down, which is a blizzard.
- **Cloud has heights.** Where the weather service says how much cloud is
  low, middle and high, each lane has its own: high cloud is thin wisps, and
  only the low cloud rains.
- **Fog** rolls in around the windows, as thick as the visibility says it
  is. **A really hot day** bends the background, the wallpaper and the sky
  over it, in heat waves that rise off the ground; the windows stay straight.
- **And now and then:** a rainbow when a shower is falling and the sun is
  low, on the far side of the sky from it; a ring round the moon through
  thin high cloud; a shooting star on a clear night.
- **The weather is not drawn on your windows.** It lands on them, lies on
  them, hangs beside them and runs off them, but what is in a window is
  left as it is: no rain across it, no fog over it. The one thing that
  crosses the line is a fringe of the snow lying on a window, a pixel or two
  of it spilling over the top edge.
- **At high quality the weather is physical.** Each drop falls until it meets
  the top of whichever window is under it, splashes, runs along the edge and
  drips off the sides. Snow piles up on the windows, faster the harder it
  falls, and does not stop at their edges: it spills a little over the top
  edge, hangs over the sides, slides down the gap between two windows, and
  what rolls off drifts into deeper mounds on whatever is below, a lower
  window or the ground.
- **Snow answers to what you do.** Each window carries its own. Move or
  resize one and its snow is shaken off, then falls again; send it somewhere
  else, or close it, and what lay on it is left hanging for a moment and
  melts where it was. A floating window hides the snow of whatever it lies
  over.
- Everything is drawn on a small canvas in the current theme's colors: hard
  edges, a few flat tones joined by ordered dither, motion in whole pixels.

## The workspace

The conditions sit in the top left corner: how warm it is and what it is
doing, where, and when the sun next comes up or goes down. Asked for more,
they add how it feels, the wind, the humidity and today's high and low, and
the next four days go in the top right corner, as Omarchy's own weather
panel shows them. What is written in a corner sits over a patch of the sky
that is blurred and toned toward the text's opposite, at its strongest under
the words and fading out around them, so they read against any weather
without a box around them. Rain, snow and fog crossing a corner are blurred
with it and thinned out toward the words.

**The workspace is the real one.** While the sky is up, four invisible
strips along the screen's edges each keep a margin to themselves, the way a
bar does, so Hyprland lays the windows out in a smaller frame and nothing
else about them changes: the keyboard and the pointer reach them as usual,
in every layout. The sky is drawn on a layer under the windows and the
weather that meets them on a layer over them, and that one lets the pointer
straight through everywhere but on its own control panel. Tiled and
scrolling layouts step back into the frame. A floating workspace has no
frame: its windows stay where you put them, its dock stays along the bottom
of the screen, and the weather finds the windows where they are.

Because they are real windows, they are made smaller rather than scaled:
a terminal has fewer columns, not smaller letters. Hyprland cannot draw live
windows at another scale and still deliver the pointer to them.

Getting there and back is a glide: for about half a second a still of each
window crosses from where it was to where it now is, then the stills are put
away.

Nothing you do in the workspace closes the sky. **The bar icon, or
`omarchy-shell omasky toggle`, brings the desktop back.**

## On a key, and in the Omarchy menu

To put the sky on a key, add a line to
`~/.config/hypr/bindings.lua`:

    o.bind("SUPER + SHIFT + W", "Weather sky", "omarchy-shell omasky toggle")

And to have it in the Omarchy menu (Super+Space), add a row to
`~/.config/omarchy/extensions/omarchy-menu.jsonc`, inside the braces:

    "trigger.weather-sky": {"icon":"","label":"Weather Sky","description":"The weather, around your desktop","action":"omarchy-shell omasky toggle"},

## The control panel

From the top:

- **The sky, small.** A miniature of the sky as it is now, drawn by the same
  shaders as the real one over your wallpaper, so it answers to everything
  below it. Under it, what it is doing out there and the hour the sky is
  showing, and the place the weather is for. **Press the place to change
  it**: type a city, pick one of the places the name finds (arrow keys and
  Enter, or the pointer), and that is where the weather is for from then
  on. **Auto** goes back to wherever this network is. It is Omarchy's own
  weather location, the one its weather widget uses, so the two agree.
- **The day, as a ruler.** The twenty-four hours with the day lit between
  sunrise and sunset and a needle at the hour. Drag it to set the hour;
  **Real time** puts it back. The day is today's real one, with the sunrise
  and sunset the forecast gives, in every mode but the demo, so the sun and
  moon are in the same place at the same hour whether the sky is live or
  set by hand. The demo keeps a day of its own, half past six to half past
  six.
- **Two switches**, each on its own:
  - **Weather**: clouds, rain, snow, hail, fog, wind, heat, and what lies and
    hangs on the windows. Off, the sky is clear and still whatever it is
    doing outside.
  - **Day & night**: the sun and moon on their arc, the stars, and the color
    of the sky by the hour. Off, the weather is shown in a plain daylight
    that never changes, over the wallpaper as it is.

  With both off, what is left is the frame.
- **Corner info**, at one of three levels:
  - **Off**.
  - **Simple**: the temperature and what it is doing, top left, with the
    place and when the sun next comes up or goes down.
  - **Detailed**: with those, how it feels, the wind, the humidity and
    today's high and low; and in the top right corner the next four days,
    each with its weather, its high and its low. This is what Omarchy's own
    weather panel shows. The detail is the real weather, so in the demo or
    with the sky set by hand only the days ahead are shown.
- **Mode**: **Live** is the real weather at the real time. **Demo** is a day
  and a night in a minute and a half, with weather to suit each hour: dawn,
  showers, a heat wave, a thunderstorm, sunset, snow, fog. **By hand** takes
  the sky as it stands and keeps it until something is changed.
- **Quality**: auto, low, medium, high or ultra (below).
- **Set it by hand**, folded away until asked for: presets, then sliders for
  clouds, precipitation, temperature, fog, wind (either way) and the moon's
  phase, switches for thunder and hail, and a button to strike now. There is
  no rain or snow slider: precipitation says how hard, temperature says
  what, and the rest (melting, icicles, heat waves) follows from it. It also
  shows frames a second and how the last glide went. Touching anything here
  takes the sky off the real weather until Live is picked again, and turns
  on whichever of the switches it needs to be seen.

## Quality

| | Low | Medium | High | Ultra |
|---|---|---|---|---|
| Weather moves, times a second | 30 | 60 | 60 | every frame |
| Pixel of clouds, sun, moon, lying snow | 5 | 4 | 4 | 2 |
| Pixel of rain, snow, stars, lightning | 5 | 4 | 4 | 4 |
| Weather in front of the windows | no | yes | yes | yes |
| Heat waves bend the background on a hot day | no | yes | yes | yes |
| Hail, gusts, a rainbow, a moon ring, shooting stars | no | yes | yes | yes |
| Hail bouncing off windows, icicles, meltwater dripping | no | no | yes | yes |
| Rain landing on windows, running off; snow piling on them | no | no | yes | yes |
| A second sheet of rain and of snow | no | no | no | yes |
| Depth: a fine, faint far layer of rain and of snow behind the rest | no | no | no | yes |
| Gusts, drops that catch the light, crown splashes, drifting spray | no | no | no | yes |
| Tumbling flakes, and lying snow that sparkles | no | no | no | yes |

Quality changes what a frame costs, not how many there are: the sky is
drawn once for every frame the screen shows, so the screen's refresh rate is
the ceiling at any setting, and low reaches it on less. The control panel's
by-hand section shows the frames actually reaching the screen.

Ultra spends its extra on smoothness, on shapes and on depth, not on making
the rain finer. The rain and snow nearest you stay as chunky as they are on
high, because drawn finer they turn into hairlines and stop looking like the
rest of the picture; what ultra adds is everything around them.

Left on `auto`, which is how it comes, the plugin goes by what the machine
has: low for a software renderer, two cores or under 3.5 GiB; medium for a
virtual machine's GPU, under six cores or under 7 GiB; high otherwise. It
never picks ultra. Choosing one in the panel keeps it, and Auto there goes
back to the machine's own.

## How it stays smooth

- The weather is a picture a quarter of the screen's size each way (a fifth
  on low), scaled up without smoothing. That is the look, and it makes a
  frame cost about a sixteenth of what full resolution would.
- The windows are moved once. Hyprland lays them out in the frame in one
  step, hidden under the glide's stills, so no application has to lay itself
  out again and again while things move.
- Once the glide is over nothing of the windows is copied or redrawn by the
  plugin at all: they are Hyprland's, at whatever rate they draw.
- Shaders are compiled ahead of time. Each screen keeps one transparent pixel
  of each of the scene's two surfaces alive in a corner; when the shell
  starts they draw the weather into those pixels once, which compiles the
  shaders, and they stay compiled. They take no input and are not redrawn
  after that. Showing the sky only has to make the surfaces big. (Compiling
  on demand cost about two seconds on a virtual machine's GPU, every time
  the sky had been off for a while.)
- One shader serves every quality: the quality is a number it is handed, and
  what a lower quality leaves out is skipped as it runs. Changing quality in
  the panel therefore compiles nothing. (A shader for each quality was
  smaller, but meant a compile, and on a slow GPU path a stalled screen, the
  first time each was picked.)
- Whatever the shader asks of each window, each lane of clouds or each sheet
  of rain is a loop, not the same code written out once for each. The
  picture is the same either way, but a slow GPU path takes far longer than
  six times as long over six times the code: written out, the shader in
  front of the windows took 26 seconds to compile on a virtual machine's GPU
  and stalled the whole screen while it did; as loops it takes about two.
- The shader draws on two grids: shapes on the canvas, however fine the
  quality makes it, and everything that falls or flashes on a grid that is
  never finer than four pixels.
- A small copy of the wallpaper stays decoded, so nothing waits on an image.
- The glide waits until the scene's own surface has put a few frames on
  screen, then moves once a frame from the frame clock.

## What it changes, and how it is undone

Nothing in Hyprland's configuration. The frame is made of the plugin's own
layer surfaces, so the windows have their room back the moment those go:
when the sky is switched off, when the plugin is unloaded, or if the shell
itself stops.

`omarchy-shell omasky status` reports how the last entry went: `entry` is
milliseconds from the request to staging, first frame and the start of the
glide; `glide` is frames drawn and the slowest one; `hitch` is the slowest
frame of the last few seconds. The panel's by-hand section shows the same.

## Working on it

The repository is the plugin: `manifest.json` and the code are at the top,
which is what `omarchy plugin add` expects. `tools/` and `test/` are for
working on it and are not loaded by the shell.

    tools/dev-install.sh          # put this checkout into the running shell
    tools/build-shaders.sh        # compile shaders/*.frag (needs qsb: omarchy pkg add qt6-shadertools)
    node test/model.test.js       # the scene's arithmetic
    tools/load.sh                 # load the plugin on its own, unseen, and print anything it complains about
    tools/sheet.sh out.png 2 "--weather storm --hour 16 --flash 0.9" "--weather snow --hour 21 --windows two"
    tools/panel.sh out.png rain,night,tune   # draw the control panel offscreen, in a few states
    tools/icon.py icon docs/icon.svg icon.ppm # draw the icon again, or `social` for the banner (see the top of the file)
    omarchy plugin validate .     # what `omarchy plugin add` will check

`tools/dev-install.sh` is for while the code is changing. It puts the code
in a folder named for its own contents and points the manifest there, so
every change is read fresh: the shell keeps compiled QML by file path for as
long as it runs, and code written over the same paths would go on running
the old version. `tools/dev-uninstall.sh` takes it out again. The compiled
shaders (`shaders/*.qsb`) are kept in the repository, because nobody adding
the plugin has the shader baker; rebuild and commit them when a `.frag`
changes.

`tools/sheet.sh` renders the shaders offscreen through the GPU into a contact
sheet, with the same numbers the plugin would use, so the look can be tuned
without taking over the screen. The windows are plain boxes there. `--plate`
adds the patch behind the corner text, read back from the sky drawn under
it; `--windows float --float-from 2` puts a floating window over two tiled
ones, `--depths 26,3,14` gives each window its own snow, `--clouds 0.1
--rain 1` sets how many clouds there are and how hard it falls apart from
each other, and `--temp -6 --ices 22,15 --hail 1 --gust 1 --high 0.7` set
the temperature, the icicles under each window, hail, gustiness and high
cloud.

`tools/panel.sh` does the same for the control panel: a throwaway Quickshell
draws `Controls.qml` in the current theme, with a stand-in for the service
(`tools/panel.qml`), and saves it as a picture without anything appearing on
screen. `PANEL_FLAT=1` leaves the miniature sky out, so that no shader is
compiled.

The pieces: `Model.js` decides everything (sun and moon, weather, theme
palette, quality, the frame, the snow and ice on each window); `Service.qml`
shows it; `Controls.qml` is the panel; `Readout.qml` and `Outlook.qml` are
the words in the top corners of the sky; `ScenePass.qml` is one pass of the
weather; `shaders/scene.frag` paints it, built twice over (once for each
pass), with `common.glsl` holding where the clouds are so rain falls from
exactly the clouds that are drawn.

`omarchy-shell omasky status` also lists `windows`, what the weather is
landing on, and `lingering`, closed windows the shell still listed and that
were left out: the first thing to look at if weather sits where no window is.
