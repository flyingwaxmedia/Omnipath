// TEMPORARY map-authoring harness for the Gloomwood / Hollow Barrow / Stormbreak maps (deleted before finishing).
import { describe, expect, it } from 'vitest';
import { STRUCTURE_FOOTPRINT, arrivalTile, compileMap } from '../src/core/world/compile';
import { T } from '../src/core/world/tiles';
import { COLL, type CompiledMap, type MapDef } from '../src/core/world/types';
import { renderAscii, validateMap } from '../src/core/world/validate';

import gloomwood from '../src/data/maps/vale/gloomwood';
import glade from '../src/data/maps/vale/moonlit_glade';
import hb1 from '../src/data/maps/vale/hollow_barrow_1';
import hb2 from '../src/data/maps/vale/hollow_barrow_2';
import hb3 from '../src/data/maps/vale/hollow_barrow_3';
import hb4 from '../src/data/maps/vale/hollow_barrow_4';
import vault from '../src/data/maps/vale/barrow_vault';
import approach from '../src/data/maps/vale/stormbreak_approach';
import stormbreak from '../src/data/maps/vale/stormbreak';

const ONLY = (process.env.MAPS ?? '').split(',').filter(Boolean);
const all: MapDef[] = [gloomwood, glade, hb1, hb2, hb3, hb4, vault, approach, stormbreak];
const maps = all.filter((m) => !ONLY.length || ONLY.some((o) => m.id.endsWith(o)));

const TREES = new Set(['tree', 'darktree', 'deadtree', 'pine', 'frostpine', 'duskwillow', 'basalt_spire', 'tombstone']);
const WALLS = new Set<number>([T.CLIFF, T.CAVE_WALL, T.CRYPT_WALL]);

function overlay(cm: CompiledMap): string[] {
  const { w, h, def } = cm;
  const propAt = new Map<number, string>();
  for (const p of cm.props) propAt.set(p.ty * w + p.tx, p.kind);
  const g: string[][] = [];
  for (let y = 0; y < h; y++) {
    const row: string[] = [];
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const t = cm.ground[i];
      const c = cm.coll[i];
      const pk = propAt.get(i);
      let ch = '.';
      if (t === T.VOID) ch = ' ';
      else if (WALLS.has(t)) ch = '#';
      else if (t === T.LAVA) ch = 'L';
      else if (t === T.DEEP) ch = '~';
      else if (t === T.WATER) ch = '-';
      else if (pk && c & COLL.BLOCK) ch = TREES.has(pk) ? 'T' : pk === 'stalagmite' || pk === 'crystal' ? '^' : 'r';
      else if (c & COLL.BLOCK) ch = 'H';
      else if (t === T.PATH) ch = '=';
      else if (t === T.BRIDGE) ch = 'b';
      else if (t === T.COBBLE) ch = '+';
      else if (t === T.MOSS || t === T.STORMGRASS || t === T.CAVE || t === T.GLADE) ch = ',';
      else if (pk) ch = "'";
      if (c & COLL.PORTAL) ch = 'P';
      row.push(ch);
    }
    g.push(row);
  }
  const put = (x: number, y: number, ch: string) => {
    if (x >= 0 && y >= 0 && x < w && y < h) g[y][x] = ch;
  };
  for (const s of def.structures ?? []) {
    const fp = STRUCTURE_FOOTPRINT[s.kind];
    for (let y = s.ty; y < s.ty + fp.h; y++) for (let x = s.tx; x < s.tx + fp.w; x++) put(x, y, 'H');
  }
  for (const n of def.nodes ?? []) put(n.tx, n.ty, 'n');
  for (const o of def.objects ?? []) put(o.tx, o.ty, 'O');
  for (const n of def.npcs ?? []) put(n.tx, n.ty, 'N');
  for (const s of def.spawns) put(s.cx, s.cy, 'S');
  for (const p of def.portals) {
    const [ax, ay] = arrivalTile(p);
    put(ax, ay, 'A');
  }
  const r1 = '    ' + Array.from({ length: w }, (_, i) => (i % 10 === 0 ? String((i / 10) % 10) : ' ')).join('');
  const r2 = '    ' + Array.from({ length: w }, (_, i) => String(i % 10)).join('');
  return [r1, r2, ...g.map((r, y) => String(y).padStart(3) + ' ' + r.join(''))];
}

function analyse(def: MapDef, cm: CompiledMap): string[] {
  const out: string[] = [];
  const { w, h } = cm;
  const blocked = (x: number, y: number) => x < 0 || y < 0 || x >= w || y >= h || (cm.coll[y * w + x] & COLL.BLOCK) !== 0;
  const comp = new Int32Array(w * h).fill(-1);
  const sizes: number[] = [];
  for (let i = 0; i < w * h; i++) {
    if (comp[i] >= 0 || cm.coll[i] & COLL.BLOCK) continue;
    const id = sizes.length;
    let size = 0;
    const st = [i];
    comp[i] = id;
    while (st.length) {
      const c = st.pop()!;
      size++;
      const x = c % w;
      const y = (c - x) / w;
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const nx = x + dx;
        const ny = y + dy;
        if (blocked(nx, ny)) continue;
        const ni = ny * w + nx;
        if (comp[ni] < 0) {
          comp[ni] = id;
          st.push(ni);
        }
      }
    }
    sizes.push(size);
  }
  const main = sizes.indexOf(Math.max(...sizes));
  const pockets = sizes.map((s, i) => [i, s] as const).filter(([i]) => i !== main);
  if (pockets.length) {
    out.push(
      `POCKETS: ${pockets
        .map(([i, s]) => {
          const t = comp.indexOf(i);
          return `${s}@(${t % w},${Math.floor(t / w)})`;
        })
        .join(' ')}`,
    );
  }
  const arrivals = def.portals.map((p) => ({ id: p.id, a: arrivalTile(p) }));
  let total = 0;
  for (const s of def.spawns) {
    total += s.count;
    let open = 0;
    for (let y = s.cy - s.r; y <= s.cy + s.r; y++)
      for (let x = s.cx - s.r; x <= s.cx + s.r; x++) if ((x - s.cx) ** 2 + (y - s.cy) ** 2 <= s.r * s.r && !blocked(x, y)) open++;
    const area = Math.round(Math.PI * s.r * s.r);
    const near = arrivals.map(({ id, a }) => ({ id, d: Math.hypot(a[0] - s.cx, a[1] - s.cy) })).filter((q) => q.d < 6);
    out.push(
      `spawn ${s.monster} x${s.count} r${s.r} @(${s.cx},${s.cy}) open=${open}/${area}${blocked(s.cx, s.cy) ? ' CENTRE-BLOCKED' : ''}${
        near.length ? ' NEAR-ARRIVAL ' + near.map((q) => `${q.id}:${q.d.toFixed(1)}`).join(',') : ''
      }`,
    );
  }
  out.push(`monsters total ${total}, spawn entries ${def.spawns.length}, props ${cm.props.length}`);
  const ents = [
    ...(def.nodes ?? []).map((n) => ({ l: `node ${n.id}`, tx: n.tx, ty: n.ty, kind: n.kind as string })),
    ...(def.objects ?? []).map((n) => ({ l: `obj ${n.id}`, tx: n.tx, ty: n.ty, kind: n.kind as string })),
    ...(def.npcs ?? []).map((n) => ({ l: `npc ${n.npc}`, tx: n.tx, ty: n.ty, kind: 'npc' })),
  ];
  const pos = new Map<string, string>();
  for (const e of ents) {
    let free = 0;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ])
      if (!blocked(e.tx + dx, e.ty + dy)) free++;
    const gt = cm.ground[e.ty * w + e.tx];
    const bad = WALLS.has(gt) || gt === T.VOID || gt === T.LAVA || gt === T.DEEP || gt === T.WATER;
    if (free < 2 || bad) out.push(`ENTITY ${e.l} @(${e.tx},${e.ty}) free=${free}${bad ? ' ON-BLOCKING-GROUND' : ''}`);
    const k = `${e.tx},${e.ty}`;
    if (pos.has(k)) out.push(`OVERLAP ${e.l} with ${pos.get(k)}`);
    pos.set(k, e.l);
    for (const a of arrivals) if (Math.hypot(a.a[0] - e.tx, a.a[1] - e.ty) < 1.5) out.push(`ENTITY ${e.l} hugs arrival ${a.id}`);
  }
  return out;
}

describe('tmp barrow/gloom/storm maps', () => {
  it.each(maps.map((m) => [m.id, m] as const))('%s', (_id, map) => {
    const errs = validateMap(map);
    const cm = compileMap(map);
    const ov = overlay(cm);
    const ascii = renderAscii(cm).split('\n');
    const side = ov.map((l, i) => (i >= 2 ? `${l}   ${ascii[i - 2] ?? ''}` : l));
    console.log(`\n===== ${map.id} (${cm.w}x${cm.h}) =====\n${side.join('\n')}\n${analyse(map, cm).join('\n')}\nERRORS: ${JSON.stringify(errs, null, 1)}`);
    expect(errs).toEqual([]);
  });
});
