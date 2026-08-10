import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import Replicate from 'replicate';
import { splitStrapSegments } from '../../src/lib/strapSegments';
import { buildSegmentedDraft } from '../../src/lib/segmentedDraft';
import { getObjectBuffer } from '../../src/lib/aws';
import { createSpendGuard, SpendExceededError } from '../lib/spendGuard';
import { TRIGGER_WORD } from './styleDataset';
import type { Combo } from './selectCombos';

// prompt_strength is the one knob that decides whether this approach works at all. Too low and the
// LoRA barely touches the draft, leaving the pasted-on look; too high and img2img destroys the
// strap's real colour and grain — the very things the draft exists to carry. There is no way to
// reason it out in advance, so this renders one held-out combo across a range and builds a strip
// to compare. One combo, a handful of images, a few cents.

const OUT_DIR = path.join(process.cwd(), 'scripts/dataset/out');
const SWEEP_DIR = path.join(OUT_DIR, 'sweep');
const STRENGTHS = [0.25, 0.35, 0.45, 0.55];
const ASSUMED_COST = 0.04;

const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });

function arg(name: string, fallback: string): string {
    const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : fallback;
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
    const guard = createSpendGuard({ maxSpend: Number(arg('max-spend', '0.30')), label: 'sweep' });
    const { destination, output } = JSON.parse(await readFile(path.join(OUT_DIR, 'training.json'), 'utf8'));
    // Load by the direct weights URL, not by "owner/name:version". The destination model is
    // private, and flux-dev-lora fetches a named model over public HTTP — it cannot authenticate,
    // so that path fails with "Failed to download tarball". The tarball URL works regardless.
    const trained = output as { version?: string; weights?: string } | null;
    const loraWeights = trained?.weights ?? trained?.version ?? destination;

    const { heldOut }: { heldOut: Combo[] } = JSON.parse(await readFile(path.join(OUT_DIR, 'combos.json'), 'utf8'));
    const combo = heldOut[0];

    const segments = await splitStrapSegments(await readFile(path.join(OUT_DIR, 'straps-clean', `${combo.productId}.webp`)));
    if (!segments) throw new Error(`could not split segments for ${combo.productId}`);
    const { buffer: face } = await getObjectBuffer(combo.faceKey);
    const draft = await buildSegmentedDraft(segments, face);

    await mkdir(SWEEP_DIR, { recursive: true });
    await writeFile(path.join(SWEEP_DIR, 'draft.png'), draft);

    const prompt =
        `${TRIGGER_WORD} a wristwatch fitted with a ${combo.productName.replace(/\s*watch\s+strap\s*$/i, '')} strap, ` +
        'photographed top-down as a studio product shot on a plain white background';

    const results: { strength: number; file: string }[] = [];
    for (const strength of STRENGTHS) {
        try {
            guard.charge(ASSUMED_COST, `strength ${strength}`);
        } catch (err) {
            if (err instanceof SpendExceededError) { console.warn(`🛑 ${err.message}`); break; }
            throw err;
        }

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

        const file = path.join(SWEEP_DIR, `s${String(strength).replace('.', '')}.webp`);
        await writeFile(file, Buffer.from(await (await fetch(firstOutputUrl(out))).arrayBuffer()));
        results.push({ strength, file });
        console.log(`  ✅ strength ${strength}  (${guard.summary()})`);
    }

    // One strip: draft first, then each strength, so the drift is obvious left to right.
    const W = 300, H = 531, LABEL = 36;
    const panels = [{ label: 'draft', file: path.join(SWEEP_DIR, 'draft.png') },
                    ...results.map((r) => ({ label: `${r.strength}`, file: r.file }))];
    const tiles = [];
    for (const [i, p] of panels.entries()) {
        tiles.push({ input: await sharp(await readFile(p.file)).resize(W, H, { fit: 'contain', background: '#fff' }).toBuffer(), left: i * W, top: LABEL });
        tiles.push({
            input: Buffer.from(`<svg width="${W}" height="${LABEL}"><rect width="100%" height="100%" fill="#111"/>
              <text x="${W / 2}" y="25" text-anchor="middle" font-family="system-ui" font-size="18" fill="#fff">${p.label}</text></svg>`),
            left: i * W, top: 0,
        });
    }
    await sharp({ create: { width: W * panels.length, height: H + LABEL, channels: 3, background: { r: 255, g: 255, b: 255 } } })
        .composite(tiles).jpeg({ quality: 92 }).toFile(path.join(OUT_DIR, 'sweep.jpg'));

    console.log(`\n${guard.summary()}`);
    console.log(`   → scripts/dataset/out/sweep.jpg`);
    process.exit(0);
}

main().catch((err) => {
    console.error('❌', err instanceof Error ? err.message : err);
    process.exit(1);
});
