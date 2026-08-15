import { readFile, writeFile, mkdir, rm, readdir, access } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { describeError } from '../lib/reportError';
import type { Combo } from './selectCombos';

// Packs approved pairs into the layout replicate/fast-flux-kontext-trainer expects: a flat zip of
// NNN_start.jpg / NNN_end.jpg, no captions (the shared prompt instruction covers every pair).

const run = promisify(execFile);
const OUT_DIR = path.join(process.cwd(), 'scripts/dataset/out');
const PAIR_DIR = path.join(OUT_DIR, 'pairs');
const STAGE_DIR = path.join(OUT_DIR, 'zipstage');
const MIN_PAIRS = 8;

// JPEG because that is the naming convention the trainer documents — but with chroma subsampling
// switched off. The default 4:2:0 smears the fine repeating leather grain the model has to copy,
// which is the same reason the production pipeline sends PNG rather than JPEG.
const JPEG = { quality: 95, chromaSubsampling: '4:4:4' } as const;

// Both sides are resized to one size so the trainer sees a consistent frame.
const PACK_WIDTH = 832;
const PACK_HEIGHT = 1472;

function flag(name: string): boolean {
    return process.argv.includes(`--${name}`);
}

async function exists(file: string): Promise<boolean> {
    try { await access(file); return true; } catch { return false; }
}

async function main() {
    const approvedPath = path.join(OUT_DIR, 'approved.json');
    let approved: string[];

    try {
        const parsed = JSON.parse(await readFile(approvedPath, 'utf8')) as { approved?: unknown };
        if (!Array.isArray(parsed.approved) || !parsed.approved.every((id): id is string => typeof id === 'string' && id.length > 0)) {
            throw new Error('approved.json must contain an approved array of non-empty string IDs.');
        }
        approved = [...new Set(parsed.approved)];
    } catch {
        if (await exists(approvedPath)) throw new Error('approved.json is malformed. Fix the review file before packing.');
        if (!flag('allow-unreviewed')) {
            throw new Error('approved.json is required. Review the contact sheet first, or explicitly pass --allow-unreviewed for a throwaway local experiment.');
        }
        const manifest = JSON.parse(await readFile(path.join(OUT_DIR, 'pairs-train.json'), 'utf8')) as { id: string }[];
        approved = [...new Set(manifest.map((m) => m.id))];
        console.warn(`⚠️  --allow-unreviewed enabled — packing ALL ${approved.length} generated pairs.`);
    }

    if (approved.length < MIN_PAIRS) {
        throw new Error(`Only ${approved.length} pairs; need at least ${MIN_PAIRS} to justify a training run.`);
    }

    await rm(STAGE_DIR, { recursive: true, force: true });
    await mkdir(STAGE_DIR, { recursive: true });

    let packed = 0;
    const packedIds: string[] = [];
    for (const id of approved) {
        const n = String(packed).padStart(3, '0');
        try {
            const [start, end] = await Promise.all([
                readFile(path.join(PAIR_DIR, `${id}_start.png`)),
                readFile(path.join(PAIR_DIR, `${id}_end.webp`)),
            ]);
            await sharp(start).resize(PACK_WIDTH, PACK_HEIGHT, { fit: 'fill' }).jpeg(JPEG)
                .toFile(path.join(STAGE_DIR, `${n}_start.jpg`));
            await sharp(end).resize(PACK_WIDTH, PACK_HEIGHT, { fit: 'fill' }).jpeg(JPEG)
                .toFile(path.join(STAGE_DIR, `${n}_end.jpg`));
            packed++;
            packedIds.push(id);
        } catch (err) {
            console.warn(`  ⚠️ skipping ${id}: ${(err as Error).message.slice(0, 70)}`);
        }
    }

    if (packed < MIN_PAIRS) {
        throw new Error(`Only ${packed} pairs survived packing; need at least ${MIN_PAIRS}.`);
    }

    const zipPath = path.join(OUT_DIR, 'dataset.zip');
    await rm(zipPath, { force: true });
    const files = (await readdir(STAGE_DIR)).map((f) => path.join(STAGE_DIR, f));
    // -j flattens paths: the trainer expects the pairs at the zip root, not inside a folder.
    await run('zip', ['-j', '-q', zipPath, ...files]);

    const sourceManifest = await exists(path.join(OUT_DIR, 'pairs-train.json'))
        ? JSON.parse(await readFile(path.join(OUT_DIR, 'pairs-train.json'), 'utf8'))
        : [];
    const combosFile = await exists(path.join(OUT_DIR, 'combos.json'))
        ? JSON.parse(await readFile(path.join(OUT_DIR, 'combos.json'), 'utf8')) as { train?: Combo[]; heldOut?: Combo[] }
        : {};
    const comboById = new Map([...combosFile.train ?? [], ...combosFile.heldOut ?? []].map((combo) => [combo.id, combo]));
    const materialCoverage: Record<string, number> = {};
    for (const id of packedIds) {
        const material = comboById.get(id)?.material?.family ?? 'unknown';
        materialCoverage[material] = (materialCoverage[material] ?? 0) + 1;
    }
    await writeFile(path.join(OUT_DIR, 'dataset-manifest.json'), JSON.stringify({
        manifestVersion: 2,
        packed,
        approved: packedIds,
        requestedApproved: approved,
        sourcePairCount: sourceManifest.length,
        reviewed: await exists(approvedPath),
        canvas: { width: PACK_WIDTH, height: PACK_HEIGHT },
        format: 'jpg-4:4:4-quality-95',
        materialCoverage,
    }, null, 2));
    console.log(`✅ ${packed} pairs → ${zipPath}`);
    process.exit(0);
}

main().catch((err) => {
    console.error('❌', describeError(err));
    process.exit(1);
});
