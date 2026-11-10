// Class screen (panels lane; docs/UX-SIMPLE.md §3, docs/SPEC-v4.md §3.2, §3.4, §12). Built from ctrl.classCards():
// your current class on top (outfit, rarity, "Sword · Fire", one line, Class Level bar, the NEXT reward as one line,
// its five class skills with the level that opens each, its Gift, "Change class"); the classes you unlocked as cards
// with ONE "Become" button (one tap: you become it, the game equips its weapon — the card says so in one short line
// when that swaps your weapon — and its skills fill the class slots); the classes still to find as silhouettes in
// their rarity colour with ONE hint line. Rarity is always the same tag: colour + word + pips. No tree, no points:
// Class Levels give fixed rewards. Keepsakes appear only after the first Class Level 5 (ctrl.unlocks().keepsakes).
// Panel 'classes', arg: a class id to focus (Pursuits).
import { imprintUnlocked, mastered } from '../../core/classes';
import type { ClassDef } from '../../core/types';
import { becomeSwapLine, kitRows, nextRewardLine, rarityOf } from '../classinfo';
import type { ClassCardView, ClassScreenView, GameController } from '../controller';
import { $$, esc } from '../util';
import { FRIENDLY, classKindLine, classLevel, effectLine, oneLine, plural, rarityHtml } from '../words';
import { type PanelHost, armTwice, detailsHtml, iconHtml, wireToggles } from './common';
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

/** "Sword · Fire": the weapon and element of a class in plain words ('' for classes without them). */
function kindLine(ctrl: GameController, cls: ClassDef | undefined): string {
  if (!cls) return '';
  return classKindLine(cls.weapon, cls.source, (id) => ctrl.reg.element(id as never)?.name);
}

/** The five class skills, each with the Class Level that opens it (tap → that skill's card). */
function kitHtml(ctrl: GameController, cls: ClassDef | undefined, c: ClassCardView, size: 24 | 32, names: boolean): string {
  const rows = cls ? kitRows(ctrl.reg, cls, Math.max(1, c.level)) : [];
  if (!rows.length) return skillIcons(ctrl, c.skills, size);
  return `<div class="ckit ${names ? 'named' : ''}" aria-label="${FRIENDLY.classSkills}">${rows
    .map(
      (r) => `<button class="ckit-s ${r.open ? '' : 'later'}" data-skillcard="${esc(r.id)}" aria-label="${esc(r.name)}${r.open ? '' : `, ${FRIENDLY.classRank} ${r.at}`}">
        <span class="ck-i">${iconHtml(ctrl.iconUrl('skill', r.id), ctrl.reg.skill(r.id)?.icon ?? '', size)}</span>${names ? `<small class="ck-n">${esc(r.name)}</small>` : ''}${
          r.open ? '' : `<em class="ck-lv">Lv <span class="num">${r.at}</span></em>`
        }</button>`,
    )
    .join('')}</div>`;
}

/** ATK · MATK · DEF (moved here from the HUD; closed by default). */
function statsDetails(ctrl: GameController): string {
  try {
    const st = ctrl.stats();
    const n = (v: number) => Math.round(v);
    return detailsHtml(`<small class="cstats">ATK ${n(st.atk)} · MATK ${n(st.matk)} · DEF ${n(st.def)} · HP ${n(st.maxHp)} · SP ${n(st.maxSp)}</small>`, 'Your stats');
  } catch {
    return '';
  }
}

// ==================================================================== the screen

function currentHtml(host: PanelHost, v: ClassScreenView): string {
  const { ctrl } = host;
  const c = v.current;
  if (!c) {
    return `<section class="ccur none">
      <div class="ccur-art">${outfitImg(ctrl, null, 3)}</div>
      <div class="ccur-info"><small class="kick">Your class</small><div class="cname">${FRIENDLY.noClass}</div>
        <p class="cline">${v.unlocked.length ? 'Pick a class below to become it.' : 'Fight with your weapon and a class will find you.'}</p>${statsDetails(ctrl)}</div>
    </section>`;
  }
  const cls = ctrl.reg.classDef(c.id);
  const others = v.unlocked.length;
  const done = mastered(cls, { rank: c.level });
  const next = cls ? nextRewardLine(ctrl.reg, cls, c.level) : null;
  const gift = cls?.passive ? ctrl.reg.passive(cls.passive) : undefined;
  const kind = kindLine(ctrl, cls);
  return `<section class="ccur ${done ? 'mastered' : ''}" style="--cc:${c.color}">
    <div class="ccur-art">${outfitImg(ctrl, c.id, 3)}</div>
    <div class="ccur-info"><small class="kick">Your class</small><div class="cname">${iconHtml(ctrl.iconUrl('cls', c.id), '', 24)}${esc(c.name)}</div>
      <div class="ctags">${rarityHtml(rarityOf(ctrl.reg, c.id))}${kind ? `<span class="ckind">${esc(kind)}</span>` : ''}</div>
      <p class="cline">${esc(oneLine(c.line))}</p>
      ${levelBar(c)}
      ${next ? `<p class="cnext"><b>Next</b> ${esc(next)}</p>` : `<p class="cnext done">★ ${FRIENDLY.mastered}</p>`}
      ${kitHtml(ctrl, cls, c, 32, true)}
      ${gift ? `<p class="cgift"><b>${FRIENDLY.gift}</b> ${esc(gift.name)} — ${esc(effectLine(gift.desc))}</p>` : ''}
      <div class="cbtns"><button class="btn" data-change ${others ? '' : 'aria-disabled="true"'}>${FRIENDLY.changeClass}</button></div>
      ${statsDetails(ctrl)}</div>
  </section>`;
}

function unlockedHtml(host: PanelHost, v: ClassScreenView, focus?: string): string {
  const { ctrl } = host;
  if (!v.unlocked.length) return '';
  const p = ctrl.session.player;
  const cards = v.unlocked
    .map((c) => {
      const cls = ctrl.reg.classDef(c.id);
      const kind = kindLine(ctrl, cls);
      const swap = cls ? becomeSwapLine(cls, p) : null;
      const done = mastered(cls, { rank: c.level });
      return `<div class="ccard3 ${c.id === focus ? 'focus' : ''} ${done ? 'mastered' : ''}" data-class="${esc(c.id)}" style="--cc:${c.color}">
        <div class="cc-art">${outfitImg(ctrl, c.id, 2)}</div>
        <div class="cc-info"><b>${esc(c.name)}</b><div class="ctags">${rarityHtml(rarityOf(ctrl.reg, c.id))}${kind ? `<span class="ckind">${esc(kind)}</span>` : ''}</div>
          <small>${esc(oneLine(c.line))}</small>${levelBar(c)}${kitHtml(ctrl, cls, c, 24, false)}</div>
        <div class="cc-act"><button class="btn gold become" data-become="${esc(c.id)}" ${v.canChange ? '' : 'disabled'}>${FRIENDLY.becomeClass}</button>${
          swap ? `<small class="cswap ${swap.missing ? 'missing' : ''}">${esc(swap.line)}</small>` : ''
        }</div>
      </div>`;
    })
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
    // Until a class is close its name stays a mystery; the line is always its ONE next step (the riddle itself is in
    // Codex > Whispers). An older view without `mystery`: a hint equal to the riddle reads as one.
    const isRiddle = c.hint !== undefined && c.hint === ctrl.reg.classDef(c.id)?.hint;
    const mystery = c.mystery ?? isRiddle;
    const r = rarityOf(ctrl.reg, c.id);
    return `<div class="lcard rar-${r} ${mystery ? 'riddle' : 'near'} ${c.id === focus ? 'focus' : ''}" data-class="${esc(c.id)}">
      <div class="lc-art">${outfitImg(ctrl, c.id, 2, 'sil')}<span class="q" aria-hidden="true">?</span></div>
      <div class="lc-info"><b>${mystery ? '???' : esc(c.name)}</b>${rarityHtml(r)}<small class="${isRiddle ? 'riddle' : ''}">${esc(oneLine(c.hint ?? ''))}</small></div>
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

// ==================================================================== entry

export function renderClasses(host: PanelHost, arg?: string): void {
  const { ctrl } = host;
  // (An old 'tree:<classId>' link opens the screen on that class: the class tree is gone.)
  const focus = (arg?.startsWith('tree:') ? arg.slice(5) : arg) || undefined;
  const v = ctrl.classCards();
  const keep = ctrl.unlocks().keepsakes ? keepsakesHtml(host) : '';
  sheet(host, '🏛️ Class', `<div class="cls3">${currentHtml(host, v)}${unlockedHtml(host, v, focus)}${lockedHtml(host, v, focus)}${keep}</div>`, 'classes3');
  if (focus) host.modal.querySelector(`[data-class="${CSS.escape(focus)}"]`)?.scrollIntoView({ block: 'center' });
  // "Finish the fight first." ends by itself: while this screen stays open, look again every second and unlock
  // Become as soon as the fight is over (a re-render or closing replaces .cls3 and stops the loop).
  const root = host.modal.querySelector('.cls3');
  const recheck = () => {
    if (!root?.isConnected) return;
    if (ctrl.classCards().canChange) host.render();
    else setTimeout(recheck, 1000);
  };
  if (!v.canChange && root) setTimeout(recheck, 1000);
  wireToggles(host.modal);
  const after = (r: { ok: boolean; message?: string }) => {
    if (r.message) host.toast(esc(r.message));
    host.render();
  };
  const failOnly = (r: { ok: boolean; message?: string }) => after(r.ok ? { ok: true } : r);
  $$<HTMLButtonElement>(host.modal, '[data-become]').forEach((b) =>
    b.addEventListener('click', () => {
      const r = ctrl.becomeClass(b.dataset.become!);
      if (r.ok) host.close(); // the headline + outfit change + filled class slots are the feedback
      else if (r.message) host.toast(esc(r.message));
    }),
  );
  $$<HTMLButtonElement>(host.modal, '[data-skillcard]').forEach((b) => b.addEventListener('click', () => host.open('skill', b.dataset.skillcard!)));
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
  $$<HTMLButtonElement>(host.modal, '[data-keep]').forEach((b) =>
    b.addEventListener('click', () => failOnly(ctrl.setImprints([...ctrl.book.state.imprints, b.dataset.keep!]))),
  );
  $$<HTMLButtonElement>(host.modal, '[data-unkeep]').forEach((b) =>
    b.addEventListener('click', () => failOnly(ctrl.setImprints(ctrl.book.state.imprints.filter((x) => x !== b.dataset.unkeep)))),
  );
}
