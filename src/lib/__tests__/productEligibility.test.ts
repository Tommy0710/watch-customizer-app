import { describe, expect, it } from 'vitest';
import { isSelectableWatchStrap } from '@/lib/productEligibility';

function product(name: string, category = 'Classic Watch Straps', options: string[] = []) {
    return {
        name,
        categories: [{ id: 1, name: category, slug: category.toLowerCase().replace(/\s+/g, '-') }],
        attributes: options.length ? [{ name: 'Type', options }] : [],
    };
}

describe('isSelectableWatchStrap', () => {
    it('keeps a normal classic strap', () => {
        expect(isSelectableWatchStrap(product('Navy Alligator Leather Watch Strap'))).toBe(true);
    });

    it('rejects non-classic categories and constructions', () => {
        expect(isSelectableWatchStrap(product('Vintage Leather Strap', 'Vintage Watch Straps'))).toBe(true);
        expect(isSelectableWatchStrap(product('Apple Watch Leather Strap'))).toBe(false);
        expect(isSelectableWatchStrap(product('Single Folding Clasp Strap'))).toBe(false);
        expect(isSelectableWatchStrap(product('Double Folding Buckle Strap'))).toBe(false);
    });

    it('checks attributes as well as the product name', () => {
        expect(isSelectableWatchStrap(product('Black Leather Strap', 'Classic Watch Straps', ['Deployant']))).toBe(false);
    });
});
