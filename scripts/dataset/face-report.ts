import { readFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { measureFace } from '../../src/lib/segmentFit';
import { removeWhiteBackground } from '../../src/lib/removeWhiteBackground';
import { getObjectBuffer } from '../../src/lib/aws';
import type { Combo } from './selectCombos';
import { describeError } from '../lib/reportError';

// The standard has two independent ways to fail and only one of them is the strap's fault.
// "could not read the gap between the lugs" is a fact about the FACE photo, so it drags every
// strap down equally and no amount of re-rendering straps will move it.

const OUT_DIR = path.join(process.cwd(), 'scripts/dataset/out');

async function main() {
    const { train, heldOut }: { train: Combo[]; heldOut: Combo[] } =
        JSON.parse(await readFile(path.join(OUT_DIR, 'combos.json'), 'utf8'));
    const faces = [...new Map([...train, ...heldOut].map((c) => [c.faceKey, c])).values()];

    let readable = 0;
    const unreadable: string[] = [];
    for (const combo of faces) {
        const { buffer } = await getObjectBuffer(combo.faceKey);
        const prepared = await sharp(await removeWhiteBackground(buffer))
            .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 0 })
            .png().toBuffer();
        const m = await measureFace(prepared);
        if (m.lugGap === null) unreadable.push(combo.faceName); else readable++;
    }
    console.log(`${faces.length} faces: ${readable} readable, ${unreadable.length} with an unreadable lug gap`);
    for (const n of unreadable.slice(0, 15)) console.log(`   ✗ ${n}`);
    if (unreadable.length > 15) console.log(`   ... and ${unreadable.length - 15} more`);
    process.exit(0);
}
main().catch((e) => { console.error('❌', describeError(e)); process.exit(1); });
