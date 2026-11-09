// Fusion panel (docs/CLIENT-v2.md §7): only usable at an altar (else explains where altars are). Tabs Elements |
// Skills | Essences, two sockets, remembered-pair memory, result card and whispers. Functional port.
import type { IngredientEntry } from '../../core/skillbook';
import { fusionMinRank } from '../../core/mastery';
import { parseRef } from '../../core/refs';
import { $, $$, esc } from '../util';
import { type PanelHost, tab, tabsHtml, wireTabs } from './common';

const ALTARS = 'Altars stand in <b>Hearthvale</b>, at the <b>Emberwatch</b> outpost and in <b>Riftmarch</b>.';

function slots(host: PanelHost): (string | null)[] {
  let s = host.state['altar.slots'] as (string | null)[] | undefined;
  if (!s) host.state['altar.slots'] = s = [null, null];
  return s;
}

export function renderAltar(host: PanelHost): void {
  const { ctrl } = host;
  const { book, reg } = ctrl;
  const at = ctrl.atAltar();
  const fuseSlots = slots(host);
  const [a, b] = fuseSlots;
  const ings = book.ingredients();
  const t = tab(host, 'altar.tab', 'skills');
  const slotHtml = (ref: string | null, i: number) =>
    ref
      ? `<button class="fslot full" data-fslot="${i}"><span class="ico">${reg.refIcon(ref)}</span><small>${esc(reg.refName(ref))}</small></button>`
      : `<button class="fslot" data-fslot="${i}"><span class="ico">?</span><small>Empty</small></button>`;
  let memory = '<span class="mem">Place two ingredients on the altar.</span>';
  if (a && b) {
    const r = book.rememberedPair(a, b);
    memory =
      r === 'discovered'
        ? '<span class="mem good">You have made something from this before.</span>'
        : r === 'nothing'
          ? '<span class="mem bad">You tried this. Nothing happened.</span>'
          : '<span class="mem">An untried combination...</span>';
  }
  const list = (entries: IngredientEntry[]) =>
    entries
      .map((i) => {
        const p = parseRef(i.ref);
        const s = p.kind === 'skill' ? reg.skill(p.id) : undefined;
        const inUse = fuseSlots.includes(i.ref);
        const badge = s
          ? `<span class="rk">${i.ready ? 'R' + book.rank(s.id) : '🔒R' + fusionMinRank(s.maxRank)}</span>`
          : i.count !== undefined
            ? `<span class="rk">×${i.count}</span>`
            : '';
        return `<button class="ing ${i.ready ? '' : 'locked'} ${inUse ? 'inuse' : ''}" data-ref="${esc(i.ref)}" title="${esc(i.message ?? i.name)}">
          <span class="ico">${i.icon}</span><small>${esc(i.name)}</small>${badge}</button>`;
      })
      .join('');
  const empty: Record<string, string> = {
    elements: 'No elements attuned yet. Elements are found by doing things: forging, fishing, mining, meditating, hunting wardens.',
    skills: 'No skills yet.',
    essences: 'No essences held. Monsters drop the essence of what they do; trainers sell some.',
  };
  const entries = t === 'elements' ? ings.elements : t === 'essences' ? ings.essences : ings.skills;
  const hints = book.state.hints.slice(-3).reverse();
  const stats = book.stats();
  const body = `
    ${at ? '' : `<p class="warn">⚗️ Fusion only takes at an altar. ${ALTARS} You can plan here, but not fuse.</p>`}
    <p class="sub">Combine two ingredients — a skill and an element, a skill and an essence, two skills, or two elements.
    Skills must reach rank 5 first. Ingredients are never consumed, except essences on success.</p>
    <div class="altar">
      ${slotHtml(a, 0)}<span class="plus">+</span>${slotHtml(b, 1)}
      <button class="btn gold fuse" ${a && b && at ? '' : 'disabled'}>Fuse</button>
    </div>
    <div class="memory">${memory}</div>
    <div class="fuse-result">${(host.state['altar.result'] as string | undefined) ?? ''}</div>
    ${tabsHtml(
      'altar.tab',
      [
        ['skills', `Skills (${ings.skills.length})`],
        ['elements', `Elements (${ings.elements.length})`],
        ['essences', `Essences (${ings.essences.length})`],
      ],
      t,
    )}
    ${entries.length ? `<div class="ings">${list(entries)}</div>` : `<p class="sub">${empty[t]}</p>`}
    ${hints.length ? `<h3>Whispers</h3>${hints.map((h) => `<p class="whisper">“${esc(h)}”</p>`).join('')}` : ''}
    <p class="foot">${stats.discoveries} discoveries from ${stats.experiments} experiments</p>`;
  host.sheet('⚗️ Fusion Altar', body, 'fusion');
  host.state['altar.result'] = '';
  wireTabs(host, 'altar.tab');
  $$<HTMLButtonElement>(host.modal, '[data-fslot]').forEach((btn) =>
    btn.addEventListener('click', () => {
      fuseSlots[Number(btn.dataset.fslot)] = null;
      host.render();
    }),
  );
  $$<HTMLButtonElement>(host.modal, '.ing').forEach((btn) =>
    btn.addEventListener('click', () => {
      const ref = btn.dataset.ref!;
      if (btn.classList.contains('locked')) {
        host.toast(esc(btn.title));
        return;
      }
      const i = fuseSlots.indexOf(ref);
      if (i >= 0) fuseSlots[i] = null;
      else {
        const e = fuseSlots.indexOf(null);
        fuseSlots[e >= 0 ? e : 1] = ref;
      }
      host.render();
    }),
  );
  $(host.modal, '.fuse').addEventListener('click', () => {
    if (!a || !b) return;
    $(host.modal, '.altar').classList.add('fusing');
    setTimeout(() => {
      const res = ctrl.fuse(a, b);
      fuseSlots[0] = fuseSlots[1] = null;
      host.state['altar.result'] = res.ok
        ? `<div class="result good"><span class="ico">${reg.refIcon(res.result)}</span>
            <span><b>${esc(res.name)}</b><small>${res.isNew ? `New ${res.kind === 'authored' ? 'discovery' : res.kind === 'merge' ? 'shape fusion' : 'infusion'}!` : 'Already known.'}${res.consumed ? ` · used 1 ${esc(reg.essence(res.consumed)?.name ?? res.consumed)}` : ''}</small></span></div>`
        : `<div class="result bad"><span>${esc(res.message)}</span>${res.hint ? `<small class="whisper">“${esc(res.hint)}”</small>` : ''}</div>`;
      host.render();
    }, 650);
  });
}
