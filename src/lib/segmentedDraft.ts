import sharp from 'sharp';
import { DRAFT_CANVAS_WIDTH, DRAFT_CANVAS_HEIGHT, DRAFT_MARGIN_RATIO } from './draftComposite';
import { removeWhiteBackground } from './removeWhiteBackground';
import type { SplitStrap } from './strapSegments';

// Lays a strap out the way a finished watch actually reads: buckle segment above, case in the
// middle, holes segment below. The earlier draft pasted the head onto a side-by-side pair of
// segments — a picture of a strap NOT threaded through a case — and the model copied that
// faithfully, returning two parallel strips with a watch resting on them, or no watch at all.
//
// With this layout the draft is already almost the answer, so the edit left to learn is small:
// join the ends to the lugs and make it photoreal.

// A watch case is wider than its strap — measured off real assembled renders, roughly 1.6x the
// lug width. Expressed against the canvas so the case reads at a consistent size whatever the
// source segment resolution happens to be.
export const CASE_WIDTH_RATIO = 0.30;
export const SEGMENT_TO_CASE_WIDTH_RATIO = 1 / 1.6;

// The buckle side of a strap is the short side. Same 0.30 the production pipeline settled on
// after several rounds of tuning against real generations.
export const BUCKLE_LENGTH_RATIO = 0.30;

// How far the case overlaps each segment end, as a fraction of case height — the lugs sit on top
// of the leather rather than merely touching it.
const CASE_OVERLAP_RATIO = 0.12;

export type SegmentedDraftLayout = {
    caseWidth: number;
    caseHeight: number;
    caseLeft: number;
    caseTop: number;
    segmentWidth: number;
    buckleHeight: number;
    buckleTop: number;
    tailHeight: number;
    tailTop: number;
    segmentLeft: number;
};

export function computeSegmentedLayout(input: {
    caseAspect: number; // height / width of the watch head
}): SegmentedDraftLayout {
    const marginY = Math.round(DRAFT_CANVAS_HEIGHT * DRAFT_MARGIN_RATIO);
    const totalStrapHeight = DRAFT_CANVAS_HEIGHT - marginY * 2;

    const caseWidth = Math.round(DRAFT_CANVAS_WIDTH * CASE_WIDTH_RATIO);
    const caseHeight = Math.round(caseWidth * input.caseAspect);
    const segmentWidth = Math.round(caseWidth * SEGMENT_TO_CASE_WIDTH_RATIO);

    const overlap = Math.round(caseHeight * CASE_OVERLAP_RATIO);
    // Leather hidden behind the case is not strap length the viewer sees, so the two visible
    // segment lengths share what is left once the case has taken its place.
    const visibleStrap = totalStrapHeight - (caseHeight - overlap * 2);
    const buckleHeight = Math.max(1, Math.round(visibleStrap * BUCKLE_LENGTH_RATIO));
    const tailHeight = Math.max(1, visibleStrap - buckleHeight);

    const buckleTop = marginY;
    const caseTop = buckleTop + buckleHeight - overlap;
    const tailTop = caseTop + caseHeight - overlap;

    return {
        caseWidth,
        caseHeight,
        caseLeft: Math.round((DRAFT_CANVAS_WIDTH - caseWidth) / 2),
        caseTop,
        segmentWidth,
        buckleHeight,
        buckleTop,
        tailHeight,
        tailTop,
        segmentLeft: Math.round((DRAFT_CANVAS_WIDTH - segmentWidth) / 2),
    };
}

// Scales a segment to the target width, then crops it to the target height keeping the end that
// stays visible: the buckle end for the upper segment, the tip end for the lower one. The cut end
// is the one that meets the case.
async function fitSegment(
    segment: Buffer,
    width: number,
    height: number,
    keep: 'top' | 'bottom',
): Promise<Buffer> {
    const scaled = await sharp(segment).resize({ width }).png().toBuffer();
    const meta = await sharp(scaled).metadata();
    const scaledHeight = meta.height ?? height;

    if (scaledHeight <= height) {
        // Too short to fill its slot — pad on the cut side so the visible end stays put.
        return sharp(scaled)
            .extend({
                top: keep === 'bottom' ? height - scaledHeight : 0,
                bottom: keep === 'top' ? height - scaledHeight : 0,
                background: { r: 255, g: 255, b: 255, alpha: 0 },
            })
            .png()
            .toBuffer();
    }

    return sharp(scaled)
        .extract({
            left: 0,
            top: keep === 'top' ? 0 : scaledHeight - height,
            width: meta.width ?? width,
            height,
        })
        .png()
        .toBuffer();
}

export async function buildSegmentedDraft(segments: SplitStrap, faceBuffer: Buffer): Promise<Buffer> {
    const preparedFace = await sharp(await removeWhiteBackground(faceBuffer))
        .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 0 })
        .png()
        .toBuffer();

    const faceMeta = await sharp(preparedFace).metadata();
    if (!faceMeta.width || !faceMeta.height) throw new Error('Face image has no readable dimensions');

    const layout = computeSegmentedLayout({ caseAspect: faceMeta.height / faceMeta.width });

    const [buckleLayer, tailLayer, caseLayer] = await Promise.all([
        fitSegment(segments.buckle, layout.segmentWidth, layout.buckleHeight, 'top'),
        fitSegment(segments.tail, layout.segmentWidth, layout.tailHeight, 'bottom'),
        sharp(preparedFace)
            .resize({ width: layout.caseWidth, height: layout.caseHeight, fit: 'fill' })
            .png()
            .toBuffer(),
    ]);

    return sharp({
        create: {
            width: DRAFT_CANVAS_WIDTH,
            height: DRAFT_CANVAS_HEIGHT,
            channels: 3,
            background: { r: 255, g: 255, b: 255 },
        },
    })
        .composite([
            { input: buckleLayer, left: layout.segmentLeft, top: layout.buckleTop },
            { input: tailLayer, left: layout.segmentLeft, top: layout.tailTop },
            // Case last so it sits over the leather at both lug ends.
            { input: caseLayer, left: layout.caseLeft, top: layout.caseTop },
        ])
        .png({ compressionLevel: 9 })
        .toBuffer();
}

// The one instruction the LoRA is trained on and served with. Training and inference MUST pass
// byte-identical text: a LoRA is keyed to its trigger phrase, and a mismatch silently produces
// base-model output with no error at all.
export const KONTEXT_PROMPT_INSTRUCTION = 'assemble into a finished wristwatch product photo';
