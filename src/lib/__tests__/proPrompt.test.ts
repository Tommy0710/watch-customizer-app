import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { PRO_ASSEMBLY_PROMPT } from '@/lib/proPrompt';

describe('PRO_ASSEMBLY_PROMPT', () => {
  it('still contains the load-bearing instructions', () => {
    expect(PRO_ASSEMBLY_PROMPT).toContain('Image 1 shows the required composition');
    expect(PRO_ASSEMBLY_PROMPT).toContain('roughly 28-32% of its length');
    expect(PRO_ASSEMBLY_PROMPT).toContain('physically correct spring bar under the four lugs');
  });

  it('is byte-for-byte unchanged', () => {
    // Measured from the current route on 2026-08-07. Change these two values ONLY when
    // deliberately editing the prompt, and say so in the commit message.
    expect(PRO_ASSEMBLY_PROMPT).toHaveLength(3395);
    const digest = createHash('sha256').update(PRO_ASSEMBLY_PROMPT).digest('hex');
    expect(digest).toBe('7a3c700cd782fdcfa05f2c06fe65503e7ffb28e70ba45fd5bf08774e7005ae1b');
  });
});
