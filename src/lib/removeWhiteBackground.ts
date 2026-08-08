import sharp from 'sharp';

// Face-library photos are watch heads shot on a white studio background. Pasting one onto a strap
// as-is leaves an opaque white rectangle sitting over the leather — see the pilot's first drafts.
// That box is pure noise the model has to learn to remove, on top of the assembly it is actually
// meant to learn, so stripping it here makes the training target smaller and cleaner.
//
// A global "white pixels become transparent" threshold would punch holes through white dials,
// silver hands, and light indices. Instead this floods inward from the border and only clears
// background pixels reachable from the edge, so an enclosed white dial stays intact.
//
// Pure pixel work — no network, no external service, deterministic.

// How far from pure white a pixel can be and still count as background.
const DEFAULT_TOLERANCE = 26;

export async function removeWhiteBackground(
    input: Buffer,
    tolerance: number = DEFAULT_TOLERANCE,
): Promise<Buffer> {
    const { data, info } = await sharp(input)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });

    const { width, height, channels } = info;
    const pixels = new Uint8ClampedArray(data);

    const isBackgroundish = (index: number): boolean => {
        const offset = index * channels;
        return (
            pixels[offset] >= 255 - tolerance &&
            pixels[offset + 1] >= 255 - tolerance &&
            pixels[offset + 2] >= 255 - tolerance
        );
    };

    // Iterative flood fill from every border pixel. An explicit stack rather than recursion —
    // a 1000x1000 background would blow the call stack.
    const visited = new Uint8Array(width * height);
    const stack: number[] = [];

    for (let x = 0; x < width; x++) {
        stack.push(x, (height - 1) * width + x);
    }
    for (let y = 0; y < height; y++) {
        stack.push(y * width, y * width + (width - 1));
    }

    while (stack.length > 0) {
        const index = stack.pop()!;
        if (visited[index]) continue;
        visited[index] = 1;
        if (!isBackgroundish(index)) continue;

        pixels[index * channels + 3] = 0; // clear alpha

        const x = index % width;
        const y = (index - x) / width;
        if (x > 0) stack.push(index - 1);
        if (x < width - 1) stack.push(index + 1);
        if (y > 0) stack.push(index - width);
        if (y < height - 1) stack.push(index + width);
    }

    return sharp(Buffer.from(pixels.buffer), { raw: { width, height, channels } })
        .png()
        .toBuffer();
}
