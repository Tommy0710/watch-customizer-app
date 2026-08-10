import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Turns whatever is left in review-pick/ back into approved.json. Deleting a file there is the
// reject action, so the pairs that survive are the approved set.
//
// Refuses to write an empty or suspiciously tiny list: an empty folder almost always means the
// script ran before the folder was built, and silently approving nothing would be worse than
// stopping.

const OUT_DIR = path.join(process.cwd(), 'scripts/dataset/out');
const PICK_DIR = path.join(OUT_DIR, 'review-pick');
const MIN_APPROVED = 8;

async function main() {
    const manifest: { id: string }[] = JSON.parse(await readFile(path.join(OUT_DIR, 'pairs-train.json'), 'utf8'));
    const known = new Set(manifest.map((m) => m.id));

    let files: string[];
    try {
        files = (await readdir(PICK_DIR)).filter((f) => f.endsWith('.jpg'));
    } catch {
        throw new Error(`${PICK_DIR} does not exist — run make-review-folder.ts first`);
    }

    const approved: string[] = [];
    for (const file of files) {
        // Filenames are "NN__<id>.jpg"; the id is everything after the double underscore.
        const id = file.replace(/\.jpg$/, '').split('__').slice(1).join('__');
        if (known.has(id)) approved.push(id);
        else console.warn(`  ⚠️ ignoring unrecognised file: ${file}`);
    }

    const dropped = manifest.length - approved.length;
    if (approved.length < MIN_APPROVED) {
        throw new Error(
            `Only ${approved.length} images left in review-pick/ — that is below the ${MIN_APPROVED} needed to train. ` +
            'If that is genuinely what you meant, edit approved.json by hand.',
        );
    }

    await writeFile(path.join(OUT_DIR, 'approved.json'), JSON.stringify({ approved }, null, 2));
    console.log(`✅ approved ${approved.length}, dropped ${dropped} of ${manifest.length}`);
    console.log(`   → ${path.join(OUT_DIR, 'approved.json')}`);
    console.log('   Next: npm run ds scripts/dataset/pack-dataset.ts');
    process.exit(0);
}

main().catch((err) => {
    console.error('❌', err);
    process.exit(1);
});
