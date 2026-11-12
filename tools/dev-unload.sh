#!/bin/bash
# Remove a development install of Omasky: the plugin and its bar button.
# (A copy added with `omarchy plugin add` is removed with
# `omarchy plugin remove omasky`.)

set -euo pipefail

omarchy-shell -q omasky hide || true
if [[ -d $HOME/.config/omarchy/plugins/omasky ]]; then
  omarchy-plugin-remove omasky --yes
fi

# Rows an earlier installer added to the Omarchy menu and to Omafuzz's tags.
for file in "$HOME/.config/omarchy/extensions/omarchy-menu.jsonc" "$HOME/.config/omarchy/extensions/omafuzz-tags.jsonc"; do
  [[ -f $file ]] || continue
  sed -i -e '/^  \/\/ Omasky: the weather takes over the desktop/d' -e '/^  "trigger\.weather-sky":/d' "$file"
done
echo "omasky: removed"
