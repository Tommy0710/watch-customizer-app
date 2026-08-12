import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { findGutter, buckleAsymmetry, segmentStats, segmentNeedsFlip, assignHalves } from '@/lib/strapSegments';

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

// A tapered strap segment: full width at `fatEnd`, narrowing to 40% at the other end, with an
// optional metal block at `metalEnd`. This is the silhouette the orientation test reads.
async function segment(
  opts: { fatEnd: 'top' | 'bottom'; metalEnd?: 'top' | 'bottom' },
  size = 240,
): Promise<Buffer> {
  const px = Buffer.alloc(size * size * 3, 255);
  for (let y = 0; y < size; y++) {
    const along = opts.fatEnd === 'top' ? y / size : 1 - y / size;
    const halfWidth = (size * 0.2) * (1 - 0.6 * along);
    for (let x = Math.round(size / 2 - halfWidth); x < Math.round(size / 2 + halfWidth); x++) {
      const o = (y * size + x) * 3;
      px[o] = 120; px[o + 1] = 60; px[o + 2] = 40; // saturated leather
    }
  }
  if (opts.metalEnd) {
    const from = opts.metalEnd === 'top' ? Math.round(size * 0.04) : Math.round(size * 0.76);
    for (let y = from; y < from + Math.round(size * 0.2); y++) {
      for (let x = Math.round(size * 0.35); x < Math.round(size * 0.65); x++) {
        const o = (y * size + x) * 3;
        px[o] = px[o + 1] = px[o + 2] = 200; // bright, colourless
      }
    }
  }
  return sharp(px, { raw: { width: size, height: size, channels: 3 } }).png().toBuffer();
}

describe('segmentNeedsFlip', () => {
  it('leaves a buckle half alone when its buckle is at the top', async () => {
    const stats = await segmentStats(await segment({ fatEnd: 'bottom', metalEnd: 'top' }));
    expect(segmentNeedsFlip(stats, 'buckle')).toBe(false);
  });

  it('flips a buckle half whose buckle ended up at the bottom', async () => {
    // This is the fault behind 19 of the 45 drafts a reviewer marked upside down: the buckle sits
    // against the case instead of at the far end of the strap.
    const stats = await segmentStats(await segment({ fatEnd: 'top', metalEnd: 'bottom' }));
    expect(segmentNeedsFlip(stats, 'buckle')).toBe(true);
  });

  it('leaves a tail half alone when it tapers downward to its tip', async () => {
    const stats = await segmentStats(await segment({ fatEnd: 'top' }));
    expect(segmentNeedsFlip(stats, 'tail')).toBe(false);
  });

  it('flips a tail half whose tip points up at the case', async () => {
    const stats = await segmentStats(await segment({ fatEnd: 'bottom' }));
    expect(segmentNeedsFlip(stats, 'tail')).toBe(true);
  });

  it('falls back to the silhouette when the metal reading says nothing', async () => {
    // A segment with no buckle still registers some metal — resampling leaves grey along every
    // edge, and grey is bright and colourless. What marks it as uninformative is that it is spread
    // evenly rather than gathered at one end, so the silhouette has to decide: the spring-bar end
    // is the fat one and it must face the case, making a fat-at-the-top buckle half upside down.
    const stats = await segmentStats(await segment({ fatEnd: 'top' }));
    expect(Math.abs(stats.metalCentroidY - 0.5)).toBeLessThan(0.08);
    expect(segmentNeedsFlip(stats, 'buckle')).toBe(true);
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

describe('assignHalves', () => {
  it('calls the shorter half the buckle even when the longer one scores more metal', () => {
    // Product 16498, measured: a correct render of a pale grey strap. The long holes-piece is
    // covered in bright eyelets and, being bigger, out-scores the actual buckle on metal — which is
    // how it used to be handed over as the buckle half and the draft built upside down.
    const holes = { image: 'holes', height: 1276, metal: 0.42 };
    const buckle = { image: 'buckle', height: 810, metal: 0.31 };
    expect(assignHalves(holes, buckle)).toEqual({ buckle: 'buckle', tail: 'holes' });
    // Order of the two arguments must not change the answer.
    expect(assignHalves(buckle, holes)).toEqual({ buckle: 'buckle', tail: 'holes' });
  });

  it('agrees with metal when the halves differ in length and metal points the same way', () => {
    // Product 6286, measured: an ordinary render where nothing is in dispute.
    expect(assignHalves(
      { image: 'short', height: 816, metal: 0.5 },
      { image: 'long', height: 1295, metal: 0.2 },
    )).toEqual({ buckle: 'short', tail: 'long' });
  });

  it('falls back to metal when the two halves are the same length', () => {
    // Product 15783, measured: PRO drew the same piece twice, so length says nothing. The standard
    // rejects this render regardless; the point is that the tie-break still returns an answer.
    expect(assignHalves(
      { image: 'a', height: 1296, metal: 0.2 },
      { image: 'b', height: 1295, metal: 0.6 },
    )).toEqual({ buckle: 'b', tail: 'a' });
  });

  it('treats a 1.08x difference as no difference and a 1.18x one as decisive', () => {
    // The threshold sits in a gap that is empty in the measured data: the even cluster tops out at
    // 1.083 and the uneven one starts at 1.175.
    expect(assignHalves(
      { image: 'a', height: 1000, metal: 0.9 },
      { image: 'b', height: 1083, metal: 0.1 },
    ).buckle).toBe('a'); // decided by metal, and metal happens to agree here
    expect(assignHalves(
      { image: 'a', height: 1000, metal: 0.1 },
      { image: 'b', height: 1180, metal: 0.9 },
    ).buckle).toBe('a'); // decided by length, against metal
  });

  it('does not divide by zero when a half has no height', () => {
    expect(assignHalves(
      { image: 'a', height: 0, metal: 0.7 },
      { image: 'b', height: 900, metal: 0.2 },
    )).toEqual({ buckle: 'a', tail: 'b' });
  });
});
