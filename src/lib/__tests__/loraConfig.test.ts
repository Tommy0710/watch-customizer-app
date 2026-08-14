import { describe, expect, it, afterEach } from 'vitest';
import {
  DEFAULT_LORA_MODEL,
  getLoraModel,
  getLoraPromptStrength,
  getLoraSeed,
} from '@/lib/loraConfig';

const original = {
  model: process.env.REPLICATE_LORA_MODEL,
  seed: process.env.REPLICATE_LORA_SEED,
  strength: process.env.REPLICATE_LORA_PROMPT_STRENGTH,
};

afterEach(() => {
  if (original.model === undefined) delete process.env.REPLICATE_LORA_MODEL;
  else process.env.REPLICATE_LORA_MODEL = original.model;
  if (original.seed === undefined) delete process.env.REPLICATE_LORA_SEED;
  else process.env.REPLICATE_LORA_SEED = original.seed;
  if (original.strength === undefined) delete process.env.REPLICATE_LORA_PROMPT_STRENGTH;
  else process.env.REPLICATE_LORA_PROMPT_STRENGTH = original.strength;
});

describe('LoRA serving configuration', () => {
  it('uses the stable default model when no override is configured', () => {
    delete process.env.REPLICATE_LORA_MODEL;
    expect(getLoraModel()).toBe(DEFAULT_LORA_MODEL);
  });

  it('allows an explicit model version or private model reference', () => {
    process.env.REPLICATE_LORA_MODEL = 'handdn/watch-lora/v2';
    expect(getLoraModel()).toBe('handdn/watch-lora/v2');
  });

  it('falls back when numeric overrides are invalid', () => {
    process.env.REPLICATE_LORA_SEED = 'not-a-number';
    process.env.REPLICATE_LORA_PROMPT_STRENGTH = 'not-a-number';
    expect(getLoraSeed()).toBe(19826);
    expect(getLoraPromptStrength()).toBe(0.35);
  });
});
