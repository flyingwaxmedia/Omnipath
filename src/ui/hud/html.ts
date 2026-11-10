// HUD HTML builders (HUD lane; docs/CLIENT-v3.md §2, docs/UX-SIMPLE.md). Pure string functions — art comes in as URL
// callbacks — so tests/hud.test.ts can check them in node. Every player-facing word of the HUD lives here or in
// ../hud.ts / ../picker.ts, written per docs/UX-SIMPLE.md (plain words, one short line, no internals).
import type { BarSlotView, PursuitView, SlotPickerView, ZoneView } from '../controller';
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
  potion: 'SP potion',
  sp: 'SP',
  exp: 'EXP',
  empty: 'Empty',
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
  /** The skill's element colour ('#rrggbb'): tints the icon's ground. */
  elementColor?: string;
  /** The held weapon cannot use this skill: the slot dims and wears the weapon it needs ("Needs a sword — Equip"). */
  lock?: SlotLock;
}

/** A slot's weapon lock (src/ui/classinfo.ts weaponLock). */
export interface SlotLock {
  /** The weapon to equip: 'sword' | 'dagger' | 'staff' | 'fists'. */
  need: string;
  /** "Needs a sword". */
  line: string;
  /** One tap can equip it. */
  owned: boolean;
}

/** 9 × 9 pixel glyphs of the four weapons (the small icon on a locked slot and on lock lines). */
const WEAPON_BITS: Record<string, string[]> = {
  sword: ['.......##', '......###', '.....###.', '....###..', '#..###...', '.####....', '..##.....', '.#.##....', '#...#....'],
  dagger: ['.........', '......#..', '.....##..', '....###..', '.#.###...', '..###....', '..##.....', '.#..#....', '#........'],
  staff: ['.....###.', '....#####', '....##.##', '....#####', '...#.###.', '..#......', '.#.......', '#........', '.........'],
  fists: ['.........', '..#.#.#..', '.#######.', '.#######.', '.#######.', '#.#####..', '.######..', '..####...', '.........'],
};

/** A weapon's pixel glyph as crisp inline SVG (coloured by CSS `color`); '' for unknown weapons. */
export function weaponGlyph(weapon: string, cls = ''): string {
  const rows = WEAPON_BITS[weapon];
  if (!rows) return '';
  let d = '';
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) if (row[x] === '#') d += `M${x} ${y}h1v1h-1z`;
  });
  return `<svg class="wi ${cls}" viewBox="0 0 9 9" shape-rendering="crispEdges" aria-hidden="true"><path fill="currentColor" d="${d}"/></svg>`;
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
  const vars = [cls && o.classColor ? `--cc:${attr(o.classColor)}` : '', v.skillId && o.elementColor ? `--el:${attr(o.elementColor)}` : ''].filter(Boolean).join(';');
  const style = vars ? ` style="${vars}"` : '';
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
  // In the other stance the slot casts another skill: it shows that one.
  const name = v.castsAs?.name ?? v.name ?? '';
  const iconId = v.castsAs?.skillId ?? v.skillId;
  const lock = o.lock ?? (v.lock ? { need: v.lock.weapon, line: v.lock.line, owned: v.lock.owned } : undefined);
  // A class skill its meter has not opened yet ("Needs more Vow."): dimmed, the line is its name for screen readers.
  const waiting = !lock && v.waiting ? v.waiting : '';
  const lockText = lock ? `${lock.line}${lock.owned ? ' — Equip' : ''}` : '';
  const label = lock ? `${name}: ${lockText}` : waiting ? `${name}: ${waiting}` : `${name}${maxed ? ', mastered' : max > 0 ? `, rank ${rank}` : ''}${cls ? ' (class slot)' : ''}`;
  const classes = ['slot', cls ? 'by-class' : 'own', o.auto ? 'auto' : '', maxed ? 'maxed' : '', ready ? 'ready' : '', o.elementColor ? 'tint' : '', lock ? 'wlocked' : '', waiting ? 'waiting' : '', v.boosted && !lock && !waiting ? 'boost' : '']
    .filter(Boolean)
    .join(' ');
  const lockHtml = lock ? `<span class="wlock${lock.owned ? ' can' : ''}" data-need="${attr(lock.need)}" title="${attr(lockText)}">${weaponGlyph(lock.need)}</span>` : '';
  return `<button class="${classes}" data-slot="${v.index}" data-skill="${attr(v.skillId)}"${lock ? ` data-need="${attr(lock.need)}"` : ''}${style} aria-label="${attr(label)}">
<img class="ico" src="${attr(art.skill(iconId))}" alt="" draggable="false">${lockHtml}${pip ? `<img class="pip" src="${attr(pip)}" alt="" draggable="false">` : ''}${
    cls && v.classId ? `<img class="emb" src="${attr(art.cls(v.classId))}" alt="" draggable="false">` : '<span class="edit" aria-hidden="true"></span>'
  }${badge}${o.spark ? `<span class="spk" data-w="none" aria-hidden="true">${SPARK_RUNE}</span>` : ''}<span class="cd" aria-hidden="true"><b></b></span><span class="xp" aria-hidden="true"><i></i></span><span class="ring" aria-hidden="true"></span>${key}</button>`;
}

const TAG_CLASS: Record<ZoneView['tag'], string> = { Safe: 'safe', Hunting: 'hunt', Dungeon: 'dungeon', Warden: 'warden' };

/** Zone plate: map name, safety pill, level band. The name sits in `b` (the playtest checks `.zone-banner b`). */
export function zonePlateHtml(z: Pick<ZoneView, 'name' | 'tag'> & { band?: string }, title?: { url: string; w: number; h: number } | null): string {
  // On arrival the name is drawn in the display face (an image: `title`); the small tag it shrinks to is plain text.
  const big = title?.url ? `<img class="zn-d" src="${attr(title.url)}" style="--w:${title.w};--h:${title.h}" alt="" draggable="false">` : '';
  return `${big}<b class="zn">${esc(z.name)}</b><em class="zt ${TAG_CLASS[z.tag] ?? 'safe'}">${esc(z.tag)}</em>${
    z.band ? `<span class="zb">${digits(esc(z.band))}</span>` : ''
  }`;
}

/**
 * The collapsed tracker (docs/SPEC-v4.md §11.7): ONE line on a soft dark strip — the first pursuit's next step and
 * "+N" for the rest. Tap opens the rows.
 */
export function pursuitLineHtml(list: readonly PursuitView[], mark?: QuestMarkArt | null): string {
  const p = list[0];
  if (!p) return '';
  const { text, count } = splitCount(p.line);
  const ico = p.kind === 'quest' ? questMarkHtml(!!p.ready, mark) : '<i class="g g-quest" aria-hidden="true"></i>';
  const rest = list.length - 1;
  return `<span class="pz-ico">${ico}</span><span class="pz-one${p.ready ? ' ready' : ''}">${digits(esc(text))}${count ? ` <em class="num">${esc(count)}</em>` : ''}</span>${
    rest > 0 ? `<em class="pz-rest num">+${rest}</em>` : ''
  }`;
}

/** A quest marker as the NPCs wear it (pixel art data URL + its size in art px). */
export interface QuestMarkArt {
  url: string;
  w: number;
  h: number;
}

/** The tracker's mark for a quest: the NPC marker set ('…' in progress, '?' ready to turn in; '!' only ever means
 *  "a new quest here", so it never shows in the tracker — docs/UX-SIMPLE.md rule 10). */
export function questMarkHtml(ready: boolean, art?: QuestMarkArt | null): string {
  const label = ready ? 'Ready to turn in' : 'In progress';
  if (art?.url) return `<img class="qm" src="${attr(art.url)}" style="--w:${art.w};--h:${art.h}" alt="${label}" draggable="false">`;
  return `<b class="qm-t" aria-label="${label}">${ready ? '?' : '…'}</b>`;
}

/** One Pursuits row: tracked quests (objective line with progress) and goals (one plain next step). */
export function pursuitHtml(p: PursuitView, i: number, iconUrl: string, mark?: QuestMarkArt | null): string {
  const { text, count } = splitCount(p.line);
  const pct = p.progress !== undefined ? Math.round(Math.max(0, Math.min(1, p.progress)) * 100) : -1;
  const ico = iconUrl
    ? `<img src="${attr(iconUrl)}" alt="" draggable="false">`
    : p.kind === 'quest'
      ? questMarkHtml(!!p.ready, mark)
      : '<i class="g g-skills" aria-hidden="true"></i>';
  return `<button class="pz-row ${p.kind}${p.ready ? ' ready' : ''}" data-i="${i}" data-key="${attr(p.key)}" aria-label="${attr(`${p.title}: ${p.line}`)}">
<span class="pz-ico">${ico}</span><span class="pz-txt"><b>${digits(esc(p.title))}</b><span class="pz-line"><span>${digits(esc(text))}</span>${count ? `<em class="num">${esc(count)}</em>` : ''}</span></span>${
    pct >= 0 && !p.ready ? `<u class="pz-bar"><i style="width:${pct}%"></i></u>` : ''
  }</button>`;
}

/** What the picker says when nothing can go in the slot, and its one button (the quest log: quests teach skills). */
export const PICKER_NONE = { line: 'Learn a new skill to fill this slot.', button: 'See quests' } as const;

/**
 * Picker grid (panel 'picker', arg '<slot>'): the skills that can go in this slot — icons + names, newest first;
 * 'Empty' first when the slot holds a skill. Skills your class already holds are not choices: they sit dimmed in a
 * small row below ("Already in your class slots"). Nothing to pick → one line and one button (`.pk-quests`).
 */
export function pickerHtml(view: SlotPickerView, icon: (id: string) => string, classSlots: number): string {
  const inClass = (c: SlotPickerView['choices'][number]) => c.slot !== null && c.slot < classSlots;
  const picks = view.choices.filter((c) => !inClass(c));
  const held = view.choices.filter(inClass);
  const tiles: string[] = [];
  if (view.current)
    tiles.push(`<button class="pk-tile pk-empty" data-empty="1" aria-label="Empty this slot"><span class="pk-ico"><i class="pk-x" aria-hidden="true"></i></span><span class="nm">${HUD_WORDS.empty}</span></button>`);
  for (const c of picks) {
    const here = c.slot === view.slot;
    const tag = here ? 'Equipped' : c.slot !== null ? `Slot ${c.slot + 1}` : '';
    const cls = ['pk-tile', here ? 'cur' : '', c.fresh ? 'fresh' : ''].filter(Boolean).join(' ');
    tiles.push(`<button class="${cls}" data-skill="${attr(c.skillId)}" aria-label="${attr(c.name)}${tag ? ` (${attr(tag)})` : ''}">
<span class="pk-ico"><img src="${attr(icon(c.skillId))}" alt="" draggable="false">${c.fresh ? '<i class="new" aria-hidden="true">New</i>' : ''}</span><span class="nm">${esc(c.name)}</span>${
      tag ? `<em class="tag">${esc(tag)}</em>` : ''
    }</button>`);
  }
  const classRow = held.length
    ? `<div class="pk-class"><small>Already in your class slots</small><div class="pk-mini">${held
        .map((c) => `<span class="inclass" title="${attr(c.name)}"><img src="${attr(icon(c.skillId))}" alt="${attr(c.name)}" draggable="false"></span>`)
        .join('')}</div></div>`
    : '';
  // Something to choose: the slot's own skill alone is no choice unless it can be emptied (it always can).
  if (picks.length || view.current) return `<div class="pk-grid">${tiles.join('')}</div>${classRow}`;
  return `<p class="pk-none">${PICKER_NONE.line}</p><div class="pk-acts"><button class="btn gold big pk-quests">${PICKER_NONE.button}</button></div>${classRow}`;
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
