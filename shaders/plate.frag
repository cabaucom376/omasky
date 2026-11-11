#version 440

// How a pass of the weather is put on screen when words sit in its corner.
// The pass is a small picture scaled up; this does the scaling, and in the
// corner it also blurs the picture. The sky behind the words is pulled
// toward the tone that sets them off as well; the rain, snow and fog in
// front of them are thinned out instead, since a tone laid there would fall
// on the windows too. All of it is strongest in the corner and falls away
// on a long, soft curve. There can be a second such patch out of the top
// right corner, for what is written there.
//
// There is no edge to find, and nothing is laid over anything. Where the
// blur and the tone have fallen to nothing this reads each of the picture's
// pixels from its middle, which is the picture scaled up exactly; and the
// sky is drawn once, here, so a sky that lets the wallpaper through is not
// doubled in the corner. The tone is laid in on its own account, however
// thin the sky is, so the words read over any wallpaper.

layout(location = 0) in vec2 qt_TexCoord0;
layout(location = 0) out vec4 fragColor;

layout(std140, binding = 0) uniform buf {
    mat4 qt_Matrix;
    float qt_Opacity;

    float blur;         // 0 none .. 1 full
    float tint;         // how far toward `scrim`, at its strongest
    float grain;        // screen pixels to one pixel of `source`
    float fade;         // how far the picture thins out, at its strongest
    float guard;        // 1: the windows' own pixels are left as the picture has them
    float pixel;        // logical pixels to one pixel of `source`
    vec2 canvas;        // `source`, in its own pixels
    vec2 texel;         // one of them, as a share of it
    vec2 extent;        // how much of the picture the patch takes, each way
    vec2 extentRight;   // the same for a second patch, in the top right corner
    vec2 core;          // how far from its corner each patch is at its full
    vec2 coreRight;     // strength, before it starts to fall away
    vec4 scrim;
    // The windows and which of them are windows, as scene.frag has them.
    vec4 spare;         // x: the first place a window has left, y: the first floating window
    vec4 w0;
    vec4 w1;
    vec4 w2;
    vec4 w3;
    vec4 w4;
    vec4 w5;
} u;

layout(binding = 1) uniform sampler2D source;

// scene.frag's own test, pixel for pixel: whether one of the picture's
// pixels touches a window. Those it has left empty, bar the fringe of snow
// over a window's top edge, and they must stay as it left them: a blur
// would carry the rain beside a window onto it.
bool touches(vec4 w, vec2 cell) {
    return w.z > 0.5 && (cell.x + 1.0) * u.pixel > w.x && cell.x * u.pixel < w.x + w.z
        && (cell.y + 1.0) * u.pixel > w.y && cell.y * u.pixel < w.y + w.w;
}

bool isWindow(float index) {
    return index < u.spare.x - 0.5 || index > u.spare.y - 0.5;
}

bool onWindow(vec2 cell) {
    return (touches(u.w0, cell) && isWindow(0.0)) || (touches(u.w1, cell) && isWindow(1.0))
        || (touches(u.w2, cell) && isWindow(2.0)) || (touches(u.w3, cell) && isWindow(3.0))
        || (touches(u.w4, cell) && isWindow(4.0)) || (touches(u.w5, cell) && isWindow(5.0));
}

// How far out of a patch a point is, measured from the patch's corner: 0
// anywhere within `core` of the corner, which is where the words are, and 1
// along the patch's far edges.
float outOf(vec2 from, vec2 extent, vec2 core) {
    return length(max(from - core, vec2(0.0)) / max(extent - core, vec2(0.0001)));
}

void main() {
    vec2 uv = qt_TexCoord0;
    // The picture's own pixel under this one, read from its middle. The
    // bias keeps the read on the picture itself and off its mipmaps, which
    // the jump from one pixel to the next would otherwise bring in.
    vec2 exact = (floor(uv * u.canvas) + 0.5) * u.texel;

    // 0 under the words, 1 along the patch's far edges. There may be two
    // patches, one out of the top left corner and one out of the top right,
    // each its own size; a pixel goes by whichever it is further into.
    float d = min(outOf(uv, u.extent, u.core), outOf(vec2(1.0 - uv.x, uv.y), u.extentRight, u.coreRight));
    if (d >= 1.0 || (u.guard > 0.5 && onWindow(floor(uv * u.canvas)))) {
        fragColor = texture(source, exact, -4.0) * u.qt_Opacity;
        return;
    }
    // A bell: it eases away from the corner and is windowed to reach exactly
    // nothing before the far edges, with no slope left when it gets there.
    float window = 1.0 - smoothstep(0.55, 1.0, d);
    float fall = exp(-d * d * 3.4) * window * window;

    // The blur is counted in doublings of a screen pixel. The picture's own
    // pixels are already `grain` screen pixels across, so the first few
    // doublings are had by letting neighbouring pixels run together (reading
    // between their middles), and only what is left comes from the mipmaps,
    // each step of which doubles it again. A few taps spaced to match smooth
    // out the blockiness a single coarse sample would have. Where the blur
    // is nothing all five read the same pixel from its middle: the picture,
    // untouched.
    float level = u.blur * fall * 4.6;
    float coarse = max(log2(max(u.grain, 1.0)), 0.0001);
    vec2 at = mix(exact, uv, clamp(level / coarse, 0.0, 1.0));
    float deeper = max(level - coarse, 0.0);
    vec2 reach = u.texel * (exp2(deeper) - 1.0) * 0.8;
    // The picture is drawn `grain` times its size, which on its own keeps
    // every read on the picture itself; the bias has to make that up before
    // it reaches the mipmaps at all.
    float lod = deeper > 0.0001 ? deeper + coarse : -4.0;
    vec4 sum = texture(source, at, lod) * 0.28
             + texture(source, at + reach * vec2( 1.0,  0.6), lod) * 0.18
             + texture(source, at + reach * vec2(-0.6,  1.0), lod) * 0.18
             + texture(source, at + reach * vec2(-1.0, -0.6), lod) * 0.18
             + texture(source, at + reach * vec2( 0.6, -1.0), lod) * 0.18;

    // Toward the tone, which is solid: it covers what is behind as well.
    // Then thinned, where that is asked for.
    float tone = u.tint * fall;
    fragColor = (sum * (1.0 - tone) + vec4(u.scrim.rgb, 1.0) * tone) * (1.0 - u.fade * fall) * u.qt_Opacity;
}
