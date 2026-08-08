import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import Replicate from 'replicate';
import { KONTEXT_PROMPT_INSTRUCTION } from '../../src/lib/segmentedDraft';

const OUT_DIR = path.join(process.cwd(), 'scripts/dataset/out');

const TRAINER_OWNER = 'replicate';
const TRAINER_NAME = 'fast-flux-kontext-trainer';
const TRAINER_VERSION = '26c877b4ec3988b7e8edc5840e61339c68f09913bb11e23c31566590fd92a66d';
const DESTINATION = 'tommy0710/watch-lora';

const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });

function arg(name: string, fallback: string): string {
    const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : fallback;
}

async function main() {
    const steps = Number(arg('steps', '700'));
    const zip = await readFile(path.join(OUT_DIR, 'dataset.zip'));

    console.log(`📦 dataset.zip ${(zip.length / 1024 / 1024).toFixed(1)} MB`);
    console.log(`🎯 ${DESTINATION}, ${steps} steps, seed 19826`);
    console.log(`💬 "${KONTEXT_PROMPT_INSTRUCTION}"`);
    console.log('\n⚠️  This is the single training run the budget allows.\n');

    const training = await replicate.trainings.create(TRAINER_OWNER, TRAINER_NAME, TRAINER_VERSION, {
        destination: DESTINATION as `${string}/${string}`,
        input: {
            input_images: new File([new Uint8Array(zip)], 'dataset.zip', { type: 'application/zip' }),
            training_steps: steps,
            seed: 19826,
            kontext_prompt_instruction: KONTEXT_PROMPT_INSTRUCTION,
            ...(process.env.HF_TOKEN && process.env.HF_REPO_ID
                ? { hf_token: process.env.HF_TOKEN, hf_repo_id: process.env.HF_REPO_ID }
                : {}),
        },
    });

    console.log(`🚀 training ${training.id} — https://replicate.com/p/${training.id}`);
    await writeFile(path.join(OUT_DIR, 'training.json'),
        JSON.stringify({ id: training.id, status: training.status, destination: DESTINATION }, null, 2));

    let current = training;
    while (current.status === 'starting' || current.status === 'processing') {
        await new Promise((r) => setTimeout(r, 30_000));
        current = await replicate.trainings.get(current.id);
        console.log(`   ${new Date().toISOString()} ${current.status}`);
    }

    if (current.status !== 'succeeded') {
        throw new Error(`Training ${current.status}: ${JSON.stringify(current.error)}`);
    }

    const weights = (current.output as { weights?: string } | null)?.weights;
    await writeFile(path.join(OUT_DIR, 'training.json'),
        JSON.stringify({ id: current.id, status: current.status, weights, destination: DESTINATION }, null, 2));
    console.log(`✅ weights: ${weights}`);
    process.exit(0);
}

main().catch((err) => {
    console.error('❌', err);
    process.exit(1);
});
