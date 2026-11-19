#!/bin/bash
# pico de RSS (MB) dos processos do Chromium enquanto o comando roda: mem.sh <comando...>
"$@" & PID=$!; PEAK=0
while kill -0 $PID 2>/dev/null; do
  R=$(ps -eo rss,comm | awk '/chrom|headless/ {s+=$1} END {print int(s/1024)}'); [ "$R" -gt "$PEAK" ] && PEAK=$R; sleep 0.2
done; wait $PID; echo "PICO_RSS_MB=$PEAK"
