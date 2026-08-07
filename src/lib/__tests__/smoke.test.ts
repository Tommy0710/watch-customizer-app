import { describe, it, expect } from 'vitest';
import { classifyStrap } from '@/lib/strapProfile';

describe('test harness', () => {
  it('resolves the @/ alias and runs existing library code', () => {
    const profile = classifyStrap('Test Strap', ['Classic Watch Straps'], []);
    expect(profile).toBeTypeOf('object');
  });
});
