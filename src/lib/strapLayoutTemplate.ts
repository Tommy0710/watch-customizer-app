import sharp from 'sharp';

// A picture of the layout a clean strap render has to have, to be handed to the renderer alongside
// the catalog photo.
//
// Words were not enough. CLEAN_STRAP_PROMPT has asked for "the buckle segment must be clearly
// shorter than the holes segment" all along, and 54 of 74 renders came back with the two halves
// the same length. The same prompt asks for the pieces stacked one above the other, and every
// render put them side by side instead. Two explicit instructions, both ignored — so the layout is
// something to SHOW rather than describe. That is the same move that fixed the assembly step, where
// handing FLUX a draft image beat describing where the watch head goes.
//
// Proportions come from the renders that were accepted on review, not from taste: their buckle half
// measures 3.96 in height-over-lug-width against the tail's 5.99, so the buckle piece runs about
// two thirds of the tail's length at equal width.

export const TEMPLATE_WIDTH = 832;
export const TEMPLATE_HEIGHT = 1472;

const PIECE_WIDTH_RATIO = 0.24; // of canvas width, per piece
const TAIL_LENGTH_RATIO = 0.94; // of canvas height
const BUCKLE_TO_TAIL_LENGTH = 2 / 3;
const TAPER = 0.28; // how much each piece narrows toward its far end
const TOP_MARGIN_RATIO = 0.03;

// Mid grey on white: unmistakable as shape, and carrying no colour of its own to bleed into a
// render whose whole job is reproducing the strap's real colour.
const INK = 128;

function paintPiece(
    px: Buffer,
    canvasWidth: number,
    centreX: number,
    top: number,
    length: number,
    halfWidth: number,
): void {
    for (let y = top; y < top + length; y++) {
        const along = (y - top) / length;
        const half = halfWidth * (1 - TAPER * along);
        for (let x = Math.round(centreX - half); x < Math.round(centreX + half); x++) {
            const o = (y * canvasWidth + x) * 3;
            px[o] = INK;
            px[o + 1] = INK;
            px[o + 2] = INK;
        }
    }
}

export async function buildStrapLayoutTemplate(): Promise<Buffer> {
    const px = Buffer.alloc(TEMPLATE_WIDTH * TEMPLATE_HEIGHT * 3, 255);

    const halfWidth = (TEMPLATE_WIDTH * PIECE_WIDTH_RATIO) / 2;
    const top = Math.round(TEMPLATE_HEIGHT * TOP_MARGIN_RATIO);
    const tailLength = Math.round(TEMPLATE_HEIGHT * TAIL_LENGTH_RATIO);
    const buckleLength = Math.round(tailLength * BUCKLE_TO_TAIL_LENGTH);

    // Side by side, both hanging from the same top edge — the arrangement every real render has
    // used, rather than the stacked one the prompt kept asking for and never getting.
    paintPiece(px, TEMPLATE_WIDTH, TEMPLATE_WIDTH * 0.3, top, buckleLength, halfWidth);
    paintPiece(px, TEMPLATE_WIDTH, TEMPLATE_WIDTH * 0.7, top, tailLength, halfWidth);

    return sharp(px, { raw: { width: TEMPLATE_WIDTH, height: TEMPLATE_HEIGHT, channels: 3 } })
        .png()
        .toBuffer();
}

// The share the template encodes, for a test to assert against the standard rather than against a
// number copied by hand into two places.
export const TEMPLATE_BUCKLE_SHARE = BUCKLE_TO_TAIL_LENGTH / (1 + BUCKLE_TO_TAIL_LENGTH);
