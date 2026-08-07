import { describe, it, expect } from 'vitest';
import { createSpendGuard, SpendExceededError } from './spendGuard';

describe('createSpendGuard', () => {
  it('accumulates charges', () => {
    const g = createSpendGuard({ maxSpend: 1, label: 'test' });
    g.charge(0.1, 'a');
    g.charge(0.25, 'b');
    expect(g.spent()).toBeCloseTo(0.35, 6);
    expect(g.remaining()).toBeCloseTo(0.65, 6);
  });

  it('throws before allowing a charge that would exceed the cap', () => {
    const g = createSpendGuard({ maxSpend: 1, label: 'test' });
    g.charge(0.9, 'a');
    expect(() => g.charge(0.2, 'b')).toThrow(SpendExceededError);
    expect(g.spent()).toBeCloseTo(0.9, 6); // rejected charge is not recorded
  });

  it('allows a charge that lands exactly on the cap', () => {
    const g = createSpendGuard({ maxSpend: 1, label: 'test' });
    expect(() => g.charge(1, 'a')).not.toThrow();
    expect(g.remaining()).toBe(0);
  });

  it('rejects a non-positive cap outright', () => {
    expect(() => createSpendGuard({ maxSpend: 0, label: 'test' })).toThrow();
    expect(() => createSpendGuard({ maxSpend: -1, label: 'test' })).toThrow();
  });

  it('names the label and both amounts in the error', () => {
    const g = createSpendGuard({ maxSpend: 0.5, label: 'generate-pairs' });
    try {
      g.charge(0.75, 'one PRO call');
      throw new Error('should have thrown');
    } catch (err) {
      expect(String(err)).toContain('generate-pairs');
      expect(String(err)).toContain('0.75');
      expect(String(err)).toContain('0.50');
    }
  });

  it('summarises spend for logging', () => {
    const g = createSpendGuard({ maxSpend: 2, label: 'test' });
    g.charge(0.5, 'a');
    expect(g.summary()).toContain('$0.50');
    expect(g.summary()).toContain('$2.00');
  });
});
