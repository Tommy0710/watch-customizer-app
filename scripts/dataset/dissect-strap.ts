import { readFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { splitStrapSegments, metalScore } from '../../src/lib/strapSegments';
import { describeError } from '../lib/reportError';

// Diagnostic: shows the clean render beside the two halves splitStrapSegments produced and which
// one it called the buckle. Orientation and buckle-side errors in the assembled draft are invisible
// in the finished draft alone — you have to see what went in.

const OUT = path.join(process.cwd(), 'scripts/dataset/out');
const DEST = process.env.DISSECT_DIR ?? OUT;
const W = 420, H = 900, LABEL = 34;

async function main() {
  for (const id of process.argv.slice(2)) {
    const clean = await readFile(path.join(OUT, 'straps-clean', `${id}.webp`));
    const seg = await splitStrapSegments(clean);
    if (!seg) { console.log(`${id}: NO SPLIT`); continue; }
    const [bm, tm] = await Promise.all([metalScore(seg.buckle), metalScore(seg.tail)]);
    console.log(`${id}: buckleMetal=${bm.toFixed(3)} tailMetal=${tm.toFixed(3)}`);
    const panels = [
      { label: 'clean render', buf: clean },
      { label: `chosen BUCKLE m=${bm.toFixed(2)}`, buf: seg.buckle },
      { label: `chosen TAIL m=${tm.toFixed(2)}`, buf: seg.tail },
    ];
    const tiles: sharp.OverlayOptions[] = [];
    for (const [i, p] of panels.entries()) {
      tiles.push({ input: await sharp(p.buf).resize(W, H, { fit: 'contain', background: '#fff' }).flatten({ background: '#fff' }).toBuffer(), left: i * W, top: LABEL });
      tiles.push({ input: Buffer.from(`<svg width="${W}" height="${LABEL}"><rect width="100%" height="100%" fill="#111"/><text x="10" y="23" font-family="system-ui" font-size="15" fill="#fff">${p.label}</text></svg>`), left: i * W, top: 0 });
    }
    await sharp({ create: { width: W * panels.length, height: H + LABEL, channels: 3, background: { r: 255, g: 255, b: 255 } } })
      .composite(tiles).jpeg({ quality: 90 }).toFile(path.join(DEST, `dissect-${id}.jpg`));
  }
}
main().catch((e) => { console.error('❌', describeError(e)); process.exit(1); });
