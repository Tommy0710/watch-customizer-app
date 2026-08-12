import { readFile } from 'node:fs/promises';
import path from 'node:path';
import Replicate from 'replicate';
import { describeError } from '../lib/reportError';

// Is the LoRA serving on localhost an off-the-shelf model, or the one trained here on 2026-08-10?
// The two are told apart by matching what REPLICATE_LORA_WEIGHTS points at against the version that
// training actually produced. The value is compared rather than printed: it lives in .env.local.

const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });

async function main() {
    const record = JSON.parse(
        await readFile(path.join(process.cwd(), 'scripts/dataset/out/training.json'), 'utf8'),
    ) as { id: string; output?: { version?: string } };

    const training = await replicate.trainings.get(record.id);
    const producedVersion = (training.output as { version?: string } | null)?.version ?? '';
    const serving = process.env.REPLICATE_LORA_WEIGHTS ?? '';

    console.log(`training ${record.id}`);
    console.log(`  status    ${training.status}`);
    console.log(`  started   ${training.created_at}`);
    console.log(`  trainer   ${(training as { model?: string }).model ?? '?'}`);
    console.log(`  produced  ${producedVersion || '(none)'}`);
    console.log(`\nREPLICATE_LORA_WEIGHTS ${serving ? 'is set' : 'is NOT set'}`);
    if (serving) {
        const versionId = producedVersion.split(':')[1] ?? '';
        console.log(
            serving.includes(versionId) && versionId
                ? '  ✅ points at the version this training produced — the model serving locally is the one trained here'
                : '  ⚠️  does NOT match this training output',
        );
    }

    // What the trained model is, as Replicate itself records it.
    const owner = producedVersion.split('/')[0];
    const name = (producedVersion.split('/')[1] ?? '').split(':')[0];
    if (owner && name) {
        const model = await replicate.models.get(owner, name);
        console.log(`\nmodel ${owner}/${name}`);
        console.log(`  owner      ${model.owner}`);
        console.log(`  visibility ${model.visibility}`);
        console.log(`  versions   latest ${model.latest_version?.id.slice(0, 12)}`);
    }
    process.exit(0);
}
main().catch((e) => { console.error('❌', describeError(e)); process.exit(1); });
