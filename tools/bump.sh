#!/bin/sh
# Stamp index.html's asset links with a fresh build id (UTC MMDDHHMM). Phones then refetch CSS/JS, and the id shows at the top of the game.
cd "$(dirname "$0")/.." || exit 1
v=$(date -u +%m%d%H%M)
sed -i.bak "s#?v=[0-9a-f]*#?v=$v#g" index.html && rm -f index.html.bak
echo "build id: $v"
