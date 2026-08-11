import sharp from 'sharp';

// Preparing a strap segment for the assembled draft, without touching the leather.
//
// Two earlier attempts both damaged it. Stretching each half to fill a fixed slot squashed the
// buckle half 1.9x-2.2x and the tail only 1.2x-1.3x, flattening the buckle and leaving the grain
// running at two different scales on one watch. Cutting the surplus length out of a band of plain
// leather instead broke the silhouette: a strap tapers along its whole length, so removing any
// length at all leaves a step in the edge where the two pieces meet. Measured across 74 renders the
// longest genuinely parallel-sided run is about 10% of a segment, against the 54% the buckle half
// would need to lose — there is nowhere to cut.
//
// So nothing is cut and nothing is deformed. The segments keep their real proportions and the
// layout is solved around them instead (see computeSegmentedLayout). The only thing removed here is
// hardware that a finished watch genuinely hides.

const WHITE = 255;
const INK_THRESHOLD = 238;

// How far in from the end the spring bar can protrude, as a fraction of segment length.
const PIN_ZONE_RATIO = 0.12;
// The strap is very slightly wider at the lug end than a little way in, so the reference width
// needs headroom before anything outside it is treated as protruding hardware.
const PIN_TOLERANCE = 0.015;

type RawImage = { data: Buffer; width: number; height: number; channels: number };

async function toRaw(image: Buffer): Promise<RawImage> {
    const { data, info } = await sharp(image).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    return { data, width: info.width, height: info.height, channels: info.channels };
}

function rowEdges(img: RawImage, y: number): { left: number; right: number } | null {
    let left = -1;
    let right = -1;
    for (let x = 0; x < img.width; x++) {
        const o = (y * img.width + x) * img.channels;
        if (img.data[o] < INK_THRESHOLD || img.data[o + 1] < INK_THRESHOLD || img.data[o + 2] < INK_THRESHOLD) {
            if (left < 0) left = x;
            right = x;
        }
    }
    return left < 0 ? null : { left, right };
}

// Quick-release spring bars stick out sideways past the leather. That is right for a photograph of
// a loose strap and wrong for a watch, where the bar sits inside the lugs and cannot be seen — a
// reviewer called them out as "kim thò ra ngoài" on every draft.
//
// They are painted out across the strap rather than cropped off its end, because that is the
// direction they protrude: clipping sideways costs no length at all, whereas trimming the end would
// take the leather that has to reach the case with it.
export async function trimSpringBarPins(segment: Buffer, springEnd: 'top' | 'bottom'): Promise<Buffer> {
    const img = await toRaw(segment);
    const zoneRows = Math.max(1, Math.round(img.height * PIN_ZONE_RATIO));
    const referenceY = springEnd === 'top'
        ? Math.min(img.height - 1, zoneRows)
        : Math.max(0, img.height - 1 - zoneRows);

    const reference = rowEdges(img, referenceY);
    if (!reference) return segment;

    const slack = Math.round(img.width * PIN_TOLERANCE) + 2;
    const keepLeft = Math.max(0, reference.left - slack);
    const keepRight = Math.min(img.width - 1, reference.right + slack);

    const out = Buffer.from(img.data);
    const from = springEnd === 'top' ? 0 : img.height - zoneRows;
    const to = springEnd === 'top' ? zoneRows : img.height;
    for (let y = from; y < to; y++) {
        for (let x = 0; x < img.width; x++) {
            if (x >= keepLeft && x <= keepRight) continue;
            const o = (y * img.width + x) * img.channels;
            for (let c = 0; c < img.channels; c++) out[o + c] = WHITE;
        }
    }

    return sharp(out, { raw: { width: img.width, height: img.height, channels: img.channels as 3 | 4 } })
        .trim({ background: { r: WHITE, g: WHITE, b: WHITE }, threshold: 12 })
        .png()
        .toBuffer();
}

export type SegmentMetrics = {
    width: number; // of the whole image, buckle overhang included
    height: number;
    lugWidth: number; // of the leather where it meets the case
    lugCentre: number; // x of that leather's midline, within the image
    aspect: number; // length in lug widths — scale-free, so two photographs of one strap agree
};

// Measured at the lug end rather than off the bounding box, because a buckle is wider than the
// strap it is fitted to. Sizing both halves by their bounding boxes made the buckle half's leather
// come out about 15% narrower than the tail's, so the strap visibly stepped in at the case.
export async function measureSegment(segment: Buffer, springEnd: 'top' | 'bottom'): Promise<SegmentMetrics> {
    const img = await toRaw(segment);
    const inset = Math.max(1, Math.round(img.height * PIN_ZONE_RATIO));
    const referenceY = springEnd === 'top'
        ? Math.min(img.height - 1, inset)
        : Math.max(0, img.height - 1 - inset);

    const edges = rowEdges(img, referenceY) ?? { left: 0, right: img.width - 1 };
    const lugWidth = Math.max(1, edges.right - edges.left + 1);

    return {
        width: img.width,
        height: img.height,
        lugWidth,
        lugCentre: (edges.left + edges.right) / 2,
        aspect: img.height / lugWidth,
    };
}
