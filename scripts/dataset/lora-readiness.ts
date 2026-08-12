import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { CLEAN_STRAP_PREFIX } from '../../src/lib/aws';
import type { Combo } from './selectCombos';
import { describeError } from '../lib/reportError';

// Why did a Combine click fall back to PRO? Every reason lives on one of three lists: the env vars
// the engine needs, the renders actually published to S3, and whether those renders still meet the
// standard after code changes. Printed together because the answer is usually the gap between them.

const s3 = new S3Client({ region: process.env.AWS_REGION! });

async function main() {
    for (const name of ['GENERATE_ENGINE', 'REPLICATE_LORA_WEIGHTS', 'CLEAN_STRAP_DIR', 'AWS_S3_CLEAN_STRAP_PREFIX']) {
        const v = process.env[name];
        // Values are printed only for the two that are not secret and decide the branch.
        const shown = name === 'GENERATE_ENGINE' || name === 'CLEAN_STRAP_DIR' ? (v ?? '(unset)') : v ? 'set' : '(unset)';
        console.log(`${name.padEnd(26)} ${shown}`);
    }

    const out = await s3.send(new ListObjectsV2Command({
        Bucket: process.env.AWS_S3_BUCKET!, Prefix: CLEAN_STRAP_PREFIX,
    }));
    const onS3 = (out.Contents ?? []).map((o) => Number(path.basename(o.Key!).replace('.webp', ''))).filter(Boolean);
    console.log(`\nS3 ${CLEAN_STRAP_PREFIX}: ${onS3.length} renders published`);

    const report = JSON.parse(await readFile(path.join(process.cwd(), 'scripts/dataset/out/standard-report.json'), 'utf8')) as
        { id: number; name: string; passes: number; total: number }[];
    const byId = new Map(report.map((r) => [r.id, r]));

    const usable = onS3.filter((id) => (byId.get(id)?.passes ?? 0) > 0);
    const dead = onS3.filter((id) => (byId.get(id)?.passes ?? 0) === 0);

    console.log(`\n✅ ${usable.length} published renders still meet the standard — these serve LoRA:`);
    for (const id of usable) console.log(`   ${id}  ${byId.get(id)!.name}  (${byId.get(id)!.passes}/${byId.get(id)!.total} faces)`);
    if (dead.length > 0) {
        console.log(`\n❌ ${dead.length} published renders no longer meet it — these fall back to PRO:`);
        for (const id of dead) console.log(`   ${id}  ${byId.get(id)?.name ?? '(not in report)'}`);
    }

    const missing = report.filter((r) => r.passes > 0 && !onS3.includes(r.id));
    if (missing.length > 0) {
        console.log(`\n⚠️  ${missing.length} straps meet the standard but were never published to S3:`);
        for (const r of missing) console.log(`   ${r.id}  ${r.name}  (${r.passes}/${r.total})`);
    }
    process.exit(0);
}
main().catch((e) => { console.error('❌', describeError(e)); process.exit(1); });
