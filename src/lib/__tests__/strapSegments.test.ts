import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { findGutter, buckleAsymmetry } from '@/lib/strapSegments';

// A vertical band on white, optionally with a bright grey block standing in for a metal buckle.
async function band(withMetal: boolean, size = 240): Promise<Buffer> {
  const px = Buffer.alloc(size * size * 3, 255);
  for (let y = 0; y < size; y++) {
    for (let x = Math.floor(size * 0.3); x < Math.floor(size * 0.7); x++) {
      const o = (y * size + x) * 3;
      px[o] = 120; px[o + 1] = 60; px[o + 2] = 40; // saturated leather
    }
  }
  if (withMetal) {
    for (let y = 10; y < Math.floor(size * 0.25); y++) {
      for (let x = Math.floor(size * 0.28); x < Math.floor(size * 0.72); x++) {
        const o = (y * size + x) * 3;
        px[o] = px[o + 1] = px[o + 2] = 200; // bright, colourless
      }
    }
  }
  return sharp(px, { raw: { width: size, height: size, channels: 3 } }).png().toBuffer();
}

describe('findGutter', () => {
  it('splits at the emptiest middle column', () => {
    const density = [...Array(20).fill(0.9), ...Array(6).fill(0.01), ...Array(20).fill(0.9)];
    const g = findGutter(density, density.length);
    expect(g).not.toBeNull();
    expect(g!.start).toBeGreaterThanOrEqual(20);
    expect(g!.end).toBeLessThanOrEqual(26);
  });

  it('returns null for a single wide object with no gap', () => {
    expect(findGutter(new Array(40).fill(0.9), 40)).toBeNull();
  });
});

describe('buckleAsymmetry', () => {
  it('is high when only one half carries a buckle', async () => {
    expect(await buckleAsymmetry({ buckle: await band(true), tail: await band(false) })).toBeGreaterThan(1.8);
  });

  it('falls towards 1 when both halves carry one', async () => {
    // The signal this ranks on: a doubled render looks even, a clean one lopsided.
    const doubled = await buckleAsymmetry({ buckle: await band(true), tail: await band(true) });
    const single = await buckleAsymmetry({ buckle: await band(true), tail: await band(false) });
    expect(doubled).toBeLessThan(single);
    expect(doubled).toBeCloseTo(1, 1);
  });
});
