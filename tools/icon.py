#!/usr/bin/env python3
"""Draw Omasky's icon, pixel art on a 32x32 grid.

  tools/icon.py docs/icon.svg icon.ppm

writes the SVG, and the pixels as icon.ppm with their mask in icon.ppm.mask;
  magick icon.ppm icon.ppm.mask -alpha off -compose CopyOpacity -composite -scale 1600% docs/icon.png
makes the PNG from those.
"""
import sys

N = 32
grid = [[None] * N for _ in range(N)]

def put(x, y, color):
    if 0 <= x < N and 0 <= y < N and grid[y][x] is not None:
        grid[y][x] = color

# The tile: a square with its corners stepped off, a night sky going to dusk.
SKY = ["#171c45", "#1f2150", "#2b2558", "#3a2b5c"]
for y in range(N):
    for x in range(N):
        cut = min(x, N - 1 - x) + min(y, N - 1 - y)
        if cut < 3:
            continue
        band = 0 if y < 9 else 1 if y < 16 else 2 if y < 23 else 3
        # A row of checker where one band meets the next.
        if y in (8, 15, 22) and (x + y) % 2 == 0:
            band += 1
        grid[y][x] = SKY[band]

for x, y in [(5, 5), (11, 3), (4, 17), (29, 6), (14, 6), (28, 18), (8, 8)]:
    put(x, y, "#8e93cf")

# The sun, behind the cloud.
for y in range(N):
    for x in range(N):
        d = ((x - 21.5) ** 2 + (y - 9.5) ** 2) ** 0.5
        if d < 5.3:
            put(x, y, "#f6a95e")
        if d < 3.6:
            put(x, y, "#ffd29a")
put(20, 8, "#fff0d6")
# Its rays: a short mark out from it each way that is not behind the cloud.
for x, y in [(21, 2), (22, 2), (28, 9), (28, 10), (26, 4), (26, 15), (17, 4)]:
    put(x, y, "#f6a95e")

# The cloud: three heaps on a flat base, lit on top, shaded underneath.
for y in range(N):
    for x in range(N):
        inside = any(((x - cx) ** 2 + (y - cy) ** 2) ** 0.5 < r for cx, cy, r in [(7.5, 14.0, 2.7), (12.5, 11.4, 3.9), (17.6, 13.4, 2.9)])
        inside = inside or (5 <= x <= 20 and 14 <= y <= 16)
        if inside and y <= 16:
            put(x, y, "#f7e6d8" if y < 14 else "#c9badb" if y < 16 else "#8d92e0")

# Rain, and where it lands.
for x, y in [(7, 18), (7, 19), (11, 19), (11, 20), (15, 18), (15, 19), (19, 19), (19, 20)]:
    put(x, y, "#a6d8f5")
for x, y in [(10, 21), (12, 21), (18, 21), (20, 21)]:
    put(x, y, "#d9efff")

# A window under it all.
for y in range(22, 30):
    for x in range(5, 27):
        edge = y in (22, 29) or x in (5, 26)
        put(x, y, "#8d92e0" if edge else "#0a0e2a")
for x in range(8, 14):
    put(x, 24, "#f7e6d8")
for x in range(8, 19):
    put(x, 26, "#6a70c2")
for x in range(8, 16):
    put(x, 27, "#6a70c2")

svg = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %d %d" shape-rendering="crispEdges">' % (N, N)]
for y in range(N):
    x = 0
    while x < N:
        c = grid[y][x]
        if c is None:
            x += 1
            continue
        run = 1
        while x + run < N and grid[y][x + run] == c:
            run += 1
        svg.append('<rect x="%d" y="%d" width="%d" height="1" fill="%s"/>' % (x, y, run, c))
        x += run
svg.append("</svg>")
open(sys.argv[1], "w").write("\n".join(svg) + "\n")

# And as plain pixels with an alpha mask, for a PNG.
with open(sys.argv[2], "w") as out:
    out.write("P3\n%d %d\n255\n" % (N, N))
    for row in grid:
        out.write(" ".join("%d %d %d" % tuple(int((c or "#000000")[i:i + 2], 16) for i in (1, 3, 5)) for c in row) + "\n")
with open(sys.argv[2] + ".mask", "w") as out:
    out.write("P2\n%d %d\n255\n" % (N, N))
    for row in grid:
        out.write(" ".join("255" if c else "0" for c in row) + "\n")
