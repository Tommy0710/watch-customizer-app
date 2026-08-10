import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import path from 'node:path';
import Replicate from 'replicate';
import { splitStrapSegments } from '../../src/lib/strapSegments';
import { buildSegmentedDraft } from '../../src/lib/segmentedDraft';
import { getObjectBuffer } from '../../src/lib/aws';
import { createSpendGuard, SpendExceededError } from '../lib/spendGuard';
import { TRIGGER_WORD } from './styleDataset';
import type { Combo } from './selectCombos';

// Runs the trained style LoRA over combos it has never seen and puts its output next to PRO's on
// the same inputs. Latency is recorded per call, cold start included, because speed was one of the
// four reasons for doing this at all.

const OUT_DIR = path.join(process.cwd(), 'scripts/dataset/out');
const EVAL_DIR = path.join(OUT_DIR, 'eval');
const ASSUMED_COST = 0.04;

const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });

function arg(name: string, fallback: string): string {
    const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : fallback;
}

async function exists(file: string): Promise<boolean> {
    try { await access(file); return true; } catch { return false; }
}

async function main() {
    const strength = Number(arg('strength', '0.35'));
    const guard = createSpendGuard({ maxSpend: Number(arg('max-spend', '0.40')), label: 'eval-style' });

    const { destination, output } = JSON.parse(await readFile(path.join(OUT_DIR, 'training.json'), 'utf8'));
    const loraWeights = (output as { version?: string })?.version ?? destination;

    const { heldOut }: { heldOut: Combo[] } = JSON.parse(await readFile(path.join(OUT_DIR, 'combos.json'), 'utf8'));
    await mkdir(EVAL_DIR, { recursive: true });

    const rows: { id: string; productName: string; seconds: number; hasBaseline: boolean }[] = [];

    for (const combo of heldOut) {
        const cleanPath = path.join(OUT_DIR, 'straps-clean', `${combo.productId}.webp`);
        if (!(await exists(cleanPath))) continue;

        try {
            guard.charge(ASSUMED_COST, `LoRA ${combo.id}`);
        } catch (err) {
            if (err instanceof SpendExceededError) { console.warn(`🛑 ${err.message}`); break; }
            throw err;
        }

        const segments = await splitStrapSegments(await readFile(cleanPath));
        if (!segments) { console.warn(`  ⚠️ ${combo.id}: could not split segments`); continue; }

        const { buffer: face } = await getObjectBuffer(combo.faceKey);
        const draft = await buildSegmentedDraft(segments, face);
        await writeFile(path.join(EVAL_DIR, `${combo.id}_draft.png`), draft);

        const prompt =
            `${TRIGGER_WORD} a wristwatch fitted with a ${combo.productName.replace(/\s*watch\s+strap\s*$/i, '')} strap, ` +
            'photographed top-down as a studio product shot on a plain white background';

        const startedAt = Date.now();
        const out: unknown = await replicate.run('black-forest-labs/flux-dev-lora', {
            input: {
                seed: 19826,
                prompt,
                image: `data:image/png;base64,${draft.toString('base64')}`,
                prompt_strength: strength,
                lora_weights: loraWeights,
                lora_scale: 1,
                megapixels: '1',
                num_inference_steps: 30,
                output_format: 'webp',
                output_quality: 90,
                go_fast: false,
            },
        });
        const seconds = (Date.now() - startedAt) / 1000;

        const url = typeof out === 'string' ? out : (out as { url: () => string }).url();
        await writeFile(path.join(EVAL_DIR, `${combo.id}_lora.webp`),
            Buffer.from(await (await fetch(String(url))).arrayBuffer()));

        rows.push({
            id: combo.id,
            productName: combo.productName,
            seconds,
            hasBaseline: await exists(path.join(OUT_DIR, 'pairs', `${combo.id}_end.webp`)),
        });
        console.log(`  ✅ ${combo.id.slice(0, 42)}  ${seconds.toFixed(1)}s  (${guard.summary()})`);
    }

    const mean = rows.length ? rows.reduce((s, r) => s + r.seconds, 0) / rows.length : 0;
    await writeFile(path.join(OUT_DIR, 'eval-timings.json'), JSON.stringify({ strength, rows }, null, 2));

    const sections = rows.map((r) => `
  <section class="row">
    <div><h3>draft — input</h3><img src="eval/${r.id}_draft.png"></div>
    <div><h3>PRO — baseline</h3>${r.hasBaseline
        ? `<img src="pairs/${r.id}_end.webp">`
        : '<p class="none">no baseline generated for this combo</p>'}</div>
    <div><h3>LoRA — ${r.seconds.toFixed(1)}s</h3><img src="eval/${r.id}_lora.webp"></div>
    <div class="meta">${r.productName}</div>
  </section>`).join('');

    await writeFile(path.join(OUT_DIR, 'eval.html'), `<!doctype html>
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

    console.log(`\n${guard.summary()} — mean ${mean.toFixed(1)}s`);
    console.log(`   → open scripts/dataset/out/eval.html`);
    process.exit(0);
}

main().catch((err) => {
    console.error('❌', err instanceof Error ? err.message : err);
    process.exit(1);
});
