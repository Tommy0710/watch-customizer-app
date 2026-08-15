import { readFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import type Replicate from 'replicate';
import { splitStrapSegments } from './strapSegments';
import { buildDraftComposite } from './draftComposite';
import { buildSegmentedDraft, computeSegmentedLayout } from './segmentedDraft';
import { trimSpringBarPins, measureSegment, measureFace } from './segmentFit';
import { removeWhiteBackground } from './removeWhiteBackground';
import { assessDraft, type DraftAssessment } from './draftStandard';
import { buildLoraPrompt, buildMaterialAwareLoraPrompt, LORA_PROMPT_SCHEMA } from './loraPrompt';
import { buildMaterialClause, classifyMaterial } from './materialTaxonomy';
import { buildStrapProfileClause, classifyStrap, type Attribute } from './strapProfile';
import { getObjectBuffer, cleanStrapKey, getPresignedUrl } from './aws';
import { normaliseLoraWeights, parseS3WeightsKey } from './loraWeights';
import {
    getLoraModel,
    getLoraPromptStrength,
    getLoraSeed,
    getLoraPromptSchema,
    getLoraTestMode,
    DEFAULT_LORA_SCALE,
    DEFAULT_LORA_STEPS,
} from './loraConfig';

// Serving the trained style LoRA, using the SAME draft builder the training pairs were made with.
//
// That is the whole point of this file existing rather than the assembly being written inline in
// the route: a LoRA learns to finish one specific kind of draft, so a serving path that assembles
// its input even slightly differently is asking the model to do a job it never saw. Every function
// here is imported from the same modules scripts/dataset uses.

export const LORA_MODEL = getLoraModel();
// Found by sweeping 0.25 to 0.8 on a held-out pair: below 0.5 the model barely touches the draft
// and the pasted-on look survives, at 0.8 it starts reinventing the leather grain the draft exists
// to carry. 0.6-0.7 is the working band.
export const LORA_PROMPT_STRENGTH = getLoraPromptStrength();
// Fixed so the same strap and face give the same picture twice; a customer clicking Combine again
// on the same choices should not get a different watch.
export const LORA_SEED = getLoraSeed();

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

// Measured directly (2026-08-13): a fresh signed URL on every call made every generation re-download
// the 164MB weights file — 19-23s, up from the ~12s this used to take. Reusing the exact same URL for
// a second call dropped it to 7.1s, so Replicate is caching weights by URL identity, not file content.
// A signed URL's query string changes every time it's (re)signed even for the same key, so generating
// one per request defeated that cache on every single generation. Caching the URL itself in module
// scope — regenerated only when it's actually close to expiring — lets a warm serverless instance
// reuse it across requests the way the old owner/model/version reference did before Replicate's
// private-model serving broke.
const PRESIGN_TTL_SECONDS = 6 * 60 * 60;
const PRESIGN_REFRESH_MARGIN_MS = 30 * 60 * 1000;
let cachedWeightsUrl: { key: string; url: string; expiresAt: number } | null = null;

async function resolvePresignedWeightsUrl(key: string): Promise<string> {
    const now = Date.now();
    if (cachedWeightsUrl && cachedWeightsUrl.key === key && cachedWeightsUrl.expiresAt - now > PRESIGN_REFRESH_MARGIN_MS) {
        return cachedWeightsUrl.url;
    }
    const url = await getPresignedUrl(key, PRESIGN_TTL_SECONDS);
    cachedWeightsUrl = { key, url, expiresAt: now + PRESIGN_TTL_SECONDS * 1000 };
    return url;
}

// Self-hosted (s3://<key>) takes priority when set — it is what actually works right now, since
// Replicate's own private-model weight serving is broken account-wide (see getPresignedUrl in
// aws.ts). Falls through to the owner/model[/version] form so this keeps working unmodified once
// Replicate's side recovers and REPLICATE_LORA_WEIGHTS is pointed back at a model reference.
async function resolveLoraWeights(value: string | undefined): Promise<string | undefined> {
    const s3Key = parseS3WeightsKey(value);
    if (s3Key) return resolvePresignedWeightsUrl(s3Key);
    return normaliseLoraWeights(value);
}

export type LoraOutcome =
    | { ok: true; imageUrl: string; assessment: DraftAssessment; seconds: number; testMode: boolean }
    | { ok: false; reason: string };

async function loadCleanStrapRender(strapId: number | undefined, catalogUrl?: string): Promise<Buffer | null> {
    if (!strapId && getLoraTestMode() !== 'force') return null;
    try {
        if (strapId && CLEAN_STRAP_DIR) return await readFile(path.join(CLEAN_STRAP_DIR, `${strapId}.webp`));
        if (strapId) {
            const { buffer } = await getObjectBuffer(cleanStrapKey(strapId));
            return buffer;
        }
    } catch {
    }
    if (getLoraTestMode() !== 'force' || !catalogUrl) return null;
    try {
        if (catalogUrl.startsWith('data:image/')) {
            return Buffer.from(catalogUrl.replace(/^data:image\/[^;]+;base64,/, ''), 'base64');
        }
        const response = await fetch(catalogUrl);
        if (!response.ok) return null;
        return Buffer.from(await response.arrayBuffer());
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
    strapImage?: string;
    categories?: string[];
    attributes?: Attribute[];
}): Promise<LoraOutcome> {
    const weights = await resolveLoraWeights(process.env.REPLICATE_LORA_WEIGHTS);
    if (!weights) {
        return { ok: false, reason: 'REPLICATE_LORA_WEIGHTS is not set' };
    }

    const forceTest = getLoraTestMode() === 'force';
    const cleanRender = await loadCleanStrapRender(options.strapId, options.strapImage);
    if (!cleanRender) {
        return { ok: false, reason: `no clean studio render on file for strap ${options.strapId ?? '(no id sent)'}` };
    }

    const segments = await splitStrapSegments(cleanRender);
    if (!segments && !forceTest) {
        return { ok: false, reason: `the render for strap ${options.strapId} could not be split into two segments` };
    }

    const draft = segments
        ? await buildSegmentedDraft(segments, options.faceBuffer)
        : await buildDraftComposite(cleanRender, options.faceBuffer);
    const assessment = segments
        ? await assess(segments, options.faceBuffer)
        : { ok: false, reasons: ['force test used the catalog strap photo instead of a clean render'] };
    // Standing down rather than generating anyway. A below-standard draft produces a watch a
    // reviewer would reject, and PRO — slower and dearer, but proven — produces one they would not.
    // A customer waiting on a Combine click should get the better picture, not the cheaper one.
    if (!assessment.ok && !forceTest) {
        return { ok: false, reason: `draft is below standard — ${assessment.reasons.join('; ')}` };
    }

    const startedAt = Date.now();
    const prompt = getLoraPromptSchema() === LORA_PROMPT_SCHEMA
        ? buildMaterialAwareLoraPrompt(
            options.productName,
            buildStrapProfileClause(classifyStrap(options.productName, options.categories ?? [], options.attributes ?? [])),
            buildMaterialClause(classifyMaterial({ name: options.productName, categories: options.categories ?? [], attributes: options.attributes ?? [] })),
        )
        : buildLoraPrompt(options.productName);
    const output: unknown = await options.replicate.run(LORA_MODEL as `${string}/${string}`, {
        input: {
            seed: LORA_SEED,
            prompt,
            image: `data:image/png;base64,${draft.toString('base64')}`,
            prompt_strength: LORA_PROMPT_STRENGTH,
            lora_weights: weights,
            lora_scale: DEFAULT_LORA_SCALE,
            megapixels: '1',
            num_inference_steps: DEFAULT_LORA_STEPS,
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
        testMode: forceTest,
    };
}
