import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import {
  buildDraftComposite,
  computeDraftLayout,
  DRAFT_CANVAS_WIDTH,
  DRAFT_CANVAS_HEIGHT,
} from '@/lib/draftComposite';

describe('computeDraftLayout', () => {
  it('fits a tall strap to the safe height and centres it', () => {
    const l = computeDraftLayout({ strapWidth: 500, strapHeight: 2000, faceWidth: 400, faceHeight: 400 });
    // safe box is 6% margin each side: 832*0.88 = 732 wide, 1472*0.88 = 1295 high
    expect(l.strapHeight).toBe(1295);
    expect(l.strapWidth).toBe(324); // 500/2000 * 1295, rounded
    expect(l.strapLeft).toBe(Math.round((DRAFT_CANVAS_WIDTH - 324) / 2));
    expect(l.strapTop).toBe(Math.round((DRAFT_CANVAS_HEIGHT - 1295) / 2));
  });

  it('fits a wide strap to the safe width instead', () => {
    const l = computeDraftLayout({ strapWidth: 2000, strapHeight: 500, faceWidth: 400, faceHeight: 400 });
    expect(l.strapWidth).toBe(732);
    expect(l.strapHeight).toBe(183);
  });

  it('never enlarges a strap smaller than the safe box', () => {
    const l = computeDraftLayout({ strapWidth: 200, strapHeight: 300, faceWidth: 400, faceHeight: 400 });
    expect(l.strapWidth).toBe(200);
    expect(l.strapHeight).toBe(300);
  });

  it('sizes the face at 16% of the rendered strap width', () => {
    const l = computeDraftLayout({ strapWidth: 500, strapHeight: 2000, faceWidth: 400, faceHeight: 400 });
    expect(l.faceWidth).toBe(Math.round(324 * 0.16)); // 52
  });

  it('preserves the face aspect ratio', () => {
    const l = computeDraftLayout({ strapWidth: 500, strapHeight: 2000, faceWidth: 400, faceHeight: 800 });
    expect(l.faceHeight).toBe(l.faceWidth * 2);
  });

  it('centres the face horizontally on the strap', () => {
    const l = computeDraftLayout({ strapWidth: 500, strapHeight: 2000, faceWidth: 400, faceHeight: 400 });
    expect(l.faceLeft).toBe(Math.round(l.strapLeft + (l.strapWidth - l.faceWidth) / 2));
  });

  it('places the face centre at 30% down the strap, not the canvas', () => {
    const l = computeDraftLayout({ strapWidth: 500, strapHeight: 2000, faceWidth: 400, faceHeight: 400 });
    const faceCentreY = l.faceTop + l.faceHeight / 2;
    // Within 1px: faceTop and faceHeight are both rounded to whole pixels, so the centre can
    // legitimately land up to half a pixel either side of the exact 30% mark.
    expect(Math.abs(faceCentreY - (l.strapTop + l.strapHeight * 0.3))).toBeLessThanOrEqual(1);
  });

  it('keeps every element inside the canvas', () => {
    const l = computeDraftLayout({ strapWidth: 3000, strapHeight: 400, faceWidth: 1200, faceHeight: 900 });
    expect(l.strapLeft).toBeGreaterThanOrEqual(0);
    expect(l.strapTop).toBeGreaterThanOrEqual(0);
    expect(l.faceLeft).toBeGreaterThanOrEqual(0);
    expect(l.faceTop).toBeGreaterThanOrEqual(0);
    expect(l.faceLeft + l.faceWidth).toBeLessThanOrEqual(DRAFT_CANVAS_WIDTH);
    expect(l.faceTop + l.faceHeight).toBeLessThanOrEqual(DRAFT_CANVAS_HEIGHT);
  });
});

async function solid(width: number, height: number, colour: { r: number; g: number; b: number }) {
  return sharp({ create: { width, height, channels: 3, background: colour } }).png().toBuffer();
}

describe('buildDraftComposite', () => {
  it('always returns a 832x1472 PNG regardless of input sizes', async () => {
    const strap = await solid(900, 2600, { r: 120, g: 60, b: 20 });
    const face = await solid(600, 600, { r: 10, g: 10, b: 10 });
    const meta = await sharp(await buildDraftComposite(strap, face)).metadata();
    expect(meta.width).toBe(832);
    expect(meta.height).toBe(1472);
    expect(meta.format).toBe('png');
  });

  it('produces an identical buffer for identical inputs', async () => {
    const strap = await solid(900, 2600, { r: 120, g: 60, b: 20 });
    const face = await solid(600, 600, { r: 10, g: 10, b: 10 });
    const a = await buildDraftComposite(strap, face);
    const b = await buildDraftComposite(strap, face);
    expect(a.equals(b)).toBe(true);
  });

  it('leaves the canvas corners white', async () => {
    const strap = await solid(900, 2600, { r: 120, g: 60, b: 20 });
    const face = await solid(600, 600, { r: 10, g: 10, b: 10 });
    const out = await buildDraftComposite(strap, face);
    const { data } = await sharp(out).extract({ left: 0, top: 0, width: 4, height: 4 }).raw().toBuffer({ resolveWithObject: true });
    expect(data[0]).toBe(255);
    expect(data[1]).toBe(255);
    expect(data[2]).toBe(255);
  });

  it('places the dark face at the computed position', async () => {
    const strap = await solid(900, 2600, { r: 200, g: 200, b: 200 });
    const face = await solid(600, 600, { r: 0, g: 0, b: 0 });
    const out = await buildDraftComposite(strap, face);
    const layout = computeDraftLayout({ strapWidth: 900, strapHeight: 2600, faceWidth: 600, faceHeight: 600 });
    const { data } = await sharp(out)
      .extract({
        left: layout.faceLeft + Math.floor(layout.faceWidth / 2),
        top: layout.faceTop + Math.floor(layout.faceHeight / 2),
        width: 1,
        height: 1,
      })
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect(data[0]).toBeLessThan(30);
  });
});
