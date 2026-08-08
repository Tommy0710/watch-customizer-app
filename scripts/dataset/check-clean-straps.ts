import { readFile, writeFile, readdir, access } from 'node:fs/promises';
import path from 'node:path';
import { measureStrapColour, compareStrapColour } from '../../src/lib/strapColour';
import type { Combo } from './selectCombos';

// Gate between render-clean-straps.ts and the training set. FLUX-2-PRO reproduces a strap's
// colour unreliably when asked to re-render it — a navy strap came back brown in the pilot's
// first batch. One brown-ified strap in a two-dozen-pair training set is enough to teach the LoRA
// that straps are brown, so every render is compared against the photo it came from and the
// mismatches are dropped before they can poison anything.
//
// Pure pixel comparison: free, deterministic, no external service.

const OUT_DIR = path.join(process.cwd(), 'scripts/dataset/out');
const STRAP_DIR = path.join(OUT_DIR, 'straps');
const CLEAN_DIR = path.join(OUT_DIR, 'straps-clean');

async function exists(file: string): Promise<boolean> {
    try { await access(file); return true; } catch { return false; }
}

// The colour reference is whatever the render was actually made from: the pre-crop when one
// exists, otherwise the catalog photo. Comparing against a source the render never saw would
// measure the wrong thing.
async function loadSource(productId: number, catalogUrl: string): Promise<Buffer> {
    const cropped = path.join(STRAP_DIR, `${productId}.png`);
    if (await exists(cropped)) return readFile(cropped);
    const res = await fetch(catalogUrl);
    if (!res.ok) throw new Error(`Could not download catalog photo for ${productId} (${res.status})`);
    return Buffer.from(await res.arrayBuffer());
}

async function main() {
    const { train, heldOut }: { train: Combo[]; heldOut: Combo[] } =
        JSON.parse(await readFile(path.join(OUT_DIR, 'combos.json'), 'utf8'));
    const urlByProduct = new Map<number, string>();
    for (const combo of [...train, ...heldOut]) urlByProduct.set(combo.productId, combo.strapImage);

    const files = (await readdir(CLEAN_DIR)).filter((f) => f.endsWith('.webp'));
    const report: { productId: number; ok: boolean; hueDelta: number; reason?: string }[] = [];

    for (const file of files.sort()) {
        const productId = Number(file.replace('.webp', ''));
        const catalogUrl = urlByProduct.get(productId);
        if (!catalogUrl) {
            console.warn(`  ⚠️ ${productId} is not in combos.json, skipping`);
            continue;
        }
        const [sourceBuf, renderBuf] = await Promise.all([
            loadSource(productId, catalogUrl),
            readFile(path.join(CLEAN_DIR, file)),
        ]);

        const [source, render] = await Promise.all([
            measureStrapColour(sourceBuf),
            measureStrapColour(renderBuf),
        ]);
        const verdict = compareStrapColour(source, render);

        report.push({ productId, ok: verdict.ok, hueDelta: Math.round(verdict.hueDelta), reason: verdict.reason });
        console.log(
            `  ${verdict.ok ? '✅' : '❌'} ${productId}  source hue ${Math.round(source.hue)}° → render ${Math.round(render.hue)}°` +
            `  (Δ${Math.round(verdict.hueDelta)}°)${verdict.reason ? ` — ${verdict.reason}` : ''}`,
        );
    }

    const accepted = report.filter((r) => r.ok).map((r) => r.productId);
    await writeFile(
        path.join(OUT_DIR, 'clean-straps-check.json'),
        JSON.stringify({ accepted, report }, null, 2),
    );

    console.log(`\n${accepted.length}/${report.length} renders kept their source colour`);
    console.log(`   → ${path.join(OUT_DIR, 'clean-straps-check.json')}`);
    process.exit(0);
}

main().catch((err) => {
    console.error('❌', err);
    process.exit(1);
});
