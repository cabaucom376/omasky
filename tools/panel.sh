#!/bin/bash
# Draw the control panel offscreen and save it as a picture, to look at a
# change to Controls.qml without opening the panel on the desktop.
#
#   tools/panel.sh <out.png> [scene[,scene...]]
#
# Scenes are states of the sky and the panel (tools/panel.qml lists them):
# rain, night, snow, tune, dusk, storm, clear, battery, alone, noweather, nocycle, off, city;
# and readout, readout-wide, readout-simple, readout-demo, which draw the
# words in the corner of the sky instead of the panel. With more than one,
# each is saved as <out>-<scene>.png. The panel is drawn in
# the current theme by a throwaway Quickshell, with a stand-in for the
# service; nothing appears on screen.
#
#   PANEL_FLAT=1   leave the miniature sky out, so no shader is compiled
#                  (on a slow GPU path a compile stalls the screen)
#   PANEL_TUNE=1   unfold the manual controls in every scene whose mode is manual
#   PANEL_SCALE=2  the screen scale to draw at (default 1.25)
set -euo pipefail
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
SHELL_DIR=${OMARCHY_PATH:-/usr/share/omarchy}/shell
if [[ $# -lt 1 ]]; then
  sed -n '2,17p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//' >&2
  exit 1
fi
out=$(realpath -m "$1")
stand=$(mktemp -d); trap 'rm -rf "$stand"' EXIT
ln -s "$SHELL_DIR/Commons" "$stand/Commons"
ln -s "$SHELL_DIR/Ui" "$stand/Ui"
# The checkout is the plugin: its files are at the top.
ln -s "$ROOT" "$stand/plugin"
cp "$ROOT/tools/panel.qml" "$stand/shell.qml"
status=0
log=$(cd "$stand" && PANEL_OUT="$out" PANEL_SCENE="${2:-rain}" timeout 40 quickshell -p . 2>&1) || status=$?
printf '%s\n' "$log" | sed 's/\x1b\[[0-9;]*m//g' | grep -iv 'portal\|^ *INFO\|^$' | cut -c1-240 || true
echo "panel: exit $status"
exit $status
