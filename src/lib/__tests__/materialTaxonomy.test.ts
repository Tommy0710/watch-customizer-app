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
    const clause = buildMaterialClause(profile);
    expect(clause).toContain('suede/nubuck');
    expect(clause).toContain('velvety nap');
  });

  it('classifies alligator with specialized scale tiles and groove prompt clause', () => {
    const profile = classifyMaterial({ name: 'Matte Black Alligator Leather Watch Strap' });
    expect(profile.family).toBe('alligator');
    const clause = buildMaterialClause(profile);
    expect(clause).toContain('alligator/crocodile');
    expect(clause).toContain('scale tiles');
  });

  it('classifies stingray with specialized pearl granules surface and rich prompt clause', () => {
    const profile = classifyMaterial({ name: 'Black Pearl Stingray Leather Watch Strap' });
    expect(profile.family).toBe('stingray');
    expect(profile.surface).toBe('stingray-pearl-granules');
    const clause = buildMaterialClause(profile);
    expect(clause).toContain('genuine stingray leather');
    expect(clause).toContain('tight pebbled texture');
  });
});
