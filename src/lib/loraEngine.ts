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

// Clean studio renders of each strap, by product id. Production cannot use the raw catalog photo:
// measured on 23 of them, ZERO can be split into two segments, because catalog shots are staged on
// props at an angle against a coloured background. The splitter needs the strap laid flat on white,
// which is what these renders are.
//
// Reading them off disk is a development arrangement, not the finished one — they belong in S3
// beside the face library, keyed by product id, generated once per product and cached. Wiring that
// up is a separate job; this unblocks testing against the renders that already exist.
const CLEAN_STRAP_DIR = process.env.CLEAN_STRAP_DIR ?? path.join(process.cwd(), 'scripts/dataset/out/straps-clean');

export type LoraOutcome =
    | { ok: true; imageUrl: string; assessment: DraftAssessment; seconds: number }
    | { ok: false; reason: string };

async function loadCleanStrapRender(strapId: number | undefined): Promise<Buffer | null> {
    if (!strapId) return null;
    try {
        return await readFile(path.join(CLEAN_STRAP_DIR, `${strapId}.webp`));
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

// Runs the draft through the same standard the dataset review applies. It never blocks generation —
// a customer waiting on a Combine click gets a picture either way — but it puts the reason in the
// logs, so a disappointing result can be traced to a strap render that was never good enough
// rather than being blamed on the model.
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
    const weights = process.env.REPLICATE_LORA_WEIGHTS;
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
    if (!assessment.ok) {
        console.warn(`⚠️ draft is below standard but generating anyway — ${assessment.reasons.join('; ')}`);
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
