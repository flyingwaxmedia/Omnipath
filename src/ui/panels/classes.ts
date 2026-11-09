// Class panel (docs/CLIENT-v2.md §7): worn class header (tier, CR bar, points), discovered classes (wear — safe maps
// only), the class tree (buy ranks, respec in safe maps), imprint slots, and the codex of undiscovered classes by
// state. Functional port; the panels stage gives the tree a proper graph view.
import { CLASS, canBuyNode, classMaxRank, classPoints, classXpToNext, imprintUnlocked } from '../../core/classes';
import type { ClassDef, StatBonus } from '../../core/types';
import { $$, esc } from '../util';
import { type PanelHost, armTwice, tab, tabsHtml, wireTabs } from './common';

const TIER = ['', 'I', 'II', 'III'];

export function bonusText(b: StatBonus): string {
  const parts: string[] = [];
  if (b.atk) parts.push(`+${b.atk}% ATK`);
  if (b.matk) parts.push(`+${b.matk}% MATK`);
  if (b.hp) parts.push(`+${b.hp}% HP`);
  if (b.sp) parts.push(`+${b.sp}% SP`);
  if (b.speed) parts.push(`+${b.speed}% move`);
  if (b.crit) parts.push(`+${b.crit} crit`);
  if (b.cdr) parts.push(`-${b.cdr}% cooldowns`);
  for (const [t, v] of Object.entries(b.tagPower ?? {})) parts.push(`+${v}% ${t} damage`);
  return parts.join(' · ');
}

function treeHtml(host: PanelHost, cls: ClassDef): string {
  const { book, reg } = host.ctrl;
  const prog = book.state.classes[cls.id];
  if (!prog || !cls.tree?.length) return '<p class="sub">This class has no tree.</p>';
  const worn = book.state.worn === cls.id;
  return `<div class="tree">${cls.tree
    .map((n) => {
      const have = prog.spent[n.id] ?? 0;
      const ref = reg.passive(n.ref) ?? reg.skill(n.ref);
      const check = canBuyNode(cls, prog, n.id);
      const req = [
        ...(n.requires ?? []).map((r) => `${r.node} R${r.rank}`),
        ...(n.minSpent ? [`${n.minSpent} pts spent`] : []),
      ].join(', ');
      return `<div class="tnode ${n.kind} ${have ? 'bought' : ''}"><span class="ico">${ref?.icon ?? '◆'}</span>
        <span><b>${esc(ref?.name ?? n.id)}</b> <small>${n.kind} · ${have}/${n.maxRank} · ${n.cost} pt${n.cost > 1 ? 's' : ''}${req ? ` · needs ${esc(req)}` : ''}</small>
        <small>${esc(ref?.desc ?? '')}</small></span>
        <button class="btn ${check.ok ? 'gold' : ''}" data-node="${esc(n.id)}" data-cls="${esc(cls.id)}" ${check.ok ? '' : 'disabled'} title="${esc(check.reason ?? '')}">${have >= n.maxRank ? 'Max' : 'Buy'}</button></div>`;
    })
    .join('')}</div>${worn ? '' : '<p class="sub">Tree passives only work while this class is worn.</p>'}`;
}

export function renderClasses(host: PanelHost): void {
  const { ctrl } = host;
  const { book, reg } = ctrl;
  const safe = ctrl.isSafe();
  const t = tab(host, 'classes.tab', 'worn');
  const worn = book.state.worn ? reg.classDef(book.state.worn) : undefined;
  const views = reg.classes.map((c) => book.classProgress(c));
  const discovered = views.filter((v) => v.discovered);
  let body = tabsHtml(
    'classes.tab',
    [
      ['worn', 'Worn'],
      ['all', `Discovered (${discovered.length})`],
      ['imprints', 'Imprints'],
      ['codex', 'Codex'],
    ],
    t,
  );
  if (t === 'worn') {
    if (!worn) {
      body += `<p class="sub">Classes are never chosen — they are <b>discovered</b> when the shape of your skills matches a hidden pattern.
        Keep learning techniques of one kind and a class will find you.</p>`;
    } else {
      const prog = book.state.classes[worn.id];
      const max = classMaxRank(worn);
      const pct = prog.rank >= max ? 100 : (100 * prog.xp) / classXpToNext(prog.rank, worn.tier);
      body += `<div class="cls active big"><span class="ico">${worn.icon}</span><span><b>${esc(worn.name)}</b> <small>Tier ${TIER[worn.tier]} · CR ${prog.rank}/${max}</small>
        <span class="bar mini over"><i style="width:${pct}%"></i></span>
        <small>${esc(worn.desc)}</small><small class="bonus">${bonusText(worn.bonus)}</small>
        <small>Tree points: <b>${classPoints(worn, prog)}</b> unspent</small></span></div>
        <h3>Class tree</h3>${treeHtml(host, worn)}
        <button class="btn respec" data-respec="${esc(worn.id)}" ${safe ? '' : 'disabled'}>↺ Respec ${esc(worn.name)}${safe ? '' : ' (safe towns only)'}</button>`;
    }
  } else if (t === 'all') {
    body += discovered.length
      ? `<div class="classes">${discovered
          .map((v) => {
            const c = v.cls;
            const on = book.state.worn === c.id;
            return `<div class="cls ${on ? 'active' : ''}"><span class="ico">${c.icon}</span><span><b>${esc(c.name)}</b> <small>Tier ${TIER[c.tier]} · CR ${v.rank}</small>
              <small>${esc(c.desc)}</small><small class="bonus">${bonusText(c.bonus)}</small>
              ${c.grants?.length ? `<small>Signature: ${c.grants.map((g) => esc(reg.skill(g)?.name ?? g)).join(', ')}</small>` : ''}</span>
              <button class="btn ${on ? '' : 'gold'}" data-wear="${esc(c.id)}" ${on || !safe ? 'disabled' : ''}>${on ? 'Worn' : 'Wear'}</button></div>`;
          })
          .join('')}</div>${safe ? '' : '<p class="sub">You can change class only in a safe town.</p>'}`
      : '<p class="sub">No classes discovered yet.</p>';
  } else if (t === 'imprints') {
    const slots = book.imprintSlots();
    const cur = book.state.imprints;
    const cands = discovered.filter((v) => v.cls.imprint && v.cls.id !== book.state.worn);
    body += `<p class="sub">An <b>imprint</b> carries a trace of a class while you wear another. Tier I imprints unlock at CR ${CLASS.imprintAt[1]},
      Tier II at CR ${CLASS.imprintAt[2]}, Tier III at CR ${CLASS.imprintAt[3]}. Slots: <b>${cur.length}/${slots}</b>.</p>
      ${
        cands.length
          ? cands
              .map((v) => {
                const c = v.cls;
                const unlocked = imprintUnlocked(c, book.state.classes[c.id]);
                const on = cur.includes(c.id);
                const p = c.imprint ? reg.passive(c.imprint) : undefined;
                const can = unlocked && (on || cur.length < slots);
                return `<div class="cls ${on ? 'active' : ''}"><span class="ico">${c.icon}</span><span><b>${esc(c.name)}</b>
                  <small>${p ? `${p.icon} ${esc(p.name)} — ${esc(p.desc)}` : ''}</small>
                  <small>${unlocked ? 'Unlocked' : `Unlocks at CR ${CLASS.imprintAt[c.tier]} (now ${v.rank})`}</small></span>
                  <button class="btn ${on ? '' : 'gold'}" data-imprint="${esc(c.id)}" ${can ? '' : 'disabled'}>${on ? 'Remove' : 'Slot'}</button></div>`;
              })
              .join('')
          : '<p class="sub">Discover another class to imprint it.</p>'
      }`;
  } else {
    const hidden = views.filter((v) => !v.discovered && (!v.cls.hidden || book.state.whispered.includes(v.cls.id)));
    const order = { near: 0, whispered: 1, unknown: 2, known: 3 } as const;
    hidden.sort((a, b) => order[a.codex] - order[b.codex] || b.progress - a.progress);
    const unknown = hidden.filter((v) => v.codex === 'unknown').length;
    const shown = hidden.filter((v) => v.codex !== 'unknown');
    body += `<p class="sub">Undiscovered callings. Riddles appear as you near them — or when a trainer, a failed fusion, an echo or your bestiary whispers them.</p>
      <div class="classes">${shown
        .map((v) => {
          const c = v.cls;
          const bars =
            v.codex === 'near'
              ? v.clauses.map((cl) => `<small>${esc(cl.clause.tags.join(' + ') || 'any')}: ${Math.min(cl.have, cl.clause.count)}/${cl.clause.count}</small>`).join('') +
                (v.parents ?? []).map((p) => `<small>${esc(reg.classDef(p.id)?.name ?? p.id)} CR ${p.have}/${p.need}</small>`).join('') +
                (v.requires ?? []).map((r) => `<small>${r.ok ? '✓' : '✗'} ${esc(r.text)}</small>`).join('')
              : '';
          return `<div class="cls locked ${v.codex}"><span class="ico">${v.codex === 'near' ? '✧' : '❔'}</span><span><b>${v.codex === 'near' ? esc(c.name) : '???'} <small>Tier ${TIER[c.tier]}</small></b>
            <small>“${esc(c.hint)}”</small>${bars}<span class="bar mini"><i style="width:${v.progress * 100}%"></i></span></span></div>`;
        })
        .join('')}</div>
      ${unknown ? `<p class="sub">❔ ${unknown} more calling${unknown > 1 ? 's' : ''} remain${unknown > 1 ? '' : 's'} unknown.</p>` : ''}`;
  }
  body += `<p class="foot">${discovered.length} of ${reg.classes.length} classes discovered</p>`;
  host.sheet('🏛️ Classes', body);
  wireTabs(host, 'classes.tab');
  const after = (r: { ok: boolean; message?: string }) => {
    if (r.message) host.toast(esc(r.message));
    host.render();
  };
  $$<HTMLButtonElement>(host.modal, '[data-wear]').forEach((b) => b.addEventListener('click', () => after(ctrl.wearClass(b.dataset.wear!))));
  $$<HTMLButtonElement>(host.modal, '[data-node]').forEach((b) =>
    b.addEventListener('click', () => after(ctrl.buyClassNode(b.dataset.cls!, b.dataset.node!))),
  );
  $$<HTMLButtonElement>(host.modal, '[data-imprint]').forEach((b) =>
    b.addEventListener('click', () => {
      const id = b.dataset.imprint!;
      const cur = book.state.imprints;
      after(ctrl.setImprints(cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
    }),
  );
  $$<HTMLButtonElement>(host.modal, '[data-respec]').forEach((b) =>
    armTwice(b, 'Tap again to refund every point', () => after(ctrl.respecClass(b.dataset.respec!))),
  );
}
