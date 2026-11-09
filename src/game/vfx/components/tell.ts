// tell: telegraph pieces not covered by ring / decal (docs/VFX.md §5, §6.5): lane chevrons, arrowheads, aim beads,
// the lock flash, the off-screen edge indicator and the cancel fizzle. Danger pieces carry the #fff8f0 contrast line
// (ACCENT in the danger ramp) and the #24180f keyline; player previews use plain family inks.
// chevron / arrow / bead / edge are tile sets the runtime places ('pieces'); lock and fizzle are one-shots.
import { IDX, type TellParams, type Template } from '../types';
import type { Painter } from '../painter';
import { Strip, headingOf, mkKey, seedOf, type TemplateOptions } from './kit';

const CELL: Record<TellParams['piece'], number> = { chevron: 13, arrow: 15, bead: 7, lock: 17, edge: 15, fizzle: 13 };

function keyOf(p: TellParams, _motif: unknown, opts: TemplateOptions): string {
  return mkKey('tell', { piece: p.piece, danger: p.danger }, null, opts);
}

/** Contrast line on the leading (+x) edge and the keyline all round (danger only). */
function dangerize(p: Painter, danger: boolean): void {
  if (!danger) return;
  p.outline(IDX.ACCENT, (v) => v !== 0 && v !== IDX.ACCENT, 1);
  p.map((v, fx, fy) => {
    if (v !== IDX.ACCENT) return v;
    // Keep the contrast line only on the leading / upper side; elsewhere it becomes the keyline.
    const lx = fx - p.ox,
      ly = fy - p.oy;
    const c = Math.cos(p.angle),
      s = Math.sin(p.angle);
    return lx * c + ly * s > 0 || ly < -2 ? IDX.ACCENT : IDX.OUTLINE;
  });
  p.outline();
}

export const tell: Template<'tell'> = {
  id: 'tell',
  use: (p) => (p.piece === 'lock' || p.piece === 'fizzle' ? 'once' : 'pieces'),
  dirs: (p) => (p.piece === 'chevron' || p.piece === 'arrow' ? 16 : 1),
  key: keyOf,
  frames(prm, motif, u, opts) {
    const key = keyOf(prm, motif, opts);
    const C = CELL[prm.piece];
    const S = new Strip(C, C, C >> 1, C >> 1, seedOf(key, u), opts, { matter: prm.danger, glowFrom: 'none' });
    const heading = prm.piece === 'chevron' || prm.piece === 'arrow' ? headingOf(u, 16) : 0;
    const body = prm.danger ? IDX.R3 : IDX.R4;
    const hot = prm.danger ? IDX.R4 : IDX.R5;
    switch (prm.piece) {
      case 'chevron':
        S.add(33, (p) => {
          p.stroke(-2.5, -3.5, 1.5, 0, () => 2, (t) => (t > 0.6 ? hot : body));
          p.stroke(-2.5, 3.5, 1.5, 0, () => 2, (t) => (t > 0.6 ? hot : body));
          dangerize(p, prm.danger);
        }, 'normal', heading);
        return S.done('pieces');
      case 'arrow':
        S.add(33, (p) => {
          p.poly([5, 0, -3.5, -4.5, -1.5, 0, -3.5, 4.5], (lx) => (lx > 1.5 ? hot : body));
          dangerize(p, prm.danger);
        }, 'normal', heading);
        return S.done('pieces');
      case 'bead':
        S.add(33, (p) => {
          p.disc(0, 0, 1, body);
          p.set(p.ox - 1, p.oy - 1, hot);
          if (prm.danger) p.outline();
        });
        return S.done('pieces');
      case 'edge':
        S.add(33, (p) => {
          p.disc(0, 0, 5, IDX.R2);
          p.ring(0, 0, 5, 1, body);
          p.line(0, -3, 0, 0, prm.danger ? IDX.ACCENT : IDX.R5);
          p.dot(0, 2, prm.danger ? IDX.ACCENT : IDX.R5);
          p.outline();
        });
        return S.done('pieces');
      case 'lock':
        S.add(50, (p) => {
          const d = 6;
          for (const [sx, sy] of [
            [-1, -1],
            [1, -1],
            [1, 1],
            [-1, 1],
          ]) {
            p.line(sx * d, sy * d, sx * (d - 3), sy * d, IDX.R5);
            p.line(sx * d, sy * d, sx * d, sy * (d - 3), IDX.R5);
          }
          p.dot(0, 0, prm.danger ? IDX.ACCENT : IDX.R5);
          if (prm.danger) p.outline();
        });
        return S.done('once');
      case 'fizzle':
        S.add(50, (p) => {
          p.disc(0, 0, 3, IDX.R2);
          p.disc(-1, -1, 1.5, IDX.R3);
        });
        S.add(67, (p) => p.crescent(0, -1, 4, 1.5, 1.5, 3.5, IDX.R1));
        S.add(67, (p) => p.crescent(0, -2, 4.5, 1, 1, 4.6, IDX.R1));
        return S.done('once');
    }
  },
};
