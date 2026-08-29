import sharp from 'sharp';
import { splitStrapSegments } from './strapSegments';
import { computeSegmentedLayout } from './segmentedDraft';
import { trimSpringBarPins, measureSegment, measureFace, type FaceMetrics } from './segmentFit';
import { removeWhiteBackground } from './removeWhiteBackground';
import { assessDraft } from './draftStandard';
import type { ColourVerdict } from './strapColour';

// Judges a clean studio render the way the assembled draft will be judged, before anything is
// built from it.
//
// Four places had grown their own copy of this sequence — the review sheet, the pair generator,
// the serving engine, and the standard report — and they had already drifted: one of them assessed
// against a single face while the others used many, which is how "77 of 78 pairs pass" came to be
// reported for a set that passes 1488 of 8436. One definition, imported everywhere, is the point.
//
// The standard depends on the FACE as well as the strap: case proportions and the gap between the
// lugs both feed the layout. So a render is checked against a sample of faces and asked to hold up
// across most of them, rather than being declared good on the strength of one lucky pairing.

export type PreparedFace = { caseAspect: number; metrics: FaceMetrics };

export async function prepareFace(faceBuffer: Buffer): Promise<PreparedFace> {
    const prepared = await sharp(await removeWhiteBackground(faceBuffer))
        .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 0 })
        .png()
        .toBuffer();
    const meta = await sharp(prepared).metadata();
    return {
        caseAspect: (meta.height ?? 1) / (meta.width ?? 1),
        metrics: await measureFace(prepared),
    };
}

export type RenderVerdict = {
    ok: boolean;
    /** Faces this render produced an acceptable draft for, out of those it was checked against. */
    passes: number;
    checked: number;
    buckleShare: number | null;
    reasons: string[];
};

// A render has to work for most faces, not all. Three of the 114 faces in the library have a lug
// gap no measurement can read — a fact about those photographs that no amount of re-rendering the
// strap will change — so demanding a clean sweep would reject every render ever made.
export const MIN_FACE_PASS_RATIO = 0.6;

export async function checkCleanRender(
    render: Buffer,
    faces: PreparedFace[],
    colour?: ColourVerdict,
): Promise<RenderVerdict> {
    if (faces.length === 0) throw new Error('checkCleanRender needs at least one face to judge against');

    const segments = await splitStrapSegments(render);
    if (!segments) {
        return { ok: false, passes: 0, checked: faces.length, buckleShare: null, reasons: ['does not split into two segments'] };
    }

    const [buckle, tail] = await Promise.all([
        measureSegment(await trimSpringBarPins(segments.buckle, 'bottom'), 'bottom'),
        measureSegment(await trimSpringBarPins(segments.tail, 'top'), 'top'),
    ]);
    const buckleShare = buckle.aspect / (buckle.aspect + tail.aspect);

    let passes = 0;
    const reasons = new Set<string>();
    for (const face of faces) {
        const { caseScale } = computeSegmentedLayout({
            caseAspect: face.caseAspect,
            buckleAspect: buckle.aspect,
            tailAspect: tail.aspect,
            strapPerCase: face.metrics.lugGap === null ? undefined : face.metrics.lugGap / face.metrics.width,
        });
        const verdict = assessDraft({
            buckleShare,
            caseScale,
            lugGapRead: face.metrics.lugGap !== null,
            colour,
        });
        if (verdict.ok) passes++;
        else for (const r of verdict.reasons) reasons.add(r);
    }

    return {
        ok: passes / faces.length >= MIN_FACE_PASS_RATIO,
        passes,
        checked: faces.length,
        buckleShare,
        reasons: [...reasons],
    };
}
