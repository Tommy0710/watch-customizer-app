import { readdir, readFile, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';

// Turns whatever survived the strap review into the accepted list, and removes the rejected
// renders so nothing downstream can build a draft from them.
//
// Deleting the render rather than just recording a verdict is deliberate: render-clean-straps.ts
// skips products that already have a file, so a rejected render left in place would be reused
// forever. Deleting it means the next run re-renders that strap and gets another chance.

const OUT_DIR = path.join(process.cwd(), 'scripts/dataset/out');
const CLEAN_DIR = path.join(OUT_DIR, 'straps-clean');
const PICK_DIR = path.join(OUT_DIR, 'strap-pick');

async function main() {
    const kept = new Set(
        (await readdir(PICK_DIR))
            .filter((f) => f.endsWith('.jpg'))
            .map((f) => Number(f.replace(/\.jpg$/, '').split('__')[1]))
            .filter((n) => Number.isFinite(n)),
    );

    const renders = (await readdir(CLEAN_DIR)).filter((f) => f.endsWith('.webp'));
    const rejected = renders.map((f) => Number(f.replace('.webp', ''))).filter((id) => !kept.has(id));

    if (kept.size === 0) throw new Error(`${PICK_DIR} is empty — run review-straps.ts first`);

    const dryRun = !process.argv.includes('--delete');
    for (const id of rejected) {
        if (!dryRun) await unlink(path.join(CLEAN_DIR, `${id}.webp`));
    }

    await writeFile(
        path.join(OUT_DIR, 'strap-review.json'),
        JSON.stringify({ kept: [...kept], rejected }, null, 2),
    );

    console.log(`kept ${kept.size}, rejected ${rejected.length} of ${renders.length}`);
    if (rejected.length) console.log(`   rejected ids: ${rejected.join(', ')}`);
    console.log(dryRun
        ? '   dry run — re-run with --delete to remove the rejected renders so they get regenerated'
        : '   rejected renders deleted; render-clean-straps.ts will redo them on the next run');
    process.exit(0);
}

main().catch((err) => { console.error('❌', err); process.exit(1); });
