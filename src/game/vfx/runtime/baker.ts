// Time-sliced baker (docs/VFX.md §8.5): turns pieces into atlas strips one unique direction per step, so a frame
// never stalls on a big smear. Requests come in two priorities: `need` (a live effect is waiting: it plays the
// fallback until the strip is ready) and `warm` (the map / loadout warm set, baked behind the fade and in idle
// slices). The per-direction bake mirrors bake.ts bakePiece exactly (same LUT, glow twins, dedup, flash accounting).
import { colourise, glowTwin, indexFrames, pieceKey } from '../bake';
import { TEMPLATES } from '../components';
import type { PFrame } from '../painter';
import { NO_GLOW, lut as lutFor } from '../ramps';
import { DEFAULT_BAKE, IDX, UNIQUE_DIRS, type BakeOptions, type ComponentId, type DirCount, type FamilyId, type IndexFrame, type RgbaFrame, type StripUse, type VfxPiece } from '../types';
import type { Atlas, AtlasEntry } from './atlas';

interface AnyTemplate {
  use(p: unknown): StripUse;
  dirs(p: unknown): DirCount;
  key(p: unknown, motif: FamilyId, opts: BakeOptions & { half?: 'back' | 'front' }): string;
}
const templateOf = (c: ComponentId): AnyTemplate => TEMPLATES[c] as unknown as AnyTemplate;

export interface BakeReq {
  key: string;
  piece: VfxPiece;
  opts: BakeOptions;
}

interface Job extends BakeReq {
  entry: AtlasEntry;
  u: number;
  uniq: number;
  hero: Set<number>;
  flash: number[];
}

function sameFrame(a: IndexFrame, b: IndexFrame): boolean {
  if (a.w !== b.w || a.h !== b.h || a.ox !== b.ox || a.oy !== b.oy) return false;
  for (let i = 0; i < a.body.length; i++) if (a.body[i] !== b.body[i] || a.glow[i] !== b.glow[i]) return false;
  return true;
}

function count(f: IndexFrame, i: number): number {
  let n = 0;
  for (const v of f.body) if (v === i) n++;
  return n;
}

const clock = (): number => (typeof performance !== 'undefined' ? performance.now() : 0);

/** The bake request of a piece under explicit options (key = bake.ts pieceKey). */
export function bakeReq(piece: VfxPiece, opts: Partial<BakeOptions> = {}): BakeReq {
  const o: BakeOptions = { lut: opts.lut ?? piece.lut ?? DEFAULT_BAKE.lut, reduceFlash: opts.reduceFlash ?? false, keyline: opts.keyline ?? false };
  return { key: pieceKey(piece, o), piece, opts: o };
}

export class Baker {
  private need: Job[] = [];
  private warm: Job[] = [];
  private queued = new Set<string>();
  private retries = new Map<string, number>();
  /** Total bake time (ms) and strips (stats). */
  bakedMs = 0;
  bakedStrips = 0;
  failed = 0;
  /** Called when the atlas is full: may evict a page; returns false when nothing could be freed. */
  onFull: () => boolean = () => false;

  constructor(
    private readonly atlas: Atlas,
    private readonly now: () => number,
  ) {}

  get pending(): number {
    return this.need.length + this.warm.length;
  }

  get warmPending(): number {
    return this.warm.length;
  }

  /** Is this request baked (not necessarily uploaded)? */
  has(key: string): boolean {
    const e = this.atlas.entry(key);
    return !!e && e.strips.every((s) => s !== null);
  }

  /** Queues a request (no-op when baked or queued). `urgent` jumps ahead of the warm set. */
  request(req: BakeReq, urgent: boolean): void {
    if (this.queued.has(req.key)) {
      if (urgent) {
        const i = this.warm.findIndex((j) => j.key === req.key);
        if (i >= 0) this.need.push(...this.warm.splice(i, 1));
      }
      return;
    }
    const have = this.atlas.entry(req.key);
    if (have && have.strips.every((s) => s !== null)) return;
    const t = templateOf(req.piece.component);
    const dirs = t.dirs(req.piece.params);
    const geometryKey = t.key(req.piece.params, req.piece.motif, { ...req.opts, half: req.piece.anchor?.half });
    const uniq = UNIQUE_DIRS[dirs];
    const entry = have ?? this.atlas.begin(req.key, geometryKey, t.use(req.piece.params), dirs, uniq);
    const job: Job = { ...req, entry, u: entry.strips.findIndex((s) => s === null), uniq, hero: new Set(), flash: [] };
    if (job.u < 0) return;
    this.queued.add(req.key);
    (urgent ? this.need : this.warm).push(job);
  }

  /**
   * Bakes directions until `budgetMs` is spent (always at least one when anything is queued and `atLeastOne`).
   * Urgent work first. Returns the number of directions baked.
   */
  pump(budgetMs: number, atLeastOne = true, urgentOnly = false): number {
    const t0 = clock();
    let n = 0;
    while (this.need.length || (!urgentOnly && this.warm.length)) {
      if (n > 0 || !atLeastOne) if (clock() - t0 >= budgetMs) break;
      const list = this.need.length ? this.need : this.warm;
      const job = list[0];
      const s = clock();
      const ok = this.step(job);
      this.bakedMs += clock() - s;
      if (!ok) {
        // Atlas full: drop the job, free the least recently used page and queue the request afresh (its partial
        // strips may have lived on the freed page); when nothing can be freed the effect keeps its fallback.
        list.shift();
        this.queued.delete(job.key);
        this.atlas.entries.delete(job.key);
        const tries = (this.retries.get(job.key) ?? 0) + 1;
        this.retries.set(job.key, tries);
        if (tries <= 2 && this.onFull()) this.request({ key: job.key, piece: job.piece, opts: job.opts }, list === this.need);
        else this.failed++;
        continue;
      }
      n++;
      this.bakedStrips++;
      if (job.u >= job.uniq) {
        list.shift();
        this.queued.delete(job.key);
        job.entry.heroFrames = [...job.hero].sort((a, b) => a - b);
        job.entry.flashPx = job.flash;
        this.atlas.settle(job.entry);
      }
    }
    return n;
  }

  /** Bakes the next direction of a job into the atlas; false when the atlas has no room. */
  private step(job: Job): boolean {
    const { piece, opts } = job;
    const u = job.u;
    const idx = indexFrames(piece, u, opts);
    const table = lutFor(piece.ramp, opts.lut);
    const noGlow = NO_GLOW.has(piece.ramp) && piece.component !== 'missile';
    const whiteShows = opts.lut === 'base';
    const frames: RgbaFrame[] = [];
    const glow: RgbaFrame[] = [];
    idx.forEach((f, k) => {
      const prev = k > 0 ? idx[k - 1] : null;
      if (prev && sameFrame(prev, f)) {
        frames.push({ ...frames[k - 1], ms: f.ms });
        glow.push({ ...glow[k - 1], ms: f.ms });
      } else {
        frames.push(colourise(f, table));
        glow.push(noGlow ? { w: 0, h: 0, ox: f.ox, oy: f.oy, ms: f.ms, data: new Uint8ClampedArray(0) } : glowTwin(f));
      }
      const white = count(f, IDX.WHITE);
      if (white && whiteShows) job.hero.add(k);
      const contrast = (f as PFrame).kind === 'contrast' ? count(f, IDX.R0) : 0;
      job.flash[k] = Math.max(job.flash[k] ?? 0, white + count(f, IDX.R5) + contrast);
    });
    if (!this.atlas.addStrip(job.entry, u, frames, noGlow ? null : glow, this.now())) return false;
    job.u = job.entry.strips.findIndex((s) => s === null);
    if (job.u < 0) job.u = job.uniq;
    return true;
  }

  clear(): void {
    this.need = [];
    this.warm = [];
    this.queued.clear();
  }
}
