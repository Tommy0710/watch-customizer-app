import { describe, it, expect } from 'vitest';
import {
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
