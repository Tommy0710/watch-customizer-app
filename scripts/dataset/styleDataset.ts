// Re-exported so the dataset packer and /api/generate cannot drift apart. A LoRA is keyed to its
// trigger phrase, and serving text that differs from the training captions silently produces
// base-model output with no error at all — see src/lib/loraPrompt.ts.

export { TRIGGER_WORD, buildLoraPrompt as caption } from '../../src/lib/loraPrompt';
