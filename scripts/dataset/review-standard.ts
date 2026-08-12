import { readFile, writeFile, mkdir, rm, readdir } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { splitStrapSegments } from '../../src/lib/strapSegments';
import { buildSegmentedDraft, computeSegmentedLayout } from '../../src/lib/segmentedDraft';
import { trimSpringBarPins, measureSegment, measureFace } from '../../src/lib/segmentFit';
import { removeWhiteBackground } from '../../src/lib/removeWhiteBackground';
import { assessDraft } from '../../src/lib/draftStandard';
import { measureStrapColour, compareStrapColour } from '../../src/lib/strapColour';
import { getObjectBuffer } from '../../src/lib/aws';
import type { Combo } from './selectCombos';
import { describeError } from '../lib/reportError';

// Sign-off review: only the drafts that meet the standard, at full resolution.
//
// The review sheet scales each draft to a 520px panel, and that is how a broken seam got past me —
// downsampling averaged the step in the strap's edge away, and a reviewer opening the same sheet
// saw it immediately at full size. So nothing here is resized. Each draft is written at its native
// 832x1472, and the joins sheet crops the lug area 1:1, because every fault so far has shown up
// exactly where the strap meets the case.

const OUT_DIR = path.join(process.cwd(), 'scripts/dataset/out');
const CHECK_DIR = path.join(OUT_DIR, 'standard-check');

const JOIN_W = 420;
const JOIN_H = 300;
const LABEL_H = 26;


// Compared against the catalog photo, because the render is the thing that can drift — a black
// strap coming back brown is a fault a reviewer spots instantly and the geometry checks cannot.
async function strapColourVerdict(productId: number, catalogUrl: string, render: Buffer) {
    const crop = path.join(OUT_DIR, 'straps', `${productId}.png`);
    let source: Buffer;
    try {
        source = await readFile(crop);
    } catch {
        source = Buffer.from(await (await fetch(catalogUrl)).arrayBuffer());
    }
    const [a, b] = await Promise.all([measureStrapColour(source), measureStrapColour(render)]);
    return compareStrapColour(a, b);
}

async function main() {
    const { train, heldOut }: { train: Combo[]; heldOut: Combo[] } =
        JSON.parse(await readFile(path.join(OUT_DIR, 'combos.json'), 'utf8'));
    const byProduct = new Map<number, Combo>();
    for (const c of [...train, ...heldOut]) if (!byProduct.has(c.productId)) byProduct.set(c.productId, c);

    const files = (await readdir(path.join(OUT_DIR, 'straps-clean'))).filter((f) => f.endsWith('.webp')).sort();

    await rm(CHECK_DIR, { recursive: true, force: true });
    await mkdir(CHECK_DIR, { recursive: true });

    const joins: { id: number; name: string; crop: Buffer }[] = [];

    for (const file of files) {
        const productId = Number(file.replace('.webp', ''));
        const combo = byProduct.get(productId);
        if (!combo) continue;

        const segments = await splitStrapSegments(await readFile(path.join(OUT_DIR, 'straps-clean', file)));
        if (!segments) continue;

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
        const layout = computeSegmentedLayout({
            caseAspect: meta.height! / meta.width!,
            buckleAspect: buckle.aspect,
            tailAspect: tail.aspect,
            strapPerCase: face.lugGap === null ? undefined : face.lugGap / face.width,
        });
        const verdict = assessDraft({
            buckleShare: buckle.aspect / (buckle.aspect + tail.aspect),
            caseScale: layout.caseScale,
            lugGapRead: face.lugGap !== null,
            colour: await strapColourVerdict(productId, combo.strapImage, await readFile(path.join(OUT_DIR, 'straps-clean', file))),
        });
        if (!verdict.ok) continue;

        const draft = await buildSegmentedDraft(segments, faceBuffer);
        // Native size, no resampling: this is the file to open and zoom into.
        await writeFile(path.join(CHECK_DIR, `${productId}.png`), draft);

        const top = Math.max(0, Math.min(layout.caseTop - 70, 1472 - JOIN_H));
        const left = Math.max(0, Math.min(416 - Math.round(JOIN_W / 2), 832 - JOIN_W));
        joins.push({
            id: productId,
            name: combo.productName,
            crop: await sharp(draft).extract({ left, top, width: JOIN_W, height: JOIN_H }).toBuffer(),
        });
    }

    // One sheet of every lug join at 1:1, so they can be compared to each other rather than judged
    // one at a time — a fault that repeats is a code fault, one that does not is a bad render.
    const columns = 2;
    const rows = Math.ceil(joins.length / columns);
    const tiles = joins.flatMap((j, i) => {
        const x = (i % columns) * JOIN_W;
        const y = Math.floor(i / columns) * (JOIN_H + LABEL_H);
        return [
            {
                input: Buffer.from(
                    `<svg width="${JOIN_W}" height="${LABEL_H}"><rect width="100%" height="100%" fill="#111"/>
                       <text x="8" y="18" font-family="system-ui,sans-serif" font-size="14" fill="#eee">
                         ${j.id} — ${j.name.replace(/[<&]/g, '').slice(0, 44)}
                       </text></svg>`,
                ),
                left: x,
                top: y,
            },
            { input: j.crop, left: x, top: y + LABEL_H },
        ];
    });

    if (joins.length > 0) {
        await sharp({
            create: {
                width: JOIN_W * columns,
                height: rows * (JOIN_H + LABEL_H),
                channels: 3,
                background: { r: 255, g: 255, b: 255 },
            },
        })
            .composite(tiles)
            .jpeg({ quality: 95 })
            .toFile(path.join(CHECK_DIR, 'joins.jpg'));
    }

    console.log(`✅ ${joins.length} drafts meeting the standard → ${CHECK_DIR}`);
    console.log('   <id>.png  — full 832x1472, no resizing. Open and zoom; this is what the model gets.');
    console.log('   joins.jpg — every lug join at 1:1, side by side.');
    process.exit(0);
}

main().catch((err) => {
    console.error('❌', describeError(err));
    process.exit(1);
});
