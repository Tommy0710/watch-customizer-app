import { readFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

// The retry loop assumed the duplicated render was a roll of the dice. Four seeds on 25544 returned
// 51%, 51%, 51%, 50% — near-identical, which is not what randomness looks like. If the fault tracks
// the SOURCE photo instead, no number of retries can help and the whole approach is wrong.

const OUT = path.join(process.cwd(), 'scripts/dataset/out');

async function main() {
    const ids = process.argv.filter((a) => /^\d+$/.test(a)).map(Number);
    const panels: Buffer[] = [];
    for (const id of ids) {
        for (const file of [path.join(OUT, 'straps', `${id}.png`), path.join(OUT, 'straps-clean', `${id}.webp`)]) {
            try {
                panels.push(await sharp(await readFile(file))
                    .resize({ width: 300, height: 620, fit: 'contain', background: { r: 255, g: 255, b: 255 } })
                    .toBuffer());
            } catch { panels.push(await sharp({ create: { width: 300, height: 620, channels: 3, background: { r: 230, g: 230, b: 230 } } }).png().toBuffer()); }
        }
    }
    await sharp({ create: { width: 300 * panels.length, height: 620, channels: 3, background: { r: 255, g: 255, b: 255 } } })
        .composite(panels.map((input, i) => ({ input, left: i * 300, top: 0 })))
        .jpeg({ quality: 92 })
        .toFile(path.join(OUT, 'source-vs-render.jpg'));
    console.log(`pairs (source, render) for ${ids.join(', ')} → out/source-vs-render.jpg`);
    process.exit(0);
}
main().catch((e) => { console.error('❌', e); process.exit(1); });
