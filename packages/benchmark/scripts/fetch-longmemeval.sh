#!/usr/bin/env bash
# Download LongMemEval-s (cleaned) dataset from HuggingFace.
# Source: https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned
# License: MIT

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DATA_DIR="${SCRIPT_DIR}/../data/longmemeval"

mkdir -p "$DATA_DIR"

echo "Downloading LongMemEval-s (cleaned)..."
curl -L -o "$DATA_DIR/longmemeval_s.json" \
  "https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned/resolve/main/longmemeval_s_cleaned.json"

echo "Done. Dataset saved to $DATA_DIR/longmemeval_s.json"
ls -lh "$DATA_DIR/"
