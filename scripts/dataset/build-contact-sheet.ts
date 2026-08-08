import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

// A static HTML page opened straight from disk — no dev server, no route in the app, so the
// frozen customer UI stays untouched. Keyboard-driven because the reviewer is making the same
// keep/drop call a couple of dozen times and clicking would be slower than it needs to be.

const OUT_DIR = path.join(process.cwd(), 'scripts/dataset/out');

type Pair = { id: string; bucket: string; productName: string; faceKey: string };

async function main() {
    const manifest: Pair[] = JSON.parse(await readFile(path.join(OUT_DIR, 'pairs-train.json'), 'utf8'));

    const html = `<!doctype html>
<meta charset="utf-8">
<title>LoRA pair review</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 0; background: #111; color: #eee; }
  header { position: sticky; top: 0; background: #000; padding: 12px 20px; border-bottom: 1px solid #333; z-index: 2; }
  .pair { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; padding: 20px; border-bottom: 1px solid #333; }
  .pair.keep { background: #0b2a12; }
  .pair.drop { background: #2a0b0b; opacity: .45; }
  .pair.current { outline: 3px solid #4ea1ff; outline-offset: -3px; }
  img { width: 100%; background: #fff; display: block; }
  h3 { margin: 0 0 6px; font-size: 12px; color: #999; font-weight: 500; text-transform: uppercase; letter-spacing: .05em; }
  .meta { grid-column: 1 / -1; font-size: 13px; color: #999; }
  button { font: inherit; padding: 4px 10px; }
</style>
<header>
  <b>J</b> keep &nbsp; <b>K</b> drop &nbsp; <b>↑ ↓</b> move &nbsp;
  <button id="save">Download approved.json</button>
  <span id="count"></span>
  <div style="font-size:12px;color:#888;margin-top:6px">
    Drop if: the dial was redrawn rather than copied · strap colour or grain differs from the left image ·
    the strap forked, floats, or misses the lugs · the buckle segment is not clearly shorter than the tail ·
    any hand, skin, or a second strap survived.
  </div>
</header>
<main id="list"></main>
<script>
const ITEMS = ${JSON.stringify(manifest)};
const state = new Map(ITEMS.map(i => [i.id, null]));
let cursor = 0;

const list = document.getElementById('list');
list.innerHTML = ITEMS.map((it, i) => \`
  <section class="pair" id="p\${i}">
    <div><h3>before — draft</h3><img src="pairs/\${it.id}_start.png" loading="lazy"></div>
    <div><h3>after — PRO</h3><img src="pairs/\${it.id}_end.webp" loading="lazy"></div>
    <div class="meta">\${i + 1}/\${ITEMS.length} — \${it.productName} × \${it.faceKey} <em>(\${it.bucket})</em></div>
  </section>\`).join('');

function render() {
  ITEMS.forEach((it, i) => {
    const el = document.getElementById('p' + i);
    el.classList.toggle('keep', state.get(it.id) === true);
    el.classList.toggle('drop', state.get(it.id) === false);
    el.classList.toggle('current', i === cursor);
  });
  const kept = [...state.values()].filter(v => v === true).length;
  const seen = [...state.values()].filter(v => v !== null).length;
  document.getElementById('count').textContent = \` — kept \${kept}, reviewed \${seen}/\${ITEMS.length}\`;
  document.getElementById('p' + cursor)?.scrollIntoView({ block: 'center' });
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
    console.log(`✅ ${manifest.length} pairs → ${path.join(OUT_DIR, 'review.html')}`);
    console.log('   Open it, review, click "Download approved.json", then move that file into out/');
    process.exit(0);
}

main().catch((err) => {
    console.error('❌', err);
    process.exit(1);
});
