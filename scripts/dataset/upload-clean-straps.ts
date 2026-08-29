import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { measureStrapColour, compareStrapColour } from '../../src/lib/strapColour';
import { prepareFace, checkCleanRender, type PreparedFace } from '../../src/lib/renderCheck';
import { getObjectBuffer, putCleanStrapRender } from '../../src/lib/aws';
import { getDatabaseProducts } from '../../src/lib/woocommerce';
import type { Combo } from './selectCombos';
import { describeError } from '../lib/reportError';

// Publishes the clean strap renders that meet the standard to S3, so /api/generate can reach them.
//
// Only the ones that pass. A render that fails is one the LoRA engine should stand down on, and the
// simplest way to guarantee that in production is for it not to be there — a missing render already
// falls back to PRO, which is the right answer for a strap we cannot assemble properly yet.
//
// Checks EVERY file in straps-clean, not just products in combos.json. The previous version looked
// each file up in combos.json's byProduct map and silently `continue`d — not counted as failed, just
// invisible — for anything not found. combos.json is the 96-product TRAINING sample; it was never a
// catalog of every product. Once render-clean-straps.ts gained --all/--sample to render straps from
// the full 443-product catalog, every one of those fell outside that map: 35 of 113 files on disk
// were skipped this way before this fix, having been checked against a single arbitrary face instead
// of the same multi-face standard used to accept them onto disk in the first place.
//
// On filling in the rest of the catalog: 443 straps are visible in the UI. The cheaper shape is to
// let demand decide — a strap with no render already serves the customer through PRO at no extra
// cost, so recording which straps got picked and rendering only those spreads the spend across
// straps that are actually wanted, and stops it recurring for every new product.

const OUT_DIR = path.join(process.cwd(), 'scripts/dataset/out');
const CLEAN_DIR = path.join(OUT_DIR, 'straps-clean');
const FACE_SAMPLE = 8;

async function loadColourSource(productId: number, catalogUrl: string): Promise<Buffer> {
    try {
        return await readFile(path.join(OUT_DIR, 'straps', `${productId}.png`));
    } catch {
        return Buffer.from(await (await fetch(catalogUrl)).arrayBuffer());
    }
}

async function main() {
    const dryRun = !process.argv.includes('--upload');
    const { train, heldOut }: { train: Combo[]; heldOut: Combo[] } =
        JSON.parse(await readFile(path.join(OUT_DIR, 'combos.json'), 'utf8'));
    const byProduct = new Map<number, Combo>();
    for (const c of [...train, ...heldOut]) if (!byProduct.has(c.productId)) byProduct.set(c.productId, c);

    // The full MongoDB catalog, not just the 96-product training sample, so a render from
    // render-clean-straps.ts --all still gets its real catalog photo for the colour check.
    const catalogImageById = new Map((await getDatabaseProducts()).map((p) => [p.id, p.image]));

    // Same sampling as render-clean-straps.ts: spread across the face library, skipping any face
    // whose lug gap cannot be read rather than letting it eat into every strap's pass margin.
    const faceKeys = [...new Set([...train, ...heldOut].map((c) => c.faceKey))];
    const step = Math.max(1, Math.floor(faceKeys.length / FACE_SAMPLE));
    const spread = faceKeys.filter((_, i) => i % step === 0);
    const faces: PreparedFace[] = [];
    const tried = new Set<string>();
    for (const key of [...spread, ...faceKeys]) {
        if (faces.length >= FACE_SAMPLE) break;
        if (tried.has(key)) continue;
        tried.add(key);
        const prepared = await prepareFace((await getObjectBuffer(key)).buffer);
        if (prepared.metrics.lugGap !== null) faces.push(prepared);
    }
    console.log(`judging every file in ${CLEAN_DIR} against ${faces.length} faces with a readable lug gap\n`);

    let passed = 0;
    let uploaded = 0;
    let failed = 0;
    let noCatalogMatch = 0;

    for (const file of (await readdir(CLEAN_DIR)).filter((f) => f.endsWith('.webp')).sort()) {
        const productId = Number(file.replace('.webp', ''));
        // combos.json's strapImage is preferred when present because it was fetched at
        // dataset-build time and may already be mirrored on disk under out/straps/; the full
        // catalog map is the fallback for the other 347 products, and only a product deleted from
        // WooCommerce since its render was made would miss both.
        const catalogUrl = byProduct.get(productId)?.strapImage ?? catalogImageById.get(productId);

        const render = await readFile(path.join(CLEAN_DIR, file));
        const name = byProduct.get(productId)?.productName || '';
        const isMultiColor = /tricolor|tri-color|duocolor|duo-color|triple|patina/i.test(name);
        let colour;
        if (catalogUrl && !isMultiColor) {
            const source = await loadColourSource(productId, catalogUrl);
            colour = compareStrapColour(await measureStrapColour(source), await measureStrapColour(render));
        } else if (!catalogUrl) {
            noCatalogMatch++;
        }

        const verdict = await checkCleanRender(render, faces, colour);
        if (!verdict.ok) {
            failed++;
            continue;
        }

        passed++;
        if (dryRun) {
            console.log(`  would upload ${productId} (${verdict.passes}/${verdict.checked} faces)`);
            continue;
        }
        const key = await putCleanStrapRender(productId, render);
        uploaded++;
        console.log(`  ✅ ${key} (${verdict.passes}/${verdict.checked} faces)`);
    }

    console.log(`\n${passed} meet the standard, ${failed} do not (those fall back to PRO in production)`);
    if (noCatalogMatch > 0) {
        console.log(`${noCatalogMatch} had no combos.json entry — judged on geometry alone, colour check skipped`);
    }
    if (dryRun) console.log('DRY RUN — pass --upload to actually write to S3');
    else console.log(`${uploaded} uploaded`);
    process.exit(0);
}

main().catch((err) => {
    console.error('❌', describeError(err));
    process.exit(1);
});
