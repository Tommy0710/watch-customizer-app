import { readFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { splitStrapSegments } from '../../src/lib/strapSegments';
import { trimSpringBarPins, measureSegment, measureFace } from '../../src/lib/segmentFit';
import { computeSegmentedLayout } from '../../src/lib/segmentedDraft';
import { removeWhiteBackground } from '../../src/lib/removeWhiteBackground';
import { getObjectBuffer } from '../../src/lib/aws';
import type { Combo } from './selectCombos';

const OUT = path.join(process.cwd(), 'scripts/dataset/out');

async function main() {
  const { train, heldOut }: { train: Combo[]; heldOut: Combo[] } = JSON.parse(await readFile(path.join(OUT, 'combos.json'), 'utf8'));
  const byProduct = new Map<number, Combo>();
  for (const c of [...train, ...heldOut]) if (!byProduct.has(c.productId)) byProduct.set(c.productId, c);

  for (const id of process.argv.slice(2)) {
    const seg = await splitStrapSegments(await readFile(path.join(OUT, 'straps-clean', `${id}.webp`)));
    if (!seg) { console.log(`${id} NO SPLIT`); continue; }
    const { buffer } = await getObjectBuffer(byProduct.get(Number(id))!.faceKey);
    const prepared = await sharp(await removeWhiteBackground(buffer)).trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 0 }).png().toBuffer();
    const face = await measureFace(prepared);
    const meta = await sharp(prepared).metadata();
    const [b, t] = await Promise.all([
      measureSegment(await trimSpringBarPins(seg.buckle, 'bottom'), 'bottom'),
      measureSegment(await trimSpringBarPins(seg.tail, 'top'), 'top'),
    ]);
    const strapPerCase = face.lugGap === null ? undefined : face.lugGap / face.width;
    const l = computeSegmentedLayout({ caseAspect: meta.height! / meta.width!, buckleAspect: b.aspect, tailAspect: t.aspect, strapPerCase });
    console.log(`${id}  buckleAspect=${b.aspect.toFixed(2)} tailAspect=${t.aspect.toFixed(2)} share=${(b.aspect/(b.aspect+t.aspect)*100).toFixed(0)}% caseAspect=${(meta.height!/meta.width!).toFixed(2)} lugGap/width=${strapPerCase?.toFixed(3) ?? 'none'} caseScale=${l.caseScale.toFixed(3)}`);
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
