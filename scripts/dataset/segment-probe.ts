import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { splitStrapSegments } from '../../src/lib/strapSegments';
import { trimSpringBarPins, measureSegment } from '../../src/lib/segmentFit';
import { describeError } from '../lib/reportError';

// The survey says 16498's buckle half is as long as its tail; the picture says the two halves are
// proportioned like every other strap. One of them is wrong, and the answer decides whether 59
// renders need paying for again. This prints the dimensions at each stage of the split so the
// disagreement can be traced to a step rather than argued about.

const CLEAN_DIR = path.join(process.cwd(), 'scripts/dataset/out/straps-clean');
const OUT = path.join(process.cwd(), 'scripts/dataset/out/segment-probe');

async function probe(id: number) {
    const raw = await readFile(path.join(CLEAN_DIR, `${id}.webp`));
    const whole = await sharp(raw).metadata();
    const segments = await splitStrapSegments(raw);
    if (!segments) { console.log(`${id}: does not split`); return; }

    const b = await sharp(segments.buckle).metadata();
    const t = await sharp(segments.tail).metadata();
    const bTrimmed = await trimSpringBarPins(segments.buckle, 'bottom');
    const tTrimmed = await trimSpringBarPins(segments.tail, 'top');
    const bt = await sharp(bTrimmed).metadata();
    const tt = await sharp(tTrimmed).metadata();
    const bm = await measureSegment(bTrimmed, 'bottom');
    const tm = await measureSegment(tTrimmed, 'top');

    console.log(`\n── ${id}  canvas ${whole.width}x${whole.height}`);
    console.log(`   after split   buckle ${b.width}x${b.height}   tail ${t.width}x${t.height}`);
    console.log(`   after pins    buckle ${bt.width}x${bt.height}   tail ${tt.width}x${tt.height}`);
    console.log(`   measured      buckle h${bm.height} lug${bm.lugWidth} aspect ${bm.aspect.toFixed(2)}`);
    console.log(`                 tail   h${tm.height} lug${tm.lugWidth} aspect ${tm.aspect.toFixed(2)}`);
    console.log(`   share ${(bm.aspect / (bm.aspect + tm.aspect)).toFixed(3)}`);

    // The two halves as the code sees them, side by side at true relative scale.
    const H = Math.max(bt.height!, tt.height!);
    const canvas = sharp({ create: { width: bt.width! + tt.width! + 40, height: H, channels: 3, background: { r: 245, g: 245, b: 245 } } });
    await canvas
        .composite([
            { input: await sharp(bTrimmed).flatten({ background: '#fff' }).toBuffer(), left: 0, top: 0 },
            { input: await sharp(tTrimmed).flatten({ background: '#fff' }).toBuffer(), left: bt.width! + 40, top: 0 },
        ])
        .jpeg({ quality: 92 })
        .toFile(path.join(OUT, `${id}-halves.jpg`));
}

async function main() {
    await sharp({ create: { width: 1, height: 1, channels: 3, background: '#fff' } }).jpeg().toBuffer();
    await writeFile(path.join(process.cwd(), 'scripts/dataset/out/.keep'), '');
    const { mkdir } = await import('node:fs/promises');
    await mkdir(OUT, { recursive: true });
    for (const id of process.argv.filter((a) => /^\d+$/.test(a)).map(Number)) await probe(id);
    console.log(`\n→ ${OUT}`);
    process.exit(0);
}

main().catch((err) => { console.error('❌', describeError(err)); process.exit(1); });
