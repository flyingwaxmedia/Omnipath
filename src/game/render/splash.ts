// Boot splash (render lane; docs/QUALITY-PLAN.md §5): a pixel title over a dark wood background and a progress bar,
// shown from the first paint (index.html carries the same markup) until BootScene has generated every texture.
// The single-file build has no index.html, so ensureSplash() builds it when missing. Styles: src/ui/styles/render.css.
import { glyphMasks, GLYPH_ROWS, FONT_OUTLINE } from './glyphs';

/** The splash title as a crisp SVG built from the in-world pixel font (gold, bevelled, outlined, with a shadow). */
export function titleSvg(text = 'OMNIPATH'): string {
  const gl = glyphMasks();
  const ink = new Set<string>();
  let x = 1;
  for (const ch of text) {
    const m = gl.get(ch);
    if (!m) continue;
    for (let y = 0; y < GLYPH_ROWS; y++) for (let gx = 0; gx < m.w; gx++) if (m.bits[y * m.w + gx]) ink.add(`${x + gx},${y + 1}`);
    x += m.w + 1;
  }
  const w = x + 1;
  const h = 7 + 4; // cap height + outline + shadow
  const has = (px: number, py: number) => ink.has(`${px},${py}`);
  const paint = new Map<string, string>(); // "x,y" -> colour (later layers win)
  // shadow (one row down), outline (8-neighbour), then the bevelled gold ink
  for (const k of ink) {
    const [px, py] = k.split(',').map(Number);
    for (let dy = -1; dy <= 2; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const q = `${px + dx},${py + dy}`;
        if (!ink.has(q)) paint.set(q, FONT_OUTLINE);
      }
  }
  for (const k of ink) {
    const [px, py] = k.split(',').map(Number);
    const top = !has(px, py - 1);
    const bottom = !has(px, py + 1);
    paint.set(k, top ? '#fff1c0' : bottom ? '#b0803a' : py <= 4 ? '#f4d47a' : '#e9c46a');
  }
  // one path per colour, horizontal runs merged
  const paths: string[] = [];
  for (const color of new Set(paint.values())) {
    let d = '';
    for (let py = 0; py < h; py++) {
      let px = 0;
      while (px < w) {
        if (paint.get(`${px},${py}`) !== color) {
          px++;
          continue;
        }
        let len = 1;
        while (paint.get(`${px + len},${py}`) === color) len++;
        d += `M${px} ${py}h${len}v1h-${len}z`;
        px += len;
      }
    }
    paths.push(`<path fill="${color}" d="${d}"/>`);
  }
  return (
    `<svg class="boot-title" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w * 8}" height="${h * 8}" ` +
    `shape-rendering="crispEdges" role="img" aria-label="Omnipath">${paths.join('')}</svg>`
  );
}

/** The splash element: the one index.html put there, or a fresh one. */
export function ensureSplash(): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  let el = document.getElementById('boot');
  if (!el) {
    el = document.createElement('div');
    el.id = 'boot';
    el.innerHTML = `${titleSvg()}<div class="boot-bar"><i></i></div><div class="boot-note">Getting ready…</div>`;
    document.body.append(el);
  }
  return el;
}

/** Moves the bar to `fraction` (0..1) and optionally changes the line under it. */
export function splashProgress(fraction: number, note?: string): void {
  const el = typeof document === 'undefined' ? null : document.getElementById('boot');
  if (!el) return;
  const bar = el.querySelector<HTMLElement>('.boot-bar > i');
  if (bar) bar.style.width = `${Math.round(Math.max(0, Math.min(1, fraction)) * 100)}%`;
  if (note !== undefined) {
    const n = el.querySelector<HTMLElement>('.boot-note');
    if (n) n.textContent = note;
  }
}

/** Fades the splash out and removes it (call before 'omnipath:ready' so the title screen shows). */
export function removeSplash(): void {
  const el = typeof document === 'undefined' ? null : document.getElementById('boot');
  if (!el) return;
  if (el.classList.contains('done')) return;
  el.classList.add('done');
  setTimeout(() => el.remove(), 320);
}
