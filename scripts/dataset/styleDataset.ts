// Shared constants for the style-LoRA path. Kept apart from pack-style-dataset.ts because that
// file is a CLI that runs and then calls process.exit — importing a constant from it silently
// executed the packer and killed the caller before it did any work.

// A non-word so it cannot collide with anything FLUX already knows.
export const TRIGGER_WORD = 'HNDDNW';

// Captions describe what VARIES between images (which strap). What stays constant — the assembly,
// the studio framing — is what the trigger word comes to mean, so it is deliberately left implicit
// rather than repeated in every caption.
export function caption(productName: string): string {
    // Product names already end in "... Leather Watch Strap", so the material is in the name;
    // appending "leather strap" produced "Navy Pueblo Leather leather strap".
    const strap = productName
        .replace(/\s*watch\s+strap\s*$/i, '')
        .replace(/\s+/g, ' ')
        .trim();
    return `${TRIGGER_WORD} a wristwatch fitted with a ${strap} strap, photographed top-down as a studio product shot on a plain white background`;
}
