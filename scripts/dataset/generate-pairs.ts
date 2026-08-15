import { mkdir, writeFile, readFile, access } from 'node:fs/promises';
import path from 'node:path';
import Replicate from 'replicate';
import sharp from 'sharp';
import { splitStrapSegments } from '../../src/lib/strapSegments';
import { trimSpringBarPins, measureSegment, measureFace } from '../../src/lib/segmentFit';
import { computeSegmentedLayout } from '../../src/lib/segmentedDraft';
import { removeWhiteBackground } from '../../src/lib/removeWhiteBackground';
import { assessDraft } from '../../src/lib/draftStandard';
import { measureStrapColour, compareStrapColour } from '../../src/lib/strapColour';
import { buildSegmentedDraft } from '../../src/lib/segmentedDraft';
import { PRO_ASSEMBLY_PROMPT } from '../../src/lib/proPrompt';
import { getObjectBuffer } from '../../src/lib/aws';
import { classifyStrap, buildStrapProfileClause } from '../../src/lib/strapProfile';
import { createSpendGuard, SpendExceededError } from '../lib/spendGuard';
import type { SplitStrap } from '../../src/lib/strapSegments';
import type { Combo } from './selectCombos';
import { describeError } from '../lib/reportError';

const OUT_DIR = path.join(process.cwd(), 'scripts/dataset/out');
const PAIR_DIR = path.join(OUT_DIR, 'pairs');

// Replicate publishes no price for flux-2-pro anywhere reachable — not the pricing page, not the
// API, not response headers (checked directly, 2026-08-12). $0.03/$0.06 sat here as "deliberate
// over-estimates" for months without ever being checked against a real invoice. They were not
// over-estimates: reconstructed from an account balance that went from $20 to $1 over 113 real
// calls, the true price is closer to $0.17/call regardless of resolution. That gap is why the
// guard's "$X of $Y" never once matched what Replicate actually charged. $0.20 is the new
// deliberate over-estimate — verify against the billing dashboard before trusting it either.
const ASSUMED_COST = { '1 MP': 0.20, '2 MP': 0.20 } as const;

const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });

function arg(name: string, fallback: string): string {
    const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : fallback;
}
function flag(name: string): boolean {
    return process.argv.includes(`--${name}`);
}

// The same judgement the review sheet shows, applied before any money is spent.
async function assessSegments(segments: SplitStrap, faceBuffer: Buffer, strapBuffer: Buffer, catalogUrl: string, productId: number) {
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
        source = Buffer.from(await (await fetch(catalogUrl)).arrayBuffer());
    }
    const [sourceColour, renderColour] = await Promise.all([
        measureStrapColour(source),
        measureStrapColour(strapBuffer),
    ]);

    return assessDraft({
        buckleShare: buckle.aspect / (buckle.aspect + tail.aspect),
        caseScale,
        lugGapRead: face.lugGap !== null,
        colour: compareStrapColour(sourceColour, renderColour),
    });
}

async function exists(file: string): Promise<boolean> {
    try { await access(file); return true; } catch { return false; }
}

// Prefers the clean studio render (vertical, isolated, white background) over the cropped catalog
// photo. That choice is what keeps the before/after difference down to "attach the watch head"
// instead of "reorient the strap, erase the props, and attach the watch head".
async function loadPreparedStrap(productId: number, fallbackUrl: string): Promise<Buffer> {
    const clean = path.join(OUT_DIR, 'straps-clean', `${productId}.webp`);
    if (await exists(clean)) return readFile(clean);

    const cropped = path.join(OUT_DIR, 'straps', `${productId}.png`);
    if (await exists(cropped)) {
        console.warn(`  ⚠️ no clean render for product ${productId} — falling back to the cropped photo`);
        return readFile(cropped);
    }

    console.warn(`  ⚠️ no prepared strap for product ${productId} — run prepare-straps.ts first; using the raw photo`);
    const res = await fetch(fallbackUrl);
    if (!res.ok) throw new Error(`Could not download strap image ${fallbackUrl} (${res.status})`);
    return Buffer.from(await res.arrayBuffer());
}

// Products whose clean render drifted in colour are excluded outright — a brown-ified navy strap
// in a two-dozen-pair set would teach the LoRA that straps are brown. See check-clean-straps.ts.
async function loadAcceptedProducts(): Promise<Set<number> | null> {
    const checkPath = path.join(OUT_DIR, 'clean-straps-check.json');
    if (!(await exists(checkPath))) return null;
    const { accepted } = JSON.parse(await readFile(checkPath, 'utf8')) as { accepted: number[] };
    return new Set(accepted);
}

// Mirrors the retry policy in /api/generate: Replicate's safety filter throws a transient E005
// false positive on ordinary inputs, and its API occasionally returns a bare 5xx that its own
// docs say to retry. 4xx is never retried — an identical request would just fail again.
async function runWithRetry(input: Record<string, unknown>, attempts = 3): Promise<unknown> {
    for (let attempt = 1; ; attempt++) {
        try {
            return await replicate.run('black-forest-labs/flux-2-pro', { input });
        } catch (err: unknown) {
            const message = String((err as { message?: string })?.message ?? err);
            const status = (err as { response?: { status?: number } })?.response?.status;
            const retryable =
                message.includes('E005') ||
                message.toLowerCase().includes('flagged as sensitive') ||
                (typeof status === 'number' && status >= 500);
            if (!retryable || attempt >= attempts) throw err;
            console.warn(`    ⚠️ attempt ${attempt} failed (${message.slice(0, 60)}) — retrying`);
            await new Promise((r) => setTimeout(r, 2000 * attempt));
        }
    }
}

async function runPro(draft: Buffer, strapRef: Buffer, faceRef: Buffer, clause: string, resolution: string) {
    const toUri = (b: Buffer) => `data:image/png;base64,${b.toString('base64')}`;
    const output = await runWithRetry({
        seed: 19826,
        prompt: PRO_ASSEMBLY_PROMPT + clause,
        resolution,
        aspect_ratio: '9:16',
        input_images: [toUri(draft), toUri(strapRef), toUri(faceRef)],
        output_format: 'webp',
        output_quality: 90,
        safety_tolerance: 5,
        prompt_upsampling: false,
    });
    const url = typeof output === 'string' ? output : (output as { url: () => string }).url();
    const res = await fetch(String(url));
    if (!res.ok) throw new Error(`Could not download PRO output (${res.status})`);
    return Buffer.from(await res.arrayBuffer());
}

async function main() {
    const dryRun = flag('dry-run');
    const set = arg('set', 'train'); // "train" (1 MP) or "heldOut" (2 MP, production settings)
    const resolution = (set === 'train' ? '1 MP' : '2 MP') as keyof typeof ASSUMED_COST;
    const unitCost = Number(arg('unit-cost', String(ASSUMED_COST[resolution])));
    const limit = Number(arg('limit', '9999'));
    const maxSpend = Number(arg('max-spend', '1.50'));
    // Targets specific products instead of walking combos.json in file order — added to fill a
    // known, specific gap (e.g. under-represented duocolor straps) without spending on combos that
    // already have coverage just because they happen to come first in the list.
    const productIdsArg = arg('product-ids', '');
    const productIds = productIdsArg ? new Set(productIdsArg.split(',').map(Number)) : null;

    const guard = createSpendGuard({ maxSpend, label: `generate-pairs:${set}` });

    const combos: Combo[] = JSON.parse(
        await readFile(path.join(OUT_DIR, 'combos.json'), 'utf8'),
    )[set === 'train' ? 'train' : 'heldOut'];

    await mkdir(PAIR_DIR, { recursive: true });
    const manifestPath = path.join(OUT_DIR, `pairs-${set}.json`);
    const manifest: Record<string, unknown>[] = (await exists(manifestPath))
        ? JSON.parse(await readFile(manifestPath, 'utf8'))
        : [];
    const done = new Set(manifest.map((m) => m.id as string));

    console.log(
        `🎬 ${set}: ${combos.length} combos @ ${resolution}` +
        (dryRun ? ' — DRY RUN, no PRO calls' : `, $${unitCost.toFixed(3)}/image, cap $${maxSpend.toFixed(2)}`) +
        `, ${done.size} already done, limit ${limit} this run`,
    );

    const accepted = await loadAcceptedProducts();
    let generatedThisRun = 0;
    let skippedForColour = 0;
    let skippedBelowStandard = 0;

    for (const combo of combos) {
        if (done.has(combo.id)) continue;
        if (productIds && !productIds.has(combo.productId)) continue;
        if (accepted && !accepted.has(combo.productId)) {
            skippedForColour++;
            continue;
        }
        if (generatedThisRun >= limit) {
            console.log(`\n⏸  Reached --limit=${limit} for this run.`);
            break;
        }

        // Straps come from the prepared, already-cropped catalog written by prepare-straps.ts.
        // Detection happens there — once per product, offline — so this script makes no vision
        // call at all, and neither will production once it switches to the trained model.
        const [strapBuffer, { buffer: faceBuffer }] = await Promise.all([
            loadPreparedStrap(combo.productId, combo.strapImage),
            getObjectBuffer(combo.faceKey),
        ]);

        // Preferred path: split the clean render into its two segments and re-lay them as a real
        // watch reads — buckle above, case between, holes below. Falls back to the flat composite
        // only when the two segments cannot be told apart.
        const rawSegments = await splitStrapSegments(strapBuffer);
        const segments = rawSegments;

        // Assessed BEFORE the guard is charged. A pair built from a draft that fails the standard
        // teaches the model the fault, and a call already made cannot be un-billed.
        const verdict = segments
            ? await assessSegments(segments, faceBuffer, strapBuffer, combo.strapImage, combo.productId)
            : { ok: false, reasons: ['the render could not be split into two segments'] };
        if (!verdict.ok) {
            console.warn(`  ⏭  ${combo.id} — ${verdict.reasons[0]}`);
            skippedBelowStandard++;
            continue;
        }

        const draft = await buildSegmentedDraft(segments!, faceBuffer);
        await writeFile(path.join(PAIR_DIR, `${combo.id}_start.png`), draft);

        if (!dryRun) {
            try {
                guard.charge(unitCost, `PRO ${combo.id}`);
            } catch (err) {
                if (err instanceof SpendExceededError) {
                    console.warn(`\n🛑 ${err.message}`);
                    break;
                }
                throw err;
            }
        }

        if (dryRun) {
            generatedThisRun++;
            console.log(`  🖼  ${combo.id} draft only`);
            continue;
        }

        // Same three arguments /api/generate passes — categories and attributes matter, the
        // classifier falls back to weak name-regex guessing without them.
        const clause = buildStrapProfileClause(
            classifyStrap(combo.productName, combo.categories, combo.attributes),
        );
        const after = await runPro(draft, strapBuffer, faceBuffer, clause, resolution);
        await writeFile(path.join(PAIR_DIR, `${combo.id}_end.webp`), after);

        manifest.push({
            id: combo.id,
            bucket: combo.bucket,
            material: combo.material,
            materialBucket: combo.materialBucket,
            productName: combo.productName,
            faceKey: combo.faceKey,
            strapImage: combo.strapImage,
            categories: combo.categories,
            attributes: combo.attributes,
            resolution,
        });
        // Written after every single pair so a crash resumes instead of re-paying.
        await writeFile(manifestPath, JSON.stringify(manifest, null, 2));

        generatedThisRun++;
        console.log(`  ✅ ${combo.id}  (${guard.summary()})`);
    }

    if (skippedBelowStandard > 0) {
        console.log(`\nℹ️  skipped ${skippedBelowStandard} combo(s) whose draft does not meet the standard — those renders need redoing`);
    }
    if (skippedForColour > 0) {
        console.log(`\nℹ️  skipped ${skippedForColour} combo(s) whose clean strap render drifted in colour`);
    }
    console.log(`${guard.summary()} — ${manifest.length}/${combos.length} pairs on disk`);
    process.exit(0);
}

main().catch((err) => {
    console.error('❌', describeError(err));
    process.exit(1);
});
