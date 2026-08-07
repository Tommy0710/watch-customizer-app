import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { getDatabaseProducts } from '../../src/lib/woocommerce';
import { getDatabaseFaces } from '../../src/lib/aws';
import { selectCombos } from './selectCombos';

const ALLOWED_CATEGORIES = ['Classic Watch Straps', 'Vintage Watch Straps'];
const TRAIN_COUNT = 24;
const HELDOUT_COUNT = 6;
const OUT_DIR = path.join(process.cwd(), 'scripts/dataset/out');

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

    const all = selectCombos(products, faces, TRAIN_COUNT + HELDOUT_COUNT);
    if (all.length < TRAIN_COUNT + HELDOUT_COUNT) {
        console.warn(`⚠️ only ${all.length} unique combos available`);
    }
    // Held-out combos are taken from the END so that shrinking TRAIN_COUNT later never moves a
    // combo from the eval set into the training set.
    const heldOut = all.slice(-HELDOUT_COUNT);
    const train = all.slice(0, all.length - HELDOUT_COUNT);

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
    console.error('❌', err);
    process.exit(1);
});
