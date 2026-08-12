import path from 'node:path';
import { S3Client, ListObjectsV2Command, GetObjectCommand } from '@aws-sdk/client-s3';
import { readFile } from 'node:fs/promises';
import { CLEAN_STRAP_PREFIX } from '../../src/lib/aws';
import { getObjectBuffer } from '../../src/lib/aws';
import { getDatabaseProducts } from '../../src/lib/woocommerce';
import { prepareFace, checkCleanRender, type PreparedFace } from '../../src/lib/renderCheck';
import { measureStrapColour, compareStrapColour } from '../../src/lib/strapColour';
import type { Combo } from './selectCombos';
import { describeError } from '../lib/reportError';

// Why did a Combine click fall back to PRO? Every reason lives on one of three lists: the env vars
// the engine needs, the renders actually published to S3, and whether those renders still meet the
// standard right now.
//
// Checks live against the S3 files themselves rather than reading standard-report.json. That file
// is a snapshot from whenever standard-report.ts last ran, and this script reading it produced a
// wrong answer the first time it existed: 76 of 100 straps freshly promoted to S3 were reported as
// failing with "(not in report)" — not because they failed anything, but because they were promoted
// AFTER the snapshot was taken and the report had never heard of them. A readiness check has to be
// live, or it just measures the last time someone remembered to regenerate a cache file.

const s3 = new S3Client({ region: process.env.AWS_REGION! });
const OUT_DIR = path.join(process.cwd(), 'scripts/dataset/out');
const FACE_SAMPLE = 8;

async function loadColourSource(productId: number, catalogUrl: string): Promise<Buffer> {
    try {
        return await readFile(path.join(OUT_DIR, 'straps', `${productId}.png`));
    } catch {
        return Buffer.from(await (await fetch(catalogUrl)).arrayBuffer());
    }
}

async function main() {
    for (const name of ['GENERATE_ENGINE', 'REPLICATE_LORA_WEIGHTS', 'CLEAN_STRAP_DIR', 'AWS_S3_CLEAN_STRAP_PREFIX']) {
        const v = process.env[name];
        const shown = name === 'GENERATE_ENGINE' || name === 'CLEAN_STRAP_DIR' ? (v ?? '(unset)') : v ? 'set' : '(unset)';
        console.log(`${name.padEnd(26)} ${shown}`);
    }

    const out = await s3.send(new ListObjectsV2Command({
        Bucket: process.env.AWS_S3_BUCKET!, Prefix: CLEAN_STRAP_PREFIX,
    }));
    const keys = (out.Contents ?? []).map((o) => o.Key!).filter(Boolean);
    console.log(`\nS3 ${CLEAN_STRAP_PREFIX}: ${keys.length} renders published\n`);

    const { train, heldOut }: { train: Combo[]; heldOut: Combo[] } =
        JSON.parse(await readFile(path.join(OUT_DIR, 'combos.json'), 'utf8'));
    const byProduct = new Map<number, Combo>();
    for (const c of [...train, ...heldOut]) if (!byProduct.has(c.productId)) byProduct.set(c.productId, c);
    const catalogImageById = new Map((await getDatabaseProducts()).map((p) => [p.id, p.image]));
    const nameById = new Map((await getDatabaseProducts()).map((p) => [p.id, p.name]));

    const faceKeys = [...new Set([...train, ...heldOut].map((c) => c.faceKey))];
    const step = Math.max(1, Math.floor(faceKeys.length / FACE_SAMPLE));
    const spread = faceKeys.filter((_, i) => i % step === 0);
    const faces: PreparedFace[] = [];
    const tried = new Set<string>();
    for (const key of [...spread, ...faceKeys]) {
        if (faces.length >= FACE_SAMPLE) break;
        if (tried.has(key)) continue;
        tried.add(key);
        const prepared = await prepareFace((await getObjectBuffer(key)).buffer);
        if (prepared.metrics.lugGap !== null) faces.push(prepared);
    }

    const usable: { id: number; name: string; passes: number; checked: number }[] = [];
    const dead: { id: number; name: string; reason: string }[] = [];

    for (const key of keys) {
        const id = Number(path.basename(key).replace('.webp', ''));
        if (!id) continue;
        const name = nameById.get(id) ?? '(not in WooCommerce catalog)';

        const { Body } = await s3.send(new GetObjectCommand({ Bucket: process.env.AWS_S3_BUCKET!, Key: key }));
        const render = Buffer.from(await Body!.transformToByteArray());

        const catalogUrl = byProduct.get(id)?.strapImage ?? catalogImageById.get(id);
        const colour = catalogUrl
            ? compareStrapColour(
                await measureStrapColour(await loadColourSource(id, catalogUrl)),
                await measureStrapColour(render),
            )
            : undefined;

        const verdict = await checkCleanRender(render, faces, colour);
        if (verdict.ok) usable.push({ id, name, passes: verdict.passes, checked: verdict.checked });
        else dead.push({ id, name, reason: verdict.reasons[0] ?? 'below standard' });
    }

    console.log(`✅ ${usable.length} published renders meet the standard right now — these serve LoRA:`);
    for (const r of usable) console.log(`   ${r.id}  ${r.name}  (${r.passes}/${r.checked} faces)`);

    if (dead.length > 0) {
        console.log(`\n❌ ${dead.length} published renders do not — these fall back to PRO:`);
        for (const r of dead) console.log(`   ${r.id}  ${r.name}  — ${r.reason.slice(0, 70)}`);
    }
    process.exit(0);
}
main().catch((e) => { console.error('❌', describeError(e)); process.exit(1); });
