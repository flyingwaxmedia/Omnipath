// Star Chart: the static sky plan, the pure layout and the camera maths (starchart lane; docs/CLIENT-v3.md §3).
import { describe, expect, it } from 'vitest';
import { SkillBook } from '../src/core/skillbook';
import { createRegistry } from '../src/data';
import { WEAPONS } from '../src/data/weapons';
import {
  ZOOM_MAX,
  ZOOM_MIN,
  centreOn,
  clampCam,
  fitBox,
  lerpCam,
  pickStar,
  toScreen,
  toSky,
  visibleBox,
  zoomAt,
} from '../src/ui/starchart/camera';
import { buildStarChartData, skyPlan } from '../src/ui/starchart/data';
import { CENTRES, FUSED_R, HEART_CLEAR, HEART_R, MIN_GAP, T2_SPREAD, TREE_CLEAR, TREE_R, boxOf, hash, heartRing, layoutSky, layoutStarChart } from '../src/ui/starchart/layout';

const reg = createRegistry();
const plan = skyPlan(reg);
const sky = layoutSky(plan);

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
const angleOf = (c: { x: number; y: number }, p: { x: number; y: number }) => Math.atan2(p.y - c.y, p.x - c.x);
const angDiff = (a: number, b: number) => {
  const d = Math.abs(a - b) % (Math.PI * 2);
  return d > Math.PI ? Math.PI * 2 - d : d;
};
const DEG = Math.PI / 180;

/** A book that knows every authored skill and element. */
function fullBook(): SkillBook {
  const b = new SkillBook(reg);
  for (const el of reg.elements.values()) b.learnElement(el.id, 'debug');
  for (const s of reg.authoredSkills()) if (!s.tags.includes('monster')) b.learn(s.id, 'debug');
  return b;
}

describe('sky plan', () => {
  it('is cached per registry and holds every authored player skill and element once', () => {
    expect(skyPlan(reg)).toBe(plan);
    const ids = plan.stars.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    const want = reg.authoredSkills().filter((s) => !s.tags.includes('monster')).length + reg.elements.size;
    expect(ids.length).toBe(want);
  });

  it('builds three 13-star weapon trees with the basic attack at the root', () => {
    for (const [w, c] of [['sword', 'edge'], ['dagger', 'fang'], ['staff', 'lantern']] as const) {
      const tree = plan.stars.filter((s) => s.constellation === c);
      expect(tree.length).toBe(13);
      expect(tree.filter((s) => s.depth === 0).map((s) => s.id)).toEqual([WEAPONS[w].basic]);
      expect(tree.filter((s) => s.depth === 1).length).toBe(3);
      expect(tree.filter((s) => s.depth === 2).length).toBe(6);
      expect(tree.filter((s) => s.depth === 3).length).toBe(3);
    }
  });

  it('sorts the other skills into The Crown, The Wild, The Craft, universal and fusion', () => {
    const of = (id: string) => plan.byId.get(id)?.constellation;
    expect(of('searing_edge')).toBe('crown');
    expect(of('jelly_slam')).toBe('wild');
    expect(of('rising_kick')).toBe('craft');
    expect(of('soaring_heel')).toBe('craft'); // follows its parent's spoke
    expect(plan.byId.get('soaring_heel')?.group).toBe(plan.byId.get('rising_kick')?.group);
    expect(of('quickstep')).toBe('universal');
    expect(of('crown_slam')).toBe('wild'); // nobody teaches it: it sits by Jelly Slam, which it transforms from
    expect(of('flame_spin')).toBe('fusion');
    expect(plan.byId.get('flame_spin')?.ingredients).toEqual(['el:fire', 'whirlwind']);
    expect(plan.byId.get('el:ice')?.parents).toEqual(['el:water', 'el:wind']);
    const wildGroups = plan.groups.filter((g) => g.constellation === 'wild').map((g) => g.name);
    expect(wildGroups).toContain('Hearth Vale');
  });
});

describe('layout', () => {
  it('is deterministic and places every star of the sky', () => {
    const again = layoutSky({ ...plan });
    for (const s of plan.stars) {
      const a = sky.stars.get(s.id);
      expect(a, s.id).toBeDefined();
      expect(again.stars.get(s.id)).toEqual(a);
    }
    expect(layoutSky(plan)).toBe(sky);
  });

  it('keeps every two stars at least MIN_GAP apart', () => {
    const list = [...sky.stars.values()];
    let worst = Infinity;
    let pair = '';
    for (let i = 0; i < list.length; i++)
      for (let j = i + 1; j < list.length; j++) {
        const d = dist(list[i], list[j]);
        if (d < worst) {
          worst = d;
          pair = `${list[i].id} / ${list[j].id}`;
        }
      }
    expect(worst, pair).toBeGreaterThanOrEqual(MIN_GAP - 0.5);
  });

  it('lays the weapon trees out at r 120 / 240 / 360 with T2 stars at ±18° of their branch', () => {
    for (const c of ['edge', 'fang', 'lantern'] as const) {
      const centre = CENTRES[c];
      for (const s of plan.stars.filter((x) => x.constellation === c)) {
        const p = sky.stars.get(s.id)!;
        expect(dist(p, centre)).toBeCloseTo(TREE_R[s.depth!], 0);
        if (s.depth === 2) {
          const t1 = sky.stars.get(s.parent!)!;
          const off = angDiff(angleOf(centre, p), angleOf(centre, t1));
          expect(off / DEG).toBeCloseTo(T2_SPREAD, 0);
        }
        if (s.depth === 3) {
          const t2 = sky.stars.get(s.parent!)!;
          expect(angDiff(angleOf(centre, p), angleOf(centre, t2))).toBeLessThan(0.01);
        }
      }
    }
  });

  it('puts the primal elements in a ring and each fused element between its parents', () => {
    const primal = plan.stars.filter((s) => s.kind === 'element' && !s.parents);
    for (const s of primal) expect(dist(sky.stars.get(s.id)!, { x: 0, y: 0 })).toBeCloseTo(HEART_R, 0);
    for (const s of plan.stars.filter((x) => x.parents)) {
      const p = sky.stars.get(s.id)!;
      expect(dist(p, { x: 0, y: 0 })).toBeCloseTo(FUSED_R, 0);
      const [a, b] = s.parents!.map((id) => angleOf({ x: 0, y: 0 }, sky.stars.get(id)!));
      const me = angleOf({ x: 0, y: 0 }, p);
      // Between the parents: the angle to each parent is at most the angle between the parents.
      expect(angDiff(me, a) + angDiff(me, b)).toBeCloseTo(angDiff(a, b), 3);
    }
  });

  it('orders the Heart so fused pairs sit side by side', () => {
    // a–c become neighbours (the ring wraps round); data order is kept otherwise.
    expect(heartRing(['a', 'b', 'c', 'd'], [['a', 'c']])).toEqual(['a', 'b', 'd', 'c']);
    expect(heartRing(['a', 'b', 'c', 'd'], [['a', 'b']])).toEqual(['a', 'b', 'c', 'd']);
    const ring = heartRing(
      plan.stars.filter((s) => s.kind === 'element' && !s.parents).map((s) => s.id),
      plan.stars.filter((s) => s.parents).map((s) => s.parents!),
    );
    for (const s of plan.stars.filter((x) => x.parents)) {
      const [i, j] = s.parents!.map((id) => ring.indexOf(id));
      expect([1, ring.length - 1]).toContain(Math.abs(i - j));
    }
  });

  it('places fusion results between their ingredients, outside the Heart', () => {
    for (const s of plan.stars.filter((x) => x.constellation === 'fusion')) {
      const p = sky.stars.get(s.id)!;
      expect(dist(p, { x: 0, y: 0 })).toBeGreaterThanOrEqual(HEART_CLEAR - 0.5);
      for (const c of ['edge', 'fang', 'lantern'] as const) expect(dist(p, CENTRES[c]), s.id).toBeGreaterThanOrEqual(TREE_CLEAR - 0.5);
      const [a, b] = s.ingredients!.map((id) => sky.stars.get(id)!);
      const span = dist(a, b);
      // Closer to the segment's middle than to either far end: "between" with the overlap nudge allowed.
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      expect(dist(p, mid), s.id).toBeLessThan(span / 2 + 260);
      expect(Math.min(dist(p, a), dist(p, b)), s.id).toBeLessThan(span + 120);
    }
  });

  it('keeps a star in place whatever the player knows', () => {
    const fresh = layoutStarChart(buildStarChartData(reg, new SkillBook(reg)));
    const full = layoutStarChart(buildStarChartData(reg, fullBook()));
    for (const [id, p] of fresh.stars) expect(full.stars.get(id)).toEqual(p);
  });

  it('orbits variants around their base as tiny satellites', () => {
    const data = buildStarChartData(reg, fullBook());
    const base = data.stars.find((s) => s.id === 'whirlwind')!;
    const v1 = { ...base, id: 'whirlwind@a', kind: 'variant' as const, base: 'whirlwind', size: 0 as const };
    const v2 = { ...v1, id: 'whirlwind@b' };
    const lay = layoutStarChart({ ...data, stars: [...data.stars, v2, v1] });
    const b = lay.stars.get('whirlwind')!;
    for (const id of ['whirlwind@a', 'whirlwind@b']) {
      const p = lay.stars.get(id)!;
      expect(dist(p, b)).toBeGreaterThan(b.r);
      expect(dist(p, b)).toBeLessThan(b.r + 40);
      expect(p.r).toBeLessThan(5);
    }
    expect(dist(lay.stars.get('whirlwind@a')!, lay.stars.get('whirlwind@b')!)).toBeGreaterThan(8);
    expect(lay.stars.get('whirlwind@a')).toEqual(layoutStarChart({ ...data, stars: [...data.stars, v1, v2] }).stars.get('whirlwind@a'));
    // The static sky is untouched.
    expect(sky.stars.has('whirlwind@a')).toBe(false);
  });

  it('labels the seven constellations and frames everything in its bounds', () => {
    const names = sky.labels.filter((l) => l.kind === 'constellation').map((l) => l.text);
    for (const n of ['The Edge', 'The Fang', 'The Lantern', 'The Heart', 'The Craft', 'The Wild', 'The Crown']) expect(names).toContain(n);
    for (const p of sky.stars.values()) {
      expect(p.x).toBeGreaterThan(sky.bounds.minX);
      expect(p.x).toBeLessThan(sky.bounds.maxX);
      expect(p.y).toBeGreaterThan(sky.bounds.minY);
      expect(p.y).toBeLessThan(sky.bounds.maxY);
    }
    expect(boxOf([], { x: 5, y: 5 }, 100)).toEqual({ minX: -95, minY: -95, maxX: 105, maxY: 105 });
    expect(hash('abc')).toBe(hash('abc'));
  });
});

describe('camera', () => {
  const view = { w: 400, h: 800 };
  it('maps sky ↔ screen both ways', () => {
    const cam = { x: 100, y: -50, z: 1.5 };
    const s = toScreen(cam, view, 160, 10);
    const back = toSky(cam, view, s.x, s.y);
    expect(back.x).toBeCloseTo(160);
    expect(back.y).toBeCloseTo(10);
    expect(toScreen(cam, view, 100, -50)).toEqual({ x: 200, y: 400 });
  });

  it('zooms about a point and clamps zoom to 0.5–2.5', () => {
    const cam = { x: 0, y: 0, z: 1 };
    const before = toSky(cam, view, 50, 70);
    const z = zoomAt(cam, view, 1.7, 50, 70);
    const after = toSky(z, view, 50, 70);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
    expect(zoomAt(cam, view, 100, 0, 0).z).toBe(ZOOM_MAX);
    expect(zoomAt(cam, view, 0.01, 0, 0).z).toBe(ZOOM_MIN);
  });

  it('centres a point in the part of the canvas not under the card', () => {
    const insets = { top: 60, right: 0, bottom: 300, left: 0 };
    const cam = centreOn({ x: 10, y: 20 }, 1, view, insets);
    const s = toScreen(cam, view, 10, 20);
    expect(s.x).toBeCloseTo(200);
    expect(s.y).toBeCloseTo((60 + 800 - 300) / 2);
  });

  it('fits a constellation box into the visible area', () => {
    const box = { minX: -400, minY: -400, maxX: 400, maxY: 400 };
    const cam = fitBox(box, { w: 1180, h: 820 }, { top: 60, right: 0, bottom: 0, left: 0 }, 20);
    const a = toScreen(cam, { w: 1180, h: 820 }, -400, -400);
    const b = toScreen(cam, { w: 1180, h: 820 }, 400, 400);
    expect(a.y).toBeGreaterThanOrEqual(60 + 19);
    expect(b.y).toBeLessThanOrEqual(820 - 19);
    expect(fitBox(box, { w: 390, h: 600 }).z).toBe(ZOOM_MIN);
  });

  it('clamps the camera to the sky and culls with the visible box', () => {
    expect(clampCam({ x: 1e6, y: -1e6, z: 9 }, sky.bounds)).toEqual({ x: sky.bounds.maxX, y: sky.bounds.minY, z: ZOOM_MAX });
    const vb = visibleBox({ x: 0, y: 0, z: 1 }, view, 0);
    expect(vb).toEqual({ minX: -200, minY: -400, maxX: 200, maxY: 400 });
  });

  it('picks the nearest star within a 44 px touch target', () => {
    const cam = { x: 0, y: 0, z: 1 };
    const stars = [
      { id: 'a', x: 0, y: 0, r: 6 },
      { id: 'b', x: 30, y: 0, r: 6 },
    ];
    expect(pickStar(stars, cam, view, 200 + 4, 400)).toBe('a');
    expect(pickStar(stars, cam, view, 200 + 26, 400)).toBe('b');
    expect(pickStar(stars, cam, view, 200, 400 + 40)).toBeNull();
  });

  it('flies smoothly between cameras', () => {
    const a = { x: 0, y: 0, z: 0.5 };
    const b = { x: 100, y: 100, z: 2 };
    expect(lerpCam(a, b, 0)).toEqual(a);
    expect(lerpCam(a, b, 1).z).toBeCloseTo(2);
    expect(lerpCam(a, b, 0.5).z).toBeCloseTo(1);
  });
});
