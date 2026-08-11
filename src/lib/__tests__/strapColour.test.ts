import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { measureStrapColour, hueDistance, compareStrapColour } from '@/lib/strapColour';

// A coloured band down the middle of a white frame — the same shape as a strap on studio white.
async function bandOnWhite(colour: { r: number; g: number; b: number }, size = 120): Promise<Buffer> {
  const px = Buffer.alloc(size * size * 3, 255);
  for (let y = 0; y < size; y++) {
    for (let x = Math.floor(size * 0.35); x < Math.floor(size * 0.65); x++) {
      const o = (y * size + x) * 3;
      px[o] = colour.r; px[o + 1] = colour.g; px[o + 2] = colour.b;
    }
  }
  return sharp(px, { raw: { width: size, height: size, channels: 3 } }).png().toBuffer();
}

const NAVY = { r: 28, g: 42, b: 88 };
const BROWN = { r: 128, g: 78, b: 40 };
const TEAL = { r: 20, g: 95, b: 92 };

describe('measureStrapColour', () => {
  it('ignores the white background and reports the band hue', async () => {
    const navy = await measureStrapColour(await bandOnWhite(NAVY));
    // Navy sits around 220-230 degrees.
    expect(navy.hue).toBeGreaterThan(200);
    expect(navy.hue).toBeLessThan(250);
    expect(navy.sampleRatio).toBeGreaterThan(0.1);
    expect(navy.sampleRatio).toBeLessThan(0.5);
  });

  it('reports almost no saturated sample for a plain white image', async () => {
    const white = await sharp({ create: { width: 60, height: 60, channels: 3, background: { r: 255, g: 255, b: 255 } } })
      .png().toBuffer();
    expect((await measureStrapColour(white)).sampleRatio).toBeLessThan(0.02);
  });
});

describe('hueDistance', () => {
  it('measures the short way around the circle', () => {
    expect(hueDistance(10, 350)).toBe(20);
    expect(hueDistance(350, 10)).toBe(20);
    expect(hueDistance(0, 180)).toBe(180);
    expect(hueDistance(90, 90)).toBe(0);
  });
});

describe('compareStrapColour', () => {
  it('rejects the navy-rendered-as-brown failure this check exists for', async () => {
    const verdict = compareStrapColour(
      await measureStrapColour(await bandOnWhite(NAVY)),
      await measureStrapColour(await bandOnWhite(BROWN)),
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.hueDelta).toBeGreaterThan(100);
  });

  it('accepts a faithful render of the same colour', async () => {
    const verdict = compareStrapColour(
      await measureStrapColour(await bandOnWhite(TEAL)),
      await measureStrapColour(await bandOnWhite(TEAL)),
    );
    expect(verdict.ok).toBe(true);
  });

  it('tolerates a mild lighting shift', async () => {
    const verdict = compareStrapColour(
      await measureStrapColour(await bandOnWhite(TEAL)),
      await measureStrapColour(await bandOnWhite({ r: 26, g: 110, b: 100 })),
    );
    expect(verdict.ok).toBe(true);
  });

  it('does not judge a greyscale strap on hue when it stayed greyscale', () => {
    const verdict = compareStrapColour(
      { hue: 0, saturation: 0.14, sampleRatio: 0.004 },
      { hue: 200, saturation: 0.15, sampleRatio: 0.18 },
    );
    expect(verdict.ok).toBe(true);
    expect(verdict.reason).toContain('too little saturated colour');
  });

  it('catches a black strap that came back brown', () => {
    // This case used to pass, and a reviewer rejected the draft on sight: product 25533, "Vintage
    // Black Togo", source saturation 0.149 against the render's 0.388. Hue cannot see it — black
    // has no hue — but inventing colour out of nothing is unmistakable on saturation alone.
    const verdict = compareStrapColour(
      { hue: 30, saturation: 0.149, sampleRatio: 0.398 },
      { hue: 32, saturation: 0.388, sampleRatio: 0.341 },
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain('invented colour');
  });

  it('leaves a dark grey strap alone when it only gains a little', () => {
    // Product 26777, accepted on review: 0.141 to 0.206. The gate must not condemn ordinary studio
    // lighting picking up more colour than a staged catalog shot did.
    const verdict = compareStrapColour(
      { hue: 30, saturation: 0.141, sampleRatio: 0.234 },
      { hue: 35, saturation: 0.206, sampleRatio: 0.15 },
    );
    expect(verdict.ok).toBe(true);
  });
});
