import sharp from 'sharp';

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
