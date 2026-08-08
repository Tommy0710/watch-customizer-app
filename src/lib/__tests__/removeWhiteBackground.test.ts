import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { removeWhiteBackground } from '@/lib/removeWhiteBackground';

// A dark ring on white with a WHITE centre — stands in for a watch case with a white dial.
// The border white must go; the enclosed white must survive.
async function ringOnWhite(size = 60): Promise<Buffer> {
  const centre = size / 2;
  const outer = size * 0.35;
  const inner = size * 0.2;
  const px = Buffer.alloc(size * size * 3, 255);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - centre, y - centre);
      if (d <= outer && d >= inner) {
        const o = (y * size + x) * 3;
        px[o] = 20; px[o + 1] = 20; px[o + 2] = 20;
      }
    }
  }
  return sharp(px, { raw: { width: size, height: size, channels: 3 } }).png().toBuffer();
}

async function alphaAt(buf: Buffer, x: number, y: number): Promise<number> {
  const { data } = await sharp(buf).ensureAlpha().extract({ left: x, top: y, width: 1, height: 1 })
    .raw().toBuffer({ resolveWithObject: true });
  return data[3];
}

describe('removeWhiteBackground', () => {
  it('clears the white surrounding the subject', async () => {
    const out = await removeWhiteBackground(await ringOnWhite());
    expect(await alphaAt(out, 1, 1)).toBe(0);
    expect(await alphaAt(out, 58, 58)).toBe(0);
  });

  it('keeps white that is enclosed by the subject, such as a white dial', async () => {
    const out = await removeWhiteBackground(await ringOnWhite());
    expect(await alphaAt(out, 30, 30)).toBe(255);
  });

  it('keeps the subject itself opaque', async () => {
    const out = await removeWhiteBackground(await ringOnWhite());
    // A point on the dark ring: 30 - 0.3*60 = 12 px above centre.
    expect(await alphaAt(out, 30, 12)).toBe(255);
  });

  it('preserves the image dimensions', async () => {
    const meta = await sharp(await removeWhiteBackground(await ringOnWhite(48))).metadata();
    expect(meta.width).toBe(48);
    expect(meta.height).toBe(48);
  });

  it('leaves an image with no white border untouched', async () => {
    const solid = await sharp({ create: { width: 20, height: 20, channels: 3, background: { r: 10, g: 90, b: 40 } } })
      .png().toBuffer();
    const out = await removeWhiteBackground(solid);
    expect(await alphaAt(out, 0, 0)).toBe(255);
    expect(await alphaAt(out, 10, 10)).toBe(255);
  });
});
