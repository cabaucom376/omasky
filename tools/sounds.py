#!/usr/bin/env python3
"""Make Omasky's sounds: rain, wind and thunder, from nothing but noise.

  tools/sounds.py            writes sounds/rain.wav, wind.wav and thunder.wav

They are synthesised rather than recorded, so there is nobody's recording
to license and anyone can rebuild them exactly: the random numbers are
seeded. Rain and wind are loops whose end runs into their beginning; thunder
is a single clap. All are mono, 16 bit, 22.05 kHz, which is as much as the
kind of sound needs and keeps the three of them near 600 KB.

No dependencies beyond Python: the filters are one-pole and written out.
"""
import math
import os
import random
import struct
import wave

RATE = 22050
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def noise(n, rng):
    return [rng.uniform(-1.0, 1.0) for _ in range(n)]


def lowpass(x, cutoff, passes=1):
    """One-pole low-pass; `cutoff` in Hz, or a function of time in seconds."""
    for _ in range(passes):
        y, out = 0.0, []
        for i, v in enumerate(x):
            fc = cutoff(i / RATE) if callable(cutoff) else cutoff
            y += (1.0 - math.exp(-2.0 * math.pi * fc / RATE)) * (v - y)
            out.append(y)
        x = out
    return x


def highpass(x, cutoff, passes=1):
    for _ in range(passes):
        low = lowpass(x, cutoff)
        x = [a - b for a, b in zip(x, low)]
    return x


def loop(x, seconds):
    """Fold the last `seconds` into the first, so the end meets the start."""
    fade = int(seconds * RATE)
    n = len(x) - fade
    out = x[:n]
    for i in range(fade):
        w = 0.5 - 0.5 * math.cos(math.pi * i / fade)
        out[i] = x[i] * w + x[n + i] * (1.0 - w)
    return out


def level(x, peak):
    top = max(abs(v) for v in x) or 1.0
    return [v * peak / top for v in x]


def save(name, x):
    path = os.path.join(ROOT, "sounds", name)
    with wave.open(path, "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(RATE)
        out.writeframes(b"".join(struct.pack("<h", int(max(-1.0, min(1.0, v)) * 32767)) for v in x))
    print(f"{path}: {len(x) / RATE:.1f} s, {os.path.getsize(path) // 1024} KB")


def rain(seconds=4.0):
    """A steady fall: a hiss, and over it the patter of single drops."""
    rng = random.Random(11)
    n = int((seconds + 0.5) * RATE)
    hiss = lowpass(highpass(noise(n, rng), 1200, 2), 6500, 2)
    patter = [0.0] * n
    for _ in range(int(seconds * 260)):
        at, loud, length = rng.randrange(n - 400), rng.uniform(0.2, 1.0) ** 2, rng.randrange(40, 160)
        for i in range(length):
            patter[at + i] += loud * rng.uniform(-1.0, 1.0) * math.exp(-5.0 * i / length)
    patter = lowpass(highpass(patter, 1800), 5200)
    mixed = [0.55 * h + 1.6 * p for h, p in zip(hiss, patter)]
    return level(loop(mixed, 0.5), 0.5)


def wind(seconds=6.0):
    """Air moving: low noise whose pitch and strength rise and fall. The
    swells are whole numbers of cycles to the loop, so it comes round."""
    rng = random.Random(23)
    n = int((seconds + 0.75) * RATE)
    turn = 2.0 * math.pi / seconds

    def pitch(t):
        return 330.0 + 170.0 * math.sin(turn * t + 0.7) + 80.0 * math.sin(2.0 * turn * t + 2.1)

    air = lowpass(noise(n, rng), pitch, 2)
    air = highpass(air, 70)
    out = []
    for i, v in enumerate(air):
        t = i / RATE
        swell = 0.62 + 0.26 * math.sin(turn * t + 0.3) + 0.12 * math.sin(3.0 * turn * t + 1.4)
        out.append(v * swell)
    return level(loop(out, 0.75), 0.5)


def thunder(seconds=4.5):
    """A clap and what follows it: a short hard crack, then a low rumble
    that rolls two or three times as it dies away."""
    rng = random.Random(37)
    n = int(seconds * RATE)
    crack = lowpass(highpass(noise(n, rng), 180), 1700)
    rumble = lowpass(noise(n, rng), 95, 3)
    rolls = [(rng.uniform(0.5, 2.6), rng.uniform(0.35, 0.8), rng.uniform(0.18, 0.4)) for _ in range(3)]
    out = []
    for i in range(n):
        t = i / RATE
        snap = math.exp(-t / 0.07) * min(1.0, t / 0.004)
        body = min(1.0, t / 0.06) * math.exp(-t / 1.5)
        for at, loud, wide in rolls:
            body += loud * math.exp(-((t - at) / wide) ** 2) * math.exp(-t / 2.6)
        out.append(0.5 * crack[i] * snap + 9.0 * rumble[i] * body)
    # Out to nothing by the end.
    tail = int(0.4 * RATE)
    for i in range(tail):
        out[n - tail + i] *= 1.0 - i / tail
    return level(out, 0.9)


if __name__ == "__main__":
    os.makedirs(os.path.join(ROOT, "sounds"), exist_ok=True)
    save("rain.wav", rain())
    save("wind.wav", wind())
    save("thunder.wav", thunder())
