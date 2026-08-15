import { describe, expect, it } from 'vitest';
import { buildMaterialClause, classifyMaterial } from '@/lib/materialTaxonomy';

describe('runtime material taxonomy', () => {
  it('keeps specific exotic families ahead of broad matches', () => {
    const profile = classifyMaterial({ name: 'Black Double Hornback Alligator Leather Watch Strap' });
    expect(profile.family).toBe('hornback-alligator');
    expect(profile.surface).toBe('hornback');
  });

  it('emits an explicit material identity clause for material-v2 captions', () => {
    const profile = classifyMaterial({ name: 'Navy Nubuck Leather Watch Strap' });
    expect(buildMaterialClause(profile)).toContain('nubuck material');
    expect(buildMaterialClause(profile)).toContain('suede-nap surface');
  });
});
