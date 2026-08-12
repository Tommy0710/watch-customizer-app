import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { splitStrapSegments } from '../../src/lib/strapSegments';
import { trimSpringBarPins, measureSegment } from '../../src/lib/segmentFit';
import { TARGET_BUCKLE_SHARE, MAX_BUCKLE_SHARE_DRIFT } from '../../src/lib/draftStandard';

// Why do most renders fail the standard for the same reason?
//
// The generalisation run stood 15 of 20 straps down, and every one of them said the same thing:
// the buckle half is ~50% of the strap instead of ~38%. Two explanations fit — the renderer draws
// the two halves the same length, or the splitter cuts them that way — and they call for opposite
// fixes (re-render, versus change code and re-render nothing). The splitter has no midpoint
// fallback, so this measures the actual distribution to see whether the failures cluster.

const OUT_DIR = path.join(process.cwd(), 'scripts/dataset/out');
const CLEAN_DIR = path.join(OUT_DIR, 'straps-clean');

async function main() {
    const files = (await readdir(CLEAN_DIR)).filter((f) => f.endsWith('.webp')).sort();
    const rows: {
        id: number; share: number;
        buckleAspect: number; tailAspect: number;
        buckleH: number; buckleLug: number; tailH: number; tailLug: number;
    }[] = [];

    for (const file of files) {
        const id = Number(file.replace('.webp', ''));
        const segments = await splitStrapSegments(await readFile(path.join(CLEAN_DIR, file)));
        if (!segments) { console.log(`${id}: does not split`); continue; }
        const [buckle, tail] = await Promise.all([
            measureSegment(await trimSpringBarPins(segments.buckle, 'bottom'), 'bottom'),
            measureSegment(await trimSpringBarPins(segments.tail, 'top'), 'top'),
        ]);
        rows.push({
            id,
            share: buckle.aspect / (buckle.aspect + tail.aspect),
            buckleAspect: buckle.aspect,
            tailAspect: tail.aspect,
            buckleH: buckle.height, buckleLug: buckle.lugWidth,
            tailH: tail.height, tailLug: tail.lugWidth,
        });
    }

    rows.sort((a, b) => a.share - b.share);
    const lo = TARGET_BUCKLE_SHARE - MAX_BUCKLE_SHARE_DRIFT;
    const hi = TARGET_BUCKLE_SHARE + MAX_BUCKLE_SHARE_DRIFT;

    // A histogram is the point: one clump means one cause, a smear means many.
    const bins = new Map<string, number>();
    for (const r of rows) {
        const b = (Math.floor(r.share * 20) / 20).toFixed(2);
        bins.set(b, (bins.get(b) ?? 0) + 1);
    }
    console.log(`\n${rows.length} renders split · accepted band ${lo.toFixed(2)}–${hi.toFixed(2)}\n`);
    for (const [bin, n] of [...bins.entries()].sort()) {
        const inBand = Number(bin) + 0.025 >= lo && Number(bin) + 0.025 <= hi;
        console.log(`${bin}  ${'█'.repeat(n).padEnd(30)} ${n}${inBand ? '  ← accepted' : ''}`);
    }

    const pass = rows.filter((r) => r.share >= lo && r.share <= hi);
    console.log(`\nin band: ${pass.length}/${rows.length}`);
    console.log(`median share ${rows[Math.floor(rows.length / 2)].share.toFixed(3)}`);

    // Which aspect moved? If the tail shortened, the render drew a stubby tail; if the buckle grew,
    // it drew an over-long buckle side. The two are different render faults.
    const inBand = pass.map((r) => r);
    const outBand = rows.filter((r) => r.share > hi);
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
    // aspect is height/lugWidth, so an inflated buckle aspect has two possible causes that need
    // opposite fixes: the render drew a longer buckle side (re-render), or measureSegment read the
    // lug end too narrow (a code fault, and no re-rendering would help). Printing the two terms
    // separately is what tells them apart.
    const report = (label: string, rs: typeof rows) => console.log(
        `${label}: buckle ${mean(rs.map((r) => r.buckleAspect)).toFixed(2)} ` +
        `(h ${Math.round(mean(rs.map((r) => r.buckleH)))} / lug ${Math.round(mean(rs.map((r) => r.buckleLug)))})  ` +
        `tail ${mean(rs.map((r) => r.tailAspect)).toFixed(2)} ` +
        `(h ${Math.round(mean(rs.map((r) => r.tailH)))} / lug ${Math.round(mean(rs.map((r) => r.tailLug)))})`,
    );
    report('in band ', inBand);
    report('too even', outBand);

    await writeFile(path.join(OUT_DIR, 'buckle-share-survey.json'), JSON.stringify(rows, null, 2));

    // A picture of the extremes, since the numbers cannot show whether the strap looks wrong.
    const worst = rows[rows.length - 1];
    const best = pass[Math.floor(pass.length / 2)];
    if (best && worst) {
        const panels = await Promise.all([best.id, worst.id].map(async (id) =>
            sharp(await readFile(path.join(CLEAN_DIR, `${id}.webp`)))
                .resize({ width: 420, height: 760, fit: 'contain', background: { r: 255, g: 255, b: 255 } })
                .toBuffer()));
        await sharp({ create: { width: 840, height: 760, channels: 3, background: { r: 255, g: 255, b: 255 } } })
            .composite([{ input: panels[0], left: 0, top: 0 }, { input: panels[1], left: 420, top: 0 }])
            .jpeg({ quality: 92 })
            .toFile(path.join(OUT_DIR, 'buckle-share-compare.jpg'));
        console.log(`\ncompare: ${best.id} (share ${best.share.toFixed(2)}) vs ${worst.id} (share ${worst.share.toFixed(2)}) → out/buckle-share-compare.jpg`);
    }
    process.exit(0);
}

main().catch((err) => { console.error('❌', err); process.exit(1); });
