#!/bin/bash
# Unattended dataset expansion. Each step resumes from what is already on disk, so an interrupted
# run costs nothing extra when restarted.
set -e
cd "$(dirname "$0")/../.."
echo "=== 1/4 crop new catalog photos (AI Gateway, rate-limited) ==="
npm run ds scripts/dataset/prepare-straps.ts -- --delay=7000
echo "=== 2/4 clean studio renders (PRO) ==="
npm run ds scripts/dataset/render-clean-straps.ts -- --max-spend=2.60
echo "=== 3/4 colour drift check (free) ==="
npm run ds scripts/dataset/check-clean-straps.ts
echo "=== 4/4 training pairs (PRO) ==="
npm run ds scripts/dataset/generate-pairs.ts -- --set=train --max-spend=5.60
echo "=== EXPANSION COMPLETE ==="
