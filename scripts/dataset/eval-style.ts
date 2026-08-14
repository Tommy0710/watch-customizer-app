import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import path from 'node:path';
import Replicate from 'replicate';
import { splitStrapSegments } from '../../src/lib/strapSegments';
import { buildSegmentedDraft } from '../../src/lib/segmentedDraft';
import { getObjectBuffer, getPresignedUrl } from '../../src/lib/aws';
import { createSpendGuard, SpendExceededError } from '../lib/spendGuard';
import { TRIGGER_WORD } from './styleDataset';
import {
    DEFAULT_LORA_SCALE,
    DEFAULT_LORA_STEPS,
    getLoraModel,
    getLoraSeed,
    getLoraPromptStrength,
} from '../../src/lib/loraConfig';
import { normaliseLoraWeights, parseS3WeightsKey } from '../../src/lib/loraWeights';
import type { Combo } from './selectCombos';
import { describeError } from '../lib/reportError';

// Runs the trained style LoRA over combos it has never seen and puts its output next to PRO's on
// the same inputs. Latency is recorded per call, cold start included, because speed was one of the
// four reasons for doing this at all.

const OUT_DIR = path.join(process.cwd(), 'scripts/dataset/out');
const ASSUMED_COST = 0.04;

const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });

function arg(name: string, fallback: string): string {
    const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : fallback;
}

async function exists(file: string): Promise<boolean> {
    try { await access(file); return true; } catch { return false; }
}

// flux-dev-lora returns an ARRAY of outputs (num_outputs defaults to 1), unlike flux-2-pro which
// returns a single value — hence "out.url is not a function" on the first run.
function firstOutputUrl(out: unknown): string {
    const item = Array.isArray(out) ? out[0] : out;
    if (typeof item === 'string') return item;
    const withUrl = item as { url?: () => string } | null;
    if (withUrl && typeof withUrl.url === 'function') return String(withUrl.url());
    throw new Error(`Unexpected model output shape: ${JSON.stringify(out).slice(0, 120)}`);
}

async function main() {
    const requestedStrength = Number(arg('strength', String(getLoraPromptStrength())));
    const strength = Number.isFinite(requestedStrength) ? requestedStrength : getLoraPromptStrength();
    const label = arg('label', `latest-strength-${String(strength).replace('.', '-')}`)
        .replace(/[^a-zA-Z0-9_-]/g, '-');
    const requestedIds = arg('ids', '')
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean);
    const idFilter = requestedIds.length ? new Set(requestedIds) : null;
    const delayMs = Math.max(0, Number(arg('delay-ms', '0')));
    const draftSource = arg('draft-source', '');
    const evalDir = path.join(OUT_DIR, 'eval', label);
    const trainingFile = arg('training-file', 'training.json');
    const guard = createSpendGuard({ maxSpend: Number(arg('max-spend', '0.40')), label: `eval-style:${label}` });

    // Load by the direct weights URL, not by "owner/name:version". The destination model is
    // private, and flux-dev-lora fetches a named model over public HTTP — it cannot authenticate,
    // so that path fails with "Failed to download tarball". The tarball URL works regardless.
    const { destination, output } = JSON.parse(await readFile(path.join(OUT_DIR, trainingFile), 'utf8'));
    const trained = output as { version?: string; weights?: string } | null;
    const configuredWeights = process.env.REPLICATE_LORA_WEIGHTS;
    const s3Key = parseS3WeightsKey(configuredWeights);
    const loraWeights = s3Key
        ? await getPresignedUrl(s3Key, 6 * 60 * 60)
        : normaliseLoraWeights(configuredWeights) ?? trained?.weights ?? trained?.version ?? destination;
    console.log(`🧠 model ${getLoraModel()} · weights ${s3Key ? 'fresh S3 presigned URL' : 'configured/model reference'}`);

    const { heldOut }: { heldOut: Combo[] } = JSON.parse(await readFile(path.join(OUT_DIR, 'combos.json'), 'utf8'));
    await mkdir(evalDir, { recursive: true });

    type EvalRow = { id: string; productName: string; seconds?: number; hasBaseline: boolean; error?: string };
    const timingsPath = path.join(OUT_DIR, `eval-timings-${label}.json`);
    let rows: EvalRow[] = [];
    if (await exists(timingsPath)) {
        try {
            const previous = JSON.parse(await readFile(timingsPath, 'utf8')) as { rows?: EvalRow[] };
            rows = previous.rows ?? [];
            console.log(`↩️  resuming ${label}: ${rows.length}/${heldOut.length} rows already recorded`);
        } catch {
            console.warn(`⚠️  could not read ${timingsPath}; starting a fresh evaluation`);
        }
    }
    // Retry rows that failed transiently (for example Replicate 429/5xx); only successful rows
    // are considered complete when resuming a run.
    const done = new Set(rows.filter((row) => row.seconds !== undefined).map((row) => row.id));

    const recordRow = (row: EvalRow) => {
        const existingIndex = rows.findIndex((previous) => previous.id === row.id);
        if (existingIndex === -1) rows.push(row);
        else rows[existingIndex] = row;
    };

    const saveProgress = async () => {
        await writeFile(timingsPath, JSON.stringify({
            label,
            strength,
            model: getLoraModel(),
            trainingFile,
            trainingVersion: trained?.version ?? null,
            rows,
            meanSeconds: rows.filter((row) => row.seconds !== undefined).length
                ? rows.reduce((sum, row) => sum + (row.seconds ?? 0), 0) /
                  rows.filter((row) => row.seconds !== undefined).length
                : 0,
            spend: guard.summary(),
        }, null, 2));
    };

    for (const combo of heldOut) {
        if (idFilter && !idFilter.has(combo.id)) continue;
        if (done.has(combo.id)) continue;
        console.log(`▶️  ${combo.id}`);
        const cleanPath = path.join(OUT_DIR, 'straps-clean', `${combo.productId}.webp`);
        if (!(await exists(cleanPath))) {
            recordRow({ id: combo.id, productName: combo.productName, hasBaseline: false, error: 'missing clean render' });
            await saveProgress();
            continue;
        }

        try {
            guard.charge(ASSUMED_COST, `LoRA ${combo.id}`);
        } catch (err) {
            if (err instanceof SpendExceededError) { console.warn(`🛑 ${err.message}`); break; }
            const message = describeError(err);
            recordRow({ id: combo.id, productName: combo.productName, hasBaseline: false, error: message });
            await saveProgress();
            console.warn(`  ❌ ${combo.id}: ${message}`);
            continue;
        }

        try {
            const cachedDraft = draftSource
                ? path.join(OUT_DIR, 'eval', draftSource, `${combo.id}_draft.png`)
                : '';
            let draft: Buffer;
            if (cachedDraft && await exists(cachedDraft)) {
                draft = await readFile(cachedDraft);
            } else {
                const rawSegments = await splitStrapSegments(await readFile(cleanPath));
                const segments = rawSegments;
                if (!segments) {
                    recordRow({ id: combo.id, productName: combo.productName, hasBaseline: false, error: 'could not split clean render' });
                    await saveProgress();
                    console.warn(`  ⚠️ ${combo.id}: could not split segments`);
                    continue;
                }

                const { buffer: face } = await getObjectBuffer(combo.faceKey);
                draft = await buildSegmentedDraft(segments, face);
            }
            await writeFile(path.join(evalDir, `${combo.id}_draft.png`), draft);

        const prompt =
            `${TRIGGER_WORD} a wristwatch fitted with a ${combo.productName.replace(/\s*watch\s+strap\s*$/i, '')} strap, ` +
            'photographed top-down as a studio product shot on a plain white background';

            if (delayMs > 0 && rows.some((row) => row.seconds !== undefined)) {
                await new Promise((resolve) => setTimeout(resolve, delayMs));
            }
            const startedAt = Date.now();
            const out: unknown = await replicate.run(getLoraModel() as `${string}/${string}`, {
                input: {
                    seed: getLoraSeed(),
                    prompt,
                    image: `data:image/png;base64,${draft.toString('base64')}`,
                    prompt_strength: strength,
                    lora_weights: loraWeights,
                    lora_scale: DEFAULT_LORA_SCALE,
                    megapixels: '1',
                    num_inference_steps: DEFAULT_LORA_STEPS,
                    output_format: 'webp',
                    output_quality: 90,
                    go_fast: false,
                },
            });
            const seconds = (Date.now() - startedAt) / 1000;

            await writeFile(path.join(evalDir, `${combo.id}_lora.webp`),
                Buffer.from(await (await fetch(firstOutputUrl(out))).arrayBuffer()));

            recordRow({
                id: combo.id,
                productName: combo.productName,
                seconds,
                hasBaseline: await exists(path.join(OUT_DIR, 'pairs', `${combo.id}_end.webp`)),
            });
            await saveProgress();
            console.log(`  ✅ ${combo.id.slice(0, 42)}  ${seconds.toFixed(1)}s  (${guard.summary()})`);
        } catch (err) {
            const message = describeError(err);
            recordRow({ id: combo.id, productName: combo.productName, hasBaseline: false, error: message });
            await saveProgress();
            console.warn(`  ❌ ${combo.id}: ${message}`);
        }
    }

    const successful = rows.filter((row) => row.seconds !== undefined);
    const mean = successful.length ? successful.reduce((s, r) => s + (r.seconds ?? 0), 0) / successful.length : 0;
    await saveProgress();

    const sections = rows.map((r) => `
  <section class="row">
    <div><h3>draft — input</h3><img src="eval/${label}/${r.id}_draft.png"></div>
    <div><h3>PRO — baseline</h3>${r.hasBaseline
        ? `<img src="pairs/${r.id}_end.webp">`
        : '<p class="none">no baseline generated for this combo</p>'}</div>
    <div><h3>LoRA — ${r.seconds === undefined ? 'ERROR' : `${r.seconds.toFixed(1)}s`}</h3>${r.error
        ? `<p class="none">${r.error.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!))}</p>`
        : `<img src="eval/${label}/${r.id}_lora.webp">`}</div>
    <div class="meta">${r.productName}</div>
  </section>`).join('');

    const htmlPath = path.join(OUT_DIR, `eval-${label}.html`);
    await writeFile(htmlPath, `<!doctype html>
<meta charset="utf-8"><title>LoRA vs PRO — strength ${strength}</title>
<style>
 body{font-family:system-ui,sans-serif;background:#111;color:#eee;margin:0}
 .row{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;padding:20px;border-bottom:1px solid #333}
 img{width:100%;background:#fff;display:block;border-radius:3px}
 h3{margin:0 0 6px;font-size:12px;color:#999;font-weight:600;text-transform:uppercase;letter-spacing:.05em}
 .meta{grid-column:1/-1;font-size:13px;color:#888}
 .none{color:#666;font-size:13px}
 header{position:sticky;top:0;background:#000;padding:14px 20px;border-bottom:1px solid #333;z-index:2}
</style>
<header>
  <b>Held-out comparison</b> — prompt_strength ${strength}, mean LoRA latency ${mean.toFixed(1)}s over ${rows.length} runs.<br>
  <span style="font-size:12px;color:#888">Pass: no catastrophic failure · LoRA at least matches PRO on assembly · strap colour and grain preserved · mean latency &lt;15s</span>
</header>
${sections}`);

    console.log(`\n${guard.summary()} — mean ${mean.toFixed(1)}s over ${rows.length} runs`);
    console.log(`   → open ${htmlPath}`);
    console.log(`   → timings ${timingsPath}`);
    process.exit(0);
}

main().catch((err) => {
    console.error('❌', describeError(err));
    process.exit(1);
});
