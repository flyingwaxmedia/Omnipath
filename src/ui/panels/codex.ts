// Codex (docs/CLIENT-v2.md §7): the journal (discovery stats, recent discoveries), elements (with sources and
// matchups), bestiary (species by family: stars, kills, techniques seen with witness marks, essence), echoes (witness
// marks / need / anchor shape and whether an anchor is held), the fusion codex and every whisper heard.
import { echoNeed, ECHO_ANCHOR_RANK } from '../../core/echo';
import { bestiaryFamilyPct } from '../../core/passives';
import { parseRef } from '../../core/refs';
import { STAR_KILLS, bestiaryStars } from '../../core/skillbook';
import type { Family, MonsterDef } from '../../core/types';
import { MAPS } from '../../data/world';
import { $, esc, hex, sourceText } from '../util';
import { type PanelHost, armTwice, tab, tabsHtml, wireTabs } from './common';
import { pips, sheet } from './skills';

const ELEMENT_HINTS: Record<string, string> = {
  fire: 'The forge remembers those who work it well.',
  water: 'The lake gets into those who fish it.',
  earth: 'Dig long enough and the stone talks back.',
  wind: 'A hilltop shrine rewards stillness.',
  shadow: 'An obelisk in the gloom, guarded by caps.',
  holy: 'A priestess, once three elements dwell in you.',
  lightning: 'The heart of a storm-maned warden.',
};

const FAMILY_ICON: Record<Family, string> = {
  beast: '🐾',
  sprite: '✨',
  construct: '🗿',
  revenant: '👻',
  fiend: '😈',
  sylvan: '🌿',
  swarm: '🐝',
  wyrm: '🐉',
};

const ESSDROP = 'essdrop:';

function stars(n: number): string {
  return `<span class="stars">${'★'.repeat(n)}${'☆'.repeat(3 - n)}</span>`;
}

function playTime(ms: number): string {
  const m = Math.floor(ms / 60000);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
}

// ==================================================================== journal

function journalTab(host: PanelHost): string {
  const { book, reg, session } = host.ctrl;
  const st = book.stats();
  const tile = (n: string | number, label: string, of?: number) =>
    `<div><b>${n}${of !== undefined ? `<small>/${of}</small>` : ''}</b><small>${label}</small></div>`;
  const recent = Object.values(book.state.skills)
    .filter((p) => p.source !== 'start' && p.source !== 'debug')
    .sort((a, b) => b.learnedAt - a.learnedAt)
    .slice(0, 6)
    .map((p) => {
      const s = reg.skill(p.id);
      return s ? `<div class="jrow"><span class="ico">${s.icon}</span><span><b>${esc(s.name)}</b><small>${esc(sourceText(p.source, reg))}</small></span></div>` : '';
    })
    .join('');
  const near = reg.classes.filter((c) => book.classProgress(c).codex === 'near').length;
  return `<div class="stat-grid j">
      ${tile(st.authoredKnown, 'skills', st.authoredTotal)}
      ${tile(st.infusions, 'infusions')}
      ${tile(st.elementsKnown, 'elements', st.elementsTotal)}
      ${tile(st.classesKnown, 'classes', st.classesTotal)}
      ${tile(st.echoesKnown, 'echoes', st.echoesTotal)}
      ${tile(st.speciesSeen, 'species', st.speciesTotal)}
      ${tile(book.flag('kills'), 'foes felled')}
      ${tile(st.discoveries, `from ${st.experiments} experiments`)}
      ${tile(st.passivesActive, 'passives')}
      ${tile(st.essencesHeld, `essences · ${st.essenceKinds} kinds`)}
      ${tile(session.world.visited.length, 'places', MAPS.length)}
      ${tile(playTime(session.player.playMs), 'played')}
    </div>
    ${near ? `<p class="sub">✧ ${near} calling${near > 1 ? 's' : ''} draw near — see 🏛️ Class → Codex.</p>` : ''}
    <h3>Recent discoveries</h3>${recent || '<p class="sub">Your story is still unwritten.</p>'}
    <button class="btn danger newgame">Start a new character</button>`;
}

// ==================================================================== elements

function elementsTab(host: PanelHost): string {
  const { book, reg } = host.ctrl;
  return `<div class="els">${[...reg.elements.values()]
    .map((e) => {
      const known = book.state.elements[e.id];
      if (!known) {
        return `<div class="el-row locked"><span class="ico">❔</span><span><b>??? <small>${e.tier ? 'fused' : 'primal'}</small></b><small>${
          e.tier ? 'Born of two elements, at an altar.' : esc(ELEMENT_HINTS[e.id] ?? 'Hidden somewhere in the world.')
        }</small></span></div>`;
      }
      const strong = e.strongVs.map((x) => reg.element(x)).filter((x) => !!x);
      return `<div class="el-row" style="--c:${hex(e.color)}"><span class="ico">${e.icon}</span><span><b>${esc(e.name)} <span class="chip">${esc(e.status)}</span></b>
        <small>${esc(e.desc)}</small>
        ${strong.length ? `<small>Strong vs ${strong.map((x) => `${x!.icon}`).join(' ')}</small>` : ''}
        <small class="src">${esc(sourceText(known.source, reg))}</small></span></div>`;
    })
    .join('')}</div>`;
}

// ==================================================================== bestiary

function bestiaryTab(host: PanelHost): string {
  const { book, reg } = host.ctrl;
  const byFamily = new Map<Family, MonsterDef[]>();
  for (const m of reg.monsters.values()) byFamily.set(m.family, [...(byFamily.get(m.family) ?? []), m]);
  const famPct = bestiaryFamilyPct(reg, book.state);
  const row = (m: MonsterDef) => {
    const kills = book.state.bestiary[m.id] ?? 0;
    const rank = m.rank !== 'common' ? `<span class="chip rank ${m.rank}">${m.rank}</span>` : '';
    if (!kills) return `<div class="mrow locked"><span class="ico">❔</span><span><b>??? ${rank}</b><small>Not yet defeated</small></span></div>`;
    const st = bestiaryStars(kills);
    const next = STAR_KILLS.find((k) => k > kills);
    const el = m.element ? reg.element(m.element) : undefined;
    const techs = (m.techniques ?? []).map((t) => {
      const s = reg.skill(t.skill);
      const name = esc(s?.name ?? t.skill);
      if (!t.echo) return `<span class="chip">${name}</span>`;
      if (book.has(t.skill)) return `<span class="chip echo learned">👁 ${name} ✓</span>`;
      const need = echoNeed(reg, t.skill) ?? t.echo.marks;
      return `<span class="chip echo">👁 ${name} ${Math.min(book.state.witness[t.skill] ?? 0, need)}/${need}</span>`;
    });
    const ess = m.essence ? reg.essence(m.essence) : undefined;
    const dropped = book.flag(ESSDROP + m.id) > 0;
    return `<div class="mrow"><span class="ico">${el?.icon ?? FAMILY_ICON[m.family]}</span><span>
      <span class="ph"><b>${esc(m.name)}</b>${stars(st)}${rank}</span>
      <small>${kills} defeated${next ? ` · next ★ at ${next}` : ''}</small>
      <small>Lv ${m.level} · HP ${m.hp} · ATK ${m.atk} · DEF ${m.def} · size ${m.size}${el ? ` · ${esc(el.name)}${m.elementLevel && m.elementLevel > 1 ? ` ${m.elementLevel}` : ''}` : ''}</small>
      ${techs.length ? `<small class="techs">${techs.join('')}</small>` : ''}
      ${ess ? `<small>Essence: ${ess.icon} ${esc(ess.name)} ${dropped ? '<b class="ok">· dropped</b>' : `· guaranteed by kill ${STAR_KILLS[1]}`}</small>` : ''}
      ${m.note ? `<small class="note">${esc(m.note)}</small>` : ''}</span></div>`;
  };
  return `<p class="sub">★ at 1 kill reveals a species · ★★ at ${STAR_KILLS[1]} adds +1% damage vs its family · ★★★ at ${STAR_KILLS[2]} adds +1% max HP.</p>
    ${[...byFamily.entries()]
      .map(([fam, list]) => {
        const seen = list.filter((m) => (book.state.bestiary[m.id] ?? 0) > 0).length;
        return `<h3>${FAMILY_ICON[fam]} ${fam} <small>${seen}/${list.length}${famPct[fam] ? ` · +${famPct[fam]}% damage` : ''}</small></h3>${list.map(row).join('')}`;
      })
      .join('')}`;
}

// ==================================================================== echoes

function echoesTab(host: PanelHost): string {
  const { book, reg } = host.ctrl;
  const echoes = reg.authoredSkills().filter((s) => echoNeed(reg, s.id) !== null);
  const known = book.known();
  let hiddenCount = 0;
  const rows = echoes
    .map((s) => {
      const need = echoNeed(reg, s.id)!;
      const marks = book.state.witness[s.id] ?? 0;
      const learned = book.has(s.id);
      const sources = reg.techniqueSources(s.id).filter((t) => t.technique.echo);
      const met = sources.filter((t) => (book.state.bestiary[t.monster.id] ?? 0) > 0);
      if (!learned && !marks && !met.length) {
        hiddenCount++;
        return '';
      }
      const anchor = known.find((k) => k.shape.kind === s.shape.kind && book.rank(k.id) >= ECHO_ANCHOR_RANK);
      return `<div class="mrow echo ${learned ? 'owned' : ''}"><span class="ico">${s.icon}</span><span>
        <span class="ph"><b>${esc(s.name)}</b>${learned ? '<span class="chip up">learned</span>' : pips(Math.min(marks, need), need, 'violet')}</span>
        <small>${learned ? esc(s.desc) : `${Math.min(marks, need)}/${need} witness marks${marks >= need ? ' — waiting for an anchor' : ''}`}</small>
        ${learned ? '' : `<small class="${anchor ? 'ok' : 'no'}">${anchor ? '✓' : '✗'} Anchor: a ${s.shape.kind} skill at rank ${ECHO_ANCHOR_RANK}${anchor ? ` (${esc(anchor.name)})` : ''}</small>`}
        <small>Taught by ${(learned ? sources : met).length ? (learned ? sources : met).map((t) => esc(t.monster.name)).join(', ') : 'a foe you have not felled'}${!learned && sources.length > met.length && met.length ? ' and others' : ''}</small></span></div>`;
    })
    .join('');
  return `<p class="sub">Watch a monster's technique aimed at you, then defeat that monster: each time earns a <b>witness mark</b>.
    With enough marks — and a skill of the same shape at rank ${ECHO_ANCHOR_RANK} to anchor it — the technique becomes yours.</p>
    ${rows || '<p class="sub">No echoes witnessed yet.</p>'}
    ${hiddenCount ? `<p class="sub">👁 ${hiddenCount} more echo${hiddenCount > 1 ? 'es' : ''} wait${hiddenCount > 1 ? '' : 's'} in the wild.</p>` : ''}`;
}

// ==================================================================== fusions & whispers

function fusionsTab(host: PanelHost): string {
  const { book, reg } = host.ctrl;
  const groups: Record<string, string[]> = { Recipes: [], Infusions: [], 'Essence variants': [], 'Shape fusions': [] };
  for (const k of book.state.discoveries) {
    const plus = k.indexOf('+', k.indexOf(':'));
    const a = k.slice(0, plus);
    const b = k.slice(plus + 1);
    const recipe = reg.recipe(a, b);
    const learned = Object.values(book.state.skills).find((p) => p.source === `fusion:${k}`);
    const result = recipe?.result ?? (learned ? `skill:${learned.id}` : undefined);
    const rs = result && parseRef(result).kind === 'skill' ? reg.skill(parseRef(result).id) : undefined;
    const group = recipe ? 'Recipes' : rs?.mergedFrom || rs?.id.startsWith('fuse:') ? 'Shape fusions' : rs?.essences?.length && (a.startsWith('mod:') || b.startsWith('mod:')) ? 'Essence variants' : 'Infusions';
    groups[group].push(`<div class="recipe"><span>${reg.refIcon(a)} ${esc(reg.refName(a))}</span><i>+</i><span>${reg.refIcon(b)} ${esc(reg.refName(b))}</span>${
      result ? `<i>→</i><b>${reg.refIcon(result)} ${esc(reg.refName(result))}</b>` : ''
    }</div>`);
  }
  const st = book.stats();
  const html = Object.entries(groups)
    .filter(([, rows]) => rows.length)
    .map(([g, rows]) => `<h3>${g} <small>${rows.length}</small></h3>${rows.join('')}`)
    .join('');
  return `<p class="sub">${st.discoveries} discoveries from ${st.experiments} experiments. Everything you have ever placed on an altar is remembered here and at the altar itself.</p>
    ${html || '<p class="sub">No fusions discovered yet.</p>'}`;
}

function whispersTab(host: PanelHost): string {
  const { book, reg } = host.ctrl;
  if (!book.state.hints.length) return '<p class="sub">No whispers yet. Failed fusions, trainers, echoes and old chests have things to say.</p>';
  const riddles = new Set(reg.classes.filter((c) => book.state.whispered.includes(c.id)).map((c) => c.hint));
  return [...book.state.hints]
    .reverse()
    .map((h) => `<p class="whisper ${riddles.has(h) ? 'riddle' : ''}">${riddles.has(h) ? '🏛️ ' : ''}“${esc(h)}”</p>`)
    .join('');
}

// ==================================================================== entry

export function renderCodex(host: PanelHost): void {
  const { ctrl } = host;
  const t = tab(host, 'codex.tab', 'journal');
  const content =
    t === 'elements'
      ? elementsTab(host)
      : t === 'bestiary'
        ? bestiaryTab(host)
        : t === 'echoes'
          ? echoesTab(host)
          : t === 'fusions'
            ? fusionsTab(host)
            : t === 'whispers'
              ? whispersTab(host)
              : journalTab(host);
  const body = `
    ${tabsHtml(
      'codex.tab',
      [
        ['journal', 'Journal'],
        ['elements', 'Elements'],
        ['bestiary', 'Bestiary'],
        ['echoes', 'Echoes'],
        ['fusions', 'Fusions'],
        ['whispers', 'Whispers'],
      ],
      t,
    )}
    ${content}`;
  sheet(host, '📜 Codex', body);
  wireTabs(host, 'codex.tab');
  const ng = host.modal.querySelector<HTMLButtonElement>('.newgame');
  if (ng) armTwice($<HTMLButtonElement>(host.modal, '.newgame'), 'Tap again to erase this character', () => ctrl.newGame());
}
