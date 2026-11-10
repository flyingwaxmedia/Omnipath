// In-game QA pass regressions (docs/VFX.md §8.10): blade smears for spin bands, one-shot statuses that end on their
// own, and the sweep / smear stage tables the runtime's chunk rings share with the whole-ring bake.
import { describe, expect, it } from 'vitest';
import { createRegistry, GAME_DATA } from '../src/data';
import { EventBus, type GameEvents } from '../src/game/events';
import { VfxBridge, type BridgePlayer } from '../src/game/vfx/bridge';
import type { VfxGroup, VfxStage } from '../src/game/vfx/play';
import { TEMPLATES } from '../src/game/vfx/components';
import { deriveVfx, statusPieces } from '../src/game/vfx/recipe';
import { DEFAULT_BAKE, IDX, smearStage, smearWidth, type FamilyId, type RingParams, type VfxPiece } from '../src/game/vfx/types';

const reg = createRegistry();
const FAMILIES: FamilyId[] = ['fire', 'water', 'earth', 'wind', 'lightning', 'shadow', 'holy', 'ice', 'magma', 'storm', 'twilight', 'steel', 'arcane', 'stealth', 'toxin', 'spirit'];
const useOf = (p: VfxPiece) => (TEMPLATES[p.component] as { use: (q: unknown) => string }).use(p.params);

describe('vfx QA: one-shot statuses end on their own', () => {
  it('gives every looping piece of knockback / smite / pull a life (they are played without a status timer)', () => {
    const bad: string[] = [];
    for (const kind of ['knockback', 'smite', 'pull'] as const)
      for (const f of FAMILIES)
        for (const owner of ['player', 'monster'] as const)
          for (const p of statusPieces(kind, f, 'M', owner)) {
            if (p.component === 'motes') continue;
            if (useOf(p) !== 'once' && p.lifeMs === undefined) bad.push(`${kind}/${f}/${owner} ${p.component}`);
          }
    expect(bad).toEqual([]);
  });
});

describe('vfx QA: spin bands are blade smears', () => {
  it('blade spins sweep a white-hot smear with sparks; vortex spins collapse inward under a swirl', () => {
    // (one collapsing ring per pulse: three chunked rings read as loose dashes once they shrink)
    const whirl = deriveVfx(reg.skill('whirlwind')!, 'player');
    const cast = whirl.phases.cast ?? [];
    const band = cast.find((p) => p.component === 'ring' && p.params.anim === 'sweep');
    expect(band && band.component === 'ring' && band.params.smear).toBeGreaterThanOrEqual(6);
    expect(cast.some((p) => p.component === 'motes' && p.params.kind === 'spark')).toBe(true);
    // A pulling spin (v4 made tornado a launcher and firestorm a zone: any authored pull spin is a vortex).
    const pullSpin = GAME_DATA.skills.find((x) => x.shape.kind === 'spin' && x.status === 'pull' && !x.tags.includes('monster'))!;
    const torn = deriveVfx(pullSpin, 'player');
    expect(torn.carrier).toEqual({ kind: 'spin', style: 'vortex' });
    const tc = torn.phases.cast ?? [];
    expect(tc.filter((p) => p.component === 'ring' && p.params.anim === 'contract').length).toBe(1);
    expect(tc.filter((p) => p.component === 'ring' && p.params.anim === 'sweep' && p.params.smear).length).toBeGreaterThanOrEqual(1);
    // No gapped / dashed rings on a player spin: that is the monsters' rim language.
    for (const id of ['whirlwind', 'tornado', 'firestorm', 'flame_spin', pullSpin.id]) {
      const r = deriveVfx(reg.skill(id)!, 'player');
      for (const p of [...(r.phases.cast ?? []), ...(r.phases.area ?? []), ...(r.riders.zone?.tick ?? [])]) {
        if (p.component === 'ring') expect(['gapped', 'dashed'], `${id}`).not.toContain(p.params.style);
      }
    }
  });

  it('smear stages run head -> lit -> mid -> dim and then end; widths taper', () => {
    const T = 117 / 33;
    const seq = [0, 0.3, 0.7, 0.9, 1.05, 2, 5].map((a) => smearStage(a, T));
    expect(seq[0]).toBe(0);
    expect(seq.at(-1)).toBe(-1);
    for (let i = 1; i < seq.length; i++) if (seq[i] !== -1) expect(seq[i]).toBeGreaterThanOrEqual(seq[i - 1]);
    for (const w of [4, 6, 8]) {
      const ws = ([0, 1, 2, 3] as const).map((s) => smearWidth(w, s));
      expect(ws[0]).toBe(w);
      for (let i = 1; i < 4; i++) expect(ws[i]).toBeLessThanOrEqual(ws[i - 1]);
    }
  });

  it('bakes a whole smear ring with a white-hot head, a tapering tail and an empty end', () => {
    const prm: RingParams = { r: 40, aspect: 1, thick: 3, style: 'solid', ink: 'hot', anim: 'sweep', heads: 2, ms: 117, smear: 6 };
    const frames = TEMPLATES.ring.frames(prm, 'steel', 0, DEFAULT_BAKE);
    const count = (f: (typeof frames)[number], i?: number) => f.body.reduce((a, v) => a + (i === undefined ? (v ? 1 : 0) : v === i ? 1 : 0), 0);
    expect(count(frames[0], IDX.R5)).toBeGreaterThan(0);
    // A smear covers part of the circle, never the whole band: well under a full 6 px ring.
    const fullRing = Math.PI * (40 * 40 - 34 * 34);
    for (const f of frames) expect(count(f)).toBeLessThan(fullRing * 0.75);
    expect(count(frames.at(-1)!)).toBe(0);
    // Chunk bakes per stage: the head chunk is as wide as the smear.
    const chunk = TEMPLATES.ring.frames({ r: 100, aspect: 1, thick: 4, style: 'solid', ink: 'hot', anim: 'static', ms: 200, smear: 6 }, 'steel', 0, DEFAULT_BAKE);
    const f0 = chunk[0];
    let minX = Infinity;
    let maxX = -Infinity;
    for (let y = 0; y < f0.h; y++)
      for (let x = 0; x < f0.w; x++)
        if (f0.body[y * f0.w + x]) {
          minX = Math.min(minX, x);
          maxX = Math.max(maxX, x);
        }
    expect(maxX - minX + 1).toBeGreaterThanOrEqual(6);
  });
});

describe('vfx QA: buff auras', () => {
  it('keeps at most two buff aura loops on the player (the oldest gives way; refreshes replace)', () => {
    const groups: (VfxGroup & { ended: boolean; aura: boolean })[] = [];
    let now = 0;
    const stage: VfxStage = {
      now: () => now,
      play(pieces) {
        const g = {
          ended: false,
          aura: pieces.some((p) => p.component === 'aura' && p.params.phase === 'loop'),
          end() {
            this.ended = true;
          },
          get done() {
            return this.ended;
          },
        };
        groups.push(g);
        return g;
      },
      warm: () => {},
      trauma: () => {},
      tick: () => {},
      reduceFlash: false,
      telegraph: () => ({ end() {}, done: true }),
    };
    const player: BridgePlayer = { x: 0, y: 0, sprite: { texture: { key: 'p' }, frame: { name: '0' }, flipX: false, originX: 0.5, originY: 0.95, scaleX: 1, scaleY: 1, visible: true } };
    const bus = new EventBus<GameEvents>();
    new VfxBridge(stage, { player: () => player, sceneNow: () => now, windupId: () => null }).attachBus(bus);
    const buffs = reg.authoredSkills().filter((k) => k.shape.kind === 'buff' && !k.tags.includes('monster')).slice(0, 4);
    expect(buffs.length).toBe(4);
    const live = () => groups.filter((g) => g.aura && !g.ended).length;
    buffs.forEach((b, i) => {
      now += 100;
      bus.emit('buffApplied', { skillId: b.id, skill: b, element: b.element, castId: i + 1, target: 'player', x: 0, y: 0, stat: 'atk', amount: 10, durationMs: 15000 });
      expect(live()).toBeLessThanOrEqual(2);
    });
    // A refresh of a live buff replaces its own loop.
    bus.emit('buffApplied', { skillId: buffs[3].id, skill: buffs[3], element: buffs[3].element, castId: 9, target: 'player', x: 0, y: 0, stat: 'atk', amount: 10, durationMs: 15000 });
    expect(live()).toBeLessThanOrEqual(2);
  });
});
