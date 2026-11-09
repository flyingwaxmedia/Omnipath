// Codex (docs/CLIENT-v2.md §7): elements (with sources), bestiary (species by family, kills, stars, techniques,
// essence), echoes (witness marks / need / anchor shape), fusion codex, whispers and discovery stats.
import { echoNeed } from '../../core/echo';
import { pairKey } from '../../core/refs';
import { bestiaryStars } from '../../core/skillbook';
import type { Family, MonsterDef } from '../../core/types';
import { $, esc, sourceText } from '../util';
import { type PanelHost, armTwice, tab, tabsHtml, wireTabs } from './common';

const ELEMENT_HINTS: Record<string, string> = {
  fire: 'The forge remembers those who work it well.',
  water: 'The lake gets into those who fish it.',
  earth: 'Dig long enough and the stone talks back.',
  wind: 'A hilltop shrine rewards stillness.',
  shadow: 'An obelisk in the gloom, guarded by caps.',
  holy: 'A priestess, once three elements dwell in you.',
  lightning: 'The heart of a storm-maned warden.',
};

function stars(n: number): string {
  return `<span class="stars">${'★'.repeat(n)}${'☆'.repeat(3 - n)}</span>`;
}

function elementsTab(host: PanelHost): string {
  const { book, reg } = host.ctrl;
  return `<div class="els">${[...reg.elements.values()]
    .map((e) => {
      const known = book.state.elements[e.id];
      return known
        ? `<div class="el-row"><span class="ico">${e.icon}</span><span><b>${e.name}</b><small>${esc(e.desc)}</small><small class="src">${esc(sourceText(known.source, reg))}</small></span></div>`
        : `<div class="el-row locked"><span class="ico">❔</span><span><b>???</b><small>${e.tier ? 'Born of two elements, at an altar.' : esc(ELEMENT_HINTS[e.id] ?? 'Hidden somewhere in the world.')}</small></span></div>`;
    })
    .join('')}</div>`;
}

function bestiaryTab(host: PanelHost): string {
  const { book, reg } = host.ctrl;
  const byFamily = new Map<Family, MonsterDef[]>();
  for (const m of reg.monsters.values()) byFamily.set(m.family, [...(byFamily.get(m.family) ?? []), m]);
  const row = (m: MonsterDef) => {
    const kills = book.state.bestiary[m.id] ?? 0;
    const st = bestiaryStars(kills);
    if (!kills) return `<div class="mrow locked"><span class="ico">❔</span><span><b>???</b><small>Not yet defeated${m.rank !== 'common' ? ` · ${m.rank}` : ''}</small></span></div>`;
    const el = m.element ? reg.element(m.element) : undefined;
    const techs = (m.techniques ?? []).map((t) => reg.skill(t.skill)?.name ?? t.skill);
    const ess = m.essence ? reg.essence(m.essence) : undefined;
    return `<div class="mrow"><span class="ico">${el?.icon ?? '◯'}</span><span><b>${esc(m.name)}</b> ${stars(st)} <small>Lv ${m.level} · ${m.rank} · ${m.size} · ${kills} defeated</small>
      <small>HP ${m.hp} · ATK ${m.atk} · DEF ${m.def}${el ? ` · ${el.name}${m.elementLevel && m.elementLevel > 1 ? ` ${m.elementLevel}` : ''}` : ''}</small>
      ${techs.length ? `<small>Techniques: ${techs.map(esc).join(', ')}</small>` : ''}
      ${ess ? `<small>Essence: ${ess.icon} ${esc(ess.name)}</small>` : ''}</span></div>`;
  };
  return [...byFamily.entries()]
    .map(([fam, list]) => `<h3>${fam}</h3>${list.map(row).join('')}`)
    .join('');
}

function echoesTab(host: PanelHost): string {
  const { book, reg } = host.ctrl;
  const echoes = reg.authoredSkills().filter((s) => echoNeed(reg, s.id) !== null);
  return `<p class="sub">Watch a monster's technique aimed at you, then defeat that monster: each time earns a <b>witness mark</b>.
    With enough marks — and a skill of the same shape at rank 3 to anchor it — the technique becomes yours.</p>
    ${echoes
      .map((s) => {
        const need = echoNeed(reg, s.id)!;
        const marks = book.state.witness[s.id] ?? 0;
        const known = book.has(s.id);
        const teachers = reg.techniqueSources(s.id).filter((t) => t.technique.echo && (book.state.bestiary[t.monster.id] ?? 0) > 0);
        if (!known && !marks && !teachers.length) return '';
        return `<div class="mrow ${known ? 'owned' : ''}"><span class="ico">${s.icon}</span><span><b>${esc(s.name)}</b> <small>${known ? 'Learned' : `${Math.min(marks, need)}/${need} marks`} · anchor: ${s.shape.kind} R3</small>
          ${teachers.length ? `<small>Taught by ${teachers.map((t) => esc(t.monster.name)).join(', ')}</small>` : ''}
          <span class="bar mini"><i style="width:${known ? 100 : (100 * Math.min(marks, need)) / need}%"></i></span></span></div>`;
      })
      .join('') || '<p class="sub">No echoes witnessed yet.</p>'}`;
}

function fusionsTab(host: PanelHost): string {
  const { book, reg } = host.ctrl;
  const rows = book.state.discoveries.map((k) => {
    const [a, b] = k.split('+');
    const r = reg.recipe(a, b);
    const learned = Object.values(book.state.skills).find((p) => p.source === `fusion:${pairKey(a, b)}`);
    const result = r?.result ?? (learned ? `skill:${learned.id}` : undefined);
    return `<div class="recipe">${reg.refIcon(a)} ${esc(reg.refName(a))} + ${reg.refIcon(b)} ${esc(reg.refName(b))}${
      result ? ` → <b>${reg.refIcon(result)} ${esc(reg.refName(result))}</b>` : ''
    }</div>`;
  });
  return rows.join('') || '<p class="sub">No fusions discovered yet.</p>';
}

export function renderCodex(host: PanelHost): void {
  const { ctrl } = host;
  const { book } = ctrl;
  const st = book.stats();
  const t = tab(host, 'codex.tab', 'elements');
  const content =
    t === 'bestiary'
      ? bestiaryTab(host)
      : t === 'echoes'
        ? echoesTab(host)
        : t === 'fusions'
          ? fusionsTab(host)
          : t === 'whispers'
            ? book.state.hints.length
              ? book.state.hints.map((h) => `<p class="whisper">“${esc(h)}”</p>`).join('')
              : '<p class="sub">No whispers yet. Failed fusions, trainers and old chests have things to say.</p>'
            : elementsTab(host);
  const body = `
    <div class="stat-grid">
      <div><b>${st.authoredKnown}</b><small>/ ${st.authoredTotal} skills</small></div>
      <div><b>${st.elementsKnown}</b><small>/ ${st.elementsTotal} elements</small></div>
      <div><b>${st.classesKnown}</b><small>/ ${st.classesTotal} classes</small></div>
      <div><b>${st.speciesSeen}</b><small>/ ${st.speciesTotal} species</small></div>
      <div><b>${st.echoesKnown}</b><small>/ ${st.echoesTotal} echoes</small></div>
      <div><b>${book.flag('kills')}</b><small>monsters felled</small></div>
    </div>
    ${tabsHtml(
      'codex.tab',
      [
        ['elements', 'Elements'],
        ['bestiary', 'Bestiary'],
        ['echoes', 'Echoes'],
        ['fusions', 'Fusions'],
        ['whispers', 'Whispers'],
      ],
      t,
    )}
    ${content}
    <button class="btn danger newgame">Start a new character</button>`;
  host.sheet('📜 Codex', body);
  wireTabs(host, 'codex.tab');
  armTwice($<HTMLButtonElement>(host.modal, '.newgame'), 'Tap again to erase this character', () => ctrl.newGame());
}
