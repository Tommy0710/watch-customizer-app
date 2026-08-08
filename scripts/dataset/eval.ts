import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import Replicate from 'replicate';
import { splitStrapSegments } from '../../src/lib/strapSegments';
import { buildSegmentedDraft, KONTEXT_PROMPT_INSTRUCTION } from '../../src/lib/segmentedDraft';
import { getObjectBuffer } from '../../src/lib/aws';
import { createSpendGuard, SpendExceededError } from '../lib/spendGuard';
import type { Combo } from './selectCombos';

// Runs the trained LoRA over combos it has never seen and puts its output next to PRO's on the
// same inputs. Latency is recorded per call, cold start included, because speed is one of the
// four things this whole exercise is meant to improve.

const OUT_DIR = path.join(process.cwd(), 'scripts/dataset/out');
const EVAL_DIR = path.join(OUT_DIR, 'eval');
const ASSUMED_LORA_COST = 0.03; // deliberate over-estimate; the guard should trip early, not late

const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });

function arg(name: string, fallback: string): string {
    const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : fallback;
}

async function main() {
    const guard = createSpendGuard({ maxSpend: Number(arg('max-spend', '0.30')), label: 'eval' });
    const { weights } = JSON.parse(await readFile(path.join(OUT_DIR, 'training.json'), 'utf8'));
    if (!weights) throw new Error('No weights in training.json — training has not succeeded yet');

    const { heldOut }: { heldOut: Combo[] } =
        JSON.parse(await readFile(path.join(OUT_DIR, 'combos.json'), 'utf8'));
    await mkdir(EVAL_DIR, { recursive: true });

    const timings: { id: string; seconds: number; productName: string }[] = [];

    for (const combo of heldOut) {
        try {
            guard.charge(ASSUMED_LORA_COST, `LoRA ${combo.id}`);
        } catch (err) {
            if (err instanceof SpendExceededError) { console.warn(`🛑 ${err.message}`); break; }
            throw err;
        }

        const cleanPath = path.join(OUT_DIR, 'straps-clean', `${combo.productId}.webp`);
        const [strapBuffer, { buffer: faceBuffer }] = await Promise.all([
            readFile(cleanPath),
            getObjectBuffer(combo.faceKey),
        ]);

        const segments = await splitStrapSegments(strapBuffer);
        if (!segments) {
            console.warn(`  ⚠️ ${combo.id}: could not split segments, skipping`);
            continue;
        }
        const draft = await buildSegmentedDraft(segments, faceBuffer);
        await writeFile(path.join(EVAL_DIR, `${combo.id}_draft.png`), draft);

        const startedAt = Date.now();
        const output: unknown = await replicate.run('black-forest-labs/flux-kontext-dev-lora', {
            input: {
                seed: 19826,
                prompt: KONTEXT_PROMPT_INSTRUCTION,
                input_image: `data:image/png;base64,${draft.toString('base64')}`,
                lora_weights: weights,
                lora_strength: 1,
                megapixels: '1',
                aspect_ratio: 'match_input_image',
                output_format: 'webp',
                output_quality: 90,
                num_inference_steps: 30,
            },
        });
        const seconds = (Date.now() - startedAt) / 1000;

        const url = typeof output === 'string' ? output : (output as { url: () => string }).url();
        const img = await fetch(String(url));
        await writeFile(path.join(EVAL_DIR, `${combo.id}_lora.webp`), Buffer.from(await img.arrayBuffer()));

        timings.push({ id: combo.id, seconds, productName: combo.productName });
        console.log(`  ✅ ${combo.id.slice(0, 44)}  ${seconds.toFixed(1)}s  (${guard.summary()})`);
    }

    await writeFile(path.join(OUT_DIR, 'eval-timings.json'), JSON.stringify(timings, null, 2));

    const rows = timings.map((t) => `
  <section class="row">
    <div><h3>draft — input</h3><img src="eval/${t.id}_draft.png"></div>
    <div><h3>PRO — $0.03+</h3><img src="pairs/${t.id}_end.webp"></div>
    <div><h3>LoRA — ${t.seconds.toFixed(1)}s</h3><img src="eval/${t.id}_lora.webp"></div>
    <div class="meta">${t.productName}</div>
  </section>`).join('');

    const mean = timings.length ? timings.reduce((s, t) => s + t.seconds, 0) / timings.length : 0;

    await writeFile(path.join(OUT_DIR, 'eval.html'), `<!doctype html>
<meta charset="utf-8"><title>LoRA vs PRO</title>
<style>
 body{font-family:system-ui,sans-serif;background:#111;color:#eee;margin:0}
 .row{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;padding:20px;border-bottom:1px solid #333}
 img{width:100%;background:#fff;display:block}
 h3{margin:0 0 6px;font-size:12px;color:#999;font-weight:500;text-transform:uppercase;letter-spacing:.05em}
 .meta{grid-column:1/-1;font-size:12px;color:#777}
 header{position:sticky;top:0;background:#000;padding:12px 20px;border-bottom:1px solid #333;z-index:2}
</style>
<header>
  <b>Held-out comparison</b> — mean LoRA latency ${mean.toFixed(1)}s over ${timings.length} runs.<br>
  <span style="font-size:12px;color:#888">Pass: catastrophic failures ≤1/6 · LoRA ≥ PRO on assembly in ≥4/6 · strap texture correct in ≥5/6 · mean latency &lt;15s</span>
</header>
${rows}`);

    console.log(`\n${guard.summary()} — mean ${mean.toFixed(1)}s`);
    console.log(`   → open ${path.join(OUT_DIR, 'eval.html')}`);
    process.exit(0);
}

main().catch((err) => {
    console.error('❌', err);
    process.exit(1);
});
