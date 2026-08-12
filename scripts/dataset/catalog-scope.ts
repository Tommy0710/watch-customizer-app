import { getDatabaseProducts, type Product } from '../../src/lib/woocommerce';
import { describeError } from '../lib/reportError';

// How many straps a full pre-launch render actually has to cover. The dataset pipeline was built
// from a 96-product sample, so every cost estimate drawn from it understates the real catalog.

const ALLOWED = ['Classic Watch Straps', 'Vintage Watch Straps'];

async function main() {
    const all = await getDatabaseProducts();
    const visible = all.filter((p: Product) => p.categories.some((c) => ALLOWED.includes(c.name)));
    const withImage = visible.filter((p: Product) => p.image);
    console.log(`${all.length} products in MongoDB`);
    console.log(`${visible.length} visible in the UI (categories ${ALLOWED.join(', ')})`);
    console.log(`${withImage.length} of those have a catalog photo to render from`);
    console.log(`${visible.length - withImage.length} have no photo — nothing to render`);
    process.exit(0);
}
main().catch((e) => { console.error('❌', describeError(e)); process.exit(1); });
