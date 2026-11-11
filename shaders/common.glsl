// Shared by every Omasky shader: noise, and where the clouds are. The cloud
// and precipitation shaders both ask cloudAt(), so rain falls from exactly
// the clouds that are drawn. tools/build-shaders.sh pastes this file in where
// a shader says #include "common.glsl".

float hash11(float p) {
    p = fract(p * 0.1031);
    p *= p + 33.33;
    p *= p + p;
    return fract(p);
}

float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

vec2 hash22(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.xx + p3.yz) * p3.zy);
}

float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 s = f * f * (3.0 - 2.0 * f);
    float a = hash12(i);
    float b = hash12(i + vec2(1.0, 0.0));
    float c = hash12(i + vec2(0.0, 1.0));
    float d = hash12(i + vec2(1.0, 1.0));
    return mix(mix(a, b, s.x), mix(c, d, s.x), s.y);
}

float fbm3(vec2 p) {
    float sum = 0.0;
    float amp = 0.5;
    for (int i = 0; i < 3; i++) {
        sum += amp * vnoise(p);
        p = mat2(1.6, 1.2, -1.2, 1.6) * p;
        amp *= 0.5;
    }
    return sum / 0.875;
}

// Clouds ride three lanes: 0 far and high, 1 between, 2 near and low. The
// near lane is the one weather falls from.

// Half the width of a lane's typical cloud, as a fraction of screen height.
float laneSize(float lane) {
    return lane < 0.5 ? 0.052 : (lane < 1.5 ? 0.082 : 0.128);
}

// How far down the sky above the desktop a lane's cloud bases sit.
float laneLevel(float lane) {
    return lane < 0.5 ? 0.22 : (lane < 1.5 ? 0.42 : 0.64);
}

// Each lane is cut into cells this wide, one cloud to a cell.
float lanePitch(float lane, float height) {
    return laneSize(lane) * height * 3.3;
}

// The cell under x, for a lane that has blown `drift` pixels downwind.
float laneCell(float lane, float x, float drift, float height) {
    return floor((x - drift) / lanePitch(lane, height));
}

// One cloud: x = centre, y = base, z = half-width, w = how much of it is
// there (0..1). A cell's cloud forms once the sky's cover passes the cell's
// own threshold, so more cover means more clouds, and bigger ones.
//   cover   0..1
//   deck    y of the desktop's top edge; the clouds stay above it
//   height  screen height
vec4 cloudAt(float lane, float cell, float drift, float cover, float deck, float height) {
    vec2 id = vec2(cell, lane * 31.0 + 7.0);
    float h1 = hash12(id);
    float h2 = hash12(id + 13.1);
    float h3 = hash12(id + 29.7);
    // The far lanes fill in later, so a sky with few clouds has them near.
    float chance = hash12(id + 47.3);
    float threshold = 0.04 + 0.92 * (lane < 0.5 ? pow(chance, 0.55) : (lane < 1.5 ? pow(chance, 0.75) : chance));
    float presence = smoothstep(threshold - 0.05, threshold + 0.05, cover);

    float size = laneSize(lane) * height;
    // More cover means bigger clouds, and as the sky closes they swell until
    // they run into one another: a deck with no sky between.
    float halfWidth = size * (0.70 + 0.55 * h2) * mix(0.85, 1.30 + 0.60 * smoothstep(0.7, 1.0, cover), cover) * (0.55 + 0.45 * presence);
    float cx = (cell + 0.5 + (h1 - 0.5) * 0.5) * lanePitch(lane, height) + drift;
    float base = deck * laneLevel(lane) + (h3 - 0.5) * size * 0.45;
    return vec4(cx, base, halfWidth, presence);
}

// How much weather falls at p from the near lane: 1 under the middle of a
// cloud, fading out toward its edges, nothing above its base and nothing
// where no cloud is. That is all the rain and snow there is: it comes out of
// the clouds that are drawn, however hard it falls and however few they
// are, so a single cloud can pour and a clear patch stays dry. Only where
// the lane has closed into one deck does it fall all along it. `slant` is
// how far downwind a drop travels per pixel it falls, and `spread` widens
// the shaft with distance fallen (snow wanders, rain does not).
float falling(vec2 p, float drift, float cover, float deck, float height, float slant, float spread) {
    float amount = 0.0;
    float home = laneCell(2.0, p.x - (p.y - deck * laneLevel(2.0)) * slant, drift, height);
    for (int k = -1; k <= 1; k++) {
        vec4 c = cloudAt(2.0, home + float(k), drift, cover, deck, height);
        if (c.w < 0.01) continue;
        float fallen = p.y - c.y;
        if (fallen < -6.0) continue;
        // Where this drop left the cloud.
        float from = p.x - fallen * slant;
        float reach = c.z * (1.04 + spread * fallen / height);
        float across = 1.0 - smoothstep(0.58, 1.0, abs(from - c.x) / reach);
        amount = max(amount, c.w * across * smoothstep(-6.0, 16.0, fallen));
    }
    float closed = smoothstep(0.86, 1.0, cover) * smoothstep(-6.0, 16.0, p.y - deck * laneLevel(2.0));
    return max(amount, closed);
}
