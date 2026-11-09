// SCRATCH (map review) — exports every compiled map to /tmp/omnipath-maps/*.json. Delete after use.
import { mkdirSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { STRUCTURE_FOOTPRINT, arrivalTile, compileMap } from '../src/core/world/compile';
import { COLL } from '../src/core/world/types';
import { MAPS } from '../src/data/world';
import { MONSTERS } from '../src/data/monsters';

const OUT = '/tmp/omnipath-maps';

describe('tmp map export', () => {
  it('exports', () => {
    mkdirSync(OUT, { recursive: true });
    const mons = new Map(MONSTERS.map((m) => [m.id, m]));
    const summary: unknown[] = [];
    for (const def of MAPS) {
      const cm = compileMap(def);
      const { w, h } = cm;
      const blocked = (x: number, y: number) => x < 0 || y < 0 || x >= w || y >= h || (cm.coll[y * w + x] & COLL.BLOCK) !== 0;
      // 8-dir BFS (no corner cutting) distance field from a tile, Dijkstra-ish with unit/diag cost approximated via BFS on octile
      const distFrom = (sx: number, sy: number) => {
        const d = new Float64Array(w * h).fill(Infinity);
        if (blocked(sx, sy)) return d;
        // Dijkstra with small heap substitute (bucket by 0.1)
        const q: [number, number][] = [[sy * w + sx, 0]];
        d[sy * w + sx] = 0;
        while (q.length) {
          let bi = 0;
          for (let k = 1; k < q.length; k++) if (q[k][1] < q[bi][1]) bi = k;
          const [i, dist] = q[bi];
          q[bi] = q[q.length - 1];
          q.pop();
          if (dist > d[i]) continue;
          const x = i % w;
          const y = (i / w) | 0;
          for (const [dx, dy] of [
            [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1],
          ]) {
            const nx = x + dx;
            const ny = y + dy;
            if (blocked(nx, ny)) continue;
            if (dx && dy && (blocked(x + dx, y) || blocked(x, y + dy))) continue;
            const nd = dist + (dx && dy ? Math.SQRT2 : 1);
            const ni = ny * w + nx;
            if (nd < d[ni]) {
              d[ni] = nd;
              q.push([ni, nd]);
            }
          }
        }
        return d;
      };
      const portals = def.portals.map((p) => {
        const [ax, ay] = arrivalTile(p);
        const arr = cm.arrivals[p.id];
        return { ...p, arrivalTile: [ax, ay], arrivalPx: arr, arrival: [Math.floor(arr.x / 32), Math.floor(arr.y / 32)] };
      });
      // portal-to-portal walking distances (from arrival of A to nearest tile of rect B)
      const pdist: Record<string, Record<string, number>> = {};
      const fields: Record<string, Float64Array> = {};
      for (const p of portals) {
        const f = distFrom(p.arrival[0], p.arrival[1]);
        fields[p.id] = f;
        pdist[p.id] = {};
        for (const q of portals) {
          if (q.id === p.id) continue;
          let best = Infinity;
          for (let y = q.ty; y < q.ty + q.h; y++) for (let x = q.tx; x < q.tx + q.w; x++) if (x >= 0 && y >= 0 && x < w && y < h) best = Math.min(best, f[y * w + x]);
          pdist[p.id][q.id] = Math.round(best * 10) / 10;
        }
      }
      // reachability from first portal arrival
      const f0 = fields[portals[0].id];
      let walk = 0;
      let reach = 0;
      for (let i = 0; i < w * h; i++) {
        if (!(cm.coll[i] & COLL.BLOCK)) {
          walk++;
          if (f0[i] < Infinity) reach++;
        }
      }
      // max distance from any portal to any reachable tile (dead space measure)
      let far = 0;
      let farTile: [number, number] = [0, 0];
      for (let i = 0; i < w * h; i++) {
        let m = Infinity;
        for (const p of portals) m = Math.min(m, fields[p.id][i]);
        if (m < Infinity && m > far) {
          far = m;
          farTile = [i % w, (i / w) | 0];
        }
      }
      const entityInfo = (tx: number, ty: number) => {
        let open4 = 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (!blocked(tx + dx, ty + dy)) open4++;
        let reachAdj = false;
        let dmin = Infinity;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
          const nx = tx + dx;
          const ny = ty + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          for (const p of portals) {
            const v = fields[p.id][ny * w + nx];
            if (v < Infinity) {
              reachAdj = true;
              dmin = Math.min(dmin, v);
            }
          }
        }
        return { open4, reachAdj, nearestPortalDist: Math.round(dmin) };
      };
      const spawns = def.spawns.map((s) => {
        const m = mons.get(s.monster);
        let tot = 0;
        let open = 0;
        for (let y = s.cy - s.r; y <= s.cy + s.r; y++)
          for (let x = s.cx - s.r; x <= s.cx + s.r; x++) {
            if ((x - s.cx) ** 2 + (y - s.cy) ** 2 > s.r * s.r) continue;
            tot++;
            if (!blocked(x, y)) open++;
          }
        const pd: Record<string, number> = {};
        for (const p of portals) pd[p.id] = Math.round(Math.hypot(p.arrival[0] - s.cx, p.arrival[1] - s.cy));
        return {
          ...s,
          level: m?.level ?? null,
          rank: m?.rank ?? 'MISSING',
          openFrac: Math.round((open / Math.max(1, tot)) * 100) / 100,
          centreBlocked: blocked(s.cx, s.cy),
          eucToPortalArrivals: pd,
          density: Math.round((s.count / Math.max(1, open)) * 100) / 100,
        };
      });
      const tileCounts: Record<number, number> = {};
      for (const g of cm.ground) tileCounts[g] = (tileCounts[g] ?? 0) + 1;
      const out = {
        id: def.id,
        name: def.name,
        kind: def.kind,
        biome: def.biome,
        levelBand: def.levelBand,
        safety: def.safety,
        landmark: def.landmark ?? null,
        flags: def.flags ?? [],
        w,
        h,
        ground: Array.from(cm.ground),
        coll: Array.from(cm.coll),
        props: cm.props,
        structures: (def.structures ?? []).map((s) => ({ ...s, ...STRUCTURE_FOOTPRINT[s.kind] })),
        portals,
        spawns,
        nodes: (def.nodes ?? []).map((n) => ({ ...n, ...entityInfo(n.tx, n.ty) })),
        npcs: (def.npcs ?? []).map((n) => ({ ...n, ...entityInfo(n.tx, n.ty) })),
        objects: (def.objects ?? []).map((o) => ({ ...o, ...entityInfo(o.tx, o.ty) })),
        arrivals: cm.arrivals,
        spawn: cm.spawn,
        paths: def.paths ?? [],
        stats: {
          walk,
          reach,
          unreachableWalkable: walk - reach,
          walkFrac: Math.round((walk / (w * h)) * 100) / 100,
          farthestFromAnyPortal: Math.round(far),
          farTile,
          portalDist: pdist,
          monsters: def.spawns.reduce((a, s) => a + s.count, 0),
          tileCounts,
          props: cm.props.length,
        },
      };
      writeFileSync(`${OUT}/${def.id}.json`, JSON.stringify(out));
      summary.push({ id: def.id, band: def.levelBand, stats: { ...out.stats, tileCounts: undefined }, spawns, npcs: out.npcs, objects: out.objects, nodes: out.nodes });
    }
    writeFileSync(`${OUT}/_summary.json`, JSON.stringify(summary, null, 1));
    expect(MAPS.length).toBe(28);
  });
});
