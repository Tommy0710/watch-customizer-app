import sharp from 'sharp';

// FLUX-2-PRO re-renders a strap's colour incorrectly a large fraction of the time: measured on the
// pilot's first two clean renders, a navy strap came back plain brown while a teal one was kept
// faithfully. The same failure is documented in /api/generate's prompt ("do not default to a
// generic brown or plain black leather when the reference photo is dark, busy, or hard to parse")
// and in strapProfile.ts. A brown-ified strap in the training set would teach the LoRA to brown
// every strap, so renders have to be checked against their source before they are used.
//
// Comparing average RGB directly is useless here — both images are dominated by white background
// and studio lighting, which washes out the difference. This samples only strongly-coloured
// pixels and compares their average hue and saturation, which is what actually differs between
// "navy" and "brown".

export type StrapColour = { hue: number; saturation: number; sampleRatio: number };

// Pixels below this saturation are background, shadow, stitching, or buckle metal — not leather.
const MIN_SATURATION = 0.12;

function rgbToHsv(r: number, g: number, b: number): { h: number; s: number } {
    const rn = r / 255;
    const gn = g / 255;
    const bn = b / 255;
    const max = Math.max(rn, gn, bn);
    const min = Math.min(rn, gn, bn);
    const delta = max - min;

    let h = 0;
    if (delta !== 0) {
        if (max === rn) h = ((gn - bn) / delta) % 6;
        else if (max === gn) h = (bn - rn) / delta + 2;
        else h = (rn - gn) / delta + 4;
    }
    h *= 60;
    if (h < 0) h += 360;

    return { h, s: max === 0 ? 0 : delta / max };
}

export async function measureStrapColour(image: Buffer): Promise<StrapColour> {
    // Downscale first: colour statistics do not need full resolution, and this keeps the scan fast.
    const { data, info } = await sharp(image)
        .resize({ width: 220, height: 220, fit: 'inside' })
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });

    const pixelCount = info.width * info.height;
    // Hue is circular — 350° and 10° are neighbours — so average it as a unit vector rather than
    // as a number, otherwise reds average to cyan.
    let sumX = 0;
    let sumY = 0;
    let sumS = 0;
    let counted = 0;

    for (let i = 0; i < pixelCount; i++) {
        const o = i * info.channels;
        const { h, s } = rgbToHsv(data[o], data[o + 1], data[o + 2]);
        if (s < MIN_SATURATION) continue;
        const radians = (h * Math.PI) / 180;
        sumX += Math.cos(radians);
        sumY += Math.sin(radians);
        sumS += s;
        counted++;
    }

    if (counted === 0) return { hue: 0, saturation: 0, sampleRatio: 0 };

    let hue = (Math.atan2(sumY / counted, sumX / counted) * 180) / Math.PI;
    if (hue < 0) hue += 360;

    return { hue, saturation: sumS / counted, sampleRatio: counted / pixelCount };
}

// Shortest distance between two hues on the 0-360 circle.
export function hueDistance(a: number, b: number): number {
    const diff = Math.abs(a - b) % 360;
    return diff > 180 ? 360 - diff : diff;
}

export type ColourVerdict = { ok: boolean; hueDelta: number; saturationGain: number; reason?: string };

// 30° of hue is generous enough to absorb lighting and white-balance differences between a staged
// photo and a studio render, while still catching navy-turned-brown (roughly 220° vs 30°).
const MAX_HUE_DELTA = 30;
const MIN_SAMPLE_RATIO = 0.02;

// Hue cannot judge black, white or grey leather, and that is exactly where the worst drift happens:
// a reviewer rejected a "Vintage Black Togo" render on sight while this check waved it through.
// What gives it away is that the render INVENTED colour — its sampled pixels came back 2.6x more
// saturated than the source's. Measured over 74 renders the median gain is 0.98 and the 90th
// percentile 1.37, and only three exceed 2.0: the black Togo, a black Pueblo and a white sailcloth.
// Both conditions have to hold, so a nearly-colourless strap whose saturation doubles from very
// little is not condemned for it.
const MAX_SATURATION_GAIN = 2.0;
const MIN_SATURATION_RISE = 0.15;

export function compareStrapColour(source: StrapColour, render: StrapColour): ColourVerdict {
    const saturationGain = render.saturation / Math.max(source.saturation, 0.01);
    const saturationRise = render.saturation - source.saturation;
    if (saturationGain >= MAX_SATURATION_GAIN && saturationRise >= MIN_SATURATION_RISE) {
        return {
            ok: false,
            hueDelta: 0,
            saturationGain,
            reason: `render invented colour — ${saturationGain.toFixed(1)}x the source's saturation`,
        };
    }

    if (source.sampleRatio < MIN_SAMPLE_RATIO || render.sampleRatio < MIN_SAMPLE_RATIO) {
        // Near-greyscale leather has no meaningful hue to compare. The saturation test above is
        // what covers it; hue is left alone rather than judged on noise.
        return { ok: true, hueDelta: 0, saturationGain, reason: 'too little saturated colour to compare hue' };
    }

    const hueDelta = hueDistance(source.hue, render.hue);
    return hueDelta <= MAX_HUE_DELTA
        ? { ok: true, hueDelta, saturationGain }
        : { ok: false, hueDelta, saturationGain, reason: `hue shifted ${Math.round(hueDelta)}°` };
}
