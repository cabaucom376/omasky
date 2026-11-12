#!/bin/bash
# How big each compiled shader is: the number of instructions in the program
# the GPU is handed for it.
#
#   tools/shader-size.sh [shader...]     (default: scene-back scene-front plate shimmer)
#
# This is what to watch when changing a shader. On a virtual machine's GPU
# (virgl) the host builds every program in one queue shared by everything on
# screen, so a compile freezes the whole desktop, and the time it takes grows
# much faster than the size (about size to the power 2.3): the front pass at
# about 4,800 instructions takes a couple of seconds, and at 14,800 it took
# twenty-six. Measuring this way draws nothing, so nothing is built on the
# host and the screen does not stall. It needs Mesa's virgl driver, which is
# what prints the program; elsewhere it reports nothing to count.
set -euo pipefail
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
shaders=("$@")
[[ ${#shaders[@]} -gt 0 ]] || shaders=(scene-back scene-front plate shimmer)
VIRGL_DEBUG=tgsi python3 "$ROOT/tools/preview.py" --count "${shaders[@]}" 2>&1 | awk '
  /^=== / { name = $2; next }
  /TGSI:/ { stage = "" ; next }
  / FRAG$/ { stage = "frag"; next }
  / VERT$/ { stage = "vert"; next }
  stage == "frag" && match($0, /^MESA: info: +[0-9]+: /) { n = $3; sub(":", "", n); count[name] = n + 1 }
  END {
    any = 0
    for (name in count) { printf "%-12s %6d instructions\n", name, count[name]; any = 1 }
    if (!any) print "nothing to count: this needs Mesa with VIRGL_DEBUG=tgsi (a virtual machine with virgl)"
  }' | sort
