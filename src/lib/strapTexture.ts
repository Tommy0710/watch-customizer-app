import sharp from 'sharp';

// The colour gate catches a navy strap rendered brown, but it is blind to grain: a green python
// strap re-rendered as green alligator passes it while looking nothing like the product.
//
// STATUS: diagnostic only — deliberately NOT wired into automatic rejection. Measured on real
// data, genuine renders spread from 0.10 to 0.45 while the one render that actually changed
// material scored 0.46, so any threshold that catches the failure also catches a third of the
// good pairs. Run it to investigate a suspicious strap; do not let it drop pairs on its own.
// Human review currently separates these far better.
//
// Grain is a high-frequency property, so this measures the distribution of local gradient
// magnitudes across the leather and compares the two distributions. Smooth vachetta produces
// mostly small gradients; python and alligator scales produce a heavy tail of large ones. Average
// brightness or colour cannot separate those — the shape of the distribution can.

export type TextureSignature = { histogram: number[]; sampled: number };

const BINS = 16;
const MAX_GRADIENT = 160; // gradients above this are clipped into the top bin
const ANALYSIS_WIDTH = 260;

// Ignore near-white pixels: they are studio background, not leather.
const BACKGROUND_THRESHOLD = 238;

export async function measureStrapTexture(image: Buffer): Promise<TextureSignature> {
    const { data, info } = await sharp(image)
        .resize({ width: ANALYSIS_WIDTH, height: ANALYSIS_WIDTH, fit: 'inside' })
        .removeAlpha()
        .greyscale()
        .raw()
        .toBuffer({ resolveWithObject: true });

    const { width, height } = info;
    const at = (x: number, y: number) => data[y * width + x];

    const histogram = new Array<number>(BINS).fill(0);
    let sampled = 0;

    // Skip the border so the 3x3 neighbourhood is always in range.
    for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
            if (at(x, y) >= BACKGROUND_THRESHOLD) continue;

            // Sobel magnitude — cheap, rotation-tolerant enough for a texture comparison.
            const gx =
                -at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1) +
                at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1);
            const gy =
                -at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1) +
                at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1);

            const magnitude = Math.min(Math.hypot(gx, gy) / 4, MAX_GRADIENT);
            histogram[Math.min(BINS - 1, Math.floor((magnitude / MAX_GRADIENT) * BINS))]++;
            sampled++;
        }
    }

    if (sampled === 0) return { histogram: histogram.map(() => 0), sampled: 0 };
    return { histogram: histogram.map((count) => count / sampled), sampled };
}

// Total variation distance between the two normalised histograms: 0 identical, 1 disjoint.
export function textureDistance(a: TextureSignature, b: TextureSignature): number {
    let sum = 0;
    for (let i = 0; i < BINS; i++) sum += Math.abs(a.histogram[i] - b.histogram[i]);
    return sum / 2;
}

export type TextureVerdict = { ok: boolean; distance: number; reason?: string };

// Calibrated on 23 real strap/render pairs whose source was a tight crop: median 0.18, p90 0.45,
// and the green python strap that came back as alligator scoring worst at 0.46. 0.42 sits above
// the bulk and below that known failure.
//
// IMPORTANT: only meaningful when the source is cropped tight to the strap. Comparing against a
// full staged catalog photo measures pixel scale rather than grain — those same 96 renders scored
// a median of 0.38 that way, which would reject over half the dataset. Scale-match first.
const MAX_TEXTURE_DISTANCE = 0.42;
const MIN_SAMPLED = 2000;

export function compareStrapTexture(source: TextureSignature, render: TextureSignature): TextureVerdict {
    if (source.sampled < MIN_SAMPLED || render.sampled < MIN_SAMPLED) {
        return { ok: true, distance: 0, reason: 'too little leather visible to compare' };
    }

    const distance = textureDistance(source, render);
    return distance <= MAX_TEXTURE_DISTANCE
        ? { ok: true, distance }
        : { ok: false, distance, reason: `grain differs (distance ${distance.toFixed(2)})` };
}
