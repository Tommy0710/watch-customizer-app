import sharp from 'sharp';
import { generateText, Output } from 'ai';
import { z } from 'zod';

// Every strap photo in the handdn catalog is a staged square product shot: the strap lies
// diagonally across a coloured leather backdrop, a rolled fabric prop, or a second hide, and
// occupies only a third or so of the frame. Measured 2026-08-07 on a 30-product sample: 30 of 30
// were square-ish (aspect 0.75-1.35), none were tight vertical crops.
//
// That breaks the draft composite in two ways at once — the watch head gets positioned relative
// to the PHOTO's bounding box rather than the strap's, so it lands on the backdrop instead of the
// lugs; and the props end up baked into the image the model is asked to edit. Cropping to the
// strap first fixes both.
//
// Deliberately mirrors cropToWatchFace in /api/generate: same cheap vision model, same
// never-block contract. Any failure returns the original buffer, so this can only help.

const STRAP_DETECT_MODEL = 'openai/gpt-5-nano';

const strapBoxSchema = z.object({
    found: z.boolean().describe('true if a watch strap is visible in the photo'),
    x: z.number().min(0).max(1).describe('left edge of the strap, as a fraction of image width (0-1)'),
    y: z.number().min(0).max(1).describe('top edge of the strap, as a fraction of image height (0-1)'),
    width: z.number().min(0).max(1).describe('width of the strap bounding box, as a fraction of image width (0-1)'),
    height: z.number().min(0).max(1).describe('height of the strap bounding box, as a fraction of image height (0-1)'),
});

// A little slack so the tip and buckle are never clipped.
const PADDING_RATIO = 0.04;

export async function cropToStrap(strapBuffer: Buffer): Promise<Buffer> {
    try {
        const meta = await sharp(strapBuffer).metadata();
        const imgWidth = meta.width;
        const imgHeight = meta.height;
        if (!imgWidth || !imgHeight) return strapBuffer;

        const result = await generateText({
            model: STRAP_DETECT_MODEL,
            output: Output.object({ schema: strapBoxSchema }),
            messages: [
                {
                    role: 'user',
                    content: [
                        {
                            type: 'text',
                            text: "Locate the watch strap product in this photo — the narrow leather band with a metal buckle and/or punched holes, usually shown as two separate segments. Return a tight bounding box around only that strap. This photo is staged: exclude the background surface, any large leather hide or swatch used as a backdrop, any rolled fabric or cylinder prop the strap is draped over, and any shadow. If the strap lies diagonally, still return the smallest axis-aligned box containing all of it. If no strap is visible, set found to false.",
                        },
                        {
                            type: 'file',
                            data: strapBuffer,
                            mediaType: meta.format ? `image/${meta.format}` : 'image/jpeg',
                        },
                    ],
                },
            ],
        });

        const box = result.output;
        // A box covering nearly the whole frame means the model did not actually isolate anything;
        // cropping to it would be a no-op with extra risk, so keep the original.
        if (!box.found || box.width <= 0.05 || box.height <= 0.05 || (box.width > 0.95 && box.height > 0.95)) {
            return strapBuffer;
        }

        const paddedWidth = Math.min(1, box.width * (1 + PADDING_RATIO * 2));
        const paddedHeight = Math.min(1, box.height * (1 + PADDING_RATIO * 2));
        const paddedX = Math.max(0, box.x - box.width * PADDING_RATIO);
        const paddedY = Math.max(0, box.y - box.height * PADDING_RATIO);

        const left = Math.round(paddedX * imgWidth);
        const top = Math.round(paddedY * imgHeight);
        const width = Math.min(imgWidth - left, Math.round(paddedWidth * imgWidth));
        const height = Math.min(imgHeight - top, Math.round(paddedHeight * imgHeight));

        if (width < 32 || height < 32) return strapBuffer;

        return await sharp(strapBuffer).extract({ left, top, width, height }).png().toBuffer();
    } catch (error) {
        console.warn(
            '⚠️ Strap detection failed — using the full product photo instead:',
            error instanceof Error ? error.message : error,
        );
        return strapBuffer;
    }
}
