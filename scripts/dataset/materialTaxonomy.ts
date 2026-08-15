import type { Product } from '../../src/lib/woocommerce';

// Material labels are deliberately small and stable. Product names remain in captions because
// they are the production LoRA prompt contract; this taxonomy is for sampling, manifests and
// coverage checks, where spelling variants must not create fake categories.
export type MaterialFamily =
    | 'alligator'
    | 'hornback-alligator'
    | 'python'
    | 'lizard'
    | 'stingray'
    | 'sea-snake'
    | 'ostrich'
    | 'ostrich-leg'
    | 'shell-cordovan'
    | 'peccary'
    | 'black-diamond'
    | 'shark'
    | 'sailcloth'
    | 'canvas'
    | 'alcantara'
    | 'suede'
    | 'nubuck'
    | 'saffiano'
    | 'epi'
    | 'vachetta'
    | 'pueblo'
    | 'habana'
    | 'babele'
    | 'chevre'
    | 'sully'
    | 'swift'
    | 'box-calf'
    | 'smooth-calf'
    | 'vegetable-tanned'
    | 'waxed'
    | 'other-leather';

export type MaterialSurface =
    | 'scale'
    | 'hornback'
    | 'pebbled'
    | 'embossed'
    | 'suede-nap'
    | 'woven'
    | 'rubber'
    | 'patina'
    | 'smooth'
    | 'unknown';

export type MaterialProfile = {
    family: MaterialFamily;
    surface: MaterialSurface;
    bucket: string;
    source: 'attribute' | 'name-or-category' | 'fallback';
};

type Rule = { family: MaterialFamily; pattern: RegExp; surface: MaterialSurface };

// Order matters: specific constructions must win over their parent material (hornback before
// alligator, ostrich leg before ostrich, and sailcloth/rubber before either generic word).
const RULES: Rule[] = [
    { family: 'hornback-alligator', pattern: /double\s+hornback|hornback\s+alligator/i, surface: 'hornback' },
    { family: 'ostrich-leg', pattern: /ostrich\s+leg/i, surface: 'pebbled' },
    { family: 'sea-snake', pattern: /sea\s+snake|snake\s+sea/i, surface: 'scale' },
    { family: 'shell-cordovan', pattern: /shell\s+cordovan/i, surface: 'smooth' },
    { family: 'black-diamond', pattern: /black\s+diamond/i, surface: 'embossed' },
    { family: 'sailcloth', pattern: /sailcloth\s*(?:\/|and|-)\s*rubber|sailcloth\s+rubber/i, surface: 'rubber' },
    { family: 'alligator', pattern: /alligator|croc(?:odile)?/i, surface: 'scale' },
    { family: 'python', pattern: /python/i, surface: 'scale' },
    { family: 'lizard', pattern: /lizard/i, surface: 'scale' },
    { family: 'stingray', pattern: /stingray/i, surface: 'pebbled' },
    { family: 'ostrich', pattern: /ostrich/i, surface: 'pebbled' },
    { family: 'peccary', pattern: /peccary/i, surface: 'pebbled' },
    { family: 'shark', pattern: /shark/i, surface: 'pebbled' },
    { family: 'canvas', pattern: /canvas/i, surface: 'woven' },
    { family: 'alcantara', pattern: /alcantara/i, surface: 'suede-nap' },
    { family: 'saffiano', pattern: /saffiano/i, surface: 'embossed' },
    { family: 'epi', pattern: /\bepi\b/i, surface: 'embossed' },
    { family: 'suede', pattern: /suede/i, surface: 'suede-nap' },
    { family: 'nubuck', pattern: /nubuck/i, surface: 'suede-nap' },
    { family: 'vachetta', pattern: /vachetta/i, surface: 'patina' },
    { family: 'pueblo', pattern: /pueblo|badalassi\s+carlo/i, surface: 'patina' },
    { family: 'habana', pattern: /habana/i, surface: 'patina' },
    { family: 'babele', pattern: /babele/i, surface: 'smooth' },
    { family: 'chevre', pattern: /chevre|goat/i, surface: 'pebbled' },
    { family: 'sully', pattern: /sully/i, surface: 'pebbled' },
    { family: 'swift', pattern: /swift/i, surface: 'smooth' },
    { family: 'box-calf', pattern: /box\s+calf/i, surface: 'smooth' },
    { family: 'vegetable-tanned', pattern: /vegetable[- ]tann|veg[- ]tann/i, surface: 'patina' },
    { family: 'waxed', pattern: /waxed/i, surface: 'smooth' },
    { family: 'smooth-calf', pattern: /smooth\s+calf|calfskin|calf\s+leather/i, surface: 'smooth' },
];

function haystack(product: Pick<Product, 'name' | 'categories' | 'attributes'>): { text: string; attributeText: string } {
    const attributeText = product.attributes.map((a) => `${a.name} ${a.options.join(' ')}`).join(' | ');
    const text = `${product.name} ${product.categories.map((c) => c.name).join(' ')} ${attributeText}`;
    return { text, attributeText };
}

export function classifyMaterial(product: Pick<Product, 'name' | 'categories' | 'attributes'>): MaterialProfile {
    const { text, attributeText } = haystack(product);
    const attributeRule = RULES.find((rule) => rule.pattern.test(attributeText));
    const rule = attributeRule ?? RULES.find((candidate) => candidate.pattern.test(text));
    if (!rule) return { family: 'other-leather', surface: 'unknown', bucket: 'other-leather:unknown', source: 'fallback' };
    return {
        family: rule.family,
        surface: rule.surface,
        bucket: `${rule.family}:${rule.surface}`,
        source: attributeRule ? 'attribute' : 'name-or-category',
    };
}

export type MaterialCoverage = {
    total: number;
    byFamily: Record<string, number>;
    byBucket: Record<string, number>;
};

export function summarizeMaterialCoverage(products: Array<Pick<Product, 'name' | 'categories' | 'attributes'>>): MaterialCoverage {
    const byFamily: Record<string, number> = {};
    const byBucket: Record<string, number> = {};
    for (const product of products) {
        const material = classifyMaterial(product);
        byFamily[material.family] = (byFamily[material.family] ?? 0) + 1;
        byBucket[material.bucket] = (byBucket[material.bucket] ?? 0) + 1;
    }
    return { total: products.length, byFamily, byBucket };
}

/**
 * A family is trainable only while at least one product in that family is sellable.
 * Unknown stock status is treated as sellable for backwards compatibility with old Mongo rows.
 */
export function activeMaterialFamilies(products: Array<Pick<Product, 'name' | 'categories' | 'attributes' | 'stockStatus'>>): Set<MaterialFamily> {
    const active = new Set<MaterialFamily>();
    for (const product of products) {
        if (product.stockStatus && product.stockStatus !== 'instock') continue;
        active.add(classifyMaterial(product).family);
    }
    return active;
}
