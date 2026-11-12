#!/bin/bash
# Compile shaders/*.frag into the .qsb files Qt Quick loads.
#
# Needs qsb, the Qt shader baker (package: qt6-shadertools). It is a build tool
# only: the compiled .qsb files ship with the plugin, so nothing is needed at
# runtime. Looks in $QSB, then .tools/ in this checkout, then the system.

set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)

if [[ -n ${QSB:-} ]]; then
  qsb=("$QSB")
elif [[ -x $ROOT/.tools/qsb ]]; then
  export LD_LIBRARY_PATH="$ROOT/.tools${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
  qsb=("$ROOT/.tools/qsb")
elif command -v qsb >/dev/null; then
  qsb=(qsb)
elif [[ -x /usr/lib/qt6/bin/qsb ]]; then
  qsb=(/usr/lib/qt6/bin/qsb)
else
  echo "build-shaders: qsb not found; it is in the qt6-shadertools package" >&2
  exit 1
fi

# GLSL for OpenGL and OpenGL ES at every version Qt Quick may ask for; SPIR-V
# for Vulkan is always included. A shader pulls the shared code in with
# #include "common.glsl", which qsb does not know, so it is pasted in first.
build=$(mktemp -d)
trap 'rm -rf "$build"' EXIT

# expand <source> <output> [define...]: paste common.glsl in, and put the
# defines straight after the #version line.
expand() {
  local source=$1 output=$2
  shift 2
  awk -v common="$ROOT/shaders/common.glsl" -v defines="$*" '
    NR == 1 { print; n = split(defines, d, " "); for (i = 1; i <= n; i++) { sub("=", " ", d[i]); print "#define " d[i] } next }
    /^#include "common.glsl"/ { while ((getline line < common) > 0) print line; close(common); next }
    { print }
  ' "$source" >"$output"
}

bake() {
  "${qsb[@]}" --glsl "100 es,120,150,300 es,330" -o "$2" "$1"
  echo "built ${2#"$ROOT"/}"
}

# The weather: one shader for the sky and one for what is in front of the
# windows. Each serves every quality (the quality is a number it is handed),
# so changing quality at runtime compiles nothing.
rm -f "$ROOT"/shaders/scene*.frag.qsb
expand "$ROOT/shaders/scene.frag" "$build/scene-back.frag"
bake "$build/scene-back.frag" "$ROOT/shaders/scene-back.frag.qsb"
expand "$ROOT/shaders/scene.frag" "$build/scene-front.frag" "FRONT_PASS=1"
bake "$build/scene-front.frag" "$ROOT/shaders/scene-front.frag.qsb"

for name in shimmer plate; do
  expand "$ROOT/shaders/$name.frag" "$build/$name.frag"
  bake "$build/$name.frag" "$ROOT/shaders/$name.frag.qsb"
done
