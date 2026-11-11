#version 440

// Omasky's heat: on a really hot day the air over the ground bends what is
// behind it, the way old games did it. Whole rows of the picture slide left
// and right, a pixel or two, in waves that rise off the ground and thin out
// as they climb. It is applied to the background: the wallpaper and the sky
// over it, which `source` holds as one picture. The windows are in front of
// all that and stay straight.

layout(location = 0) in vec2 qt_TexCoord0;
layout(location = 0) out vec4 fragColor;

layout(std140, binding = 0) uniform buf {
    mat4 qt_Matrix;
    float qt_Opacity;

    float time;
    float heat;         // 0..1
    float pixel;        // logical pixels to a canvas pixel
    vec2 resolution;
    vec4 glowColor;
} u;

layout(binding = 1) uniform sampler2D source;

void main() {
    vec2 uv = qt_TexCoord0;
    float row = floor(uv.y * u.resolution.y / u.pixel);
    // Strongest just above the ground.
    float low = smoothstep(0.10, 1.0, uv.y);
    // The waves: bands of bent air a good way apart, climbing, each rising
    // band bending the rows inside it more than the still air between.
    float band = 0.5 + 0.5 * sin(uv.y * 26.0 + u.time * 1.9);
    float strength = u.heat * (0.20 + 0.80 * low * low) * (0.35 + 0.65 * band * band);
    float wave = sin(row * 0.55 + u.time * 4.2) + 0.6 * sin(row * 0.21 - u.time * 2.7);
    float shift = floor(wave * strength * 2.6 + 0.5) * u.pixel;

    vec4 scene = texture(source, vec2(uv.x + shift / u.resolution.x, uv.y));
    // Every few rows the hot air catches the light.
    float glare = u.heat * low * step(0.82, fract(row * 0.37 + floor(u.time * 3.0) * 0.21)) * 0.10;
    scene.rgb = mix(scene.rgb, u.glowColor.rgb * scene.a, glare);
    fragColor = scene * u.qt_Opacity;
}
