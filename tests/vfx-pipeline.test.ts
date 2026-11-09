// Joint P + R check (docs/VFX.md §10.4, §11.1 vfx-pipeline) and the art-rule lint: every distinct piece that the
// recipes emit (authored skills, monster techniques, element infusions, auto-attacks, statuses, impacts, combos,
// deaths and extras) bakes, and every baked pixel obeys the Lush Pixel rules (docs/ART-DIRECTION.md, docs/VFX.md §2):
// - palette membership: each colour is in the piece's own family ramp + LUT variant (R0-R5, accent, S0-S3, white)
// - hard pixels: alpha is 0 or 255, never pure black
// - outline rule: #24180f appears only where outlineAllowed() says (matter), unless the ramp itself owns that colour
// - glow twins are white, and ramps without glow bake none (missiles keep their imbue rim)
// - one-shots end empty, frame times are VSYNC_MS values
// - player and monster languages stay apart: no danger-ramp colour in any player piece
import { describe, expect, it } from 'vitest';
import { canTakeElement, MONSTER_TAG, variantId } from '../src/core/compose';
import type { SkillDef, StatusKind } from '../src/core/types';
import { createRegistry, GAME_DATA } from '../src/data';
import { MAPS } from '../src/data/world';
import { bakePiece, pieceKey } from '../src/game/vfx/bake';
import { DEFAULTS, gridPieces, piece as gridPiece } from '../src/game/vfx/grid';
import { outlineAllowed } from '../src/game/vfx/components';
import { recipePieces } from '../src/game/vfx/pieces';
import { NO_GLOW, RAMPS, hexToRgb, lutColours } from '../src/game/vfx/ramps';
import { comboPieces, deathPieces, deriveAttackVfx, deriveVfx, extraPieces, impactPieces, statusPieces } from '../src/game/vfx/recipe';
import { IDX, OUTLINE_HEX, VFX_BUDGET, VSYNC_MS, type BakedPiece, type HitOutcome, type VfxOwner, type VfxPiece, type VfxRecipe } from '../src/game/vfx/types';

const reg = createRegistry();
const AUTHORED = reg.authoredSkills();
const isMonsterOnly = (s: SkillDef): boolean => s.tags.includes(MONSTER_TAG);
const TECHNIQUES = [...new Set(GAME_DATA.monsters.flatMap((m) => (m.techniques ?? []).map((t) => t.skill)))].map((id) => reg.skill(id)!);
const ELEMENTS = GAME_DATA.elements.map((e) => e.id);
const HIT: HitOutcome = { index: 0, sincePrevMs: 1e9, crit: false, relation: 'neutral', killed: false, target: 'monster' };
const STATUS_KINDS: StatusKind[] = ['burn', 'slow', 'soak', 'stun', 'knockback', 'shock', 'bleed', 'smite', 'freeze', 'poison', 'pull'];

/** Every piece the game can ask for, with the owner whose language it belongs to. */
function collect(): Map<string, { piece: VfxPiece; owner: VfxOwner; from: string }> {
  const out = new Map<string, { piece: VfxPiece; owner: VfxOwner; from: string }>();
  const add = (ps: readonly VfxPiece[], owner: VfxOwner, from: string) => {
    for (const p of ps) {
      const k = `${pieceKey(p)}#${owner}`;
      if (!out.has(k)) out.set(k, { piece: p, owner, from });
    }
  };
  const recipe = (s: SkillDef, owner: VfxOwner) => {
    const r = deriveVfx(s, owner);
    add(recipePieces(r), owner, r.key);
    for (const h of [HIT, { ...HIT, crit: true }, { ...HIT, relation: 'strong' as const }, { ...HIT, relation: 'weak' as const }, { ...HIT, relation: 'immune' as const }, { ...HIT, relation: 'same' as const }, { ...HIT, index: 1, sincePrevMs: 50 }])
      add(impactPieces(r, h), owner, `${r.key} impact`);
    if (owner === 'monster') add(impactPieces(r, { ...HIT, target: 'player' }), owner, `${r.key} on player`);
  };
  for (const s of AUTHORED) if (!isMonsterOnly(s)) recipe(s, 'player');
  for (const s of new Set([...TECHNIQUES, ...AUTHORED.filter(isMonsterOnly)])) recipe(s, 'monster');
  // Element infusions of every root (palette swaps of every carrier).
  for (const root of AUTHORED.filter((s) => !isMonsterOnly(s) && canTakeElement(s)))
    for (const el of ELEMENTS) {
      const v = reg.skill(variantId(root.id, el));
      if (v) recipe(v, 'player');
    }
  for (const m of GAME_DATA.monsters) {
    const r = deriveAttackVfx({ id: m.id, family: m.family, element: m.element, rank: m.rank, size: m.size });
    add(recipePieces(r), 'monster', r.key);
  }
  for (const owner of ['player', 'monster'] as const) {
    for (const k of STATUS_KINDS)
      for (const src of [...ELEMENTS, 'steel', 'arcane', 'stealth', 'toxin', 'spirit'] as const)
        for (const body of ['S', 'M', 'L', 'W'] as const) add(statusPieces(k, src, body, owner), owner, `status ${k} ${src} ${body}`);
    // A death pop belongs to the killer's language: the player's kill of a monster, a monster's kill of the player.
    for (const body of ['S', 'M', 'L', 'W'] as const)
      for (const fam of [...ELEMENTS, 'steel'] as const) add(deathPieces(body, fam, owner), owner === 'player' ? 'monster' : 'player', `death ${body} ${fam}`);
  }
  for (const combo of ['shatter', 'conduct', 'fan'] as const) for (const body of ['S', 'M', 'L', 'W'] as const) add(comboPieces(combo, body), 'player', `combo ${combo}`);
  add(extraPieces('spark'), 'player', 'spark');
  add(extraPieces('levelUp'), 'player', 'levelUp');
  add(extraPieces('enrage'), 'monster', 'enrage');
  return out;
}

const hex = (c: readonly number[]) => `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
const OUTLINE = OUTLINE_HEX.toLowerCase();
const DANGER_HOT = new Set([RAMPS.danger.R[2], RAMPS.danger.R[3], RAMPS.danger.R[4]].map((h) => h.toLowerCase()));

/** Colours a piece may show: its ramp's LUT entries (index 7, the outline, only where outlines are allowed). */
function palette(p: VfxPiece): Set<string> {
  const cols = lutColours(p.ramp, p.lut);
  const out = new Set<string>();
  for (let i = 1; i < cols.length; i++) if (i !== IDX.OUTLINE || outlineAllowed(p)) out.add(hex(cols[i]));
  return out;
}

function lint(p: VfxPiece, owner: VfxOwner, b: BakedPiece): string[] {
  const bad: string[] = [];
  const pal = palette(p);
  const ownsOutline = pal.has(OUTLINE);
  const noGlow = NO_GLOW.has(p.ramp) && p.component !== 'missile';
  const strayCols = new Set<string>();
  let alpha = 0,
    black = 0,
    outline = 0,
    danger = 0,
    glowPx = 0,
    glowNotWhite = 0;
  b.frames.forEach((strip, u) => {
    strip.forEach((f, k) => {
      if (!VSYNC_MS.includes(f.ms)) bad.push(`u${u} f${k}: ${f.ms} ms is not a VSYNC_MS value`);
      for (let i = 0; i < f.w * f.h; i++) {
        const a = f.data[i * 4 + 3];
        if (a !== 0 && a !== 255) alpha++;
        if (!a) continue;
        const c = hex([f.data[i * 4], f.data[i * 4 + 1], f.data[i * 4 + 2]]);
        if (c === '#000000') black++;
        if (c === OUTLINE && !ownsOutline) outline++;
        else if (!pal.has(c)) strayCols.add(c);
        if (owner === 'player' && DANGER_HOT.has(c)) danger++;
      }
      const g = b.glow[u][k];
      for (let i = 0; i < g.w * g.h; i++) {
        if (!g.data[i * 4 + 3]) continue;
        glowPx++;
        if (g.data[i * 4] !== 255 || g.data[i * 4 + 1] !== 255 || g.data[i * 4 + 2] !== 255 || g.data[i * 4 + 3] !== 255) glowNotWhite++;
      }
    });
    if (b.use === 'once' && strip.length && strip[strip.length - 1].w !== 0) bad.push(`u${u}: one-shot does not end empty`);
  });
  if (alpha) bad.push(`${alpha} px with partial alpha`);
  if (black) bad.push(`${black} px pure black`);
  if (outline) bad.push(`${outline} px of #24180f outline on a non-matter piece`);
  if (strayCols.size) bad.push(`colours outside the ${p.ramp}/${p.lut} palette: ${[...strayCols].slice(0, 4).join(' ')}`);
  if (danger) bad.push(`${danger} px of danger-ramp colour in a player piece`);
  if (glowNotWhite) bad.push(`${glowNotWhite} glow px not opaque white`);
  if (noGlow && glowPx) bad.push(`${glowPx} glow px in a no-glow ramp (${p.ramp})`);
  return bad;
}

describe('vfx pipeline: every recipe piece bakes and obeys the art rules', () => {
  const pieces = collect();

  it('collects the pieces of every authored skill, technique, infusion, auto-attack, status, impact and extra', () => {
    expect(pieces.size).toBeGreaterThan(1000);
    const comps = new Set([...pieces.values()].map((e) => e.piece.component));
    for (const c of ['slash', 'thrust', 'orb', 'missile', 'bolt', 'burst', 'motes', 'puff', 'ring', 'decal', 'sigil', 'nova', 'erupt', 'status', 'aura', 'tell']) expect(comps, c).toContain(c);
  });

  it('bakes every piece with palette membership, hard alpha, the outline rule and glow discipline', () => {
    const problems: string[] = [];
    const baked = new Map<string, BakedPiece>();
    for (const { piece, owner, from } of pieces.values()) {
      const key = pieceKey(piece);
      let b = baked.get(key);
      if (!b) {
        try {
          b = bakePiece(piece);
        } catch (e) {
          problems.push(`${from} ${piece.component}: bake failed: ${(e as Error).message}`);
          continue;
        }
        baked.set(key, b);
      }
      if (b.use === 'runtime') continue;
      for (const why of lint(piece, owner, b)) problems.push(`${from} ${key}: ${why}`);
    }
    expect(problems.slice(0, 30)).toEqual([]);
    expect(baked.size).toBeGreaterThan(800);
  }, 240_000);

  it('keeps the outline colour out of every ramp except the ones that own it as crust or keyline', () => {
    const owners = Object.entries(RAMPS)
      .filter(([, r]) => [...r.R, r.accent, ...r.S].some((h) => h.toLowerCase() === OUTLINE))
      .map(([id]) => id)
      .sort();
    expect(owners).toEqual(['danger', 'magma']);
    expect(hexToRgb(OUTLINE_HEX)).toEqual([0x24, 0x18, 0x0f]);
  });
});

describe('vfx pipeline: atlas budget (docs/VFX.md §8.5, §9)', () => {
  // The warm set a map keeps resident behind the fade: the 8 equipped skills with every spark variant, the map's
  // techniques and auto-attacks, the statuses they apply and the boot set. Everything else (death pops, combos,
  // extras, reduce-flash / keyline variants) bakes lazily into the remaining space. Each stored frame pays the 2 px
  // gutter, glow twins are white and stored once per geometry (P3), bolts live in pooled transient textures.
  const OUTCOMES: HitOutcome[] = [HIT, { ...HIT, crit: true }, { ...HIT, relation: 'strong' }, { ...HIT, relation: 'weak' }, { ...HIT, relation: 'immune' }, { ...HIT, relation: 'same' }, { ...HIT, index: 1, sincePrevMs: 50 }];
  const BODIES = ['S', 'M', 'L', 'W'] as const;
  const cache = new Map<string, BakedPiece>();
  const baked = (p: VfxPiece): BakedPiece => {
    const k = pieceKey(p);
    let b = cache.get(k);
    if (!b) cache.set(k, (b = bakePiece(p)));
    return b;
  };
  const area = (strips: BakedPiece['frames']): number => {
    const seen = new Set<unknown>();
    let n = 0;
    for (const strip of strips)
      for (const f of strip) {
        if (!f.w || seen.has(f.data)) continue;
        seen.add(f.data);
        n += (f.w + VFX_BUDGET.gutterPx) * (f.h + VFX_BUDGET.gutterPx);
      }
    return n;
  };
  /** Stored atlas pixels of a set of pieces (distinct bake keys; glow twins once per geometry). */
  const footprint = (ps: readonly VfxPiece[]): number => {
    const keys = new Map<string, VfxPiece>();
    for (const p of ps) if (p.component !== 'bolt' && p.component !== 'afterimage') keys.set(pieceKey(p), p);
    const geo = new Set<string>();
    let n = 0;
    for (const p of keys.values()) {
      const b = baked(p);
      n += area(b.frames);
      if (!geo.has(b.geometryKey)) {
        geo.add(b.geometryKey);
        n += area(b.glow);
      }
    }
    return n;
  };
  const withSparks = (r: VfxRecipe): VfxPiece[] => [...recipePieces(r), ...OUTCOMES.flatMap((h) => impactPieces(r, r.owner === 'monster' ? { ...h, target: 'player' } : h))];

  it('fits the worst loadout + the densest map in VFX_BUDGET.maxPages', () => {
    const loadout = AUTHORED.filter((s) => !isMonsterOnly(s))
      .map((s) => deriveVfx(s))
      .map((r) => ({ r, n: footprint(withSparks(r)) }))
      .sort((a, b) => b.n - a.n)
      .slice(0, 8)
      .map((x) => x.r);
    const mapSet = (m: (typeof MAPS)[number]): VfxPiece[] => {
      const out: VfxPiece[] = [];
      for (const id of new Set((m.spawns ?? []).map((sp) => sp.monster))) {
        const d = GAME_DATA.monsters.find((x) => x.id === id);
        if (!d) continue;
        out.push(...recipePieces(deriveAttackVfx({ id: d.id, family: d.family, element: d.element, rank: d.rank, size: d.size })));
        for (const t of d.techniques ?? []) {
          const r = deriveVfx(reg.skill(t.skill)!, 'monster');
          out.push(...withSparks(r), ...r.statuses.flatMap((k) => statusPieces(k, r.family, 'M', 'monster')));
        }
      }
      return out;
    };
    const maps = MAPS.map((m) => ({ id: m.id, ps: mapSet(m) })).map((m) => ({ ...m, n: footprint(m.ps) }));
    const densest = maps.sort((a, b) => b.n - a.n)[0];
    const boot: VfxPiece[] = [
      ...gridPieces('motes', 'steel'),
      ...gridPieces('puff', 'steel').map((p) => ({ ...p, ramp: 'smoke' as const })),
      ...(['solid', 'dashed'] as const).flatMap((style) =>
        ([1, 2, 3] as const).flatMap((thick) => (['hot', 'lit', 'mid', 'dim'] as const).map((ink) => gridPiece('ring', { ...DEFAULTS.ring, r: 96, style, thick, ink }, 'danger'))),
      ),
      ...gridPieces('burst', 'steel').filter((p) => p.component === 'burst' && p.params.cls !== 'strong'),
      ...gridPieces('tell', 'danger'),
    ];
    const warm = [
      ...loadout.flatMap(withSparks),
      ...loadout.flatMap((r) => r.statuses.flatMap((k) => BODIES.flatMap((b) => statusPieces(k, r.imbue ?? r.family, b, 'player')))),
      ...densest.ps,
      ...boot,
    ];
    const lazy = [
      ...loadout.flatMap((r) => BODIES.flatMap((b) => deathPieces(b, r.family, 'monster'))),
      ...(['shatter', 'conduct', 'fan'] as const).flatMap((c) => BODIES.flatMap((b) => comboPieces(c, b))),
      ...extraPieces('spark'),
      ...extraPieces('levelUp'),
    ];
    // Bake time of the warm set (cold cache), one piece at a time as the map fade would. Logged, not asserted: wall
    // time under a parallel test run is noise; compare it with VFX_BUDGET.mapBakeMs by hand.
    const fresh = new Map<string, VfxPiece>();
    for (const p of warm) if (p.component !== 'bolt' && p.component !== 'afterimage') fresh.set(pieceKey(p), p);
    const t0 = performance.now();
    for (const p of fresh.values()) bakePiece(p);
    const bakeMs = performance.now() - t0;
    const page = VFX_BUDGET.atlasPage * VFX_BUDGET.atlasPage;
    // Shelf packing of trimmed frames wastes some of each page; 85 % is the planning efficiency.
    const capacity = VFX_BUDGET.maxPages * page * 0.85;
    const n = footprint(warm);
    const all = footprint([...warm, ...lazy]);
    console.log(
      `vfx atlas: warm set ${(n / page).toFixed(2)} pages, baked in ${bakeMs.toFixed(0)} ms (loadout ${loadout.map((r) => r.skillId).join(', ')}; map ${densest.id}); + deaths, combos and extras ${(all / page).toFixed(2)} pages; capacity ${(capacity / page).toFixed(2)}`,
    );
    expect(n).toBeLessThanOrEqual(capacity);
  }, 120_000);
});
