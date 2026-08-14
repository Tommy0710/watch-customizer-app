// flux-dev-lora's `lora_weights` input schema documents a Replicate model reference as
// `<owner>/<model>` or `<owner>/<model>/<version>` — slash-separated. train-style.ts prints its
// result as `output.version`, which Replicate formats `<owner>/<model>:<version>` — colon-separated,
// the convention used elsewhere (predictions.create's `version` field). Copying that string straight
// into REPLICATE_LORA_WEIGHTS is the natural thing to do after a training run finishes, and it does
// not match the documented format. This normalises either form so pasting the training output
// directly always works, regardless of which separator it arrives with.
//
// Kept in its own file, separate from loraEngine.ts, because that module imports src/lib/aws.ts,
// which fails fast at import time when AWS env vars are unset — as it deliberately does outside a
// fully-configured environment. That makes loraEngine.ts unimportable from a plain test run, so this
// pure function needed a home with no such dependency to be testable at all.
export function normaliseLoraWeights(value: string | undefined): string | undefined {
    const trimmed = value?.trim();
    if (!trimmed) return undefined;

    // The model accepts direct URLs as well as Replicate model references. Keep URLs intact:
    // replacing the first colon in `https://...` would silently turn a valid weights URL into
    // an unusable model reference.
    if (/^[a-z][a-z\d+.-]*:\/\//i.test(trimmed) || trimmed.startsWith('data:')) {
        return trimmed;
    }

    // Training output commonly uses `owner/model:version`, while flux-dev-lora expects the
    // slash-separated form. Only rewrite that exact model-reference shape.
    return trimmed.replace(/^([^/\s:]+\/[^/\s:]+):([^\s]+)$/, '$1/$2');
}

// REPLICATE_LORA_WEIGHTS can also point at an object in our own S3 bucket, marked the same
// "s3://<key>" way loadFaceBuffer already recognises a library face pick in route.ts — reusing that
// convention rather than inventing a second one. When it does, loraEngine.ts fetches the object and
// hands Replicate a presigned URL directly, bypassing Replicate's own private-model weight
// resolution — the thing that broke account-wide on 2026-08-12/13 (see the comment on
// getPresignedUrl in aws.ts). Returns null for anything else, including undefined.
export function parseS3WeightsKey(value: string | undefined): string | null {
    const trimmed = value?.trim();
    return trimmed?.startsWith('s3://') ? trimmed.slice('s3://'.length) || null : null;
}
