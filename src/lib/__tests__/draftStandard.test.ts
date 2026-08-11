import { describe, it, expect } from 'vitest';
import { assessDraft, MIN_ACCEPTED_CASE_SCALE } from '@/lib/draftStandard';
import { computeSegmentedLayout, CASE_WIDTH_RATIO } from '@/lib/segmentedDraft';
import { DRAFT_CANVAS_WIDTH, DRAFT_CANVAS_HEIGHT } from '@/lib/draftComposite';

// The five drafts a reviewer accepted on 2026-08-11, measured off their real renders and heads.
// These are the standard: if a change to the layout moves any of them, it has moved the thing that
// was signed off, and that has to be a deliberate decision rather than a side effect.
const ACCEPTED = [
  { id: 26593, buckleAspect: 3.44, tailAspect: 5.76, caseAspect: 1.11, strapPerCase: 0.490 },
  { id: 63837, buckleAspect: 3.95, tailAspect: 5.95, caseAspect: 1.11, strapPerCase: 0.493 },
  { id: 68963, buckleAspect: 3.75, tailAspect: 6.17, caseAspect: 1.06, strapPerCase: 0.455 },
  { id: 71311, buckleAspect: 3.61, tailAspect: 5.93, caseAspect: 1.01, strapPerCase: 0.538 },
  { id: 71317, buckleAspect: 3.77, tailAspect: 6.15, caseAspect: 1.06, strapPerCase: 0.470 },
];

describe('the accepted drafts', () => {
  it.each(ACCEPTED)('draws product $id at effectively one watch size', (fixture) => {
    // Not exactly one size: 71311's strap is long enough to need 97%, and that draft was accepted.
    // What matters is that the spread stays small enough to be invisible, and never reaches the
    // quarter it used to span.
    const layout = computeSegmentedLayout(fixture);
    expect(layout.caseScale).toBeGreaterThanOrEqual(MIN_ACCEPTED_CASE_SCALE);
    expect(layout.caseScale).toBeLessThanOrEqual(1);
    expect(layout.caseWidth).toBeGreaterThanOrEqual(Math.round(DRAFT_CANVAS_WIDTH * CASE_WIDTH_RATIO * MIN_ACCEPTED_CASE_SCALE));
  });

  it.each(ACCEPTED)('places both halves of product $id at their own proportions', (fixture) => {
    const layout = computeSegmentedLayout(fixture);
    expect(layout.buckleHeight / layout.segmentWidth).toBeCloseTo(fixture.buckleAspect, 1);
    expect(layout.tailHeight / layout.segmentWidth).toBeCloseTo(fixture.tailAspect, 1);
  });

  it.each(ACCEPTED)('keeps product $id inside the canvas', (fixture) => {
    const layout = computeSegmentedLayout(fixture);
    expect(layout.buckleTop).toBeGreaterThanOrEqual(0);
    expect(layout.tailTop + layout.tailHeight).toBeLessThanOrEqual(DRAFT_CANVAS_HEIGHT);
  });

  it.each(ACCEPTED)('passes the standard for product $id', (fixture) => {
    const layout = computeSegmentedLayout(fixture);
    const verdict = assessDraft({
      buckleShare: fixture.buckleAspect / (fixture.buckleAspect + fixture.tailAspect),
      caseScale: layout.caseScale,
      lugGapRead: true,
    });
    expect(verdict.reasons).toEqual([]);
    expect(verdict.ok).toBe(true);
  });
});

describe('assessDraft', () => {
  const good = { buckleShare: 0.38, caseScale: 1, lugGapRead: true };

  it('rejects a render whose two halves came back the same length', () => {
    const verdict = assessDraft({ ...good, buckleShare: 0.49 });
    expect(verdict.ok).toBe(false);
    expect(verdict.reasons[0]).toContain('re-render');
  });

  it('rejects a render whose buckle side came back too short', () => {
    expect(assessDraft({ ...good, buckleShare: 0.28 }).ok).toBe(false);
  });

  it('never accepts an undersized watch', () => {
    // Shrinking the head is a rescue so a bad render still produces a picture; it is never a pass.
    const verdict = assessDraft({ ...good, caseScale: 0.9 });
    expect(verdict.ok).toBe(false);
    expect(verdict.reasons[0]).toContain('90%');
  });

  it('rejects a head whose lugs could not be found', () => {
    expect(assessDraft({ ...good, lugGapRead: false }).ok).toBe(false);
  });

  it('reports every reason at once, so one review pass sees the whole picture', () => {
    const verdict = assessDraft({ buckleShare: 0.5, caseScale: 0.86, lugGapRead: false });
    expect(verdict.reasons).toHaveLength(3);
  });
});
