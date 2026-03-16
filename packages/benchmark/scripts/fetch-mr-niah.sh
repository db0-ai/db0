#!/usr/bin/env bash
# Download MR-NIAH dataset from MiniMax-01 repository.
# Usage: bash packages/benchmark/scripts/fetch-mr-niah.sh [--all]
#
# By default, downloads only English data for the 5 smallest token buckets.
# Use --all to download all 23 buckets for both languages.

set -euo pipefail

BASE_URL="https://raw.githubusercontent.com/MiniMax-AI/MiniMax-01/refs/heads/main/evaluation/MR-NIAH/data"
DATA_DIR="packages/benchmark/data/mr-niah"

ALL_BUCKETS=(2048 10240 20480 30720 40960 51200 61440 71680 81920 92160 102400 112640 122880 131072 204800 307200 409600 512000 614400 716800 819200 921600 1024000)
SMALL_BUCKETS=(2048 10240 20480 30720 40960)

if [[ "${1:-}" == "--all" ]]; then
  LANGUAGES=(english chinese)
  BUCKETS=("${ALL_BUCKETS[@]}")
  echo "Downloading all MR-NIAH data (2 languages × 23 buckets)..."
else
  LANGUAGES=(english)
  BUCKETS=("${SMALL_BUCKETS[@]}")
  echo "Downloading English MR-NIAH data (5 smallest buckets)..."
  echo "Use --all for complete dataset."
fi

for lang in "${LANGUAGES[@]}"; do
  mkdir -p "${DATA_DIR}/${lang}"
  for bucket in "${BUCKETS[@]}"; do
    file="${bucket}_tokens.jsonl"
    dest="${DATA_DIR}/${lang}/${file}"
    if [[ -f "$dest" ]]; then
      echo "  Skip: ${lang}/${file} (exists)"
      continue
    fi
    url="${BASE_URL}/${lang}/${file}"
    echo "  Fetch: ${lang}/${file}"
    if ! curl -sSfL "$url" -o "$dest" 2>/dev/null; then
      echo "  WARN: Failed to download ${lang}/${file} — skipping"
      rm -f "$dest"
    fi
  done
done

echo "Done. Data at: ${DATA_DIR}/"
