import sharp from 'sharp';

// Some strap product photos show ONE continuous strap with a natural gap in the middle
// (the assumption the rest of /api/generate's composite pipeline is built on). A newer batch
// of catalog photos instead shows TWO separate strap pieces laid diagonally side by side,
// often touching or slightly overlapping where they cross — that assumption breaks for those,
// and the watch face ends up pasted onto one half instead of centered in a gap. This module
// detects which layout a strap photo is and, for the two-piece case, straightens and re-stacks
// the pieces into a single synthetic strap image so the rest of the pipeline (unchanged) can
// treat it exactly like a normal one-piece photo.

const ANALYSIS_WIDTH = 200;
const ALPHA_THRESHOLD = 32;
const MIN_COMPONENT_AREA_FRACTION = 0.02;
const BBOX_MARGIN_FRACTION = 0.03;
const GAP_TO_WIDTH_RATIO = 0.6; // rough placeholder gap between the two re-stacked pieces; tuned by eye during real testing
const MAX_FOREGROUND_AREA_FRACTION = 0.6; // if remove-bg marks more of the frame than this as foreground, it likely failed to segment a low-contrast photo (e.g. a dark strap on a dark backdrop) — bail out rather than process a bad mask
const MAX_EROSION_ITERATIONS = 30;

type ComponentStats = {
    area: number;
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
    angleRad: number; // orientation of the component's major axis, from image moments
};

function labelConnectedComponents(binary: Uint8Array, width: number, height: number): number[][] {
    const visited = new Uint8Array(width * height);
    const components: number[][] = [];
    const stack: number[] = [];

    for (let start = 0; start < width * height; start++) {
        if (binary[start] === 0 || visited[start]) continue;

        const points: number[] = [];
        stack.length = 0;
        stack.push(start);
        visited[start] = 1;

        while (stack.length > 0) {
            const idx = stack.pop()!;
            points.push(idx);
            const x = idx % width;
            const y = (idx / width) | 0;

            const neighbors = [
                x > 0 ? idx - 1 : -1,
                x < width - 1 ? idx + 1 : -1,
                y > 0 ? idx - width : -1,
                y < height - 1 ? idx + width : -1,
            ];
            for (const n of neighbors) {
                if (n >= 0 && !visited[n] && binary[n]) {
                    visited[n] = 1;
                    stack.push(n);
                }
            }
        }

        components.push(points);
    }

    return components;
}

// Standard morphological erosion with a plus-shaped structuring element: a foreground pixel
// survives only if it and all 4 direct neighbors are also foreground. Thin bridges between two
// touching blobs are only a few pixels wide, so they disappear well before either blob's bulk does.
function erodeOnce(binary: Uint8Array, width: number, height: number): Uint8Array {
    const out = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const idx = y * width + x;
            if (!binary[idx]) continue;
            const okLeft = x > 0 && binary[idx - 1];
            const okRight = x < width - 1 && binary[idx + 1];
            const okUp = y > 0 && binary[idx - width];
            const okDown = y < height - 1 && binary[idx + width];
            out[idx] = okLeft && okRight && okUp && okDown ? 1 : 0;
        }
    }
    return out;
}

// Erodes the mask repeatedly until it breaks into (at least) 2 significant pieces — this is
// how we tell "one strap touching another" apart from "one continuous strap": a touching bridge
// is much thinner than either piece's bulk, so it erodes away first. Returns null if the mask
// never splits (genuinely one piece) or erodes away entirely first.
function erodeUntilSplit(
    binary: Uint8Array,
    width: number,
    height: number,
    minArea: number,
): number[][] | null {
    let current = binary;
    for (let iter = 0; iter < MAX_EROSION_ITERATIONS; iter++) {
        current = erodeOnce(current, width, height);
        const remaining = current.reduce((a, b) => a + b, 0);
        if (remaining === 0) return null;

        const components = labelConnectedComponents(current, width, height).filter((c) => c.length >= minArea);
        if (components.length >= 2) return components;
    }
    return null;
}

// Multi-source BFS: grows the eroded seed regions back out through the ORIGINAL (pre-erosion)
// foreground mask, so every original pixel ends up assigned to whichever seed it's closest to
// by shape (a simplified marker-based watershed) rather than by straight-line distance.
function assignByNearestSeed(
    originalBinary: Uint8Array,
    width: number,
    height: number,
    seeds: number[][],
): number[][] {
    const label = new Int32Array(width * height).fill(-1);
    const queue: number[] = [];
    let head = 0;

    seeds.forEach((seedPoints, seedIndex) => {
        for (const idx of seedPoints) {
            if (label[idx] === -1) {
                label[idx] = seedIndex;
                queue.push(idx);
            }
        }
    });

    while (head < queue.length) {
        const idx = queue[head++];
        const x = idx % width;
        const y = (idx / width) | 0;
        const neighbors = [
            x > 0 ? idx - 1 : -1,
            x < width - 1 ? idx + 1 : -1,
            y > 0 ? idx - width : -1,
            y < height - 1 ? idx + width : -1,
        ];
        for (const n of neighbors) {
            if (n >= 0 && originalBinary[n] && label[n] === -1) {
                label[n] = label[idx];
                queue.push(n);
            }
        }
    }

    const regions: number[][] = seeds.map(() => []);
    for (let idx = 0; idx < width * height; idx++) {
        if (label[idx] >= 0) regions[label[idx]].push(idx);
    }
    return regions;
}

function computeStats(points: number[], width: number): ComponentStats {
    let sumX = 0, sumY = 0;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;

    for (const idx of points) {
        const x = idx % width;
        const y = (idx / width) | 0;
        sumX += x; sumY += y;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
    }

    const area = points.length;
    const cx = sumX / area;
    const cy = sumY / area;

    let mu20 = 0, mu02 = 0, mu11 = 0;
    for (const idx of points) {
        const x = idx % width;
        const y = (idx / width) | 0;
        const dx = x - cx;
        const dy = y - cy;
        mu20 += dx * dx;
        mu02 += dy * dy;
        mu11 += dx * dy;
    }

    const angleRad = 0.5 * Math.atan2(2 * mu11, mu20 - mu02);
    return { area, minX, maxX, minY, maxY, angleRad };
}

type Rect = { left: number; top: number; width: number; height: number };

// Maps a component's bounding box (in downsampled grid coordinates) to a crop rect in the
// ORIGINAL full-resolution strap image, using fractional coordinates so it's robust to the
// bg-removal model returning different absolute pixel dimensions than the original photo.
function gridBoxToFullRect(
    stats: ComponentStats,
    gridWidth: number,
    gridHeight: number,
    origWidth: number,
    origHeight: number,
): Rect {
    const wFrac = (stats.maxX - stats.minX + 1) / gridWidth;
    const hFrac = (stats.maxY - stats.minY + 1) / gridHeight;
    const marginXFrac = wFrac * BBOX_MARGIN_FRACTION;
    const marginYFrac = hFrac * BBOX_MARGIN_FRACTION;

    const leftFrac = Math.max(0, stats.minX / gridWidth - marginXFrac);
    const topFrac = Math.max(0, stats.minY / gridHeight - marginYFrac);
    const rightFrac = Math.min(1, (stats.maxX + 1) / gridWidth + marginXFrac);
    const bottomFrac = Math.min(1, (stats.maxY + 1) / gridHeight + marginYFrac);

    const left = Math.round(leftFrac * origWidth);
    const top = Math.round(topFrac * origHeight);
    const width = Math.max(1, Math.min(origWidth - left, Math.round((rightFrac - leftFrac) * origWidth)));
    const height = Math.max(1, Math.min(origHeight - top, Math.round((bottomFrac - topFrac) * origHeight)));

    return { left, top, width, height };
}

// Crops one strap piece out of the original photo, rotates it upright based on its
// moment-derived orientation angle, and trims the white padding the rotation introduces.
//
// A diagonal strap piece's axis-aligned bounding box necessarily also contains a triangle of
// whatever backdrop surrounds it — cropping+rotating the color photo alone would just carry
// that backdrop along for the ride and it would end up as visible wedges around the piece. So
// every pixel outside the cutout's alpha silhouette is painted white directly (plain raw-pixel
// masking — sharp's composite/joinChannel routes were tried first but silently produced an
// opaque black background instead of the expected transparency) before rotating, so trim() has
// a clean uniform border to cut away afterwards.
async function straightenPiece(strapBuffer: Buffer, cutoutBuffer: Buffer, rect: Rect, angleRad: number): Promise<{ buffer: Buffer; width: number; height: number }> {
    const { data: colorData, info: colorInfo } = await sharp(strapBuffer).extract(rect).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const { data: alphaData } = await sharp(cutoutBuffer).extract(rect).ensureAlpha().raw().toBuffer({ resolveWithObject: true });

    const pixelCount = colorInfo.width * colorInfo.height;
    const masked = Buffer.alloc(pixelCount * 4);
    for (let i = 0; i < pixelCount; i++) {
        const alpha = alphaData[i * 4 + 3];
        if (alpha > ALPHA_THRESHOLD) {
            masked[i * 4] = colorData[i * 4];
            masked[i * 4 + 1] = colorData[i * 4 + 1];
            masked[i * 4 + 2] = colorData[i * 4 + 2];
        } else {
            masked[i * 4] = 255;
            masked[i * 4 + 1] = 255;
            masked[i * 4 + 2] = 255;
        }
        masked[i * 4 + 3] = 255;
    }
    const maskedBuffer = await sharp(masked, { raw: { width: colorInfo.width, height: colorInfo.height, channels: 4 } }).png().toBuffer();

    // angleRad is the major axis's angle from the x-axis (from image moments); rotating by
    // (90° - that angle) aligns the major axis with the vertical. Verified empirically against
    // real strap photos (see plan notes) rather than assumed from theory alone.
    const angleDeg = (angleRad * 180) / Math.PI;
    const rotationDeg = 90 - angleDeg;

    const rotated = await sharp(maskedBuffer)
        .rotate(rotationDeg, { background: '#ffffff' })
        .flatten({ background: '#ffffff' })
        .toBuffer();

    const trimmed = await sharp(rotated)
        .trim({ background: '#ffffff', threshold: 15 })
        .toBuffer();

    const meta = await sharp(trimmed).metadata();
    return { buffer: trimmed, width: meta.width ?? 1, height: meta.height ?? 1 };
}

async function stackPiecesVertically(
    pieces: { buffer: Buffer; width: number; height: number }[],
): Promise<Buffer> {
    const [first, second] = pieces;
    const topPiece = first.height <= second.height ? first : second;
    const bottomPiece = first.height <= second.height ? second : first;

    const commonWidth = Math.max(topPiece.width, bottomPiece.width);
    const resizedTop = await sharp(topPiece.buffer).resize({ width: commonWidth }).toBuffer();
    const resizedBottom = await sharp(bottomPiece.buffer).resize({ width: commonWidth }).toBuffer();
    const resizedTopMeta = await sharp(resizedTop).metadata();
    const resizedBottomMeta = await sharp(resizedBottom).metadata();
    const topHeight = resizedTopMeta.height ?? topPiece.height;
    const bottomHeight = resizedBottomMeta.height ?? bottomPiece.height;

    const gap = Math.round(commonWidth * GAP_TO_WIDTH_RATIO);
    const canvasHeight = topHeight + gap + bottomHeight;

    return sharp({
        create: {
            width: commonWidth,
            height: canvasHeight,
            channels: 3,
            background: { r: 255, g: 255, b: 255 },
        },
    })
        .composite([
            { input: resizedTop, left: 0, top: 0 },
            { input: resizedBottom, left: 0, top: topHeight + gap },
        ])
        .png()
        .toBuffer();
}

async function straightenAndStack(
    strapBuffer: Buffer,
    cutoutBuffer: Buffer,
    componentsPointSets: number[][],
    gridWidth: number,
    gridHeight: number,
    origWidth: number,
    origHeight: number,
): Promise<Buffer> {
    const pieces = await Promise.all(
        componentsPointSets.map(async (points) => {
            const stats = computeStats(points, gridWidth);
            const rect = gridBoxToFullRect(stats, gridWidth, gridHeight, origWidth, origHeight);
            return straightenPiece(strapBuffer, cutoutBuffer, rect, stats.angleRad);
        }),
    );
    return stackPiecesVertically(pieces);
}

// Always returns a strap image buffer: either `strapBuffer` unchanged (single continuous
// strap, or a layout we're not confident classifying), or a new synthetic image with two
// detected strap pieces straightened and re-stacked vertically with a gap between them.
export async function normalizeStrapLayout(strapBuffer: Buffer, cutoutBuffer: Buffer): Promise<Buffer> {
    const origMeta = await sharp(strapBuffer).metadata();
    const origWidth = origMeta.width;
    const origHeight = origMeta.height;
    if (!origWidth || !origHeight) return strapBuffer;

    // remove-bg may return the cutout at different absolute pixel dimensions than the original
    // photo — resize it to match exactly so every rect computed below (grid or full-res) is in
    // the same coordinate space for both `strapBuffer` and this cutout.
    const alignedCutout = await sharp(cutoutBuffer).resize(origWidth, origHeight).toBuffer();

    const { data, info } = await sharp(alignedCutout)
        .resize({ width: ANALYSIS_WIDTH })
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });

    const gridWidth = info.width;
    const gridHeight = info.height;
    const channels = info.channels;
    const totalPixels = gridWidth * gridHeight;

    const binary = new Uint8Array(totalPixels);
    let foregroundCount = 0;
    for (let i = 0; i < totalPixels; i++) {
        const alpha = data[i * channels + (channels - 1)];
        binary[i] = alpha > ALPHA_THRESHOLD ? 1 : 0;
        foregroundCount += binary[i];
    }

    // remove-bg marking most of the frame as foreground usually means it failed to separate the
    // strap from a similarly-colored backdrop (e.g. a dark strap on a dark leather offcut) rather
    // than that the strap genuinely fills the frame — bail out to the safe fallback rather than
    // process a mask we can't trust.
    if (foregroundCount / totalPixels > MAX_FOREGROUND_AREA_FRACTION) {
        console.warn('⚠️ strapGeometry: background removal likely failed (foreground covers most of the frame) — falling back to the original strap image unchanged.');
        return strapBuffer;
    }

    const allComponents = labelConnectedComponents(binary, gridWidth, gridHeight);
    const minArea = totalPixels * MIN_COMPONENT_AREA_FRACTION;
    const significant = allComponents
        .map((points) => ({ points, stats: computeStats(points, gridWidth) }))
        .filter((c) => c.stats.area >= minArea);

    if (significant.length === 2) {
        console.log('🔎 strapGeometry: two separate strap pieces detected — straightening and re-stacking.');
        return straightenAndStack(strapBuffer, alignedCutout, significant.map((c) => c.points), gridWidth, gridHeight, origWidth, origHeight);
    }

    if (significant.length === 1) {
        // Could be a genuine single continuous strap, OR two pieces touching/crossing at one
        // point (common in the newer catalog photos) that flood-fill sees as one blob. Erode
        // the mask to see if a thin touching bridge splits it into two separate bulks.
        const split = erodeUntilSplit(binary, gridWidth, gridHeight, minArea);
        if (split) {
            console.log('🔎 strapGeometry: single blob eroded into two pieces — they were touching, not one continuous strap. Re-growing and re-stacking.');
            const regions = assignByNearestSeed(binary, gridWidth, gridHeight, split);
            if (regions.every((r) => r.length >= minArea)) {
                return straightenAndStack(strapBuffer, alignedCutout, regions, gridWidth, gridHeight, origWidth, origHeight);
            }
        }

        const rect = gridBoxToFullRect(significant[0].stats, gridWidth, gridHeight, origWidth, origHeight);
        console.log('🔎 strapGeometry: single continuous strap detected — cropping to its bounding box.');
        return sharp(strapBuffer).extract(rect).toBuffer();
    }

    console.warn(`⚠️ strapGeometry: found ${significant.length} significant component(s) — falling back to the original strap image unchanged.`);
    return strapBuffer;
}
