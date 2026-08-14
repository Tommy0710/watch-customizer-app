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
