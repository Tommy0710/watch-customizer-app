import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { checkCleanRender, prepareFace, MIN_FACE_PASS_RATIO } from '@/lib/renderCheck';

// Two tapered strap pieces side by side on white, separated by a gutter — the shape splitStrapSegments
// looks for. `buckleLength` is what decides whether the render passes: a real strap's buckle piece is
// roughly two thirds the length of its tail.
async function twoPieceRender(opts: { buckleLength: number; tailLength: number }): Promise<Buffer> {
  const W = 600;
  const H = 900;
  const px = Buffer.alloc(W * H * 3, 255);
  const paint = (cx: number, length: number, fatAtTop: boolean) => {
    for (let y = 0; y < length; y++) {
      const along = fatAtTop ? y / length : 1 - y / length;
      const half = 60 * (1 - 0.35 * along);
      for (let x = Math.round(cx - half); x < Math.round(cx + half); x++) {
        const o = (y * W + x) * 3;
        px[o] = 120; px[o + 1] = 70; px[o + 2] = 45;
      }
    }
  };
  paint(150, opts.buckleLength, false);
  paint(450, opts.tailLength, true);
  return sharp(px, { raw: { width: W, height: H, channels: 3 } }).png().toBuffer();
}

// A watch case: an opaque block with two lug prongs at each end, which is what measureFace reads.
async function face(): Promise<Buffer> {
  const W = 300;
  const H = 340;
  const px = Buffer.alloc(W * H * 4, 0);
  const set = (x: number, y: number) => {
    const o = (y * W + x) * 4;
    px[o] = 90; px[o + 1] = 90; px[o + 2] = 95; px[o + 3] = 255;
  };
  for (let y = 60; y < 280; y++) for (let x = 40; x < 260; x++) set(x, y);
  for (const y0 of [20, 280]) {
    for (let y = y0; y < y0 + 40; y++) {
      for (let x = 70; x < 110; x++) set(x, y);
      for (let x = 190; x < 230; x++) set(x, y);
    }
  }
  return sharp(px, { raw: { width: W, height: H, channels: 4 } }).png().toBuffer();
}

describe('checkCleanRender', () => {
  it('accepts a render whose buckle piece is about two thirds of the tail', async () => {
    const faces = [await prepareFace(await face())];
    const verdict = await checkCleanRender(await twoPieceRender({ buckleLength: 520, tailLength: 820 }), faces);
    expect(verdict.buckleShare).not.toBeNull();
    expect(verdict.buckleShare!).toBeGreaterThan(0.32);
    expect(verdict.buckleShare!).toBeLessThan(0.44);
  });

  it('rejects the duplicated render this check exists to catch', async () => {
    // 54 of 74 real renders came back as the same piece drawn twice, which reads as two halves of
    // equal length and a buckle share of ~0.5.
    const faces = [await prepareFace(await face())];
    const verdict = await checkCleanRender(await twoPieceRender({ buckleLength: 820, tailLength: 820 }), faces);
    expect(verdict.ok).toBe(false);
    expect(verdict.buckleShare!).toBeGreaterThan(0.45);
    expect(verdict.reasons.join(' ')).toContain('too alike in length');
  });

  it('reports a render that cannot be split rather than throwing', async () => {
    const solid = await sharp({ create: { width: 400, height: 600, channels: 3, background: { r: 120, g: 70, b: 45 } } })
      .png().toBuffer();
    const verdict = await checkCleanRender(solid, [await prepareFace(await face())]);
    expect(verdict.ok).toBe(false);
    expect(verdict.buckleShare).toBeNull();
    expect(verdict.reasons[0]).toContain('does not split');
  });

  it('carries a failing colour verdict through to the result', async () => {
    const faces = [await prepareFace(await face())];
    const verdict = await checkCleanRender(
      await twoPieceRender({ buckleLength: 520, tailLength: 820 }),
      faces,
      { ok: false, hueDelta: 140, saturationGain: 1.1, reason: 'hue shifted 140°' },
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.reasons.join(' ')).toContain('hue shifted');
  });

  it('refuses to judge with no faces, rather than passing everything', async () => {
    await expect(checkCleanRender(await twoPieceRender({ buckleLength: 520, tailLength: 820 }), []))
      .rejects.toThrow(/at least one face/);
  });

  it('needs most faces to pass, not all of them', () => {
    // Three of the 114 library faces have a lug gap no measurement can read, so a clean sweep is
    // unreachable by construction.
    expect(MIN_FACE_PASS_RATIO).toBeGreaterThan(0.5);
    expect(MIN_FACE_PASS_RATIO).toBeLessThan(1);
  });
});
