#!/bin/bash
# Unattended dataset expansion. Each step resumes from what is already on disk, so an interrupted
# run costs nothing extra when restarted.
#
# The pre-crop stage is deliberately NOT in this chain: it depends on a rate-limited free tier that
# throttles to a few images per minute, and PRO's clean render strips the staging on its own.
# Run prepare-straps.ts separately whenever the gateway is willing.
set -e
cd "$(dirname "$0")/../.."
echo "=== 1/3 clean studio renders (PRO) ==="
npm run ds scripts/dataset/render-clean-straps.ts -- --max-spend=2.60
echo "=== 2/3 colour drift check (free) ==="
npm run ds scripts/dataset/check-clean-straps.ts
echo "=== 3/3 training pairs (PRO) ==="
npm run ds scripts/dataset/generate-pairs.ts -- --set=train --max-spend=5.60
echo "=== EXPANSION COMPLETE ==="
