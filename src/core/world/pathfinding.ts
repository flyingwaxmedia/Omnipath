// Grid pathfinding on a CompiledMap (8-directional A*, no corner cutting) plus line-of-walk tests.
// Pure: shared by the client (tap-to-walk, monster chase) and a future server.
import { TILE, isBlocked } from './compile';
import type { CompiledMap } from './types';

export interface Waypoint {
  x: number;
  y: number;
}

/** Default A* expansion cap (keeps a failed search cheap on a phone). */
export const PATH_NODE_CAP = 6000;

/** Binary min-heap of cell indices keyed by f. */
class Heap {
  private idx: number[] = [];
  private key: number[] = [];
  get size() {
    return this.idx.length;
  }
  push(i: number, f: number) {
    const a = this.idx;
    const k = this.key;
    a.push(i);
    k.push(f);
    let c = a.length - 1;
    while (c > 0) {
      const p = (c - 1) >> 1;
      if (k[p] <= k[c]) break;
      [a[p], a[c]] = [a[c], a[p]];
      [k[p], k[c]] = [k[c], k[p]];
      c = p;
    }
  }
  pop(): number {
    const a = this.idx;
    const k = this.key;
    const top = a[0];
    const lastI = a.pop()!;
    const lastK = k.pop()!;
    if (a.length) {
      a[0] = lastI;
      k[0] = lastK;
      let c = 0;
      for (;;) {
        const l = c * 2 + 1;
        const r = l + 1;
        let m = c;
        if (l < a.length && k[l] < k[m]) m = l;
        if (r < a.length && k[r] < k[m]) m = r;
        if (m === c) break;
        [a[m], a[c]] = [a[c], a[m]];
        [k[m], k[c]] = [k[c], k[m]];
        c = m;
      }
    }
    return top;
  }
}

const DIRS: readonly [number, number, number][] = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, Math.SQRT2],
  [1, -1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
  [-1, -1, Math.SQRT2],
];

const walkable = (cm: CompiledMap, tx: number, ty: number) => !isBlocked(cm, tx, ty);

/** Nearest walkable tile to (tx, ty), searching outward in square rings (Euclidean pick per ring). */
export function nearestWalkable(cm: CompiledMap, tx: number, ty: number, maxR = 6): [number, number] | null {
  if (walkable(cm, tx, ty)) return [tx, ty];
  for (let r = 1; r <= maxR; r++) {
    let best: [number, number] | null = null;
    let bestD = Infinity;
    for (let y = ty - r; y <= ty + r; y++) {
      for (let x = tx - r; x <= tx + r; x++) {
        if (Math.max(Math.abs(x - tx), Math.abs(y - ty)) !== r) continue;
        if (!walkable(cm, x, y)) continue;
        const d = Math.hypot(x - tx, y - ty);
        if (d < bestD) {
          bestD = d;
          best = [x, y];
        }
      }
    }
    if (best) return best;
  }
  return null;
}

/**
 * 8-directional A* with no corner cutting, from px (sx, sy) to px (ex, ey).
 * Returns smoothed px waypoints (excluding the start; [] when already there) or null when unreachable / over the cap.
 */
export function findPath(
  cm: CompiledMap,
  sx: number,
  sy: number,
  ex: number,
  ey: number,
  maxNodes = PATH_NODE_CAP,
): Waypoint[] | null {
  const start = nearestWalkable(cm, Math.floor(sx / TILE), Math.floor(sy / TILE), 2);
  const goal = nearestWalkable(cm, Math.floor(ex / TILE), Math.floor(ey / TILE));
  if (!start || !goal) return null;
  const w = cm.w;
  const [gx, gy] = goal;
  const startI = start[1] * w + start[0];
  const goalI = gy * w + gx;
  const n = w * cm.h;
  const g = new Float64Array(n).fill(Infinity);
  const parent = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const heur = (x: number, y: number) => {
    const dx = Math.abs(x - gx);
    const dy = Math.abs(y - gy);
    return dx + dy + (Math.SQRT2 - 2) * Math.min(dx, dy);
  };
  const open = new Heap();
  g[startI] = 0;
  open.push(startI, heur(start[0], start[1]));
  let expanded = 0;
  while (open.size) {
    const cur = open.pop();
    if (closed[cur]) continue;
    closed[cur] = 1;
    if (cur === goalI) {
      const out: Waypoint[] = [];
      for (let c = cur; c !== startI && c >= 0; c = parent[c]) {
        const cx = c % w;
        const cy = (c - cx) / w;
        out.push({ x: cx * TILE + TILE / 2, y: cy * TILE + TILE / 2 });
      }
      out.reverse();
      // Land exactly on the requested point when it is the goal tile.
      if (out.length && Math.floor(ex / TILE) === gx && Math.floor(ey / TILE) === gy) out[out.length - 1] = { x: ex, y: ey };
      return smoothPath(cm, sx, sy, out);
    }
    if (++expanded > maxNodes) return null;
    const x = cur % w;
    const y = (cur - x) / w;
    for (const [dx, dy, cost] of DIRS) {
      const nx = x + dx;
      const ny = y + dy;
      if (!walkable(cm, nx, ny)) continue;
      if (dx && dy && (!walkable(cm, x + dx, y) || !walkable(cm, x, y + dy))) continue;
      const ni = ny * w + nx;
      if (closed[ni]) continue;
      const ng = g[cur] + cost;
      if (ng >= g[ni]) continue;
      g[ni] = ng;
      parent[ni] = cur;
      open.push(ni, ng + heur(nx, ny));
    }
  }
  return null;
}

const BOX: readonly [number, number][] = [
  [0, 0],
  [6, 6],
  [-6, 6],
  [6, -6],
  [-6, -6],
];

/** Straight-line walkability test sampled every 8 px with a small box so corners are not clipped. */
export function lineClear(cm: CompiledMap, x0: number, y0: number, x1: number, y1: number): boolean {
  const d = Math.hypot(x1 - x0, y1 - y0);
  const steps = Math.ceil(d / 8);
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const x = x0 + (x1 - x0) * t;
    const y = y0 + (y1 - y0) * t;
    for (const [ox, oy] of BOX) {
      if (isBlocked(cm, Math.floor((x + ox) / TILE), Math.floor((y + oy) / TILE))) return false;
    }
  }
  return true;
}

/** String-pulling: drops waypoints that can be skipped with a clear straight line from the previous one. */
export function smoothPath(cm: CompiledMap, sx: number, sy: number, pts: Waypoint[]): Waypoint[] {
  if (pts.length < 2) return pts;
  const out: Waypoint[] = [];
  let ax = sx;
  let ay = sy;
  let i = 0;
  while (i < pts.length) {
    let j = pts.length - 1;
    while (j > i && !lineClear(cm, ax, ay, pts[j].x, pts[j].y)) j--;
    out.push(pts[j]);
    ax = pts[j].x;
    ay = pts[j].y;
    i = j + 1;
  }
  return out;
}
