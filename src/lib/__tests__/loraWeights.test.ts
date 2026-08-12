import { describe, it, expect } from 'vitest';
import { normaliseLoraWeights } from '@/lib/loraWeights';

describe('normaliseLoraWeights', () => {
  it('converts the colon form training prints to the slash form flux-dev-lora expects', () => {
    // The exact mistake this fixes: pasting output.version from a training result straight into
    // REPLICATE_LORA_WEIGHTS. Replicate formats that field owner/model:version.
    expect(normaliseLoraWeights('tommy0710/watch-lora:253f2b51462e63631db43d2436589286825db0a60946ae2af6b9883f81554318'))
      .toBe('tommy0710/watch-lora/253f2b51462e63631db43d2436589286825db0a60946ae2af6b9883f81554318');
  });

  it('leaves an already-correct slash form untouched', () => {
    expect(normaliseLoraWeights('tommy0710/watch-lora/79498e5efeeadfa027b6b90245a9ba8')).toBe(
      'tommy0710/watch-lora/79498e5efeeadfa027b6b90245a9ba8',
    );
  });

  it('leaves a bare owner/model reference (no version pin) untouched', () => {
    expect(normaliseLoraWeights('tommy0710/watch-lora')).toBe('tommy0710/watch-lora');
  });

  it('passes undefined through so the caller sees "not set" rather than a crash', () => {
    expect(normaliseLoraWeights(undefined)).toBeUndefined();
  });
});
