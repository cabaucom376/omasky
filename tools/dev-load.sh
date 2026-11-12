#!/bin/bash
# Install this checkout into the running Omarchy shell, for working on it.
#
# Anyone using the plugin adds it with `omarchy plugin add <git-url>`, which
# clones the repository into ~/.config/omarchy/plugins/omasky as it is. This
# does one thing differently, which only matters while the code is changing:
# the shell keeps compiled QML by file path for as long as it runs, so code
# written over the same paths would go on running the old version. Here the
# code goes into a folder named for its own contents, with the manifest
# pointing into it, so every change is read fresh without restarting the
# shell. Shaders are rebuilt first if the shader baker is around.

set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
TARGET="$HOME/.config/omarchy/plugins/omasky"

say() { echo "omasky: $*"; }
fail() { echo "omasky: $*" >&2; exit 1; }

command -v omarchy-shell >/dev/null || fail "this needs the Omarchy shell"

if [[ -x $ROOT/.tools/qsb || -x /usr/lib/qt6/bin/qsb ]] || command -v qsb >/dev/null; then
  "$ROOT/tools/build-shaders.sh" >/dev/null
fi
for shader in scene-back scene-front shimmer plate; do
  [[ -f $ROOT/shaders/$shader.frag.qsb ]] || fail "missing compiled shader $shader.frag.qsb (run tools/build-shaders.sh)"
done

if [[ -d $TARGET/.git ]]; then
  fail "$TARGET is a git checkout (added with omarchy plugin add); remove it first: omarchy plugin remove omasky"
fi

# Stage beside the target (dot folders are not scanned), then swap, so the
# shell never loads a half-copied plugin.
mkdir -p "$(dirname "$TARGET")"
stage=$(mktemp -d "$(dirname "$TARGET")/.omasky.XXXXXX")
trap 'rm -rf "$stage"' EXIT
build="build-$(cd "$ROOT" && cat ./*.qml ./*.js manifest.json shaders/*.qsb i18n/*.json sounds/*.wav | sha1sum | cut -c1-10)"
mkdir -p "$stage/$build/shaders" "$stage/$build/i18n" "$stage/$build/sounds"
cp "$ROOT"/*.qml "$ROOT"/*.js "$stage/$build/"
cp "$ROOT"/shaders/*.qsb "$stage/$build/shaders/"
cp "$ROOT"/i18n/*.json "$stage/$build/i18n/"
cp "$ROOT"/sounds/*.wav "$stage/$build/sounds/"
jq --arg build "$build" '.entryPoints |= map_values($build + "/" + .)' "$ROOT/manifest.json" >"$stage/manifest.json"
omarchy-plugin-validate "$stage" || fail "the staged plugin did not validate"

first_install=1
if [[ -d $TARGET ]]; then
  first_install=0
  old="$(dirname "$TARGET")/.omasky-old.$$"
  mv "$TARGET" "$old"
  mv "$stage" "$TARGET"
  rm -rf "$old"
else
  mv "$stage" "$TARGET"
fi
trap - EXIT

omarchy-shell shell rescanPlugins >/dev/null 2>&1 || true
if (( first_install )); then
  for (( i = 0; i < 40; i++ )); do
    omarchy-plugin-list --json 2>/dev/null | jq -e 'any(.[]; .id == "omasky")' >/dev/null && break
    sleep 0.05
  done
  omarchy-plugin-enable omasky >/dev/null || fail "could not enable the plugin; try: omarchy plugin enable omasky"
else
  omarchy-shell shell reloadPlugins >/dev/null 2>&1 || true
fi

say "installed $build. Click the weather icon in the bar, or run: omarchy-shell omasky toggle"
