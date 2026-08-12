import { readFile } from 'node:fs/promises';
import path from 'node:path';
import Replicate from 'replicate';
import { describeError } from '../lib/reportError';

// Isolates the cause of the blanket 500 on create-training.
//
// Two hypotheses were live: the destination model, and the trainer version. The first is already
// dead — watch-lora (which trained successfully on 2026-08-10) and watch-kontext both 500 on an
// identical request. This tests the second: ostris has published a newer trainer version since,
// and train-style.ts asks for latest_version, so a broken new version would look exactly like this.
//
// Any training that DOES start is cancelled within seconds, so the bill is a few seconds of GPU.

const OUT_DIR = path.join(process.cwd(), 'scripts/dataset/out');
const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });

// The SDK's error message truncates the server's body, which is where the real reason lives.
async function rawPost(version: string, destination: string, imagesUrl: string) {
    const res = await fetch(
        `https://api.replicate.com/v1/models/ostris/flux-dev-lora-trainer/versions/${version}/trainings`,
        {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${process.env.REPLICATE_API_TOKEN}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                destination,
                input: {
                    input_images: imagesUrl,
                    trigger_word: 'HNDDNW',
                    steps: 1000,
                    seed: 19826,
                    lora_rank: 16,
                    autocaption: false,
                },
            }),
        },
    );
    const body = await res.text();
    return { status: res.status, body };
}

async function attempt(label: string, version: string, destination: string, imagesUrl: string) {
    const { status, body } = await rawPost(version, destination, imagesUrl);
    if (status >= 200 && status < 300) {
        const id = (JSON.parse(body) as { id: string }).id;
        console.log(`   ✅ ${label} ACCEPTED — ${id}`);
        try {
            await replicate.trainings.cancel(id);
            console.log(`      🛑 cancelled`);
        } catch (err) {
            console.log(`      ⚠️ CANCEL FAILED, stop it by hand: https://replicate.com/p/${id}`);
            console.log(`         ${(err as Error).message.slice(0, 120)}`);
        }
        return true;
    }
    console.log(`   ❌ ${label} — ${status}: ${body.slice(0, 300)}`);
    return false;
}

async function main() {
    // The version that actually worked, read off the succeeded training rather than assumed.
    const previous = JSON.parse(await readFile(path.join(OUT_DIR, 'training.json'), 'utf8')) as { id: string };
    const succeeded = await replicate.trainings.get(previous.id);
    const workingVersion = (succeeded as { version?: string }).version ?? '';
    const trainer = await replicate.models.get('ostris', 'flux-dev-lora-trainer');
    const latestVersion = trainer.latest_version!.id;

    console.log(`worked 2026-08-10 : ${workingVersion}`);
    console.log(`latest today      : ${latestVersion}`);
    console.log(workingVersion === latestVersion ? '→ SAME version\n' : '→ DIFFERENT version\n');

    const zip = await readFile(path.join(OUT_DIR, 'style-dataset.zip'));
    const uploaded = await replicate.files.create(
        new File([new Uint8Array(zip)], 'style-dataset.zip', { type: 'application/zip' }),
    );

    if (workingVersion && workingVersion !== latestVersion) {
        await attempt('old version → watch-lora', workingVersion, 'tommy0710/watch-lora', uploaded.urls.get);
    }
    await attempt('latest → watch-lora', latestVersion, 'tommy0710/watch-lora', uploaded.urls.get);

    process.exit(0);
}

main().catch((err) => {
    console.error('❌', describeError(err));
    process.exit(1);
});
