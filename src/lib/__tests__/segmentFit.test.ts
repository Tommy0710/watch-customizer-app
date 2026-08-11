import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { trimSpringBarPins, plainBand, fitSegmentToSlot } from '@/lib/segmentFit';

const W = 160;
const H = 900;

// A strap segment: a leather column, optionally with a spring bar poking out sideways at one end,
// and optionally with a horizontal stripe pattern so a cut can be checked for landing on it.
async function strap(opts: { pins?: 'top' | 'bottom'; period?: number } = {}): Promise<Buffer> {
  const px = Buffer.alloc(W * H * 3, 255);
  const left = Math.round(W * 0.2);
  const right = Math.round(W * 0.8);
  for (let y = 0; y < H; y++) {
    const onStripe = opts.period ? y % opts.period < opts.period / 2 : false;
    for (let x = left; x < right; x++) {
      const o = (y * W + x) * 3;
      px[o] = onStripe ? 60 : 120;
      px[o + 1] = onStripe ? 30 : 60;
      px[o + 2] = onStripe ? 20 : 40;
    }
  }
  if (opts.pins) {
    const from = opts.pins === 'top' ? Math.round(H * 0.02) : Math.round(H * 0.94);
    for (let y = from; y < from + 10; y++) {
      for (const x of [4, 5, 6, 7, W - 8, W - 7, W - 6, W - 5]) {
        const o = (y * W + x) * 3;
        px[o] = px[o + 1] = px[o + 2] = 90;
      }
    }
  }
  return sharp(px, { raw: { width: W, height: H, channels: 3 } }).png().toBuffer();
}

const widthOf = async (b: Buffer) => (await sharp(b).metadata()).width!;

describe('trimSpringBarPins', () => {
  it('takes the protruding bar off without shortening the segment', async () => {
    const withPins = await strap({ pins: 'bottom' });
    const cleaned = await trimSpringBarPins(withPins, 'bottom');

    // The pins made the trimmed image wider than the leather; removing them narrows it back.
    expect(await widthOf(cleaned)).toBeLessThan(await widthOf(await sharp(withPins).trim().png().toBuffer()));
    // Length is what must NOT change: the leather still has to reach the case.
    const before = (await sharp(withPins).trim().png().toBuffer());
    const beforeH = (await sharp(before).metadata()).height!;
    const afterH = (await sharp(cleaned).metadata()).height!;
    expect(afterH / beforeH).toBeGreaterThan(0.97);
  });

  it('leaves a segment with no protruding bar alone', async () => {
    const plain = await sharp(await strap()).trim().png().toBuffer();
    const cleaned = await trimSpringBarPins(plain, 'top');
    expect(await widthOf(cleaned)).toBe(await widthOf(plain));
  });
});

describe('plainBand', () => {
  it('protects the buckle at the top and the spring bar at the bottom', () => {
    const band = plainBand(1000, 160, 'buckle');
    expect(band.from).toBeGreaterThan(200); // buckle plus keepers
    expect(band.to).toBeLessThan(1000);
  });

  it('protects the tip at the bottom and the spring bar at the top for a tail', () => {
    const buckle = plainBand(1000, 160, 'buckle');
    const tail = plainBand(1000, 160, 'tail');
    // The two are mirror images: the buckle end is bigger than the tip, and it sits at the
    // opposite end of the piece.
    expect(tail.from).toBeLessThan(buckle.from);
    expect(1000 - tail.to).toBeGreaterThan(1000 - buckle.to);
  });
});

describe('fitSegmentToSlot', () => {
  it('produces exactly the slot it was given', async () => {
    const out = await fitSegmentToSlot(await strap(), 156, 398, 'buckle');
    const m = await sharp(out).metadata();
    expect(m.width).toBe(156);
    expect(m.height).toBe(398);
  });

  it('keeps the grain at one scale instead of squashing the whole piece', async () => {
    // Both halves come off renders of near-equal length but get very different slots. Under the
    // old whole-segment stretch that left the stripes running at two different scales on the two
    // sides of the same watch; cutting length out of the middle keeps them matched.
    const source = await strap({ period: 40 });
    const [asBuckle, asTail] = await Promise.all([
      fitSegmentToSlot(source, 156, 398, 'buckle'),
      fitSegmentToSlot(source, 156, 708, 'tail'),
    ]);

    const stripePeriod = async (image: Buffer): Promise<number> => {
      const { data, info } = await sharp(image).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      const dark: boolean[] = [];
      for (let y = 0; y < info.height; y++) {
        const o = (y * info.width + Math.floor(info.width / 2)) * info.channels;
        dark.push(data[o] < 90);
      }
      let edges = 0;
      for (let y = 1; y < dark.length; y++) if (dark[y] !== dark[y - 1]) edges++;
      return edges === 0 ? Infinity : (2 * dark.length) / edges;
    };

    const [pb, pt] = await Promise.all([stripePeriod(asBuckle), stripePeriod(asTail)]);
    expect(Math.abs(pb - pt) / pt).toBeLessThan(0.12);
  });

  it('stretches rather than cutting when there is no plain leather to spare', async () => {
    // A slot so short that the protected zones alone overfill it: nothing can be cut, and losing
    // the buckle or the spring bar would be worse than a squash.
    const out = await fitSegmentToSlot(await strap(), 156, 60, 'buckle');
    const m = await sharp(out).metadata();
    expect(m.height).toBe(60);
  });
});
