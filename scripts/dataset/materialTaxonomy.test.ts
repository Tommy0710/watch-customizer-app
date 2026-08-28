import { describe, expect, it } from 'vitest';
import { activeMaterialFamilies, classifyMaterial } from './materialTaxonomy';

function product(name: string, attributes: { name: string; options: string[] }[] = []) {
    return { name, attributes, categories: [{ id: 1, name: 'Classic Watch Straps', slug: 'classic' }] };
}

describe('classifyMaterial', () => {
    it('prefers specific exotic constructions over parent labels', () => {
        expect(classifyMaterial(product('Black Double Hornback Alligator Watch Strap')).family)
            .toBe('hornback-alligator');
        expect(classifyMaterial(product('Green Ostrich Leg Leather Watch Strap')).family)
            .toBe('ostrich-leg');
    });

    it('uses structured material attributes before the product name', () => {
        expect(classifyMaterial(product('Blue Custom Strap', [{ name: 'Material', options: ['Python'] }]))).toEqual({
            family: 'python', surface: 'scale', bucket: 'python:scale', source: 'attribute',
        });
    });

    it('keeps mixed sailcloth/rubber and canvas material families distinct', () => {
        expect(classifyMaterial(product('Sailcloth Rubber Watch Strap')).family).toBe('sailcloth');
        expect(classifyMaterial(product('Black Canvas Watch Strap')).family).toBe('canvas');
    });

    it('classifies stingray with specialized pearl granules surface', () => {
        expect(classifyMaterial(product('Blue Galuchat Stingray Watch Strap'))).toEqual({
            family: 'stingray',
            surface: 'stingray-pearl-granules',
            bucket: 'stingray:stingray-pearl-granules',
            source: 'name-or-category',
        });
    });

    it('falls back explicitly instead of inventing a material', () => {
        expect(classifyMaterial(product('Custom Watch Strap')).source).toBe('fallback');
    });
});

describe('activeMaterialFamilies', () => {
    it('excludes families that are entirely out of stock', () => {
        const products = [
            { ...product('Sea Snake'), stockStatus: 'outofstock' as const },
            { ...product('Alligator'), stockStatus: 'instock' as const },
        ];
        expect(activeMaterialFamilies(products)).toEqual(new Set(['alligator']));
    });

    it('keeps a family active when at least one SKU is in stock', () => {
        const products = [
            { ...product('Sea Snake 1'), stockStatus: 'outofstock' as const },
            { ...product('Sea Snake 2'), stockStatus: 'instock' as const },
        ];
        expect(activeMaterialFamilies(products)).toEqual(new Set(['sea-snake']));
    });
});
