import { mkdir, writeFile, readFile, access } from 'node:fs/promises';
import path from 'node:path';
import { cropToStrap } from '../../src/lib/cropStrap';
import type { Combo } from './selectCombos';
import { describeError } from '../lib/reportError';

// One-time catalog preparation: crop every strap product photo down to the strap itself and keep
// the result on disk. Detection is the only step that talks to an outside service, and doing it
// here — once per product, offline — means neither training nor serving ever makes a vision call
// at request time. Same shape as the existing /api/faces/sync and /api/woocommerce/sync jobs:
// pull once, store, read locally forever after.
//
// The Vercel AI Gateway free tier rate-limits bursts (it does NOT run out of quota), so calls are
// spaced and retried rather than fired in parallel.

const OUT_DIR = path.join(process.cwd(), 'scripts/dataset/out');
const STRAP_DIR = path.join(OUT_DIR, 'straps');

function arg(name: string, fallback: string): string {
    const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : fallback;
}

async function exists(file: string): Promise<boolean> {
    try { await access(file); return true; } catch { return false; }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
    const delayMs = Number(arg('delay', '8000'));
    const maxRetries = Number(arg('retries', '4'));

    const { train, heldOut }: { train: Combo[]; heldOut: Combo[] } =
        JSON.parse(await readFile(path.join(OUT_DIR, 'combos.json'), 'utf8'));

    // One crop per PRODUCT, not per combo — the same strap appears in several combos.
    const byProduct = new Map<number, Combo>();
    for (const combo of [...train, ...heldOut]) {
        if (!byProduct.has(combo.productId)) byProduct.set(combo.productId, combo);
    }

    await mkdir(STRAP_DIR, { recursive: true });
    console.log(`✂️  ${byProduct.size} unique straps, ${delayMs}ms between calls`);

    let cropped = 0;
    let skipped = 0;
    let failed = 0;

    for (const [productId, combo] of byProduct) {
        const outPath = path.join(STRAP_DIR, `${productId}.png`);
        if (await exists(outPath)) {
            skipped++;
            continue;
        }

        const res = await fetch(combo.strapImage);
        if (!res.ok) {
            console.warn(`  ❌ ${productId} download failed (${res.status})`);
            failed++;
            continue;
        }
        const raw = Buffer.from(await res.arrayBuffer());

        let out: Buffer<ArrayBufferLike> = raw;
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            out = await cropToStrap(raw);
            // cropToStrap swallows errors and hands back the original buffer, so an unchanged
            // buffer is the signal that detection did not succeed — worth another try.
            if (out !== raw) break;
            if (attempt < maxRetries) {
                console.log(`  … ${productId} detection returned nothing, retry ${attempt}/${maxRetries - 1}`);
                await sleep(delayMs * 2);
            }
        }

        if (out === raw) {
            // Deliberately writes nothing. Saving the uncropped photo would make the next run skip
            // this product forever, quietly leaving a staged prop shot in the dataset — the exact
            // failure this step exists to prevent. Leaving the file absent means a re-run retries.
            console.warn(`  ⚠️ ${productId} detection failed, left for a later run (${combo.productName.slice(0, 40)})`);
            failed++;
        } else {
            await writeFile(outPath, out);
            cropped++;
            console.log(`  ✅ ${productId} ${combo.productName.slice(0, 46)}`);
        }
        await sleep(delayMs);
    }

    console.log(`\n${cropped} cropped, ${skipped} already done, ${failed} left uncropped`);
    console.log(`   → ${STRAP_DIR}`);
    process.exit(0);
}

main().catch((err) => {
    console.error('❌', describeError(err));
    process.exit(1);
});
