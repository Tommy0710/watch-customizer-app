import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { getDatabaseProducts } from '../../src/lib/woocommerce';
import { getDatabaseFaces } from '../../src/lib/aws';
import { selectCombos, type Combo } from './selectCombos';
import { describeError } from '../lib/reportError';

const ALLOWED_CATEGORIES = ['Classic Watch Straps', 'Vintage Watch Straps'];
const OUT_DIR = path.join(process.cwd(), 'scripts/dataset/out');

function arg(name: string, fallback: string): string {
    const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : fallback;
}

// Held-out combos sit at FIXED positions in the deterministic sequence rather than at its end.
// Anchoring them to the end looked tidy but silently reassigned the whole eval set the moment the
// training count grew, orphaning PRO baselines that had already been paid for and, worse, freeing
// the old eval combos to appear in training. Fixed offsets keep the yardstick stable no matter how
// large the training set gets.
const HELDOUT_OFFSET = 24;

async function main() {
    const [allProducts, faces] = await Promise.all([getDatabaseProducts(), getDatabaseFaces()]);
    // Same filter the customer-facing StrapSelector applies — training on products nobody can
    // actually pick would waste the budget.
    const products = allProducts.filter((p) =>
        p.categories.some((c) => ALLOWED_CATEGORIES.includes(c.name)) && Boolean(p.image),
    );

    console.log(`📦 ${products.length} eligible straps, ${faces.length} faces`);
    if (products.length === 0 || faces.length === 0) {
        throw new Error('Catalog is empty — run /api/woocommerce/sync and /api/faces/sync first');
    }

    const trainCount = Number(arg('train', '24'));
    const heldOutCount = Number(arg('heldout', '6'));

    // selectCombos is deterministic, so asking for more returns a superset with the same prefix —
    // every combo already generated stays valid and is skipped on the next run.
    const all = selectCombos(products, faces, trainCount + heldOutCount + HELDOUT_OFFSET);
    if (all.length < trainCount + heldOutCount) {
        console.warn(`⚠️ only ${all.length} unique combos available`);
    }

    const heldOut: Combo[] = all.slice(HELDOUT_OFFSET, HELDOUT_OFFSET + heldOutCount);
    const heldOutIds = new Set(heldOut.map((c) => c.id));
    const train: Combo[] = all.filter((c) => !heldOutIds.has(c.id)).slice(0, trainCount);

    console.log(`🔒 held-out fixed at sequence positions ${HELDOUT_OFFSET}-${HELDOUT_OFFSET + heldOutCount - 1}`);

    await mkdir(OUT_DIR, { recursive: true });
    await writeFile(
        path.join(OUT_DIR, 'combos.json'),
        JSON.stringify({ train, heldOut }, null, 2),
    );

    const buckets = new Set(train.map((c) => c.bucket));
    console.log(`✅ ${train.length} train + ${heldOut.length} held-out across ${buckets.size} strap buckets`);
    for (const b of [...buckets].sort()) {
        console.log(`   · ${b} (${train.filter((c) => c.bucket === b).length})`);
    }
    console.log(`   → ${path.join(OUT_DIR, 'combos.json')}`);
    console.log('   You may hand-edit combos.json before generating (e.g. to swap in straps with busy backdrops).');
    process.exit(0);
}

main().catch((err) => {
    console.error('❌', describeError(err));
    process.exit(1);
});
