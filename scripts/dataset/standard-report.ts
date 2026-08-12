import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { splitStrapSegments } from '../../src/lib/strapSegments';
import { computeSegmentedLayout } from '../../src/lib/segmentedDraft';
import { trimSpringBarPins, measureSegment, measureFace } from '../../src/lib/segmentFit';
import { removeWhiteBackground } from '../../src/lib/removeWhiteBackground';
import { assessDraft } from '../../src/lib/draftStandard';
import { measureStrapColour, compareStrapColour } from '../../src/lib/strapColour';
import { getObjectBuffer } from '../../src/lib/aws';
import type { Combo } from './selectCombos';
import { describeError } from '../lib/reportError';

// Which straps can actually be served, by name, and how many strap-x-face pairs that comes to.
//
// The standard depends on the face as well as the strap — case size and the gap between the lugs
// both feed it — so a strap is only settled once it has been checked against every face, not one.
// A strap that passes on some faces and fails on others is the interesting case and is reported
// separately rather than folded into a total.

const OUT_DIR = path.join(process.cwd(), 'scripts/dataset/out');
const dirArg = process.argv.find((a) => a.startsWith('--dir='));
const CLEAN_DIR = dirArg ? dirArg.slice('--dir='.length) : path.join(OUT_DIR, 'straps-clean');

async function main() {
    const { train, heldOut }: { train: Combo[]; heldOut: Combo[] } =
        JSON.parse(await readFile(path.join(OUT_DIR, 'combos.json'), 'utf8'));
    const all = [...train, ...heldOut];

    const byProduct = new Map<number, Combo>();
    for (const c of all) if (!byProduct.has(c.productId)) byProduct.set(c.productId, c);
    const faceKeys = [...new Set(all.map((c) => c.faceKey))];

    // Faces are prepared once and reused across every strap — the same work per strap otherwise.
    const faces = await Promise.all(faceKeys.map(async (key) => {
        const { buffer } = await getObjectBuffer(key);
        const prepared = await sharp(await removeWhiteBackground(buffer))
            .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 0 })
            .png()
            .toBuffer();
        const meta = await sharp(prepared).metadata();
        return { key, metrics: await measureFace(prepared), caseAspect: meta.height! / meta.width! };
    }));

    const files = (await readdir(CLEAN_DIR)).filter((f) => f.endsWith('.webp')).sort();
    const rows: { id: number; name: string; passes: number; total: number; reason?: string }[] = [];

    for (const file of files) {
        const id = Number(file.replace('.webp', ''));
        const combo = byProduct.get(id);
        if (!combo) continue;
        const render = await readFile(path.join(CLEAN_DIR, file));

        const segments = await splitStrapSegments(render);
        if (!segments) { rows.push({ id, name: combo.productName, passes: 0, total: faces.length, reason: 'does not split into two segments' }); continue; }

        const [buckle, tail] = await Promise.all([
            measureSegment(await trimSpringBarPins(segments.buckle, 'bottom'), 'bottom'),
            measureSegment(await trimSpringBarPins(segments.tail, 'top'), 'top'),
        ]);
        const buckleShare = buckle.aspect / (buckle.aspect + tail.aspect);

        // Colour is judged against the catalog photo, once per strap — it does not vary by face.
        let source: Buffer;
        try { source = await readFile(path.join(OUT_DIR, 'straps', `${id}.png`)); }
        catch { source = Buffer.from(await (await fetch(combo.strapImage)).arrayBuffer()); }
        const colour = compareStrapColour(await measureStrapColour(source), await measureStrapColour(render));

        let passes = 0;
        let firstReason: string | undefined;
        for (const face of faces) {
            const { caseScale } = computeSegmentedLayout({
                caseAspect: face.caseAspect,
                buckleAspect: buckle.aspect,
                tailAspect: tail.aspect,
                strapPerCase: face.metrics.lugGap === null ? undefined : face.metrics.lugGap / face.metrics.width,
            });
            const verdict = assessDraft({ buckleShare, caseScale, lugGapRead: face.metrics.lugGap !== null, colour });
            if (verdict.ok) passes++;
            else firstReason ??= verdict.reasons[0];
        }
        rows.push({ id, name: combo.productName, passes, total: faces.length, reason: passes === faces.length ? undefined : firstReason });
    }

    const full = rows.filter((r) => r.passes === r.total);
    const partial = rows.filter((r) => r.passes > 0 && r.passes < r.total);
    const none = rows.filter((r) => r.passes === 0);
    const pairs = rows.reduce((sum, r) => sum + r.passes, 0);

    console.log(`\n${CLEAN_DIR}`);
    console.log(`${rows.length} straps x ${faces.length} faces = ${rows.length * faces.length} possible pairs`);
    console.log(`${pairs} pairs meet the standard\n`);

    console.log(`✅ ${full.length} straps pass on every face:`);
    for (const r of full) console.log(`   ${r.id}  ${r.name}`);

    if (partial.length > 0) {
        console.log(`\n⚠️  ${partial.length} straps pass on some faces only:`);
        for (const r of partial) console.log(`   ${r.id}  ${r.name}  (${r.passes}/${r.total}) — ${r.reason}`);
    }

    console.log(`\n❌ ${none.length} straps fail on every face:`);
    for (const r of none) console.log(`   ${r.id}  ${r.name}  — ${r.reason}`);

    // Named after the folder surveyed. A trial run used to overwrite the live report, which then
    // reported every strap outside the trial as unknown — and reading that as "these renders no
    // longer meet the standard" is a mistake worth designing out rather than remembering.
    const suffix = path.basename(CLEAN_DIR) === 'straps-clean' ? '' : `-${path.basename(CLEAN_DIR)}`;
    await writeFile(path.join(OUT_DIR, `standard-report${suffix}.json`), JSON.stringify(rows, null, 2));
    process.exit(0);
}

main().catch((err) => { console.error('❌', describeError(err)); process.exit(1); });
