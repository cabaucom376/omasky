#!/bin/bash
# Load the plugin's service on its own, idle, in a throwaway Quickshell, and
# print anything it complains about. Nothing is shown: idle, the plugin is a
# few transparent pixels. Catches what the tests cannot, QML that does not
# load, before the real shell is asked to take it.
set -euo pipefail
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
SHELL_DIR=${OMARCHY_PATH:-/usr/share/omarchy}/shell
stand=$(mktemp -d); trap 'rm -rf "$stand"' EXIT
ln -s "$SHELL_DIR/Commons" "$stand/Commons"
ln -s "$SHELL_DIR/Ui" "$stand/Ui"
# The checkout is the plugin: its files are at the top.
ln -s "$ROOT" "$stand/plugin"
cat >"$stand/shell.qml" <<'QML'
import Quickshell
import QtQuick
import "plugin" as Plugin

ShellRoot {
  Plugin.Service {}
  Timer { interval: 2500; running: true; onTriggered: Qt.quit() }
}
QML
status=0
out=$(cd "$stand" && timeout 20 quickshell -p . 2>&1) || status=$?
printf '%s\n' "$out" | sed 's/\x1b\[[0-9;]*m//g' | grep -iv 'portal\|^ *INFO\|^$' | cut -c1-240 || true
echo "load: exit $status"
exit $status
