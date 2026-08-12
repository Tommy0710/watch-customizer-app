import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import Replicate from 'replicate';
import { splitStrapSegments } from '../../src/lib/strapSegments';
import { buildSegmentedDraft } from '../../src/lib/segmentedDraft';
import { measureStrapColour, compareStrapColour } from '../../src/lib/strapColour';
import { getObjectBuffer } from '../../src/lib/aws';
import { createSpendGuard, SpendExceededError } from '../lib/spendGuard';
import type { Combo } from './selectCombos';

// Does the LoRA hold a strap's colour on straps it has NEVER seen?
//
// This is the question the whole "one model, forever" claim rests on. The argument is that leather
// and colour ride in on the draft, not in the weights, so an unseen strap should come back as
// faithfully as a trained one. That is an argument; this measures it.
//
// The test is a comparison, not a threshold: unseen straps are scored against SEEN straps put
// through the identical path. If the model were memorising, seen straps would hold colour and
// unseen ones would drift toward whatever the training set was made of.
//
// It deliberately calls generateWithLora — the exact function /api/generate calls — rather than
// reimplementing the pipeline, so a pass here is a statement about production and not about a
// test harness.

const OUT_DIR = path.join(process.cwd(), 'scripts/dataset/out');
const CLEAN_DIR = path.join(OUT_DIR, 'straps-clean');
const RESULT_DIR = path.join(OUT_DIR, 'generalisation');

const UNIT_COST = 0.025; // published flux-dev price; flux-dev-lora bills the same base
const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });

function arg(name: string, fallback: string): string {
    const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : fallback;
}

type Candidate = { productId: number; productName: string; faceKey: string; seen: boolean };

// Rebuilds the exact draft generateWithLora fed the model. Both go through the same deterministic
// functions on the same two inputs, so this is that image, not an approximation of it.
async function buildDraftFor(productId: number, faceKey: string): Promise<Buffer> {
    const render = await readFile(path.join(CLEAN_DIR, `${productId}.webp`));
    const segments = await splitStrapSegments(render);
    if (!segments) throw new Error(`render ${productId} no longer splits`);
    const { buffer: faceBuffer } = await getObjectBuffer(faceKey);
    return buildSegmentedDraft(segments, faceBuffer);
}

async function main() {
    const wantUnseen = Number(arg('unseen', '14'));
    const wantSeen = Number(arg('seen', '6'));
    const maxSpend = Number(arg('max-spend', '0.60'));
    const guard = createSpendGuard({ maxSpend, label: 'generalisation-test' });

    // generateWithLora reads renders from S3 unless pointed at a folder. Only 13 straps are on S3;
    // the 74 on disk are what makes an unseen sample possible at all.
    //
    // Imported AFTER this assignment, not at the top of the file: loraEngine reads CLEAN_STRAP_DIR
    // into a module constant at load time, so a static import captures it before it is set and the
    // whole run silently falls back to S3. That is exactly what happened on the first attempt.
    process.env.CLEAN_STRAP_DIR = CLEAN_DIR;
    const { generateWithLora } = await import('../../src/lib/loraEngine');

    const { train, heldOut }: { train: Combo[]; heldOut: Combo[] } =
        JSON.parse(await readFile(path.join(OUT_DIR, 'combos.json'), 'utf8'));
    const byProduct = new Map<number, Combo>();
    for (const c of [...train, ...heldOut]) if (!byProduct.has(c.productId)) byProduct.set(c.productId, c);

    // What the model actually saw during training, by name — the pair manifests carry productName.
    const trainedNames = new Set<string>();
    for (const file of ['pairs-train.json', 'pairs-heldOut.json']) {
        try {
            const pairs = JSON.parse(await readFile(path.join(OUT_DIR, file), 'utf8')) as { productName: string }[];
            for (const p of pairs) trainedNames.add(p.productName);
        } catch { /* a missing manifest just means fewer known-seen straps */ }
    }

    const rendered = (await readdir(CLEAN_DIR)).filter((f) => f.endsWith('.webp')).map((f) => Number(f.replace('.webp', '')));
    const candidates: Candidate[] = [];
    for (const productId of rendered.sort((a, b) => a - b)) {
        const combo = byProduct.get(productId);
        if (!combo) continue;
        candidates.push({
            productId,
            productName: combo.productName,
            faceKey: combo.faceKey,
            seen: trainedNames.has(combo.productName),
        });
    }

    const unseen = candidates.filter((c) => !c.seen).slice(0, wantUnseen);
    const seen = candidates.filter((c) => c.seen).slice(0, wantSeen);
    const plan = [...unseen, ...seen];

    console.log(`${candidates.length} straps with a render · ${candidates.filter((c) => !c.seen).length} never trained on`);
    console.log(`testing ${unseen.length} unseen + ${seen.length} seen (control), cap $${maxSpend.toFixed(2)}\n`);

    await mkdir(RESULT_DIR, { recursive: true });
    const rows: Record<string, unknown>[] = [];

    for (const c of plan) {
        const tag = c.seen ? 'seen  ' : 'unseen';

        // Charged only once a call is actually going to be made. Charging before the stand-down
        // checks burnt the whole budget on skipped straps in the first run.
        try {
            guard.charge(UNIT_COST, `lora ${c.productId}`);
        } catch (err) {
            if (err instanceof SpendExceededError) { console.warn(`\n🛑 ${err.message}`); break; }
            throw err;
        }

        const { buffer: faceBuffer } = await getObjectBuffer(c.faceKey);
        const outcome = await generateWithLora({
            replicate,
            strapId: c.productId,
            faceBuffer,
            productName: c.productName,
        });

        if (!outcome.ok) {
            console.log(`  ⏭  ${tag} ${c.productId} — ${outcome.reason}`);
            rows.push({ ...c, status: 'stood down', reason: outcome.reason });
            continue;
        }

        const res = await fetch(outcome.imageUrl);
        if (!res.ok) {
            console.log(`  ⚠️ ${tag} ${c.productId} — could not download output (${res.status})`);
            rows.push({ ...c, status: 'download failed' });
            continue;
        }
        const result = Buffer.from(await res.arrayBuffer());
        await writeFile(path.join(RESULT_DIR, `${c.seen ? 'seen' : 'unseen'}-${c.productId}.webp`), result);

        // Measured against the DRAFT, not the strap-only render.
        //
        // The first run compared the render (strap alone on white) with the output (a whole watch),
        // so the metal case and dial added saturated pixels the source never had — and both straps
        // it condemned were near-greyscale, where that inflation matters most. The draft carries the
        // same case, so this is like for like: what the model was handed against what it returned.
        const draft = await buildDraftFor(c.productId, c.faceKey);
        const verdict = compareStrapColour(await measureStrapColour(draft), await measureStrapColour(result));

        console.log(
            `  ${verdict.ok ? '✅' : '❌'} ${tag} ${c.productId} ` +
            `hue ${verdict.hueDelta.toFixed(0)}° sat ${verdict.saturationGain.toFixed(2)}x ` +
            `${outcome.seconds.toFixed(1)}s — ${c.productName.slice(0, 46)}`,
        );
        rows.push({
            ...c, status: 'generated', ok: verdict.ok,
            hueDelta: verdict.hueDelta, saturationGain: verdict.saturationGain,
            reason: verdict.reason, seconds: outcome.seconds,
        });
    }

    await writeFile(path.join(RESULT_DIR, 'result.json'), JSON.stringify(rows, null, 2));

    const scored = rows.filter((r) => r.status === 'generated');
    for (const group of [false, true]) {
        const g = scored.filter((r) => r.seen === group);
        if (g.length === 0) continue;
        const pass = g.filter((r) => r.ok).length;
        const hues = g.map((r) => r.hueDelta as number).sort((a, b) => a - b);
        console.log(
            `\n${group ? 'SEEN  ' : 'UNSEEN'}: ${pass}/${g.length} hold colour · ` +
            `median hue drift ${hues[Math.floor(hues.length / 2)].toFixed(0)}° · worst ${hues[hues.length - 1].toFixed(0)}°`,
        );
    }
    console.log(`\n${guard.summary()} → ${RESULT_DIR}`);
    process.exit(0);
}

main().catch((err) => {
    console.error('❌', err instanceof Error ? err.message : err);
    process.exit(1);
});
