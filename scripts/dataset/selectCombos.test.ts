import { describe, it, expect } from 'vitest';
import { selectCombos } from './selectCombos';
import type { Product } from '../../src/lib/woocommerce';
import type { FaceItem } from '../../src/lib/aws';

function product(id: number, name: string, category: string, attrs: { name: string; options: string[] }[] = []): Product {
  return {
    id, name, price: '0', link: '', image: `https://cdn.example/${id}.jpg`, thumbnail: '',
    attributes: attrs, categories: [{ id: 1, name: category, slug: category }], tags: [],
  };
}
function face(key: string, category: string): FaceItem {
  return { key, name: key, category };
}

const PRODUCTS: Product[] = [
  product(1, 'Padded Classic', 'Classic Watch Straps', [{ name: 'Material', options: ['Padded'] }]),
  product(2, 'Flat Classic', 'Classic Watch Straps'),
  product(3, 'Vintage Racing', 'Vintage Watch Straps'),
  product(4, 'Vintage Bund', 'Vintage Watch Straps', [{ name: 'Material', options: ['Padded'] }]),
];
const FACES: FaceItem[] = [
  face('f/rolex/a.jpg', 'rolex'), face('f/rolex/b.jpg', 'rolex'),
  face('f/omega/c.jpg', 'omega'), face('f/seiko/d.jpg', 'seiko'),
];

describe('selectCombos', () => {
  it('returns exactly the requested count', () => {
    expect(selectCombos(PRODUCTS, FACES, 8)).toHaveLength(8);
  });

  it('is deterministic across runs', () => {
    expect(selectCombos(PRODUCTS, FACES, 8)).toEqual(selectCombos(PRODUCTS, FACES, 8));
  });

  it('gives every product bucket a turn before repeating one', () => {
    const buckets = selectCombos(PRODUCTS, FACES, 4).map((c) => c.bucket);
    expect(new Set(buckets).size).toBeGreaterThan(1);
  });

  it('spreads faces across brand categories', () => {
    const categories = new Set(selectCombos(PRODUCTS, FACES, 6).map((c) => c.faceKey.split('/')[1]));
    expect(categories.size).toBeGreaterThan(1);
  });

  it('never emits the same product+face pair twice', () => {
    const combos = selectCombos(PRODUCTS, FACES, 12);
    const ids = combos.map((c) => `${c.productId}::${c.faceKey}`);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('terminates and never exceeds the unique pairs available', () => {
    // 4 products x 4 faces = 16 possible pairs. Round-robin plus a bounded attempt budget may
    // stop a little short of exhausting them; what matters is that it terminates and never
    // invents a duplicate.
    const combos = selectCombos(PRODUCTS, FACES, 999);
    expect(combos.length).toBeLessThanOrEqual(16);
    expect(combos.length).toBeGreaterThanOrEqual(12);
  });

  it('carries the product categories and attributes needed for the prompt clause', () => {
    const combo = selectCombos(PRODUCTS, FACES, 4)[0];
    expect(Array.isArray(combo.categories)).toBe(true);
    expect(Array.isArray(combo.attributes)).toBe(true);
  });

  it('gives each combo a stable, filesystem-safe id', () => {
    for (const combo of selectCombos(PRODUCTS, FACES, 4)) {
      expect(combo.id).toMatch(/^[a-z0-9-]+$/);
    }
  });

  it('does not collapse to the diagonal when strap and face bucket counts match', () => {
    // Regression: advancing both cursors by one per step locks them together whenever the two
    // bucket counts share a factor. With 3 strap buckets and 3 face buckets that visited only
    // (0,0),(1,1),(2,2) — 3 of 9 pairings — and quietly returned 5 combos instead of 16.
    // These four products classify into exactly 3 buckets, and the faces into exactly 3.
    // The guarantee is coverage of bucket PAIRINGS, not exhaustion of every product+face pair —
    // a deterministic walk over unevenly sized buckets legitimately leaves a couple untouched.
    const combos = selectCombos(PRODUCTS, FACES, 16);
    const pairings = new Set(combos.map((c) => `${c.bucket}::${c.faceKey.split('/')[1]}`));
    expect(pairings.size).toBe(9); // all 3 strap buckets x all 3 face buckets; the bug gave 3
  });

  it('throws when either catalog is empty', () => {
    expect(() => selectCombos([], FACES, 4)).toThrow();
    expect(() => selectCombos(PRODUCTS, [], 4)).toThrow();
  });
});
