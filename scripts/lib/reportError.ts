// Re-exported from src/lib so the redaction logic has one definition, not one per copy. It was
// duplicated here first (dataset scripts predate the app-side leak this fixed), then the same bug
// turned up in src/app/api/generate/route.ts and got fixed there directly instead of drifting.
export { redact, describeError } from '../../src/lib/redactError';
