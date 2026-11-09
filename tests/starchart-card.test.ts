// Star Chart data states and the simple skill card (starchart lane; docs/CLIENT-v3.md §3, docs/UX-SIMPLE.md §3).
import { describe, expect, it } from 'vitest';
import { SkillBook } from '../src/core/skillbook';
import { createRegistry } from '../src/data';
import type { GameController, SkillCardView } from '../src/ui/controller';
import { type CardModel, cardHtml, cardModel } from '../src/ui/starchart/card';
import { buildStarChartData } from '../src/ui/starchart/data';
import { layoutStarChart } from '../src/ui/starchart/layout';

const reg = createRegistry();

const star = (b: SkillBook, id: string) => buildStarChartData(reg, b).stars.find((s) => s.id === id);

describe('chart data', () => {
  it('a fresh book: every element as "?", each weapon tree shows its root, nothing charted', () => {
    const d = buildStarChartData(reg, new SkillBook(reg));
    expect(d.charted).toBe(0);
    expect(d.total).toBe(d.sky.stars.length);
    const els = d.stars.filter((s) => s.kind === 'element');
    expect(els.length).toBe(reg.elements.size);
    for (const e of els) expect([e.state, e.name]).toEqual(['fog', '?']);
    const roots = d.stars.filter((s) => s.kind === 'skill');
    expect(roots.map((s) => s.id).sort()).toEqual(['bolt', 'slash', 'stab']);
    expect(roots.every((s) => s.state === 'revealed')).toBe(true);
    expect(d.links).toEqual([]);
  });

  it('a known star reveals its next transforms (one step of fog) with dotted lines', () => {
    const b = new SkillBook(reg);
    b.learn('slash', 'start');
    const d = buildStarChartData(reg, b);
    expect(d.charted).toBe(1);
    const next = reg.morphsFrom('slash').map((m) => m.to);
    for (const id of next) expect(['revealed', 'fog']).toContain(d.stars.find((s) => s.id === id)?.state);
    // Two steps away stays dark.
    const t2 = reg.morphsFrom(next[0]).map((m) => m.to);
    for (const id of t2) expect(d.stars.find((s) => s.id === id)).toBeUndefined();
    const lines = d.links.filter((l) => l.from === 'slash');
    expect(lines.length).toBe(next.length);
    expect(lines.every((l) => l.kind === 'morph' && !l.known)).toBe(true);
  });

  it('never leaks a name or element through a "?" star', () => {
    const b = new SkillBook(reg);
    b.learn('slash', 'start');
    b.state.hints.push(reg.recipeList.find((r) => r.result === 'skill:thunder_javelin')!.hint!);
    for (const s of buildStarChartData(reg, b).stars.filter((x) => x.state === 'fog' || x.state === 'whisper')) {
      expect(s.name).toBe('?');
      expect(s.element).toBeUndefined();
    }
  });

  it('shows Transform ready over mastered, and mastered (gold) at max rank', () => {
    const b = new SkillBook(reg);
    b.learn('slash', 'start');
    const p = b.state.skills.slash;
    p.rank = reg.skill('slash')!.maxRank;
    expect(star(b, 'slash')).toMatchObject({ state: 'mastered', mastered: true });
    p.charges = 1;
    if (b.canMorph('slash')) expect(star(b, 'slash')).toMatchObject({ state: 'morphReady', mastered: true });
  });

  it('draws a recipe line only once the recipe is discovered, and a faint "?" when it was whispered', () => {
    const b = new SkillBook(reg);
    b.learn('whirlwind', 'debug');
    b.learnElement('fire', 'debug');
    let d = buildStarChartData(reg, b);
    expect(d.links.some((l) => l.kind === 'recipe')).toBe(false);
    expect(d.stars.find((s) => s.id === 'flame_spin')).toBeUndefined();
    const r = reg.recipeList.find((x) => x.result === 'skill:flame_spin')!;
    b.state.hints.push(r.hint!);
    expect(star(b, 'flame_spin')).toMatchObject({ state: 'whisper', name: '?' });
    b.state.discoveries.push('el:fire+skill:whirlwind');
    b.learn('flame_spin', 'fusion:el:fire+skill:whirlwind');
    d = buildStarChartData(reg, b);
    const lines = d.links.filter((l) => l.kind === 'recipe' && l.to === 'flame_spin').map((l) => l.from).sort();
    expect(lines).toEqual(['el:fire', 'whirlwind']);
    expect(d.stars.find((s) => s.id === 'flame_spin')?.state).toBe('known');
  });

  it('reveals echoes once seen and signatures of whispered classes', () => {
    const b = new SkillBook(reg);
    b.state.witness.boulder_roll = 1;
    expect(star(b, 'boulder_roll')?.state).toBe('revealed');
    const cls = reg.classes.find((c) => (c.grants ?? []).length && !c.hidden)!;
    b.state.whispered.push(cls.id);
    expect(star(b, cls.grants![0])?.state).toBe('revealed');
  });

  it('orbits a known variant around its base', () => {
    const b = new SkillBook(reg);
    b.learn('whirlwind', 'debug');
    b.learn('whirlwind@fire', 'debug');
    const d = buildStarChartData(reg, b);
    const v = d.stars.find((s) => s.id === 'whirlwind@fire');
    expect(v).toMatchObject({ kind: 'variant', base: 'whirlwind', constellation: 'edge' });
    expect(layoutStarChart(d).stars.get('whirlwind@fire')).toBeDefined();
  });
});

// ---------------------------------------------------------------------- the card

const base: CardModel = {
  id: 'whirlwind',
  kind: 'skill',
  name: 'Whirlwind',
  icon: 'data:image/png;base64,AAAA',
  known: true,
  rank: 3,
  maxRank: 5,
  progress: 0.5,
  mastered: false,
  transformReady: false,
  line: 'Spin and slash everything around you.',
  cooldown: 3,
  sp: 8,
  primary: { kind: 'equip' },
  rest: [],
  details: [{ label: 'Power', value: '120%' }],
  forms: [],
};

describe('card html', () => {
  it('has the big icon, name, ★ rank, one line, cooldown / SP and ONE primary action', () => {
    const h = cardHtml(base, { back: true });
    expect(h).toContain('class="skill-head');
    expect(h).toContain('class="back sc-back"');
    expect(h).toContain('★★★☆☆');
    expect(h).toContain('Spin and slash everything around you.');
    expect(h).toContain('3 s');
    expect(h).toContain('8 SP');
    expect(h.match(/sc-primary/g)?.length).toBe(1);
    expect(h).toContain('data-act="equip"');
    // Details exist but are closed; no internals on the face of the card.
    expect(h).toMatch(/<details class="sc-details">/);
    expect(h).not.toMatch(/<details[^>]*open/);
    for (const word of ['Tier', 'tag', 'CR', 'morph', 'overmastery', 'Auto-cast']) expect(h).not.toContain(word);
  });

  it('says Equipped ✓ / Class skill ✓ instead of a button when on the bar', () => {
    const own = cardHtml({ ...base, primary: { kind: 'equipped', slot: 5 } });
    expect(own).toContain('Equipped ✓');
    expect(own).toContain('Slot 6');
    expect(own).not.toContain('data-act="equip"');
    const cls = cardHtml({ ...base, primary: { kind: 'class', className: 'Pyroblade' } });
    expect(cls).toContain('Class skill ✓');
    expect(cls).toContain('Your Pyroblade uses it.');
  });

  it('offers Transform when ready, else the one next step with a small "?" for the rest', () => {
    const t = cardHtml({ ...base, transformReady: true, primary: { kind: 'transform', to: 'tornado', toName: 'Tornado' } });
    expect(t).toContain('data-act="transform" data-to="tornado"');
    expect(t).toContain('into Tornado');
    expect(t).toContain('✨');
    const step = { ...base, known: false, primary: { kind: 'step' as const, text: 'Reach Slash rank 10, then transform it.' }, rest: ['Learn Whirlwind.'] };
    const closed = cardHtml(step);
    expect(closed).toContain('Reach Slash rank 10, then transform it.');
    expect(closed).toContain('data-act="more"');
    expect(closed).toContain('class="sc-rest hidden"');
    expect(cardHtml(step, { more: true })).toContain('class="sc-rest "');
    expect(cardHtml({ ...step, rest: [] })).not.toContain('data-act="more"');
    expect(closed).toContain('Not learned yet');
  });

  it('escapes names and draws a big "?" without an icon', () => {
    const h = cardHtml({ ...base, kind: 'fog', icon: '', known: false, name: '<b>x</b>', primary: { kind: 'step', text: 'Keep exploring.' } });
    expect(h).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(h).toContain('class="sc-q"');
    expect(h).not.toContain('<img');
  });
});

describe('card model', () => {
  const fake = (b: SkillBook, view?: Partial<SkillCardView>): GameController =>
    ({
      reg,
      book: b,
      iconUrl: () => 'data:x',
      unlocks: () => ({ fusion: true, essences: false, passives: false, classes: false, keepsakes: false, quests: false }),
      skillCard: (id: string): SkillCardView => ({
        id,
        kind: 'skill',
        name: reg.skill(id)?.name ?? '?',
        line: 'One line.',
        known: b.has(id),
        rank: b.rank(id),
        maxRank: reg.skill(id)?.maxRank ?? 0,
        progress: 0,
        cooldown: 2,
        sp: 5,
        transformReady: false,
        action: b.has(id) ? { kind: 'equip' } : { kind: 'step', text: 'Do the first thing.' },
        details: [],
        ...view,
      }),
    }) as unknown as GameController;

  it('masks fog and whisper stars (no name, no icon) and gives one step', () => {
    const b = new SkillBook(reg);
    b.learn('slash', 'start');
    const fog = buildStarChartData(reg, b).stars.find((s) => s.state === 'fog');
    if (fog) {
      const m = cardModel(fake(b), fog.id, fog);
      expect(m.kind).toBe('fog');
      expect(m.name).toBe('Unknown star');
      expect(m.icon).toBe('');
      expect(m.primary.kind).toBe('step');
    }
    const r = reg.recipeList.find((x) => x.result === 'skill:thunder_javelin')!;
    b.state.hints.push(r.hint!);
    const w = buildStarChartData(reg, b).stars.find((s) => s.id === 'thunder_javelin')!;
    const m = cardModel(fake(b), w.id, w);
    expect(m).toMatchObject({ kind: 'whisper', icon: '' });
    expect(m.line).toContain(r.hint!);
    expect(m.name).not.toContain('Thunder');
  });

  it('lists the other steps of a locked transform behind the "?"', () => {
    const b = new SkillBook(reg);
    b.learn('sword_throw', 'debug');
    const target = reg.morphsFrom('sword_throw').find((m) => (m.requires ?? []).some((r) => !b.meets(r)));
    if (!target) return;
    const m = cardModel(fake(b), target.to);
    expect(m.primary.kind).toBe('step');
    expect(m.rest.length).toBeGreaterThan(0);
    for (const s of m.rest) expect(s).toMatch(/[.!?)]$/);
  });

  it('maps the game card: class slot → Class skill ✓, and Details in plain words', () => {
    const b = new SkillBook(reg);
    b.learn('whirlwind', 'debug');
    const m = cardModel(fake(b, { action: { kind: 'equipped', slot: 1, byClass: 'Blademaster' } }), 'whirlwind');
    expect(m.primary).toEqual({ kind: 'class', className: 'Blademaster' });
    const labels = m.details.map((d) => d.label);
    expect(labels).toContain('Rank');
    expect(labels).toContain('Fuse');
    expect(labels.join(' ')).not.toMatch(/tier|tag|overmastery/i);
    expect(m.forms.length).toBe(reg.morphsFrom('whirlwind').length);
  });
});
