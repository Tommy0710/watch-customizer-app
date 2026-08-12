import { readFile, writeFile, mkdir, rm, readdir } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { describeError } from '../lib/reportError';

// Packs approved pairs into the layout replicate/fast-flux-kontext-trainer expects: a flat zip of
// NNN_start.jpg / NNN_end.jpg, no captions (the shared prompt instruction covers every pair).

const run = promisify(execFile);
const OUT_DIR = path.join(process.cwd(), 'scripts/dataset/out');
const PAIR_DIR = path.join(OUT_DIR, 'pairs');
const STAGE_DIR = path.join(OUT_DIR, 'zipstage');
const MIN_PAIRS = 8;

// JPEG because that is the naming convention the trainer documents — but with chroma subsampling
// switched off. The default 4:2:0 smears the fine repeating leather grain the model has to copy,
// which is the same reason the production pipeline sends PNG rather than JPEG.
const JPEG = { quality: 95, chromaSubsampling: '4:4:4' } as const;

// Both sides are resized to one size so the trainer sees a consistent frame.
const PACK_WIDTH = 832;
const PACK_HEIGHT = 1472;

async function main() {
    const approvedPath = path.join(OUT_DIR, 'approved.json');
    let approved: string[];

    try {
        approved = (JSON.parse(await readFile(approvedPath, 'utf8')) as { approved: string[] }).approved;
    } catch {
        // No hand review yet — fall back to every generated pair so the pipeline can be exercised,
        // but say so loudly, because an unreviewed set is exactly how a bad pair reaches training.
        const manifest = JSON.parse(await readFile(path.join(OUT_DIR, 'pairs-train.json'), 'utf8')) as { id: string }[];
        approved = manifest.map((m) => m.id);
        console.warn(`⚠️  No approved.json found — packing ALL ${approved.length} generated pairs unreviewed.`);
        console.warn('   Run build-contact-sheet.ts and review them if this is a real training run.');
    }

    if (approved.length < MIN_PAIRS) {
        throw new Error(`Only ${approved.length} pairs; need at least ${MIN_PAIRS} to justify a training run.`);
    }

    await rm(STAGE_DIR, { recursive: true, force: true });
    await mkdir(STAGE_DIR, { recursive: true });

    let packed = 0;
    for (const id of approved) {
        const n = String(packed).padStart(3, '0');
        try {
            const [start, end] = await Promise.all([
                readFile(path.join(PAIR_DIR, `${id}_start.png`)),
                readFile(path.join(PAIR_DIR, `${id}_end.webp`)),
            ]);
            await sharp(start).resize(PACK_WIDTH, PACK_HEIGHT, { fit: 'fill' }).jpeg(JPEG)
                .toFile(path.join(STAGE_DIR, `${n}_start.jpg`));
            await sharp(end).resize(PACK_WIDTH, PACK_HEIGHT, { fit: 'fill' }).jpeg(JPEG)
                .toFile(path.join(STAGE_DIR, `${n}_end.jpg`));
            packed++;
        } catch (err) {
            console.warn(`  ⚠️ skipping ${id}: ${(err as Error).message.slice(0, 70)}`);
        }
    }

    if (packed < MIN_PAIRS) {
        throw new Error(`Only ${packed} pairs survived packing; need at least ${MIN_PAIRS}.`);
    }

    const zipPath = path.join(OUT_DIR, 'dataset.zip');
    await rm(zipPath, { force: true });
    const files = (await readdir(STAGE_DIR)).map((f) => path.join(STAGE_DIR, f));
    // -j flattens paths: the trainer expects the pairs at the zip root, not inside a folder.
    await run('zip', ['-j', '-q', zipPath, ...files]);

    await writeFile(path.join(OUT_DIR, 'dataset-manifest.json'), JSON.stringify({ packed, approved }, null, 2));
    console.log(`✅ ${packed} pairs → ${zipPath}`);
    process.exit(0);
}

main().catch((err) => {
    console.error('❌', describeError(err));
    process.exit(1);
});
