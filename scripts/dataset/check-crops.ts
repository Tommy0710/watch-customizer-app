import { readdir, readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { describeError } from '../lib/reportError';

// cropToStrap hands back the ORIGINAL buffer when detection fails, and older runs saved that
// fallback to disk — a staged prop shot sitting where a cropped strap should be, which the next
// run would then skip forever. The fallback is trivially identifiable: a real crop is re-encoded
// as PNG, while the untouched original is still JPEG bytes under a .png name.
//
// Pass --delete to remove them so prepare-straps.ts retries those products.

async function main() {
    const dir = path.join(process.cwd(), 'scripts/dataset/out/straps');
    const files = (await readdir(dir)).filter((f) => f.endsWith('.png'));
    const suspect: string[] = [];

    for (const file of files) {
        const meta = await sharp(await readFile(path.join(dir, file))).metadata();
        if (meta.format !== 'png') suspect.push(file);
    }

    console.log(`${files.length - suspect.length}/${files.length} are real crops`);
    if (suspect.length === 0) return process.exit(0);

    console.log(`⚠️ ${suspect.length} uncropped fallbacks: ${suspect.map((s) => s.replace('.png', '')).join(', ')}`);
    if (process.argv.includes('--delete')) {
        for (const file of suspect) await unlink(path.join(dir, file));
        console.log('   deleted — re-run prepare-straps.ts to retry them');
    } else {
        console.log('   re-run with --delete to remove them so they get retried');
    }
    process.exit(0);
}

main().catch((err) => { console.error('❌', describeError(err)); process.exit(1); });
