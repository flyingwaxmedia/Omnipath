import { TILE, isWalkable, type WorldMap } from './map';

interface Node {
  x: number;
  y: number;
  g: number;
  f: number;
  parent: Node | null;
}

class Heap {
  private a: Node[] = [];
  get size() {
    return this.a.length;
  }
  push(n: Node) {
    const a = this.a;
    a.push(n);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].f <= a[i].f) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop(): Node {
    const a = this.a;
    const top = a[0];
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l].f < a[m].f) m = l;
        if (r < a.length && a[r].f < a[m].f) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

const DIRS: [number, number, number][] = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, Math.SQRT2],
  [1, -1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
  [-1, -1, Math.SQRT2],
];

/** Nearest walkable tile to (tx, ty), searching outward in rings. */
export function nearestWalkable(map: WorldMap, tx: number, ty: number, maxR = 6): [number, number] | null {
  if (isWalkable(map, tx, ty)) return [tx, ty];
  for (let r = 1; r <= maxR; r++) {
    let best: [number, number] | null = null;
    let bestD = Infinity;
    for (let y = ty - r; y <= ty + r; y++)
      for (let x = tx - r; x <= tx + r; x++) {
        if (Math.max(Math.abs(x - tx), Math.abs(y - ty)) !== r) continue;
        if (!isWalkable(map, x, y)) continue;
        const d = Math.hypot(x - tx, y - ty);
        if (d < bestD) {
          bestD = d;
          best = [x, y];
        }
      }
    if (best) return best;
  }
  return null;
}

/** 8-directional A* with no corner cutting. Returns world-px waypoints (excluding start). */
export function findPath(
  map: WorldMap,
  sx: number,
  sy: number,
  ex: number,
  ey: number,
  maxNodes = 6000,
): { x: number; y: number }[] | null {
  const start = nearestWalkable(map, Math.floor(sx / TILE), Math.floor(sy / TILE), 2);
  const goal = nearestWalkable(map, Math.floor(ex / TILE), Math.floor(ey / TILE));
  if (!start || !goal) return null;
  const [gx, gy] = goal;
  const key = (x: number, y: number) => y * map.w + x;
  const open = new Heap();
  const best = new Map<number, number>();
  const closed = new Set<number>();
  const h = (x: number, y: number) => {
    const dx = Math.abs(x - gx);
    const dy = Math.abs(y - gy);
    return dx + dy + (Math.SQRT2 - 2) * Math.min(dx, dy);
  };
  open.push({ x: start[0], y: start[1], g: 0, f: h(start[0], start[1]), parent: null });
  best.set(key(start[0], start[1]), 0);
  let expanded = 0;
  while (open.size) {
    const cur = open.pop();
    const ck = key(cur.x, cur.y);
    if (closed.has(ck)) continue;
    closed.add(ck);
    if (cur.x === gx && cur.y === gy) {
      const out: { x: number; y: number }[] = [];
      let n: Node | null = cur;
      while (n && n.parent) {
        out.push({ x: n.x * TILE + TILE / 2, y: n.y * TILE + TILE / 2 });
        n = n.parent;
      }
      out.reverse();
      // Land exactly on the requested point when it is walkable.
      if (out.length && Math.floor(ex / TILE) === gx && Math.floor(ey / TILE) === gy) out[out.length - 1] = { x: ex, y: ey };
      return smooth(map, sx, sy, out);
    }
    if (++expanded > maxNodes) return null;
    for (const [dx, dy, cost] of DIRS) {
      const nx = cur.x + dx;
      const ny = cur.y + dy;
      if (!isWalkable(map, nx, ny)) continue;
      if (dx && dy && (!isWalkable(map, cur.x + dx, cur.y) || !isWalkable(map, cur.x, cur.y + dy))) continue;
      const nk = key(nx, ny);
      if (closed.has(nk)) continue;
      const g = cur.g + cost;
      if (g >= (best.get(nk) ?? Infinity)) continue;
      best.set(nk, g);
      open.push({ x: nx, y: ny, g, f: g + h(nx, ny), parent: cur });
    }
  }
  return null;
}

/** Straight-line walkability test sampled every few px. */
export function lineClear(map: WorldMap, x0: number, y0: number, x1: number, y1: number): boolean {
  const d = Math.hypot(x1 - x0, y1 - y0);
  const steps = Math.ceil(d / 8);
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const x = x0 + (x1 - x0) * t;
    const y = y0 + (y1 - y0) * t;
    // Sample a small box so we don't clip corners.
    for (const [ox, oy] of [
      [0, 0],
      [6, 6],
      [-6, 6],
      [6, -6],
      [-6, -6],
    ]) {
      if (!isWalkable(map, Math.floor((x + ox) / TILE), Math.floor((y + oy) / TILE))) return false;
    }
  }
  return true;
}

/** Removes waypoints that can be skipped with a clear straight line. */
function smooth(map: WorldMap, sx: number, sy: number, pts: { x: number; y: number }[]) {
  if (pts.length < 2) return pts;
  const out: { x: number; y: number }[] = [];
  let ax = sx;
  let ay = sy;
  let i = 0;
  while (i < pts.length) {
    let j = pts.length - 1;
    while (j > i && !lineClear(map, ax, ay, pts[j].x, pts[j].y)) j--;
    out.push(pts[j]);
    ax = pts[j].x;
    ay = pts[j].y;
    i = j + 1;
  }
  return out;
}
