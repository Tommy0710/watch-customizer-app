import sharp from 'sharp';
import { DRAFT_CANVAS_WIDTH, DRAFT_CANVAS_HEIGHT, DRAFT_MARGIN_RATIO } from './draftComposite';
import { removeWhiteBackground } from './removeWhiteBackground';
import { trimSpringBarPins, measureSegment, measureFace } from './segmentFit';
import type { SegmentMetrics } from './segmentFit';
import type { SplitStrap } from './strapSegments';

// Lays a strap out the way a finished watch actually reads: buckle segment above, case in the
// middle, holes segment below. The earlier draft pasted the head onto a side-by-side pair of
// segments — a picture of a strap NOT threaded through a case — and the model copied that
// faithfully, returning two parallel strips with a watch resting on them, or no watch at all.
//
// With this layout the draft is already almost the answer, so the edit left to learn is small:
// join the ends to the lugs and make it photoreal.

// A watch case is about twice the width of the strap it takes: 40mm case to 20mm lugs, 38 to 20,
// 42 to 22. This was 1/1.6, eyeballed off assembled renders, which drew the strap a quarter too
// wide — and since a segment's length is a fixed multiple of its width, too wide also meant too
// long, which is what forced the frame to zoom out and shrink the watch.
//
// At the real ratio the arithmetic closes: a correctly proportioned strap needs 1290px of the
// 1296px this 9:16 frame has, with the case at full size. That is not a coincidence to be tuned —
// it is what a real watch photographed in a 9:16 frame measures. A strap that does not fit is a
// strap the render got wrong.
export const CASE_WIDTH_RATIO = 0.30;
export const SEGMENT_TO_CASE_WIDTH_RATIO = 1 / 2;

// The watch is drawn at full size unless the strap genuinely cannot be made to fit, and never
// below this, because past it the draft stops looking like a watch and the render should be redone
// instead. computeSegmentedLayout reports what it had to use.
const MIN_CASE_SCALE = 0.85;

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
    caseScale: number; // 1 when the watch is drawn full size; below 1 the render's strap is too long
};

// Draws the watch at a fixed size and places each segment at exactly its own proportions. Nothing
// is cut and nothing is squashed, so the only thing that varies between drafts is how long the
// supplier's strap actually is.
//
// A strap too long to fit is a render fault, not a framing problem, so the only concession is a
// small last-resort shrink — reported through caseScale, so review can see it and send the render
// back rather than quietly accepting a shrunken watch.
export function computeSegmentedLayout(input: {
    caseAspect: number; // height / width of the watch head
    buckleAspect: number; // length of the buckle segment in strap widths
    tailAspect: number;
    // Strap width as a fraction of head width, when the head's lug gap could be read. Clamped,
    // because a misread gap would resize the whole assembly rather than fail visibly.
    strapPerCase?: number;
}): SegmentedDraftLayout {
    const strapsPerCase = Math.min(0.62, Math.max(0.35, input.strapPerCase ?? SEGMENT_TO_CASE_WIDTH_RATIO));
    const marginY = Math.round(DRAFT_CANVAS_HEIGHT * DRAFT_MARGIN_RATIO);

    // Assembly height as a multiple of case width. Leather hidden behind the case is not length the
    // viewer sees, hence the two overlaps coming back off it.
    const heightInCases =
        (input.buckleAspect + input.tailAspect) * strapsPerCase +
        input.caseAspect * (1 - CASE_OVERLAP_RATIO * 2);

    const fullCaseWidth = DRAFT_CANVAS_WIDTH * CASE_WIDTH_RATIO;
    const needed = fullCaseWidth * heightInCases;
    // Eat into the margin before shrinking anything: a slightly tight crop is a smaller lie than a
    // watch drawn to the wrong size.
    //
    // Scaling to fill the tight box was wrong in the other direction too — it drew the watch up to
    // 10% OVER full size for straps that merely needed some of the margin, so head size varied by a
    // quarter across the set. It is one fixed size now, and only ever shrinks, as a rescue.
    const tight = DRAFT_CANVAS_HEIGHT - marginY / 2;
    const caseScale = needed <= tight ? 1 : Math.max(MIN_CASE_SCALE, tight / needed);

    const caseWidth = Math.round(fullCaseWidth * caseScale);
    const segmentWidth = Math.max(1, Math.round(caseWidth * strapsPerCase));
    const caseHeight = Math.round(caseWidth * input.caseAspect);
    const overlap = Math.round(caseHeight * CASE_OVERLAP_RATIO);
    const buckleHeight = Math.max(1, Math.round(segmentWidth * input.buckleAspect));
    const tailHeight = Math.max(1, Math.round(segmentWidth * input.tailAspect));

    // Centred, so the watch sits in the middle of the frame whatever length of strap it carries.
    const assembly = buckleHeight + tailHeight + caseHeight - overlap * 2;
    const buckleTop = Math.round((DRAFT_CANVAS_HEIGHT - assembly) / 2);
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
        caseScale,
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

    const face = await measureFace(preparedFace);
    const layout = computeSegmentedLayout({
        caseAspect: faceMeta.height / faceMeta.width,
        buckleAspect: buckleMetrics.aspect,
        tailAspect: tailMetrics.aspect,
        strapPerCase: face.lugGap === null ? undefined : face.lugGap / face.width,
    });

    // The head is placed so its LUG AXIS lands on the middle of the frame, and the strap follows the
    // same axis. Centring bounding boxes instead put every crowned watch's strap off to one side.
    const caseScaleX = layout.caseWidth / face.width;
    const strapAxis = DRAFT_CANVAS_WIDTH / 2;
    const caseLeft = Math.round(strapAxis - face.lugCentre * caseScaleX);

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
            left: Math.round(strapAxis - metrics.lugCentre * scale),
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
            { input: caseLayer, left: caseLeft, top: layout.caseTop },
        ])
        .png({ compressionLevel: 9 })
        .toBuffer();
}

// The one instruction the LoRA is trained on and served with. Training and inference MUST pass
// byte-identical text: a LoRA is keyed to its trigger phrase, and a mismatch silently produces
// base-model output with no error at all.
export const KONTEXT_PROMPT_INSTRUCTION = 'assemble into a finished wristwatch product photo';
