import type { Product } from '../../src/lib/woocommerce';
import type { FaceItem } from '../../src/lib/aws';
import { classifyStrap, type Attribute } from '../../src/lib/strapProfile';
import { classifyMaterial, type MaterialProfile } from './materialTaxonomy';

export type Combo = {
    id: string;
    productId: number;
    productName: string;
    strapImage: string;
    // Carried so generate-pairs.ts can rebuild the exact strap-profile prompt clause production
    // uses. classifyStrap prefers real WooCommerce attributes over guessing from the name.
    categories: string[];
    attributes: Attribute[];
    faceKey: string;
    faceName: string;
    bucket: string;
    material: MaterialProfile;
    materialBucket: string;
};

// Deterministic PRNG. Math.random would make a re-run pick a different sample, which defeats
// reproducing a training set later.
function lcg(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state / 0x100000000;
    };
}

function shuffled<T>(items: T[], rand: () => number): T[] {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
}

// Straps that share a construction profile teach the model the same thing, so the profile — not
// the product — is the unit we balance across.
function bucketOf(product: Product): string {
        const profile = classifyStrap(
        product.name,
        product.categories.map((c) => c.name),
        product.attributes,
    );
    // Field names come straight from the StrapProfile type — note it is `tipShape`, not `tip`,
    // and `stitch` is always set ('none' rather than undefined).
    return [
        profile.style,
        profile.padded ? 'padded' : 'flat',
        profile.curvedEnd ? 'curved' : 'straight',
        profile.stitch,
        profile.tipShape,
    ].join('-');
}

function materialBucketOf(product: Product): string {
    return classifyMaterial(product).bucket;
}

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
    const map = new Map<string, T[]>();
    for (const item of items) {
        const k = key(item);
        if (!map.has(k)) map.set(k, []);
        map.get(k)!.push(item);
    }
    return map;
}

export function selectCombos(products: Product[], faces: FaceItem[], count: number): Combo[] {
    if (products.length === 0) throw new Error('No products available to sample from');
    if (faces.length === 0) throw new Error('No faces available to sample from');

    const rand = lcg(19826);

    // Balance construction and material together. Without this second key, a large group of
    // smooth calf straps can consume the round-robin turns and leave exotic materials invisible.
    const productBuckets = [...groupBy(products, (product) => `${materialBucketOf(product)}::${bucketOf(product)}`).entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, items]) => ({
            bucket: items.length > 0 ? bucketOf(items[0]) : key,
            materialBucket: items.length > 0 ? materialBucketOf(items[0]) : key,
            items: shuffled(items, rand),
        }));

    const faceBuckets = [...groupBy(faces, (f) => f.category).entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([, items]) => shuffled(items, rand));

    const combos: Combo[] = [];
    const seen = new Set<string>();
    const maxPairs = products.length * faces.length;
    const limit = Math.min(count, maxPairs);

    // Per-bucket round-robin cursors. Picking randomly within a bucket relies on luck to
    // eventually touch every item; stepping through them guarantees it.
    const productItemCursor = new Array(productBuckets.length).fill(0);
    const faceItemCursor = new Array(faceBuckets.length).fill(0);

    // The face bucket advances once per FULL sweep of the product buckets. Advancing both by one
    // each step looks fair but locks them together whenever the two bucket counts share a factor
    // — with 3 strap buckets and 3 face buckets it only ever visits the diagonal (0,0),(1,1),(2,2),
    // i.e. 3 of 9 pairings, silently producing a badly skewed dataset. This visits all of them.
    let step = 0;
    let attempts = 0;
    const maxAttempts = maxPairs * 4 + 1000;

    while (combos.length < limit && attempts < maxAttempts) {
        attempts++;
        const pIndex = step % productBuckets.length;
        const fIndex = Math.floor(step / productBuckets.length) % faceBuckets.length;
        step++;

        const pb = productBuckets[pIndex];
        const fb = faceBuckets[fIndex];

        const product = pb.items[productItemCursor[pIndex]++ % pb.items.length];
        const face = fb[faceItemCursor[fIndex]++ % fb.length];
        const pairKey = `${product.id}::${face.key}`;
        if (seen.has(pairKey)) continue;
        seen.add(pairKey);

        combos.push({
            id: `${String(combos.length).padStart(3, '0')}-${slug(product.name)}-${slug(face.name)}`.slice(0, 80),
            productId: product.id,
            productName: product.name,
            strapImage: product.image,
            categories: product.categories.map((c) => c.name),
            attributes: product.attributes,
            faceKey: face.key,
            faceName: face.name,
            bucket: pb.bucket,
            material: classifyMaterial(product),
            materialBucket: pb.materialBucket,
        });
    }

    return combos;
}

function slug(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'x';
}
