import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { getDatabaseProducts } from '../../src/lib/woocommerce';
import { getDatabaseFaces } from '../../src/lib/aws';
import { selectCombos, type Combo } from './selectCombos';
import { activeMaterialFamilies, classifyMaterial } from './materialTaxonomy';
import { isSelectableWatchStrap } from '../../src/lib/productEligibility';
import { describeError } from '../lib/reportError';

const OUT_DIR = path.join(process.cwd(), 'scripts/dataset/out');

function arg(name: string, fallback: string): string {
    const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : fallback;
}

function flag(name: string): boolean {
    return process.argv.includes(`--${name}`);
}

// Held-out combos sit at FIXED positions in the deterministic sequence rather than at its end.
// Anchoring them to the end looked tidy but silently reassigned the whole eval set the moment the
// training count grew, orphaning PRO baselines that had already been paid for and, worse, freeing
// the old eval combos to appear in training. Fixed offsets keep the yardstick stable no matter how
// large the training set gets.
const HELDOUT_OFFSET = 24;

async function main() {
    const [allProducts, faces] = await Promise.all([getDatabaseProducts(), getDatabaseFaces()]);
    const includeOutOfStock = flag('include-out-of-stock');
    const activeFamilies = activeMaterialFamilies(allProducts);
    // Same filter the customer-facing StrapSelector applies. Out-of-stock products may be used
    // only as extra examples for a family that still has at least one sellable SKU. A family with
    // no sellable products is future catalog dead weight and must not enter training.
    const products = allProducts.filter((p) =>
        isSelectableWatchStrap(p) && Boolean(p.image)
        && activeFamilies.has(classifyMaterial(p).family)
        && (includeOutOfStock || !p.stockStatus || p.stockStatus === 'instock'),
    );

    console.log(`📦 ${products.length} eligible straps${includeOutOfStock ? ' (including out-of-stock in active families)' : ''}, ${faces.length} faces`);
    console.log(`   active material families: ${[...activeFamilies].sort().join(', ') || '(none)'}`);
    if (products.length === 0 || faces.length === 0) {
        throw new Error('Catalog is empty — run /api/woocommerce/sync and /api/faces/sync first');
    }

    const trainCount = Number(arg('train', '24'));
    const heldOutCount = Number(arg('heldout', '6'));

    // Generate a larger deterministic pool than the requested split. A short pool can lose train
    // rows after product-disjoint filtering when several adjacent combos use the same product.
    const poolCount = trainCount + heldOutCount + HELDOUT_OFFSET + heldOutCount;
    const all = selectCombos(products, faces, poolCount);
    if (all.length < trainCount + heldOutCount) {
        console.warn(`⚠️ only ${all.length} unique combos available`);
    }

    // Held-out is selected from the anchored region, but only one combo per product is allowed.
    // A second face with the same strap is not an independent material generalisation example.
    const heldOut: Combo[] = [];
    const heldOutProducts = new Set<number>();
    const materialProducts = new Map<string, Set<number>>();
    const selectedMaterialProducts = new Map<string, Set<number>>();
    for (const combo of all) {
        const productsForMaterial = materialProducts.get(combo.materialBucket) ?? new Set<number>();
        productsForMaterial.add(combo.productId);
        materialProducts.set(combo.materialBucket, productsForMaterial);
    }
    for (const combo of all.slice(HELDOUT_OFFSET)) {
        if (heldOutProducts.has(combo.productId)) continue;
        // A material held out with its only product would test an unseen material, not
        // generalisation. Keep at least one product of the same material in train.
        const availableProducts = materialProducts.get(combo.materialBucket)?.size ?? 0;
        const selectedProducts = selectedMaterialProducts.get(combo.materialBucket)?.size ?? 0;
        if (availableProducts < 2 || selectedProducts >= availableProducts - 1) continue;
        heldOut.push(combo);
        heldOutProducts.add(combo.productId);
        const selected = selectedMaterialProducts.get(combo.materialBucket) ?? new Set<number>();
        selected.add(combo.productId);
        selectedMaterialProducts.set(combo.materialBucket, selected);
        if (heldOut.length >= heldOutCount) break;
    }
    const heldOutIds = new Set(heldOut.map((c) => c.id));
    // Product-disjointness is mandatory: a different face with the same strap is not a genuine
    // held-out material test. Keep the held-out anchor stable, then remove every held-out product
    // from train and fail loudly if the requested train size can no longer be met.
    const train = all
        .filter((c) => !heldOutIds.has(c.id) && !heldOutProducts.has(c.productId))
        .slice(0, trainCount);
    if (train.length < trainCount) {
        throw new Error(`Only ${train.length} product-disjoint train combos available; requested ${trainCount}.`);
    }

    console.log(`🔒 held-out fixed at sequence positions ${HELDOUT_OFFSET}-${HELDOUT_OFFSET + heldOutCount - 1}`);

    await mkdir(OUT_DIR, { recursive: true });
    await writeFile(
        path.join(OUT_DIR, 'combos.json'),
        JSON.stringify({ train, heldOut, activeMaterialFamilies: [...activeFamilies].sort() }, null, 2),
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
