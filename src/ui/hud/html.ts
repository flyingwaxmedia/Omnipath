// HUD HTML builders (HUD lane; docs/CLIENT-v3.md §2, docs/UX-SIMPLE.md). Pure string functions — art comes in as URL
// callbacks — so tests/hud.test.ts can check them in node. Every player-facing word of the HUD lives here or in
// ../hud.ts / ../picker.ts, written per docs/UX-SIMPLE.md (plain words, one short line, no internals).
import type { BarSlotView, PursuitView, SlotPickerView, WornClassView, ZoneView } from '../controller';
import { esc } from '../util';
import { splitCount } from './layout';

/** The spark rune: an original four-pointed star split by a crack, inside a faint rune ring. Coloured by CSS. */
export const SPARK_RUNE = `<svg class="rune" viewBox="0 0 24 24" aria-hidden="true">
  <circle class="rg" cx="12" cy="12" r="10.6"/>
  <path class="st" d="M12 1.6 14.2 9.8 22.4 12 14.2 14.2 12 22.4 9.8 14.2 1.6 12 9.8 9.8Z"/>
  <path class="ck" d="M11.3 3.6 12.9 8.4 10.7 11.2 13.6 13 12.2 16.2 13.1 20.2"/>
  <path class="sh" d="M15.6 6.2 17.4 5.3 16.9 7.2Z M6.4 17.4 8.1 16.5 7.7 18.4Z"/>
</svg>`;

/** HUD words (docs/UX-SIMPLE.md): labels players read on the buttons and widgets. */
export const HUD_WORDS = {
  pursuits: 'Pursuits',
  heal: 'Heal',
  recall: 'Recall',
  rest: 'Rest',
  attack: 'Attack',
  auto: 'AUTO',
  on: 'ON',
  off: 'OFF',
  target: 'Target',
  potion: 'Potion',
  exp: 'EXP',
  empty: 'Empty',
  explored: 'Explored',
  warden: 'Warden',
  wardenDown: 'Warden beaten',
  noClass: 'No class',
} as const;

/** Art lookups the builders need (data URLs; '' when missing). */
export interface HudArt {
  skill(id: string): string;
  pip(element: string): string;
  cls(classId: string): string;
}

export interface SlotOpts {
  /** AUTO is on: every filled slot wears the AUTO ring. */
  auto: boolean;
  /** Class slots: frame colour ('#rrggbb') and the worn class's name. */
  classColor?: string;
  className?: string;
  /** The skill has a sudden-insight form to find (shows the spark rune when the window opens). */
  spark?: boolean;
}

const attr = (s: string): string => esc(s);

/**
 * Wraps every number in already-escaped HTML text in `<span class="num">` (HTML entities such as `&#39;` are left
 * alone): the HUD shows digits in the Tiny5 pixel font, whose 2 / 5 / 8 never look alike.
 */
export function digits(html: string): string {
  return html.replace(/(&#?\w+;)|(\d+(?:[.,:/–-]\d+)*%?)/g, (m, ent: string | undefined) => (ent ? m : `<span class="num">${m}</span>`));
}

/** One skill-bar slot. Class slots carry the class colour + emblem (a faint emblem when empty); own slots are plain. */
export function slotHtml(v: BarSlotView, art: HudArt, o: SlotOpts): string {
  const cls = v.kind === 'class';
  const n = v.index + 1;
  const style = cls && o.classColor ? ` style="--cc:${attr(o.classColor)}"` : '';
  const key = `<kbd class="key" aria-hidden="true">${attr(v.key)}</kbd>`;
  if (!v.skillId) {
    const label = cls ? `Class slot ${n}${o.className ? ` (${o.className})` : ''}` : `Empty slot ${n}: tap to pick a skill`;
    const inner =
      cls && v.classId
        ? `<img class="ghost" src="${attr(art.cls(v.classId))}" alt="" draggable="false">`
        : '<span class="plus" aria-hidden="true"></span>';
    return `<button class="slot ${cls ? 'by-class' : 'own'} empty" data-slot="${v.index}"${style} aria-label="${attr(label)}">${inner}${key}</button>`;
  }
  const rank = v.rank ?? 0;
  const max = v.maxRank ?? 0;
  const maxed = max > 0 && rank >= max;
  const ready = !!v.transformReady;
  const badge = ready
    ? '<span class="rk ready" aria-hidden="true">✨</span>'
    : max > 0
      ? `<span class="rk${maxed ? ' max' : ''}" aria-hidden="true">${maxed ? '★' : rank}</span>`
      : '';
  const pip = v.element ? art.pip(v.element) : '';
  const name = v.name ?? '';
  const label = `${name}${maxed ? ', mastered' : max > 0 ? `, rank ${rank}` : ''}${cls ? ' (class slot)' : ''}`;
  const classes = ['slot', cls ? 'by-class' : 'own', o.auto ? 'auto' : '', maxed ? 'maxed' : '', ready ? 'ready' : ''].filter(Boolean).join(' ');
  return `<button class="${classes}" data-slot="${v.index}" data-skill="${attr(v.skillId)}"${style} aria-label="${attr(label)}">
<img class="ico" src="${attr(art.skill(v.skillId))}" alt="" draggable="false">${pip ? `<img class="pip" src="${attr(pip)}" alt="" draggable="false">` : ''}${
    cls && v.classId ? `<img class="emb" src="${attr(art.cls(v.classId))}" alt="" draggable="false">` : '<span class="edit" aria-hidden="true"></span>'
  }${badge}${o.spark ? `<span class="spk" data-w="none" aria-hidden="true">${SPARK_RUNE}</span>` : ''}<span class="cd" aria-hidden="true"><b></b></span><span class="xp" aria-hidden="true"><i></i></span><span class="ring" aria-hidden="true"></span>${key}</button>`;
}

/** Small tabs above the bar naming the two groups (class slots / your slots) — landscape layouts only. */
export function barTabsHtml(classCount: number, total: number, worn: WornClassView | null, classIcon: string): string {
  if (!worn || classCount <= 0 || classCount >= total) return '';
  return `<span class="grp by-class" style="--cc:${attr(worn.color)};--n:${classCount}">${classIcon ? `<img src="${attr(classIcon)}" alt="" draggable="false">` : ''}${esc(worn.name)}</span><span class="grp own" style="--n:${total - classCount}">Yours</span>`;
}

const TAG_CLASS: Record<ZoneView['tag'], string> = { Safe: 'safe', Hunting: 'hunt', Dungeon: 'dungeon', Warden: 'warden' };

/** Zone plate: map name, safety pill, level band. The name sits in `b` (the playtest checks `.zone-banner b`). */
export function zonePlateHtml(z: Pick<ZoneView, 'name' | 'tag'> & { band?: string }): string {
  return `<b class="zn">${esc(z.name)}</b><em class="zt ${TAG_CLASS[z.tag] ?? 'safe'}">${esc(z.tag)}</em>${
    z.band ? `<span class="zb">${digits(esc(z.band))}</span>` : ''
  }`;
}

/** The slim strip under the zone plate: explored % · element sources · warden. */
export function zoneStripHtml(z: ZoneView, elIcon: (el: string) => string): string {
  const parts: string[] = [];
  parts.push(`<span class="zx">${HUD_WORDS.explored} <span class="num">${Math.max(0, Math.min(100, Math.round(z.explored)))}%</span></span>`);
  if (z.sources.length)
    parts.push(
      `<span class="zs">${z.sources
        .map((e) => {
          const u = elIcon(e);
          return u ? `<img src="${attr(u)}" alt="${attr(e)}" title="${attr(e)}" draggable="false">` : '';
        })
        .join('')}</span>`,
    );
  if (z.warden) parts.push(`<span class="zw ${z.warden}">${z.warden === 'alive' ? HUD_WORDS.warden : HUD_WORDS.wardenDown}</span>`);
  return parts.join('<i class="dot" aria-hidden="true"></i>');
}

/** Stat strip: ATK · MATK · DEF and the worn class with its Class Level (bar in the class colour). */
export function statsHtml(st: { atk: number; matk: number; def: number }, worn: WornClassView | null, classIcon: string, showClass: boolean): string {
  const n = (v: number) => Math.round(v);
  const stats = `<span class="st"><small>ATK</small><b>${n(st.atk)}</b></span><span class="st"><small>MATK</small><b>${n(st.matk)}</b></span><span class="st"><small>DEF</small><b>${n(st.def)}</b></span>`;
  if (!showClass) return stats;
  if (!worn) return `${stats}<span class="cl none">${HUD_WORDS.noClass}</span>`;
  const pct = Math.round(Math.max(0, Math.min(1, worn.progress)) * 100);
  const max = worn.level >= worn.maxLevel;
  return `${stats}<span class="cl" style="--cc:${attr(worn.color)}" title="Class Level ${worn.level}${max ? ' (max)' : ''}">${
    classIcon ? `<img src="${attr(classIcon)}" alt="" draggable="false">` : ''
  }<span class="cn">${esc(worn.name)}</span><b>Lv <span class="num">${worn.level}</span>${max ? '★' : ''}</b><u><i style="width:${max ? 100 : pct}%"></i></u></span>`;
}

/** One Pursuits row: tracked quests (objective line with progress) and goals (one plain next step). */
export function pursuitHtml(p: PursuitView, i: number, iconUrl: string): string {
  const { text, count } = splitCount(p.line);
  const pct = p.progress !== undefined ? Math.round(Math.max(0, Math.min(1, p.progress)) * 100) : -1;
  const ico = iconUrl
    ? `<img src="${attr(iconUrl)}" alt="" draggable="false">`
    : `<i class="g g-${p.kind === 'quest' ? 'quest' : 'skills'}" aria-hidden="true"></i>`;
  return `<button class="pz-row ${p.kind}${p.ready ? ' ready' : ''}" data-i="${i}" data-key="${attr(p.key)}" aria-label="${attr(`${p.title}: ${p.line}`)}">
<span class="pz-ico">${ico}</span><span class="pz-txt"><b>${digits(esc(p.title))}</b><span class="pz-line"><span>${digits(esc(text))}</span>${count ? `<em class="num">${esc(count)}</em>` : ''}</span></span>${
    pct >= 0 && !p.ready ? `<u class="pz-bar"><i style="width:${pct}%"></i></u>` : ''
  }</button>`;
}

/** Picker grid (panel 'picker', arg '<slot>'): icons + names, newest first; 'Empty' first when the slot holds a skill. */
export function pickerHtml(view: SlotPickerView, icon: (id: string) => string, classSlots: number): string {
  const tiles: string[] = [];
  if (view.current)
    tiles.push(`<button class="pk-tile pk-empty" data-empty="1" aria-label="Empty this slot"><span class="pk-ico"><i class="pk-x" aria-hidden="true"></i></span><span class="nm">${HUD_WORDS.empty}</span></button>`);
  for (const c of view.choices) {
    const here = c.slot === view.slot;
    const inClass = c.slot !== null && c.slot < classSlots;
    const tag = here ? 'Equipped' : inClass ? 'Class' : c.slot !== null ? `Slot ${c.slot + 1}` : '';
    const cls = ['pk-tile', here ? 'cur' : '', inClass ? 'inclass' : '', c.fresh ? 'fresh' : ''].filter(Boolean).join(' ');
    tiles.push(`<button class="${cls}" data-skill="${attr(c.skillId)}" aria-label="${attr(c.name)}${tag ? ` (${attr(tag)})` : ''}">
<span class="pk-ico"><img src="${attr(icon(c.skillId))}" alt="" draggable="false">${c.fresh ? '<i class="new" aria-hidden="true">New</i>' : ''}</span><span class="nm">${esc(c.name)}</span>${
      tag ? `<em class="tag">${esc(tag)}</em>` : ''
    }</button>`);
  }
  if (!view.choices.length) return `<p class="pk-none">Learn skills from quests, then pick one here.</p>`;
  return `<div class="pk-grid">${tiles.join('')}</div>`;
}

/** Slot chooser (panel 'picker', arg 'skill:<id>'): which of your slots gets the skill. */
export function slotChooserHtml(own: readonly BarSlotView[], icon: (id: string) => string): string {
  if (!own.length) return '<p class="pk-none">Your class fills every slot right now.</p>';
  return `<div class="pk-grid pk-slots">${own
    .map(
      (s) => `<button class="pk-tile${s.skillId ? '' : ' open'}" data-slot="${s.index}" aria-label="${attr(`Slot ${s.index + 1}${s.name ? `: ${s.name}` : ''}`)}">
<span class="pk-ico">${s.skillId ? `<img src="${attr(icon(s.skillId))}" alt="" draggable="false">` : '<i class="pk-plus" aria-hidden="true"></i>'}</span><span class="nm">${esc(s.name ?? HUD_WORDS.empty)}</span><em class="tag">Slot ${s.index + 1}</em></button>`,
    )
    .join('')}</div>`;
}
