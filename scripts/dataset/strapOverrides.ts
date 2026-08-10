import { readFile, access } from 'node:fs/promises';
import path from 'node:path';
import type { SplitStrap } from '../../src/lib/strapSegments';

// Applies the reviewer's per-strap corrections from strap-review.json.
//
// splitStrapSegments decides which half carries the buckle by counting metal, and that is a guess
// that a pale or heavily hardware-trimmed strap can fool. When it guesses wrong the whole watch
// comes out upside down — buckle below the case, tip above it. Rather than chase a better
// heuristic, the reviewer flags those straps while looking at the renders anyway, and this swaps
// the halves back. A one-line correction beats a cleverer detector that is still sometimes wrong.

const OUT_DIR = path.join(process.cwd(), 'scripts/dataset/out');

export async function loadReversedProducts(): Promise<Set<number>> {
    const file = path.join(OUT_DIR, 'strap-review.json');
    try {
        await access(file);
    } catch {
        return new Set();
    }
    const { reversed } = JSON.parse(await readFile(file, 'utf8')) as { reversed?: number[] };
    return new Set(reversed ?? []);
}

export function applyReversal(segments: SplitStrap, productId: number, reversed: Set<number>): SplitStrap {
    return reversed.has(productId)
        ? { buckle: segments.tail, tail: segments.buckle }
        : segments;
}
