#version 440

// Omasky's weather, as pixel art in the theme's colors.
//
// Everything is drawn on a small canvas (one canvas pixel is `pixel` logical
// pixels square) and scaled up without smoothing, so edges are hard, shading
// is a few flat tones joined by ordered dither, and motion moves in whole
// pixels. Two passes share this file so the desktop can sit between them:
//
//   front 0  the sky, stars, sun or moon, the far clouds, the overcast sheet,
//            and the rain and snow that fall behind the windows
//   front 1  the near clouds the weather falls from, lightning, the rain and
//            snow that meet the windows, fog, and the flash of a strike
//
// At detail 2 the weather is physical: each drop falls until it meets the top
// of whichever window is under it, splashes, runs along the edge and drips
// off the sides; snow piles up on the windows and the ground.
//
// At detail 3 there is more of everything that falls, on a finer canvas.
//
// tools/build-shaders.sh compiles this file twice, once for each pass (the
// second with FRONT_PASS defined), so neither shader carries the other
// pass. The detail is not compiled in: see DETAIL_1 below.
//
// Positions arrive in logical pixels; the canvas is `canvas` pixels across.

// The quality is a number this shader is handed (u.detail: 0 low, 1 medium,
// 2 high, 3 ultra), not something it is built for. One shader serves them
// all, so changing quality compiles nothing: on a slow GPU path a compile
// stalls the whole screen for seconds, and a shader for each quality meant
// one such stall the first time each was picked. What a lower quality
// leaves out is skipped as it runs.
#define DETAIL_1 (u.detail > 0.5)
#define DETAIL_2 (u.detail > 1.5)
#define DETAIL_3 (u.detail > 2.5)

layout(location = 0) in vec2 qt_TexCoord0;
layout(location = 0) out vec4 fragColor;

layout(std140, binding = 0) uniform buf {
    mat4 qt_Matrix;
    float qt_Opacity;

    float time;         // wraps every few minutes: rain, splashes, drips
    float slowTime;     // never wraps: clouds, snow, fog, stars
    float front;        // which pass
    float pixel;        // logical pixels to a canvas pixel
    float detail;       // 0 low, 1 medium, 2 high

    float dayness;      // 0 night .. 1 day
    float twilight;     // warm glow where the sun meets the horizon
    float glowX;        // where along the bottom that glow pools
    float sunVis;
    float moonVis;
    float moonPhase;    // 0 new, 0.5 full
    float moonFlip;     // 1 north of the equator, -1 south
    float bodyRadius;   // of the sun and moon
    float skyAlpha;     // how much of the wallpaper the sky covers: little on a fair day

    float cover;        // how much sky the far clouds fill
    float nearCover;    // the same for the near lane, kept up while it rains
    float veil;         // the sheet that closes an overcast sky
    float storm;
    float deck;         // y of the desktop's top edge; clouds stay above it
    float shine;        // how strongly the sun or moon lights the clouds

    float rain;
    float snow;
    float fog;
    float wind;         // signed, -1..1
    float flash;        // lightning, 0..1
    float boltX;
    float boltSeed;
    float snowDepth;    // the deepest snow lying on any window
    float groundDepth;  // and what lies along the bottom of the screen
    float coverHigh;    // how much sky the far lane's high, thin cloud fills
    float hail;         // 0..1
    float gust;         // how unevenly the wind blows, 0..1
    float thaw;         // how fast lying snow is going, 0..1
    float rainbow;      // 0..1
    float bowX;         // the middle of its circle
    float bowY;
    float bowR;         // and how far out its inmost band runs
    float bowSide;      // which half is away from the sun: -1 left, 1 right
    float halo;         // a ring round the moon, 0..1
    float aurora;       // the northern lights, 0..1
    float fireflies;    // 0..1

    vec2 canvas;
    vec2 sunPos;
    vec2 moonPos;
    vec2 lightPos;
    vec4 laneDrift;     // how far each cloud lane has blown downwind
    // The windows, as they lie once the desktop has stepped back:
    // x, y, width, height. A width of 0 is no window.
    vec4 w0;
    vec4 w1;
    vec4 w2;
    vec4 w3;
    vec4 w4;
    vec4 w5;
    // How deep the snow lies on each of them, in logical pixels: w0..w3,
    // then w4 and w5. Each window has its own, because snow that is
    // disturbed melts and has to fall again. They come in drawing order:
    // tiled windows, then places where a window was and its snow is still
    // melting, then floating windows. depthB.w is the first of those places
    // and depthB.z the first floating window; the places between the two
    // are not windows, only snow.
    vec4 depthA;
    vec4 depthB;
    // How far each keeps the snow off the ground beneath it, 0..1.
    vec4 shelterA;
    vec4 shelterB;
    // How long the icicles under each have grown, in logical pixels.
    vec4 iceA;
    vec4 iceB;

    vec4 skyTop;
    vec4 skyBottom;
    vec4 glowColor;
    vec4 sunColor;
    vec4 sunCore;
    vec4 moonColor;
    vec4 starColor;
    vec4 cloudLight;
    vec4 cloudShade;
    vec4 hazeColor;
    vec4 lightColor;
    vec4 rainColor;
    vec4 snowColor;
    vec4 shadeColor;
    vec4 fogColor;
    vec4 flashColor;
    // A rainbow, outside in.
    vec4 bowOuter;
    vec4 bowMiddle;
    vec4 bowInner;
    // The northern lights, from their hem up; and a firefly.
    vec4 auroraLow;
    vec4 auroraHigh;
    vec4 fireflyColor;
} u;

#include "common.glsl"

// The scene's size in logical pixels.
vec2 SCENE;

// The picture is drawn on two grids. Shapes (clouds, the sun and moon, lying
// snow, the dither of the sky and fog) use the canvas, however fine it is.
// Everything that falls or flashes (rain and its splashes, snowflakes, stars,
// lightning) stays on the art's own grid of four logical pixels, because a
// finer one turns rain into hairlines and that is not the style. ART is that
// grid's cell; it only grows, to match a canvas coarser than it.
float ART;

// GRID is the cell of whichever grid is being drawn on, and K how many of
// its cells make four logical pixels: sizes and speeds given in cells are
// multiplied by K, so the same weather shows on either.
float GRID;
float K;

// The height the clouds are sized against. It is the scene's where the sky
// has a third of the screen above the windows, and less where the windows
// keep more of the screen and leave it a shorter sky, so the clouds fit the
// sky they are in instead of running off the top of it.
float SKY;

void useGrid(float cell) {
    GRID = cell;
    K = 4.0 / cell;
}

// The windows, and what is on each: its lying snow (LIES), how far it keeps
// the snow off the ground under it (KEEPS) and the icicles under it (ICE).
// They arrive as six separate uniforms because that is what a ShaderEffect
// can set, and are put in arrays here so that anything asked of "each
// window" is a loop. Written out six times instead, and those inside one
// another, the shader came to several times the size, and a slow GPU takes
// far more than several times as long to build it: long enough to stall the
// whole screen for seconds.
const int WINDOWS = 6;
vec4 WIN[6];
float LIES[6];
float KEEPS[6];
float ICE[6];

void loadWindows() {
    WIN[0] = u.w0;
    WIN[1] = u.w1;
    WIN[2] = u.w2;
    WIN[3] = u.w3;
    WIN[4] = u.w4;
    WIN[5] = u.w5;
#ifdef FRONT_PASS
    LIES[0] = u.depthA.x;
    LIES[1] = u.depthA.y;
    LIES[2] = u.depthA.z;
    LIES[3] = u.depthA.w;
    LIES[4] = u.depthB.x;
    LIES[5] = u.depthB.y;
    KEEPS[0] = u.shelterA.x;
    KEEPS[1] = u.shelterA.y;
    KEEPS[2] = u.shelterA.z;
    KEEPS[3] = u.shelterA.w;
    KEEPS[4] = u.shelterB.x;
    KEEPS[5] = u.shelterB.y;
    ICE[0] = u.iceA.x;
    ICE[1] = u.iceA.y;
    ICE[2] = u.iceA.z;
    ICE[3] = u.iceA.w;
    ICE[4] = u.iceB.x;
    ICE[5] = u.iceB.y;
#endif
}

// ------------------------------------------------------------------ dither

float bayer2(vec2 a) {
    a = floor(a);
    return fract(a.x / 2.0 + a.y * a.y * 0.75);
}

// Ordered dither thresholds in 0..1, by canvas pixel.
float bayer4(vec2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }
float bayer8(vec2 a) { return bayer4(0.5 * a) * 0.25 + bayer2(a); }

// v cut into `levels` flat steps. Only the join between two steps is
// dithered, so most of each band is one clean tone.
float stepped(float v, float levels, vec2 cell) {
    return clamp(floor(v * levels + 0.5 + (bayer8(cell) - 0.5) * 0.42) / levels, 0.0, 1.0);
}

// ----------------------------------------------------------------- windows

float topOf(vec4 w, float x, float best) {
    return (w.z > 0.5 && x >= w.x && x < w.x + w.z) ? min(best, w.y) : best;
}

// The first thing a falling drop meets in the column at x: the top of the
// highest window there, or the ground. Below detail 2 there is only ground.
float surfaceAt(float x) {
    float y = SCENE.y;
    if (DETAIL_2) {
        for (int i = 0; i < WINDOWS; i++) y = topOf(WIN[i], x, y);
    }
    return y;
}

// A window's sides on the canvas. A column belongs to a window when its
// centre is inside it, so these are the first column inside on the left and
// the first column outside on the right.
float colLeft(vec4 w) { return ceil(w.x / GRID - 0.5); }
float colRight(vec4 w) { return ceil((w.x + w.z) / GRID - 0.5); }

// Whether a canvas pixel touches a window at all, by so much as its edge.
bool touches(vec4 w, vec2 cell) {
    return w.z > 0.5 && (cell.x + 1.0) * u.pixel > w.x && cell.x * u.pixel < w.x + w.z
        && (cell.y + 1.0) * u.pixel > w.y && cell.y * u.pixel < w.y + w.w;
}

// Whether window number `index` is a window, and not a place one has left.
bool isWindow(float index) {
    return index < u.depthB.w - 0.5 || index > u.depthB.z - 0.5;
}

// Nothing of the weather is drawn on a window. It lands on them, lies on
// them, hangs beside them and runs off them, but what is in a window is the
// window's: no rain across it, no fog over it. This is asked first for
// every pixel of the pass in front, and where the answer is yes nothing
// else is worked out, bar one thing: the snow lying on a window spills a
// pixel or two over its top edge (see drapeOn).
bool onWindow(vec2 cell) {
    bool on = false;
    for (int i = 0; i < WINDOWS; i++) on = on || (touches(WIN[i], cell) && isWindow(float(i)));
    return on;
}

// The same as a canvas row: the first solid row in column cx.
float surfaceRow(float cx) {
    return floor(surfaceAt((cx + 0.5) * GRID) / GRID);
}

// How much is falling at a logical position: what the near clouds over it
// let go, and nothing else.
float shaft(vec2 p, float slant, float spread) {
    return falling(p, u.laneDrift.z, u.nearCover, u.deck, SKY, slant, spread);
}

// It comes in gusts: sheets of it, heavier and lighter, sweeping across
// with the wind. How far it thins between them is how gusty the wind is; a
// still day barely shows it and a gale tears it into bands. The same for a
// drop all the way down, so what lands is what was falling.
float gust(float x) {
    if (!DETAIL_1) return 1.0;
    float deep = clamp(0.10 + 0.50 * u.gust, 0.0, 0.62);
    if (DETAIL_3) deep = max(deep, 0.30);
    float sweep = u.slowTime * (u.wind < 0.0 ? -1.1 : 1.1) * (0.6 + 0.8 * u.gust);
    return 1.0 - deep * (0.5 - 0.5 * sin(x * 0.0055 - sweep + 1.7 * sin(u.slowTime * 0.19)));
}

// How far sideways the wind carries a flake for each pixel it falls. A
// breeze leans the snow; a gale drives it across, which is a blizzard.
float blow() {
    return u.wind * (0.45 + 1.6 * smoothstep(0.55, 1.0, abs(u.wind)) * (0.4 + 0.6 * u.gust));
}

// -------------------------------------------------------------------- rain

// One column of rain on the canvas. Drops are short dashes on a track that
// scrolls down; x: this pixel is part of a drop, y: that drop's number, for
// telling one from the next.
vec2 rainTrack(float col, float cy, float seed, out float period, out float speed) {
    float h = hash11(col * 1.13 + seed);
    period = floor((26.0 + 44.0 * h) * K);
    speed = (150.0 + 70.0 * hash11(col * 2.71 + seed)) * K;
    float track = u.time * speed + h * 97.0 - cy;
    float drop = floor(track / period);
    float along = track - drop * period;
    float len = (3.0 + floor(3.0 * hash11(col * 3.3 + drop * 1.7 + seed))) * K;
    // x: 0 outside a drop, 1 in its tail, 2 at its head, the end that leads.
    return vec2(step(along, len - 0.5) * (along < K ? 2.0 : 1.0), drop);
}

// Sheared by the wind: a drop steps sideways as it falls.
float rainColumn(vec2 cell) {
    return cell.x - floor(cell.y * u.wind * 0.42 + 0.5);
}

// Which columns carry rain at all: about one in three at the usual canvas,
// fewer of the finer columns so the same number of drops crosses the screen.
float rainLane(float col, float seed) {
    return step(hash11(col * 7.77 + seed * 1.3), 0.34 / K);
}

float rainHere(vec2 cell, float seed, float density) {
    float period;
    float speed;
    float col = rainColumn(cell);
    if (rainLane(col, seed) < 0.5) return 0.0;
    vec2 drop = rainTrack(col, cell.y, seed, period, speed);
    if (drop.x < 0.5) return 0.0;
    // 1 in a drop's tail, 2 at its head.
    return step(hash11(col * 5.17 + drop.y * 2.3 + seed), density) * drop.x;
}

#ifdef FRONT_PASS

// Whether this pixel is within `above` rows over something a drop can land
// on: the ground, or the top of a window. Splashes and settled snow only
// happen there, so everything that looks for them asks this first; it is
// what keeps the cost of the physical weather to the few rows it concerns.
bool overLedge(vec4 w, vec2 cell, float above, float beside) {
    if (w.z < 0.5) return false;
    float up = floor(w.y / GRID) - cell.y;
    return up > -above && up <= above && cell.x >= colLeft(w) - beside && cell.x < colRight(w) + beside;
}

bool nearLedge(vec2 cell, float above, float beside) {
    float up = floor(SCENE.y / GRID) - cell.y;
    if (up >= 0.0 && up <= above) return true;
    if (!DETAIL_2) return false;
    bool over = false;
    for (int i = 0; i < WINDOWS; i++) over = over || overLedge(WIN[i], cell, above, beside);
    return over;
}

// A drop that has just met a surface throws two droplets up and out for a
// few frames. Looks over the columns either side for one that landed, in
// each sheet of rain there is: one, and on ultra a second, a little thinner.
float splashHere(vec2 cell, float thick) {
    if (!nearLedge(cell, 4.0 * K + 2.0, 4.0 * K + 2.0)) return 0.0;
    float lit = 0.0;
    // How much is falling here. A splash is within a few pixels of where its
    // drop landed, so this stands for every column the loop looks at, and
    // working it out once instead of once a column is what keeps this shader
    // small enough to compile quickly.
    float from = shaft((cell + 0.5) * GRID, u.wind * 0.42, 0.0) * gust((cell.x + 0.5) * GRID);
    if (from < 0.02) return 0.0;
    for (int sheet = 0; sheet < 2; sheet++) {
    if (sheet == 1 && !DETAIL_3) break;
    float seed = sheet == 0 ? 41.0 : 67.0;
    float density = sheet == 0 ? thick : thick * 0.85;
    // Far enough to either side to catch a droplet at its widest.
    for (int i = -4; i <= 4; i++) {
        float cx = cell.x + float(i);
        float row = surfaceRow(cx);
        // Nothing lands outside the picture.
        if (row < 2.0 || cell.y < row - 4.0 * K - 1.0 || cell.y > row - 1.0) continue;

        float period;
        float speed;
        float col = cx - floor(row * u.wind * 0.42 + 0.5);
        if (rainLane(col, seed) < 0.5) continue;
        float h = hash11(col * 1.13 + seed);
        period = floor((26.0 + 44.0 * h) * K);
        speed = (150.0 + 70.0 * hash11(col * 2.71 + seed)) * K;
        float track = u.time * speed + h * 97.0 - row;
        float drop = floor(track / period);
        float age = (track - drop * period) / speed;
        if (age > 0.22) continue;

        float chance = hash11(col * 5.17 + drop * 2.3 + seed);
        // Only what was really falling here lands, and not every drop splashes.
        if (chance > density * from || hash11(col * 9.1 + drop * 4.7) > 0.8) continue;

        float frame = floor(age / 0.055);
        float rise = floor(2.6 * K * sin(3.14159 * (frame + 0.5) / 4.0) + 0.5);
        float out_ = floor((frame + 1.0) * K + 0.5);
        float size = max(K, 1.0) * 0.5;
        float dx = cell.x - cx;
        float dy = (row - 1.0) - cell.y;
        if (frame < 0.5) {
            if (abs(dx) < size && dy < size * 2.0 - 0.5) lit = 1.0;
        } else if (abs(abs(dx) - out_) < size && abs(dy - rise) < size) {
            lit = max(lit, 1.0 - frame * 0.22);
        }
        // On ultra it is a crown: a third droplet straight up, higher than
        // the two beside it, and a ring running out along the surface.
        if (DETAIL_3 && frame > 0.5 && frame < 2.5) {
            if (abs(dx) < size && abs(dy - floor(rise * 1.6 + 0.5)) < size) lit = max(lit, 0.95 - frame * 0.2);
            if (dy < size && abs(abs(dx) - (out_ + 1.0)) < size) lit = max(lit, 0.6 - frame * 0.15);
        }
    }
    }
    return lit;
}

// Water on a window: a film running along the top edge toward the nearer
// side, and drips falling down both sides.
float runoffOn(vec4 w, float lies, vec2 cell, float seed) {
    if (w.z < 0.5) return 0.0;
    float left = colLeft(w);
    float right = colRight(w);
    float top = floor(w.y / GRID);
    // Only the row lying on its top edge and the column beside each side
    // can carry water.
    bool onTop = abs(cell.y - (top - 1.0)) < 0.5 && cell.x >= left && cell.x < right;
    bool beside = (abs(cell.x - (left - 1.0)) < 0.5 || abs(cell.x - right) < 0.5) && cell.y >= top;
    if (!onTop && !beside) return 0.0;
    // Only a window with open sky above it is rained on.
    float mid = (left + right) * 0.5;
    if (surfaceRow(mid) < top - 0.5) return 0.0;
    // Rain on it, or its own snow melting.
    float wet = max(shaft(vec2(w.x + w.z * 0.5, w.y), u.wind * 0.42, 0.0) * u.rain,
                    u.thaw * clamp(lies / 10.0, 0.0, 1.0) * 0.9);
    if (wet < 0.03) return 0.0;

    float lit = 0.0;
    if (onTop) {
        float toEdge = min(cell.x - left, right - 1.0 - cell.x);
        float flow = mod(toEdge + floor(u.time * 22.0 * K), 6.0 * K);
        if (flow < 2.0 * K && hash11(floor(cell.x / K) * 3.7 + floor(u.time * 5.0) + seed) < 0.35 + 0.65 * wet) lit = 0.75;
    }

    // Just outside each side, falling slower than rain, down to whatever is below.
    bool leftSide = abs(cell.x - (left - 1.0)) < 0.5;
    bool rightSide = abs(cell.x - right) < 0.5;
    if ((leftSide || rightSide) && cell.y >= top && cell.y < surfaceRow(cell.x)) {
        float side = leftSide ? 1.0 : 2.0;
        float h = hash11(seed * 7.1 + side * 3.3);
        float period = (11.0 + floor(13.0 * h)) * K;
        float track = u.time * (46.0 + 22.0 * h) * K + h * 50.0 - cell.y;
        float drop = floor(track / period);
        if (track - drop * period < 2.0 * K && hash11(drop * 2.9 + seed + side) < 0.25 + 0.75 * wet) lit = 1.0;
    }
    return lit;
}

float runoffHere(vec2 cell) {
    float lit = 0.0;
    for (int i = 0; i < WINDOWS; i++) lit = max(lit, runoffOn(WIN[i], LIES[i], cell, float(i) + 1.0));
    return lit;
}

// ------------------------------------------------------------------- hail

// Hail: hard little stones, fewer and faster than rain, straight down. One
// column in six carries them.
float hailLane(float col) {
    return step(hash11(col * 3.31 + 17.0), 0.16);
}

float hailTrack(float col, float cy, out float stone, out float speed) {
    float h = hash11(col * 1.77 + 5.0);
    float period = floor(38.0 + 60.0 * h);
    speed = 250.0 + 80.0 * hash11(col * 4.1 + 9.0);
    float track = u.time * speed + h * 131.0 - cy;
    stone = floor(track / period);
    return track - stone * period;
}

float hailHere(vec2 cell, float density) {
    if (hailLane(cell.x) < 0.5) return 0.0;
    float stone;
    float speed;
    // A stone is two cells tall: it is moving fast.
    if (hailTrack(cell.x, cell.y, stone, speed) >= 2.0) return 0.0;
    return step(hash11(cell.x * 6.3 + stone * 1.9), density);
}

// A stone that has met a surface does not splash. It bounces: two hops, the
// second smaller, off to one side, and then it is gone.
float hailBounce(vec2 cell, float density) {
    if (!nearLedge(cell, 9.0, 4.0)) return 0.0;
    float from = shaft((cell + 0.5) * GRID, 0.0, 0.0) * gust((cell.x + 0.5) * GRID);
    if (from < 0.02) return 0.0;
    float lit = 0.0;
    for (int i = -3; i <= 3; i++) {
        float cx = cell.x + float(i);
        if (hailLane(cx) < 0.5) continue;
        float row = surfaceRow(cx);
        if (row < 2.0 || cell.y > row - 1.0 || cell.y < row - 9.0) continue;
        float stone;
        float speed;
        float age = hailTrack(cx, row, stone, speed) / speed;
        if (age > 0.42) continue;
        if (hash11(cx * 6.3 + stone * 1.9) > density * from) continue;
        float side = hash11(cx * 2.9 + stone) < 0.5 ? -1.0 : 1.0;
        float first = age / 0.27;
        float second = (age - 0.27) / 0.15;
        float hop = age < 0.27 ? 24.0 * first * (1.0 - first) : 10.0 * second * (1.0 - second);
        float away = side * floor(age * 7.0 + 0.5);
        if (abs(cell.x - (cx + away)) < 0.5 && abs((row - 1.0 - floor(hop + 0.5)) - cell.y) < 0.5) lit = 1.0;
    }
    return lit;
}

#endif

// -------------------------------------------------------------------- snow

// One depth of snowfall: a flake to a cell of the canvas, drifting downwind
// and swaying a pixel or two. `big` flakes are little crosses.
float snowHere(vec2 cell, float size, float fall, float seed, float density, float big) {
    size = floor(size * K + 0.5);
    fall *= K;
    float sway = floor(sin(cell.y * 0.09 / K + u.slowTime * 0.8 + seed) * 1.6 * K + 0.5);
    float gx = cell.x - floor(u.slowTime * blow() * fall) - sway;
    float gy = cell.y - floor(u.slowTime * fall);
    vec2 id = vec2(floor(gx / size), floor(gy / size));
    vec2 h = hash22(id + seed);
    if (hash12(id * 3.1 + seed + 5.0) > density) return 0.0;
    vec2 at = floor(1.0 + h * (size - 2.0));
    vec2 d = abs(vec2(gx - id.x * size, gy - id.y * size) - at);
    // A flake is a pixel, or a little cross; both grow with a finer canvas.
    float reach = max(floor(K + 0.3), 1.0);
    float r = reach - 0.5 + (big > 0.5 ? 1.0 : 0.0);
    // On ultra the big ones tumble: a plus one moment, a cross the next.
    if (DETAIL_3 && big > 0.5 && fract(h.x * 7.0 + floor(u.slowTime * 2.2 + h.y * 5.0) * 0.5) > 0.5)
        return step(abs(d.x - d.y), 0.5) * step(max(d.x, d.y), r);
    return step(d.x + d.y, r);
}

#ifdef FRONT_PASS

// How many canvas rows of snow lie in column cx on a ledge from x0 to x1.
// It does not thin to nothing at the ends: there it is rolling over the edge.
float pileOn(float cx, float x0, float x1, float depth, float seed) {
    if (depth < 0.5 || cx < x0 || cx >= x1) return 0.0;
    float ends = min(cx - x0, x1 - 1.0 - cx);
    float heap = depth * (0.55 + 0.45 * vnoise(vec2(cx * 0.13 / K + seed, seed)));
    // On a window's top the wind leans it: it drifts deep at the end the
    // wind is blowing toward and is scoured thin at the other.
    float span = x1 - x0;
    if (span < SCENE.x / GRID) heap *= 1.0 + 0.5 * u.wind * (2.0 * (cx - x0) / max(span, 1.0) - 1.0);
    return floor(min(heap, 0.5 * heap + ends * 0.8 + K) + 0.5);
}


// Whether a window has open sky above it, so that snow reaches it.
bool exposed(vec4 w) {
    return w.z > 0.5 && surfaceRow(floor((w.x + w.z * 0.5) / GRID)) > floor(w.y / GRID) - 0.5;
}

// Snow that has rolled off the sides of a window above and landed here: a
// mound under each of its edges, on whatever that edge hangs over.
float spillFrom(vec4 w, float lies, float cx, float row) {
    float top = floor(w.y / GRID);
    float depth = lies / GRID;
    if (depth < 1.0 || top > row - 2.0 || !exposed(w)) return 0.0;
    float x0 = colLeft(w);
    float x1 = colRight(w);
    float reach = 3.0 * K + depth * 0.9;
    float mound = 0.0;
    // More comes off the end the wind blows toward.
    if (abs(surfaceRow(x0 - 1.0) - row) < 0.5) mound = max(mound, (1.0 - abs(cx - (x0 - 1.0)) / reach) * (1.0 - 0.45 * u.wind));
    if (abs(surfaceRow(x1) - row) < 0.5) mound = max(mound, (1.0 - abs(cx - x1) / reach) * (1.0 + 0.45 * u.wind));
    return mound * depth * 0.9;
}

// The space between two windows side by side is a crack when it is no wider
// than this many columns. Snow treats a crack as it treats open air beside a
// window, except that there is no room to hang out into: it slides down
// between the two, and lands under both.
float crackWidth() { return 4.0 * K; }

// How many columns of crack lie between the side of `w` that `dir` points
// out of and window `v`, where `v` stands across from the top of `w`.
float crackTo(vec4 w, vec4 v, float dir) {
    if (v.z < 0.5 || v.y > w.y + 16.0 || v.y + v.w < w.y) return 0.0;
    float gap = dir > 0.0 ? colLeft(v) - colRight(w) : colLeft(w) - colRight(v);
    return (gap > 0.5 && gap <= crackWidth()) ? gap : 0.0;
}

float crackBeside(vec4 w, float dir) {
    float gap = 0.0;
    for (int i = 0; i < WINDOWS; i++) gap = max(gap, crackTo(w, WIN[i], dir));
    return gap;
}

// For a column of open ground: the nearest window to each side within a
// crack's width (x: columns away, y: the row under its bottom edge).
void flank(vec4 w, float cx, inout vec2 left, inout vec2 right) {
    if (w.z < 0.5) return;
    float bottom = ceil((w.y + w.w) / GRID);
    float x0 = colLeft(w);
    float x1 = colRight(w);
    if (x1 <= cx && cx - x1 <= crackWidth()) left = vec2(min(left.x, cx - x1), max(left.y, bottom));
    if (x0 > cx && x0 - cx <= crackWidth()) right = vec2(min(right.x, x0 - cx), max(right.y, bottom));
}

// The row where the windows close over a crack that column cx stands in, or
// 0 where it has open ground to either side.
float crackRoof(float cx) {
    vec2 left = vec2(99.0, 0.0);
    vec2 right = vec2(99.0, 0.0);
    for (int i = 0; i < WINDOWS; i++) flank(WIN[i], cx, left, right);
    return left.x + right.x <= crackWidth() ? max(left.y, right.y) : 0.0;
}

// Icicles under a window: water that froze as it ran off the bottom edge.
// They hang into the gap below, never onto the window; uneven, a few long
// and most short, two pixels wide at the root and tapering to one. 0 for
// none here, 1 for ice, 2 for the bright root, 3 for a drip falling from a
// tip, which is what they do in a thaw.
float icicleOn(vec4 w, float len, vec2 cell, float seed) {
    if (len < 1.0 || w.z < 0.5) return 0.0;
    float bottom = ceil((w.y + w.w) / GRID);
    float most = len / GRID;
    if (cell.y < bottom || cell.y > bottom + most + 14.0 * K + 1.0 || cell.x < colLeft(w) || cell.x >= colRight(w)) return 0.0;
    float tooth = floor(cell.x / (2.0 * K));
    float h = hash11(tooth * 2.3 + seed * 11.0);
    if (h < 0.38) return 0.0;
    float reach = floor(most * (0.25 + 0.75 * hash11(tooth * 5.1 + seed)) + 0.5);
    float down = cell.y - bottom;
    bool inner = mod(cell.x, 2.0 * K) < K;
    if (down < reach) {
        if (down >= reach * 0.5 && !inner) return 0.0;
        return down < K ? 2.0 : 1.0;
    }
    if (u.thaw > 0.02 && inner && reach > 0.5) {
        float period = 20.0 * K;
        float track = u.time * 26.0 * K + h * 40.0 - cell.y;
        float drop = floor(track / period);
        if (track - drop * period < 2.0 * K && hash11(drop * 3.1 + tooth) < 0.25 + 0.75 * u.thaw) return 3.0;
    }
    return 0.0;
}

float icicleHere(vec2 cell) {
    float ice = 0.0;
    for (int i = 0; i < WINDOWS; i++) ice = max(ice, icicleOn(WIN[i], ICE[i], cell, float(i) + 1.0));
    return ice;
}

// Whether a floating window lies over this pixel of window number `index`.
// The windows come in drawing order, the floating ones last.
bool coveredOver(float index, vec2 cell) {
    float first = max(index + 1.0, u.depthB.z);
    bool over = false;
    for (int i = 1; i < WINDOWS; i++) over = over || (first < float(i) + 0.5 && touches(WIN[i], cell));
    return over;
}

// A little of the snow lying on a window spills over its top edge: an
// uneven fringe a pixel or two deep, deeper where more lies. It is the only
// weather drawn on a window, and not where another window lies over that
// edge.
float drapeOn(vec4 w, float lies, vec2 cell, float seed) {
    float depth = lies / GRID;
    if (depth < 1.5 || w.z < 0.5) return 0.0;
    float top = floor(w.y / GRID);
    if (cell.y < top || cell.y > top + 3.0 * K + 1.0 || cell.x < colLeft(w) || cell.x >= colRight(w)) return 0.0;
    if (!exposed(w) || coveredOver(seed - 1.0, cell)) return 0.0;
    float tooth = floor(cell.x / K);
    float drape = floor(min(depth * 0.25, 2.0 * K) * step(0.35, hash11(tooth * 1.7 + seed))
                        + 0.6 * K * step(0.7, hash11(tooth * 3.1 + seed)) + 0.2);
    return cell.y < top + drape ? 1.0 : 0.0;
}

float drapeHere(vec2 cell) {
    float drape = 0.0;
    for (int i = 0; i < WINDOWS; i++) drape = max(drape, drapeOn(WIN[i], LIES[i], cell, float(i) + 1.0));
    return drape;
}

// Where a window's snow hangs past it: a lip over each side, deepest against
// the window.
float lipOn(vec4 w, float lies, vec2 cell, float seed) {
    float depth = lies / GRID;
    if (depth < 1.5 || w.z < 0.5) return 0.0;
    float x0 = colLeft(w);
    float x1 = colRight(w);
    float top = floor(w.y / GRID);
    float past = cell.x < x0 ? x0 - cell.x : (cell.x >= x1 ? cell.x - x1 + 1.0 : 0.0);
    // Nowhere near this window's top edge: nothing of its snow is here.
    if (past > 4.0 * K + 1.0 || cell.y < top - depth - 2.0 || cell.y > top + 5.0 * K + depth + 2.0) return 0.0;
    // Over the window itself is drapeOn's.
    if (past < 0.5 || !exposed(w)) return 0.0;

    // A rounded lump that hangs out past the side and sags against it.
    float over = min(floor(depth * 0.5) + 1.0, 4.0 * K);
    if (past > over + 0.5) return 0.0;
    float round_ = sqrt(max(1.0 - (past * past) / ((over + 0.5) * (over + 0.5)), 0.0));
    float up = floor((0.45 * depth + 1.0) * round_ + 0.5);
    float down = floor((over + 1.0) * round_ * (1.0 - past / (over + 1.5)) + 0.5);
    // In a crack the lumps from both windows meet, and what they would have
    // held out sags down between the two as a tongue, longest in the middle.
    float gap = crackBeside(w, cell.x < x0 ? -1.0 : 1.0);
    if (gap > 0.5 && past < gap + 0.5) {
        float middle = abs(past - (gap + 1.0) * 0.5);
        down += floor(depth * 0.9 * (1.0 - middle / (gap + 1.0)) + 0.5);
    }
    return (cell.y >= top - up && cell.y < top + down) ? 1.0 : 0.0;
}

// The lowest window bottom over the column at x, as a canvas row; 0 where
// the sky is open.
float bottomOf(vec4 w, float x) {
    return (w.z > 0.5 && x >= w.x && x < w.x + w.z) ? ceil((w.y + w.w) / GRID) : 0.0;
}

float coverBottom(float cx) {
    float x = (cx + 0.5) * GRID;
    float bottom = 0.0;
    for (int i = 0; i < WINDOWS; i++) bottom = max(bottom, bottomOf(WIN[i], x));
    return bottom;
}

// Snow on the ground does not stop at a window's side. From each side that
// stands on open ground it rolls in underneath, as deep at the edge as the
// drift outside and sloping away to nothing, further the deeper that drift.
// The crack between two windows counts: what comes down it spreads out
// under both.
float rollFrom(vec4 w, float lies, float cx) {
    if (w.z < 0.5) return 0.0;
    float ground = floor(SCENE.y / GRID);
    float lying = u.groundDepth / GRID;
    // What has come off this window's own top piles against its sides.
    float mound = exposed(w) ? lies / GRID * 0.9 : 0.0;
    float x0 = colLeft(w);
    float x1 = colRight(w);
    float h = 0.0;
    // From the left side, then from the right: the column just outside it,
    // whether cx is on the window's side of it, and how far in.
    for (int side = 0; side < 2; side++) {
        float outside = side == 0 ? x0 - 1.0 : x1;
        bool within = side == 0 ? cx >= x0 : cx < x1;
        float into = side == 0 ? cx - x0 + 1.0 : x1 - cx;
        if (within && surfaceRow(outside) > ground - 0.5) {
            float edge = pileOn(outside, -9.0, SCENE.x / GRID + 9.0, lying, 11.0) + mound;
            h = max(h, edge * (1.0 - smoothstep(0.0, 1.0, into / (3.0 * K + edge * 1.5))));
        }
    }
    return h;
}

// How far the window over the column at x keeps the snow off the ground
// there: the most of any that cover it.
float shelterOf(vec4 w, float keeps, float x) {
    return (w.z > 0.5 && x >= w.x && x < w.x + w.z) ? keeps : 0.0;
}

float shelterAt(float cx) {
    float x = (cx + 0.5) * GRID;
    float keeps = 0.0;
    for (int i = 0; i < WINDOWS; i++) keeps = max(keeps, shelterOf(WIN[i], KEEPS[i], x));
    return keeps;
}

// How many rows of snow lie under whatever covers column cx: what has
// rolled in from the open sides, or what was lying there before the window
// had been over it long enough to keep it off.
float underAt(float cx) {
    float rolled = 0.0;
    for (int i = 0; i < WINDOWS; i++) rolled = max(rolled, rollFrom(WIN[i], LIES[i], cx));
    float open = 1.0 - shelterAt(cx);
    float lain = open > 0.01 ? pileOn(cx, -9.0, SCENE.x / GRID + 9.0, u.groundDepth / GRID, 11.0) * open : 0.0;
    return floor(max(rolled, lain) + 0.5);
}

float lipHere(vec2 cell) {
    float lip = 0.0;
    for (int i = 0; i < WINDOWS; i++) lip = max(lip, lipOn(WIN[i], LIES[i], cell, float(i) + 1.0));
    return lip;
}

// The window whose top is the surface in the column at x: the highest of
// those over it. `lies` is its snow and `seed` what tells its drifts from
// the next window's.
void ledge(vec4 v, float dv, float sv, float x, inout vec4 w, inout float lies, inout float seed) {
    if (v.z > 0.5 && x >= v.x && x < v.x + v.z && (w.z < 0.5 || v.y < w.y)) {
        w = v;
        lies = dv;
        seed = sv;
    }
}


// Snow lying in column cx: on the window whose top is the surface there, or
// on the ground, with whatever has rolled off the windows above.
float pileAt(float cx) {
    float row = surfaceRow(cx);
    float ground = floor(SCENE.y / GRID);
    // The ledge it lies on here: the ground, from one end of the picture to
    // the other, unless the top of a window is the surface.
    float x0 = -9.0;
    float x1 = SCENE.x / GRID + 9.0;
    float depth = u.groundDepth / GRID;
    float seed = 11.0;
    if (DETAIL_2 && row <= ground - 0.5) {
        float x = (cx + 0.5) * GRID;
        vec4 w = vec4(0.0);
        float lies = 0.0;
        float number = 1.0;
        for (int i = 0; i < WINDOWS; i++) ledge(WIN[i], LIES[i], float(i) + 1.0, x, w, lies, number);
        x0 = colLeft(w);
        x1 = colRight(w);
        depth = lies / GRID;
        seed = number * 13.0;
    }
    float lying = pileOn(cx, x0, x1, depth, seed);
    if (!DETAIL_2) return lying;
    if (u.snowDepth >= GRID) {
        float spill = 0.0;
        for (int i = 0; i < WINDOWS; i++) spill = max(spill, spillFrom(WIN[i], LIES[i], cx, row));
        lying += floor(spill + 0.5);
    }
    // A drift in a crack cannot stand higher than the bottoms of the windows
    // over it: there it is the top of the mound that has gone in under them.
    if (row > ground - 0.5) {
        float roof = crackRoof(cx);
        if (roof > 0.5) lying = min(lying, ground - roof);
    }
    return lying;
}

#endif

// ------------------------------------------------------------------ clouds

float smin(float a, float b, float k) {
    float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
    return mix(b, a, h) - k * h * (1.0 - h);
}

// Signed distance to a cumulus in units of its half-width: q.x across, q.y up
// from its flat base. Six puffs along the base, two more for a crown.
float cumulus(vec2 q, float seed) {
    float d = 10.0;
    float peak = (hash11(seed + 91.0) - 0.5) * 0.7;
    for (int i = 0; i < 6; i++) {
        float fi = float(i);
        float t = (fi - 2.5) / 2.5;
        float h = hash11(seed + fi * 3.7);
        float tall = 1.0 - 0.62 * smoothstep(0.0, 1.1, abs(t - peak));
        float r = 0.40 * tall * (0.80 + 0.40 * h);
        vec2 c = vec2(t * 0.70 + (h - 0.5) * 0.10, r * (0.55 + 0.35 * hash11(seed + fi * 7.1)));
        d = smin(d, length(q - c) - r, 0.16);
    }
    for (int j = 0; j < 2; j++) {
        float fj = float(j);
        float h = hash11(seed + 40.0 + fj * 5.3);
        float r = 0.22 + 0.14 * h;
        vec2 c = vec2(peak * 0.7 + (fj - 0.5) * 0.36 + (h - 0.5) * 0.2, 0.50 + 0.26 * hash11(seed + 60.0 + fj * 2.9));
        d = smin(d, length(q - c) - r, 0.14);
    }
    return -smin(-d, q.y + 0.03, 0.07);
}

// One cloud in three flat tones: lit where it faces the sun or moon, shaded
// along its base and its far side. c is cloudAt()'s answer; its centre is
// snapped to the canvas so the shape holds still as it moves.
vec4 drawCloud(vec2 p, vec2 cell, vec4 c, float seed, float lane) {
    float s = c.z;
    vec2 centre = (floor(c.xy / u.pixel) + 0.5) * u.pixel;
    vec2 q = vec2(p.x - centre.x, centre.y - p.y) / s;
    // The far lane is high cloud: long and flat rather than heaped.
    if (lane < 0.5) q *= vec2(0.72, 2.6);
    if (abs(q.x) > 1.6 || q.y < -0.2 || q.y > 1.45) return vec4(0.0);

    float d = cumulus(q, seed);
    // A cloud that is still forming, or leaving, is thin: dithered away.
    if (d > 0.0 || bayer4(cell) > c.w * 1.25 - 0.1) return vec4(0.0);
    // And thin all through, more so toward its ends: wisps.
    if (lane < 0.5 && bayer4(cell + 1.0) > 0.72 - 0.32 * abs(q.x)) return vec4(0.0);

    vec2 toLight = vec2(u.lightPos.x - c.x, c.y - 0.45 * s - u.lightPos.y);
    toLight /= max(length(toLight), 1.0);
    float slope = (cumulus(q + toLight * 0.16, seed) - d) / 0.16;
    float depth = clamp(-d / 0.36, 0.0, 1.0);
    float lit = 0.55 + 0.45 * slope * (1.0 - depth * depth);
    lit = mix(lit, 0.25, u.storm * 0.6);
    lit -= 0.40 * (1.0 - smoothstep(0.0, 0.34, q.y));
    // Three tones, cut hard, with a pixel of dither where they meet.
    float jitter = (bayer4(cell) - 0.5) * 0.07;
    float tone = lit + jitter > 0.60 ? 1.0 : (lit + jitter > 0.34 ? 0.5 : 0.0);
    vec3 col = mix(u.cloudShade.rgb, u.cloudLight.rgb, tone);

    // The edge nearest the light catches it.
    float dist = length(p - u.lightPos);
    float rim = exp(-dist / (SKY * 0.12)) * step(-0.10, d) * u.shine;
    if (rim > bayer4(cell + 2.0) + 0.10) col = u.lightColor.rgb;

    // Distance thins the far lanes into the sky.
    float haze = lane < 0.5 ? 0.50 : (lane < 1.5 ? 0.25 : 0.0);
    col = mix(col, u.hazeColor.rgb, haze);
    return vec4(col, 1.0);
}

vec4 drawLane(vec2 p, vec2 cell, float lane, float drift, float cover) {
    vec4 acc = vec4(0.0);
    float home = laneCell(lane, p.x, drift, SKY);
    for (int k = -1; k <= 1; k++) {
        float id = home + float(k);
        vec4 c = cloudAt(lane, id, drift, cover, u.deck, SKY);
        if (c.w < 0.02) continue;
        vec4 src = drawCloud(p, cell, c, hash12(vec2(id, lane * 31.0 + 3.0)) * 97.0, lane);
        acc = src.a > 0.5 ? src : acc;
    }
    return acc;
}

// Lightning only comes out of a cloud. This finds the near cloud closest to
// where the strike was asked for. x, y: where the stroke starts, inside that
// cloud; z: 1 when there is a cloud to strike from, 0 when the sky is bare.
vec3 boltOrigin() {
    float home = laneCell(2.0, u.boltX, u.laneDrift.z, SKY);
    vec3 origin = vec3(u.boltX, 0.0, 0.0);
    float nearest = 1.0e9;
    for (int k = -2; k <= 2; k++) {
        vec4 c = cloudAt(2.0, home + float(k), u.laneDrift.z, u.nearCover, u.deck, SKY);
        if (c.w < 0.6) continue;
        float away = abs(c.x - u.boltX);
        if (away < nearest) {
            nearest = away;
            origin = vec3(c.x + (hash11(u.boltSeed * 1.9) - 0.5) * c.z * 0.7, c.y - c.z * 0.22, 1.0);
        }
    }
    return origin;
}

#ifdef FRONT_PASS

// --------------------------------------------------------------- lightning

// A forked stroke, one canvas pixel wide, from inside that cloud down to the
// first thing under it. The cloud is drawn over its top, so it comes out of
// the base.
float boltHere(vec2 cell, vec3 origin) {
    if (origin.z < 0.5) return 0.0;
    float top = floor(origin.y / GRID);
    float bx = floor(origin.x / GRID);
    float end = surfaceRow(bx);
    if (cell.y < top || cell.y >= end) return 0.0;
    float t = (cell.y - top) / max(end - top, 1.0);
    float sway = SCENE.y * 0.07 / GRID;
    float loose = smoothstep(0.0, 0.2, t);
    float x = bx + floor(((vnoise(vec2(cell.y * 0.11 / K, u.boltSeed)) - 0.5) * sway * 2.0
                        + (vnoise(vec2(cell.y * 0.43 / K, u.boltSeed + 7.3)) - 0.5) * sway * 0.6) * loose + 0.5);
    float lit = step(abs(cell.x - x), (0.5 + step(t, 0.55)) * K);

    float bt = (t - 0.34) / 0.36;
    if (bt > 0.0 && bt < 1.0) {
        float lean = hash11(u.boltSeed * 3.1) > 0.5 ? 1.0 : -1.0;
        float fork = top + 0.34 * (end - top);
        float base = bx + floor(((vnoise(vec2(fork * 0.11 / K, u.boltSeed)) - 0.5) * sway * 2.0
                               + (vnoise(vec2(fork * 0.43 / K, u.boltSeed + 7.3)) - 0.5) * sway * 0.6) + 0.5);
        float fx = base + floor(lean * bt * sway * 1.8 + (vnoise(vec2(cell.y * 0.5 / K, u.boltSeed + 21.0)) - 0.5) * sway * 0.5 + 0.5);
        lit = max(lit, step(abs(cell.x - fx), 0.5 * K));
    }
    return lit;
}

#endif

#ifndef FRONT_PASS

// ---------------------------------------------------------------- the sky

vec4 skyPass(vec2 p, vec2 cell) {
    // `cell` is this pixel on the canvas, `art` on the art's grid.
    vec2 art = floor(p / ART);
    useGrid(u.pixel);
    vec2 uv = p / SCENE;
    float night = 1.0 - u.dayness;

    // Bands of sky, dithered where they meet.
    vec3 col = mix(u.skyTop.rgb, u.skyBottom.rgb, stepped(smoothstep(0.0, 0.95, uv.y), 7.0, cell));

    float hy = (SCENE.y - p.y) / SCENE.y;
    float gx = (p.x - u.glowX) / SCENE.y;
    float glow = u.twilight * clamp(0.34 * exp(-hy * hy * 9.0) + 0.66 * exp(-(gx * gx * 1.6 + hy * hy * 3.2)), 0.0, 1.0);
    col = mix(col, u.glowColor.rgb, stepped(glow, 5.0, cell));

    float solid = 0.0;

    // A rainbow, when rain is falling and the sun is out and low. It is an
    // arch over the desktop: its crown in the sky above the windows and its
    // foot coming down the margin beside them, where it can be seen
    // (Model.bowShape). It stands on the side of the sky away from the sun
    // and thins to nothing on the way over to the sun's. Bands in the
    // theme's colors, red outermost, drawn thin enough to see the sky through.
    if (DETAIL_1 && u.rainbow > 0.01) {
        float band = (length(p - vec2(u.bowX, u.bowY)) - u.bowR) / max(SCENE.y * 0.013, u.pixel);
        if (band >= 0.0 && band < 6.0) {
            float k = floor(band) / 5.0;
            vec3 bow = k < 0.5 ? mix(u.bowInner.rgb, u.bowMiddle.rgb, k * 2.0) : mix(u.bowMiddle.rgb, u.bowOuter.rgb, k * 2.0 - 1.0);
            float away = smoothstep(-0.5, 0.1, (p.x - u.bowX) / u.bowR * u.bowSide);
            if (u.rainbow * 0.72 * away > bayer8(cell)) {
                col = mix(col, bow, 0.8);
                solid = max(solid, 0.8);
            }
        }
    }

    if (night > 0.02) {
        float clear = night * night * (1.0 - u.fog * 0.85) * (1.0 - 0.7 * smoothstep(0.45, 1.0, uv.y));
        useGrid(ART);
        // The northern lights, where the place is far enough from the
        // equator and the night is a clear one: curtains hung across the
        // top of the sky, bright along the hem and thinning up their folds,
        // green going to violet, swaying slowly. They are behind the stars,
        // which show through them.
        if (DETAIL_1 && u.aurora > 0.01) {
            float across = art.x * ART / SCENE.x;
            float sway = u.slowTime * 0.05;
            float fold = sin(across * 7.0 + sway) + 0.55 * sin(across * 16.0 - sway * 1.7);
            // Where the hem hangs, a little over the desktop, and how far
            // up from it this pixel is: 0 at the hem, 1 where the rays give
            // out, which is about the top of the sky.
            float up = (u.deck * (0.80 + 0.11 * fold) - art.y * ART) / (u.deck * 0.85);
            if (up > 0.0 && up < 1.0) {
                float rays = 0.3 + 0.7 * (0.5 + 0.5 * sin(across * 140.0 + fold * 3.0 + sway * 3.0));
                float glow = u.aurora * clear * rays * (1.0 - up) * sqrt(1.0 - up) * (0.45 + 0.55 * smoothstep(0.0, 0.06, up));
                if (glow * 1.3 > bayer8(art)) {
                    col = mix(col, mix(u.auroraLow.rgb, u.auroraHigh.rgb, smoothstep(0.1, 0.7, up)), 0.85);
                    solid = max(solid, 0.6);
                }
            }
        }
        // Single pixels that blink, and a few crosses that open and close.
        float h = hash12(art * 1.3 + 4.0);
        float blink = step(0.35, fract(h * 37.0 + floor(u.slowTime * 1.6 + h * 9.0) * 0.37));
        // As many stars to the screen whatever the canvas.
        float star = step(1.0 - 0.0065 / (K * K), h) * (0.55 + 0.45 * blink);
        float patch_ = floor(23.0 * K);
        vec2 big = floor(art / patch_);
        vec2 bh = hash22(big + 7.0);
        vec2 bd = abs(art - (big * patch_ + floor((2.0 + bh * 18.0) * K)));
        float open = step(0.5, fract(bh.x * 11.0 + floor(u.slowTime * 0.9 + bh.y * 5.0) * 0.5));
        float cross = step(hash12(big * 2.1 + 1.0), 0.30) * step(bd.x + bd.y, (0.5 + open) * K);
        float lit = clamp(max(star, cross) * clear * 1.6, 0.0, 1.0);
        col = mix(col, u.starColor.rgb, lit);
        // A star is a star whatever is behind it.
        solid = max(solid, lit);
        // Now and then, on a clear night, one falls: a short bright streak
        // across the top of the sky, gone in under a second.
        float slot = floor(u.slowTime / 9.0);
        float chance = hash11(slot * 3.7 + 1.0);
        float age = (u.slowTime - slot * 9.0) / 0.7;
        if (DETAIL_1 && chance < 0.4 && age < 1.0 && clear > 0.5) {
            vec2 dir = normalize(vec2(chance < 0.2 ? 1.0 : -1.0, 0.42));
            vec2 from = vec2((0.15 + 0.7 * hash11(slot * 5.1)) * SCENE.x, (0.06 + 0.4 * hash11(slot * 9.3)) * u.deck);
            vec2 rel = p - (from + dir * age * SCENE.y * 0.36);
            float behind = -dot(rel, dir);
            float tail = SCENE.y * 0.08 * (1.0 - 0.5 * age);
            if (behind >= 0.0 && behind < tail && abs(rel.x * dir.y - rel.y * dir.x) < ART * 0.6
                    && 1.0 - behind / tail > bayer4(art) * 0.9) {
                col = u.starColor.rgb;
                solid = 1.0;
            }
        }
        useGrid(u.pixel);
    }

    // Moon: a lit sphere cut hard at the terminator, a few seas, and a dark
    // side that only just shows.
    if (u.moonVis > 0.003) {
        vec2 centre = (floor(u.moonPos / u.pixel) + 0.5) * u.pixel;
        float r = max(floor(u.bodyRadius / u.pixel), 3.0) * u.pixel;
        vec2 m = (p - centre) / r;
        float dist = length(m);
        float angle = 6.2831853 * u.moonPhase;
        float litFace = 0.5 - 0.5 * cos(angle);

        float halo = exp(-max(dist - 1.0, 0.0) / 0.9) * 0.55 * (0.25 + 0.75 * litFace);
        if (dist > 1.0 && halo > bayer8(cell) + 0.12) {
            col = mix(col, u.moonColor.rgb, 0.45);
            solid = max(solid, 0.5);
        }
        // Through thin high cloud it wears a ring, well out from the disc.
        if (u.halo > 0.01 && abs(dist - 3.3) < 0.17 && u.halo * 0.85 > bayer8(cell)) {
            col = mix(col, u.moonColor.rgb, 0.5);
            solid = max(solid, 0.55);
        }

        if (dist <= 1.0) {
            vec2 t = vec2(0.940 * m.x * u.moonFlip + 0.342 * m.y, -0.342 * m.x * u.moonFlip + 0.940 * m.y);
            float z = sqrt(max(1.0 - dot(t, t), 0.0));
            float facing = t.x * sin(angle) - z * cos(angle);
            float seas = step(0.56, fbm3(t * 2.2 + 11.0));
            vec3 lunar = u.moonColor.rgb * (1.0 - 0.24 * seas) * (dist > 0.82 ? 0.86 : 1.0);
            if (facing > 0.0) col = lunar;
            else col = mix(col, u.moonColor.rgb, bayer4(cell) < 0.22 ? 0.5 : 0.10);
            solid = 1.0;
        }
    }

    // Sun: a two-tone disc, a dithered corona, and eight rays that take turns
    // being long.
    if (u.sunVis > 0.003) {
        vec2 centre = (floor(u.sunPos / u.pixel) + 0.5) * u.pixel;
        float r = max(floor(u.bodyRadius / u.pixel), 3.0) * u.pixel;
        vec2 sd = (p - centre) / u.pixel;
        float rr = r / u.pixel;
        float dist = length(sd);

        float corona = exp(-max(dist - rr, 0.0) / (rr * 0.9)) * 0.85;
        if (dist > rr && corona > bayer8(cell) + 0.18) {
            col = mix(col, u.sunColor.rgb, 0.55);
            solid = max(solid, 0.6);
        }

        float beat = floor(u.slowTime * 1.5);
        vec2 a = abs(sd);
        // Straight rays on the beat, diagonal ones off it.
        float straight = min(a.x, a.y) < 0.75 * K ? max(a.x, a.y) : 999.0;
        float diagonal = abs(a.x - a.y) < 0.9 * K ? max(a.x, a.y) * 1.2 : 999.0;
        float longer = mod(beat, 2.0);
        if ((straight > rr + 1.5 * K && straight < rr + (3.5 + 3.0 * longer) * K)
                || (diagonal > rr + 1.5 * K && diagonal < rr + (3.5 + 3.0 * (1.0 - longer)) * K)) {
            col = u.sunColor.rgb;
            solid = 1.0;
        }

        if (dist <= rr) {
            col = dist < rr * 0.72 ? u.sunCore.rgb : u.sunColor.rgb;
            // One hard highlight, up and to the left.
            if (length(sd + vec2(rr * 0.34, rr * 0.34)) < rr * 0.22) col = mix(u.sunCore.rgb, vec3(1.0), 0.5);
            solid = 1.0;
        }
    }

    // The clouds of each lane over this pixel: far, between and near. All
    // three are worked out here by one loop, so that the code that draws a
    // cloud is in the shader once and not three times (see loadWindows for
    // why that matters). The far lane is left out below detail 1.
    vec4 lanes[3];
    for (int l = 0; l < 3; l++) {
        float drift = l == 0 ? u.laneDrift.x : (l == 1 ? u.laneDrift.y : u.laneDrift.z);
        float cover = l == 0 ? u.coverHigh : (l == 1 ? u.cover : u.nearCover);
        bool there = l == 2 ? u.nearCover > 0.015 : (max(u.cover, u.coverHigh) > 0.015 && (l == 1 || DETAIL_1));
        lanes[l] = vec4(0.0);
        if (there) lanes[l] = drawLane(p, cell, float(l), drift, cover);
    }

    // The far clouds, and the sheet that closes an overcast sky.
    if (lanes[0].a > 0.5) { col = lanes[0].rgb; solid = 1.0; }
    if (lanes[1].a > 0.5) { col = lanes[1].rgb; solid = 1.0; }

    if (u.veil > 0.01) {
        float sheet = fbm3(vec2((p.x - u.laneDrift.y) / SCENE.y * 1.3, p.y / SCENE.y * 3.0) + 3.0);
        float body = mix(1.0, 0.45, smoothstep(u.deck * 0.6, SCENE.y, p.y));
        float amount = u.veil * body * (0.72 + 0.28 * sheet);
        // Solid overhead; it only breaks into dither where it thins out.
        if (amount > 0.30 + bayer8(cell) * 0.36) {
            float tone = stepped(clamp(0.20 + 0.55 * sheet - u.storm * 0.18, 0.0, 1.0), 3.0, cell);
            col = mix(u.cloudShade.rgb, u.cloudLight.rgb, tone);
            // The sun or moon shows through it as a pale disc with a ring.
            float dist = length(p - (floor(u.lightPos / u.pixel) + 0.5) * u.pixel) / u.bodyRadius;
            // In a downpour or a blizzard it does not show at all.
            float through = u.shine * (1.0 - smoothstep(0.45, 0.85, max(u.rain, u.snow)));
            if (dist < 1.1) col = mix(col, u.lightColor.rgb, 0.55 * through);
            else if (exp(-(dist - 1.1) / 0.9) * through > bayer8(cell) + 0.2) col = mix(col, u.lightColor.rgb, 0.35);
            solid = max(solid, 0.9);
        }
    }

    // Rain and snow that come down behind the windows.
    useGrid(ART);
    float slant = u.wind * 0.42;
    if (u.rain > 0.01) {
        float from = shaft(p, slant, 0.0) * gust(p.x);
        // One sheet of it, and on ultra a second.
        float behind = 0.0;
        for (int sheet = 0; sheet < 2; sheet++) {
            if (sheet == 1 && !DETAIL_3) break;
            behind = max(behind, rainHere(art, sheet == 0 ? 3.0 : 19.0, (0.20 + 0.50 * u.rain) * from));
        }
        if (from > 0.02 && behind > 0.5) {
            col = mix(col, u.rainColor.rgb, 0.45);
            solid = max(solid, 0.6);
        }
        if (DETAIL_3) {
            // Far off, a finer rain: half the size and half the speed of the
            // rest, and fainter. It is what gives the fall its depth. The near
            // rain keeps its size; this is behind it, not instead of it.
            GRID = u.pixel;
            K = 1.0;
            if (from > 0.02 && behind < 0.5 && rainHere(cell, 23.0, (0.22 + 0.55 * u.rain) * from) > 0.5) {
                col = mix(col, u.rainColor.rgb, 0.24);
                solid = max(solid, 0.35);
            }
            useGrid(ART);
        }
    }
    if (u.snow > 0.01) {
        float from = shaft(p, blow() * 0.8, 0.9) * mix(1.0, gust(p.x), 0.6);
        // One depth of it, and on ultra a second, finer.
        float behind = 0.0;
        for (int layer = 0; layer < 2; layer++) {
            if (layer == 1 && !DETAIL_3) break;
            vec3 kind = layer == 0 ? vec3(9.0, 14.0, 5.0) : vec3(7.0, 10.0, 29.0);
            behind = max(behind, snowHere(art, kind.x, kind.y, kind.z, (0.30 + 0.60 * u.snow) * from, 0.0));
        }
        if (from > 0.02 && behind > 0.5) {
            col = mix(col, u.snowColor.rgb, 0.6);
            solid = max(solid, 0.7);
        }
        if (DETAIL_3) {
            // And far off, fine snow: small, slow and faint.
            GRID = u.pixel;
            K = 1.0;
            if (from > 0.02 && behind < 0.5 && snowHere(cell, 8.0, 7.0, 17.0, (0.35 + 0.60 * u.snow) * from, 0.0) > 0.5) {
                col = mix(col, u.snowColor.rgb, 0.40);
                solid = max(solid, 0.45);
            }
            useGrid(ART);
        }
    }

    // The near clouds, which the rain and snow fall from. They are sky like
    // the rest: behind the windows, where they do not get in the way of
    // what is being worked on.
    if (u.nearCover > 0.015) {
        useGrid(u.pixel);
        vec4 near = lanes[2];
        if (near.a > 0.5) {
            col = near.rgb;
            // The clouds around a stroke light up.
            if (u.flash > 0.003) {
                vec3 origin = boltOrigin();
                if (u.flash * origin.z > 0.25 && exp(-abs(p.x - origin.x) / (SCENE.y * 0.5)) > bayer4(cell)) col = mix(col, u.flashColor.rgb, 0.6);
            }
            solid = 1.0;
        }
    }

    // Fireflies, on a warm, still, dry night: single lights down among the
    // windows and along the ground, never up in the sky with the clouds,
    // more of them the lower down. Each keeps to its own patch of air,
    // wandering about in it and coming and going.
    if (DETAIL_1 && u.fireflies > 0.01) {
        useGrid(ART);
        float plot = floor(22.0 * K);
        vec2 home = floor(art / plot);
        vec2 fh = hash22(home + 31.0);
        // Where the patch is, measured down from the top of the desktop:
        // none above it, and its wandering kept below it too.
        float below = ((home.y + 0.5) * plot * ART - u.deck - plot * ART * 0.5) / max(SCENE.y - u.deck, 1.0);
        if (below > 0.0 && fh.x < u.fireflies * (0.25 + 0.5 * smoothstep(0.0, 0.7, below))) {
            float ft = u.slowTime * (0.35 + 0.3 * fh.y);
            vec2 at = (home + 0.5) * plot + floor(plot * 0.32 * vec2(sin(ft + fh.x * 40.0), cos(ft * 0.8 + fh.y * 40.0)));
            float lit = smoothstep(0.35, 0.8, sin(u.slowTime * (1.1 + fh.y) + fh.x * 60.0));
            // A bright pixel in a small glow that comes and goes with it,
            // which is what tells it from a star.
            float reach = length(art - at);
            if (lit > 0.0 && (reach < 0.7 || lit * (1.0 - reach / 4.0) > 0.15 + 0.85 * bayer4(art))) {
                col = mix(col, u.fireflyColor.rgb, reach < 0.7 ? 1.0 : 0.7);
                solid = max(solid, reach < 0.7 ? 1.0 : 0.6);
            }
        }
        useGrid(u.pixel);
    }

    float alpha = 1.0 - (1.0 - u.skyAlpha) * (1.0 - solid);
    return vec4(col, alpha);
}

#endif

#ifdef FRONT_PASS

// ------------------------------------------------------- in front of it all

vec4 frontPass(vec2 p, vec2 cell) {
    vec3 col = vec3(0.0);
    float alpha = 0.0;
    float slant = u.wind * 0.42;
    // `cell` is this pixel on the canvas, `art` on the art's grid.
    vec2 art = floor(p / ART);

    // Lying snow is a shape, so it is worked out on the canvas. Where things
    // stop is the windows when the weather is physical and the ground
    // otherwise (surfaceRow is only ground below detail 2). How deep the
    // snow lies only matters within reach of a ledge: above that nothing has
    // settled and nothing stops.
    useGrid(u.pixel);
    float ground = floor(SCENE.y / GRID);
    float row = surfaceRow(cell.x);
    float deepest = (u.snowDepth * 2.0 + u.groundDepth) / GRID + 2.0;
    float pile = u.snowDepth + u.groundDepth > 0.5 && nearLedge(cell, deepest, 0.0) ? pileAt(cell.x) : 0.0;
    // The same level for what falls, which counts rows on the art's grid.
    useGrid(ART);
    float stop = floor((row - pile) * u.pixel / ART);

    // A strike needs a cloud to come out of. With none, there is no stroke
    // and nothing lights up.
    vec3 origin = u.flash > 0.003 ? boltOrigin() : vec3(0.0);
    float struck = u.flash * origin.z;
    if (struck > 0.12 && boltHere(art, origin) > 0.5) {
        col = u.flashColor.rgb;
        alpha = 1.0;
    }

    if (DETAIL_1) {
    if (u.rain > 0.01) {
        float from = shaft(p, slant, 0.0) * gust(p.x);
        float density = (0.25 + 0.75 * u.rain) * from;
        // On ultra a second sheet, a little thinner, landing and splashing
        // like the first.
        float falling_ = 0.0;
        for (int sheet = 0; sheet < 2; sheet++) {
            if (sheet == 1 && !DETAIL_3) break;
            falling_ = max(falling_, rainHere(art, sheet == 0 ? 41.0 : 67.0, sheet == 0 ? density : density * 0.85));
        }
        if (art.y < stop && from > 0.02 && falling_ > 0.5) {
            col = u.rainColor.rgb;
            // On ultra a drop catches the light at its head.
            if (DETAIL_3 && falling_ > 1.5) col = mix(u.rainColor.rgb, u.flashColor.rgb, 0.6);
            alpha = 1.0;
        }
        // Hard rain also comes down in front of the windows, and greys what
        // is behind it.
        float hard = smoothstep(0.75, 1.0, u.rain) * from;
        if (hard > 0.02) {
            if (rainHere(art, 131.0, 0.6 * hard) > 0.5) {
                col = u.rainColor.rgb;
                alpha = 1.0;
            } else if (alpha < 0.5) {
                // On ultra the spray is not an even screen of dots: it hangs
                // in banks that drift across with the wind and thin out
                // between. Below that it is the even screen.
                bool spray = DETAIL_3
                    ? hard * (0.05 + 0.44 * vnoise(vec2(p.x * 0.011 - u.time * 0.9 * u.wind, p.y * 0.017 - u.time * 0.5))) > 0.07 + bayer8(cell) * 0.93
                    : hard * 0.16 > bayer8(art + floor(u.time * 9.0));
                if (spray) {
                    col = u.rainColor.rgb;
                    alpha = 0.5;
                }
            }
        }

        float lit = splashHere(art, 0.25 + 0.75 * u.rain);
        if (lit > 0.02) {
            col = mix(u.rainColor.rgb, u.flashColor.rgb, 0.35 * lit);
            alpha = max(alpha, 0.55 + 0.45 * lit);
        }
    }

    if (u.snow > 0.01) {
        float from = shaft(p, blow() * 0.8, 0.9) * mix(1.0, gust(p.x), 0.6);
        if (art.y < stop && from > 0.02) {
            float density = (0.30 + 0.70 * u.snow) * from;
            // Two depths of it, the nearer in bigger flakes, and on ultra a
            // third between them. x: a flake's cell, y: how fast it falls,
            // z: what tells the layer apart, w: how thick it is.
            float flakes = 0.0;
            for (int layer = 0; layer < 3; layer++) {
                if (layer == 2 && !DETAIL_3) break;
                vec4 kind = layer == 0 ? vec4(13.0, 21.0, 43.0, 1.0)
                          : (layer == 1 ? vec4(21.0, 30.0, 97.0, 0.8) : vec4(17.0, 25.0, 61.0, 0.8));
                flakes = max(flakes, snowHere(art, kind.x, kind.y, kind.z, density * kind.w, layer == 1 ? 1.0 : 0.0));
            }
            if (flakes > 0.5) {
                col = u.snowColor.rgb;
                alpha = 1.0;
            }
            if (DETAIL_3) {
                // On ultra a finer snow drifts down among the rest: small, slow
                // and a shade dimmer.
                GRID = u.pixel;
                K = 1.0;
                if (flakes < 0.5 && cell.y < row - pile && snowHere(cell, 10.0, 9.0, 73.0, density * 0.7, 0.0) > 0.5) {
                    col = mix(u.snowColor.rgb, u.shadeColor.rgb, 0.35);
                    alpha = 1.0;
                }
                useGrid(ART);
            }
        }
        // A few big ones close to the eye, in front of everything.
        if (snowHere(art, 34.0, 44.0, 151.0, 0.30 * u.snow, 1.0) > 0.5) {
            col = u.snowColor.rgb;
            alpha = 1.0;
        }
    }

    if (u.hail > 0.01) {
        float from = shaft(p, 0.0, 0.0) * gust(p.x);
        if (art.y < stop && from > 0.02 && hailHere(art, (0.35 + 0.65 * u.hail) * from) > 0.5) {
            col = u.snowColor.rgb;
            alpha = 1.0;
        }
        if (DETAIL_2 && hailBounce(art, 0.35 + 0.65 * u.hail) > 0.5) {
            col = u.flashColor.rgb;
            alpha = 1.0;
        }
    }

    // Water running off the windows: the rain that lands on them, and their
    // own snow as it melts.
    if (DETAIL_2 && (u.rain > 0.01 || (u.thaw > 0.01 && u.snowDepth > 1.0))) {
        float water = runoffHere(art);
        if (water > 0.02) {
            col = mix(u.rainColor.rgb, u.flashColor.rgb, 0.35 * water);
            alpha = max(alpha, 0.55 + 0.45 * water);
        }
    }
    }

    // The rest is shapes again, on the canvas.
    useGrid(u.pixel);

    // Snow that has settled, lighter along its crest.
    if (pile > 0.5 && cell.y >= row - pile && cell.y < (row > ground - 0.5 ? ground : row)) {
        bool crest = cell.y < row - pile + K;
        col = crest ? u.snowColor.rgb : mix(u.snowColor.rgb, u.shadeColor.rgb, bayer4(cell) < 0.5 ? 0.55 : 0.30);
        // On ultra a crystal catches the light now and then.
        if (DETAIL_3 && hash12(cell * 1.31 + floor(u.slowTime * 1.3 + hash12(cell + 3.0) * 7.0)) > 0.9935) col = u.flashColor.rgb;
        alpha = 1.0;
    }
    if (DETAIL_2) {
    // Icicles under the windows, and what drips from them in a thaw.
    if (max(max(u.iceA.x, u.iceA.y), max(max(u.iceA.z, u.iceA.w), max(u.iceB.x, u.iceB.y))) > 1.0) {
        float ice = icicleHere(cell);
        if (ice > 0.5) {
            col = ice > 2.5 ? u.rainColor.rgb : (ice > 1.5 ? u.snowColor.rgb : mix(u.snowColor.rgb, u.rainColor.rgb, 0.55));
            alpha = 1.0;
        }
    }
    // And where it has rolled over the edges of the windows.
    if (u.snowDepth > 4.0 && lipHere(cell) > 0.5) {
        col = mix(u.snowColor.rgb, u.shadeColor.rgb, bayer4(cell) < 0.5 ? 0.45 : 0.20);
        alpha = 1.0;
    }
    // And in underneath them, from the drifts beside: only in the bottom
    // rows, and only where a window is overhead.
    if (u.groundDepth > 4.0 && row < ground - 0.5 && cell.y > ground - 40.0 * K) {
        float under = underAt(cell.x);
        if (under > 0.5 && cell.y >= ground - under && cell.y >= coverBottom(cell.x)) {
            bool crest = cell.y < ground - under + K;
            col = crest ? u.snowColor.rgb : mix(u.snowColor.rgb, u.shadeColor.rgb, bayer4(cell) < 0.5 ? 0.55 : 0.30);
            alpha = 1.0;
        }
    }
    }

    // Fog: banks rolling across, thick low down, as a dither over everything.
    if (u.fog > 0.02) {
        vec2 q = p / SCENE.y;
        float banks = vnoise(vec2(q.x * 1.3 - u.slowTime * 0.035 * u.wind, q.y * 2.6 + u.slowTime * 0.004)) * 0.6
                    + vnoise(vec2(q.x * 3.4 - u.slowTime * 0.060 * u.wind, q.y * 6.0 - u.slowTime * 0.008)) * 0.4;
        float density = clamp(u.fog * 0.82 * (0.40 + 0.60 * smoothstep(0.05, 0.75, p.y / SCENE.y)) * (0.45 + 0.95 * banks), 0.0, 0.80);
        // A trace of mist is left out rather than drawn as a grid of dots.
        if (density > 0.17 + bayer8(cell) * 0.83) {
            col = u.fogColor.rgb;
            alpha = 1.0;
        }
    }

    if (struck > 0.3 && struck * 0.20 > bayer8(cell) && alpha < 0.5) {
        col = u.flashColor.rgb;
        alpha = 0.45;
    }

    return vec4(col, alpha);
}

#endif

void main() {
    SCENE = u.canvas * u.pixel;
    ART = max(u.pixel, 4.0);
    SKY = SCENE.y * clamp(u.deck / (0.335 * SCENE.y), 0.5, 1.0);
    useGrid(u.pixel);
    loadWindows();
    vec2 cell = floor(qt_TexCoord0 * u.canvas);
    vec2 p = (cell + 0.5) * u.pixel;
#ifdef FRONT_PASS
    vec4 c;
    if (onWindow(cell)) {
        c = vec4(0.0);
        if (DETAIL_2 && u.snowDepth > 4.0 && drapeHere(cell) > 0.5)
            c = vec4(mix(u.snowColor.rgb, u.shadeColor.rgb, bayer4(cell) < 0.5 ? 0.45 : 0.20), 1.0);
    } else {
        c = frontPass(p, cell);
    }
#else
    vec4 c = skyPass(p, cell);
#endif
    fragColor = vec4(c.rgb * c.a, c.a) * u.qt_Opacity;
}
