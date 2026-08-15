import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { classifyStrap, type Attribute } from '../../src/lib/strapProfile';
import { classifyMaterial } from './materialTaxonomy';

// Local-only preflight. It reads existing manifests and never contacts WooCommerce, S3,
// Replicate, or any other paid service. A non-zero exit means the proposed run is not safe to
// train: fix the split/metadata first.
const OUT_DIR = path.join(process.cwd(), 'scripts/dataset/out');

type Combo = {
    id: string;
    productId: number;
    productName: string;
    categories?: string[];
    attributes?: Attribute[];
    bucket?: string;
    material?: { bucket?: string };
};

async function main() {
    const source = JSON.parse(await readFile(path.join(OUT_DIR, 'combos.json'), 'utf8')) as {
        train?: Combo[];
        heldOut?: Combo[];
    };
    const train = source.train ?? [];
    const heldOut = source.heldOut ?? [];
    const errors: string[] = [];
    const productIds = (items: Combo[]) => new Set(items.map((item) => item.productId));
    const trainProducts = productIds(train);
    const leakedProducts = [...productIds(heldOut)].filter((id) => trainProducts.has(id));
    if (leakedProducts.length) errors.push(`product leakage across train/held-out: ${leakedProducts.join(', ')}`);

    // Multiple face combinations for one product are valid within a split; only cross-split
    // product reuse is leakage. A Set cannot contain duplicates, so checking it here would never
    // detect anything useful.
    const missingStructured = [...train, ...heldOut].filter((item) =>
        !Array.isArray(item.categories) || !Array.isArray(item.attributes),
    );
    if (missingStructured.length) {
        errors.push(`${missingStructured.length} combo(s) lack categories/attributes; material-v2 would fall back to name-only classification`);
    }

    const signature = (item: Combo) => {
        const material = item.material?.bucket ?? classifyMaterial({
            name: item.productName,
            categories: (item.categories ?? []).map((name) => ({ id: 0, name, slug: name })),
            attributes: item.attributes ?? [],
        }).bucket;
        const p = classifyStrap(item.productName, item.categories ?? [], item.attributes ?? []);
        return [material, p.style, p.padded ? 'padded' : 'flat', p.curvedEnd ? 'curved' : 'straight', p.stitch, p.tipShape, p.thickness,
            p.canvasAlligatorMix ? 'canvas-alligator-mix' : 'single-material'].join('/');
    };
    const materialKey = (item: Combo) => item.material?.bucket ?? classifyMaterial({
        name: item.productName,
        categories: (item.categories ?? []).map((name) => ({ id: 0, name, slug: name })),
        attributes: item.attributes ?? [],
    }).bucket;
    const trainMaterials = new Set(train.map(materialKey));
    const counts = new Map<string, { train: number; heldOut: number }>();
    const sets: Array<['train' | 'heldOut', Combo[]]> = [['train', train], ['heldOut', heldOut]];
    for (const [set, items] of sets) {
        for (const item of items) {
            const key = signature(item);
            const count = counts.get(key) ?? { train: 0, heldOut: 0 };
            count[set]++;
            counts.set(key, count);
        }
    }
    for (const [key, count] of counts) {
        if (count.heldOut > 0 && count.train === 0) console.warn(`⚠️ held-out construction has no exact train match: ${key}`);
        if (count.train > 0 && count.heldOut === 0) console.warn(`⚠️ no held-out coverage for: ${key}`);
    }
    for (const key of new Set([...train.map(materialKey), ...heldOut.map(materialKey)])) {
        if (heldOut.some((item) => materialKey(item) === key) && !trainMaterials.has(key)) {
            errors.push(`held-out material has no train support: ${key}`);
        }
    }

    console.log(`train=${train.length} heldOut=${heldOut.length} materialBuckets=${counts.size}`);
    for (const [key, count] of [...counts.entries()].sort(([a], [b]) => a.localeCompare(b))) {
        console.log(`  ${key}: train=${count.train} heldOut=${count.heldOut}`);
    }
    if (errors.length) {
        console.error('\n❌ material preflight failed:');
        for (const error of errors) console.error(`  - ${error}`);
        process.exit(1);
    }
    console.log('✅ material preflight passed (local-only)');
}

main().catch((error) => {
    console.error('❌', error instanceof Error ? error.message : error);
    process.exit(1);
});
