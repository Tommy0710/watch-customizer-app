import { readFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import type Replicate from 'replicate';
import { splitStrapSegments } from './strapSegments';
import { buildSegmentedDraft, computeSegmentedLayout } from './segmentedDraft';
import { trimSpringBarPins, measureSegment, measureFace } from './segmentFit';
import { removeWhiteBackground } from './removeWhiteBackground';
import { assessDraft, type DraftAssessment } from './draftStandard';
import { buildLoraPrompt } from './loraPrompt';
import { getObjectBuffer, cleanStrapKey } from './aws';
import { normaliseLoraWeights } from './loraWeights';

// Serving the trained style LoRA, using the SAME draft builder the training pairs were made with.
//
// That is the whole point of this file existing rather than the assembly being written inline in
// the route: a LoRA learns to finish one specific kind of draft, so a serving path that assembles
// its input even slightly differently is asking the model to do a job it never saw. Every function
// here is imported from the same modules scripts/dataset uses.

export const LORA_MODEL = 'black-forest-labs/flux-dev-lora';
// Found by sweeping 0.25 to 0.8 on a held-out pair: below 0.5 the model barely touches the draft
// and the pasted-on look survives, at 0.8 it starts reinventing the leather grain the draft exists
// to carry. 0.6-0.7 is the working band.
export const LORA_PROMPT_STRENGTH = 0.65;
// Fixed so the same strap and face give the same picture twice; a customer clicking Combine again
// on the same choices should not get a different watch.
export const LORA_SEED = 19826;

// Each strap needs a clean studio render on file before this engine can touch it, because the
// catalog photo cannot be used directly: measured on 23 catalog crops, ZERO can be split into two
// segments — they are staged on props, at an angle, against a coloured background. The splitter
// needs the strap laid flat on white.
//
// This was first written as a test scaffold to be deleted, on the reading that assembling from
// anything but the catalog photo broke the app's rule. Kept deliberately after review (2026-08-12):
// the rule is about what the customer SEES, and the customer still sees the catalog photo
// everywhere — StrapSelector renders product.image throughout, and the render never appears on
// screen. What it buys is consistency, which is the thing being optimised for: a strap either has
// a render that meets the signed-off standard, in which case every generation of it comes out the
// same way, or it has none and falls back to PRO. There is no in-between state where a customer
// gets a worse picture without anyone knowing.
//
// The cost of that is coverage. 13 of the 443 straps a customer can click have a render, and each
// one costs a PRO call to make. See the note in upload-clean-straps.ts on filling that in as demand
// asks for it rather than paying for all 443 up front.
//
// CLEAN_STRAP_DIR reads from a local folder instead, for working offline against the dataset.
const CLEAN_STRAP_DIR = process.env.CLEAN_STRAP_DIR;

export type LoraOutcome =
    | { ok: true; imageUrl: string; assessment: DraftAssessment; seconds: number }
    | { ok: false; reason: string };

async function loadCleanStrapRender(strapId: number | undefined): Promise<Buffer | null> {
    if (!strapId) return null;
    try {
        if (CLEAN_STRAP_DIR) return await readFile(path.join(CLEAN_STRAP_DIR, `${strapId}.webp`));
        const { buffer } = await getObjectBuffer(cleanStrapKey(strapId));
        return buffer;
    } catch {
        return null;
    }
}

function firstOutputUrl(out: unknown): string {
    // flux-dev-lora returns an ARRAY of outputs, unlike flux-2-pro which returns a single value.
    const item = Array.isArray(out) ? out[0] : out;
    if (typeof item === 'string') return item;
    const withUrl = item as { url?: () => string } | null;
    if (withUrl && typeof withUrl.url === 'function') return String(withUrl.url());
    throw new Error('Unexpected model output shape from the LoRA');
}

// Runs the draft through the same standard the dataset review applies, so a strap is judged in
// production by exactly the rules a reviewer signed off on.
async function assess(
    segments: { buckle: Buffer; tail: Buffer },
    faceBuffer: Buffer,
): Promise<DraftAssessment> {
    const prepared = await sharp(await removeWhiteBackground(faceBuffer))
        .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 0 })
        .png()
        .toBuffer();
    const meta = await sharp(prepared).metadata();
    const face = await measureFace(prepared);
    const [buckle, tail] = await Promise.all([
        measureSegment(await trimSpringBarPins(segments.buckle, 'bottom'), 'bottom'),
        measureSegment(await trimSpringBarPins(segments.tail, 'top'), 'top'),
    ]);
    const { caseScale } = computeSegmentedLayout({
        caseAspect: (meta.height ?? 1) / (meta.width ?? 1),
        buckleAspect: buckle.aspect,
        tailAspect: tail.aspect,
        strapPerCase: face.lugGap === null ? undefined : face.lugGap / face.width,
    });
    // Colour is left out here: the dataset check compares a render against its catalog source, and
    // production has only the render. It belongs at the point renders are made, not served.
    return assessDraft({
        buckleShare: buckle.aspect / (buckle.aspect + tail.aspect),
        caseScale,
        lugGapRead: face.lugGap !== null,
    });
}

export async function generateWithLora(options: {
    replicate: Replicate;
    strapId: number | undefined;
    faceBuffer: Buffer;
    productName: string;
}): Promise<LoraOutcome> {
    const weights = normaliseLoraWeights(process.env.REPLICATE_LORA_WEIGHTS);
    if (!weights) {
        return { ok: false, reason: 'REPLICATE_LORA_WEIGHTS is not set' };
    }

    const cleanRender = await loadCleanStrapRender(options.strapId);
    if (!cleanRender) {
        return { ok: false, reason: `no clean studio render on file for strap ${options.strapId ?? '(no id sent)'}` };
    }

    const segments = await splitStrapSegments(cleanRender);
    if (!segments) {
        return { ok: false, reason: `the render for strap ${options.strapId} could not be split into two segments` };
    }

    const [draft, assessment] = await Promise.all([
        buildSegmentedDraft(segments, options.faceBuffer),
        assess(segments, options.faceBuffer),
    ]);
    // Standing down rather than generating anyway. A below-standard draft produces a watch a
    // reviewer would reject, and PRO — slower and dearer, but proven — produces one they would not.
    // A customer waiting on a Combine click should get the better picture, not the cheaper one.
    if (!assessment.ok) {
        return { ok: false, reason: `draft is below standard — ${assessment.reasons.join('; ')}` };
    }

    const startedAt = Date.now();
    const output: unknown = await options.replicate.run(LORA_MODEL, {
        input: {
            seed: LORA_SEED,
            prompt: buildLoraPrompt(options.productName),
            image: `data:image/png;base64,${draft.toString('base64')}`,
            prompt_strength: LORA_PROMPT_STRENGTH,
            lora_weights: weights,
            lora_scale: 1,
            megapixels: '1',
            num_inference_steps: 30,
            output_format: 'webp',
            output_quality: 90,
            go_fast: false,
        },
    });

    return {
        ok: true,
        imageUrl: firstOutputUrl(output),
        assessment,
        seconds: (Date.now() - startedAt) / 1000,
    };
}
