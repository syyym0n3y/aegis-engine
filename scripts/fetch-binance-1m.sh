#!/bin/bash
# fetch-binance-1m — full-history Binance 1m klines from the FREE bulk dumps (data.binance.vision) →
# data/binance/<SYM>-1m.csv (t,o,h,l,c). Streams month-by-month, appends, deletes the zip → low disk.
# The index-depth crypto data that REST pagination (5000-bar cap) couldn't give (D-142). Idempotent-ish:
# re-run overwrites. data/binance is gitignored.
set -u
OUT="data/binance"; mkdir -p "$OUT"; TMP="/tmp/binance-dl"; mkdir -p "$TMP"
for SYM in "$@"; do
  MASTER="$OUT/$SYM-1m.csv"; : > "$MASTER"; N=0
  for Y in 2017 2018 2019 2020 2021 2022 2023 2024 2025 2026; do
    for M in 01 02 03 04 05 06 07 08 09 10 11 12; do
      URL="https://data.binance.vision/data/spot/monthly/klines/$SYM/1m/$SYM-1m-$Y-$M.zip"
      Z="$TMP/$SYM-$Y-$M.zip"
      if curl -sf -o "$Z" "$URL" 2>/dev/null; then
        if unzip -oq "$Z" -d "$TMP" 2>/dev/null; then
          cut -d, -f1-5 "$TMP/$SYM-1m-$Y-$M.csv" >> "$MASTER"
          rm -f "$Z" "$TMP/$SYM-1m-$Y-$M.csv"
          N=$((N+1))
        fi
      fi
    done
  done
  echo "$SYM: $N months, $(wc -l < "$MASTER" | tr -d ' ') bars → $MASTER"
done
echo "DONE"
