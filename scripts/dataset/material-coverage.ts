import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Combo } from './selectCombos';
import { describeError } from '../lib/reportError';

const OUT_DIR = path.join(process.cwd(), 'scripts/dataset/out');
const REQUIRED_FAMILIES = [
    'alligator', 'hornback-alligator', 'python', 'lizard', 'stingray', 'sea-snake',
    'ostrich', 'ostrich-leg', 'shell-cordovan', 'peccary', 'shark', 'sailcloth', 'canvas',
    'alcantara', 'suede', 'nubuck', 'saffiano', 'epi', 'smooth-calf',
];

type Split = { train?: Combo[]; heldOut?: Combo[]; activeMaterialFamilies?: string[] };

function count(items: Combo[]): Record<string, number> {
    return items.reduce<Record<string, number>>((out, combo) => {
        const key = combo.material?.family ?? 'unknown';
        out[key] = (out[key] ?? 0) + 1;
        return out;
    }, {});
}

async function main() {
    const split = JSON.parse(await readFile(path.join(OUT_DIR, 'combos.json'), 'utf8')) as Split;
    const train = split.train ?? [];
    const heldOut = split.heldOut ?? [];
    const trainProducts = new Set(train.map((combo) => combo.productId));
    const heldOutProducts = new Set(heldOut.map((combo) => combo.productId));
    const overlap = [...trainProducts].filter((id) => heldOutProducts.has(id));
    const requiredFamilies = REQUIRED_FAMILIES.filter((family) =>
        !split.activeMaterialFamilies || split.activeMaterialFamilies.includes(family));
    const report = {
        reportVersion: 1,
        train: { combos: train.length, products: trainProducts.size, byFamily: count(train) },
        heldOut: { combos: heldOut.length, products: heldOutProducts.size, byFamily: count(heldOut) },
        activeMaterialFamilies: split.activeMaterialFamilies ?? null,
        missingRequiredFamilies: requiredFamilies.filter((family) => !((count(train)[family] ?? 0) > 0)),
        heldOutFamiliesWithoutTrainSupport: Object.keys(count(heldOut)).filter((family) => !(count(train)[family] ?? 0)),
        productOverlap: overlap,
        verdict: overlap.length === 0 && train.length > 0 && heldOut.length > 0 ? 'review' : 'blocked',
    };
    const output = path.join(OUT_DIR, 'material-coverage.json');
    await writeFile(output, JSON.stringify(report, null, 2));
    console.log(`✅ material coverage → ${output}`);
    console.log(`   train: ${trainProducts.size} products / ${train.length} combos`);
    console.log(`   held-out: ${heldOutProducts.size} products / ${heldOut.length} combos`);
    console.log(`   product overlap: ${overlap.length}`);
    console.log(`   train families: ${Object.keys(count(train)).sort().join(', ') || '(none)'}`);
    console.log(`   missing required families: ${report.missingRequiredFamilies.join(', ') || '(none)'}`);
    if (overlap.length > 0) console.warn('⚠️ held-out reuses products from train; this is not a clean generalisation split.');
    process.exit(0);
}

main().catch((error) => {
    console.error('❌', describeError(error));
    process.exit(1);
});
