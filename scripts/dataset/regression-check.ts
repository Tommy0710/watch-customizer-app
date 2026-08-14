import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import Replicate from 'replicate';
import { getObjectBuffer } from '../../src/lib/aws';
import { generateWithLora } from '../../src/lib/loraEngine';

const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });
const OUT_DIR = process.env.REGRESSION_OUT_DIR || path.join(process.cwd(), 'scripts/dataset/out/regression');

async function run(strapId: number, productName: string, faceKey: string, label: string) {
    const { buffer: faceBuffer } = await getObjectBuffer(faceKey);
    const result = await generateWithLora({ replicate, strapId, faceBuffer, productName });
    if (!result.ok) { console.log(`${label}: stood down — ${result.reason}`); return; }
    const res = await fetch(result.imageUrl);
    await writeFile(`${OUT_DIR}/new-model-${label}.webp`, Buffer.from(await res.arrayBuffer()));
    console.log(`${label}: saved`);
}

async function main() {
    await mkdir(OUT_DIR, { recursive: true });
    await run(73226, 'Curved End Navy Pueblo Leather Watch Strap', 'a-lange-sohne/sfw/straps-a-lange-sohne-zeitwerk-140-029.png', '73226');
    await run(56037, 'Duocolor Dark Grey Alran Sully Leather Watch Strap', 'anordain/sfw/straps-anordain-model-2-purple-model-2-purple.png', '56037');
}
main().catch((e) => { console.error(e.message); process.exit(1); });
