#!/bin/bash
# Contact sheet of scenes: tools/sheet.sh <out.png> <columns> "<scene.js args>"...
set -euo pipefail
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
out=$1; columns=$2; shift 2
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
i=0; files=()
for spec in "$@"; do
  # shellcheck disable=SC2086
  node "$ROOT/tools/scene.js" $spec >"$tmp/$i.json" 2>/dev/null
  files+=("$tmp/$i.json"); i=$((i + 1))
done
python3 "$ROOT/tools/preview.py" --grid "$columns" "$out" "${files[@]}"
