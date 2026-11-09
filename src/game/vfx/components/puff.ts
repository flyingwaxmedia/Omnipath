// puff: soft volumes with hard pixels (smoke, dust, vapour, veil, gas, cloud, steam), docs/VFX.md §5.
// 8 x 83 ms: the body grows, a lit cap shows while age < 0.5, the ink steps one ramp index darker every 2 frames (smoke
// starts hot in R4 / R3 and cools through the secondary ramp S3 -> S1) and
// the last 3 frames dissolve by crescent erosion (Saint11). Opaque coverage only, never tweened alpha.
import { IDX, type PuffKind, type PuffParams, type Template } from '../types';
import { crescentEraser } from '../dither';
import { ERASE, step } from '../painter';
import { Strip, mkKey, seedOf, type TemplateOptions } from './kit';

/** Base body index per kind: veil and cloud use the secondary ramp (stealth veil, storm cloud). */
const BASE: Record<PuffKind, number> = {
  smoke: IDX.R3,
  dust: IDX.R3,
  vapour: IDX.R4,
  steam: IDX.R4,
  gas: IDX.R3,
  veil: IDX.S2,
  cloud: IDX.S2,
};

function keyOf(p: PuffParams, _motif: unknown, opts: TemplateOptions): string {
  return mkKey('puff', { kind: p.kind, r: p.r }, null, opts);
}

export const puff: Template<'puff'> = {
  id: 'puff',
  use: () => 'once',
  dirs: () => 1,
  key: keyOf,
  frames(prm, motif, u, opts) {
    const key = keyOf(prm, motif, opts);
    const r = prm.r;
    const half = Math.ceil(r * 1.5) + 2;
    const S = new Strip(2 * half + 1, 2 * half + 1, half, half, seedOf(key, u), opts, { glowFrom: 'none' });
    const base = BASE[prm.kind];
    const rising = prm.kind === 'steam' || prm.kind === 'vapour';
    const n = 8;
    for (let i = 0; i < n; i++) {
      S.add(83, (p) => {
        const a = i / n;
        const rr = r * (0.65 + 0.45 * Math.min(1, 2.5 * a) + 0.4 * a);
        // Smoke leaves the flame hot (R4, R3) and cools into the secondary ramp (fire: smoke greys, magma: crust).
        const body = prm.kind === 'smoke' ? [IDX.R4, IDX.R3, IDX.S3, IDX.S3, IDX.S2, IDX.S2, IDX.S1, IDX.S1][i] : step(base, -Math.floor(i / 2));
        // Cauliflower silhouette: a main lobe and two smaller top lobes drawn over it, with crescent shading (one lit
        // cap toward the top-left light while young, a shadow crescent on the base's lower-right rim), so the puff
        // reads as a soft volume rather than a ball.
        const lobes = [
          [0, 0, rr],
          [-0.44 * rr, -0.34 * rr, 0.62 * rr],
          [0.42 * rr, -0.28 * rr, 0.56 * rr],
        ];
        p.fill(-2 * rr - 1, -2 * rr - 1, 2 * rr + 1, 2 * rr + 1, (lx, ly) => {
          let hit = -1;
          for (let q = 0; q < lobes.length; q++) if (Math.hypot(lx - lobes[q][0], ly - lobes[q][1]) <= lobes[q][2] + 0.35) hit = q;
          if (hit < 0) return 0;
          const [cx, cy, lr] = lobes[hit];
          // Shadow crescent on the outer lower-right rim of the base lobe only; one lit cap on the lobe nearest the light.
          if (hit === 0 && Math.hypot(lx - (cx - 0.24 * lr), ly - (cy - 0.24 * lr)) > lr * 0.9 + 0.35) return step(body, -1);
          if (hit === 1 && a < 0.5 && Math.hypot(lx - (cx - 0.2 * lr), ly - (cy - 0.25 * lr)) < lr * 0.5) return step(body, 1);
          return body;
        });
        if (prm.kind === 'gas') p.outline(IDX.ACCENT, (v) => v !== 0 && v !== IDX.ACCENT);
        if (i >= n - 3) {
          const e = crescentEraser(0, 0, rr, i - (n - 4), 3, rising ? 0 : -0.6, rising ? -1 : -0.8);
          p.disc(e.x, e.y, e.r, ERASE);
        }
      });
    }
    return S.done('once');
  },
};
