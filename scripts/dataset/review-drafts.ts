import { readFile, writeFile, mkdir, rm, readdir, access } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { splitStrapSegments } from '../../src/lib/strapSegments';
import { trimSpringBarPins, measureSegment, measureFace } from '../../src/lib/segmentFit';
import { removeWhiteBackground } from '../../src/lib/removeWhiteBackground';
import { assessDraft } from '../../src/lib/draftStandard';
import { measureStrapColour, compareStrapColour } from '../../src/lib/strapColour';
import { buildSegmentedDraft, computeSegmentedLayout } from '../../src/lib/segmentedDraft';
import sharpMeta from 'sharp';
import { getObjectBuffer } from '../../src/lib/aws';
import type { Combo } from './selectCombos';
import { describeError } from '../lib/reportError';

// Review the ASSEMBLED DRAFT, not the bare strap render.
//
// The first strap review asked the wrong question. Orientation — which end of each segment meets
// the case — is invisible in a side-by-side render of two loose straps; it only shows once they
// are stacked into a watch. Reviewers were being asked to judge something the picture could not
// show, so the flags that came back described the flat fallback drafts rather than any real
// reversal.
//
// This builds the draft the model will actually be handed and shows it beside the catalog photo.
// Costs nothing: the drafts are pure local image work.

const OUT_DIR = path.join(process.cwd(), 'scripts/dataset/out');
const PICK_DIR = path.join(OUT_DIR, 'draft-pick');
const REVERSED_DIR = path.join(PICK_DIR, 'DAO-NGUOC');
const NEARLY_DIR = path.join(PICK_DIR, 'GAN-DUNG');

const PANEL_W = 520;
const PANEL_H = 940;
const LABEL_H = 42;

const exists = async (f: string) => { try { await access(f); return true; } catch { return false; } };


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

    await rm(PICK_DIR, { recursive: true, force: true });
    await mkdir(REVERSED_DIR, { recursive: true });
    await mkdir(NEARLY_DIR, { recursive: true });

    let written = 0;
    let unsplittable = 0;
    let passed = 0;
    for (const [index, file] of files.entries()) {
        const productId = Number(file.replace('.webp', ''));
        const combo = byProduct.get(productId);
        if (!combo) continue;

        const raw = await splitStrapSegments(await readFile(path.join(OUT_DIR, 'straps-clean', file)));
        if (!raw) { unsplittable++; continue; }

        const segments = raw;
        const { buffer: face } = await getObjectBuffer(combo.faceKey);
        const draft = await buildSegmentedDraft(segments, face);

        // The draft now shows whatever balance the render has, so an over-long buckle side is a
        // render fault to catch here rather than something the layout quietly corrects. A real
        // strap's buckle side is around 38% of its total length.
        const [b, t] = await Promise.all([
            measureSegment(await trimSpringBarPins(segments.buckle, 'bottom'), 'bottom'),
            measureSegment(await trimSpringBarPins(segments.tail, 'top'), 'top'),
        ]);
        const buckleShare = Math.round((b.aspect / (b.aspect + t.aspect)) * 100);
        const prepared = await sharpMeta(await removeWhiteBackground(face))
            .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 0 }).png().toBuffer();
        const faceMeta = await sharpMeta(prepared).metadata();
        const facePoints = await measureFace(prepared);
        const { caseScale } = computeSegmentedLayout({
            caseAspect: faceMeta.height! / faceMeta.width!,
            buckleAspect: b.aspect,
            tailAspect: t.aspect,
            strapPerCase: facePoints.lugGap === null ? undefined : facePoints.lugGap / facePoints.width,
        });
        const verdict = assessDraft({
            buckleShare: b.aspect / (b.aspect + t.aspect),
            caseScale,
            lugGapRead: facePoints.lugGap !== null,
            colour: await strapColourVerdict(productId, combo.strapImage, await readFile(path.join(OUT_DIR, 'straps-clean', file))),
        });
        if (verdict.ok) passed++;
        const fit = verdict.ok ? ' · PASS' : ` · FAIL: ${verdict.reasons[0].slice(0, 64)}`;

        const cropPath = path.join(OUT_DIR, 'straps', `${productId}.png`);
        const source = (await exists(cropPath))
            ? await readFile(cropPath)
            : Buffer.from(await (await fetch(combo.strapImage)).arrayBuffer());

        const [left, right] = await Promise.all([
            sharp(source).resize(PANEL_W, PANEL_H, { fit: 'contain', background: '#ffffff' }).toBuffer(),
            sharp(draft).resize(PANEL_W, PANEL_H, { fit: 'contain', background: '#ffffff' }).toBuffer(),
        ]);

        const label = Buffer.from(
            `<svg width="${PANEL_W * 2}" height="${LABEL_H}">
               <rect width="100%" height="100%" fill="#111"/>
               <text x="16" y="28" font-family="system-ui,sans-serif" font-size="17" fill="#eee">
                 ${String(index + 1).padStart(2, '0')}/${files.length} — ${combo.productName.replace(/[<&]/g, '').slice(0, 52)} · buckle side ${buckleShare}% (real ≈38%)${fit}
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

        await writeFile(path.join(PICK_DIR, `${String(index + 1).padStart(2, '0')}__${productId}.jpg`), composed);
        written++;
    }

    console.log(`✅ ${written} assembled drafts → ${PICK_DIR}`);
    if (unsplittable) console.warn(`   ⚠️ ${unsplittable} renders could not be split and were skipped`);
    console.log(`   ${passed}/${written} meet the standard (src/lib/draftStandard.ts); the rest name their fault on the label.
   Left = catalog photo, right = the watch the model will be asked to finish.`);
    console.log('   DAO-NGUOC = upside down · GAN-DUNG = close but not right · delete = wrong colour or leather.');
    process.exit(0);
}

main().catch((err) => { console.error('❌', describeError(err)); process.exit(1); });
