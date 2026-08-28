import { mkdir, writeFile, readFile, access } from 'node:fs/promises';
import path from 'node:path';
import Replicate from 'replicate';
import { prepareFace, checkCleanRender, type PreparedFace } from '../../src/lib/renderCheck';
import { buildStrapLayoutTemplate } from '../../src/lib/strapLayoutTemplate';
import { measureStrapColour, compareStrapColour } from '../../src/lib/strapColour';
import { getObjectBuffer } from '../../src/lib/aws';
import { createSpendGuard, SpendExceededError } from '../lib/spendGuard';
import type { Combo } from './selectCombos';
import { activeMaterialFamilies, classifyMaterial } from './materialTaxonomy';
import { isSelectableWatchStrap } from '../../src/lib/productEligibility';
import { describeError } from '../lib/reportError';

// Turns each staged catalog photo into a canonical studio render of the same strap: laid
// vertically, isolated on white, no props.
//
// Why this exists. The first three real PRO generations made the problem visible: the draft input
// is a strap lying diagonally on a coloured prop, while the target is a clean vertical watch on
// white. Asking a LoRA to learn that means teaching it to reorient the strap, erase the staging,
// AND attach the watch head — an enormous edit, far beyond what a couple of dozen training pairs
// can carry. Rendering a clean strap first collapses the difference between before and after down
// to the one thing worth learning: joining the head to the lugs.
//
// Cost is paid ONCE per product, not per generation, and the result is stored — same contract as
// prepare-straps.ts. Production reads the rendered strap; it never calls this at request time.

const OUT_DIR = path.join(process.cwd(), 'scripts/dataset/out');
const STRAP_DIR = path.join(OUT_DIR, 'straps');
const CLEAN_DIR = path.join(OUT_DIR, 'straps-clean');
export function buildCleanStrapPrompt(
    material?: { family: string; surface: string },
    productDetails?: { name?: string; attributes?: Array<{ name: string; options: string[] }> }
): string {
    let materialEmphasis = '';
    if (material?.family === 'stingray') {
        materialEmphasis = ' Material identity: genuine stingray leather with a continuous, uniform fine pebbled texture of tight round grains in its exact solid dye colour. Do not add white blotches, glitter, or diamond spots, and never render as flat leather or generic pebbled cowhide.';
    }

    let colorStructureEmphasis = '';
    const name = productDetails?.name || '';
    const colorAttr = productDetails?.attributes?.find(a => /color/i.test(a.name))?.options.join(' ') || '';

    if (/tricolor|tri-color|triple-color/i.test(name) || /Pearl White.*Yellow.*Black|Miami.*Yellow.*Black|Burgundy.*Navy.*Taupe|Grey.*Taupe.*Turquoise|Navy.*Olive.*Orange|Golden.*Navy.*Sesame|Grey.*Red.*White|Burgundy.*Navy.*Black|Orange.*Pearl White.*Taupe|Pearl White.*Purple.*Turquoise/i.test(colorAttr)) {
        colorStructureEmphasis = ' IMPORTANT: This is a TRICOLOR 3-stripe watch strap — each strap piece has 3 distinct vertical color stripes: one outer edge is one color with stitching, the center section is a second contrasting color, and the opposite outer edge is a third color with stitching. You MUST reproduce all 3 distinct color stripes running cleanly down both strap pieces — do not merge them into a single solid colour.';
    } else if (/duocolor|duo-color/i.test(name)) {
        colorStructureEmphasis = ' IMPORTANT: This is a DUOCOLOR 2-color striped watch strap: each strap piece features distinct contrasting vertical color stripes and contrasting color keeper loops. Reproduce both distinct colors accurately — do not merge into a single solid colour.';
    }

    return (
        'Reproduce the watch strap from this photo as a clean studio product image.' +
        materialEmphasis +
        colorStructureEmphasis +
        ' Copy its leather colour, grain, pattern, stitching, edge finishing, buckle, and punched holes exactly, ' +
        'pixel-for-pixel, including any faint colour undertones such as green, blue, or purple patina ' +
        '— never substitute a generic brown or plain black leather. Completely remove the staging: the ' +
        'background surface, any large leather hide or swatch used as a backdrop, any rolled fabric or ' +
        'cylinder prop the strap is draped over, and all shadows. THE SECOND IMAGE IS A GREY DIAGRAM ' +
        'OF THE REQUIRED LAYOUT — reproduce its arrangement exactly: two separate pieces side by side, ' +
        'both perfectly vertical, both starting at the same top edge, the left piece about two thirds ' +
        'the length of the right piece. Take only the arrangement and the proportions from the ' +
        'diagram; take the leather, colour and hardware from the first image. The left piece is the ' +
        'short buckle piece: it carries the single metal buckle together with the keeper loops, and it ' +
        'has NO punched holes. The right piece is the long tail: plain tapered leather with the row of ' +
        'punched holes and a curved tip, carrying NO buckle and NO keeper loops. Never draw the same ' +
        'piece twice, never mirror one piece to make the other, and never show more than one buckle ' +
        'anywhere in the image. Photograph ' +
        'top-down in sharp 8k focus with soft professional studio lighting on a pure solid white ' +
        'background. Do not add a watch case, dial, or any other object.'
    );
}

const CLEAN_STRAP_PROMPT = buildCleanStrapPrompt();

// The layout is now shown rather than described, because describing it failed twice over.
//
// This prompt asked for a buckle piece "clearly shorter than the holes segment" and 54 of 74
// renders came back with the halves the same length. It also asked for the pieces stacked one
// above the other, and every render placed them side by side instead. Two explicit instructions,
// both ignored. Since the splitter reads a vertical gutter, side by side is what is wanted anyway,
// so the wording now matches reality and a diagram carries the proportion that words could not.
//
// The sentences forbidding a second buckle are kept: they were added when the fault was thought to
// be a duplicated piece, and while that turned out to be a symptom rather than the cause, naming a
// failure the renderer demonstrably has is worth the tokens.

const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });

// Retrying is worth very little on its own, and it is worth recording why rather than deleting it
// quietly. It was added believing a bad render was a roll of the dice. Measured over 10 straps it
// bought ONE usable render for 32 PRO calls, and four seeds on 25544 returned buckle shares of
// 51%, 51%, 51% and 50% — the same answer four times, which is not what randomness looks like.
//
// The fault follows the source photo, so a second attempt on the same input mostly buys the same
// failure again. Retries are kept because they cost nothing when the first attempt succeeds and
// they do catch the occasional genuine wobble, but the number is low on purpose: spending four
// calls per strap to move a 3% chance is how the last $2.56 went.
const MAX_ATTEMPTS = 2;
// Judging against a handful of faces rather than all 114: the full sweep is what the standard
// report is for, and paying for it inside a retry loop would multiply the wait by 20 for a verdict
// that barely moves. Faces are sampled evenly across the library rather than taken from the front,
// which would otherwise draw them all from one brand folder.
const FACE_SAMPLE = 8;

function flag(name: string): boolean {
    return process.argv.includes(`--${name}`);
}

function arg(name: string, fallback: string): string {
    const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : fallback;
}

async function exists(file: string): Promise<boolean> {
    try { await access(file); return true; } catch { return false; }
}

// The raw catalog photo, never the pre-crop.
//
// The crop was believed to make PRO's job easier. It does the opposite, and the split is total:
// of the 74 renders made so far, the 19 built from a pre-crop pass the standard 0 times, while the
// 55 built from the raw photo pass 19 times. Looking at those 19 crops explains it — every one is
// a detail shot, a few inches of strap draped over an arm or a leather hide, with the strap never
// visible end to end. PRO cannot copy a proportion it was never shown, so it invents one, and what
// it invents is two pieces of equal length.
//
// This is also why re-rendering with a new seed did nothing: four seeds on 25544 returned buckle
// shares of 51%, 51%, 51% and 50%. The fault follows the source photo, not the dice.
async function loadSource(productId: number, catalogUrl: string): Promise<Buffer> {
    const res = await fetch(catalogUrl);
    if (!res.ok) throw new Error(`Could not download catalog photo for ${productId} (${res.status})`);
    return Buffer.from(await res.arrayBuffer());
}

// Colour is the one thing the pre-crop is still good for. A detail shot is useless for proportion
// but excellent for hue: it is nothing but leather, where the raw photo averages in props and
// backdrops. So the crop stays in use here and only here.
async function loadColourSource(productId: number, catalogUrl: string): Promise<Buffer> {
    const cropped = path.join(STRAP_DIR, `${productId}.png`);
    if (await exists(cropped)) return readFile(cropped);
    return Buffer.from(await (await fetch(catalogUrl)).arrayBuffer());
}

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

async function main() {
    // See the note by ASSUMED_COST in generate-pairs.ts: $0.03-0.08 were unverified guesses used
    // here for months. Reconstructed from a real $20→$1 balance drop over 113 calls on 2026-08-12,
    // the true price is closer to $0.17/call. $0.20 is a deliberate over-estimate, not a measurement
    // — confirm against the billing dashboard before spending against it.
    const unitCost = Number(arg('unit-cost', '0.20'));
    const limit = Number(arg('limit', '9999'));
    const guard = createSpendGuard({ maxSpend: Number(arg('max-spend', '0.70')), label: 'clean-straps' });

    // --only and --out exist so a prompt change can be tried on a handful of known-bad straps
    // without overwriting the renders currently in service. Writing a trial into the live folder
    // would replace working renders with untested ones and there is no way back but paying again.
    const only = new Set(arg('only', '').split(',').filter(Boolean).map(Number));
    const outDir = arg('out', CLEAN_DIR);

    const { train, heldOut }: { train: Combo[]; heldOut: Combo[] } =
        JSON.parse(await readFile(path.join(OUT_DIR, 'combos.json'), 'utf8'));

    const byProduct = new Map<number, Combo>();
    for (const combo of [...train, ...heldOut]) {
        if (!byProduct.has(combo.productId)) byProduct.set(combo.productId, combo);
    }

    // --all reads the real catalog instead of the 96-product sample the dataset was built from.
    // Every cost estimate drawn from combos.json understates the job by a factor of four and a
    // half: 443 straps are clickable in the UI, and a pre-launch run has to cover all of them.
    if (flag('all')) {
        const { getDatabaseProducts } = await import('../../src/lib/woocommerce');
        const catalog = await getDatabaseProducts();
        const activeFamilies = activeMaterialFamilies(catalog);
        const visible = catalog
            .filter((p) => isSelectableWatchStrap(p)
                && activeFamilies.has(classifyMaterial(p).family)
                && (flag('include-out-of-stock') || !p.stockStatus || p.stockStatus === 'instock'));
        for (const p of visible) {
            if (byProduct.has(p.id) || !p.image) continue;
            // Only the fields this script reads are real; the rest exist to satisfy the Combo type
            // and are never used here. faceKey in particular is not a claim about this product —
            // faces are sampled separately below.
            byProduct.set(p.id, {
                id: `${p.id}`, productId: p.id, productName: p.name, strapImage: p.image,
                categories: p.categories.map((c) => c.name), attributes: p.attributes,
                faceKey: '', faceName: '', bucket: '',
                material: classifyMaterial(p), materialBucket: classifyMaterial(p).bucket,
            });
        }
        console.log(`📚 full catalog: ${visible.length} straps visible in the UI`);
    }

    // --sample=N estimates the real pass rate before committing to the whole catalog. The 10 straps
    // measured so far were deliberately the hardest — each had already failed twice — so 6 of 9 is
    // a floor rather than an average, and the difference decides whether a full run is worth $47.
    // Selection is deterministic so a repeat run measures the same straps rather than new luck.
    const sample = Number(arg('sample', '0'));
    if (sample > 0) {
        const candidates: number[] = [];
        for (const id of byProduct.keys()) {
            if (!(await exists(path.join(outDir, `${id}.webp`)))) candidates.push(id);
        }
        candidates.sort((a, b) => a - b);
        let state = 19826;
        for (let i = candidates.length - 1; i > 0; i--) {
            state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
            const j = Math.floor((state / 0x100000000) * (i + 1));
            [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
        }
        for (const id of candidates.slice(0, sample)) only.add(id);
        console.log(`🎲 sampling ${Math.min(sample, candidates.length)} of ${candidates.length} straps with no render yet`);
    }

    // Evenly spaced through the library so the sample spans brands rather than sitting inside one,
    // and faces whose lug gap cannot be read are dropped rather than counted.
    //
    // Leaving them in quietly turned the 80% threshold into a 100% one. Three of the 114 library
    // faces have an unreadable gap, so a sample of 8 reliably contained one — every accepted strap
    // in the last run scored exactly 7/8, never 8/8 — which left a strap failing the moment it
    // missed a single genuine face. That is a fact about those three photographs, not about the
    // strap, and no re-render can fix it. Production already handles them: the engine stands down
    // for that pairing and falls back to PRO.
    const faceKeys = [...new Set([...train, ...heldOut].map((c) => c.faceKey))];
    const step = Math.max(1, Math.floor(faceKeys.length / FACE_SAMPLE));
    const spread = faceKeys.filter((_, i) => i % step === 0);
    const faces: PreparedFace[] = [];
    const tried = new Set<string>();
    // The spread first, then the rest of the library as replacements for any that turn out unreadable.
    for (const key of [...spread, ...faceKeys]) {
        if (faces.length >= FACE_SAMPLE) break;
        if (tried.has(key)) continue;
        tried.add(key);
        const prepared = await prepareFace((await getObjectBuffer(key)).buffer);
        if (prepared.metrics.lugGap !== null) faces.push(prepared);
    }
    console.log(`🕐 judging against ${faces.length} faces with a readable lug gap`);
    const failed: { id: number; name: string; reason: string }[] = [];
    // Built once: it is the same diagram for every strap, and it is the same one every time.
    const layoutTemplate = await buildStrapLayoutTemplate();

    await mkdir(outDir, { recursive: true });
    console.log(
        `🧼 ${only.size > 0 ? `${only.size} selected` : `${byProduct.size}`} straps, ` +
        `$${unitCost.toFixed(3)} each, cap ${guard.summary()} → ${outDir}`,
    );

    let rendered = 0;
    for (const [productId, combo] of byProduct) {
        if (only.size > 0 && !only.has(productId)) continue;
        const outPath = path.join(outDir, `${productId}.webp`);
        // Naming a strap with --only means redo it: the straps worth naming are the ones whose
        // existing render is the problem. The file is still only overwritten by a render that
        // passed, so a redo can improve a strap but never damage one.
        if (only.size === 0 && await exists(outPath)) continue;
        if (rendered >= limit) {
            console.log(`\n⏸  Reached --limit=${limit}.`);
            break;
        }

        try {
            guard.charge(unitCost, `clean strap ${productId}`);
        } catch (err) {
            if (err instanceof SpendExceededError) { console.warn(`\n🛑 ${err.message}`); break; }
            throw err;
        }

        const source = await loadSource(productId, combo.strapImage);
        const sourceColour = await measureStrapColour(await loadColourSource(productId, combo.strapImage));

        let accepted = false;
        let lastReason = 'no attempt made';
        for (let attempt = 1; attempt <= MAX_ATTEMPTS && !accepted; attempt++) {
            if (attempt > 1) {
                try {
                    guard.charge(unitCost, `clean strap ${productId} retry ${attempt}`);
                } catch (err) {
                    if (err instanceof SpendExceededError) { console.warn(`\n🛑 ${err.message}`); break; }
                    throw err;
                }
            }

            const output = await runWithRetry({
                // Varied per attempt: the same seed reproduces the same duplicated render exactly,
                // so retrying without changing it would just buy the identical failure again.
                seed: 19826 + attempt - 1,
                prompt: buildCleanStrapPrompt(combo.material, { name: combo.productName, attributes: combo.attributes }),
                resolution: '1 MP',
                aspect_ratio: '9:16',
                input_images: [
                    `data:image/png;base64,${source.toString('base64')}`,
                    `data:image/png;base64,${layoutTemplate.toString('base64')}`,
                ],
                output_format: 'webp',
                output_quality: 90,
                safety_tolerance: 5,
                prompt_upsampling: false,
            });

            const url = typeof output === 'string' ? output : (output as { url: () => string }).url();
            const res = await fetch(String(url));
            if (!res.ok) throw new Error(`Could not download clean strap (${res.status})`);
            const candidate = Buffer.from(await res.arrayBuffer());

            const verdict = await checkCleanRender(
                candidate,
                faces,
                compareStrapColour(sourceColour, await measureStrapColour(candidate)),
            );

            if (verdict.ok) {
                // Written only once it has passed. A failing render put on disk would sit there
                // looking like a rendered strap and quietly serve nothing.
                await writeFile(outPath, candidate);
                accepted = true;
                rendered++;
                console.log(
                    `  ✅ ${productId} ${combo.productName.slice(0, 40)} ` +
                    `— attempt ${attempt}, ${verdict.passes}/${verdict.checked} faces  (${guard.summary()})`,
                );
            } else {
                lastReason = verdict.reasons[0] ?? 'below standard';
                // passes/checked printed alongside, because the reason list is the union across
                // every failing face and its first entry can name a fault that only one face hit.
                // A render at 7/8 is one unreadable face away from acceptance; one at 1/8 is not,
                // and the reason text alone makes those look identical.
                console.log(
                    `     attempt ${attempt} rejected (${verdict.passes}/${verdict.checked} faces) — ${lastReason.slice(0, 76)}`,
                );
            }
        }

        if (!accepted) {
            failed.push({ id: productId, name: combo.productName, reason: lastReason });
            console.log(`  ❌ ${productId} ${combo.productName.slice(0, 40)} — gave up after ${MAX_ATTEMPTS}`);
        }
    }

    if (failed.length > 0) {
        console.log(`\n${failed.length} strap(s) still have no usable render — these keep falling back to PRO:`);
        for (const f of failed) console.log(`   ${f.id}  ${f.name}  — ${f.reason.slice(0, 70)}`);
    }
    console.log(`\n${guard.summary()} — ${rendered} accepted this run`);
    process.exit(0);
}

main().catch((err) => {
    console.error('❌', describeError(err));
    process.exit(1);
});
