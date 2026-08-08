#!/bin/bash
# Everything that has to happen once approved.json exists, credit is topped up, and Replicate has
# restored the Kontext trainer. Safe to re-run: packing and evaluation are idempotent, and the
# trainer call is the only step that spends.
set -e
cd "$(dirname "$0")/../.."

echo "=== 0/3 preflight ==="
npm run ds scripts/dataset/probe-trainer.ts -- --once

echo "=== 1/3 pack approved pairs ==="
npm run ds scripts/dataset/pack-dataset.ts

echo "=== 2/3 train ==="
npm run ds scripts/dataset/train.ts -- --steps=1000

echo "=== 3/3 evaluate against PRO on held-out ==="
npm run ds scripts/dataset/eval.ts -- --max-spend=0.60

echo "=== DONE — open scripts/dataset/out/eval.html ==="
