import { readFile, writeFile, mkdir, rm, readdir } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { TRIGGER_WORD, caption } from './styleDataset';

// Packs the approved "after" images as a style dataset for ostris/flux-dev-lora-trainer.
//
// Why a style LoRA rather than the before/after pairs the project was designed around: Replicate's
// only pair-based trainer (fast-flux-kontext-trainer) returns 500 on every request across all
// eight of its published versions, verified with a valid destination and live credit. Every
// trainer that still works on Replicate learns from single captioned images.
//
// So the target changes from "learn this edit" to "learn what a correctly assembled HANDDN watch
// photo looks like", and the draft becomes the img2img starting point at inference instead of a
// training input. The draft already carries the right strap colour, grain, and layout; a low
// prompt_strength keeps them while the LoRA supplies the realism.

const run = promisify(execFile);
const OUT_DIR = path.join(process.cwd(), 'scripts/dataset/out');
const PAIR_DIR = path.join(OUT_DIR, 'pairs');
const STAGE_DIR = path.join(OUT_DIR, 'style-stage');
const MIN_IMAGES = 10; // the trainer's own recommended floor


async function main() {
    const { approved }: { approved: string[] } = JSON.parse(await readFile(path.join(OUT_DIR, 'approved.json'), 'utf8'));
    const manifest: { id: string; productName: string }[] =
        JSON.parse(await readFile(path.join(OUT_DIR, 'pairs-train.json'), 'utf8'));
    const nameById = new Map(manifest.map((m) => [m.id, m.productName]));

    await rm(STAGE_DIR, { recursive: true, force: true });
    await mkdir(STAGE_DIR, { recursive: true });

    let packed = 0;
    for (const id of approved) {
        const productName = nameById.get(id);
        if (!productName) continue;

        try {
            const image = await readFile(path.join(PAIR_DIR, `${id}_end.webp`));
            const base = String(packed).padStart(3, '0');
            // JPEG at 4:4:4 — full chroma resolution, so the fine leather grain the model has to
            // learn survives the encode.
            await sharp(image).jpeg({ quality: 95, chromaSubsampling: '4:4:4' })
                .toFile(path.join(STAGE_DIR, `${base}.jpg`));
            await writeFile(path.join(STAGE_DIR, `${base}.txt`), caption(productName));
            packed++;
        } catch (err) {
            console.warn(`  ⚠️ skipping ${id}: ${(err as Error).message.slice(0, 60)}`);
        }
    }

    if (packed < MIN_IMAGES) {
        throw new Error(`Only ${packed} images packed; the trainer wants at least ${MIN_IMAGES}.`);
    }

    const zipPath = path.join(OUT_DIR, 'style-dataset.zip');
    await rm(zipPath, { force: true });
    const files = (await readdir(STAGE_DIR)).map((f) => path.join(STAGE_DIR, f));
    await run('zip', ['-j', '-q', zipPath, ...files]);

    console.log(`✅ ${packed} images + captions → ${zipPath}`);
    console.log(`   trigger word: ${TRIGGER_WORD}`);
    console.log(`   example caption: ${caption(nameById.get(approved[0]) ?? 'Leather')}`);
    process.exit(0);
}

main().catch((err) => {
    console.error('❌', err);
    process.exit(1);
});
