import { createHash } from 'node:crypto';
import { readFile, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import {
    DEFAULT_LORA_MODEL,
    getLoraModel,
    getLoraPromptStrength,
    getLoraSeed,
} from '../../src/lib/loraConfig';

const OUT_DIR = path.join(process.cwd(), 'scripts/dataset/out');

function arg(name: string, fallback: string): string {
    const hit = process.argv.find((value) => value.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : fallback;
}

async function readJsonIfPresent(file: string): Promise<unknown | null> {
    try { await access(file); } catch { return null; }
    return JSON.parse(await readFile(file, 'utf8'));
}

async function sha256(file: string): Promise<string | null> {
    try {
        return createHash('sha256').update(await readFile(file)).digest('hex');
    } catch {
        return null;
    }
}

async function main() {
    const label = arg('label', new Date().toISOString().replace(/[:.]/g, '-'));
    const dataset = await readJsonIfPresent(path.join(OUT_DIR, 'dataset-manifest.json'));
    const styleDatasetSha256 = await sha256(path.join(OUT_DIR, 'style-dataset.zip'));
    const training = await readJsonIfPresent(path.join(OUT_DIR, 'training.json'));
    const combos = await readJsonIfPresent(path.join(OUT_DIR, 'combos.json'));
    const evaluationLabel = arg('evaluation-label', '');
    const evaluation = evaluationLabel
        ? await readJsonIfPresent(path.join(OUT_DIR, `eval-timings-${evaluationLabel}.json`))
        : null;
    const split = combos && typeof combos === 'object' && !Array.isArray(combos)
        ? {
            trainCount: Array.isArray((combos as { train?: unknown }).train) ? (combos as { train: unknown[] }).train.length : 0,
            heldOutCount: Array.isArray((combos as { heldOut?: unknown }).heldOut) ? (combos as { heldOut: unknown[] }).heldOut.length : 0,
            trainIds: Array.isArray((combos as { train?: Array<{ id?: unknown }> }).train)
                ? (combos as { train: Array<{ id?: unknown }> }).train.map((item) => item.id).filter((id): id is string => typeof id === 'string')
                : [],
            heldOutIds: Array.isArray((combos as { heldOut?: Array<{ id?: unknown }> }).heldOut)
                ? (combos as { heldOut: Array<{ id?: unknown }> }).heldOut.map((item) => item.id).filter((id): id is string => typeof id === 'string')
                : [],
        }
        : null;
    const manifest = {
        manifestVersion: 1,
        createdAt: new Date().toISOString(),
        gitCommit: process.env.GIT_COMMIT || null,
        datasetSha256: await sha256(path.join(OUT_DIR, 'dataset.zip')),
        styleDatasetSha256,
        dataset,
        training,
        combos,
        split,
        evaluation: evaluationLabel ? { label: evaluationLabel, result: evaluation } : null,
        serving: {
            model: getLoraModel() || DEFAULT_LORA_MODEL,
            weights: process.env.REPLICATE_LORA_WEIGHTS ? 'configured' : 'not-configured',
            seed: getLoraSeed(),
            promptStrength: getLoraPromptStrength(),
        },
    };

    const output = path.join(OUT_DIR, `run-manifest-${label}.json`);
    await writeFile(output, JSON.stringify(manifest, null, 2));
    console.log(`✅ run manifest → ${output}`);
}

main().catch((error) => {
    console.error('❌', error instanceof Error ? error.message : error);
    process.exit(1);
});
