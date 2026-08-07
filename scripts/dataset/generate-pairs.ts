import { mkdir, writeFile, readFile, access } from 'node:fs/promises';
import path from 'node:path';
import Replicate from 'replicate';
import { buildDraftComposite } from '../../src/lib/draftComposite';
import { PRO_ASSEMBLY_PROMPT } from '../../src/lib/proPrompt';
import { getObjectBuffer } from '../../src/lib/aws';
import { classifyStrap, buildStrapProfileClause } from '../../src/lib/strapProfile';
import { createSpendGuard, SpendExceededError } from '../lib/spendGuard';
import type { Combo } from './selectCombos';

const OUT_DIR = path.join(process.cwd(), 'scripts/dataset/out');
const PAIR_DIR = path.join(OUT_DIR, 'pairs');

// Replicate publishes no price for flux-2-pro via its API or pricing page, so the real figure has
// to come off the billing dashboard after a small calibration run. These defaults are deliberate
// OVER-estimates so the guard trips early rather than late; pass --unit-cost once confirmed.
const ASSUMED_COST = { '1 MP': 0.03, '2 MP': 0.06 } as const;

const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });

function arg(name: string, fallback: string): string {
    const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : fallback;
}
function flag(name: string): boolean {
    return process.argv.includes(`--${name}`);
}

async function exists(file: string): Promise<boolean> {
    try { await access(file); return true; } catch { return false; }
}

async function loadStrapBuffer(url: string): Promise<Buffer> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Could not download strap image ${url} (${res.status})`);
    return Buffer.from(await res.arrayBuffer());
}

async function runPro(draft: Buffer, strapRef: Buffer, faceRef: Buffer, clause: string, resolution: string) {
    const toUri = (b: Buffer) => `data:image/png;base64,${b.toString('base64')}`;
    const output: unknown = await replicate.run('black-forest-labs/flux-2-pro', {
        input: {
            seed: 19826,
            prompt: PRO_ASSEMBLY_PROMPT + clause,
            resolution,
            aspect_ratio: '9:16',
            input_images: [toUri(draft), toUri(strapRef), toUri(faceRef)],
            output_format: 'webp',
            output_quality: 90,
            safety_tolerance: 5,
            prompt_upsampling: false,
        },
    });
    const url = typeof output === 'string' ? output : (output as { url: () => string }).url();
    const res = await fetch(String(url));
    if (!res.ok) throw new Error(`Could not download PRO output (${res.status})`);
    return Buffer.from(await res.arrayBuffer());
}

async function main() {
    const dryRun = flag('dry-run');
    const set = arg('set', 'train'); // "train" (1 MP) or "heldOut" (2 MP, production settings)
    const resolution = (set === 'train' ? '1 MP' : '2 MP') as keyof typeof ASSUMED_COST;
    const unitCost = Number(arg('unit-cost', String(ASSUMED_COST[resolution])));
    const limit = Number(arg('limit', '9999'));
    const maxSpend = Number(arg('max-spend', '1.50'));

    const guard = createSpendGuard({ maxSpend, label: `generate-pairs:${set}` });

    const combos: Combo[] = JSON.parse(
        await readFile(path.join(OUT_DIR, 'combos.json'), 'utf8'),
    )[set === 'train' ? 'train' : 'heldOut'];

    await mkdir(PAIR_DIR, { recursive: true });
    const manifestPath = path.join(OUT_DIR, `pairs-${set}.json`);
    const manifest: Record<string, unknown>[] = (await exists(manifestPath))
        ? JSON.parse(await readFile(manifestPath, 'utf8'))
        : [];
    const done = new Set(manifest.map((m) => m.id as string));

    console.log(
        `🎬 ${set}: ${combos.length} combos @ ${resolution}` +
        (dryRun ? ' — DRY RUN, no PRO calls' : `, $${unitCost.toFixed(3)}/image, cap $${maxSpend.toFixed(2)}`) +
        `, ${done.size} already done, limit ${limit} this run`,
    );

    let generatedThisRun = 0;

    for (const combo of combos) {
        if (done.has(combo.id)) continue;
        if (generatedThisRun >= limit) {
            console.log(`\n⏸  Reached --limit=${limit} for this run.`);
            break;
        }

        if (!dryRun) {
            try {
                guard.charge(unitCost, `PRO ${combo.id}`);
            } catch (err) {
                if (err instanceof SpendExceededError) {
                    console.warn(`\n🛑 ${err.message}`);
                    break;
                }
                throw err;
            }
        }

        const [strapBuffer, { buffer: faceBuffer }] = await Promise.all([
            loadStrapBuffer(combo.strapImage),
            getObjectBuffer(combo.faceKey),
        ]);

        const draft = await buildDraftComposite(strapBuffer, faceBuffer);
        await writeFile(path.join(PAIR_DIR, `${combo.id}_start.png`), draft);

        if (dryRun) {
            generatedThisRun++;
            console.log(`  🖼  ${combo.id} draft only`);
            continue;
        }

        // Same three arguments /api/generate passes — categories and attributes matter, the
        // classifier falls back to weak name-regex guessing without them.
        const clause = buildStrapProfileClause(
            classifyStrap(combo.productName, combo.categories, combo.attributes),
        );
        const after = await runPro(draft, strapBuffer, faceBuffer, clause, resolution);
        await writeFile(path.join(PAIR_DIR, `${combo.id}_end.webp`), after);

        manifest.push({
            id: combo.id,
            bucket: combo.bucket,
            productName: combo.productName,
            faceKey: combo.faceKey,
            strapImage: combo.strapImage,
            resolution,
        });
        // Written after every single pair so a crash resumes instead of re-paying.
        await writeFile(manifestPath, JSON.stringify(manifest, null, 2));

        generatedThisRun++;
        console.log(`  ✅ ${combo.id}  (${guard.summary()})`);
    }

    console.log(`\n${guard.summary()} — ${manifest.length}/${combos.length} pairs on disk`);
    process.exit(0);
}

main().catch((err) => {
    console.error('❌', err);
    process.exit(1);
});
