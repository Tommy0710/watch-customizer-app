// The text the LoRA was trained on, and the text it must be served with.
//
// A LoRA is keyed to its trigger phrase. Serving it a prompt that differs from the training
// captions — even by a word — silently produces base-model output with no error at all, which is
// the worst kind of bug: everything works, the result is just quietly wrong. So this lives in one
// place that both the dataset packer and /api/generate import, rather than being written twice.

// A non-word so it cannot collide with anything FLUX already knows.
export const TRIGGER_WORD = 'HNDDNW';

// Describes what VARIES between images (which strap). What stays constant — the assembly, the
// studio framing — is what the trigger word comes to mean, so it is deliberately left implicit
// rather than repeated in every caption.
export function buildLoraPrompt(productName: string): string {
    // Product names already end in "... Leather Watch Strap", so the material is in the name;
    // appending "leather strap" produced "Navy Pueblo Leather leather strap".
    const strap = productName
        .replace(/\s*watch\s+strap\s*$/i, '')
        .replace(/\s+/g, ' ')
        .trim();
    return `${TRIGGER_WORD} a wristwatch fitted with a ${strap} strap, photographed top-down as a studio product shot on a plain white background`;
}
