// The serving contract for the HANDDN style LoRA.
// Keep deployment-specific values in environment variables, but keep safe defaults here so
// scripts, tests, and the route agree on the same model family and deterministic settings.

export const DEFAULT_LORA_MODEL = 'black-forest-labs/flux-dev-lora';
export const DEFAULT_LORA_SEED = 19826;
// 0.35 is the currently validated production point: it preserves dial fidelity while staying
// materially faster and less variable than 0.45 on the latest held-out run.
export const DEFAULT_LORA_PROMPT_STRENGTH = 0.35;
export const DEFAULT_LORA_SCALE = 1;
export const DEFAULT_LORA_STEPS = 30;
export const DEFAULT_LORA_PROMPT_SCHEMA = 'legacy';

export function getLoraModel(): string {
    return process.env.REPLICATE_LORA_MODEL?.trim() || DEFAULT_LORA_MODEL;
}

export function getLoraSeed(): number {
    const value = Number(process.env.REPLICATE_LORA_SEED ?? DEFAULT_LORA_SEED);
    return Number.isFinite(value) ? value : DEFAULT_LORA_SEED;
}

export function getLoraPromptStrength(): number {
    const value = Number(process.env.REPLICATE_LORA_PROMPT_STRENGTH ?? DEFAULT_LORA_PROMPT_STRENGTH);
    return Number.isFinite(value) ? value : DEFAULT_LORA_PROMPT_STRENGTH;
}

export function getLoraPromptSchema(): string {
    return process.env.REPLICATE_LORA_PROMPT_SCHEMA?.trim() || DEFAULT_LORA_PROMPT_SCHEMA;
}
