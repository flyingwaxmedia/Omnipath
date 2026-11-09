// Class screen (panels lane; docs/UX-SIMPLE.md §3, docs/SPEC-v2.md §5.1, docs/CLIENT-v3.md §6). Built from
// ctrl.classCards(): your current class on top (outfit preview, name, one line, Class Level bar, the skills it puts
// in your class slots, "Change class"); the classes you unlocked as big cards with ONE "Become" button (one tap: you
// become it and its skills fill the class slots — the banner comes from announce.ts); the classes still to find as
// silhouettes with ONE hint line. No pattern math, no tiers, no tree internals here. Keepsakes appear only after the
// first Class Level 5 (ctrl.unlocks().keepsakes); Perks (the class tree) sit behind a small button.
// Panel 'classes', arg: a class id to focus (Pursuits), or 'tree:<classId>' (that class's Perks).
import { canBuyNode, classPoints, imprintUnlocked, spentPoints } from '../../core/classes';
import type { ClassDef, ClassNode } from '../../core/types';
import type { ClassCardView, ClassScreenView, GameController } from '../controller';
import { $$, esc } from '../util';
import { FRIENDLY, classLevel, effectLine, oneLine, plural, stars } from '../words';
import { type PanelHost, armTwice, iconHtml, wireToggles } from './common';
import { sheet } from './skills';

/** Outfit previews are 40×48 art; shown at whole multiples so the pixels stay crisp. */
function outfitImg(ctrl: GameController, id: string | null, scale: number, cls = ''): string {
  let src = '';
  try {
    src = ctrl.outfitUrl(id);
  } catch {
    src = '';
  }
  return src
    ? `<img class="px outfit ${cls}" src="${src}" width="${40 * scale}" height="${48 * scale}" alt="" draggable="false">`
    : `<span class="outfit none ${cls}" style="width:${40 * scale}px;height:${48 * scale}px"></span>`;
}

function levelBar(c: Pick<ClassCardView, 'level' | 'maxLevel' | 'levelProgress'>): string {
  const pct = c.level >= c.maxLevel ? 100 : Math.round(c.levelProgress * 100);
  return `<div class="clv"><span>${classLevel(c.level, c.maxLevel)}</span><span class="bar mini over"><i style="width:${pct}%"></i></span></div>`;
}

function skillIcons(ctrl: GameController, ids: string[], size = 32): string {
  if (!ids.length) return '';
  return `<div class="cskills" aria-label="Class skills">${ids
    .map((id) => `<span class="csk" title="${esc(ctrl.reg.skill(id)?.name ?? '')}">${iconHtml(ctrl.iconUrl('skill', id), ctrl.reg.skill(id)?.icon ?? '', size)}</span>`)
    .join('')}</div>`;
}

/** Points to spend in a class's Perks (0 when it has no tree). */
function perkPoints(ctrl: GameController, id: string): number {
  const cls = ctrl.reg.classDef(id);
  const prog = ctrl.book.state.classes[id];
  return cls?.tree?.length && prog ? classPoints(cls, prog) : 0;
}

// ==================================================================== the screen

function currentHtml(host: PanelHost, v: ClassScreenView): string {
  const { ctrl } = host;
  const c = v.current;
  if (!c) {
    return `<section class="ccur none">
      <div class="ccur-art">${outfitImg(ctrl, null, 3)}</div>
      <div class="ccur-info"><small class="kick">Your class</small><div class="cname">${FRIENDLY.noClass}</div>
        <p class="cline">${v.unlocked.length ? 'Pick a class below to become it.' : 'Use skills of one kind and a class will find you.'}</p></div>
    </section>`;
  }
  const others = v.unlocked.length;
  const pts = perkPoints(ctrl, c.id);
  const hasTree = !!ctrl.reg.classDef(c.id)?.tree?.length;
  return `<section class="ccur" style="--cc:${c.color}">
    <div class="ccur-art">${outfitImg(ctrl, c.id, 3)}</div>
    <div class="ccur-info"><small class="kick">Your class</small><div class="cname">${iconHtml(ctrl.iconUrl('cls', c.id), '', 24)}${esc(c.name)}</div>
      <p class="cline">${esc(oneLine(c.line))}</p>
      ${levelBar(c)}
      ${skillIcons(ctrl, c.skills)}
      <div class="cbtns"><button class="btn" data-change ${others ? '' : 'aria-disabled="true"'}>${FRIENDLY.changeClass}</button>${
        hasTree ? `<button class="btn small" data-perks="${esc(c.id)}">${FRIENDLY.classTree}${pts ? ` <i class="gdot" aria-label="${plural(pts, FRIENDLY.classPoint)}"></i>` : ''}</button>` : ''
      }</div></div>
  </section>`;
}

function unlockedHtml(host: PanelHost, v: ClassScreenView, focus?: string): string {
  const { ctrl } = host;
  if (!v.unlocked.length) return '';
  const cards = v.unlocked
    .map(
      (c) => `<div class="ccard3 ${c.id === focus ? 'focus' : ''}" data-class="${esc(c.id)}" style="--cc:${c.color}">
        <div class="cc-art">${outfitImg(ctrl, c.id, 2)}</div>
        <div class="cc-info"><b>${esc(c.name)}</b><small>${esc(oneLine(c.line))}</small>${levelBar(c)}${skillIcons(ctrl, c.skills, 24)}</div>
        <button class="btn gold become" data-become="${esc(c.id)}" ${v.canChange ? '' : 'disabled'}>${FRIENDLY.becomeClass}</button>
      </div>`,
    )
    .join('');
  return `<h3 id="cls-yours">Your classes</h3>
    ${v.canChange ? '' : `<p class="sub warn">${esc(v.changeHint ?? 'You can change class later.')}</p>`}
    <div class="ccards3">${cards}</div>
    ${v.current ? `<button class="btn small ghost noclass" data-noclass>${FRIENDLY.noClass}</button>` : ''}`;
}

function lockedHtml(host: PanelHost, v: ClassScreenView, focus?: string): string {
  const { ctrl } = host;
  const total = ctrl.reg.classes.filter((c) => !c.hidden).length;
  const shown = v.unlocked.length + v.locked.length + (v.current ? 1 : 0);
  const hidden = Math.max(0, total - shown);
  if (!v.locked.length && !hidden) return '';
  const card = (c: ClassCardView) => {
    // Until a class is close, its hint is its riddle: keep the name a mystery too.
    const riddle = c.hint !== undefined && c.hint === ctrl.reg.classDef(c.id)?.hint;
    return `<div class="lcard ${riddle ? 'riddle' : 'near'} ${c.id === focus ? 'focus' : ''}" data-class="${esc(c.id)}" style="--cc:${c.color}">
      <div class="lc-art">${outfitImg(ctrl, c.id, 2, 'sil')}<span class="q" aria-hidden="true">?</span></div>
      <div class="lc-info"><b>${riddle ? '???' : esc(c.name)}</b><small class="${riddle ? 'riddle' : ''}">${esc(c.hint ?? '')}</small></div>
    </div>`;
  };
  return `<h3>Still to find</h3>
    <div class="clocked">${v.locked.map(card).join('')}</div>
    ${hidden ? `<p class="sub more-cls">${plural(hidden, 'more class', 'more classes')} hidden in the world.</p>` : ''}`;
}

function keepsakesHtml(host: PanelHost): string {
  const { ctrl } = host;
  const { book, reg } = ctrl;
  const slots = book.imprintSlots();
  if (!slots) return '';
  const cur = book.state.imprints.slice(0, slots);
  const slotHtml = Array.from({ length: slots }, (_, i) => {
    const c = cur[i] ? reg.classDef(cur[i]) : undefined;
    const p = c?.imprint ? reg.passive(c.imprint) : undefined;
    return c
      ? `<button class="kslot on" data-unkeep="${esc(c.id)}" aria-label="Remove ${esc(c.name)} keepsake">${iconHtml(ctrl.iconUrl('cls', c.id), c.icon, 32)}<b>${esc(c.name)}</b><small>${p ? esc(effectLine(p.desc)) : ''}</small><i class="rm">✕</i></button>`
      : `<div class="kslot empty"><span class="ico">◇</span><small>Empty</small></div>`;
  }).join('');
  const cands = reg.classes.filter((c) => {
    const prog = book.state.classes[c.id];
    return prog && c.id !== book.state.worn && imprintUnlocked(c, prog) && !cur.includes(c.id);
  });
  const full = cur.length >= slots;
  return `<h3>Keepsakes <small>${cur.length}/${slots}</small></h3>
    <p class="sub">Keep one bonus from a class you are not wearing.</p>
    <div class="kslots">${slotHtml}</div>
    ${
      cands.length
        ? `<div class="kcands">${cands
            .map((c) => {
              const p = c.imprint ? reg.passive(c.imprint) : undefined;
              return `<div class="kcand">${iconHtml(ctrl.iconUrl('cls', c.id), c.icon, 32)}<span><b>${esc(c.name)}</b><small>${p ? esc(effectLine(p.desc)) : ''}</small></span>
                <button class="btn small" data-keep="${esc(c.id)}" ${full ? 'disabled' : ''}>${full ? 'Full' : 'Keep'}</button></div>`;
            })
            .join('')}</div>`
        : ''
    }`;
}

// ==================================================================== perks (the class tree, behind a button)

function nodeRef(ctrl: GameController, n: ClassNode): { name: string; line: string; img: string } {
  const { reg } = ctrl;
  const p = reg.passive(n.ref);
  const s = p ? undefined : reg.skill(n.ref);
  return {
    name: p?.name ?? s?.name ?? '?',
    line: p ? effectLine(p.desc) : oneLine(s?.desc ?? ''),
    img: iconHtml(ctrl.iconUrl(p ? 'passive' : 'skill', n.ref), p?.icon ?? s?.icon ?? '◆', 32),
  };
}

/** The ONE next step for a perk that cannot be learned now. */
function perkStep(ctrl: GameController, c: ClassDef, n: ClassNode): string {
  const prog = ctrl.book.state.classes[c.id]!;
  const have = prog.spent[n.id] ?? 0;
  if (have >= n.maxRank) return 'Fully learned.';
  const req = (n.requires ?? []).find((q) => (prog.spent[q.node] ?? 0) < q.rank);
  if (req) {
    const other = c.tree!.find((x) => x.id === req.node);
    return `Learn ${other ? nodeRef(ctrl, other).name : 'the perk above'} first.`;
  }
  const spent = spentPoints(c, prog);
  if (n.minSpent !== undefined && spent < n.minSpent) return `Spend ${plural(n.minSpent - spent, 'more point', 'more points')} to open.`;
  return 'Gain a Class Level for another point.';
}

function perksHtml(host: PanelHost, c: ClassDef): string {
  const { ctrl } = host;
  const prog = ctrl.book.state.classes[c.id];
  if (!prog || !c.tree?.length) return '<p class="sub">This class has no perks.</p>';
  const key = `classes.perk:${c.id}`;
  const points = classPoints(c, prog);
  const spent = spentPoints(c, prog);
  let sel = host.state[key] as string | undefined;
  if (!sel || !c.tree.some((n) => n.id === sel)) sel = (c.tree.find((n) => canBuyNode(c, prog, n.id).ok) ?? c.tree[0]).id;
  const groups = new Map<number, ClassNode[]>();
  for (const n of c.tree) groups.set(n.minSpent ?? 0, [...(groups.get(n.minSpent ?? 0) ?? []), n]);
  const rows = [...groups.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([gate, nodes]) => {
      const open = spent >= gate;
      return `${gate ? `<div class="pgate ${open ? 'open' : ''}">${open ? '◆' : '🔒'} ${open ? 'Open' : `Spend ${gate} points to open`}</div>` : ''}
        <div class="prow">${nodes
          .map((n) => {
            const have = prog.spent[n.id] ?? 0;
            const r = nodeRef(ctrl, n);
            const can = canBuyNode(c, prog, n.id).ok;
            return `<button class="perk ${have >= n.maxRank ? 'max' : have ? 'part' : can ? 'can' : 'off'} ${n.id === sel ? 'sel' : ''}" data-perk="${esc(n.id)}">
              ${r.img}<small>${esc(r.name)}</small><span class="pst">${stars(have, n.maxRank)}</span></button>`;
          })
          .join('')}</div>`;
    })
    .join('');
  const n = c.tree.find((x) => x.id === sel)!;
  const r = nodeRef(ctrl, n);
  const have = prog.spent[n.id] ?? 0;
  const can = canBuyNode(c, prog, n.id).ok;
  const safe = ctrl.isSafe();
  return `<div class="perks-top"><b class="pts">${points}</b> ${points === 1 ? FRIENDLY.classPoint : `${FRIENDLY.classPoint}s`} to spend <small>· one per Class Level</small></div>
    <div class="perks-split">
      <div class="perks">${rows}</div>
      <div class="perk-card">
        <div class="pc-head">${r.img}<div><b>${esc(r.name)}</b><span class="pst">${stars(have, n.maxRank)}</span></div></div>
        <p>${esc(r.line)}</p>
        ${can ? `<button class="btn gold wide" data-buyperk="${esc(n.id)}">Learn · ${plural(n.cost, 'point')}</button>` : `<p class="step">${esc(perkStep(ctrl, c, n))}</p>`}
        ${ctrl.book.state.worn === c.id ? '' : `<p class="sub">Perks work while you are ${esc(c.name)}.</p>`}
      </div>
    </div>
    ${spent ? `<button class="btn small ghost respec" data-respec="${esc(c.id)}" ${safe ? '' : 'disabled'}>Reset perks${safe ? '' : ' · in town'}</button>` : ''}`;
}

// ==================================================================== entry

export function renderClasses(host: PanelHost, arg?: string): void {
  const { ctrl } = host;
  if (arg?.startsWith('tree:')) {
    const c = ctrl.reg.classDef(arg.slice(5));
    if (!c || !ctrl.book.state.classes[c.id]) return host.open('classes');
    sheet(host, `🏛️ ${esc(c.name)} · ${FRIENDLY.classTree}`, `<button class="back">‹ Classes</button>${perksHtml(host, c)}`, 'classes3');
  } else {
    const v = ctrl.classCards();
    const focus = arg || undefined;
    const keep = ctrl.unlocks().keepsakes ? keepsakesHtml(host) : '';
    sheet(host, '🏛️ Class', `<div class="cls3">${currentHtml(host, v)}${unlockedHtml(host, v, focus)}${lockedHtml(host, v, focus)}${keep}</div>`, 'classes3');
    if (focus) host.modal.querySelector(`[data-class="${CSS.escape(focus)}"]`)?.scrollIntoView({ block: 'center' });
  }
  wireToggles(host.modal);
  const after = (r: { ok: boolean; message?: string }) => {
    if (r.message) host.toast(esc(r.message));
    host.render();
  };
  const failOnly = (r: { ok: boolean; message?: string }) => after(r.ok ? { ok: true } : r);
  $$(host.modal, '.back').forEach((b) => b.addEventListener('click', () => host.open('classes')));
  $$<HTMLButtonElement>(host.modal, '[data-become]').forEach((b) =>
    b.addEventListener('click', () => {
      const r = ctrl.becomeClass(b.dataset.become!);
      if (r.ok) host.close(); // the headline + outfit change + filled class slots are the feedback
      else if (r.message) host.toast(esc(r.message));
    }),
  );
  $$<HTMLButtonElement>(host.modal, '[data-noclass]').forEach((b) =>
    armTwice(b, 'Tap again: no class', () => {
      const r = ctrl.becomeClass(null);
      if (!r.ok && r.message) host.toast(esc(r.message));
      host.render();
    }),
  );
  $$<HTMLButtonElement>(host.modal, '[data-change]').forEach((b) =>
    b.addEventListener('click', () => {
      const list = host.modal.querySelector<HTMLElement>('.ccards3');
      if (!list) {
        host.toast('Find another class first.');
        return;
      }
      host.modal.querySelector('#cls-yours')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
      list.classList.remove('flash');
      void list.offsetWidth;
      list.classList.add('flash');
    }),
  );
  $$<HTMLButtonElement>(host.modal, '[data-perks]').forEach((b) => b.addEventListener('click', () => host.open('classes', `tree:${b.dataset.perks}`)));
  $$<HTMLButtonElement>(host.modal, '[data-perk]').forEach((b) =>
    b.addEventListener('click', () => {
      host.state[`classes.perk:${arg!.slice(5)}`] = b.dataset.perk;
      host.render();
    }),
  );
  $$<HTMLButtonElement>(host.modal, '[data-buyperk]').forEach((b) =>
    b.addEventListener('click', () => {
      const r = ctrl.buyClassNode(arg!.slice(5), b.dataset.buyperk!);
      if (!r.ok && r.message) host.toast(esc(r.message));
      host.render();
    }),
  );
  $$<HTMLButtonElement>(host.modal, '[data-respec]').forEach((b) =>
    armTwice(b, 'Tap again to reset', () => {
      const r = ctrl.respecClass(b.dataset.respec!);
      after(r.ok ? { ok: true, message: 'Perks reset.' } : r);
    }),
  );
  $$<HTMLButtonElement>(host.modal, '[data-keep]').forEach((b) =>
    b.addEventListener('click', () => failOnly(ctrl.setImprints([...ctrl.book.state.imprints, b.dataset.keep!]))),
  );
  $$<HTMLButtonElement>(host.modal, '[data-unkeep]').forEach((b) =>
    b.addEventListener('click', () => failOnly(ctrl.setImprints(ctrl.book.state.imprints.filter((x) => x !== b.dataset.unkeep)))),
  );
}
