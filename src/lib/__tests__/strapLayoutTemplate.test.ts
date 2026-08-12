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

  it('is the 9:16 shape the renderer is asked for', async () => {
    expect(TEMPLATE_WIDTH / TEMPLATE_HEIGHT).toBeCloseTo(9 / 16, 2);
  });
});
