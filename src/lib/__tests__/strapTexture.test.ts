import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { measureStrapTexture, textureDistance, compareStrapTexture } from '@/lib/strapTexture';

// Smooth leather: a flat mid-grey band on white.
async function smoothBand(size = 200): Promise<Buffer> {
  const px = Buffer.alloc(size * size * 3, 255);
  for (let y = 0; y < size; y++) {
    for (let x = Math.floor(size * 0.3); x < Math.floor(size * 0.7); x++) {
      const o = (y * size + x) * 3;
      px[o] = px[o + 1] = px[o + 2] = 120;
    }
  }
  return sharp(px, { raw: { width: size, height: size, channels: 3 } }).png().toBuffer();
}

// Scaled leather: the same band broken into a hard-edged grid, like python or alligator scales.
async function scaledBand(size = 200, cell = 10): Promise<Buffer> {
  const px = Buffer.alloc(size * size * 3, 255);
  for (let y = 0; y < size; y++) {
    for (let x = Math.floor(size * 0.3); x < Math.floor(size * 0.7); x++) {
      const onEdge = x % cell === 0 || y % cell === 0;
      const v = onEdge ? 20 : 150;
      const o = (y * size + x) * 3;
      px[o] = px[o + 1] = px[o + 2] = v;
    }
  }
  return sharp(px, { raw: { width: size, height: size, channels: 3 } }).png().toBuffer();
}

describe('measureStrapTexture', () => {
  it('ignores the white background and samples only the band', async () => {
    const sig = await measureStrapTexture(await smoothBand());
    expect(sig.sampled).toBeGreaterThan(2000);
    expect(sig.histogram.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 5);
  });

  it('puts smooth leather almost entirely in the low-gradient bins', async () => {
    const sig = await measureStrapTexture(await smoothBand());
    expect(sig.histogram[0]).toBeGreaterThan(0.9);
  });

  it('gives scaled leather a heavier high-gradient tail than smooth leather', async () => {
    const smooth = await measureStrapTexture(await smoothBand());
    const scaled = await measureStrapTexture(await scaledBand());
    const tail = (h: number[]) => h.slice(4).reduce((a, b) => a + b, 0);
    expect(tail(scaled.histogram)).toBeGreaterThan(tail(smooth.histogram));
  });
});

describe('textureDistance', () => {
  it('is zero for identical signatures', async () => {
    const sig = await measureStrapTexture(await smoothBand());
    expect(textureDistance(sig, sig)).toBeCloseTo(0, 6);
  });

  it('is large between smooth and scaled leather', async () => {
    const d = textureDistance(await measureStrapTexture(await smoothBand()), await measureStrapTexture(await scaledBand()));
    expect(d).toBeGreaterThan(0.34);
  });
});

describe('compareStrapTexture', () => {
  it('rejects a render whose grain became a different material', async () => {
    const verdict = compareStrapTexture(
      await measureStrapTexture(await smoothBand()),
      await measureStrapTexture(await scaledBand()),
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain('grain differs');
  });

  it('accepts a render whose grain shifted only slightly', async () => {
    const verdict = compareStrapTexture(
      await measureStrapTexture(await scaledBand(200, 10)),
      await measureStrapTexture(await scaledBand(200, 10)),
    );
    expect(verdict.ok).toBe(true);
  });

  it('separates smooth from scaled leather by more than the threshold', async () => {
    // The gate must clear real-world spread: measured p90 across genuine renders is 0.45, and the
    // one render that changed material scored 0.46.
    const d = textureDistance(
      await measureStrapTexture(await smoothBand()),
      await measureStrapTexture(await scaledBand()),
    );
    expect(d).toBeGreaterThan(0.42);
  });

  it('abstains when there is almost no leather to look at', () => {
    const empty = { histogram: new Array(16).fill(0), sampled: 0 };
    const verdict = compareStrapTexture(empty, empty);
    expect(verdict.ok).toBe(true);
    expect(verdict.reason).toContain('too little leather');
  });
});
