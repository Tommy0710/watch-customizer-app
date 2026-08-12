import { describe, it, expect } from 'vitest';
import { buildStrapLayoutTemplate, TEMPLATE_BUCKLE_SHARE, TEMPLATE_WIDTH, TEMPLATE_HEIGHT } from '@/lib/strapLayoutTemplate';
import { splitStrapSegments } from '@/lib/strapSegments';
import { trimSpringBarPins, measureSegment } from '@/lib/segmentFit';
import { TARGET_BUCKLE_SHARE, MAX_BUCKLE_SHARE_DRIFT } from '@/lib/draftStandard';

// The template is only worth sending if it depicts a render that would itself be accepted. A
// template drawn to the wrong proportion would teach the renderer to fail, and do it convincingly.
describe('buildStrapLayoutTemplate', () => {
  it('depicts a buckle share the standard accepts', () => {
    expect(TEMPLATE_BUCKLE_SHARE).toBeGreaterThanOrEqual(TARGET_BUCKLE_SHARE - MAX_BUCKLE_SHARE_DRIFT);
    expect(TEMPLATE_BUCKLE_SHARE).toBeLessThanOrEqual(TARGET_BUCKLE_SHARE + MAX_BUCKLE_SHARE_DRIFT);
  });

  it('splits into two segments the same way a real render does', async () => {
    const segments = await splitStrapSegments(await buildStrapLayoutTemplate());
    expect(segments).not.toBeNull();
  });

  it('measures inside the accepted band when put through the real pipeline', async () => {
    // Not a restatement of the constant: this runs the template through the same splitter and
    // measurement a render goes through, so a template that looks right on paper but splits wrong
    // is caught here.
    const segments = (await splitStrapSegments(await buildStrapLayoutTemplate()))!;
    const [buckle, tail] = await Promise.all([
      measureSegment(await trimSpringBarPins(segments.buckle, 'bottom'), 'bottom'),
      measureSegment(await trimSpringBarPins(segments.tail, 'top'), 'top'),
    ]);
    const share = buckle.aspect / (buckle.aspect + tail.aspect);
    expect(share).toBeGreaterThanOrEqual(TARGET_BUCKLE_SHARE - MAX_BUCKLE_SHARE_DRIFT);
    expect(share).toBeLessThanOrEqual(TARGET_BUCKLE_SHARE + MAX_BUCKLE_SHARE_DRIFT);
  });

  it('draws pieces the accepted SIZE, not merely the accepted ratio', async () => {
    // The share alone passed while the first template was 20% too long and narrow — 4.78 and 7.17
    // against the 3.96 and 5.99 measured on the renders that were signed off. Straps copied from it
    // came back long enough to force the watch head down to 92-96%, which the standard rejects.
    // Length over lug width is the quantity the layout actually controls, so it is what is asserted.
    const segments = (await splitStrapSegments(await buildStrapLayoutTemplate()))!;
    const [buckle, tail] = await Promise.all([
      measureSegment(await trimSpringBarPins(segments.buckle, 'bottom'), 'bottom'),
      measureSegment(await trimSpringBarPins(segments.tail, 'top'), 'top'),
    ]);
    expect(buckle.aspect).toBeGreaterThan(3.7);
    expect(buckle.aspect).toBeLessThan(4.3);
    expect(tail.aspect).toBeGreaterThan(5.7);
    expect(tail.aspect).toBeLessThan(6.3);
  });

  it('is the 9:16 shape the renderer is asked for', async () => {
    expect(TEMPLATE_WIDTH / TEMPLATE_HEIGHT).toBeCloseTo(9 / 16, 2);
  });
});
