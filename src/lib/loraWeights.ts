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
    return value?.includes(':') ? value.replace(':', '/') : value;
}
