import { readdir, readFile, writeFile, unlink, access } from 'node:fs/promises';
import path from 'node:path';

// Reads the three verdicts a reviewer can express in the strap-pick folder:
//
//   left in place        → the render is good
//   dragged to DAO-NGUOC → the render is fine but its two segments are the wrong way round
//   deleted              → the render is wrong (colour, material, a second buckle) and must go
//
// Reversed is kept separate from rejected on purpose. A reversed render costs nothing to fix — the
// buckle and tail halves just need swapping — whereas a rejected one has to be regenerated, which
// costs money. Conflating them would throw away good renders.

const OUT_DIR = path.join(process.cwd(), 'scripts/dataset/out');
const CLEAN_DIR = path.join(OUT_DIR, 'straps-clean');
const PICK_DIR = path.join(OUT_DIR, 'strap-pick');
const REVERSED_DIR = path.join(PICK_DIR, 'DAO-NGUOC');

const idsIn = async (dir: string): Promise<number[]> => {
    try {
        return (await readdir(dir))
            .filter((f) => f.endsWith('.jpg'))
            .map((f) => Number(f.replace(/\.jpg$/, '').split('__')[1]))
            .filter((n) => Number.isFinite(n));
    } catch {
        return [];
    }
};

async function main() {
    const reversed = await idsIn(REVERSED_DIR);
    const kept = await idsIn(PICK_DIR);
    const surviving = new Set([...kept, ...reversed]);

    if (surviving.size === 0) throw new Error(`${PICK_DIR} is empty — run review-straps.ts first`);

    const renders = (await readdir(CLEAN_DIR)).filter((f) => f.endsWith('.webp'));
    const rejected = renders.map((f) => Number(f.replace('.webp', ''))).filter((id) => !surviving.has(id));

    const dryRun = !process.argv.includes('--delete');
    if (!dryRun) {
        for (const id of rejected) {
            // Deleting rather than just recording it: render-clean-straps.ts skips products that
            // already have a file, so a rejected render left in place would be reused forever.
            try { await unlink(path.join(CLEAN_DIR, `${id}.webp`)); } catch { /* already gone */ }
        }
    }

    await writeFile(
        path.join(OUT_DIR, 'strap-review.json'),
        JSON.stringify({ good: kept, reversed, rejected }, null, 2),
    );

    console.log(`good ${kept.length} · reversed ${reversed.length} · rejected ${rejected.length}  (of ${renders.length})`);
    if (reversed.length) console.log(`   reversed ids: ${reversed.join(', ')} — segments will be swapped when building drafts`);
    if (rejected.length) console.log(`   rejected ids: ${rejected.join(', ')}`);
    console.log(dryRun
        ? '   dry run — re-run with --delete to remove the rejected renders so they get regenerated'
        : '   rejected renders deleted; render-clean-straps.ts will redo them next run');
    process.exit(0);
}

main().catch((err) => { console.error('❌', err); process.exit(1); });
