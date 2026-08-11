import sharp from 'sharp';

// Catalog photography lays a strap out as two segments SIDE BY SIDE, and the clean studio renders
// inherit that layout no matter how firmly the prompt asks for end-to-end. Feeding that to the
// model taught it exactly the wrong thing: the pilot's first pairs came back as two parallel
// strips with a watch resting on top, or with the case missing entirely, because a side-by-side
// draft is a picture of a strap that is NOT threaded through a case.
//
// This re-lays the two segments the way a worn watch actually reads — buckle segment above, holes
// segment below, a gap between them for the case — so the draft already has the right geometry
// and the model only has to fill the gap.
//
// Pure pixel work: free, deterministic, no external service.

export type SplitStrap = { buckle: Buffer; tail: Buffer };

const WHITE_THRESHOLD = 238;
// A gutter must be this wide (as a fraction of image width) to count as the separation between
// two segments rather than a light patch inside one.
const MIN_GUTTER_RATIO = 0.02;

export async function columnInkDensity(image: Buffer): Promise<{ density: number[]; width: number; height: number }> {
    const { data, info } = await sharp(image).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const density: number[] = [];

    for (let x = 0; x < info.width; x++) {
        let dark = 0;
        for (let y = 0; y < info.height; y++) {
            const o = (y * info.width + x) * info.channels;
            if (data[o] < WHITE_THRESHOLD || data[o + 1] < WHITE_THRESHOLD || data[o + 2] < WHITE_THRESHOLD) {
                dark++;
            }
        }
        density.push(dark / info.height);
    }

    return { density, width: info.width, height: info.height };
}

// Splits at the emptiest column in the middle of the frame rather than demanding a band of pure
// white. Real renders put a soft shadow and a little antialiasing in the gap between segments, so
// an absolute-white test finds nothing; the minimum is always there and is always in the right
// place. Only the middle band is searched, so the wide white margins cannot win.
export function findGutter(density: number[], width: number): { start: number; end: number } | null {
    const searchFrom = Math.floor(width * 0.3);
    const searchTo = Math.ceil(width * 0.7);

    let minIndex = searchFrom;
    for (let x = searchFrom; x < searchTo; x++) {
        if (density[x] < density[minIndex]) minIndex = x;
    }

    // If the emptiest middle column still carries real content, this is one wide segment, not two.
    //
    // 0.25 was a guess and it was far too tight: renders where the two segments merely touch —
    // no white gutter, just a seam — measured 0.26 to 0.42 and were rejected outright, which sent
    // 42 of 96 straps down the fallback path and produced the flat pasted-on drafts. Measured
    // across all 96 real renders the middle minimum runs from 0.000 to 0.417 with a median of
    // 0.008, so every genuine two-segment render clears 0.45 while a truly solid strap would sit
    // far higher.
    if (density[minIndex] > 0.45) return null;

    // Widen outward while the columns stay comparably empty, so the split lands on the whole gap.
    const limit = Math.max(density[minIndex] * 2, 0.03);
    let start = minIndex;
    let end = minIndex + 1;
    while (start > searchFrom && density[start - 1] <= limit) start--;
    while (end < searchTo && density[end] <= limit) end++;

    if (end - start < Math.max(2, width * MIN_GUTTER_RATIO * 0.25)) return { start: minIndex, end: minIndex + 1 };
    return { start, end };
}

// The buckle is a large bright, near-colourless metal object. Whichever half carries more of that
// is the buckle segment. Exported so the render gate can spot a strap that came back with a buckle
// on BOTH halves — a real strap has exactly one.
export async function metalScore(image: Buffer): Promise<number> {
    const { data, info } = await sharp(image)
        .resize({ width: 120, height: 300, fit: 'inside' })
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });

    let metal = 0;
    let total = 0;
    for (let i = 0; i < info.width * info.height; i++) {
        const o = i * info.channels;
        const r = data[o];
        const g = data[o + 1];
        const b = data[o + 2];
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        if (max >= 245 && min >= 245) continue; // white background
        total++;
        const saturation = max === 0 ? 0 : (max - min) / max;
        if (saturation < 0.12 && max > 120) metal++;
    }
    return total === 0 ? 0 : metal / total;
}

// Which way up is a segment? Catalog photography lays both segments out in whatever direction the
// shot happened to want, and the earlier draft builder pasted them exactly as found. A reviewer
// working through 96 assembled drafts marked 45 of them upside down, and measuring the two piles
// showed why: every one of the 29 drafts they accepted has its buckle-half metal in the top fifth
// and its tail tapering downward, while the 45 rejects break one rule or the other.
//
// The physical rule behind the numbers: a strap segment is full width and squared off at its
// spring-bar end — the articulated end that pins into the case — and narrows at the far end, to a
// curved tip on the tail and to the buckle's thin frame on the short piece. The fat end always
// faces the case. That is measurable without knowing anything about the product.
export type SegmentStats = {
    topInk: number; // mean pixels of strap per row near the top edge
    bottomInk: number;
    metalFraction: number;
    metalCentroidY: number; // 0 = top edge, 1 = bottom edge
};

// Read from a fixed 100x400 stretch so the bands mean the same thing whatever the source
// resolution or aspect happens to be.
const PROBE_WIDTH = 100;
const PROBE_HEIGHT = 400;
// Sampled just inside each end: `trim` can leave a row or two of near-white behind, and the very
// last rows of a curved tip are a sliver that reads as noise.
const END_BAND = { from: 0.03, to: 0.13 } as const;
// Below this much metal, or with the metal sitting too near the middle to commit, the silhouette
// decides instead. A pale strap trips the metal test across its whole surface.
const MIN_METAL_FRACTION = 0.03;
const MIN_METAL_OFFSET = 0.08;

export async function segmentStats(image: Buffer): Promise<SegmentStats> {
    const { data, info } = await sharp(image)
        .resize({ width: PROBE_WIDTH, height: PROBE_HEIGHT, fit: 'fill' })
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });

    const ink: number[] = [];
    let metal = 0;
    let metalWeightedY = 0;
    let coloured = 0;

    for (let y = 0; y < info.height; y++) {
        let row = 0;
        for (let x = 0; x < info.width; x++) {
            const o = (y * info.width + x) * info.channels;
            const r = data[o];
            const g = data[o + 1];
            const b = data[o + 2];
            if (r < WHITE_THRESHOLD || g < WHITE_THRESHOLD || b < WHITE_THRESHOLD) row++;

            const max = Math.max(r, g, b);
            const min = Math.min(r, g, b);
            if (max >= 245 && min >= 245) continue; // white background
            coloured++;
            const saturation = max === 0 ? 0 : (max - min) / max;
            if (saturation < 0.12 && max > 120) {
                metal++;
                metalWeightedY += y / info.height;
            }
        }
        ink.push(row);
    }

    const band = (from: number, to: number) => {
        const rows = ink.slice(Math.round(info.height * from), Math.round(info.height * to));
        return rows.reduce((sum, v) => sum + v, 0) / rows.length;
    };

    return {
        topInk: band(END_BAND.from, END_BAND.to),
        bottomInk: band(1 - END_BAND.to, 1 - END_BAND.from),
        metalFraction: coloured === 0 ? 0 : metal / coloured,
        metalCentroidY: metal === 0 ? 0.5 : metalWeightedY / metal,
    };
}

// True when the segment is upside down for the slot it is about to fill: the buckle half sits
// above the case (buckle up, spring bar down), the tail half below it (spring bar up, tip down).
export function segmentNeedsFlip(stats: SegmentStats, role: 'buckle' | 'tail'): boolean {
    // A buckle is a large, unmistakable metal object at the far end of its segment — a far stronger
    // signal than the silhouette when there is enough of it to read.
    if (
        role === 'buckle' &&
        stats.metalFraction > MIN_METAL_FRACTION &&
        Math.abs(stats.metalCentroidY - 0.5) > MIN_METAL_OFFSET
    ) {
        return stats.metalCentroidY > 0.5;
    }

    const fatEndIsTop = stats.topInk > stats.bottomInk;
    return role === 'buckle' ? fatEndIsTop : !fatEndIsTop;
}

async function orientSegment(image: Buffer, role: 'buckle' | 'tail'): Promise<Buffer> {
    if (!segmentNeedsFlip(await segmentStats(image), role)) return image;
    // A half turn, not a mirror: turning a strap end-for-end is what a person does, and it keeps
    // the leather grain and stitching running the way they really do.
    return sharp(image).rotate(180).png().toBuffer();
}

// Splits a two-segment strap render into its buckle half and its holes/tail half, each turned the
// way up its slot in the assembled draft needs it.
// Returns null when the image does not look like two separated segments.
export async function splitStrapSegments(image: Buffer): Promise<SplitStrap | null> {
    const { density, width, height } = await columnInkDensity(image);
    const gutter = findGutter(density, width);
    if (!gutter) return null;

    const leftWidth = gutter.start;
    const rightWidth = width - gutter.end;
    if (leftWidth < width * 0.1 || rightWidth < width * 0.1) return null;

    // extract and trim are kept in separate sharp pipelines on purpose: chained together, sharp
    // resolves them in its own fixed order rather than the order written, which throws
    // "extract_area: bad extract area" on perfectly valid regions.
    const trim = { background: { r: 255, g: 255, b: 255 }, threshold: 12 } as const;
    const leftRaw = await sharp(image).extract({ left: 0, top: 0, width: leftWidth, height }).png().toBuffer();
    const rightRaw = await sharp(image).extract({ left: gutter.end, top: 0, width: rightWidth, height }).png().toBuffer();
    const left = await sharp(leftRaw).trim(trim).png().toBuffer();
    const right = await sharp(rightRaw).trim(trim).png().toBuffer();

    const [leftMetal, rightMetal] = await Promise.all([metalScore(left), metalScore(right)]);
    const halves = leftMetal >= rightMetal ? { buckle: left, tail: right } : { buckle: right, tail: left };

    const [buckle, tail] = await Promise.all([
        orientSegment(halves.buckle, 'buckle'),
        orientSegment(halves.tail, 'tail'),
    ]);
    return { buckle, tail };
}

// A strap has one buckle, but PRO sometimes re-renders one onto BOTH segments and the spare then
// dangles off the bottom of the assembled draft. This scores how lopsided the metal is between the
// halves: a clean render is lopsided (one buckle), a doubled one is even.
//
// RANKING SIGNAL ONLY — never an automatic reject. metalScore counts low-saturation bright pixels,
// which a pale grey or white strap trips across its whole surface: measured on 86 real renders,
// one scored 0.999 on both halves purely from its colour. The known doubled render scores 1.25 and
// a known-good one 2.87, but the p10 of all renders is 1.12, so a threshold that catches the real
// fault also condemns straps whose only crime is being pale. Use it to put the most suspicious
// renders first in the review queue and let a human decide.
export async function buckleAsymmetry(segments: SplitStrap): Promise<number> {
    const [buckleScore, tailScore] = await Promise.all([
        metalScore(segments.buckle),
        metalScore(segments.tail),
    ]);
    return tailScore > 0 ? buckleScore / tailScore : Infinity;
}
