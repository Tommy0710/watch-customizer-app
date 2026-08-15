# HANDDN LoRA evaluation — 2026-08-14

## Version under test

- Destination: `tommy0710/watch-lora-v2`
- Active weights: version ending `2ba584ef`
- Inference model: `black-forest-labs/flux-dev-lora`
- Held-out set: 6 combinations
- Seed: `19826`
- Training output was read from `scripts/dataset/out/training.json`
- Weights were supplied through a fresh S3 presigned URL, matching production serving

## Measured result

| Strength | Successful | Mean latency | Range | Visual review |
|---|---:|---:|---:|---|
| 0.35 | 6/6 | 7.99s | 4.35–18.45s | Recommended |
| 0.45 | 6/6 | 18.96s | 5.16–50.81s | Slower and less stable |

Visual review found all six outputs structurally assembled. Strap colour and the main material pattern were preserved across navy leather, duocolour red/green, python, vachetta and alligator examples. No catastrophic model failure was observed.

## Decision

- Set production `REPLICATE_LORA_PROMPT_STRENGTH=0.35`.
- Keep `GENERATE_ENGINE=lora` with the existing PRO fallback.
- Do not retrain yet: the current evidence points to serving configuration and latency stability, not a clear training-data failure.
- Do not claim a fresh PRO win-rate from this run because the six matching PRO baseline files are not currently present in `scripts/dataset/out/pairs/`.

## Next acceptance gate

Regenerate or restore the six matching PRO baselines, then run a blind `draft | PRO | LoRA` review. Retrain only if the same visual defect appears repeatedly or if the expanded benchmark fails the existing quality thresholds.

## Exact status checkpoint — 2026-08-15

### Production weights

- Destination: `tommy0710/watch-lora-v2`
- Successful training ID: `hq25j8hhchrmr0czz9trj2jscm`
- Active version: `tommy0710/watch-lora-v2:2ba584ef43b457be771182064dc447332737541419ccad956dcedc35dbac623b`
- Production weights: `s3://lora-weights/watch-lora-v2-2ba584ef43b4.safetensors`

### Real product smoke test

- Product: `024-vintage-light-grey-lizard-leather-watch-strap-straps-a-lange-sohne-little-la`
- Engine: `black-forest-labs/flux-dev-lora`
- Weights source: fresh S3 presigned URL
- Prompt strength: `0.35`
- Seed: `19826`
- Inference steps: `30`
- Result: succeeded
- Latency: `25.3s`
- Inference spend: `$0.04`
- Output: `scripts/dataset/out/eval/real-product-pilot/024-vintage-light-grey-lizard-leather-watch-strap-straps-a-lange-sohne-little-la_lora.webp`

Visual inspection: the output assembled a complete watch, retained the grey lizard texture and strap colour, and preserved the buckle, holes, case and dial without a catastrophic failure.

### Material dataset checkpoint

- Active material families: `29`
- Train split: `200` combos / `169` products
- Held-out split: `36` combos / `36` products
- Product overlap: `0`
- Required active material families missing from train: `0`
- Current style ZIP after repack: `38` reviewed images with `material-v2` captions
- Clean renders still missing for train products: `120`
- Fully out-of-stock families are excluded from the split; out-of-stock SKUs remain eligible only when their family still has an in-stock SKU.

### What the current LoRA has actually learned

The current taxonomy contains `29` active families, but the current repacked ZIP contains captions for only
`16` families across `38` images:

| Family | Captioned images |
|---|---:|
| `sully` | 7 |
| `vachetta` | 8 |
| `pueblo` | 4 |
| `habana` | 3 |
| `chevre` | 2 |
| `nubuck` | 2 |
| `vegetable-tanned` | 2 |
| `peccary` | 2 |
| `alligator` | 1 |
| `hornback-alligator` | 1 |
| `canvas` | 1 |
| `sailcloth` | 1 |
| `box-calf` | 1 |
| `swift` | 1 |
| `babele` | 1 |
| unknown/fallback | 1 |

The other active families are present in taxonomy and runtime prompt classification, but that is not proof
that the current weights learned them. The existing held-out visual evaluation directly covered navy leather,
duocolour leather, python, vachetta and alligator; it did not validate every active family.

Therefore the current LoRA cannot honestly be described as trained for every HANDDN strap/material. It can
attempt any product only when a clean render for that product exists and passes the draft gate. Products without
such a render deliberately fall back to PRO. “Inheritance” across products is expected for shared construction,
layout and studio style, but exact leather grain, scale pattern, patina and hardware require representative
training examples and a clean input render.

### Retraining result

Two retraining attempts were made with the current ZIP and `300` steps: one against `tommy0710/watch-lora-v2` and one against `tommy0710/watch-lora-pilot-300`. Both uploaded the ZIP successfully, then Replicate returned HTTP `500` while creating the training job. Neither attempt produced a training ID or new weights.

The current ZIP contains the existing reviewed set repacked with the new caption schema; it does not yet contain the `120` missing material renders. The correct next retraining input is the old reviewed set plus genuinely new material examples, not the current ZIP alone.

### Local verification

- Vitest: `17` files, `134` tests passed
- TypeScript: passed
- ESLint on changed dataset/material files: passed
- `git diff --check`: passed
- No production weights were replaced.
