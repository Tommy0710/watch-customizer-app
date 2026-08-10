import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import type { Combo } from './selectCombos';

// Builds a folder of side-by-side JPEGs — catalog photo on the left, PRO's assembled result on the
// right — one per training pair. Reviewing then needs no browser and no keyboard shortcuts: open
// the folder, flick through with Quick Look, drag the bad ones to the trash. collect-review.ts
// turns whatever survives back into approved.json.
//
// These are COPIES. Deleting one never touches the paid-for original in pairs/.

const OUT_DIR = path.join(process.cwd(), 'scripts/dataset/out');
const PAIR_DIR = path.join(OUT_DIR, 'pairs');
const PICK_DIR = path.join(OUT_DIR, 'review-pick');

const PANEL_W = 620;
const PANEL_H = 1100;
const LABEL_H = 44;

async function panel(buffer: Buffer): Promise<Buffer> {
    return sharp(buffer)
        .resize(PANEL_W, PANEL_H, { fit: 'contain', background: '#ffffff' })
        .toBuffer();
}

async function main() {
    const manifest: { id: string; productName: string; faceKey: string }[] =
        JSON.parse(await readFile(path.join(OUT_DIR, 'pairs-train.json'), 'utf8'));
    const { train }: { train: Combo[] } = JSON.parse(await readFile(path.join(OUT_DIR, 'combos.json'), 'utf8'));
    const productById = new Map(train.map((c) => [c.id, c.productId]));

    await rm(PICK_DIR, { recursive: true, force: true });
    await mkdir(PICK_DIR, { recursive: true });

    let written = 0;
    for (const [index, pair] of manifest.entries()) {
        const productId = productById.get(pair.id);
        if (!productId) continue;

        try {
            const [catalog, result] = await Promise.all([
                readFile(path.join(OUT_DIR, 'straps', `${productId}.png`)).catch(() =>
                    readFile(path.join(OUT_DIR, 'straps-clean', `${productId}.webp`)),
                ),
                readFile(path.join(PAIR_DIR, `${pair.id}_end.webp`)),
            ]);

            const [left, right] = await Promise.all([panel(catalog), panel(result)]);

            // A caption strip keeps the filename readable even when Quick Look scales the image
            // down, so a reviewer always knows which strap they are judging.
            const label = Buffer.from(
                `<svg width="${PANEL_W * 2}" height="${LABEL_H}">
                   <rect width="100%" height="100%" fill="#111"/>
                   <text x="16" y="29" font-family="system-ui,sans-serif" font-size="19" fill="#eee">
                     ${String(index + 1).padStart(2, '0')} / ${manifest.length} — ${pair.productName.replace(/[<&]/g, '')}
                   </text>
                 </svg>`,
            );

            const composed = await sharp({
                create: { width: PANEL_W * 2, height: PANEL_H + LABEL_H, channels: 3, background: { r: 255, g: 255, b: 255 } },
            })
                .composite([
                    { input: label, left: 0, top: 0 },
                    { input: left, left: 0, top: LABEL_H },
                    { input: right, left: PANEL_W, top: LABEL_H },
                ])
                .jpeg({ quality: 88 })
                .toBuffer();

            // Index first so Finder's name sort matches review order; the id is kept verbatim at
            // the end because collect-review.ts reads it back out of the filename.
            const name = `${String(index + 1).padStart(2, '0')}__${pair.id}.jpg`;
            await writeFile(path.join(PICK_DIR, name), composed);
            written++;
        } catch (err) {
            console.warn(`  ⚠️ skipping ${pair.id}: ${(err as Error).message.slice(0, 60)}`);
        }
    }

    console.log(`✅ ${written} side-by-side images → ${PICK_DIR}`);
    console.log('   Left = catalog photo, right = PRO result.');
    console.log('   Delete the ones you do NOT want, then run collect-review.ts');
    process.exit(0);
}

main().catch((err) => {
    console.error('❌', err);
    process.exit(1);
});
