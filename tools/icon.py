#!/usr/bin/env python3
"""Draw Omasky's icon and its banner, as pixel art.

  tools/icon.py icon docs/icon.svg icon.ppm
  tools/icon.py social docs/social.svg social.ppm

The icon is a 32x32 tile; the banner is 128x64, the two-to-one shape GitHub
wants for a repository's social preview. Each writes the SVG, and the same
pixels as a .ppm with their mask in <name>.ppm.mask, from which

  magick icon.ppm icon.ppm.mask -alpha off -compose CopyOpacity -composite -scale 1600% docs/icon.png
  magick social.ppm -scale 1000% docs/social.png

make the PNGs (512x512 and 1280x640).
"""
import sys

SKY = ["#171c45", "#1f2150", "#2b2558", "#3a2b5c"]
STAR = "#8e93cf"
SUN, SUN_CORE, SUN_GLINT = "#f6a95e", "#ffd29a", "#fff0d6"
CLOUD, CLOUD_MID, CLOUD_SHADE = "#f7e6d8", "#c9badb", "#8d92e0"
RAIN, SPLASH = "#a6d8f5", "#d9efff"
FRAME, GLASS, INK, DIM = "#8d92e0", "#0a0e2a", "#f7e6d8", "#6a70c2"

# Five by seven, for the name.
LETTERS = {
    "O": [".###.", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
    "M": ["#...#", "##.##", "#.#.#", "#.#.#", "#...#", "#...#", "#...#"],
    "A": [".###.", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
    "S": [".####", "#....", "#....", ".###.", "....#", "....#", "####."],
    "K": ["#...#", "#..#.", "#.#..", "##...", "#.#..", "#..#.", "#...#"],
    "Y": ["#...#", "#...#", ".#.#.", "..#..", "..#..", "..#..", "..#.."],
}


class Canvas:
    def __init__(self, width, height, chamfer=0):
        self.width, self.height = width, height
        self.grid = [[None] * width for _ in range(height)]
        # A night sky going to dusk, in bands, with a row of checker where
        # one meets the next. `chamfer` steps the corners off.
        edges = [round(height * share) for share in (0.28, 0.5, 0.72)]
        for y in range(height):
            for x in range(width):
                if min(x, width - 1 - x) + min(y, height - 1 - y) < chamfer:
                    continue
                band = sum(1 for edge in edges if y >= edge)
                if y + 1 in edges and (x + y) % 2 == 0:
                    band += 1
                self.grid[y][x] = SKY[band]

    def put(self, x, y, color):
        if 0 <= x < self.width and 0 <= y < self.height and self.grid[y][x] is not None:
            self.grid[y][x] = color

    def dots(self, cells, color):
        for x, y in cells:
            self.put(x, y, color)

    def disc(self, cx, cy, radius, color):
        for y in range(self.height):
            for x in range(self.width):
                if ((x - cx) ** 2 + (y - cy) ** 2) ** 0.5 < radius:
                    self.put(x, y, color)

    def cloud(self, heaps, left, right, base):
        """Heaps (cx, cy, r) on a flat base: lit on top, shaded underneath."""
        for y in range(base + 1):
            for x in range(self.width):
                inside = any(((x - cx) ** 2 + (y - cy) ** 2) ** 0.5 < r for cx, cy, r in heaps)
                if inside or (left <= x <= right and base - 2 <= y <= base):
                    self.put(x, y, CLOUD if y < base - 2 else CLOUD_MID if y < base else CLOUD_SHADE)

    def window(self, left, top, right, bottom, bar=1):
        for y in range(top, bottom + 1):
            for x in range(left, right + 1):
                edge = y < top + bar or y == bottom or x in (left, right)
                self.put(x, y, FRAME if edge else GLASS)

    def rain(self, drops, length=2):
        for x, y in drops:
            for i in range(length):
                self.put(x, y + i, RAIN)

    def text(self, word, left, top, scale, color):
        x = left
        for letter in word:
            for row, line in enumerate(LETTERS[letter]):
                for col, mark in enumerate(line):
                    if mark == "#":
                        for dy in range(scale):
                            for dx in range(scale):
                                self.put(x + col * scale + dx, top + row * scale + dy, color)
            x += 6 * scale

    def save(self, svg_path, ppm_path):
        w, h = self.width, self.height
        svg = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %d %d" shape-rendering="crispEdges">' % (w, h)]
        for y in range(h):
            x = 0
            while x < w:
                color = self.grid[y][x]
                if color is None:
                    x += 1
                    continue
                run = 1
                while x + run < w and self.grid[y][x + run] == color:
                    run += 1
                svg.append('<rect x="%d" y="%d" width="%d" height="1" fill="%s"/>' % (x, y, run, color))
                x += run
        svg.append("</svg>")
        open(svg_path, "w").write("\n".join(svg) + "\n")
        with open(ppm_path, "w") as out:
            out.write("P3\n%d %d\n255\n" % (w, h))
            for row in self.grid:
                out.write(" ".join("%d %d %d" % tuple(int((c or "#000000")[i:i + 2], 16) for i in (1, 3, 5)) for c in row) + "\n")
        with open(ppm_path + ".mask", "w") as out:
            out.write("P2\n%d %d\n255\n" % (w, h))
            for row in self.grid:
                out.write(" ".join("255" if c else "0" for c in row) + "\n")


def icon():
    c = Canvas(32, 32, chamfer=3)
    c.dots([(5, 5), (11, 3), (4, 17), (29, 6), (14, 6), (28, 18), (8, 8)], STAR)
    # The sun, behind the cloud, and a short ray each way that is not.
    c.disc(21.5, 9.5, 5.3, SUN)
    c.disc(21.5, 9.5, 3.6, SUN_CORE)
    c.put(20, 8, SUN_GLINT)
    c.dots([(21, 2), (22, 2), (28, 9), (28, 10), (26, 4), (26, 15), (17, 4)], SUN)
    c.cloud([(7.5, 14.0, 2.7), (12.5, 11.4, 3.9), (17.6, 13.4, 2.9)], 5, 20, 16)
    # Rain, where it lands, and a window under it all.
    c.rain([(7, 18), (11, 19), (15, 18), (19, 19)])
    c.dots([(10, 21), (12, 21), (18, 21), (20, 21)], SPLASH)
    c.window(5, 22, 26, 29)
    c.dots([(x, 24) for x in range(8, 14)], INK)
    c.dots([(x, 26) for x in range(8, 19)] + [(x, 27) for x in range(8, 16)], DIM)
    return c


def social():
    c = Canvas(128, 64)
    c.dots([(6, 5), (17, 11), (30, 4), (44, 8), (58, 3), (70, 12), (84, 5), (121, 9), (124, 22), (3, 20),
            (9, 30), (118, 34), (5, 44), (123, 48), (12, 56), (116, 58)], STAR)
    # The sun, low on the right, behind the nearest cloud.
    c.disc(103.5, 15.5, 9.3, SUN)
    c.disc(103.5, 15.5, 6.4, SUN_CORE)
    c.dots([(100, 12), (101, 12), (100, 13)], SUN_GLINT)
    c.dots([(103, 2), (104, 2), (103, 3), (104, 3), (116, 15), (117, 15), (116, 16), (117, 16),
            (112, 6), (113, 6), (112, 7), (113, 25), (114, 25), (113, 26), (93, 5), (94, 5), (94, 6)], SUN)
    c.cloud([(74, 20, 5.5), (82, 16, 7.5), (91, 20, 5.8)], 69, 96, 25)
    c.cloud([(33, 15, 5.2), (41, 11, 7.2), (50, 15, 5.6), (57, 17, 3.6)], 28, 60, 20)
    c.cloud([(13, 22, 3.6), (19, 20, 4.4), (24, 23, 3.0)], 10, 27, 26)
    # Rain out of each cloud, down to the window or past it.
    c.rain([(31, 23), (37, 25), (43, 22), (49, 26), (55, 23), (40, 29), (52, 30), (34, 28), (46, 29),
            (72, 27), (78, 29), (84, 27), (90, 30), (94, 28), (81, 31),
            (12, 29), (18, 31), (23, 29), (14, 36), (9, 41), (16, 47), (11, 53)])
    c.dots([(33, 33), (35, 33), (45, 33), (47, 33), (54, 33), (56, 33), (77, 33), (79, 33), (89, 33), (91, 33)], SPLASH)
    # The window, with the name in it the way a terminal would have it.
    c.window(22, 34, 105, 58, bar=3)
    c.dots([(99, 35), (101, 35), (103, 35)], GLASS)
    c.text("OMASKY", 29, 40, 2, INK)
    c.dots([(x, 55) for x in range(29, 37)], DIM)
    return c


if __name__ == "__main__":
    if len(sys.argv) != 4 or sys.argv[1] not in ("icon", "social"):
        sys.exit(__doc__)
    (icon() if sys.argv[1] == "icon" else social()).save(sys.argv[2], sys.argv[3])
