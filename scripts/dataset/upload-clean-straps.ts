import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { splitStrapSegments } from '../../src/lib/strapSegments';
import { computeSegmentedLayout } from '../../src/lib/segmentedDraft';
import { trimSpringBarPins, measureSegment, measureFace } from '../../src/lib/segmentFit';
import { removeWhiteBackground } from '../../src/lib/removeWhiteBackground';
import { assessDraft } from '../../src/lib/draftStandard';
import { measureStrapColour, compareStrapColour } from '../../src/lib/strapColour';
import { getObjectBuffer, putCleanStrapRender } from '../../src/lib/aws';
import type { Combo } from './selectCombos';
import { describeError } from '../lib/reportError';

// Publishes the clean strap renders that meet the standard to S3, so /api/generate can reach them.
//
// Only the ones that pass. A render that fails is one the LoRA engine should stand down on, and the
// simplest way to guarantee that in production is for it not to be there — a missing render already
// falls back to PRO, which is the right answer for a strap we cannot assemble properly yet.
//
// On filling in the rest of the catalog: 443 straps are visible in the UI and rendering all of them
// costs roughly $35 in PRO calls, most of it on straps nobody may ever pick. The cheaper shape is to
// let demand decide — a strap with no render already serves the customer through PRO at no extra
// cost, so recording which straps got picked and rendering only those spreads the spend across
// straps that are actually wanted, and stops it recurring for every new product.

const OUT_DIR = path.join(process.cwd(), 'scripts/dataset/out');
const CLEAN_DIR = path.join(OUT_DIR, 'straps-clean');

async function main() {
    const dryRun = !process.argv.includes('--upload');
    const { train, heldOut }: { train: Combo[]; heldOut: Combo[] } =
        JSON.parse(await readFile(path.join(OUT_DIR, 'combos.json'), 'utf8'));
    const byProduct = new Map<number, Combo>();
    for (const c of [...train, ...heldOut]) if (!byProduct.has(c.productId)) byProduct.set(c.productId, c);

    let passed = 0;
    let uploaded = 0;
    let failed = 0;

    for (const file of (await readdir(CLEAN_DIR)).filter((f) => f.endsWith('.webp')).sort()) {
        const productId = Number(file.replace('.webp', ''));
        const combo = byProduct.get(productId);
        if (!combo) continue;

        const render = await readFile(path.join(CLEAN_DIR, file));
        const segments = await splitStrapSegments(render);
        if (!segments) { failed++; continue; }

        const { buffer: faceBuffer } = await getObjectBuffer(combo.faceKey);
        const prepared = await sharp(await removeWhiteBackground(faceBuffer))
            .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 0 })
            .png()
            .toBuffer();
        const meta = await sharp(prepared).metadata();
        const face = await measureFace(prepared);
        const [buckle, tail] = await Promise.all([
            measureSegment(await trimSpringBarPins(segments.buckle, 'bottom'), 'bottom'),
            measureSegment(await trimSpringBarPins(segments.tail, 'top'), 'top'),
        ]);
        const { caseScale } = computeSegmentedLayout({
            caseAspect: meta.height! / meta.width!,
            buckleAspect: buckle.aspect,
            tailAspect: tail.aspect,
            strapPerCase: face.lugGap === null ? undefined : face.lugGap / face.width,
        });

        let source: Buffer;
        try {
            source = await readFile(path.join(OUT_DIR, 'straps', `${productId}.png`));
        } catch {
            source = Buffer.from(await (await fetch(combo.strapImage)).arrayBuffer());
        }
        const [a, b] = await Promise.all([measureStrapColour(source), measureStrapColour(render)]);

        const verdict = assessDraft({
            buckleShare: buckle.aspect / (buckle.aspect + tail.aspect),
            caseScale,
            lugGapRead: face.lugGap !== null,
            colour: compareStrapColour(a, b),
        });
        if (!verdict.ok) { failed++; continue; }

        passed++;
        if (dryRun) {
            console.log(`  would upload ${productId} — ${combo.productName}`);
            continue;
        }
        const key = await putCleanStrapRender(productId, render);
        uploaded++;
        console.log(`  ✅ ${key} — ${combo.productName}`);
    }

    console.log(`\n${passed} meet the standard, ${failed} do not (those fall back to PRO in production)`);
    if (dryRun) console.log('DRY RUN — pass --upload to actually write to S3');
    else console.log(`${uploaded} uploaded`);
    process.exit(0);
}

main().catch((err) => {
    console.error('❌', describeError(err));
    process.exit(1);
});
