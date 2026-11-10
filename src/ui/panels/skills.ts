// Skills views of the Star Chart (starchart lane; docs/UX-SIMPLE.md): the List tab (a plain icon grid: Class skills /
// Your skills / Other skills), the Passives tab (Mastery bonuses, lessons, the class Gift, Keepsakes — stars and one line each)
// and the Essences tab (what you hold, where it sits, where it drops). panels/starchart.ts hosts them; tapping a
// skill opens the simple card (../starchart/card.ts). Also the small shared widgets other panels import (sheet, pips,
// rune, elChip, socketsHtml, weaponPath, pathOf) — their signatures stay as they are.
import { elementSlotState } from '../../core/compose';
import { SECOND_SLOT_OVERBARS } from '../../core/fusion';
import type { ActivePassive } from '../../core/passives';
import type { Registry } from '../../core/registry';
import { WEAPON_TYPES, type EssenceDef, type PassiveDef, type SkillDef, type WeaponType } from '../../core/types';
import { WEAPONS } from '../../data/weapons';
import { lockOf } from '../classinfo';
import { SPARK_RUNE } from '../hud';
import { weaponGlyph } from '../hud/html';
import { esc, hex } from '../util';
import { FRIENDLY, stars } from '../words';
import type { PanelHost } from './common';

// ==================================================================== shared widgets (also used by other panels)

/** sheet(host, ) that plays the slide-in only when the panel opens, not on every re-render (taps, tabs). */
export function sheet(host: PanelHost, title: string, body: string, cls = ''): HTMLElement {
  const again = !!host.modal.querySelector('.sheet');
  return host.sheet(title, body, `${cls}${again ? ' stay' : ''}`);
}

/** ●●○ pips. */
export function pips(n: number, max: number, cls = ''): string {
  let out = '';
  for (let i = 0; i < max; i++) out += `<i class="${i < n ? 'on' : ''}"></i>`;
  return `<span class="pips ${cls}" aria-label="${n} of ${max}">${out}</span>`;
}

/** The spark rune inline (coloured by `color`). */
export function rune(cls = ''): string {
  return `<span class="rune-i ${cls}">${SPARK_RUNE}</span>`;
}

/** Element chip. */
export function elChip(reg: Registry, id: string | undefined): string {
  const el = id ? reg.element(id as never) : undefined;
  return el ? `<span class="chip el" style="--c:${hex(el.color)}">${el.icon} ${esc(el.name)}</span>` : '';
}

/**
 * The element slot and Rune sockets of a known skill, in plain words: the element (free / changeable / fixed) and one
 * Rune socket per essence slot the skill can ever have (the 2nd opens after a few Mastery bars).
 */
export function socketsHtml(host: PanelHost, s: SkillDef): string {
  const { book, reg } = host.ctrl;
  const p = book.progress(s.id);
  const slot = elementSlotState(reg, s);
  const el = s.element ? reg.element(s.element) : undefined;
  const elSock =
    slot === 'free'
      ? `<div class="sock el free"><span class="g">◇</span><small>Element</small><b>Empty</b></div>`
      : slot === 'swap'
        ? `<div class="sock el on" style="--c:${hex(el!.color)}"><span class="g">${el!.icon}</span><small>Element · can change</small><b>${esc(el!.name)}</b></div>`
        : `<div class="sock el bound" ${el ? `style="--c:${hex(el.color)}"` : ''}><span class="g">${el ? el.icon : '—'}</span><small>Element</small><b>${el ? esc(el.name) : 'None'}</b></div>`;
  if (s.shape.kind === 'buff') return `<div class="socks">${elSock}</div>`;
  const slots = book.essenceSlots(s.id);
  const applied = (s.essences ?? []).map((e) => reg.essence(e)).filter((e): e is EssenceDef => !!e);
  const socks: string[] = [];
  for (let i = 0; i < 2; i++) {
    const e = applied[i];
    const label = FRIENDLY.essenceSlot;
    if (e) socks.push(`<div class="sock ess on"><span class="g">${e.icon}</span><small>${label}</small><b>${esc(e.name)}</b></div>`);
    else if (i < slots) socks.push(`<div class="sock ess free"><span class="g">◇</span><small>${label}</small><b>Empty</b></div>`);
    else {
      const bars = Math.min(p?.overBars ?? 0, SECOND_SLOT_OVERBARS);
      socks.push(`<div class="sock ess locked"><span class="g">🔒</span><small>${label}</small><b>${FRIENDLY.overmastery} ${bars}/${SECOND_SLOT_OVERBARS}</b></div>`);
    }
  }
  return `<div class="socks">${elSock}${socks.join('')}</div>`;
}

// ==================================================================== weapon paths (13-star morph trees)

export interface PathNode {
  id: string;
  parent: string | null;
  tier: number;
  /** Centre position in the path box, percent. */
  x: number;
  y: number;
}

const ROWS = [8, 33, 58, 83];
const pathCache = new Map<WeaponType, PathNode[]>();

/** The weapon's morph tree laid out: root, T1 per branch, two T2 per branch, the T3 under its parent. */
export function weaponPath(reg: Registry, w: WeaponType): PathNode[] {
  const hit = pathCache.get(w);
  if (hit) return hit;
  const tierOf = (to: string, t?: number) => t ?? reg.skill(to)?.tier ?? 0;
  const root = WEAPONS[w].basic;
  const nodes: PathNode[] = [{ id: root, parent: null, tier: 0, x: 50, y: ROWS[0] }];
  const t1 = reg.morphsFrom(root).filter((m) => tierOf(m.to, m.tier) === 1);
  const n = Math.max(1, t1.length);
  t1.forEach((m1, b) => {
    const bx = (100 * (2 * b + 1)) / (2 * n);
    nodes.push({ id: m1.to, parent: root, tier: 1, x: bx, y: ROWS[1] });
    const t2 = reg.morphsFrom(m1.to).filter((m) => tierOf(m.to, m.tier) === 2);
    t2.forEach((m2, k) => {
      const x2 = bx + (k - (t2.length - 1) / 2) * (100 / (2 * n));
      nodes.push({ id: m2.to, parent: m1.to, tier: 2, x: x2, y: ROWS[2] });
      for (const m3 of reg.morphsFrom(m2.to).filter((m) => tierOf(m.to, m.tier) === 3)) {
        nodes.push({ id: m3.to, parent: m2.to, tier: 3, x: x2, y: ROWS[3] });
      }
    });
  });
  pathCache.set(w, nodes);
  return nodes;
}

/** The weapon path a skill id (or its root) belongs to. */
export function pathOf(reg: Registry, id: string): WeaponType | undefined {
  return WEAPON_TYPES.find((w) => weaponPath(reg, w).some((n) => n.id === id));
}

// ==================================================================== List tab

const icon = (host: PanelHost, kind: 'skill' | 'passive' | 'mod', id: string): string => {
  try {
    return host.ctrl.iconUrl(kind, id);
  } catch {
    return '';
  }
};

/**
 * A tile's rank: at most 5 stars, big enough to read on an iPad (12 px), filling in half steps — rank 3 of 10 is
 * one and a half stars (docs/UX-SIMPLE.md rule 3: progress you can see at a glance).
 */
export function rankStars(rank: number, max: number): string {
  if (max <= 0) return '';
  const n = Math.min(5, max);
  const halves = Math.max(0, Math.min(2 * n, Math.round((rank / max) * 2 * n)));
  return Array.from({ length: n }, (_, i) => {
    const h = halves - 2 * i;
    return `<i class="${h >= 2 ? 'f' : h === 1 ? 'h' : 'e'}">★</i>`;
  }).join('');
}

function tile(host: PanelHost, s: SkillDef, opts: { sel: boolean; note?: string; equipped?: boolean }): string {
  const { book } = host.ctrl;
  const p = book.progress(s.id);
  const rank = p?.rank ?? 0;
  const ready = book.canMorph(s.id);
  // Gold "New": learned, never used, not on the bar yet.
  const fresh = !!p && p.uses === 0 && !opts.equipped;
  const src = icon(host, 'skill', s.id);
  // "Needs a sword": the tile dims and wears the weapon (its card has the line and the Equip action).
  const lock = lockOf(host.ctrl, s.id);
  return `<button class="skill-card sc-tile ${ready ? 'ready' : ''} ${opts.sel ? 'sel' : ''} ${rank >= s.maxRank ? 'mastered' : ''} ${lock ? 'wlocked' : ''}" data-skill="${esc(s.id)}" aria-label="${esc(s.name)}${lock ? `: ${esc(lock.line)}` : ''}">
    <span class="sc-tico">${src ? `<img class="px" src="${src}" width="64" height="64" alt="" draggable="false">` : `<b>${s.icon}</b>`}${ready ? '<i class="sc-spark" aria-hidden="true">✨</i>' : fresh ? '<i class="sc-new" aria-hidden="true">New</i>' : ''}${lock ? `<i class="sc-wl" aria-hidden="true">${weaponGlyph(lock.need)}</i>` : ''}</span>
    <span class="sc-tname">${esc(s.name)}</span>
    <span class="sc-tstars ${rank >= s.maxRank ? 'gold' : ''}" aria-hidden="true">${rankStars(rank, s.maxRank)}</span>
    ${opts.note ? `<span class="sc-tnote">${esc(opts.note)}</span>` : ''}
  </button>`;
}

/** The List tab: every known skill as an icon tile, grouped plainly. */
export function listTab(host: PanelHost, sel: string | null): string {
  const { ctrl } = host;
  const { book, reg } = ctrl;
  let slots: ReturnType<typeof ctrl.barSlots> = [];
  try {
    slots = ctrl.barSlots();
  } catch {
    slots = [];
  }
  const classIds = slots.filter((s) => s.kind === 'class' && s.skillId).map((s) => s.skillId!);
  const ownSlots = slots.filter((s) => s.kind === 'own' && s.skillId);
  const used = new Set([...classIds, ...ownSlots.map((s) => s.skillId!)]);
  const worn = book.state.worn ? reg.classDef(book.state.worn) : undefined;
  const other = book
    .known()
    .filter((s) => !used.has(s.id))
    .map((s) => ({ s, at: book.progress(s.id)?.learnedAt ?? 0 }))
    .sort((a, b) => b.at - a.at || (a.s.name < b.s.name ? -1 : 1))
    .map((x) => x.s);
  const group = (title: string, sub: string, tiles: string[]) =>
    tiles.length ? `<section class="sc-group"><h3>${title}${sub ? ` <small>${sub}</small>` : ''}</h3><div class="sc-grid">${tiles.join('')}</div></section>` : '';
  const html =
    group(
      'Class skills',
      worn ? esc(worn.name) : '',
      classIds.map((id) => reg.skill(id)).filter((s): s is SkillDef => !!s).map((s) => tile(host, s, { sel: sel === s.id, equipped: true })),
    ) +
    group(
      'Your skills',
      '',
      ownSlots.map((sl) => reg.skill(sl.skillId!)).filter((s): s is SkillDef => !!s).map((s) => tile(host, s, { sel: sel === s.id, equipped: true, note: `Slot ${slots.find((x) => x.skillId === s.id)!.index + 1}` })),
    ) +
    group(
      'Other skills',
      '',
      other.map((s) => tile(host, s, { sel: sel === s.id })),
    );
  return html || '<p class="sc-empty">No skills yet. Fight, explore and finish quests to learn some.</p>';
}

// ==================================================================== Passives tab

const TAG_WORD: Record<string, string> = {
  blade: 'Blade',
  pierce: 'Piercing',
  arcane: 'Arcane',
  spin: 'Spinning',
  projectile: 'Ranged',
  dash: 'Dash',
  aoe: 'Area',
  stealth: 'Stealth',
  heavy: 'Heavy',
  spirit: 'Spirit',
  echo: 'Echo',
  melee: 'Close-range',
  fire: 'Fire',
  water: 'Water',
  earth: 'Earth',
  wind: 'Wind',
  lightning: 'Lightning',
  shadow: 'Shadow',
  holy: 'Holy',
  twilight: 'Twilight',
  infused: 'Fused',
  execute: 'Finishing',
  buff: 'Boost',
  dot: 'Lingering',
};
const STAT_LINE: Record<string, string> = {
  hp: 'More health.',
  sp: 'More SP.',
  atk: 'Your attacks hit harder.',
  matk: 'Your spells hit harder.',
  crit: 'More critical hits.',
  speed: 'You move faster.',
  def: 'You take less damage.',
};

/** One plain line for a passive ("Blade skills hit harder."), never "+3% per rank". */
export function passiveLine(def: PassiveDef): string {
  const e = def.effect;
  const who = (tag?: string) => (tag ? `${TAG_WORD[tag] ?? tag.charAt(0).toUpperCase() + tag.slice(1)} skills` : 'All your skills');
  switch (e.kind) {
    case 'power':
      return `${who(e.tag)} hit harder.`;
    case 'spCost':
      return `${who(e.tag)} cost less SP.`;
    case 'cooldown':
      return `${who(e.tag)} come back sooner.`;
    case 'masteryXp':
      return `${who(e.tag)} rank up faster.`;
    case 'vsFamily':
      return `Stronger against ${e.family}s.`;
    case 'vsStatus':
      return `Stronger against ${e.status === 'burn' ? 'burning' : e.status} foes.`;
    case 'stat':
      return STAT_LINE[e.stat] ?? 'Makes you stronger.';
    case 'regenStill':
      return 'Recover faster while standing still.';
  }
  return 'Always on.';
}

function passiveRow(host: PanelHost, p: ActivePassive): string {
  const src = icon(host, 'passive', p.def.id);
  return `<div class="sc-prow"><span class="sc-pico">${src ? `<img class="px" src="${src}" width="32" height="32" alt="" draggable="false">` : `<b>${p.def.icon}</b>`}</span>
    <span class="sc-ptext"><b>${esc(p.def.name)}</b><span class="sc-tstars gold" aria-label="Rank ${p.rank} of ${p.def.maxRank}">${stars(p.rank, p.def.maxRank)}</span><small>${esc(passiveLine(p.def))}</small></span></div>`;
}

/** The Passives tab: always-on bonuses, each with stars and one line. */
export function passivesTab(host: PanelHost): string {
  const { book, reg } = host.ctrl;
  const active = book.passives();
  const part = (title: string, list: ActivePassive[], empty: string) =>
    `<section class="sc-group"><h3>${title}</h3>${list.length ? list.map((p) => passiveRow(host, p)).join('') : `<p class="sc-none">${empty}</p>`}</section>`;
  const worn = book.state.worn ? reg.classDef(book.state.worn) : undefined;
  const of = (src: ActivePassive['source']) => active.filter((p) => p.source === src);
  return `<p class="sc-lead">Passives are always on. They grow as you use your skills.</p>
    ${part(`${FRIENDLY.tagPassive}es`, of('tag'), 'Keep using your skills: the more you master a kind, the stronger it gets.')}
    ${of('learned').length ? part('Learned', of('learned'), '') : ''}
    ${of('class').length ? part(`${FRIENDLY.gift}${worn ? ` <small>${esc(worn.name)}</small>` : ''}`, of('class'), 'Your class has no Gift yet.') : ''}
    ${of('imprint').length ? part(`${FRIENDLY.imprint}s`, of('imprint'), '') : ''}`;
}

// ==================================================================== Essences tab

/** The Essences tab: essences you hold (and the ones you have seen drop), where they sit, where they come from. */
export function essencesTab(host: PanelHost): string {
  const { book, reg } = host.ctrl;
  const known = book.known();
  const held = (id: string) => book.state.essences[id] ?? 0;
  const rows = [...reg.essences.values()]
    .map((e) => {
      const n = held(e.id);
      const on = known.filter((s) => s.essences?.includes(e.id));
      const seen = [...reg.monsters.values()].filter((m) => m.essence === e.id && (book.state.bestiary[m.id] ?? 0) > 0);
      if (!n && !on.length && !seen.length) return null;
      const src = icon(host, 'mod', e.id);
      const line = /^(.+?[.!?])(\s|$)/.exec(e.desc.trim())?.[1] ?? e.desc;
      return {
        n,
        html: `<div class="sc-prow ${n ? '' : 'dim'}"><span class="sc-pico">${src ? `<img class="px" src="${src}" width="32" height="32" alt="" draggable="false">` : `<b>${e.icon}</b>`}${n ? `<i class="sc-count-b">×${n}</i>` : ''}</span>
        <span class="sc-ptext"><b>${esc(e.name)}</b><small>${esc(line)}</small>
        ${on.length ? `<small class="on">In: ${on.map((s) => esc(s.name)).join(', ')}</small>` : ''}
        ${seen.length ? `<small class="from">Drops from: ${seen.map((m) => esc(m.name)).join(', ')}</small>` : ''}</span></div>`,
      };
    })
    .filter((r): r is { n: number; html: string } => !!r)
    .sort((a, b) => Number(b.n > 0) - Number(a.n > 0));
  return `<p class="sc-lead">Put an essence in a skill's ${FRIENDLY.essenceSlot} at a ${FRIENDLY.altar} to change how it works.</p>
    ${rows.length ? rows.map((r) => r.html).join('') : '<p class="sc-none">No essences yet. Monsters drop them now and then.</p>'}`;
}
