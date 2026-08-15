import { describe, expect, it, afterEach } from 'vitest';
import {
  DEFAULT_LORA_MODEL,
  getLoraModel,
  getLoraPromptStrength,
  getLoraSeed,
  getLoraPromptSchema,
} from '@/lib/loraConfig';

const original = {
  model: process.env.REPLICATE_LORA_MODEL,
  seed: process.env.REPLICATE_LORA_SEED,
    strength: process.env.REPLICATE_LORA_PROMPT_STRENGTH,
    schema: process.env.REPLICATE_LORA_PROMPT_SCHEMA,
};

afterEach(() => {
  if (original.model === undefined) delete process.env.REPLICATE_LORA_MODEL;
  else process.env.REPLICATE_LORA_MODEL = original.model;
  if (original.seed === undefined) delete process.env.REPLICATE_LORA_SEED;
  else process.env.REPLICATE_LORA_SEED = original.seed;
  if (original.strength === undefined) delete process.env.REPLICATE_LORA_PROMPT_STRENGTH;
  else process.env.REPLICATE_LORA_PROMPT_STRENGTH = original.strength;
  if (original.schema === undefined) delete process.env.REPLICATE_LORA_PROMPT_SCHEMA;
  else process.env.REPLICATE_LORA_PROMPT_SCHEMA = original.schema;
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

  it('keeps legacy prompts unless material-aware serving is explicitly enabled', () => {
    delete process.env.REPLICATE_LORA_PROMPT_SCHEMA;
    expect(getLoraPromptSchema()).toBe('legacy');
    process.env.REPLICATE_LORA_PROMPT_SCHEMA = 'material-v2';
    expect(getLoraPromptSchema()).toBe('material-v2');
  });
});
