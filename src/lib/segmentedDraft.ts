import sharp from 'sharp';
import { DRAFT_CANVAS_WIDTH, DRAFT_CANVAS_HEIGHT, DRAFT_MARGIN_RATIO } from './draftComposite';
import { removeWhiteBackground } from './removeWhiteBackground';
import { trimSpringBarPins, measureSegment } from './segmentFit';
import type { SegmentMetrics } from './segmentFit';
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

// There is deliberately no target for how much of the strap the buckle side should take up.
//
// There used to be: 0.30, then 0.36 on review. Holding a fixed ratio meant forcing each segment
// into a slot of a size the product had no say in, and every way of doing that damages the strap —
// stretching deforms the buckle and desynchronises the grain between the two halves, cutting leaves
// a step in the tapered edge. The balance now comes from the two pieces themselves and the frame is
// solved around them, so the draft can only ever show the strap the supplier actually made.
//
// When a clean render normalises the two halves to the same length — measured across 74 renders the
// median buckle share is 49%, where a real strap is nearer 38% — that shows up as a watch with too
// long a buckle side. That is a fault in the render and belongs in the render review, not something
// the layout should paper over.

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

// Solves the frame around the strap rather than the strap into the frame.
//
// Both segment lengths arrive measured in strap widths, so once a strap width is chosen everything
// else follows from it. Picking that width to make the whole assembly fill the frame is what a
// photographer does when framing a shot: step back for a long strap, closer for a short one. The
// segments are then placed at exactly their own proportions and never resampled unevenly.
export function computeSegmentedLayout(input: {
    caseAspect: number; // height / width of the watch head
    buckleAspect: number; // length of the buckle segment in strap widths
    tailAspect: number;
}): SegmentedDraftLayout {
    const marginY = Math.round(DRAFT_CANVAS_HEIGHT * DRAFT_MARGIN_RATIO);
    const available = DRAFT_CANVAS_HEIGHT - marginY * 2;

    // Assembly height as a multiple of strap width. Leather hidden behind the case is not length
    // the viewer sees, hence the two overlaps coming back off the case.
    const caseWidthInStraps = 1 / SEGMENT_TO_CASE_WIDTH_RATIO;
    const caseHeightInStraps = caseWidthInStraps * input.caseAspect;
    const heightInStraps =
        input.buckleAspect + input.tailAspect + caseHeightInStraps * (1 - CASE_OVERLAP_RATIO * 2);

    // Never larger than the old fixed geometry: that case size was chosen against real assembled
    // renders, so it stays the ceiling and a long strap only ever zooms out from it.
    const widest = DRAFT_CANVAS_WIDTH * CASE_WIDTH_RATIO * SEGMENT_TO_CASE_WIDTH_RATIO;
    const segmentWidth = Math.max(1, Math.round(Math.min(widest, available / heightInStraps)));

    const caseWidth = Math.round(segmentWidth * caseWidthInStraps);
    const caseHeight = Math.round(caseWidth * input.caseAspect);
    const overlap = Math.round(caseHeight * CASE_OVERLAP_RATIO);
    const buckleHeight = Math.max(1, Math.round(segmentWidth * input.buckleAspect));
    const tailHeight = Math.max(1, Math.round(segmentWidth * input.tailAspect));

    // Centred, so a strap short enough to leave slack sits in the middle of the frame instead of
    // hanging off the top margin.
    const assembly = buckleHeight + tailHeight + caseHeight - overlap * 2;
    const buckleTop = Math.max(marginY, Math.round((DRAFT_CANVAS_HEIGHT - assembly) / 2));
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

export async function buildSegmentedDraft(segments: SplitStrap, faceBuffer: Buffer): Promise<Buffer> {
    const preparedFace = await sharp(await removeWhiteBackground(faceBuffer))
        .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 0 })
        .png()
        .toBuffer();

    const faceMeta = await sharp(preparedFace).metadata();
    if (!faceMeta.width || !faceMeta.height) throw new Error('Face image has no readable dimensions');

    // Pins first: they stick out past the leather, so measuring before removing them would read the
    // strap as wider than it is and shrink the whole assembly to compensate.
    const [buckle, tail] = await Promise.all([
        trimSpringBarPins(segments.buckle, 'bottom'),
        trimSpringBarPins(segments.tail, 'top'),
    ]);
    const [buckleMetrics, tailMetrics] = await Promise.all([
        measureSegment(buckle, 'bottom'),
        measureSegment(tail, 'top'),
    ]);

    const layout = computeSegmentedLayout({
        caseAspect: faceMeta.height / faceMeta.width,
        buckleAspect: buckleMetrics.aspect,
        tailAspect: tailMetrics.aspect,
    });

    // One scale per segment, taken from its lug width, so both halves meet the case at the same
    // strap width and the leather is scaled rather than squashed. A buckle wider than the strap
    // simply makes its layer wider than segmentWidth, which is what a buckle really does.
    const place = async (segment: Buffer, metrics: SegmentMetrics, top: number) => {
        const scale = layout.segmentWidth / metrics.lugWidth;
        return {
            input: await sharp(segment)
                .resize({
                    width: Math.max(1, Math.round(metrics.width * scale)),
                    height: Math.max(1, Math.round(metrics.height * scale)),
                    fit: 'fill',
                })
                .png()
                .toBuffer(),
            left: Math.round(DRAFT_CANVAS_WIDTH / 2 - metrics.lugCentre * scale),
            top,
        };
    };

    const [buckleLayer, tailLayer, caseLayer] = await Promise.all([
        place(buckle, buckleMetrics, layout.buckleTop),
        place(tail, tailMetrics, layout.tailTop),
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
            buckleLayer,
            tailLayer,
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
