import type { Product } from './woocommerce';

export const ALLOWED_STRAP_CATEGORIES = ['Classic Watch Straps', 'Vintage Watch Straps'] as const;
const EXCLUDED_CLASSIC_PATTERNS = [
    /apple\s*watch/i,
    /single\s*folding/i,
    /double\s*folding/i,
    /folding\s*(?:clasp|buckle)/i,
    /deploy(?:ant|ment)/i,
];

/** Shared scope for the customer picker and every dataset script. */
export function isSelectableWatchStrap(product: Pick<Product, 'name' | 'categories' | 'attributes'>): boolean {
    if (!product.categories.some((category) => ALLOWED_STRAP_CATEGORIES.includes(category.name as typeof ALLOWED_STRAP_CATEGORIES[number]))) return false;
    const haystack = [
        product.name,
        ...product.categories.map((category) => category.name),
        ...product.attributes.flatMap((attribute) => [attribute.name, ...attribute.options]),
    ].join(' ');
    return !EXCLUDED_CLASSIC_PATTERNS.some((pattern) => pattern.test(haystack));
}
