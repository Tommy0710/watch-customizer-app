import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { trimSpringBarPins, measureSegment, measureFace } from '@/lib/segmentFit';
import { computeSegmentedLayout } from '@/lib/segmentedDraft';

const W = 160;
const H = 900;

// A strap segment: a leather column, optionally with a spring bar poking out sideways at one end.
async function strap(pins?: 'top' | 'bottom'): Promise<Buffer> {
  const px = Buffer.alloc(W * H * 3, 255);
  for (let y = 0; y < H; y++) {
    for (let x = Math.round(W * 0.2); x < Math.round(W * 0.8); x++) {
      const o = (y * W + x) * 3;
      px[o] = 120; px[o + 1] = 60; px[o + 2] = 40;
    }
  }
  if (pins) {
    const from = pins === 'top' ? Math.round(H * 0.02) : Math.round(H * 0.94);
    for (let y = from; y < from + 10; y++) {
      for (const x of [4, 5, 6, 7, W - 8, W - 7, W - 6, W - 5]) {
        const o = (y * W + x) * 3;
        px[o] = px[o + 1] = px[o + 2] = 90;
      }
    }
  }
  return sharp(px, { raw: { width: W, height: H, channels: 3 } }).png().toBuffer();
}

const sizeOf = async (b: Buffer) => {
  const m = await sharp(b).metadata();
  return { width: m.width!, height: m.height! };
};

describe('trimSpringBarPins', () => {
  it('takes the protruding bar off without shortening the segment', async () => {
    const withPins = await sharp(await strap('bottom')).trim().png().toBuffer();
    const cleaned = await trimSpringBarPins(withPins, 'bottom');

    const before = await sizeOf(withPins);
    const after = await sizeOf(cleaned);
    expect(after.width).toBeLessThan(before.width);
    // Length is what must NOT change: the leather still has to reach the case.
    expect(after.height / before.height).toBeGreaterThan(0.97);
  });

  it('leaves a segment with no protruding bar alone', async () => {
    const plain = await sharp(await strap()).trim().png().toBuffer();
    expect((await sizeOf(await trimSpringBarPins(plain, 'top'))).width).toBe((await sizeOf(plain)).width);
  });
});

describe('computeSegmentedLayout', () => {
  it('gives each segment a slot at its own proportions', async () => {
    // The whole point: nothing is squashed to hit a target balance, so a slot's aspect has to come
    // back exactly as it went in.
    const layout = computeSegmentedLayout({ caseAspect: 1, buckleAspect: 3.2, tailAspect: 5.5 });
    expect(layout.buckleHeight / layout.segmentWidth).toBeCloseTo(3.2, 1);
    expect(layout.tailHeight / layout.segmentWidth).toBeCloseTo(5.5, 1);
  });

  it('zooms out for a longer strap instead of compressing it', async () => {
    const short = computeSegmentedLayout({ caseAspect: 1, buckleAspect: 3.2, tailAspect: 5.5 });
    const long = computeSegmentedLayout({ caseAspect: 1, buckleAspect: 5.5, tailAspect: 5.6 });
    expect(long.segmentWidth).toBeLessThan(short.segmentWidth);
    expect(long.tailHeight / long.segmentWidth).toBeCloseTo(5.6, 1);
  });

  it('never draws the case bigger than the geometry tuned against real renders', async () => {
    const tiny = computeSegmentedLayout({ caseAspect: 1, buckleAspect: 0.5, tailAspect: 0.5 });
    expect(tiny.caseWidth).toBeLessThanOrEqual(Math.round(832 * 0.3) + 1);
  });

  it('keeps the whole assembly inside the canvas', async () => {
    for (const [b, t] of [[3.2, 5.5], [5.5, 5.6], [1.5, 9.0]]) {
      const l = computeSegmentedLayout({ caseAspect: 1.2, buckleAspect: b, tailAspect: t });
      expect(l.buckleTop).toBeGreaterThanOrEqual(0);
      expect(l.tailTop + l.tailHeight).toBeLessThanOrEqual(1472);
    }
  });
});

describe('measureSegment', () => {
  it('measures length in lug widths, so two resolutions of one strap agree', async () => {
    const base = await sharp(await strap()).trim().png().toBuffer();
    const half = await sharp(base).resize({ width: Math.round((await sizeOf(base)).width / 2) }).png().toBuffer();
    expect((await measureSegment(half, 'top')).aspect).toBeCloseTo((await measureSegment(base, 'top')).aspect, 1);
  });

  it('reads the leather width, not the width of a buckle overhanging it', async () => {
    // Sizing both halves off their bounding boxes made the buckle half's leather come out narrower
    // than the tail's, and the strap visibly stepped in where it met the case.
    const plain = await sharp(await strap()).trim().png().toBuffer();
    const { width } = await sizeOf(plain);
    const withBuckle = await sharp({
      create: { width: Math.round(width * 1.4), height: H + 120, channels: 3, background: { r: 255, g: 255, b: 255 } },
    })
      .composite([
        { input: plain, left: Math.round(width * 0.2), top: 120 },
        { input: await sharp({ create: { width: Math.round(width * 1.4), height: 110, channels: 3, background: { r: 190, g: 190, b: 190 } } }).png().toBuffer(), left: 0, top: 0 },
      ])
      .png()
      .toBuffer();

    const m = await measureSegment(withBuckle, 'bottom');
    expect(m.lugWidth).toBeLessThan(m.width * 0.8);
    expect(m.lugWidth / width).toBeCloseTo(1, 1);
  });
});

describe('measureFace', () => {
  // A watch head: a round case with two lug prongs at each end, and a crown sticking out on the
  // right so the bounding box is not centred on the lugs.
  async function head(opts: { crown: boolean }): Promise<Buffer> {
    const S = 400;
    const lug = `<rect x="120" y="0" width="40" height="60" fill="#333"/><rect x="240" y="0" width="40" height="60" fill="#333"/>`;
    const lugBottom = `<rect x="120" y="340" width="40" height="60" fill="#333"/><rect x="240" y="340" width="40" height="60" fill="#333"/>`;
    const crown = opts.crown ? `<rect x="330" y="185" width="60" height="30" fill="#555"/>` : '';
    return sharp(Buffer.from(
      `<svg width="${S}" height="${S}"><circle cx="200" cy="200" r="140" fill="#222"/>${lug}${lugBottom}${crown}</svg>`,
    ))
      .png()
      .toBuffer();
  }

  it('finds the lug axis, not the middle of the bounding box', async () => {
    const trimmed = await sharp(await head({ crown: true })).trim().png().toBuffer();
    const m = await measureFace(trimmed);
    // The crown pushes the box right, so the lug axis has to come out left of the box centre.
    expect(m.lugCentre).toBeLessThan(m.width / 2 - m.width * 0.02);
  });

  it('agrees with the box centre when nothing sticks out', async () => {
    const trimmed = await sharp(await head({ crown: false })).trim().png().toBuffer();
    const m = await measureFace(trimmed);
    expect(m.lugCentre).toBeCloseTo(m.width / 2, 0);
  });

  it('reads the clear gap between the lugs as the strap width', async () => {
    const trimmed = await sharp(await head({ crown: false })).trim().png().toBuffer();
    const m = await measureFace(trimmed);
    expect(m.lugGap).not.toBeNull();
    expect(m.lugGap! / m.width).toBeCloseTo(80 / 280, 1); // gap 160..240 of a 120..280 head
  });
});
