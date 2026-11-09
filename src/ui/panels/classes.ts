// Class panel (docs/CLIENT-v2.md §7): the worn class header (tier, Class Rank bar, points), the class TREE view (node
// ranks, costs, requires, minSpent gates, buy, respec in safe maps), the discovered list (wear — safe maps only, with
// the reason elsewhere), the imprint slot picker and the codex of undiscovered classes by state
// (near / whispered / unknown / known). Routing: arg 'tree:<classId>' opens that class's tree.
import { CLASS, canBuyNode, classMaxRank, classPoints, classXpToNext, imprintUnlocked, spentPoints, type ClassView } from '../../core/classes';
import { IMPRINT_STRENGTH } from '../../core/passives';
import type { ClassDef, ClassNode, StatBonus } from '../../core/types';
import { MAPS } from '../../data/world';
import { $$, esc } from '../util';
import { type PanelHost, armTwice, reqList, tab, tabsHtml, wireTabs } from './common';
import { pips, sheet } from './skills';

const TIER = ['', 'I', 'II', 'III'];

export function bonusText(b: StatBonus): string {
  return bonusChips(b)
    .map((c) => c.replace(/<[^>]+>/g, ''))
    .join(' · ');
}

function bonusChips(b: StatBonus): string[] {
  const parts: string[] = [];
  const chip = (t: string) => parts.push(`<span class="chip up">${t}</span>`);
  if (b.atk) chip(`+${b.atk}% ATK`);
  if (b.matk) chip(`+${b.matk}% MATK`);
  if (b.hp) chip(`+${b.hp}% HP`);
  if (b.sp) chip(`+${b.sp}% SP`);
  if (b.speed) chip(`+${b.speed}% move`);
  if (b.crit) chip(`+${b.crit} crit`);
  if (b.cdr) chip(`−${b.cdr}% cooldowns`);
  for (const [t, v] of Object.entries(b.tagPower ?? {})) chip(`+${v}% ${esc(t)} dmg`);
  return parts;
}

function safeTowns(): string {
  return MAPS.filter((m) => m.safety === 'safe' && m.kind !== 'dungeon')
    .map((m) => esc(m.name))
    .join(', ');
}

function tierBadge(c: ClassDef): string {
  return `<span class="tier-b t${c.tier}">${TIER[c.tier]}</span>`;
}

function crBar(host: PanelHost, c: ClassDef): string {
  const prog = host.ctrl.book.state.classes[c.id];
  if (!prog) return '';
  const max = classMaxRank(c);
  const need = classXpToNext(prog.rank, c.tier);
  const pct = prog.rank >= max ? 100 : (100 * prog.xp) / need;
  return `<div class="crbar"><span class="bar mini over"><i style="width:${pct}%"></i></span>
    <small>${prog.rank >= max ? `CR ${prog.rank} · max` : `CR ${prog.rank}/${max} · ${Math.floor(prog.xp)}/${need} XP`}</small></div>`;
}

// ==================================================================== tree

interface TreeRow {
  gate?: number;
  nodes: ClassNode[];
}

/** Rows: root nodes, then nodes by prerequisite depth (same column as their parent), then minSpent gates. */
function treeRows(c: ClassDef): { rows: TreeRow[]; cols: number; colOf: Map<string, number> } {
  const tree = c.tree ?? [];
  const free = tree.filter((n) => n.minSpent === undefined);
  const depth = new Map<string, number>();
  const depthOf = (n: ClassNode): number => {
    const hit = depth.get(n.id);
    if (hit !== undefined) return hit;
    depth.set(n.id, 0);
    const d = Math.max(0, ...(n.requires ?? []).map((r) => 1 + depthOf(tree.find((x) => x.id === r.node) ?? n)));
    depth.set(n.id, d);
    return d;
  };
  const rows: TreeRow[] = [];
  for (const n of free) {
    const d = depthOf(n);
    (rows[d] ??= { nodes: [] }).nodes.push(n);
  }
  const roots = rows[0]?.nodes ?? [];
  const colOf = new Map<string, number>();
  roots.forEach((n, i) => colOf.set(n.id, i));
  for (const row of rows.slice(1)) {
    for (const n of row?.nodes ?? []) colOf.set(n.id, colOf.get(n.requires?.[0]?.node ?? '') ?? 0);
  }
  const gates = [...new Set(tree.filter((n) => n.minSpent !== undefined).map((n) => n.minSpent!))].sort((a, b) => a - b);
  for (const g of gates) rows.push({ gate: g, nodes: tree.filter((n) => n.minSpent === g) });
  return { rows: rows.filter(Boolean), cols: Math.max(1, roots.length), colOf };
}

function nodeRef(host: PanelHost, n: ClassNode): { name: string; icon: string; desc: string } {
  const { reg } = host.ctrl;
  const ref = reg.passive(n.ref) ?? reg.skill(n.ref);
  return { name: ref?.name ?? n.id, icon: ref?.icon ?? '◆', desc: ref?.desc ?? '' };
}

function treeHtml(host: PanelHost, c: ClassDef): string {
  const { book } = host.ctrl;
  const prog = book.state.classes[c.id];
  if (!prog || !c.tree?.length) return '<p class="sub">This class has no tree.</p>';
  const key = `classes.node:${c.id}`;
  const { rows, cols, colOf } = treeRows(c);
  const spent = spentPoints(c, prog);
  let sel = host.state[key] as string | undefined;
  if (!sel || !c.tree.some((n) => n.id === sel)) sel = (c.tree.find((n) => canBuyNode(c, prog, n.id).ok) ?? c.tree[0]).id;
  const nodeBtn = (n: ClassNode, col?: number) => {
    const have = prog.spent[n.id] ?? 0;
    const r = nodeRef(host, n);
    const check = canBuyNode(c, prog, n.id);
    const gated = (n.minSpent ?? 0) > spent || (n.requires ?? []).some((q) => (prog.spent[q.node] ?? 0) < q.rank);
    const state = have >= n.maxRank ? 'maxed' : have ? 'part' : check.ok ? 'buy' : gated ? 'gated' : 'poor';
    return `<button class="cnode ${n.kind} ${state} ${n.id === sel ? 'sel' : ''} ${n.requires?.length ? 'child' : ''}" data-cnode="${esc(n.id)}"
      ${col !== undefined ? `style="grid-column:${col + 1}"` : ''}>
      <span class="ico">${r.icon}${n.kind === 'skill' ? '<i class="kind">skill</i>' : n.kind === 'capstone' ? '<i class="kind">cap</i>' : ''}</span>
      <span class="cn-name">${esc(r.name)}</span>
      <span class="cn-foot">${pips(have, n.maxRank, 'gold')}<small>${n.cost} pt${n.cost > 1 ? 's' : ''}</small></span></button>`;
  };
  const rowsHtml = rows
    .map((row) =>
      row.gate !== undefined
        ? `<div class="cgate ${spent >= row.gate ? 'open' : ''}"><span>${spent >= row.gate ? '◆' : '🔒'} ${row.gate} points spent in this tree <b>${Math.min(spent, row.gate)}/${row.gate}</b></span></div>
           <div class="crow" style="--cols:${row.nodes.length}">${row.nodes.map((n) => nodeBtn(n)).join('')}</div>`
        : `<div class="crow" style="--cols:${cols}">${row.nodes.map((n) => nodeBtn(n, colOf.get(n.id))).join('')}</div>`,
    )
    .join('');
  const n = c.tree.find((x) => x.id === sel)!;
  const r = nodeRef(host, n);
  const have = prog.spent[n.id] ?? 0;
  const check = canBuyNode(c, prog, n.id);
  const points = classPoints(c, prog);
  const reqs = [
    ...(n.requires ?? []).map((q) => {
      const other = c.tree!.find((x) => x.id === q.node);
      return { text: `${other ? nodeRef(host, other).name : q.node} rank ${q.rank}`, ok: (prog.spent[q.node] ?? 0) >= q.rank };
    }),
    ...(n.minSpent ? [{ text: `${n.minSpent} points spent in this tree (${spent})`, ok: spent >= n.minSpent }] : []),
    ...(have < n.maxRank ? [{ text: `${n.cost} point${n.cost > 1 ? 's' : ''} to spend (${points} unspent)`, ok: points >= n.cost }] : []),
  ];
  const worn = book.state.worn === c.id;
  const skill = n.kind === 'skill' ? host.ctrl.reg.skill(n.ref) : undefined;
  const detail = `<div class="cdetail">
    <div class="node-head"><span class="ico">${r.icon}</span><div><b>${esc(r.name)}</b>
      <small>${n.kind === 'capstone' ? 'Capstone' : n.kind === 'skill' ? 'Skill node' : 'Passive'} · rank ${have}/${n.maxRank} ${pips(have, n.maxRank, 'gold')}</small></div></div>
    <p class="sub">${esc(r.desc)}${skill ? ` <b>Teaches ${esc(skill.name)}</b>${host.ctrl.book.has(skill.id) ? ' (known — kept on respec)' : ''}.` : ''}</p>
    ${reqList(reqs)}
    <button class="btn ${check.ok ? 'gold' : ''} wide" data-buy="${esc(n.id)}" ${check.ok ? '' : 'disabled'}>${have >= n.maxRank ? 'Max rank' : check.ok ? `Buy rank ${have + 1} · ${n.cost} pt${n.cost > 1 ? 's' : ''}` : esc(check.reason ?? 'Locked')}</button>
    ${worn ? '' : '<p class="sub">Tree passives work only while this class is worn.</p>'}
  </div>`;
  const safe = host.ctrl.isSafe();
  return `<div class="ctree-split">
      <div class="ctree"><div class="ctree-pts"><b>${points}</b> point${points === 1 ? '' : 's'} unspent · ${spent} spent</div>${rowsHtml}</div>
      ${detail}
    </div>
    <button class="btn respec" data-respec="${esc(c.id)}" ${safe && spent > 0 ? '' : 'disabled'}>↺ Respec ${esc(c.name)}${safe ? '' : ' · safe towns only'}</button>
    <p class="sub">Respec refunds every passive and capstone point. Skill nodes stay bought — you keep their skill.</p>`;
}

function wornHeader(host: PanelHost, c: ClassDef, big = true): string {
  const { book, reg } = host.ctrl;
  const prog = book.state.classes[c.id];
  const points = classPoints(c, prog);
  const imprint = c.imprint ? reg.passive(c.imprint) : undefined;
  const impAt = CLASS.imprintAt[c.tier];
  return `<div class="chead ${big ? 'big' : ''} ${book.state.worn === c.id ? 'worn' : ''}">
    <span class="ico">${c.icon}</span>
    <div><div class="ch-t"><b>${esc(c.name)}</b>${tierBadge(c)}${book.state.worn === c.id ? '<span class="chip tier">Worn</span>' : ''}</div>
      ${crBar(host, c)}
      <small>${esc(c.desc)}</small>
      <div class="chips">${bonusChips(c.bonus).join('')}</div>
      <small>${points ? `<b class="pts">${points}</b> tree point${points === 1 ? '' : 's'} to spend · ` : ''}${
        imprint ? (imprintUnlocked(c, prog) ? `Imprint ${imprint.icon} ${esc(imprint.name)} unlocked` : `Imprint unlocks at CR ${impAt}`) : 'No imprint'
      }</small>
      ${c.grants?.length ? `<small>Signature: ${c.grants.map((g) => `${reg.skill(g)?.icon ?? ''} ${esc(reg.skill(g)?.name ?? g)}`).join(', ')}</small>` : ''}
    </div></div>`;
}

// ==================================================================== tabs

function wornTab(host: PanelHost): string {
  const { book, reg } = host.ctrl;
  const worn = book.state.worn ? reg.classDef(book.state.worn) : undefined;
  if (!worn) {
    return `<div class="empty-state"><span class="ico">🏛️</span><p>Classes are never chosen — they are <b>discovered</b> when the shape of your skills matches a hidden pattern.
      Keep learning techniques of one kind and a class will find you.</p><p class="sub">The Codex tab shows callings you are nearing.</p></div>`;
  }
  return `${wornHeader(host, worn)}<h3>${esc(worn.name)} tree</h3>${treeHtml(host, worn)}`;
}

function allTab(host: PanelHost, views: ClassView[]): string {
  const { book, reg } = host.ctrl;
  const safe = host.ctrl.isSafe();
  const discovered = views.filter((v) => v.discovered);
  if (!discovered.length) return '<p class="sub">No classes discovered yet.</p>';
  discovered.sort((a, b) => Number(book.state.worn === b.cls.id) - Number(book.state.worn === a.cls.id) || b.cls.tier - a.cls.tier || b.rank - a.rank);
  return `${safe ? '' : `<div class="away small"><span class="ico">🏛️</span><div><b>Classes change only in safe towns.</b><small>Here you can study and buy tree nodes, but to wear another class visit ${safeTowns()}.</small></div></div>`}
    <div class="clist">${discovered
      .map((v) => {
        const c = v.cls;
        const on = book.state.worn === c.id;
        const pts = classPoints(c, book.state.classes[c.id]);
        return `<div class="ccard ${on ? 'active' : ''}">
          <div class="cc-top"><span class="ico">${c.icon}</span><div><div class="ch-t"><b>${esc(c.name)}</b>${tierBadge(c)}${pts ? `<span class="chip tier">${pts} pt${pts > 1 ? 's' : ''}</span>` : ''}</div>
            ${crBar(host, c)}<div class="chips">${bonusChips(c.bonus).join('')}</div>
            ${c.grants?.length ? `<small>Signature: ${c.grants.map((g) => esc(reg.skill(g)?.name ?? g)).join(', ')}</small>` : ''}</div></div>
          <div class="cc-btns"><button class="btn" data-ctree="${esc(c.id)}">Tree ›</button>
            <button class="btn ${on ? '' : 'gold'}" data-wear="${esc(c.id)}" ${on || !safe ? 'disabled' : ''}>${on ? 'Worn' : safe ? 'Wear' : 'Wear in town'}</button></div>
        </div>`;
      })
      .join('')}</div>`;
}

const SLOT_RULES = [
  'Any class reaches its imprint Class Rank',
  'Discover a Tier II class',
  'Discover a Tier III class, or 12 classes',
];

function imprintsTab(host: PanelHost, views: ClassView[]): string {
  const { book, reg } = host.ctrl;
  const slots = book.imprintSlots();
  const cur = book.state.imprints.slice(0, slots);
  const slotHtml = [0, 1, 2]
    .map((i) => {
      if (i >= slots) return `<div class="islot locked"><span class="ico">🔒</span><small>${SLOT_RULES[i]}</small></div>`;
      const id = cur[i];
      const c = id ? reg.classDef(id) : undefined;
      const p = c?.imprint ? reg.passive(c.imprint) : undefined;
      return c
        ? `<button class="islot on" data-unslot="${esc(c.id)}" aria-label="Remove ${esc(c.name)} imprint"><span class="ico">${c.icon}</span><b>${esc(c.name)}</b><small>${p ? esc(p.desc) : ''}</small><small class="st">×${IMPRINT_STRENGTH[c.tier]} · tap to remove</small></button>`
        : `<div class="islot empty"><span class="ico">◇</span><small>Empty slot — choose below</small></div>`;
    })
    .join('');
  const cands = views.filter((v) => v.discovered && v.cls.imprint && v.cls.id !== book.state.worn);
  return `<p class="sub">An <b>imprint</b> carries a trace of a class while you wear another. Tier I imprints unlock at CR ${CLASS.imprintAt[1]},
      Tier II at CR ${CLASS.imprintAt[2]}, Tier III at CR ${CLASS.imprintAt[3]}. Tier II/III imprints work at ×0.6 strength.</p>
    <div class="islots">${slotHtml}</div>
    <h3>Imprints you could slot</h3>
    ${
      cands.length
        ? cands
            .map((v) => {
              const c = v.cls;
              const unlocked = imprintUnlocked(c, book.state.classes[c.id]);
              const on = cur.includes(c.id);
              const p = c.imprint ? reg.passive(c.imprint) : undefined;
              const can = unlocked && (on || cur.length < slots);
              return `<div class="cls ${on ? 'active' : ''} ${unlocked ? '' : 'locked'}"><span class="ico">${c.icon}</span><span><b>${esc(c.name)} ${tierBadge(c)}</b>
                <small>${p ? `${p.icon} ${esc(p.name)} — ${esc(p.desc)}` : ''}</small>
                <small>${unlocked ? `Unlocked · ×${IMPRINT_STRENGTH[c.tier]} strength` : `Unlocks at CR ${CLASS.imprintAt[c.tier]} (now ${v.rank})`}</small></span>
                <button class="btn ${on ? '' : 'gold'}" data-imprint="${esc(c.id)}" ${can ? '' : 'disabled'}>${on ? 'Remove' : slots ? 'Slot' : 'No slot'}</button></div>`;
            })
            .join('')
        : '<p class="sub">Discover another class to imprint it.</p>'
    }`;
}

function codexTab(host: PanelHost, views: ClassView[]): string {
  const { book, reg } = host.ctrl;
  const undiscovered = views.filter((v) => !v.discovered && (!v.cls.hidden || book.state.whispered.includes(v.cls.id)));
  const near = undiscovered.filter((v) => v.codex === 'near').sort((a, b) => b.progress - a.progress);
  const whispered = undiscovered.filter((v) => v.codex === 'whispered').sort((a, b) => b.progress - a.progress);
  const unknown = undiscovered.filter((v) => v.codex === 'unknown');
  const known = views.filter((v) => v.discovered);
  const bars = (v: ClassView) =>
    [
      ...v.clauses.map((cl) => {
        const need = cl.clause.count;
        const have = Math.min(cl.have, need);
        return `<div class="clause"><small>${esc(cl.clause.tags.join(' + ') || 'any skill')}${v.cls.tier > 1 ? ' (rank 5)' : ''}</small>${pips(have, need, 'violet')}</div>`;
      }),
      ...(v.elements ? [`<div class="clause"><small>distinct elements</small>${pips(Math.min(v.elements.have, v.elements.need), v.elements.need, 'violet')}</div>`] : []),
      ...(v.parents ?? []).map((p) => `<div class="clause"><small>${esc(reg.classDef(p.id)?.name ?? p.id)} CR</small><b>${Math.min(p.have, p.need)}/${p.need}</b></div>`),
    ].join('') + (v.requires?.length ? reqList(v.requires) : '');
  const card = (v: ClassView) => {
    const c = v.cls;
    const isNear = v.codex === 'near';
    return `<div class="cls codex ${v.codex}"><span class="ico">${isNear ? c.icon : '❔'}</span><span>
      <b>${isNear ? esc(c.name) : '???'} ${tierBadge(c)}${c.hidden ? ' <span class="chip">hidden</span>' : ''}</b>
      <small class="riddle">“${esc(c.hint)}”</small>${isNear ? bars(v) : ''}
      <span class="bar mini"><i style="width:${Math.round(v.progress * 100)}%"></i></span></span></div>`;
  };
  const unknownByTier = [1, 2, 3]
    .map((t) => [t, unknown.filter((v) => v.cls.tier === t).length] as const)
    .filter(([, n]) => n > 0);
  return `<p class="sub">Undiscovered callings. Riddles appear as you near them — or when a trainer, a failed fusion, an echo or your bestiary whispers them.</p>
    ${near.length ? `<h3>✧ Near <small>${near.length}</small></h3><div class="classes">${near.map(card).join('')}</div>` : ''}
    ${whispered.length ? `<h3>💭 Whispered <small>${whispered.length}</small></h3><div class="classes">${whispered.map(card).join('')}</div>` : ''}
    <h3>❔ Unknown <small>${unknown.length}</small></h3>
    ${
      unknownByTier.length
        ? `<div class="unk">${unknownByTier.map(([t, n]) => `<div><span>${'❔'.repeat(Math.min(n, 8))}</span><small>${n} Tier ${TIER[t]} calling${n > 1 ? 's' : ''}</small></div>`).join('')}</div>`
        : '<p class="sub">Nothing left in the dark — except what hides deeper still.</p>'
    }
    <h3>🏛️ Known <small>${known.length}</small></h3>
    <div class="known-chips">${known.map((v) => `<button class="kchip" data-ctree="${esc(v.cls.id)}">${v.cls.icon} ${esc(v.cls.name)} <small>CR ${v.rank}</small></button>`).join('') || '<p class="sub">None yet.</p>'}</div>`;
}

// ==================================================================== entry

export function renderClasses(host: PanelHost, arg?: string): void {
  const { ctrl } = host;
  const { book, reg } = ctrl;
  const views = reg.classes.map((c) => book.classProgress(c));
  const discovered = views.filter((v) => v.discovered);
  let body: string;
  if (arg?.startsWith('tree:')) {
    const c = reg.classDef(arg.slice(5));
    if (!c || !book.state.classes[c.id]) return host.open('classes');
    body = `<button class="back">‹ Classes</button>${wornHeader(host, c, false)}<h3>${esc(c.name)} tree</h3>${treeHtml(host, c)}`;
    sheet(host, '🏛️ Classes', body, 'wide');
    $$(host.modal, '.back').forEach((b) => b.addEventListener('click', () => host.open('classes')));
  } else {
    const t = tab(host, 'classes.tab', 'worn');
    const near = views.filter((v) => !v.discovered && v.codex === 'near').length;
    body = tabsHtml(
      'classes.tab',
      [
        ['worn', 'Worn'],
        ['all', `Classes <small>${discovered.length}</small>`],
        ['imprints', `Imprints <small>${book.state.imprints.length}/${book.imprintSlots()}</small>`],
        ['codex', `Codex${near ? ` <small>✧${near}</small>` : ''}`],
      ],
      t,
    );
    body +=
      t === 'all' ? allTab(host, views) : t === 'imprints' ? imprintsTab(host, views) : t === 'codex' ? codexTab(host, views) : wornTab(host);
    body += `<p class="foot">${discovered.length} of ${reg.classes.length} classes discovered</p>`;
    sheet(host, '🏛️ Classes', body, t === 'worn' ? 'wide' : '');
    wireTabs(host, 'classes.tab');
  }
  const after = (r: { ok: boolean; message?: string }) => {
    if (r.message) host.toast(esc(r.message));
    host.render();
  };
  $$<HTMLButtonElement>(host.modal, '[data-wear]').forEach((b) => b.addEventListener('click', () => after(ctrl.wearClass(b.dataset.wear!))));
  $$<HTMLButtonElement>(host.modal, '[data-ctree]').forEach((b) => b.addEventListener('click', () => host.open('classes', `tree:${b.dataset.ctree}`)));
  $$<HTMLButtonElement>(host.modal, '[data-cnode]').forEach((b) =>
    b.addEventListener('click', () => {
      const cls = arg?.startsWith('tree:') ? arg.slice(5) : book.state.worn;
      host.state[`classes.node:${cls}`] = b.dataset.cnode;
      host.render();
    }),
  );
  $$<HTMLButtonElement>(host.modal, '[data-buy]').forEach((b) =>
    b.addEventListener('click', () => {
      const cls = arg?.startsWith('tree:') ? arg.slice(5) : book.state.worn;
      if (cls) after(ctrl.buyClassNode(cls, b.dataset.buy!));
    }),
  );
  $$<HTMLButtonElement>(host.modal, '[data-imprint]').forEach((b) =>
    b.addEventListener('click', () => {
      const id = b.dataset.imprint!;
      const cur = book.state.imprints;
      after(ctrl.setImprints(cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
    }),
  );
  $$<HTMLButtonElement>(host.modal, '[data-unslot]').forEach((b) =>
    b.addEventListener('click', () => after(ctrl.setImprints(book.state.imprints.filter((x) => x !== b.dataset.unslot)))),
  );
  $$<HTMLButtonElement>(host.modal, '[data-respec]').forEach((b) =>
    armTwice(b, 'Tap again to refund every point', () => after(ctrl.respecClass(b.dataset.respec!))),
  );
}
