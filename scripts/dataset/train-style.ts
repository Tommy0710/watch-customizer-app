import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import Replicate from 'replicate';
import { TRIGGER_WORD } from './styleDataset';
import { describeError } from '../lib/reportError';

// Trains the style LoRA on ostris/flux-dev-lora-trainer — the pair-based Kontext trainer this
// project was designed around returns 500 on every version, so the approach moved to a style LoRA
// applied over img2img. See pack-style-dataset.ts for the reasoning.

const OUT_DIR = path.join(process.cwd(), 'scripts/dataset/out');
const TRAINER_OWNER = 'ostris';
const TRAINER_NAME = 'flux-dev-lora-trainer';
const DESTINATION = 'tommy0710/watch-lora';

const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });

function arg(name: string, fallback: string): string {
    const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : fallback;
}

async function main() {
    const steps = Number(arg('steps', '1000'));
    const zip = await readFile(path.join(OUT_DIR, 'style-dataset.zip'));

    const model = await replicate.models.get(TRAINER_OWNER, TRAINER_NAME);
    const version = model.latest_version!.id;

    console.log(`📦 style-dataset.zip ${(zip.length / 1024 / 1024).toFixed(1)} MB`);
    console.log(`🎯 ${DESTINATION} · ${steps} steps · trigger "${TRIGGER_WORD}" · seed 19826`);

    // Uploaded first and passed by URL: handing the trainer an inline File is what made the other
    // trainer answer with a bare 500, and there is no reason to risk the same here.
    const uploaded = await replicate.files.create(
        new File([new Uint8Array(zip)], 'style-dataset.zip', { type: 'application/zip' }),
    );
    console.log(`⬆️  uploaded → ${uploaded.urls.get}`);

    const training = await replicate.trainings.create(TRAINER_OWNER, TRAINER_NAME, version, {
        destination: DESTINATION as `${string}/${string}`,
        input: {
            input_images: uploaded.urls.get,
            trigger_word: TRIGGER_WORD,
            steps,
            seed: 19826,
            lora_rank: 16,
            // Captions are written by pack-style-dataset.ts from real product names, which are far
            // more accurate than Llava guessing at leather types.
            autocaption: false,
            ...(process.env.HF_TOKEN && process.env.HF_REPO_ID
                ? { hf_token: process.env.HF_TOKEN, hf_repo_id: process.env.HF_REPO_ID }
                : {}),
        },
    });

    console.log(`🚀 ${training.id} — https://replicate.com/p/${training.id}`);
    await writeFile(path.join(OUT_DIR, 'training.json'),
        JSON.stringify({ id: training.id, status: training.status, destination: DESTINATION, trigger: TRIGGER_WORD }, null, 2));

    let current = training;
    while (current.status === 'starting' || current.status === 'processing') {
        await new Promise((r) => setTimeout(r, 30_000));
        current = await replicate.trainings.get(current.id);
        console.log(`   ${new Date().toISOString().slice(11, 19)} ${current.status}`);
    }

    if (current.status !== 'succeeded') {
        throw new Error(`Training ${current.status}: ${JSON.stringify(current.error)}`);
    }

    const weights = (current.output as { weights?: string; version?: string } | null);
    await writeFile(path.join(OUT_DIR, 'training.json'), JSON.stringify(
        { id: current.id, status: current.status, destination: DESTINATION, trigger: TRIGGER_WORD, output: weights }, null, 2));
    console.log(`✅ done — ${JSON.stringify(weights)}`);
    process.exit(0);
}

main().catch((err) => {
    console.error('❌', describeError(err));
    process.exit(1);
});
