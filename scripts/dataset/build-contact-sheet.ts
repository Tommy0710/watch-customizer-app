import { readFile, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import type { Combo } from './selectCombos';

// A static HTML page opened straight from disk — no dev server, no route in the app, so the frozen
// customer UI stays untouched. Every image is a local relative path, so it works offline.
//
// Shows the whole chain for each pair rather than just before/after: catalog photo → clean studio
// render → draft handed to the model → PRO's result. Colour and grain can drift at the render
// step (a navy strap came back brown once), and that is only visible with the source alongside.

const OUT_DIR = path.join(process.cwd(), 'scripts/dataset/out');

type Pair = { id: string; bucket: string; productName: string; faceKey: string };

async function exists(file: string): Promise<boolean> {
    try { await access(file); return true; } catch { return false; }
}

async function main() {
    const manifest: Pair[] = JSON.parse(await readFile(path.join(OUT_DIR, 'pairs-train.json'), 'utf8'));
    const { train }: { train: Combo[] } = JSON.parse(await readFile(path.join(OUT_DIR, 'combos.json'), 'utf8'));
    const productById = new Map(train.map((c) => [c.id, c.productId]));

    // Carry over any earlier verdicts so a re-run does not throw away work already done.
    let preset: Record<string, boolean> = {};
    if (await exists(path.join(OUT_DIR, 'approved.json'))) {
        const { approved } = JSON.parse(await readFile(path.join(OUT_DIR, 'approved.json'), 'utf8')) as { approved: string[] };
        const approvedSet = new Set(approved);
        preset = Object.fromEntries(manifest.map((m) => [m.id, approvedSet.has(m.id)]));
    }

    const items = manifest.map((m) => ({ ...m, productId: productById.get(m.id) ?? 0 }));

    const html = `<!doctype html>
<meta charset="utf-8">
<title>LoRA pair review — ${items.length} pairs</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 0; background: #111; color: #eee; }
  header { position: sticky; top: 0; background: #000; padding: 14px 20px; border-bottom: 1px solid #333; z-index: 2; }
  .pair { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; padding: 18px 20px; border-bottom: 1px solid #2a2a2a; }
  .pair.keep { background: #0c2a14; }
  .pair.drop { background: #2c0c0c; opacity: .5; }
  .pair.current { outline: 3px solid #4ea1ff; outline-offset: -3px; }
  img { width: 100%; background: #fff; display: block; border-radius: 3px; }
  h3 { margin: 0 0 6px; font-size: 11px; color: #8a8a8a; font-weight: 600; text-transform: uppercase; letter-spacing: .06em; }
  .meta { grid-column: 1 / -1; font-size: 13px; color: #aaa; padding-top: 4px; }
  .verdict { font-weight: 700; }
  kbd { background: #2a2a2a; border: 1px solid #444; border-radius: 3px; padding: 1px 6px; font-size: 12px; }
  button { font: inherit; padding: 5px 12px; cursor: pointer; }
  .hint { font-size: 12px; color: #888; margin-top: 8px; line-height: 1.5; }
</style>
<header>
  <kbd>J</kbd> keep &nbsp; <kbd>K</kbd> drop &nbsp; <kbd>↑</kbd><kbd>↓</kbd> move &nbsp;
  <button id="save">Download approved.json</button>
  <button id="keepall">Keep all</button>
  <span id="count"></span>
  <div class="hint">
    Drop the pair if the <b>PRO result</b> shows any of: dial redrawn instead of copied ·
    leather colour or grain different from the catalog photo · strap forked, floating, or not
    threaded through the lugs · buckle segment not clearly shorter than the tail ·
    two parallel strips instead of one assembled watch · any hand, skin, or a second strap.
  </div>
</header>
<main id="list"></main>
<script>
const ITEMS = ${JSON.stringify(items)};
const PRESET = ${JSON.stringify(preset)};
const state = new Map(ITEMS.map(i => [i.id, i.id in PRESET ? PRESET[i.id] : null]));
let cursor = 0;

document.getElementById('list').innerHTML = ITEMS.map((it, i) => \`
  <section class="pair" id="p\${i}">
    <div><h3>1 · catalog photo</h3><img src="straps/\${it.productId}.png" loading="lazy"></div>
    <div><h3>2 · clean render</h3><img src="straps-clean/\${it.productId}.webp" loading="lazy"></div>
    <div><h3>3 · draft in</h3><img src="pairs/\${it.id}_start.png" loading="lazy"></div>
    <div><h3>4 · PRO result</h3><img src="pairs/\${it.id}_end.webp" loading="lazy"></div>
    <div class="meta">\${i + 1}/\${ITEMS.length} · \${it.productName} × \${it.faceKey} · <em>\${it.bucket}</em>
      <span class="verdict" id="v\${i}"></span></div>
  </section>\`).join('');

function render() {
  ITEMS.forEach((it, i) => {
    const el = document.getElementById('p' + i);
    const v = state.get(it.id);
    el.classList.toggle('keep', v === true);
    el.classList.toggle('drop', v === false);
    el.classList.toggle('current', i === cursor);
    document.getElementById('v' + i).textContent = v === true ? ' — KEEP' : v === false ? ' — DROP' : '';
  });
  const kept = [...state.values()].filter(v => v === true).length;
  const seen = [...state.values()].filter(v => v !== null).length;
  document.getElementById('count').textContent = \` — keeping \${kept}, decided \${seen}/\${ITEMS.length}\`;
  document.getElementById('p' + cursor)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

function mark(keep) {
  state.set(ITEMS[cursor].id, keep);
  if (cursor < ITEMS.length - 1) cursor++;
  render();
}

addEventListener('keydown', (e) => {
  if (e.key === 'j' || e.key === 'J') mark(true);
  else if (e.key === 'k' || e.key === 'K') mark(false);
  else if (e.key === 'ArrowDown') { cursor = Math.min(ITEMS.length - 1, cursor + 1); render(); }
  else if (e.key === 'ArrowUp') { cursor = Math.max(0, cursor - 1); render(); }
  else return;
  e.preventDefault();
});

document.getElementById('keepall').onclick = () => { ITEMS.forEach(i => state.set(i.id, true)); render(); };

document.getElementById('save').onclick = () => {
  const approved = ITEMS.filter(i => state.get(i.id) === true).map(i => i.id);
  const blob = new Blob([JSON.stringify({ approved }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'approved.json';
  a.click();
};

render();
</script>`;

    await writeFile(path.join(OUT_DIR, 'review.html'), html);
    console.log(`✅ ${items.length} pairs → ${path.join(OUT_DIR, 'review.html')}`);
    const decided = Object.keys(preset).length;
    if (decided) console.log(`   carried over ${Object.values(preset).filter(Boolean).length} keep / ${decided} earlier verdicts`);
    console.log('   Review, click "Download approved.json", then move it to scripts/dataset/out/');
    process.exit(0);
}

main().catch((err) => {
    console.error('❌', err);
    process.exit(1);
});
