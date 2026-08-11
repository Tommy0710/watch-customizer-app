import sharp from 'sharp';

// Getting a strap segment into its slot in the assembled draft without lying about the leather.
//
// The first version simply stretched each half to fill its slot. Measured across 74 clean renders
// that meant squashing the buckle half by 1.9x to 2.2x and the tail by only 1.2x to 1.3x, which
// does two visible kinds of damage: it flattens the buckle into a wide slab, and — worse for a
// model being trained to reproduce leather exactly — it leaves the grain running at two different
// scales on the two sides of the same watch.
//
// The squash exists because the renders come back with both halves at near-equal length (median
// buckle share 49%) while a real strap's buckle side is around 38%. So the length genuinely has to
// go somewhere. It comes out of a band of plain leather instead of out of the whole segment: the
// buckle, the keepers, the holes and the tip keep their true proportions, the grain keeps one
// consistent scale, and the cut is placed where the pattern lines up across it.

const WHITE = 255;
const INK_THRESHOLD = 238;

// Hardware and shaping scale with how wide the strap is, not with how long the photographed piece
// happens to be — a 20 mm strap has a 20 mm-ish buckle whatever length it was cut to. Expressed in
// strap widths so they survive any resolution.
// buckle + keepers on the short piece; tip AND the run of holes on the long one. The holes are
// part of the product — the first cut landed across them and left a 7-hole strap showing 3 — and
// on a real strap they reach back about three strap widths from the tip.
const FAR_ZONE_WIDTHS = { buckle: 1.6, tail: 3.0 } as const;
const SPRING_ZONE_WIDTHS = 0.45; // the articulated end that pins into the case

// How far in from the end the spring bar can protrude, as a fraction of segment length.
const PIN_ZONE_RATIO = 0.12;
// The strap is very slightly wider at the lug end than a little way in, so the reference width
// needs headroom before anything outside it is treated as protruding hardware.
const PIN_TOLERANCE = 0.015;

// How much the excision may differ from the exact amount needed, so it can land where the pattern
// repeats. Whatever is left over is taken out by a final resize, so this caps that distortion.
const SEAM_SEARCH_SLACK = 24;
const SEAM_MATCH_ROWS = 6;

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
// They are painted out rather than cropped off, because they protrude across the strap, not along
// it: clipping sideways costs no length at all, whereas trimming the end would take the leather
// that has to reach the case with it.
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

// Rows that a cut must not touch: the far end carries the buckle and keepers or the curved tip, and
// the near end is the spring-bar joint. Everything between them is plain strap.
export function plainBand(
    height: number,
    width: number,
    role: 'buckle' | 'tail',
): { from: number; to: number } {
    const far = Math.round(width * FAR_ZONE_WIDTHS[role]);
    const spring = Math.round(width * SPRING_ZONE_WIDTHS);
    // The buckle half is laid out buckle-up, so its far end is at the top; the tail hangs the other
    // way and meets the case with its spring bar.
    return role === 'buckle'
        ? { from: far, to: height - spring }
        : { from: spring, to: height - far };
}

// Picks where to cut, and exactly how much, so the leather above the cut continues into the leather
// below it. Searching the length as well as the position is what lets the cut land on a whole
// number of pattern repeats — croc scales and stingray pearls would otherwise be sliced mid-row.
export function findSeamCut(
    img: RawImage,
    band: { from: number; to: number },
    wanted: number,
): { start: number; length: number } | null {
    const bandLength = band.to - band.from;
    const slack = Math.min(SEAM_SEARCH_SLACK, Math.floor(bandLength * 0.1));
    const minLength = Math.max(1, wanted - slack);
    const maxLength = Math.min(bandLength - SEAM_MATCH_ROWS, wanted + slack);
    if (maxLength < minLength) return null;

    const rowDistance = (a: number, b: number): number => {
        let sum = 0;
        for (let k = 0; k < SEAM_MATCH_ROWS; k++) {
            for (let x = 0; x < img.width; x++) {
                const oa = ((a - k) * img.width + x) * img.channels;
                const ob = ((b - k) * img.width + x) * img.channels;
                for (let c = 0; c < img.channels; c++) sum += Math.abs(img.data[oa + c] - img.data[ob + c]);
            }
        }
        return sum;
    };

    let best: { start: number; length: number; score: number } | null = null;
    for (let length = minLength; length <= maxLength; length++) {
        for (let start = band.from + SEAM_MATCH_ROWS; start + length <= band.to; start += 2) {
            const score = rowDistance(start, start + length);
            if (!best || score < best.score) best = { start, length, score };
        }
    }
    return best ? { start: best.start, length: best.length } : null;
}

// Scales a segment to the slot width without distorting it, then takes the surplus length out of
// one band of plain leather. Falls back to the old stretch only when there is not enough plain
// leather to cut from, which would mean the segment is nearly all hardware.
export async function fitSegmentToSlot(
    segment: Buffer,
    width: number,
    height: number,
    role: 'buckle' | 'tail',
): Promise<Buffer> {
    const stretch = (image: Buffer) => sharp(image).resize({ width, height, fit: 'fill' }).png().toBuffer();

    // Width only: sharp keeps the aspect ratio, so the grain scale is set by the strap's real width
    // and comes out identical on both halves.
    const scaled = await sharp(segment).resize({ width }).png().toBuffer();
    const { height: naturalHeight } = await sharp(scaled).metadata();
    if (!naturalHeight) throw new Error('Segment has no readable height');

    const surplus = naturalHeight - height;
    if (surplus <= 2) return stretch(scaled); // already at length, or short — a small stretch is harmless

    const img = await toRaw(scaled);
    const band = plainBand(naturalHeight, width, role);
    if (band.to - band.from < surplus + SEAM_MATCH_ROWS * 2) return stretch(scaled);

    const cut = findSeamCut(img, band, surplus);
    if (!cut) return stretch(scaled);

    const [above, below] = await Promise.all([
        sharp(scaled).extract({ left: 0, top: 0, width, height: cut.start }).png().toBuffer(),
        sharp(scaled)
            .extract({ left: 0, top: cut.start + cut.length, width, height: naturalHeight - cut.start - cut.length })
            .png()
            .toBuffer(),
    ]);

    const joined = await sharp({
        create: { width, height: naturalHeight - cut.length, channels: 3, background: { r: WHITE, g: WHITE, b: WHITE } },
    })
        .composite([
            { input: above, left: 0, top: 0 },
            { input: below, left: 0, top: cut.start },
        ])
        .png()
        .toBuffer();

    // The cut length was allowed to drift so it could land on the pattern; that few-pixel remainder
    // comes out here, well under the distortion the old whole-segment stretch caused.
    return stretch(joined);
}
