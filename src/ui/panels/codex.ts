// Codex (panels lane; docs/CLIENT-v3.md §4, docs/UX-SIMPLE.md): the player's journal. Tabs appear as they get
// content (rule 7): Quests (once a quest was accepted — Active with objectives + track toggle, Available with from
// whom / where, Completed), Journal (always), Elements, Bestiary, Echoes, Fusions, Whispers.
// Panel 'codex', arg: a tab id, or 'quests' / 'quests:<questId>' (the quest log focused on that quest).
// Words: one short line per thing, stars and bars instead of formulas, no tiers / tags / ids.
import { echoNeed, ECHO_ANCHOR_RANK } from '../../core/echo';
import { bestiaryFamilyPct } from '../../core/passives';
import { parseRef } from '../../core/refs';
import { STAR_KILLS, bestiaryStars } from '../../core/skillbook';
import type { Family, MonsterDef } from '../../core/types';
import { MAPS } from '../../data/world';
import type { QuestCardView } from '../controller';
import { $$, esc, hex, sourceText } from '../util';
import { familyName, oneLine, seen, shapeWord } from '../words';
import { type PanelHost, armTwice, iconHtml, tab, tabsHtml, wireTabs, wireToggles } from './common';
import { logCardHtml } from './quests';
import { pips, sheet } from './skills';

const ELEMENT_HINTS: Record<string, string> = {
  fire: 'Brann the smith knows the way.',
  water: 'The lake gets into those who fish it.',
  earth: 'Dig long enough and the stone talks back.',
  wind: 'A hilltop shrine rewards stillness.',
  shadow: 'An old stone in the gloom.',
  holy: 'Sister Alba, once three elements dwell in you.',
  lightning: 'The heart of a storm.',
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

function starsHtml(n: number): string {
  return `<span class="stars">${'★'.repeat(n)}${'☆'.repeat(3 - n)}</span>`;
}

function playTime(ms: number): string {
  const m = Math.floor(ms / 60000);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
}

/** Which Codex tabs have content now (UX-SIMPLE rule 7). */
export function codexTabs(host: PanelHost): [string, string][] {
  const { book, reg } = host.ctrl;
  const st = book.state;
  const tabs: [string, string][] = [];
  const u = host.ctrl.unlocks();
  if (u.quests) {
    const log = host.ctrl.questLog();
    const ready = log.active.filter((q) => q.status === 'ready').length;
    tabs.push(['quests', `Quests${ready ? ' <small class="dot">!</small>' : ''}`]);
  }
  tabs.push(['journal', 'Journal']);
  if (Object.keys(st.elements).length) tabs.push(['elements', 'Elements']);
  if (Object.values(st.bestiary).some((n) => n > 0)) tabs.push(['bestiary', 'Bestiary']);
  const echoes = reg.authoredSkills().some((s) => echoNeed(reg, s.id) !== null && ((st.witness[s.id] ?? 0) > 0 || book.has(s.id)));
  if (echoes) tabs.push(['echoes', 'Echoes']);
  if (st.discoveries.length) tabs.push(['fusions', 'Fusions']);
  if (st.hints.length) tabs.push(['whispers', 'Whispers']);
  return tabs;
}

// ==================================================================== quests

function questsTab(host: PanelHost, focus: string | null): string {
  const { ctrl } = host;
  const log = ctrl.questLog();
  const section = (title: string, list: QuestCardView[], empty: string) =>
    `<h3>${title} <small>${list.length}</small></h3>${
      list.length ? `<div class="qlog-list">${list.map((q) => logCardHtml(ctrl, q, q.id === focus)).join('')}</div>` : `<p class="sub">${empty}</p>`
    }`;
  const active = [...log.active].sort((a, b) => Number(b.status === 'ready') - Number(a.status === 'ready') || Number(b.tracked) - Number(a.tracked));
  const done = log.done;
  return `${section('Active', active, 'Nothing in progress. Look for a gold ! over someone’s head.')}
    ${log.available.length ? section('Available', log.available, '') : ''}
    ${
      done.length
        ? `<h3>Completed <small>${done.length}</small></h3><div class="qdone">${done
            .map((q) => `<span class="qd" title="${esc(q.summary)}">✓ ${esc(q.name)}${q.status === 'cooldown' ? ' <small>· again soon</small>' : ''}</span>`)
            .join('')}</div>`
        : ''
    }`;
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
      return s
        ? `<button class="jrow" data-skill="${esc(s.id)}">${iconHtml(host.ctrl.iconUrl('skill', s.id), s.icon)}<span><b>${esc(s.name)}</b><small>${esc(sourceText(p.source, reg))}</small></span></button>`
        : '';
    })
    .join('');
  return `<div class="stat-grid j">
      ${tile(st.authoredKnown, 'skills', st.authoredTotal)}
      ${tile(st.elementsKnown, 'elements', st.elementsTotal)}
      ${tile(st.classesKnown, 'classes', st.classesTotal)}
      ${tile(st.speciesSeen, 'monsters met', st.speciesTotal)}
      ${tile(book.flag('kills'), 'defeated')}
      ${tile(session.world.visited.length, 'places', MAPS.length)}
      ${tile(playTime(session.player.playMs), 'played')}
    </div>
    <h3>Recent skills</h3>${recent || '<p class="sub">Your story is just starting.</p>'}
    <button class="btn small danger-l newgame">Start over</button>`;
}

// ==================================================================== elements

function elementsTab(host: PanelHost): string {
  const { book, reg } = host.ctrl;
  return `<div class="els">${[...reg.elements.values()]
    .map((e) => {
      const known = book.state.elements[e.id];
      if (!known) {
        return `<div class="el-row locked"><span class="ico">❔</span><span><b>???</b><small>${
          e.tier ? 'Made from two elements at an altar.' : esc(ELEMENT_HINTS[e.id] ?? 'Hidden somewhere in the world.')
        }</small></span></div>`;
      }
      const strong = e.strongVs.map((x) => reg.element(x)).filter((x) => !!x);
      return `<div class="el-row" style="--c:${hex(e.color)}"><span class="ico">${iconHtml(host.ctrl.iconUrl('el', e.id), e.icon)}</span><span><b>${esc(e.name)}</b>
        <small>${esc(oneLine(e.desc))}</small>
        ${strong.length ? `<small>Strong against ${strong.map((x) => iconHtml(host.ctrl.iconUrl('el', x!.id), x!.icon, 16)).join(' ')}</small>` : ''}</span></div>`;
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
    const boss = m.rank === 'warden' ? '<span class="chip rank warden">Warden</span>' : m.rank === 'elite' ? '<span class="chip rank elite">Elite</span>' : '';
    if (!kills) return `<div class="mrow locked"><span class="ico">❔</span><span><b>??? ${boss}</b><small>Not defeated yet</small></span></div>`;
    const st = bestiaryStars(kills);
    const next = STAR_KILLS.find((k) => k > kills);
    const el = m.element ? reg.element(m.element) : undefined;
    const echoes = (m.techniques ?? [])
      .filter((t) => t.echo)
      .map((t) => {
        const s = reg.skill(t.skill);
        const name = esc(s?.name ?? '');
        if (book.has(t.skill)) return `<span class="chip echo learned">${name} ✓</span>`;
        const need = echoNeed(reg, t.skill) ?? t.echo!.marks;
        return `<span class="chip echo">${name} · ${seen(book.state.witness[t.skill] ?? 0, need)}</span>`;
      });
    const ess = m.essence ? reg.essence(m.essence) : undefined;
    const dropped = book.flag(ESSDROP + m.id) > 0;
    return `<div class="mrow"><span class="ico">${el ? iconHtml(host.ctrl.iconUrl('el', el.id), el.icon, 24) : FAMILY_ICON[m.family]}</span><span>
      <span class="ph"><b>${esc(m.name)}</b>${starsHtml(st)}${boss}</span>
      <small>Lv ${m.level} · ${kills} defeated${next ? ` · next ★ at ${next}` : ''}</small>
      ${echoes.length ? `<small class="techs">${echoes.join('')}</small>` : ''}
      ${ess && dropped ? `<small>Drops ${esc(ess.name)}</small>` : ''}
      ${m.note ? `<small class="note">${esc(oneLine(m.note))}</small>` : ''}</span></div>`;
  };
  return `<p class="sub">Defeat more of a kind to earn ★★ (hit that family harder) and ★★★ (a little more HP).</p>
    ${[...byFamily.entries()]
      .filter(([, list]) => list.some((m) => (book.state.bestiary[m.id] ?? 0) > 0))
      .map(([fam, list]) => {
        const met = list.filter((m) => (book.state.bestiary[m.id] ?? 0) > 0).length;
        return `<h3>${FAMILY_ICON[fam]} ${familyName(fam)} <small>${met}/${list.length}${famPct[fam] ? ' · ★★ bonus' : ''}</small></h3>${list.map(row).join('')}`;
      })
      .join('')}`;
}

// ==================================================================== echoes

function echoesTab(host: PanelHost): string {
  const { book, reg } = host.ctrl;
  const echoes = reg.authoredSkills().filter((s) => echoNeed(reg, s.id) !== null);
  const known = book.known();
  let hidden = 0;
  const rows = echoes
    .map((s) => {
      const need = echoNeed(reg, s.id)!;
      const marks = book.state.witness[s.id] ?? 0;
      const learned = book.has(s.id);
      const sources = reg.techniqueSources(s.id).filter((t) => t.technique.echo);
      if (!learned && !marks) {
        hidden++;
        return '';
      }
      const anchor = known.some((k) => k.shape.kind === s.shape.kind && book.rank(k.id) >= ECHO_ANCHOR_RANK);
      const step = learned
        ? esc(oneLine(s.desc))
        : marks >= need && !anchor
          ? `Raise a ${esc(shapeWord(s.shape.kind))} skill to rank ${ECHO_ANCHOR_RANK} to keep it.`
          : `Watch it, then defeat the ${esc(sources[0]?.monster.name ?? 'monster')}.`;
      return `<div class="mrow echo ${learned ? 'owned' : ''}"><span class="ico">${iconHtml(host.ctrl.iconUrl('skill', s.id), s.icon)}</span><span>
        <span class="ph"><b>${esc(s.name)}</b>${learned ? '<span class="chip up">Learned</span>' : `${pips(Math.min(marks, need), need, 'violet')}<small>${seen(marks, need)}</small>`}</span>
        <small>${step}</small></span></div>`;
    })
    .join('');
  return `<p class="sub">See a monster use a move, then defeat it. See it enough and the move is yours.</p>
    ${rows || '<p class="sub">No moves seen yet.</p>'}
    ${hidden ? `<p class="sub">${hidden} more to find in the wild.</p>` : ''}`;
}

// ==================================================================== fusions & whispers

function fusionsTab(host: PanelHost): string {
  const { book, reg } = host.ctrl;
  const rows: string[] = [];
  for (const k of [...book.state.discoveries].reverse()) {
    const plus = k.indexOf('+', k.indexOf(':'));
    const a = k.slice(0, plus);
    const b = k.slice(plus + 1);
    const recipe = reg.recipe(a, b);
    const learned = Object.values(book.state.skills).find((p) => p.source === `fusion:${k}`);
    const result = recipe?.result ?? (learned ? `skill:${learned.id}` : undefined);
    const ok = result && parseRef(result).kind !== 'mod';
    rows.push(
      `<div class="recipe"><span>${reg.refIcon(a)} ${esc(reg.refName(a))}</span><i>+</i><span>${reg.refIcon(b)} ${esc(reg.refName(b))}</span>${
        ok ? `<i>→</i><b>${reg.refIcon(result!)} ${esc(reg.refName(result!))}</b>` : ''
      }</div>`,
    );
  }
  return `<p class="sub">Everything you made at a Fusion Altar.</p>${rows.join('') || '<p class="sub">Nothing made yet.</p>'}`;
}

function whispersTab(host: PanelHost): string {
  const { book, reg } = host.ctrl;
  if (!book.state.hints.length) return '<p class="sub">No whispers yet.</p>';
  const riddles = new Set(reg.classes.filter((c) => book.state.whispered.includes(c.id)).map((c) => c.hint));
  return `<p class="sub">Riddles and rumours you have heard.</p>${[...book.state.hints]
    .reverse()
    .map((h) => `<p class="whisper ${riddles.has(h) ? 'riddle' : ''}">${riddles.has(h) ? '🏛️ ' : ''}“${esc(h)}”</p>`)
    .join('')}`;
}

// ==================================================================== entry

export function renderCodex(host: PanelHost, arg?: string): void {
  const { ctrl } = host;
  const tabs = codexTabs(host);
  let focus: string | null = null;
  // Opening with an arg (quest tracker, a card's button) picks the tab once; later taps on tabs win.
  const again = host.modal.querySelector<HTMLElement>('.sheet.codex')?.dataset.arg === (arg ?? '');
  if (arg && !again) {
    const [t, id] = arg.split(':');
    if (tabs.some(([x]) => x === t)) host.state['codex.tab'] = t;
    if (t === 'quests') host.state['codex.focus'] = id;
  }
  let t = tab(host, 'codex.tab', tabs[0][0]);
  if (!tabs.some(([x]) => x === t)) t = tabs[0][0];
  if (t === 'quests') focus = (host.state['codex.focus'] as string | undefined) ?? null;
  const content =
    t === 'quests'
      ? questsTab(host, focus)
      : t === 'elements'
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
  sheet(host, '📜 Codex', `${tabs.length > 1 ? tabsHtml('codex.tab', tabs, t) : ''}${content}`, 'codex');
  host.modal.querySelector<HTMLElement>('.sheet.codex')!.dataset.arg = arg ?? '';
  wireTabs(host, 'codex.tab');
  wireToggles(host.modal);

  $$<HTMLButtonElement>(host.modal, '[data-track]').forEach((b) =>
    b.addEventListener('click', () => {
      const id = b.dataset.track!;
      const on = b.getAttribute('aria-pressed') !== 'true';
      const r = ctrl.trackQuest(id, on);
      if (!r.ok && r.message) host.toast(esc(r.message));
      host.render();
    }),
  );
  $$<HTMLButtonElement>(host.modal, '[data-abandon]').forEach((b) =>
    armTwice(b, 'Tap again to give up', () => {
      const r = ctrl.abandonQuest(b.dataset.abandon!);
      if (r.message) host.toast(esc(r.message));
      delete host.state['codex.focus'];
      host.render();
    }),
  );
  $$<HTMLElement>(host.modal, '[data-qlog]').forEach((el) =>
    el.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('button')) return;
      host.state['codex.focus'] = host.state['codex.focus'] === el.dataset.qlog ? undefined : el.dataset.qlog;
      host.render();
    }),
  );
  $$<HTMLButtonElement>(host.modal, '[data-skill]').forEach((b) => b.addEventListener('click', () => host.open('skill', b.dataset.skill!)));
  const ng = host.modal.querySelector<HTMLButtonElement>('.newgame');
  if (ng) armTwice(ng, 'Tap again to erase this hero', () => ctrl.newGame());
  if (focus && !again) host.modal.querySelector('.qlog.focus')?.scrollIntoView({ block: 'center' });
}
