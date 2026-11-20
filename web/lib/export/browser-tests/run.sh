#!/bin/bash
# Testes de navegador do export (Chromium do Playwright + ffmpeg). Uso:
#   bash web/lib/export/browser-tests/run.sh [pixel]
# Empacota lib/export com esbuild, gera as mídias de teste e roda cada t_*.js
# numa página http://localhost:3200 (contexto seguro → WebCodecs disponível).
set -e
HERE=$(cd "$(dirname "$0")" && pwd); W=$(cd "$HERE/../../.." && pwd); T=${TMPDIR:-/tmp}/ep-export-bt
mkdir -p "$T"; cp "$HERE/entry.txt" "$T/entry.ts"
"$W/node_modules/.bin/esbuild" "$T/entry.ts" --bundle --format=iife --outfile="$T/epx.js" --alias:@="$W" --log-level=error
echo '<!doctype html><script src="epx.js"></script>' > "$T/index.html"
cd "$T"
[ -f rot90.mp4 ] || { ffmpeg -y -loglevel error -f lavfi -i testsrc2=duration=6:size=1280x720:rate=30 -c:v libx264 -pix_fmt yuv420p base.mp4; ffmpeg -y -loglevel error -display_rotation 90 -i base.mp4 -c copy rot90.mp4; }
[ -f preroll.mp4 ] || { ffmpeg -y -loglevel error -f lavfi -i testsrc2=duration=8:size=1280x720:rate=30 -f lavfi -i sine=frequency=440:duration=8 -c:v libx264 -g 90 -pix_fmt yuv420p -c:a aac -shortest gop.mp4; ffmpeg -y -loglevel error -ss 1.5 -i gop.mp4 -c copy preroll.mp4; }
[ -f ac3.mp4 ] || ffmpeg -y -loglevel error -f lavfi -i color=c=gray:s=320x240:r=30:d=4 -f lavfi -i sine=frequency=440:duration=4 -c:v libx264 -pix_fmt yuv420p -c:a ac3 -shortest ac3.mp4
[ -f chirp.mp4 ] || ffmpeg -y -loglevel error -f lavfi -i color=c=gray:s=320x240:r=30:d=6 -f lavfi -i "aevalsrc=sin(2*PI*(200*t+100*t*t)):s=48000:d=6" -c:v libx264 -pix_fmt yuv420p -c:a aac -b:a 192k -shortest chirp.mp4
[ -f sine.mp4 ] || ffmpeg -y -loglevel error -f lavfi -i color=c=gray:s=320x240:r=30:d=6 -f lavfi -i sine=frequency=440:duration=6 -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest sine.mp4
[ -f long.wav ] || ffmpeg -y -loglevel error -f lavfi -i "sine=frequency=330:duration=300" -ac 2 -ar 44100 long.wav
python3 -m http.server 3200 >/dev/null 2>&1 & SRV=$!; trap 'kill $SRV' EXIT; sleep 1
for t in "$HERE"/t_*.js; do echo "== $(basename "$t")"; NODE_PATH=$(npm root -g) node "$HERE/run.js" "$t" "$1"; done
