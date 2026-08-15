import { readFile, writeFile, mkdir, rm, readdir } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { TRIGGER_WORD } from './styleDataset';
import { buildMaterialAwareLoraPrompt } from '../../src/lib/loraPrompt';
import { buildMaterialClause, classifyMaterial } from '../../src/lib/materialTaxonomy';
import { buildStrapProfileClause, classifyStrap, type Attribute } from '../../src/lib/strapProfile';
import { describeError } from '../lib/reportError';

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
    const parsed = JSON.parse(await readFile(path.join(OUT_DIR, 'approved.json'), 'utf8')) as { approved?: unknown };
    if (!Array.isArray(parsed.approved) || !parsed.approved.every((id): id is string => typeof id === 'string' && id.length > 0)) {
        throw new Error('approved.json must contain an approved array of non-empty string IDs.');
    }
    const approved = [...new Set(parsed.approved)];
    const manifest: { id: string; productName: string; categories?: string[]; attributes?: Attribute[] }[] =
        JSON.parse(await readFile(path.join(OUT_DIR, 'pairs-train.json'), 'utf8'));
    const byId = new Map(manifest.map((m) => [m.id, m]));
    const combos = JSON.parse(await readFile(path.join(OUT_DIR, 'combos.json'), 'utf8')) as {
        activeMaterialFamilies?: string[];
    };
    const activeFamilies = combos.activeMaterialFamilies ? new Set(combos.activeMaterialFamilies) : null;

    await rm(STAGE_DIR, { recursive: true, force: true });
    await mkdir(STAGE_DIR, { recursive: true });

    let packed = 0;
    for (const id of approved) {
        const pair = byId.get(id);
        if (!pair) continue;

        try {
            const material = classifyMaterial({ name: pair.productName, categories: pair.categories ?? [], attributes: pair.attributes ?? [] });
            if (activeFamilies && !activeFamilies.has(material.family)) {
                console.warn(`  ⏭ skipping ${id}: inactive material family ${material.family}`);
                continue;
            }
            const image = await readFile(path.join(PAIR_DIR, `${id}_end.webp`));
            const base = String(packed).padStart(3, '0');
            // JPEG at 4:4:4 — full chroma resolution, so the fine leather grain the model has to
            // learn survives the encode.
            await sharp(image).jpeg({ quality: 95, chromaSubsampling: '4:4:4' })
                .toFile(path.join(STAGE_DIR, `${base}.jpg`));
            const profile = classifyStrap(pair.productName, pair.categories ?? [], pair.attributes ?? []);
            await writeFile(path.join(STAGE_DIR, `${base}.txt`), buildMaterialAwareLoraPrompt(
                pair.productName,
                buildStrapProfileClause(profile),
                buildMaterialClause(material),
            ));
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
    const example = byId.get(approved[0]);
    console.log(`   prompt schema: material-v2 (${TRIGGER_WORD})`);
    console.log(`   example caption: ${example ? buildMaterialAwareLoraPrompt(example.productName, buildStrapProfileClause(classifyStrap(example.productName, example.categories ?? [], example.attributes ?? [])), buildMaterialClause(classifyMaterial({ name: example.productName, categories: example.categories ?? [], attributes: example.attributes ?? [] }))) : 'n/a'}`);
    process.exit(0);
}

main().catch((err) => {
    console.error('❌', describeError(err));
    process.exit(1);
});
