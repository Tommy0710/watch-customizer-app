import { readFile, writeFile, mkdir, rm, readdir, access } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { splitStrapSegments, buckleAsymmetry } from '../../src/lib/strapSegments';
import type { Combo } from './selectCombos';
import { describeError } from '../lib/reportError';

// A Finder review pass over the CLEAN STRAP RENDERS, upstream of the pair review.
//
// The pair review catches a bad generated watch, but by then the damage is already baked in: every
// pair built from a faulty render inherits its fault. PRO invents details when re-rendering a
// strap — it has produced a navy strap in brown, and a strap wearing a buckle on BOTH segments,
// which then dangles off the bottom of the assembled draft. One bad render can spoil several pairs.
//
// Both faults are obvious to a human in a second and unreliable to detect automatically (see the
// note on buckleAsymmetry), so this shows catalog photo beside render and lets the reviewer delete
// the bad ones. Most suspicious first, so the worst are dealt with while attention is freshest.

const OUT_DIR = path.join(process.cwd(), 'scripts/dataset/out');
const CLEAN_DIR = path.join(OUT_DIR, 'straps-clean');
const PICK_DIR = path.join(OUT_DIR, 'strap-pick');

const PANEL_W = 560;
const PANEL_H = 1000;
const LABEL_H = 44;

const exists = async (f: string) => { try { await access(f); return true; } catch { return false; } };

async function main() {
    const { train, heldOut }: { train: Combo[]; heldOut: Combo[] } =
        JSON.parse(await readFile(path.join(OUT_DIR, 'combos.json'), 'utf8'));
    const byProduct = new Map<number, Combo>();
    for (const c of [...train, ...heldOut]) if (!byProduct.has(c.productId)) byProduct.set(c.productId, c);

    const files = (await readdir(CLEAN_DIR)).filter((f) => f.endsWith('.webp'));

    const scored: { productId: number; combo: Combo; asymmetry: number }[] = [];
    for (const file of files) {
        const productId = Number(file.replace('.webp', ''));
        const combo = byProduct.get(productId);
        if (!combo) continue;
        const segments = await splitStrapSegments(await readFile(path.join(CLEAN_DIR, file)));
        scored.push({
            productId,
            combo,
            // Unsplittable renders are suspicious in their own right, so they sort to the front too.
            asymmetry: segments ? await buckleAsymmetry(segments) : 0,
        });
    }
    scored.sort((a, b) => a.asymmetry - b.asymmetry);

    await rm(PICK_DIR, { recursive: true, force: true });
    await mkdir(PICK_DIR, { recursive: true });

    let written = 0;
    for (const [index, item] of scored.entries()) {
        const cropPath = path.join(OUT_DIR, 'straps', `${item.productId}.png`);
        const source = (await exists(cropPath))
            ? await readFile(cropPath)
            : Buffer.from(await (await fetch(item.combo.strapImage)).arrayBuffer());
        const render = await readFile(path.join(CLEAN_DIR, `${item.productId}.webp`));

        const [left, right] = await Promise.all([
            sharp(source).resize(PANEL_W, PANEL_H, { fit: 'contain', background: '#ffffff' }).toBuffer(),
            sharp(render).resize(PANEL_W, PANEL_H, { fit: 'contain', background: '#ffffff' }).toBuffer(),
        ]);

        const label = Buffer.from(
            `<svg width="${PANEL_W * 2}" height="${LABEL_H}">
               <rect width="100%" height="100%" fill="#111"/>
               <text x="16" y="29" font-family="system-ui,sans-serif" font-size="18" fill="#eee">
                 ${String(index + 1).padStart(2, '0')}/${scored.length} — ${item.combo.productName.replace(/[<&]/g, '').slice(0, 58)}
                 · asymmetry ${item.asymmetry === Infinity ? '∞' : item.asymmetry.toFixed(2)}
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

        await writeFile(path.join(PICK_DIR, `${String(index + 1).padStart(2, '0')}__${item.productId}.jpg`), composed);
        written++;
    }

    console.log(`✅ ${written} strap renders → ${PICK_DIR}`);
    console.log('   Left = catalog photo, right = the studio render everything downstream is built from.');
    console.log('   Delete any where the render changed colour, changed the leather, or grew a SECOND buckle.');
    console.log('   Most suspicious are first. Then run collect-straps.ts');
    process.exit(0);
}

main().catch((err) => {
    console.error('❌', describeError(err));
    process.exit(1);
});
