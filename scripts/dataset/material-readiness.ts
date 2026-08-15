import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Combo } from './selectCombos';
import { describeError } from '../lib/reportError';

// Local-only readiness report. It does not contact WooCommerce, S3, Replicate, or the trainer.
// This is intentionally separate from material-coverage: a family can be represented in the
// split while still lacking the clean strap image required by pack-style-dataset.ts.
const OUT_DIR = path.join(process.cwd(), 'scripts/dataset/out');
const CLEAN_DIR = path.join(OUT_DIR, 'straps-clean');

type Split = { train?: Combo[]; heldOut?: Combo[]; activeMaterialFamilies?: string[] };

async function exists(file: string): Promise<boolean> {
    try { await access(file); return true; } catch { return false; }
}

async function main() {
    const split = JSON.parse(await readFile(path.join(OUT_DIR, 'combos.json'), 'utf8')) as Split;
    const train = split.train ?? [];
    const byProduct = new Map<number, Combo>();
    for (const combo of train) if (!byProduct.has(combo.productId)) byProduct.set(combo.productId, combo);

    const byFamily = new Map<string, { products: number; clean: number; missing: number[] }>();
    const inactive = new Set<string>();
    for (const combo of byProduct.values()) {
        if (split.activeMaterialFamilies && !split.activeMaterialFamilies.includes(combo.material.family)) {
            inactive.add(combo.material.family);
        }
        const row = byFamily.get(combo.material.family) ?? { products: 0, clean: 0, missing: [] };
        row.products++;
        if (await exists(path.join(CLEAN_DIR, `${combo.productId}.webp`))) row.clean++;
        else row.missing.push(combo.productId);
        byFamily.set(combo.material.family, row);
    }

    console.log(`train products=${byProduct.size} active families=${split.activeMaterialFamilies?.length ?? '(legacy split)'}`);
    for (const [family, row] of [...byFamily.entries()].sort(([a], [b]) => a.localeCompare(b))) {
        console.log(`  ${family}: clean=${row.clean}/${row.products}${row.missing.length ? ` missing=${row.missing.join(',')}` : ''}`);
    }
    if (inactive.size) throw new Error(`inactive material families found in train split: ${[...inactive].join(', ')}`);
    const missing = [...byFamily.values()].reduce((sum, row) => sum + row.missing.length, 0);
    console.log(missing ? `⚠️ ${missing} train product(s) still need clean renders` : '✅ every train product has a clean render');
}

main().catch((error) => {
    console.error('❌', describeError(error));
    process.exit(1);
});
