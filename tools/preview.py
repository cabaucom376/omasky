#!/usr/bin/env python3
"""Render Omasky's shaders offscreen, through the GPU, into a PNG.

Usage: preview.py <scene.json> <out.png>
       preview.py --grid <columns> <out.png> <scene.json>...

The second form renders every scene and tiles them at half size into one
contact sheet, for comparing conditions side by side.

The scene comes from tools/scene.js, which asks Model.js for the same
uniforms the running plugin would set. Each layer is one of:

    {"shader": "sky", "uniforms": {...}}       a full-screen pass of that .qsb
    {"rect": [x, y, w, h], "color": "#rrggbb"}  a stand-in for the windows
    {"shader": "plate", "region": [x, y, w, h], "uniforms": {...}}
                                                a pass over one region that reads
                                                what is already drawn there as its
                                                `source` texture

Layers are blended in order with premultiplied alpha, as Qt Quick blends a
ShaderEffect, over the scene's "backdrop" color standing in for the wallpaper.
No window opens: the context is surfaceless EGL on the DRM render node, the
way Hyprland's own is, so this draws with the GPU the plugin will run on.
"""

import ctypes
import glob
import json
import os
import re
import struct
import subprocess
import sys
import zlib

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

EGL_PLATFORM_GBM_KHR = 0x31D7
EGL_OPENGL_ES_API = 0x30A0
EGL_CONTEXT_MAJOR_VERSION = 0x3098
EGL_NONE = 0x3038

GL_FRAGMENT_SHADER, GL_VERTEX_SHADER = 0x8B30, 0x8B31
GL_COMPILE_STATUS, GL_LINK_STATUS = 0x8B81, 0x8B82
GL_TEXTURE_2D, GL_RGBA, GL_UNSIGNED_BYTE = 0x0DE1, 0x1908, 0x1401
GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_FRAMEBUFFER_COMPLETE = 0x8D40, 0x8CE0, 0x8CD5
GL_TEXTURE_MIN_FILTER, GL_TEXTURE_MAG_FILTER, GL_LINEAR = 0x2801, 0x2800, 0x2601
GL_COLOR_BUFFER_BIT, GL_BLEND, GL_SCISSOR_TEST = 0x4000, 0x0BE2, 0x0C11
GL_ONE, GL_ONE_MINUS_SRC_ALPHA = 1, 0x0303
GL_FLOAT, GL_TRIANGLE_STRIP = 0x1406, 0x0005
GL_RENDERER = 0x1F01

VERTEX = b"""
attribute vec2 a_pos;
varying vec2 qt_TexCoord0;
void main() {
    // Qt Quick's texture coordinates run down the screen from the top left.
    qt_TexCoord0 = vec2(a_pos.x * 0.5 + 0.5, 0.5 - a_pos.y * 0.5);
    gl_Position = vec4(a_pos, 0.0, 1.0);
}
"""


def fail(message):
    print(f"preview: {message}", file=sys.stderr)
    sys.exit(1)


def qsb_command():
    local = os.path.join(ROOT, ".tools", "qsb")
    if os.environ.get("QSB"):
        return [os.environ["QSB"]], dict(os.environ)
    if os.access(local, os.X_OK):
        env = dict(os.environ)
        env["LD_LIBRARY_PATH"] = os.path.join(ROOT, ".tools") + ":" + env.get("LD_LIBRARY_PATH", "")
        return [local], env
    for candidate in ("qsb", "/usr/lib/qt6/bin/qsb"):
        if any(os.access(os.path.join(d, candidate), os.X_OK) for d in os.environ.get("PATH", "").split(":")) \
                or os.access(candidate, os.X_OK):
            return [candidate], dict(os.environ)
    fail("qsb not found (it is in the qt6-shadertools package)")


def glsl_es_source(name):
    """The GLSL ES 1.00 variant baked into shaders/<name>.frag.qsb."""
    path = os.path.join(ROOT, "shaders", f"{name}.frag.qsb")
    command, env = qsb_command()
    dump = subprocess.run(command + ["--dump", path], capture_output=True, text=True, env=env, check=True).stdout
    match = re.search(r"GLSL 100 es \[Standard\]\nEntry point: main\nContents:\n(.*?)\n\*{20,}", dump, re.S)
    if not match:
        fail(f"no GLSL 100 es variant in {path}")
    source = match.group(1)
    instance = re.search(r"uniform buf (\w+);", source)
    return source, instance.group(1) if instance else "ubuf"


def color(value):
    value = value.lstrip("#")
    return [int(value[i:i + 2], 16) / 255 for i in (0, 2, 4)] + [1.0]


class Gpu:
    def __init__(self, width, height):
        self.width, self.height = width, height
        egl = self.egl = ctypes.CDLL("libEGL.so.1")
        gbm = ctypes.CDLL("libgbm.so.1")
        gl = self.gl = ctypes.CDLL("libGLESv2.so.2")

        gbm.gbm_create_device.restype = ctypes.c_void_p
        gbm.gbm_create_device.argtypes = [ctypes.c_int]
        egl.eglGetPlatformDisplay.restype = ctypes.c_void_p
        egl.eglGetPlatformDisplay.argtypes = [ctypes.c_uint, ctypes.c_void_p, ctypes.c_void_p]
        egl.eglInitialize.argtypes = [ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p]
        egl.eglBindAPI.argtypes = [ctypes.c_uint]
        egl.eglCreateContext.restype = ctypes.c_void_p
        egl.eglCreateContext.argtypes = [ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, ctypes.POINTER(ctypes.c_int)]
        egl.eglMakeCurrent.argtypes = [ctypes.c_void_p] * 4
        gl.glGetString.restype = ctypes.c_char_p
        gl.glGetString.argtypes = [ctypes.c_uint]
        gl.glShaderSource.argtypes = [ctypes.c_uint, ctypes.c_int, ctypes.POINTER(ctypes.c_char_p), ctypes.c_void_p]
        gl.glGetUniformLocation.argtypes = [ctypes.c_uint, ctypes.c_char_p]
        gl.glGetAttribLocation.argtypes = [ctypes.c_uint, ctypes.c_char_p]
        gl.glBindAttribLocation.argtypes = [ctypes.c_uint, ctypes.c_uint, ctypes.c_char_p]
        for name in ("glUniform1f", "glUniform2f", "glUniform3f", "glUniform4f"):
            getattr(gl, name).argtypes = [ctypes.c_int] + [ctypes.c_float] * int(name[9])
        gl.glClearColor.argtypes = [ctypes.c_float] * 4
        gl.glVertexAttribPointer.argtypes = [ctypes.c_uint, ctypes.c_int, ctypes.c_uint, ctypes.c_ubyte, ctypes.c_int, ctypes.c_void_p]
        gl.glTexImage2D.argtypes = [ctypes.c_uint, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int,
                                    ctypes.c_uint, ctypes.c_uint, ctypes.c_void_p]
        gl.glReadPixels.argtypes = [ctypes.c_int] * 4 + [ctypes.c_uint, ctypes.c_uint, ctypes.c_void_p]

        nodes = sorted(glob.glob("/dev/dri/renderD*"))
        if not nodes:
            fail("no DRM render node")
        fd = os.open(nodes[0], os.O_RDWR | os.O_CLOEXEC)
        device = gbm.gbm_create_device(fd)
        display = egl.eglGetPlatformDisplay(EGL_PLATFORM_GBM_KHR, device, None)
        if not display or not egl.eglInitialize(display, None, None) or not egl.eglBindAPI(EGL_OPENGL_ES_API):
            fail("EGL did not initialize")
        attributes = (ctypes.c_int * 3)(EGL_CONTEXT_MAJOR_VERSION, 2, EGL_NONE)
        context = egl.eglCreateContext(display, None, None, attributes)
        if not context or not egl.eglMakeCurrent(display, None, None, context):
            fail("no surfaceless GLES context")
        self.renderer = (gl.glGetString(GL_RENDERER) or b"?").decode(errors="replace")

        texture, framebuffer = ctypes.c_uint(), ctypes.c_uint()
        gl.glGenTextures(1, ctypes.byref(texture))
        gl.glBindTexture(GL_TEXTURE_2D, texture)
        gl.glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA, width, height, 0, GL_RGBA, GL_UNSIGNED_BYTE, None)
        gl.glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR)
        gl.glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR)
        gl.glGenFramebuffers(1, ctypes.byref(framebuffer))
        gl.glBindFramebuffer(GL_FRAMEBUFFER, framebuffer)
        gl.glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, texture, 0)
        if gl.glCheckFramebufferStatus(GL_FRAMEBUFFER) != GL_FRAMEBUFFER_COMPLETE:
            fail("framebuffer incomplete")
        gl.glViewport(0, 0, width, height)
        gl.glEnable(GL_BLEND)
        gl.glBlendFunc(GL_ONE, GL_ONE_MINUS_SRC_ALPHA)

        self.quad = (ctypes.c_float * 8)(-1, -1, 1, -1, -1, 1, 1, 1)
        self.programs = {}
        self.texture, self.framebuffer = texture, framebuffer
        self.sheet = None

    def start_sheet(self, columns, rows):
        """A second target the size of the contact sheet, cells at half size."""
        gl = self.gl
        self.cell = (self.width // 2, self.height // 2)
        self.sheet_size = (self.cell[0] * columns, self.cell[1] * rows)
        texture, framebuffer = ctypes.c_uint(), ctypes.c_uint()
        gl.glGenTextures(1, ctypes.byref(texture))
        gl.glBindTexture(GL_TEXTURE_2D, texture)
        gl.glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA, self.sheet_size[0], self.sheet_size[1], 0, GL_RGBA, GL_UNSIGNED_BYTE, None)
        gl.glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR)
        gl.glGenFramebuffers(1, ctypes.byref(framebuffer))
        gl.glBindFramebuffer(GL_FRAMEBUFFER, framebuffer)
        gl.glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, texture, 0)
        self.sheet = framebuffer

        handle = gl.glCreateProgram()
        gl.glAttachShader(handle, self.shader(GL_VERTEX_SHADER, b"attribute vec2 a_pos; varying vec2 v; void main() { v = a_pos * 0.5 + 0.5; gl_Position = vec4(a_pos, 0.0, 1.0); }"))
        gl.glAttachShader(handle, self.shader(GL_FRAGMENT_SHADER, b"precision mediump float; varying vec2 v; uniform sampler2D t; void main() { gl_FragColor = texture2D(t, v); }"))
        gl.glBindAttribLocation(handle, 0, b"a_pos")
        gl.glLinkProgram(handle)
        self.blit = handle
        gl.glBindFramebuffer(GL_FRAMEBUFFER, self.framebuffer)

    def place(self, column, row):
        """Copy the scene just drawn into its cell of the sheet."""
        gl = self.gl
        gl.glBindFramebuffer(GL_FRAMEBUFFER, self.sheet)
        rows = self.sheet_size[1] // self.cell[1]
        gl.glViewport(column * self.cell[0], (rows - 1 - row) * self.cell[1], self.cell[0], self.cell[1])
        gl.glDisable(GL_BLEND)
        gl.glUseProgram(self.blit)
        gl.glBindTexture(GL_TEXTURE_2D, self.texture)
        gl.glEnableVertexAttribArray(0)
        gl.glVertexAttribPointer(0, 2, GL_FLOAT, 0, 0, ctypes.cast(self.quad, ctypes.c_void_p))
        gl.glDrawArrays(GL_TRIANGLE_STRIP, 0, 4)
        gl.glEnable(GL_BLEND)
        gl.glBindFramebuffer(GL_FRAMEBUFFER, self.framebuffer)
        gl.glViewport(0, 0, self.width, self.height)

    def sheet_pixels(self):
        gl = self.gl
        gl.glBindFramebuffer(GL_FRAMEBUFFER, self.sheet)
        buffer = ctypes.create_string_buffer(self.sheet_size[0] * self.sheet_size[1] * 4)
        gl.glReadPixels(0, 0, self.sheet_size[0], self.sheet_size[1], GL_RGBA, GL_UNSIGNED_BYTE, buffer)
        return buffer.raw

    def shader(self, kind, source):
        gl = self.gl
        handle = gl.glCreateShader(kind)
        text = ctypes.c_char_p(source)
        gl.glShaderSource(handle, 1, ctypes.byref(text), None)
        gl.glCompileShader(handle)
        status = ctypes.c_int()
        gl.glGetShaderiv(handle, GL_COMPILE_STATUS, ctypes.byref(status))
        if not status.value:
            log = ctypes.create_string_buffer(8192)
            gl.glGetShaderInfoLog(handle, 8192, None, log)
            fail("shader compile failed:\n" + log.value.decode(errors="replace"))
        return handle

    def program(self, name):
        if name in self.programs:
            return self.programs[name]
        gl = self.gl
        source, instance = glsl_es_source(name)
        handle = gl.glCreateProgram()
        gl.glAttachShader(handle, self.shader(GL_VERTEX_SHADER, VERTEX))
        gl.glAttachShader(handle, self.shader(GL_FRAGMENT_SHADER, source.encode()))
        gl.glBindAttribLocation(handle, 0, b"a_pos")
        gl.glLinkProgram(handle)
        status = ctypes.c_int()
        gl.glGetProgramiv(handle, GL_LINK_STATUS, ctypes.byref(status))
        if not status.value:
            log = ctypes.create_string_buffer(8192)
            gl.glGetProgramInfoLog(handle, 8192, None, log)
            fail("program link failed:\n" + log.value.decode(errors="replace"))
        block = re.search(r"struct buf\s*\{(.*?)\};", source, re.S)
        members = set(re.findall(r"\w+ (\w+);", block.group(1))) if block else set()
        self.programs[name] = (handle, instance, members)
        return self.programs[name]

    def clear(self, rgba, rect=None):
        gl = self.gl
        if rect:
            x, y, w, h = [int(round(v)) for v in rect]
            gl.glEnable(GL_SCISSOR_TEST)
            # GL counts rows from the bottom.
            gl.glScissor(x, self.height - y - h, w, h)
        gl.glClearColor(*rgba)
        gl.glClear(GL_COLOR_BUFFER_BIT)
        if rect:
            gl.glDisable(GL_SCISSOR_TEST)

    def grab(self, region):
        """What is drawn in a region so far, as a texture the right way up for
        Qt's texture coordinates (which run down from the top left)."""
        gl = self.gl
        x, y, w, h = [int(round(v)) for v in region]
        raw, flipped, framebuffer = ctypes.c_uint(), ctypes.c_uint(), ctypes.c_uint()
        gl.glGenTextures(1, ctypes.byref(raw))
        gl.glBindTexture(GL_TEXTURE_2D, raw)
        gl.glCopyTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA, x, self.height - y - h, w, h, 0)
        gl.glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR)
        gl.glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR)

        gl.glGenTextures(1, ctypes.byref(flipped))
        gl.glBindTexture(GL_TEXTURE_2D, flipped)
        gl.glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA, w, h, 0, GL_RGBA, GL_UNSIGNED_BYTE, None)
        for key in (GL_TEXTURE_MIN_FILTER, GL_TEXTURE_MAG_FILTER):
            gl.glTexParameteri(GL_TEXTURE_2D, key, GL_LINEAR)
        for key in (0x2802, 0x2803):  # wrap s, t: clamp to edge
            gl.glTexParameteri(GL_TEXTURE_2D, key, 0x812F)
        gl.glGenFramebuffers(1, ctypes.byref(framebuffer))
        gl.glBindFramebuffer(GL_FRAMEBUFFER, framebuffer)
        gl.glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, flipped, 0)
        gl.glViewport(0, 0, w, h)
        gl.glDisable(GL_BLEND)
        if not hasattr(self, "flip"):
            handle = gl.glCreateProgram()
            gl.glAttachShader(handle, self.shader(GL_VERTEX_SHADER, b"attribute vec2 a_pos; varying vec2 v; void main() { v = vec2(a_pos.x * 0.5 + 0.5, 0.5 - a_pos.y * 0.5); gl_Position = vec4(a_pos, 0.0, 1.0); }"))
            gl.glAttachShader(handle, self.shader(GL_FRAGMENT_SHADER, b"precision mediump float; varying vec2 v; uniform sampler2D t; void main() { gl_FragColor = texture2D(t, v); }"))
            gl.glBindAttribLocation(handle, 0, b"a_pos")
            gl.glLinkProgram(handle)
            self.flip = handle
        gl.glUseProgram(self.flip)
        gl.glBindTexture(GL_TEXTURE_2D, raw)
        gl.glEnableVertexAttribArray(0)
        gl.glVertexAttribPointer(0, 2, GL_FLOAT, 0, 0, ctypes.cast(self.quad, ctypes.c_void_p))
        gl.glDrawArrays(GL_TRIANGLE_STRIP, 0, 4)
        gl.glEnable(GL_BLEND)
        gl.glBindFramebuffer(GL_FRAMEBUFFER, self.framebuffer)
        gl.glViewport(0, 0, self.width, self.height)
        # Mipmaps, as the plugin's own source texture has.
        gl.glBindTexture(GL_TEXTURE_2D, flipped)
        gl.glGenerateMipmap(GL_TEXTURE_2D)
        gl.glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, 0x2703)  # linear, mipmap linear
        return flipped

    def draw(self, name, uniforms, region=None):
        gl = self.gl
        handle, instance, members = self.program(name)
        source = self.grab(region) if region else None
        gl.glUseProgram(handle)
        if region:
            x, y, w, h = [int(round(v)) for v in region]
            gl.glViewport(x, self.height - y - h, w, h)
            gl.glBindTexture(GL_TEXTURE_2D, source)
            gl.glUniform1i(gl.glGetUniformLocation(handle, b"source"), 0)
        values = dict(uniforms)
        values.setdefault("qt_Opacity", 1.0)
        if "resolution" in members:
            values.setdefault("resolution", [self.width, self.height])
        unknown = sorted(set(values) - members)
        if unknown:
            fail(f"{name}: no such uniform: {', '.join(unknown)}")
        missing = sorted(members - set(values) - {"qt_Matrix"})
        if missing:
            fail(f"{name}: uniform not set: {', '.join(missing)}")
        for key, value in values.items():
            location = gl.glGetUniformLocation(handle, f"{instance}.{key}".encode())
            if location < 0:
                continue  # declared but optimized out
            if isinstance(value, str):
                value = color(value)
            if isinstance(value, (int, float)):
                gl.glUniform1f(location, float(value))
            else:
                getattr(gl, f"glUniform{len(value)}f")(location, *[float(v) for v in value])
        gl.glEnableVertexAttribArray(0)
        gl.glVertexAttribPointer(0, 2, GL_FLOAT, 0, 0, ctypes.cast(self.quad, ctypes.c_void_p))
        gl.glDrawArrays(GL_TRIANGLE_STRIP, 0, 4)
        gl.glViewport(0, 0, self.width, self.height)

    def pixels(self):
        buffer = ctypes.create_string_buffer(self.width * self.height * 4)
        self.gl.glReadPixels(0, 0, self.width, self.height, GL_RGBA, GL_UNSIGNED_BYTE, buffer)
        return buffer.raw


def write_png(path, width, height, rgba_bottom_up):
    stride = width * 4
    rows = bytearray()
    for y in range(height - 1, -1, -1):
        rows.append(0)
        row = rgba_bottom_up[y * stride:(y + 1) * stride]
        # Opaque RGB out: the backdrop already stands in for the wallpaper.
        rows += row
    def chunk(tag, data):
        body = tag + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)
    with open(path, "wb") as out:
        out.write(b"\x89PNG\r\n\x1a\n")
        out.write(chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)))
        out.write(chunk(b"IDAT", zlib.compress(bytes(rows), 6)))
        out.write(chunk(b"IEND", b""))


def render(gpu, scene):
    gpu.clear(color(scene.get("backdrop", "#000000")))
    for layer in scene["layers"]:
        if "shader" in layer:
            gpu.draw(layer["shader"], layer["uniforms"], layer.get("region"))
        elif layer.get("border"):
            gpu.clear(color(layer["border"]), layer["rect"])
            x, y, w, h = layer["rect"]
            gpu.clear(color(layer["color"]), [x + 2, y + 2, w - 4, h - 4])
        else:
            gpu.clear(color(layer["color"]), layer["rect"])


def load(path):
    with open(path) as source:
        return json.load(source)


def main(argv):
    if len(argv) >= 4 and argv[0] == "--grid":
        columns, out, scenes = int(argv[1]), argv[2], [load(path) for path in argv[3:]]
        width, height = scenes[0]["size"]
        rows = -(-len(scenes) // columns)
        gpu = Gpu(width, height)
        gpu.start_sheet(columns, rows)
        for index, scene in enumerate(scenes):
            render(gpu, scene)
            gpu.place(index % columns, index // columns)
        write_png(out, gpu.sheet_size[0], gpu.sheet_size[1], gpu.sheet_pixels())
        print(f"{out}: {len(scenes)} scenes via {gpu.renderer}")
        return 0
    if len(argv) != 2:
        print(__doc__, file=sys.stderr)
        return 1
    scene = load(argv[0])
    width, height = scene["size"]
    gpu = Gpu(width, height)
    render(gpu, scene)
    write_png(argv[1], width, height, gpu.pixels())
    print(f"{argv[1]}: {width}x{height} via {gpu.renderer}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
