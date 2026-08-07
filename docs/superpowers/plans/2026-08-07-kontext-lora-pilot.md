# Kontext LoRA Pilot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the offline tooling that turns ~24 FLUX-2-PRO generations into a trained Kontext LoRA, and measure it against PRO on 6 held-out combos — all inside a hard $4.63 Replicate spend cap.

**Architecture:** A new shared library `src/lib/draftComposite.ts` renders the single normalized 832×1472 input image that both the dataset scripts and (later) production will use — one function, so training and serving can never drift apart. Everything else lives under `scripts/` and never runs in the app: sample combos → generate before/after pairs through PRO → geometrically align them → review by hand in a static HTML page → zip → train → evaluate. The production route is untouched except for one behavior-preserving string extraction.

**Tech Stack:** TypeScript 5, Node 26, sharp, Replicate SDK, MongoDB driver, AWS S3 SDK, Vercel AI SDK (`ai` + `zod`), Vitest, tsx.

## Global Constraints

- **Hard spend cap: $4.63 total on Replicate.** Every script that calls Replicate must route through `scripts/lib/spendGuard.ts` and abort before exceeding its `--max-spend`.
- **Scope is the pilot only.** Do NOT modify `/api/generate`'s engine, add a `GENERATE_ENGINE` flag, or remove the PRO path. Those belong to a later plan gated on eval passing.
- **AI pipeline must not regress** (`PROJECT.md`): the only permitted change to `src/app/api/generate/route.ts` in this plan is moving the prompt string verbatim into a module and importing it back. No constant, prompt character, or parameter value changes.
- **UI is frozen** (`PROJECT.md`): no changes to any file in `src/components/` or `src/app/**/page.tsx`. The review tool is a generated static HTML file opened from disk.
- **No new external services** (`PROJECT.md`): reuse MongoDB, S3, Replicate, and the existing Vercel AI Gateway only.
- Canvas: `DRAFT_CANVAS_WIDTH = 832`, `DRAFT_CANVAS_HEIGHT = 1472`, `DRAFT_MARGIN_RATIO = 0.06`.
- Preserved from production: `FACE_TO_STRAP_WIDTH_RATIO = 0.16`, `SHORT_END_TOP_RATIO = 0.30`, `seed = 19826`.
- Training: `training_steps = 700`, `kontext_prompt_instruction = "assemble into a finished wristwatch product photo"`.
- Trainer: `replicate/fast-flux-kontext-trainer`, version `26c877b4ec3988b7e8edc5840e61339c68f09913bb11e23c31566590fd92a66d`. Zip layout: `NNN_start.jpg` / `NNN_end.jpg` per pair.
- Scripts use **relative imports** (`../../src/lib/x`), not the `@/` alias, so they run under plain `tsx` with no path-resolution setup. The `@/` convention still applies inside `src/`.
- Scripts load secrets with `tsx --env-file=.env.local`. Never print secret values.
- Generated artifacts (`scripts/dataset/out/`) are gitignored — they contain customer-catalog imagery and are large.

## Manual prerequisites (do before Task 11)

1. ~~Create the destination model~~ — **DONE 2026-08-07.** `tommy0710/watch-lora` exists (private, `gpu-h100`, no version yet, which is expected until the first training succeeds): https://replicate.com/tommy0710/watch-lora
2. Optional but recommended: create a Hugging Face repo and a write token, then add `HF_TOKEN=` and `HF_REPO_ID=` to `.env.local` so the weights land somewhere you own. Without these the LoRA exists only inside Replicate — which is exactly the lock-in the "own your weights" goal is meant to avoid.

---

### Task 1: Test and script runner infrastructure

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`
- Create: `src/lib/__tests__/smoke.test.ts`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: nothing
- Produces: `npm run test` (Vitest, run mode), `npm run test:watch`, and `tsx` available for `scripts/`. The `@/` alias resolves inside tests.

- [ ] **Step 1: Install dev dependencies**

```bash
npm install -D vitest@^3 tsx@^4
```

- [ ] **Step 2: Add scripts to `package.json`**

Add these three entries to the existing `"scripts"` block (keep `dev`, `build`, `start`, `lint` unchanged):

```json
    "test": "vitest run",
    "test:watch": "vitest",
    "ds": "tsx --env-file=.env.local"
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
  },
});
```

- [ ] **Step 4: Write the smoke test**

```ts
// src/lib/__tests__/smoke.test.ts
import { describe, it, expect } from 'vitest';
import { classifyStrap } from '@/lib/strapProfile';

describe('test harness', () => {
  it('resolves the @/ alias and runs existing library code', () => {
    const profile = classifyStrap('Test Strap', ['Classic Watch Straps'], []);
    expect(profile).toBeTypeOf('object');
  });
});
```

- [ ] **Step 5: Run the test**

Run: `npm run test`
Expected: PASS, 1 test.

- [ ] **Step 6: Append generated artifacts to `.gitignore`**

Append these lines to the end of the existing `.gitignore`:

```
# LoRA dataset artifacts (large, contains catalog imagery)
scripts/dataset/out/
```

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json vitest.config.ts src/lib/__tests__/smoke.test.ts .gitignore
git commit -m "chore: add vitest and tsx for LoRA dataset tooling"
```

---

### Task 2: Draft layout math

**Files:**
- Create: `src/lib/draftComposite.ts`
- Create: `src/lib/__tests__/draftComposite.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `DRAFT_CANVAS_WIDTH: 832`, `DRAFT_CANVAS_HEIGHT: 1472`, `DRAFT_MARGIN_RATIO: 0.06`, `FACE_TO_STRAP_WIDTH_RATIO: 0.16`, `SHORT_END_TOP_RATIO: 0.30`
  - `type DraftLayout = { strapWidth: number; strapHeight: number; strapLeft: number; strapTop: number; faceWidth: number; faceHeight: number; faceLeft: number; faceTop: number }`
  - `computeDraftLayout(input: { strapWidth: number; strapHeight: number; faceWidth: number; faceHeight: number }): DraftLayout`

All returned values are integer pixel coordinates on the 832×1472 canvas.

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/__tests__/draftComposite.test.ts
import { describe, it, expect } from 'vitest';
import {
  computeDraftLayout,
  DRAFT_CANVAS_WIDTH,
  DRAFT_CANVAS_HEIGHT,
} from '@/lib/draftComposite';

describe('computeDraftLayout', () => {
  it('fits a tall strap to the safe height and centres it', () => {
    const l = computeDraftLayout({ strapWidth: 500, strapHeight: 2000, faceWidth: 400, faceHeight: 400 });
    // safe box is 6% margin each side: 832*0.88 = 732 wide, 1472*0.88 = 1295 high
    expect(l.strapHeight).toBe(1295);
    expect(l.strapWidth).toBe(324); // 500/2000 * 1295, rounded
    expect(l.strapLeft).toBe(Math.round((DRAFT_CANVAS_WIDTH - 324) / 2));
    expect(l.strapTop).toBe(Math.round((DRAFT_CANVAS_HEIGHT - 1295) / 2));
  });

  it('fits a wide strap to the safe width instead', () => {
    const l = computeDraftLayout({ strapWidth: 2000, strapHeight: 500, faceWidth: 400, faceHeight: 400 });
    expect(l.strapWidth).toBe(732);
    expect(l.strapHeight).toBe(183);
  });

  it('never enlarges a strap smaller than the safe box', () => {
    const l = computeDraftLayout({ strapWidth: 200, strapHeight: 300, faceWidth: 400, faceHeight: 400 });
    expect(l.strapWidth).toBe(200);
    expect(l.strapHeight).toBe(300);
  });

  it('sizes the face at 16% of the rendered strap width', () => {
    const l = computeDraftLayout({ strapWidth: 500, strapHeight: 2000, faceWidth: 400, faceHeight: 400 });
    expect(l.faceWidth).toBe(Math.round(324 * 0.16)); // 52
  });

  it('preserves the face aspect ratio', () => {
    const l = computeDraftLayout({ strapWidth: 500, strapHeight: 2000, faceWidth: 400, faceHeight: 800 });
    expect(l.faceHeight).toBe(l.faceWidth * 2);
  });

  it('centres the face horizontally on the strap', () => {
    const l = computeDraftLayout({ strapWidth: 500, strapHeight: 2000, faceWidth: 400, faceHeight: 400 });
    expect(l.faceLeft).toBe(Math.round(l.strapLeft + (l.strapWidth - l.faceWidth) / 2));
  });

  it('places the face centre at 30% down the strap, not the canvas', () => {
    const l = computeDraftLayout({ strapWidth: 500, strapHeight: 2000, faceWidth: 400, faceHeight: 400 });
    const faceCentreY = l.faceTop + l.faceHeight / 2;
    expect(faceCentreY).toBeCloseTo(l.strapTop + l.strapHeight * 0.3, 0);
  });

  it('keeps every element inside the canvas', () => {
    const l = computeDraftLayout({ strapWidth: 3000, strapHeight: 400, faceWidth: 1200, faceHeight: 900 });
    expect(l.strapLeft).toBeGreaterThanOrEqual(0);
    expect(l.strapTop).toBeGreaterThanOrEqual(0);
    expect(l.faceLeft).toBeGreaterThanOrEqual(0);
    expect(l.faceTop).toBeGreaterThanOrEqual(0);
    expect(l.faceLeft + l.faceWidth).toBeLessThanOrEqual(DRAFT_CANVAS_WIDTH);
    expect(l.faceTop + l.faceHeight).toBeLessThanOrEqual(DRAFT_CANVAS_HEIGHT);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- draftComposite`
Expected: FAIL — cannot resolve `@/lib/draftComposite`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/draftComposite.ts
// Renders the single normalized input image the Kontext LoRA is trained and served on.
// This module is the ONE place the draft's geometry is defined: the dataset scripts and the
// production route must both call it. If the two ever build drafts differently, the model is
// trained on one distribution and served another (train/serve skew) — it still runs, it just
// quietly gets worse, which is very hard to diagnose. Keep it that way.

// Fixed 9:16 canvas. Kontext is an edit model: the output inherits the input's geometry, so
// every draft has to share one frame. Both dimensions are divisible by 16.
export const DRAFT_CANVAS_WIDTH = 832;
export const DRAFT_CANVAS_HEIGHT = 1472;

// Breathing room so a strap never touches the frame edge.
export const DRAFT_MARGIN_RATIO = 0.06;

// Carried over unchanged from /api/generate — see the tuning history in that file before
// touching either value.
export const FACE_TO_STRAP_WIDTH_RATIO = 0.16;
export const SHORT_END_TOP_RATIO = 0.30;

export type DraftLayout = {
    strapWidth: number;
    strapHeight: number;
    strapLeft: number;
    strapTop: number;
    faceWidth: number;
    faceHeight: number;
    faceLeft: number;
    faceTop: number;
};

export function computeDraftLayout(input: {
    strapWidth: number;
    strapHeight: number;
    faceWidth: number;
    faceHeight: number;
}): DraftLayout {
    const safeWidth = Math.round(DRAFT_CANVAS_WIDTH * (1 - DRAFT_MARGIN_RATIO * 2));
    const safeHeight = Math.round(DRAFT_CANVAS_HEIGHT * (1 - DRAFT_MARGIN_RATIO * 2));

    // Shrink to fit, never enlarge — matches `withoutEnlargement: true` in the production resize.
    const scale = Math.min(safeWidth / input.strapWidth, safeHeight / input.strapHeight, 1);
    const strapWidth = Math.round(input.strapWidth * scale);
    const strapHeight = Math.round(input.strapHeight * scale);
    const strapLeft = Math.round((DRAFT_CANVAS_WIDTH - strapWidth) / 2);
    const strapTop = Math.round((DRAFT_CANVAS_HEIGHT - strapHeight) / 2);

    const faceWidth = Math.round(strapWidth * FACE_TO_STRAP_WIDTH_RATIO);
    const faceHeight = Math.round(faceWidth * (input.faceHeight / input.faceWidth));

    const faceLeft = Math.round(strapLeft + (strapWidth - faceWidth) / 2);
    // Anchored to the strap, not the canvas: the buckle-side segment has to read as shorter than
    // the tail-side segment, and that ratio is a property of the strap.
    const faceTop = Math.round(strapTop + strapHeight * SHORT_END_TOP_RATIO - faceHeight / 2);

    return {
        strapWidth,
        strapHeight,
        strapLeft,
        strapTop,
        faceWidth,
        faceHeight,
        faceLeft: clamp(faceLeft, 0, DRAFT_CANVAS_WIDTH - faceWidth),
        faceTop: clamp(faceTop, 0, DRAFT_CANVAS_HEIGHT - faceHeight),
    };
}

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- draftComposite`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/draftComposite.ts src/lib/__tests__/draftComposite.test.ts
git commit -m "feat: add fixed-canvas draft layout math for Kontext training"
```

---

### Task 3: Draft image rendering

**Files:**
- Modify: `src/lib/draftComposite.ts`
- Modify: `src/lib/__tests__/draftComposite.test.ts`

**Interfaces:**
- Consumes: `computeDraftLayout` from Task 2
- Produces: `buildDraftComposite(strapBuffer: Buffer, faceBuffer: Buffer): Promise<Buffer>` — returns a PNG, always exactly 832×1472, white background.

- [ ] **Step 1: Append the failing tests**

```ts
// append to src/lib/__tests__/draftComposite.test.ts
import sharp from 'sharp';
import { buildDraftComposite } from '@/lib/draftComposite';

async function solid(width: number, height: number, colour: { r: number; g: number; b: number }) {
  return sharp({ create: { width, height, channels: 3, background: colour } }).png().toBuffer();
}

describe('buildDraftComposite', () => {
  it('always returns a 832x1472 PNG regardless of input sizes', async () => {
    const strap = await solid(900, 2600, { r: 120, g: 60, b: 20 });
    const face = await solid(600, 600, { r: 10, g: 10, b: 10 });
    const meta = await sharp(await buildDraftComposite(strap, face)).metadata();
    expect(meta.width).toBe(832);
    expect(meta.height).toBe(1472);
    expect(meta.format).toBe('png');
  });

  it('produces an identical buffer for identical inputs', async () => {
    const strap = await solid(900, 2600, { r: 120, g: 60, b: 20 });
    const face = await solid(600, 600, { r: 10, g: 10, b: 10 });
    const a = await buildDraftComposite(strap, face);
    const b = await buildDraftComposite(strap, face);
    expect(a.equals(b)).toBe(true);
  });

  it('leaves the canvas corners white', async () => {
    const strap = await solid(900, 2600, { r: 120, g: 60, b: 20 });
    const face = await solid(600, 600, { r: 10, g: 10, b: 10 });
    const out = await buildDraftComposite(strap, face);
    const { data } = await sharp(out).extract({ left: 0, top: 0, width: 4, height: 4 }).raw().toBuffer({ resolveWithObject: true });
    expect(data[0]).toBe(255);
    expect(data[1]).toBe(255);
    expect(data[2]).toBe(255);
  });

  it('places the dark face at the computed position', async () => {
    const strap = await solid(900, 2600, { r: 200, g: 200, b: 200 });
    const face = await solid(600, 600, { r: 0, g: 0, b: 0 });
    const out = await buildDraftComposite(strap, face);
    const layout = computeDraftLayout({ strapWidth: 900, strapHeight: 2600, faceWidth: 600, faceHeight: 600 });
    const { data } = await sharp(out)
      .extract({
        left: layout.faceLeft + Math.floor(layout.faceWidth / 2),
        top: layout.faceTop + Math.floor(layout.faceHeight / 2),
        width: 1,
        height: 1,
      })
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect(data[0]).toBeLessThan(30);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- draftComposite`
Expected: FAIL — `buildDraftComposite` is not exported.

- [ ] **Step 3: Append the implementation to `src/lib/draftComposite.ts`**

```ts
import sharp from 'sharp';

// PNG, not JPEG: JPEG chroma subsampling visibly degrades fine repeating strap patterns, which is
// exactly the detail the model has to copy. Same reasoning as the production pipeline.
export async function buildDraftComposite(strapBuffer: Buffer, faceBuffer: Buffer): Promise<Buffer> {
    const strapMeta = await sharp(strapBuffer).metadata();
    const faceMeta = await sharp(faceBuffer).metadata();
    if (!strapMeta.width || !strapMeta.height) throw new Error('Strap image has no readable dimensions');
    if (!faceMeta.width || !faceMeta.height) throw new Error('Face image has no readable dimensions');

    const layout = computeDraftLayout({
        strapWidth: strapMeta.width,
        strapHeight: strapMeta.height,
        faceWidth: faceMeta.width,
        faceHeight: faceMeta.height,
    });

    // flatten() first: library faces are often transparent PNGs, and compositing those over the
    // strap would show the strap through the dial instead of covering it.
    const strapLayer = await sharp(strapBuffer)
        .resize({ width: layout.strapWidth, height: layout.strapHeight, fit: 'fill' })
        .flatten({ background: '#ffffff' })
        .png()
        .toBuffer();

    const faceLayer = await sharp(faceBuffer)
        .resize({ width: layout.faceWidth, height: layout.faceHeight, fit: 'fill' })
        .flatten({ background: '#ffffff' })
        .png()
        .toBuffer();

    return sharp({
        create: {
            width: DRAFT_CANVAS_WIDTH,
            height: DRAFT_CANVAS_HEIGHT,
            channels: 3,
            background: { r: 255, g: 255, b: 255 },
        },
    })
        .composite([
            { input: strapLayer, left: layout.strapLeft, top: layout.strapTop },
            { input: faceLayer, left: layout.faceLeft, top: layout.faceTop },
        ])
        .png({ compressionLevel: 9 })
        .toBuffer();
}
```

Move the `import sharp from 'sharp';` line to the top of the file with the other imports.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- draftComposite`
Expected: PASS, 12 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/draftComposite.ts src/lib/__tests__/draftComposite.test.ts
git commit -m "feat: render fixed-canvas draft composites with sharp"
```

---

### Task 4: Extract the PRO prompt so scripts and route share one copy

**Files:**
- Create: `src/lib/proPrompt.ts`
- Create: `src/lib/__tests__/proPrompt.test.ts`
- Modify: `src/app/api/generate/route.ts:289`

**Interfaces:**
- Consumes: nothing
- Produces: `PRO_ASSEMBLY_PROMPT: string` — the exact prompt currently inlined in the route, unchanged.

This is a pure move. The dataset scripts must call PRO with byte-identical text, and duplicating a 2000-character string in two files guarantees they diverge.

- [ ] **Step 1: Create `src/lib/proPrompt.ts`**

The literal at `src/app/api/generate/route.ts:289` is **3395 characters**. Do not retype or hand-copy it. Run this, which lifts it out of the route and writes the module, making transcription error impossible:

```bash
node -e '
const fs = require("fs");
const src = fs.readFileSync("src/app/api/generate/route.ts", "utf8");
const line = src.split("\n").find((l) => l.trim().startsWith("prompt:"));
const m = line.match(/^\s*prompt:\s*"((?:[^"\\]|\\.)*)"\s*\+\s*strapProfileClause,?\s*$/);
if (!m) { console.error("could not parse the prompt line"); process.exit(1); }
fs.writeFileSync("src/lib/proPrompt.ts",
`// The FLUX-2-PRO assembly prompt, lifted verbatim out of /api/generate so the LoRA dataset
// scripts generate their "after" images with exactly the text production uses. Do not reword:
// src/lib/__tests__/proPrompt.test.ts pins its checksum on purpose.
export const PRO_ASSEMBLY_PROMPT = "${m[1]}";
`);
console.log("wrote src/lib/proPrompt.ts");
'
```

Expected output: `wrote src/lib/proPrompt.ts`

- [ ] **Step 2: Write the lock test**

```ts
// src/lib/__tests__/proPrompt.test.ts
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { PRO_ASSEMBLY_PROMPT } from '@/lib/proPrompt';

describe('PRO_ASSEMBLY_PROMPT', () => {
  it('still contains the load-bearing instructions', () => {
    expect(PRO_ASSEMBLY_PROMPT).toContain('Image 1 shows the required composition');
    expect(PRO_ASSEMBLY_PROMPT).toContain('roughly 28-32% of its length');
    expect(PRO_ASSEMBLY_PROMPT).toContain('physically correct spring bar under the four lugs');
  });

  it('is byte-for-byte unchanged', () => {
    // Measured from the current route on 2026-08-07. Change these two values ONLY when
    // deliberately editing the prompt, and say so in the commit message.
    expect(PRO_ASSEMBLY_PROMPT).toHaveLength(3395);
    const digest = createHash('sha256').update(PRO_ASSEMBLY_PROMPT).digest('hex');
    expect(digest).toBe('7a3c700cd782fdcfa05f2c06fe65503e7ffb28e70ba45fd5bf08774e7005ae1b');
  });
});
```

- [ ] **Step 3: Run the test to confirm the extraction was lossless**

Run: `npm run test -- proPrompt`
Expected: PASS, 2 tests. A length or digest mismatch means Step 1's extraction dropped or altered characters — fix that before continuing, do not edit the expected values.

- [ ] **Step 4: Wire the route to the shared constant**

In `src/app/api/generate/route.ts`, add to the imports:

```ts
import { PRO_ASSEMBLY_PROMPT } from '@/lib/proPrompt';
```

Replace the `prompt:` line inside `replicateInput` with:

```ts
            prompt: PRO_ASSEMBLY_PROMPT + strapProfileClause,
```

- [ ] **Step 5: Verify nothing else changed**

Run: `npm run test && npm run lint && npm run build`
Expected: all pass.

Run: `git diff --stat src/app/api/generate/route.ts`
Expected: a small diff — one import added, one long line replaced. If any other line changed, revert and redo.

- [ ] **Step 6: Commit**

```bash
git add src/lib/proPrompt.ts src/lib/__tests__/proPrompt.test.ts src/app/api/generate/route.ts
git commit -m "refactor: extract PRO assembly prompt to a shared, checksum-locked module"
```

---

### Task 5: Spend guard

**Files:**
- Create: `scripts/lib/spendGuard.ts`
- Create: `scripts/lib/spendGuard.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `class SpendExceededError extends Error`
  - `createSpendGuard(opts: { maxSpend: number; label: string }): SpendGuard`
  - `type SpendGuard = { charge(unitCost: number, description: string): void; spent(): number; remaining(): number; summary(): string }`

`charge` is called **before** each paid API call and throws `SpendExceededError` if the charge would push the total past `maxSpend`. Pre-charging is deliberate: a call that already happened cannot be un-billed.

- [ ] **Step 1: Write the failing tests**

```ts
// scripts/lib/spendGuard.test.ts
import { describe, it, expect } from 'vitest';
import { createSpendGuard, SpendExceededError } from './spendGuard';

describe('createSpendGuard', () => {
  it('accumulates charges', () => {
    const g = createSpendGuard({ maxSpend: 1, label: 'test' });
    g.charge(0.1, 'a');
    g.charge(0.25, 'b');
    expect(g.spent()).toBeCloseTo(0.35, 6);
    expect(g.remaining()).toBeCloseTo(0.65, 6);
  });

  it('throws before allowing a charge that would exceed the cap', () => {
    const g = createSpendGuard({ maxSpend: 1, label: 'test' });
    g.charge(0.9, 'a');
    expect(() => g.charge(0.2, 'b')).toThrow(SpendExceededError);
    expect(g.spent()).toBeCloseTo(0.9, 6); // rejected charge is not recorded
  });

  it('allows a charge that lands exactly on the cap', () => {
    const g = createSpendGuard({ maxSpend: 1, label: 'test' });
    expect(() => g.charge(1, 'a')).not.toThrow();
    expect(g.remaining()).toBe(0);
  });

  it('rejects a non-positive cap outright', () => {
    expect(() => createSpendGuard({ maxSpend: 0, label: 'test' })).toThrow();
    expect(() => createSpendGuard({ maxSpend: -1, label: 'test' })).toThrow();
  });

  it('names the label and both amounts in the error', () => {
    const g = createSpendGuard({ maxSpend: 0.5, label: 'generate-pairs' });
    try {
      g.charge(0.75, 'one PRO call');
      throw new Error('should have thrown');
    } catch (err) {
      expect(String(err)).toContain('generate-pairs');
      expect(String(err)).toContain('0.75');
      expect(String(err)).toContain('0.50');
    }
  });

  it('summarises spend for logging', () => {
    const g = createSpendGuard({ maxSpend: 2, label: 'test' });
    g.charge(0.5, 'a');
    expect(g.summary()).toContain('$0.50');
    expect(g.summary()).toContain('$2.00');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- spendGuard`
Expected: FAIL — cannot resolve `./spendGuard`.

- [ ] **Step 3: Write the implementation**

```ts
// scripts/lib/spendGuard.ts
// Every Replicate call in scripts/ goes through one of these. The pilot's whole budget is $4.63
// and there is no budget for a second training run, so an accidental loop must abort rather than
// spend. Charges are recorded BEFORE the paid call, never after — a call that already happened
// cannot be un-billed.

export class SpendExceededError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'SpendExceededError';
    }
}

export type SpendGuard = {
    charge(unitCost: number, description: string): void;
    spent(): number;
    remaining(): number;
    summary(): string;
};

export function createSpendGuard(opts: { maxSpend: number; label: string }): SpendGuard {
    if (!(opts.maxSpend > 0)) {
        throw new Error(`maxSpend must be a positive number, got ${opts.maxSpend}`);
    }

    let total = 0;

    return {
        charge(unitCost: number, description: string) {
            const next = total + unitCost;
            // Tolerate float dust so a cap of exactly 1 accepts 0.1 x 10.
            if (next > opts.maxSpend + 1e-9) {
                throw new SpendExceededError(
                    `[${opts.label}] refusing "${description}": $${unitCost.toFixed(2)} would take spend to ` +
                    `$${next.toFixed(2)}, over the $${opts.maxSpend.toFixed(2)} cap (already spent $${total.toFixed(2)}).`,
                );
            }
            total = next;
        },
        spent: () => total,
        remaining: () => Math.max(0, opts.maxSpend - total),
        summary: () => `[${opts.label}] spent $${total.toFixed(2)} of $${opts.maxSpend.toFixed(2)}`,
    };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- spendGuard`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/spendGuard.ts scripts/lib/spendGuard.test.ts
git commit -m "feat: add spend guard for budget-capped Replicate scripts"
```

---

### Task 6: Combo sampling

**Files:**
- Create: `scripts/dataset/selectCombos.ts`
- Create: `scripts/dataset/selectCombos.test.ts`
- Create: `scripts/dataset/sample-combos.ts`

**Interfaces:**
- Consumes: `Product` from `src/lib/woocommerce.ts`, `FaceItem` from `src/lib/aws.ts`, `classifyStrap` from `src/lib/strapProfile.ts`
- Produces:
  - `type Combo = { id: string; productId: number; productName: string; strapImage: string; categories: string[]; attributes: Attribute[]; faceKey: string; faceName: string; bucket: string }`
  - `selectCombos(products: Product[], faces: FaceItem[], count: number): Combo[]`

`categories` and `attributes` are carried on the combo because `/api/generate` builds its strap-profile prompt clause from them. Dropping them would make the dataset's "after" images come from a different prompt than production uses.
  - CLI: `npm run ds scripts/dataset/sample-combos.ts` → writes `scripts/dataset/out/combos.json`

Selection is deterministic (seeded LCG, seed 19826) so re-running reproduces the same set. Products are bucketed by their `classifyStrap` profile and drawn round-robin across buckets, so a catalog dominated by one strap type cannot swamp the sample.

- [ ] **Step 1: Write the failing tests**

```ts
// scripts/dataset/selectCombos.test.ts
import { describe, it, expect } from 'vitest';
import { selectCombos } from './selectCombos';
import type { Product } from '../../src/lib/woocommerce';
import type { FaceItem } from '../../src/lib/aws';

function product(id: number, name: string, category: string, attrs: { name: string; options: string[] }[] = []): Product {
  return {
    id, name, price: '0', link: '', image: `https://cdn.example/${id}.jpg`, thumbnail: '',
    attributes: attrs, categories: [{ id: 1, name: category, slug: category }], tags: [],
  };
}
function face(key: string, category: string): FaceItem {
  return { key, name: key, category };
}

const PRODUCTS: Product[] = [
  product(1, 'Padded Classic', 'Classic Watch Straps', [{ name: 'Material', options: ['Padded'] }]),
  product(2, 'Flat Classic', 'Classic Watch Straps'),
  product(3, 'Vintage Racing', 'Vintage Watch Straps'),
  product(4, 'Vintage Bund', 'Vintage Watch Straps', [{ name: 'Material', options: ['Padded'] }]),
];
const FACES: FaceItem[] = [
  face('f/rolex/a.jpg', 'rolex'), face('f/rolex/b.jpg', 'rolex'),
  face('f/omega/c.jpg', 'omega'), face('f/seiko/d.jpg', 'seiko'),
];

describe('selectCombos', () => {
  it('returns exactly the requested count', () => {
    expect(selectCombos(PRODUCTS, FACES, 8)).toHaveLength(8);
  });

  it('is deterministic across runs', () => {
    expect(selectCombos(PRODUCTS, FACES, 8)).toEqual(selectCombos(PRODUCTS, FACES, 8));
  });

  it('gives every product bucket a turn before repeating one', () => {
    const buckets = selectCombos(PRODUCTS, FACES, 4).map((c) => c.bucket);
    expect(new Set(buckets).size).toBeGreaterThan(1);
  });

  it('spreads faces across brand categories', () => {
    const categories = new Set(selectCombos(PRODUCTS, FACES, 6).map((c) => c.faceKey.split('/')[1]));
    expect(categories.size).toBeGreaterThan(1);
  });

  it('never emits the same product+face pair twice', () => {
    const combos = selectCombos(PRODUCTS, FACES, 12);
    const ids = combos.map((c) => `${c.productId}::${c.faceKey}`);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('terminates and never exceeds the unique pairs available', () => {
    // 4 products x 4 faces = 16 possible pairs. Round-robin plus a bounded attempt budget may
    // stop a little short of exhausting them; what matters is that it terminates and never
    // invents a duplicate.
    const combos = selectCombos(PRODUCTS, FACES, 999);
    expect(combos.length).toBeLessThanOrEqual(16);
    expect(combos.length).toBeGreaterThanOrEqual(12);
  });

  it('carries the product categories and attributes needed for the prompt clause', () => {
    const combo = selectCombos(PRODUCTS, FACES, 4)[0];
    expect(Array.isArray(combo.categories)).toBe(true);
    expect(Array.isArray(combo.attributes)).toBe(true);
  });

  it('gives each combo a stable, filesystem-safe id', () => {
    for (const combo of selectCombos(PRODUCTS, FACES, 4)) {
      expect(combo.id).toMatch(/^[a-z0-9-]+$/);
    }
  });

  it('throws when either catalog is empty', () => {
    expect(() => selectCombos([], FACES, 4)).toThrow();
    expect(() => selectCombos(PRODUCTS, [], 4)).toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- selectCombos`
Expected: FAIL — cannot resolve `./selectCombos`.

- [ ] **Step 3: Write `scripts/dataset/selectCombos.ts`**

```ts
import type { Product } from '../../src/lib/woocommerce';
import type { FaceItem } from '../../src/lib/aws';
import { classifyStrap, type Attribute } from '../../src/lib/strapProfile';

export type Combo = {
    id: string;
    productId: number;
    productName: string;
    strapImage: string;
    // Carried so generate-pairs.ts can rebuild the exact strap-profile prompt clause production
    // uses. classifyStrap prefers real WooCommerce attributes over guessing from the name.
    categories: string[];
    attributes: Attribute[];
    faceKey: string;
    faceName: string;
    bucket: string;
};

// Deterministic PRNG. Math.random would make a re-run pick a different sample, which defeats
// reproducing a training set later.
function lcg(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state / 0x100000000;
    };
}

function shuffled<T>(items: T[], rand: () => number): T[] {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
}

// Straps that share a construction profile teach the model the same thing, so the profile — not
// the product — is the unit we balance across.
function bucketOf(product: Product): string {
    const profile = classifyStrap(
        product.name,
        product.categories.map((c) => c.name),
        product.attributes,
    );
    // Field names come straight from the StrapProfile type — note it is `tipShape`, not `tip`,
    // and `stitch` is always set ('none' rather than undefined).
    return [
        profile.style,
        profile.padded ? 'padded' : 'flat',
        profile.curvedEnd ? 'curved' : 'straight',
        profile.stitch,
        profile.tipShape,
    ].join('-');
}

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
    const map = new Map<string, T[]>();
    for (const item of items) {
        const k = key(item);
        if (!map.has(k)) map.set(k, []);
        map.get(k)!.push(item);
    }
    return map;
}

export function selectCombos(products: Product[], faces: FaceItem[], count: number): Combo[] {
    if (products.length === 0) throw new Error('No products available to sample from');
    if (faces.length === 0) throw new Error('No faces available to sample from');

    const rand = lcg(19826);

    const productBuckets = [...groupBy(products, bucketOf).entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([bucket, items]) => ({ bucket, items: shuffled(items, rand) }));

    const faceBuckets = [...groupBy(faces, (f) => f.category).entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([, items]) => shuffled(items, rand));

    const combos: Combo[] = [];
    const seen = new Set<string>();
    const maxPairs = products.length * faces.length;
    const limit = Math.min(count, maxPairs);

    let productCursor = 0;
    let faceCursor = 0;
    // Bounded so an exhausted pair space can never spin forever.
    let attempts = 0;
    const maxAttempts = maxPairs * 4 + 1000;

    while (combos.length < limit && attempts < maxAttempts) {
        attempts++;
        const pb = productBuckets[productCursor % productBuckets.length];
        const fb = faceBuckets[faceCursor % faceBuckets.length];
        productCursor++;
        faceCursor++;

        const product = pb.items[Math.floor(rand() * pb.items.length)];
        const face = fb[Math.floor(rand() * fb.length)];
        const pairKey = `${product.id}::${face.key}`;
        if (seen.has(pairKey)) continue;
        seen.add(pairKey);

        combos.push({
            id: `${String(combos.length).padStart(3, '0')}-${slug(product.name)}-${slug(face.name)}`.slice(0, 80),
            productId: product.id,
            productName: product.name,
            strapImage: product.image,
            categories: product.categories.map((c) => c.name),
            attributes: product.attributes,
            faceKey: face.key,
            faceName: face.name,
            bucket: pb.bucket,
        });
    }

    return combos;
}

function slug(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'x';
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- selectCombos`
Expected: PASS, 9 tests.

- [ ] **Step 5: Write the CLI wrapper `scripts/dataset/sample-combos.ts`**

```ts
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { getDatabaseProducts } from '../../src/lib/woocommerce';
import { getDatabaseFaces } from '../../src/lib/aws';
import { selectCombos } from './selectCombos';

const ALLOWED_CATEGORIES = ['Classic Watch Straps', 'Vintage Watch Straps'];
const TRAIN_COUNT = 24;
const HELDOUT_COUNT = 6;
const OUT_DIR = path.join(process.cwd(), 'scripts/dataset/out');

async function main() {
    const [allProducts, faces] = await Promise.all([getDatabaseProducts(), getDatabaseFaces()]);
    // Same filter the customer-facing StrapSelector applies — training on products nobody can
    // actually pick would waste the budget.
    const products = allProducts.filter((p) =>
        p.categories.some((c) => ALLOWED_CATEGORIES.includes(c.name)) && Boolean(p.image),
    );

    console.log(`📦 ${products.length} eligible straps, ${faces.length} faces`);
    if (products.length === 0 || faces.length === 0) {
        throw new Error('Catalog is empty — run /api/woocommerce/sync and /api/faces/sync first');
    }

    const all = selectCombos(products, faces, TRAIN_COUNT + HELDOUT_COUNT);
    if (all.length < TRAIN_COUNT + HELDOUT_COUNT) {
        console.warn(`⚠️ only ${all.length} unique combos available`);
    }
    // Held-out combos are taken from the END so that shrinking TRAIN_COUNT later never moves a
    // combo from the eval set into the training set.
    const heldOut = all.slice(-HELDOUT_COUNT);
    const train = all.slice(0, all.length - HELDOUT_COUNT);

    await mkdir(OUT_DIR, { recursive: true });
    await writeFile(
        path.join(OUT_DIR, 'combos.json'),
        JSON.stringify({ train, heldOut }, null, 2),
    );

    const buckets = new Set(train.map((c) => c.bucket));
    console.log(`✅ ${train.length} train + ${heldOut.length} held-out across ${buckets.size} strap buckets`);
    console.log(`   → ${path.join(OUT_DIR, 'combos.json')}`);
    console.log('   You may hand-edit combos.json before generating (e.g. to swap in straps with busy backdrops).');
    process.exit(0);
}

main().catch((err) => {
    console.error('❌', err);
    process.exit(1);
});
```

- [ ] **Step 6: Run it against the real catalog**

Run: `npm run ds scripts/dataset/sample-combos.ts`
Expected: prints eligible counts and writes `scripts/dataset/out/combos.json` with 24 train + 6 held-out entries. Costs $0 — no Replicate calls.

- [ ] **Step 7: Commit**

```bash
git add scripts/dataset/selectCombos.ts scripts/dataset/selectCombos.test.ts scripts/dataset/sample-combos.ts
git commit -m "feat: add deterministic coverage-balanced combo sampling"
```

---

### Task 7: Generate before/after pairs through PRO

**Files:**
- Create: `scripts/dataset/generate-pairs.ts`

**Interfaces:**
- Consumes: `Combo` (Task 6), `buildDraftComposite` (Task 3), `PRO_ASSEMBLY_PROMPT` (Task 4), `createSpendGuard` (Task 5), `getObjectBuffer` from `src/lib/aws.ts`, `classifyStrap`/`buildStrapProfileClause` from `src/lib/strapProfile.ts`
- Produces: `scripts/dataset/out/pairs/<id>_start.png`, `scripts/dataset/out/pairs/<id>_end.png`, and `scripts/dataset/out/pairs.json` — an array of `{ id: string; bucket: string; productName: string; faceKey: string; strapImage: string; resolution: string }`.

**This is the first task that spends money.** It has three protections: a hard `--max-spend`, a mandatory pause after the first 3 images, and resume-on-restart so a crash never re-pays for completed work.

- [ ] **Step 1: Write the script**

```ts
import { mkdir, writeFile, readFile, access } from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline/promises';
import Replicate from 'replicate';
import { buildDraftComposite } from '../../src/lib/draftComposite';
import { PRO_ASSEMBLY_PROMPT } from '../../src/lib/proPrompt';
import { getObjectBuffer } from '../../src/lib/aws';
import { classifyStrap, buildStrapProfileClause } from '../../src/lib/strapProfile';
import { createSpendGuard, SpendExceededError } from '../lib/spendGuard';
import type { Combo } from './selectCombos';

const OUT_DIR = path.join(process.cwd(), 'scripts/dataset/out');
const PAIR_DIR = path.join(OUT_DIR, 'pairs');

// Unverified: Replicate publishes no price for flux-2-pro via API or its pricing page. These are
// deliberate OVER-estimates so the guard trips early rather than late. Step 4 of this task
// replaces them with the real figures read off the billing dashboard.
const ASSUMED_COST_1MP = 0.03;
const ASSUMED_COST_2MP = 0.06;

const CALIBRATION_COUNT = 3;

const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });

function arg(name: string, fallback: string): string {
    const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : fallback;
}

async function exists(file: string): Promise<boolean> {
    try { await access(file); return true; } catch { return false; }
}

async function loadStrapBuffer(url: string): Promise<Buffer> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Could not download strap image ${url} (${res.status})`);
    return Buffer.from(await res.arrayBuffer());
}

async function runPro(draft: Buffer, strapRef: Buffer, faceRef: Buffer, clause: string, resolution: string) {
    const toUri = (b: Buffer) => `data:image/png;base64,${b.toString('base64')}`;
    const output: unknown = await replicate.run('black-forest-labs/flux-2-pro', {
        input: {
            seed: 19826,
            prompt: PRO_ASSEMBLY_PROMPT + clause,
            resolution,
            aspect_ratio: '9:16',
            input_images: [toUri(draft), toUri(strapRef), toUri(faceRef)],
            output_format: 'webp',
            output_quality: 90,
            safety_tolerance: 5,
            prompt_upsampling: false,
        },
    });
    const url = typeof output === 'string' ? output : (output as { url: () => string }).url();
    const res = await fetch(String(url));
    if (!res.ok) throw new Error(`Could not download PRO output (${res.status})`);
    return Buffer.from(await res.arrayBuffer());
}

async function main() {
    const maxSpend = Number(arg('max-spend', '3.00'));
    const set = arg('set', 'train'); // "train" (1MP) or heldOut (2MP, production settings)
    const guard = createSpendGuard({ maxSpend, label: `generate-pairs:${set}` });

    const combos: Combo[] = JSON.parse(
        await readFile(path.join(OUT_DIR, 'combos.json'), 'utf8'),
    )[set === 'train' ? 'train' : 'heldOut'];

    const resolution = set === 'train' ? '1 MP' : '2 MP';
    const unitCost = set === 'train' ? ASSUMED_COST_1MP : ASSUMED_COST_2MP;

    await mkdir(PAIR_DIR, { recursive: true });
    const manifestPath = path.join(OUT_DIR, `pairs-${set}.json`);
    const manifest: Record<string, unknown>[] = (await exists(manifestPath))
        ? JSON.parse(await readFile(manifestPath, 'utf8'))
        : [];
    const done = new Set(manifest.map((m) => m.id as string));

    console.log(`🎬 ${set}: ${combos.length} combos at ${resolution}, cap $${maxSpend.toFixed(2)}, ${done.size} already done`);

    let generatedThisRun = 0;

    for (const combo of combos) {
        if (done.has(combo.id)) continue;

        // Mandatory calibration pause: everything above is an estimate until a human confirms
        // the real per-image charge on the dashboard.
        if (generatedThisRun === CALIBRATION_COUNT) {
            const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
            console.log(`\n⏸  ${CALIBRATION_COUNT} images generated. Open https://replicate.com/account/billing`);
            console.log(`   and check what those ${CALIBRATION_COUNT} predictions actually cost.`);
            const answer = await rl.question('   Real cost PER IMAGE in USD (or "abort"): ');
            rl.close();
            if (answer.trim().toLowerCase() === 'abort') {
                console.log('🛑 Aborted by user.');
                break;
            }
            const real = Number(answer.trim());
            if (!Number.isFinite(real) || real <= 0) throw new Error(`Not a valid price: "${answer}"`);
            if (real > unitCost) {
                throw new Error(
                    `Real cost $${real.toFixed(3)} exceeds the assumed $${unitCost.toFixed(3)}. ` +
                    `Update ASSUMED_COST_* in this file and re-run; the remaining budget must be recomputed by hand.`,
                );
            }
            console.log(`   ✅ Confirmed $${real.toFixed(3)}/image (assumed $${unitCost.toFixed(3)}, staying conservative).\n`);
        }

        try {
            guard.charge(unitCost, `PRO ${combo.id}`);
        } catch (err) {
            if (err instanceof SpendExceededError) {
                console.warn(`\n🛑 ${err.message}`);
                break;
            }
            throw err;
        }

        const [strapBuffer, { buffer: faceBuffer }] = await Promise.all([
            loadStrapBuffer(combo.strapImage),
            getObjectBuffer(combo.faceKey),
        ]);

        const draft = await buildDraftComposite(strapBuffer, faceBuffer);
        // Same three arguments /api/generate passes — categories and attributes matter, the
        // classifier falls back to weak name-regex guessing without them.
        const clause = buildStrapProfileClause(
            classifyStrap(combo.productName, combo.categories, combo.attributes),
        );
        const after = await runPro(draft, strapBuffer, faceBuffer, clause, resolution);

        await writeFile(path.join(PAIR_DIR, `${combo.id}_start.png`), draft);
        await writeFile(path.join(PAIR_DIR, `${combo.id}_end.webp`), after);

        manifest.push({
            id: combo.id,
            bucket: combo.bucket,
            productName: combo.productName,
            faceKey: combo.faceKey,
            strapImage: combo.strapImage,
            resolution,
        });
        // Written after every single pair so a crash resumes instead of re-paying.
        await writeFile(manifestPath, JSON.stringify(manifest, null, 2));

        generatedThisRun++;
        console.log(`  ✅ ${combo.id}  (${guard.summary()})`);
    }

    console.log(`\n${guard.summary()} — ${manifest.length}/${combos.length} pairs on disk`);
    process.exit(0);
}

main().catch((err) => {
    console.error('❌', err);
    process.exit(1);
});
```

- [ ] **Step 2: Dry-run the non-paid parts**

Temporarily set the loop to `break` after building the draft (before `guard.charge`), run it, confirm `scripts/dataset/out/pairs/*_start.png` files appear and open correctly at 832×1472, then restore the loop.

Run: `npm run ds scripts/dataset/generate-pairs.ts -- --set=train --max-spend=0.01`
Expected: drafts render; the run stops on the spend cap without calling PRO.

- [ ] **Step 3: Generate the training set**

Run: `npm run ds scripts/dataset/generate-pairs.ts -- --set=train --max-spend=1.50`
Expected: pauses after 3 images for the calibration answer, then continues to 24 pairs or the cap.

- [ ] **Step 4: Record the real unit price**

Replace `ASSUMED_COST_1MP` / `ASSUMED_COST_2MP` with the confirmed figures from Step 3, and update the cost table in `docs/superpowers/specs/2026-08-07-custom-watch-lora-design.md` §4 to match.

- [ ] **Step 5: Generate the held-out baseline**

Run: `npm run ds scripts/dataset/generate-pairs.ts -- --set=heldOut --max-spend=0.40`
Expected: 6 pairs at 2 MP.

- [ ] **Step 6: Commit**

```bash
git add scripts/dataset/generate-pairs.ts docs/superpowers/specs/2026-08-07-custom-watch-lora-design.md
git commit -m "feat: generate LoRA training pairs through PRO under a hard spend cap"
```

---

### Task 8: Geometric alignment

**Files:**
- Create: `scripts/dataset/align-pairs.ts`

**Interfaces:**
- Consumes: `pairs-train.json` and `pairs/*_end.webp` (Task 7), the `watchFaceBoxSchema` pattern from `src/app/api/generate/route.ts:36-42`
- Produces: `scripts/dataset/out/pairs/<id>_end_aligned.png` (832×1472) and `scripts/dataset/out/alignment.json` — `{ id: string; ok: boolean; reason?: string; scale: number }[]`

Kontext learns an edit best when before and after are pixel-aligned. This scales and shifts each PRO output so the watch sits where the draft's watch sits. Runs on the Vercel AI Gateway (`gpt-5-nano`), not Replicate, so it does not touch the $4.63 cap — roughly $0.01 for the whole set.

- [ ] **Step 1: Write the script**

```ts
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { generateText, Output } from 'ai';
import { z } from 'zod';
import { computeDraftLayout, DRAFT_CANVAS_WIDTH, DRAFT_CANVAS_HEIGHT } from '../../src/lib/draftComposite';

const OUT_DIR = path.join(process.cwd(), 'scripts/dataset/out');
const PAIR_DIR = path.join(OUT_DIR, 'pairs');
const MODEL = 'openai/gpt-5-nano';

// Reject a pair rather than train on a big geometric jump the LoRA would have to learn as part
// of the edit.
const MIN_SCALE = 0.5;
const MAX_SCALE = 2.0;

const boxSchema = z.object({
    found: z.boolean().describe('true if an assembled wristwatch is visible'),
    x: z.number().min(0).max(1).describe('left edge of the whole watch (strap included), as a fraction of width'),
    y: z.number().min(0).max(1).describe('top edge of the whole watch, as a fraction of height'),
    width: z.number().min(0).max(1).describe('width of the whole watch, as a fraction of width'),
    height: z.number().min(0).max(1).describe('height of the whole watch, as a fraction of height'),
});

async function locateWatch(buffer: Buffer): Promise<z.infer<typeof boxSchema>> {
    const meta = await sharp(buffer).metadata();
    const result = await generateText({
        model: MODEL,
        output: Output.object({ schema: boxSchema }),
        messages: [{
            role: 'user',
            content: [
                { type: 'text', text: 'Return a tight bounding box around the entire wristwatch in this photo — case, dial, and the full strap from buckle end to tail end. Exclude background. If no watch is visible, set found to false.' },
                { type: 'file', data: buffer, mediaType: meta.format ? `image/${meta.format}` : 'image/png' },
            ],
        }],
    });
    return result.output;
}

async function main() {
    const manifest: { id: string }[] = JSON.parse(
        await readFile(path.join(OUT_DIR, 'pairs-train.json'), 'utf8'),
    );

    const report: { id: string; ok: boolean; reason?: string; scale: number }[] = [];

    for (const entry of manifest) {
        const startPath = path.join(PAIR_DIR, `${entry.id}_start.png`);
        const endPath = path.join(PAIR_DIR, `${entry.id}_end.webp`);

        try {
            const [startBuf, endBuf] = await Promise.all([readFile(startPath), readFile(endPath)]);
            const [startBox, endBox] = await Promise.all([locateWatch(startBuf), locateWatch(endBuf)]);

            if (!startBox.found || !endBox.found || endBox.height <= 0.02 || startBox.height <= 0.02) {
                report.push({ id: entry.id, ok: false, reason: 'watch not located', scale: 0 });
                continue;
            }

            const endMeta = await sharp(endBuf).metadata();
            const endW = endMeta.width!;
            const endH = endMeta.height!;

            // Match heights: the strap's long axis is the most reliable shared measurement.
            const targetH = startBox.height * DRAFT_CANVAS_HEIGHT;
            const currentH = endBox.height * endH;
            const scale = targetH / currentH;

            if (scale < MIN_SCALE || scale > MAX_SCALE) {
                report.push({ id: entry.id, ok: false, reason: `scale ${scale.toFixed(2)} out of range`, scale });
                continue;
            }

            const scaledW = Math.max(1, Math.round(endW * scale));
            const scaledH = Math.max(1, Math.round(endH * scale));
            const scaled = await sharp(endBuf).resize({ width: scaledW, height: scaledH, fit: 'fill' }).toBuffer();

            // Line up the watch centres, then paste onto a canvas identical to the draft's.
            const endCentreX = (endBox.x + endBox.width / 2) * scaledW;
            const endCentreY = (endBox.y + endBox.height / 2) * scaledH;
            const startCentreX = (startBox.x + startBox.width / 2) * DRAFT_CANVAS_WIDTH;
            const startCentreY = (startBox.y + startBox.height / 2) * DRAFT_CANVAS_HEIGHT;

            const left = Math.round(startCentreX - endCentreX);
            const top = Math.round(startCentreY - endCentreY);

            const aligned = await sharp({
                create: { width: DRAFT_CANVAS_WIDTH, height: DRAFT_CANVAS_HEIGHT, channels: 3, background: { r: 255, g: 255, b: 255 } },
            })
                .composite([{ input: scaled, left, top }])
                .png()
                .toBuffer();

            await writeFile(path.join(PAIR_DIR, `${entry.id}_end_aligned.png`), aligned);
            report.push({ id: entry.id, ok: true, scale });
            console.log(`  ✅ ${entry.id}  scale ${scale.toFixed(2)}`);
        } catch (err) {
            report.push({ id: entry.id, ok: false, reason: String(err), scale: 0 });
            console.warn(`  ⚠️ ${entry.id}: ${err}`);
        }
    }

    await writeFile(path.join(OUT_DIR, 'alignment.json'), JSON.stringify(report, null, 2));
    const ok = report.filter((r) => r.ok).length;
    console.log(`\n${ok}/${report.length} pairs aligned`);
    process.exit(0);
}

main().catch((err) => {
    console.error('❌', err);
    process.exit(1);
});
```

Note: `sharp.composite` clips negative offsets on some versions. If a run reports `Image to composite must have same dimensions or smaller`, the pair is rejected by the try/catch and shows in `alignment.json` — that is acceptable at pilot scale.

- [ ] **Step 2: Run it**

Run: `npm run ds scripts/dataset/align-pairs.ts`
Expected: `_end_aligned.png` files appear; `alignment.json` reports how many succeeded. $0 on Replicate.

- [ ] **Step 3: Spot-check one pair**

Open one `<id>_start.png` and its `<id>_end_aligned.png` side by side. The watch should occupy roughly the same region of the frame in both.

- [ ] **Step 4: Commit**

```bash
git add scripts/dataset/align-pairs.ts
git commit -m "feat: geometrically align PRO outputs to their drafts before training"
```

---

### Task 9: Hand-review contact sheet

**Files:**
- Create: `scripts/dataset/build-contact-sheet.ts`

**Interfaces:**
- Consumes: `pairs-train.json` (Task 7), `alignment.json` (Task 8), the image files in `out/pairs/`
- Produces: `scripts/dataset/out/review.html` — opened from disk, keyboard-driven, downloads `approved.json` (`{ approved: string[] }`)

No dev server, no route in the app: `file://` plus relative `<img src>` is enough, and it keeps the frozen customer UI untouched.

- [ ] **Step 1: Write the script**

```ts
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const OUT_DIR = path.join(process.cwd(), 'scripts/dataset/out');

async function main() {
    const manifest: { id: string; bucket: string; productName: string; faceKey: string }[] =
        JSON.parse(await readFile(path.join(OUT_DIR, 'pairs-train.json'), 'utf8'));
    const alignment: { id: string; ok: boolean; reason?: string }[] =
        JSON.parse(await readFile(path.join(OUT_DIR, 'alignment.json'), 'utf8'));

    const alignedIds = new Set(alignment.filter((a) => a.ok).map((a) => a.id));
    const items = manifest.filter((m) => alignedIds.has(m.id));

    const html = `<!doctype html>
<meta charset="utf-8">
<title>LoRA pair review</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 0; background: #111; color: #eee; }
  header { position: sticky; top: 0; background: #000; padding: 12px 20px; border-bottom: 1px solid #333; }
  .pair { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; padding: 20px; border-bottom: 1px solid #333; }
  .pair.keep { background: #0b2a12; }
  .pair.drop { background: #2a0b0b; opacity: .45; }
  .pair.current { outline: 3px solid #4ea1ff; }
  img { width: 100%; background: #fff; }
  .meta { grid-column: 1 / -1; font-size: 13px; color: #999; }
  kbd { background: #333; padding: 2px 6px; border-radius: 3px; }
</style>
<header>
  <b>J</b> = keep &nbsp; <b>K</b> = drop &nbsp; <kbd>↑</kbd>/<kbd>↓</kbd> move &nbsp;
  <button id="save">Download approved.json</button>
  <span id="count"></span>
</header>
<main id="list"></main>
<script>
const ITEMS = ${JSON.stringify(items)};
const state = new Map(ITEMS.map(i => [i.id, null]));
let cursor = 0;

const list = document.getElementById('list');
list.innerHTML = ITEMS.map((it, i) => \`
  <section class="pair" id="p\${i}">
    <div><img src="pairs/\${it.id}_start.png" loading="lazy"></div>
    <div><img src="pairs/\${it.id}_end_aligned.png" loading="lazy"></div>
    <div class="meta">\${i + 1}/\${ITEMS.length} — \${it.productName} × \${it.faceKey} <em>(\${it.bucket})</em></div>
  </section>\`).join('');

function render() {
  ITEMS.forEach((it, i) => {
    const el = document.getElementById('p' + i);
    el.classList.toggle('keep', state.get(it.id) === true);
    el.classList.toggle('drop', state.get(it.id) === false);
    el.classList.toggle('current', i === cursor);
  });
  const kept = [...state.values()].filter(v => v === true).length;
  const seen = [...state.values()].filter(v => v !== null).length;
  document.getElementById('count').textContent = \` — kept \${kept}, reviewed \${seen}/\${ITEMS.length}\`;
  document.getElementById('p' + cursor)?.scrollIntoView({ block: 'center' });
}

function mark(keep) {
  state.set(ITEMS[cursor].id, keep);
  if (cursor < ITEMS.length - 1) cursor++;
  render();
}

addEventListener('keydown', (e) => {
  if (e.key === 'j' || e.key === 'J') mark(true);
  else if (e.key === 'k' || e.key === 'K') mark(false);
  else if (e.key === 'ArrowDown') { cursor = Math.min(ITEMS.length - 1, cursor + 1); render(); }
  else if (e.key === 'ArrowUp') { cursor = Math.max(0, cursor - 1); render(); }
  else return;
  e.preventDefault();
});

document.getElementById('save').onclick = () => {
  const approved = ITEMS.filter(i => state.get(i.id) === true).map(i => i.id);
  const blob = new Blob([JSON.stringify({ approved }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'approved.json';
  a.click();
};

render();
</script>`;

    await writeFile(path.join(OUT_DIR, 'review.html'), html);
    console.log(`✅ ${items.length} pairs → ${path.join(OUT_DIR, 'review.html')}`);
    console.log('   Open it, review, click "Download approved.json", then move that file into out/');
    process.exit(0);
}

main().catch((err) => {
    console.error('❌', err);
    process.exit(1);
});
```

- [ ] **Step 2: Build and open the sheet**

Run: `npm run ds scripts/dataset/build-contact-sheet.ts && open scripts/dataset/out/review.html`
Expected: pairs render side by side; `J`/`K` colour rows green/red.

- [ ] **Step 3: Review every pair**

Reject on any of: dial redrawn rather than copied; strap colour or grain wrong versus the source photo; strap forked, floating, or not threaded through the lugs; buckle/tail segment ratio visibly wrong; any human hand, skin, or the face photo's original strap surviving. Be strict — the LoRA reproduces whatever is approved.

- [ ] **Step 4: Save the result**

Click **Download approved.json**, then move it to `scripts/dataset/out/approved.json`.

Expected: 10-14 approved ids. Fewer than 8 means the dataset is too thin to train — stop and report rather than spending the training budget.

- [ ] **Step 5: Commit**

```bash
git add scripts/dataset/build-contact-sheet.ts
git commit -m "feat: add offline contact sheet for hand-reviewing training pairs"
```

---

### Task 10: Pack the training zip

**Files:**
- Create: `scripts/dataset/pack-dataset.ts`

**Interfaces:**
- Consumes: `approved.json` (Task 9), `pairs/*_start.png`, `pairs/*_end_aligned.png`
- Produces: `scripts/dataset/out/dataset.zip` containing `000_start.jpg` / `000_end.jpg` … one numbered pair each

JPEG is used because that is the naming convention the trainer documents, but with `chromaSubsampling: '4:4:4'` so the subsampling that damages fine strap grain is switched off.

- [ ] **Step 1: Write the script**

```ts
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import sharp from 'sharp';

const run = promisify(execFile);
const OUT_DIR = path.join(process.cwd(), 'scripts/dataset/out');
const PAIR_DIR = path.join(OUT_DIR, 'pairs');
const STAGE_DIR = path.join(OUT_DIR, 'zipstage');
const MIN_PAIRS = 8;

// 4:4:4 keeps full chroma resolution — the default 4:2:0 smears the fine repeating leather grain
// the model has to copy exactly.
const JPEG = { quality: 95, chromaSubsampling: '4:4:4' } as const;

async function main() {
    const { approved }: { approved: string[] } = JSON.parse(
        await readFile(path.join(OUT_DIR, 'approved.json'), 'utf8'),
    );

    if (approved.length < MIN_PAIRS) {
        throw new Error(`Only ${approved.length} approved pairs; need at least ${MIN_PAIRS} to justify a training run.`);
    }

    await rm(STAGE_DIR, { recursive: true, force: true });
    await mkdir(STAGE_DIR, { recursive: true });

    for (const [index, id] of approved.entries()) {
        const n = String(index).padStart(3, '0');
        await sharp(await readFile(path.join(PAIR_DIR, `${id}_start.png`)))
            .jpeg(JPEG).toFile(path.join(STAGE_DIR, `${n}_start.jpg`));
        await sharp(await readFile(path.join(PAIR_DIR, `${id}_end_aligned.png`)))
            .jpeg(JPEG).toFile(path.join(STAGE_DIR, `${n}_end.jpg`));
    }

    const zipPath = path.join(OUT_DIR, 'dataset.zip');
    await rm(zipPath, { force: true });
    // -j flattens paths: the trainer expects the pairs at the zip root, not inside a folder.
    await run('zip', ['-j', '-q', zipPath, ...(await import('node:fs')).readdirSync(STAGE_DIR).map((f) => path.join(STAGE_DIR, f))]);

    await writeFile(path.join(OUT_DIR, 'dataset-manifest.json'), JSON.stringify({ approved }, null, 2));
    console.log(`✅ ${approved.length} pairs → ${zipPath}`);
    process.exit(0);
}

main().catch((err) => {
    console.error('❌', err);
    process.exit(1);
});
```

- [ ] **Step 2: Build the zip**

Run: `npm run ds scripts/dataset/pack-dataset.ts`
Expected: `dataset.zip` written.

- [ ] **Step 3: Verify the zip's layout**

Run: `unzip -l scripts/dataset/out/dataset.zip | head -20`
Expected: flat entries named `000_start.jpg`, `000_end.jpg`, `001_start.jpg`, … with no directory prefix.

- [ ] **Step 4: Commit**

```bash
git add scripts/dataset/pack-dataset.ts
git commit -m "feat: pack approved pairs into the trainer's zip format"
```

---

### Task 11: Train

**Files:**
- Create: `scripts/dataset/train.ts`
- Modify: `src/lib/draftComposite.ts` (add the shared prompt constant)

**Interfaces:**
- Consumes: `dataset.zip` (Task 10)
- Produces: `KONTEXT_PROMPT_INSTRUCTION` exported from `src/lib/draftComposite.ts`; `scripts/dataset/out/training.json` — `{ id, status, weights, destination }`

The prompt instruction lives beside the draft builder because the two together define the model's input contract. Task 12 imports the same constant — training and inference must use identical text or the LoRA does not fire.

**Do not start this task until the manual prerequisites at the top of this plan are done.**

- [ ] **Step 1: Add the shared constant to `src/lib/draftComposite.ts`**

```ts
// The one instruction the LoRA is trained on and served with. Training and inference MUST pass
// byte-identical text: a LoRA is keyed to its trigger phrase, and a mismatch silently produces
// base-model output with no error.
export const KONTEXT_PROMPT_INSTRUCTION = 'assemble into a finished wristwatch product photo';
```

- [ ] **Step 2: Write the training script**

```ts
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import Replicate from 'replicate';
import { KONTEXT_PROMPT_INSTRUCTION } from '../../src/lib/draftComposite';

const OUT_DIR = path.join(process.cwd(), 'scripts/dataset/out');

const TRAINER_OWNER = 'replicate';
const TRAINER_NAME = 'fast-flux-kontext-trainer';
const TRAINER_VERSION = '26c877b4ec3988b7e8edc5840e61339c68f09913bb11e23c31566590fd92a66d';
const DESTINATION = 'tommy0710/watch-lora';
const TRAINING_STEPS = 700;

const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });

async function main() {
    const zip = await readFile(path.join(OUT_DIR, 'dataset.zip'));
    console.log(`📦 dataset.zip ${(zip.length / 1024 / 1024).toFixed(1)} MB`);
    console.log(`🎯 destination ${DESTINATION}, ${TRAINING_STEPS} steps, seed 19826`);
    console.log(`💬 "${KONTEXT_PROMPT_INSTRUCTION}"`);
    console.log('\n⚠️  This is the single training run the budget allows. Ctrl-C now to abort.\n');
    await new Promise((r) => setTimeout(r, 10_000));

    const training = await replicate.trainings.create(TRAINER_OWNER, TRAINER_NAME, TRAINER_VERSION, {
        destination: DESTINATION as `${string}/${string}`,
        input: {
            input_images: new File([new Uint8Array(zip)], 'dataset.zip', { type: 'application/zip' }),
            training_steps: TRAINING_STEPS,
            seed: 19826,
            kontext_prompt_instruction: KONTEXT_PROMPT_INSTRUCTION,
            ...(process.env.HF_TOKEN && process.env.HF_REPO_ID
                ? { hf_token: process.env.HF_TOKEN, hf_repo_id: process.env.HF_REPO_ID }
                : {}),
        },
    });

    console.log(`🚀 training ${training.id} — https://replicate.com/p/${training.id}`);
    await writeFile(path.join(OUT_DIR, 'training.json'), JSON.stringify({ id: training.id, status: training.status, destination: DESTINATION }, null, 2));

    let current = training;
    while (current.status === 'starting' || current.status === 'processing') {
        await new Promise((r) => setTimeout(r, 30_000));
        current = await replicate.trainings.get(current.id);
        console.log(`   ${new Date().toISOString()} ${current.status}`);
    }

    if (current.status !== 'succeeded') {
        throw new Error(`Training ${current.status}: ${JSON.stringify(current.error)}`);
    }

    const weights = (current.output as { weights?: string } | null)?.weights;
    await writeFile(
        path.join(OUT_DIR, 'training.json'),
        JSON.stringify({ id: current.id, status: current.status, weights, destination: DESTINATION }, null, 2),
    );
    console.log(`✅ weights: ${weights}`);
    process.exit(0);
}

main().catch((err) => {
    console.error('❌', err);
    process.exit(1);
});
```

- [ ] **Step 3: Confirm the destination model exists**

Run: `npm run ds -e "const r=new (require('replicate'))({auth:process.env.REPLICATE_API_TOKEN});r.models.get('tommy0710','watch-lora').then(m=>console.log('ok',m.name)).catch(e=>{console.error('MISSING — create it first');process.exit(1)})"`
Expected: `ok watch-lora`. If missing, complete manual prerequisite 1.

- [ ] **Step 4: Train**

Run: `npm run ds scripts/dataset/train.ts`
Expected: 10-second abort window, then status polling for 15-40 minutes, ending with a `weights` URL written to `out/training.json`.

- [ ] **Step 5: Commit**

```bash
git add scripts/dataset/train.ts src/lib/draftComposite.ts
git commit -m "feat: train the Kontext LoRA on the approved pair set"
```

---

### Task 12: Evaluate against PRO

**Files:**
- Create: `scripts/dataset/eval.ts`

**Interfaces:**
- Consumes: `training.json` (Task 11), `combos.json` held-out set (Task 6), `pairs/*_end.webp` held-out PRO baselines (Task 7), `buildDraftComposite` (Task 3), `KONTEXT_PROMPT_INSTRUCTION` (Task 11), `createSpendGuard` (Task 5)
- Produces: `scripts/dataset/out/eval/<id>_lora.webp`, `scripts/dataset/out/eval.html` (3-column `draft | PRO | LoRA`), `scripts/dataset/out/eval-timings.json`

- [ ] **Step 1: Write the script**

```ts
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import Replicate from 'replicate';
import { buildDraftComposite, KONTEXT_PROMPT_INSTRUCTION } from '../../src/lib/draftComposite';
import { getObjectBuffer } from '../../src/lib/aws';
import { createSpendGuard, SpendExceededError } from '../lib/spendGuard';
import type { Combo } from './selectCombos';

const OUT_DIR = path.join(process.cwd(), 'scripts/dataset/out');
const EVAL_DIR = path.join(OUT_DIR, 'eval');
const ASSUMED_LORA_COST = 0.03; // over-estimate on purpose; see Task 7 Step 4

const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });

function arg(name: string, fallback: string): string {
    const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : fallback;
}

async function main() {
    const guard = createSpendGuard({ maxSpend: Number(arg('max-spend', '0.30')), label: 'eval' });
    const { weights } = JSON.parse(await readFile(path.join(OUT_DIR, 'training.json'), 'utf8'));
    if (!weights) throw new Error('No weights in training.json — training has not succeeded yet');

    const { heldOut }: { heldOut: Combo[] } = JSON.parse(await readFile(path.join(OUT_DIR, 'combos.json'), 'utf8'));
    await mkdir(EVAL_DIR, { recursive: true });

    const timings: { id: string; seconds: number }[] = [];

    for (const combo of heldOut) {
        try {
            guard.charge(ASSUMED_LORA_COST, `LoRA ${combo.id}`);
        } catch (err) {
            if (err instanceof SpendExceededError) { console.warn(`🛑 ${err.message}`); break; }
            throw err;
        }

        const res = await fetch(combo.strapImage);
        const strapBuffer = Buffer.from(await res.arrayBuffer());
        const { buffer: faceBuffer } = await getObjectBuffer(combo.faceKey);
        const draft = await buildDraftComposite(strapBuffer, faceBuffer);
        await writeFile(path.join(EVAL_DIR, `${combo.id}_draft.png`), draft);

        const startedAt = Date.now();
        const output: unknown = await replicate.run('black-forest-labs/flux-kontext-dev-lora', {
            input: {
                seed: 19826,
                prompt: KONTEXT_PROMPT_INSTRUCTION,
                input_image: `data:image/png;base64,${draft.toString('base64')}`,
                lora_weights: weights,
                lora_strength: 1,
                megapixels: '1',
                output_format: 'webp',
                output_quality: 90,
                num_inference_steps: 30,
            },
        });
        const seconds = (Date.now() - startedAt) / 1000;

        const url = typeof output === 'string' ? output : (output as { url: () => string }).url();
        const img = await fetch(String(url));
        await writeFile(path.join(EVAL_DIR, `${combo.id}_lora.webp`), Buffer.from(await img.arrayBuffer()));

        timings.push({ id: combo.id, seconds });
        console.log(`  ✅ ${combo.id}  ${seconds.toFixed(1)}s  (${guard.summary()})`);
    }

    await writeFile(path.join(OUT_DIR, 'eval-timings.json'), JSON.stringify(timings, null, 2));

    const rows = timings.map((t) => `
  <section class="row">
    <div><h3>draft</h3><img src="eval/${t.id}_draft.png"></div>
    <div><h3>PRO</h3><img src="pairs/${t.id}_end.webp"></div>
    <div><h3>LoRA (${t.seconds.toFixed(1)}s)</h3><img src="eval/${t.id}_lora.webp"></div>
    <div class="meta">${t.id}</div>
  </section>`).join('');

    const mean = timings.length ? timings.reduce((s, t) => s + t.seconds, 0) / timings.length : 0;

    await writeFile(path.join(OUT_DIR, 'eval.html'), `<!doctype html>
<meta charset="utf-8"><title>LoRA vs PRO</title>
<style>
 body{font-family:system-ui,sans-serif;background:#111;color:#eee;margin:0}
 .row{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;padding:20px;border-bottom:1px solid #333}
 img{width:100%;background:#fff} h3{margin:0 0 6px;font-size:13px;color:#999;font-weight:500}
 .meta{grid-column:1/-1;font-size:12px;color:#777}
 header{position:sticky;top:0;background:#000;padding:12px 20px;border-bottom:1px solid #333}
</style>
<header>Held-out comparison — mean LoRA latency ${mean.toFixed(1)}s over ${timings.length} runs.
Pass criteria: catastrophic failures ≤1/6 · LoRA ≥ PRO on assembly in ≥4/6 · strap texture correct in ≥5/6 · mean latency &lt;15s</header>
${rows}`);

    console.log(`\n${guard.summary()} — mean ${mean.toFixed(1)}s`);
    console.log(`   → open ${path.join(OUT_DIR, 'eval.html')}`);
    process.exit(0);
}

main().catch((err) => {
    console.error('❌', err);
    process.exit(1);
});
```

- [ ] **Step 2: Run the evaluation**

Run: `npm run ds scripts/dataset/eval.ts -- --max-spend=0.30`
Expected: 6 LoRA generations with per-run timings.

- [ ] **Step 3: Score it against the criteria**

Run: `open scripts/dataset/out/eval.html`

Score all four criteria from the spec and write the verdict into `docs/superpowers/specs/2026-08-07-custom-watch-lora-design.md` as a new "Pilot result" section: catastrophic failures ≤1/6, LoRA ≥ PRO on assembly accuracy in ≥4/6, strap texture and colour correct in ≥5/6, mean latency <15s.

- [ ] **Step 4: Commit**

```bash
git add scripts/dataset/eval.ts docs/superpowers/specs/2026-08-07-custom-watch-lora-design.md
git commit -m "feat: evaluate the trained LoRA against PRO on held-out combos"
```

---

## Deviations from the spec

- **The deliberate "~10 busy-backdrop straps" quota is dropped.** At 24 training combos a 10-strap quota would consume 40% of the sample for one risk probe. Instead `sample-combos.ts` prints the selection and tells the operator they may hand-edit `combos.json`, and the contact sheet shows the draft so backdrop-related failures are observable at review time. Risk R3 is downgraded from measured to observed for the pilot.
- **Training pairs are JPEG at quality 95 with 4:4:4 chroma**, not PNG. The trainer documents `.jpg` naming; disabling chroma subsampling addresses the texture concern that motivated PNG elsewhere.
- **Production engine switching is out of scope**, per the Global Constraints. `GENERATE_ENGINE`, `generateEngines/*`, and PRO removal belong to a follow-up plan gated on the eval verdict.
