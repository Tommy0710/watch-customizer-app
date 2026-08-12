import { mkdir, writeFile, readFile, access } from 'node:fs/promises';
import path from 'node:path';
import Replicate from 'replicate';
import { createSpendGuard, SpendExceededError } from '../lib/spendGuard';
import type { Combo } from './selectCombos';

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

const CLEAN_STRAP_PROMPT =
    'Reproduce the watch strap from this photo as a clean studio product image. Copy its leather ' +
    'colour, grain, pattern, stitching, edge finishing, buckle, and punched holes exactly, ' +
    'pixel-for-pixel, including any faint colour undertones such as green, blue, or purple patina ' +
    '— never substitute a generic brown or plain black leather. Completely remove the staging: the ' +
    'background surface, any large leather hide or swatch used as a backdrop, any rolled fabric or ' +
    'cylinder prop the strap is draped over, and all shadows. Show the strap as its two real and ' +
    'different pieces, laid flat and perfectly vertical, centred, aligned end to end with a gap ' +
    'between them where a watch case would sit. The upper piece is the short buckle piece: it ' +
    'carries the single metal buckle at its top end together with the keeper loops, and it has NO ' +
    'punched holes. The lower piece is the long tail: plain tapered leather with the row of ' +
    'punched holes and a curved tip, carrying NO buckle and NO keeper loops. The upper piece must ' +
    'be about two thirds the length of the lower piece. The two pieces are different lengths and ' +
    'different shapes — never draw the same piece twice, never mirror one piece to make the other, ' +
    'and never show more than one buckle anywhere in the image. Photograph ' +
    'top-down in sharp 8k focus with soft professional studio lighting on a pure solid white ' +
    'background. Do not add a watch case, dial, or any other object.';

// The four sentences above about the two pieces being different replace a single line that only
// said "the buckle segment must be clearly shorter than the holes segment". Measured across the 74
// renders that line produced, 54 came back as the SAME piece drawn twice — each half carrying both
// a buckle and a row of holes, one of them mirrored — which is 73% of the catalog failing the
// standard for one reason. The old wording asked for a proportion but never forbade the duplicate,
// so this names the fault instead of restating the goal.

const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });

function arg(name: string, fallback: string): string {
    const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : fallback;
}

async function exists(file: string): Promise<boolean> {
    try { await access(file); return true; } catch { return false; }
}

// The pre-crop is a helper, not a prerequisite. CLEAN_STRAP_PROMPT already instructs PRO to strip
// the backdrop, hides, and props itself, and three pilot straps that were never cropped still
// produced renders that passed the colour check and yielded usable pairs. Since the crop depends
// on a rate-limited free tier that throttles to a few images per minute, waiting on it would cost
// hours for a step that only makes PRO's job marginally easier.
async function loadSource(productId: number, catalogUrl: string): Promise<Buffer> {
    const cropped = path.join(STRAP_DIR, `${productId}.png`);
    if (await exists(cropped)) return readFile(cropped);

    const res = await fetch(catalogUrl);
    if (!res.ok) throw new Error(`Could not download catalog photo for ${productId} (${res.status})`);
    return Buffer.from(await res.arrayBuffer());
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
    const unitCost = Number(arg('unit-cost', '0.03'));
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

    await mkdir(outDir, { recursive: true });
    console.log(
        `🧼 ${only.size > 0 ? `${only.size} selected` : `${byProduct.size}`} straps, ` +
        `$${unitCost.toFixed(3)} each, cap ${guard.summary()} → ${outDir}`,
    );

    let rendered = 0;
    for (const [productId, combo] of byProduct) {
        if (only.size > 0 && !only.has(productId)) continue;
        const outPath = path.join(outDir, `${productId}.webp`);
        if (await exists(outPath)) continue;
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
        const output = await runWithRetry({
            seed: 19826,
            prompt: CLEAN_STRAP_PROMPT,
            resolution: '1 MP',
            aspect_ratio: '9:16',
            input_images: [`data:image/png;base64,${source.toString('base64')}`],
            output_format: 'webp',
            output_quality: 90,
            safety_tolerance: 5,
            prompt_upsampling: false,
        });

        const url = typeof output === 'string' ? output : (output as { url: () => string }).url();
        const res = await fetch(String(url));
        if (!res.ok) throw new Error(`Could not download clean strap (${res.status})`);
        await writeFile(outPath, Buffer.from(await res.arrayBuffer()));

        rendered++;
        console.log(`  ✅ ${productId} ${combo.productName.slice(0, 44)}  (${guard.summary()})`);
    }

    console.log(`\n${guard.summary()} — ${rendered} rendered this run`);
    process.exit(0);
}

main().catch((err) => {
    console.error('❌', err);
    process.exit(1);
});
