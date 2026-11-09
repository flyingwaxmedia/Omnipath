// Skills panel (docs/CLIENT-v2.md §7): tabs Skills | Passives | Essences, plus the per-skill detail view with
// morph options (tier, requirement checklist, spark info), essence slots and hotbar assignment.
// Functional port — the panels stage polishes it (morph tree view per weapon, essence slot art).
import { fusionMinRank } from '../../core/mastery';
import { TAG_PASSIVE_TAGS, tagPassiveRank, tagPassiveTotalFor, tagTotals } from '../../core/passives';
import type { SkillDef } from '../../core/types';
import { WEAPONS } from '../../data/weapons';
import { HOTBAR_SIZE } from '../../game/session';
import { $, $$, esc, hex, shapeText, sourceText } from '../util';
import { type PanelHost, reqList, tab, tabsHtml, wireTabs } from './common';

const BASICS = new Set(Object.values(WEAPONS).map((w) => w.basic));

function group(host: PanelHost, s: SkillDef): string {
  const src = host.ctrl.book.progress(s.id)?.source ?? '';
  if (BASICS.has(s.id) || s.tier === 0) return 'Weapon Arts';
  if (src.startsWith('class:')) return 'Class Signatures';
  if (s.mergedFrom) return 'Shape Fusions';
  if (s.tags.includes('echo')) return 'Echoes';
  if (src.startsWith('lesson:')) return 'Techniques';
  if (s.weapons?.length === 1) return `${WEAPONS[s.weapons[0]].name.split(' ').pop()} Forms`;
  return 'Other Forms';
}

function card(host: PanelHost, s: SkillDef, variant = false): string {
  const book = host.ctrl.book;
  const p = book.progress(s.id)!;
  const max = p.rank >= s.maxRank;
  const pct = (100 * p.xp) / book.barSize(s.id);
  const el = s.element ? host.ctrl.reg.element(s.element) : undefined;
  const morph = book.canMorph(s.id);
  const usable = host.ctrl.usable(s.id).ok;
  return `<button class="skill-card ${variant ? 'variant' : ''} ${max ? 'maxed' : ''} ${morph ? 'can-morph' : ''} ${usable ? '' : 'unusable'}" data-skill="${esc(s.id)}">
    <span class="ico">${s.icon}</span>
    <span class="meta">
      <b>${esc(s.name)}</b>${el ? ` <span class="chip el" style="--c:${hex(el.color)}">${el.icon} ${el.name}</span>` : ''}
      <span class="rank">${max ? `★ Mastered${p.charges ? ` · <em>${p.charges} morph${p.charges > 1 ? 's' : ''} ready</em>` : ''}` : `Rank ${p.rank} / ${s.maxRank}`}</span>
      <span class="bar mini ${max ? 'over' : ''}"><i style="width:${pct}%"></i></span>
    </span>
  </button>`;
}

function skillsTab(host: PanelHost): string {
  const { book } = host.ctrl;
  const known = book.known();
  const variants = new Map<string, SkillDef[]>();
  const roots: SkillDef[] = [];
  for (const s of known) {
    if (s.generated && s.baseId && book.has(s.baseId) && !s.mergedFrom) {
      const list = variants.get(s.baseId) ?? [];
      list.push(s);
      variants.set(s.baseId, list);
    } else roots.push(s);
  }
  const groups = new Map<string, SkillDef[]>();
  for (const s of roots) {
    const g = group(host, s);
    groups.set(g, [...(groups.get(g) ?? []), s]);
  }
  const order = ['Weapon Arts', 'Sword Forms', 'Dagger Forms', 'Staff Forms', 'Techniques', 'Echoes', 'Shape Fusions', 'Class Signatures', 'Other Forms'];
  const names = [...groups.keys()].sort((a, b) => (order.indexOf(a) + 99) % 99 - ((order.indexOf(b) + 99) % 99));
  const stats = book.stats();
  return `
    <p class="sub">Use a skill to raise its rank. At max rank it can <b>morph</b> into a new form — you keep the original.
    Train past max for more morph charges and, eventually, a second essence slot.</p>
    ${names
      .map(
        (g) => `<h3>${g}</h3><div class="cards">${groups
          .get(g)!
          .map((s) => card(host, s) + (variants.get(s.id) ?? []).map((v) => card(host, v, true)).join(''))
          .join('')}</div>`,
      )
      .join('')}
    <p class="foot">${stats.authoredKnown} of ${stats.authoredTotal} authored skills · ${stats.infusions} infusions · ${stats.echoesKnown}/${stats.echoesTotal} echoes</p>`;
}

function passivesTab(host: PanelHost): string {
  const { book, reg } = host.ctrl;
  const active = book.passives();
  const totals = tagTotals(reg, book.state.skills);
  const tagRows = TAG_PASSIVE_TAGS.map((t) => {
    const total = totals[t];
    const rank = tagPassiveRank(total);
    const next = rank >= 5 ? null : tagPassiveTotalFor(rank + 1);
    const def = reg.passive(`tag_${t}`);
    const pct = next ? Math.min(100, (100 * total) / next) : 100;
    return `<div class="prow ${rank ? '' : 'dim'}"><span class="ico">${def?.icon ?? '✧'}</span><span><b>${esc(def?.name ?? t)}</b>
      <small>${rank ? `Rank ${rank}` : 'Locked'} · ${total}${next ? ` / ${next}` : ''} mastery in <i>${t}</i> skills</small>
      <span class="bar mini"><i style="width:${pct}%"></i></span></span></div>`;
  }).join('');
  const other = active.filter((p) => p.source !== 'tag');
  return `
    <p class="sub">Passives are always on. <b>Tag passives</b> grow from the summed ranks of your skills carrying a tag;
    others come from trainers, resonances, your worn class tree and imprints.</p>
    <h3>Active</h3>
    ${
      other.length
        ? other
            .map(
              (p) => `<div class="prow"><span class="ico">${p.def.icon}</span><span><b>${esc(p.def.name)}</b> <small>R${p.rank}/${p.def.maxRank} · ${p.source}${p.strength !== 1 ? ` ×${p.strength}` : ''}</small><small>${esc(p.def.desc)}</small></span></div>`,
            )
            .join('')
        : '<p class="sub">No learned, class or imprint passives yet.</p>'
    }
    <h3>Tag passives</h3>${tagRows}`;
}

function essencesTab(host: PanelHost): string {
  const { book, reg } = host.ctrl;
  const held = book.ingredients().essences;
  return `
    <p class="sub">Essences reshape a skill at a <b>Fusion Altar</b>: put a skill and an essence on the altar. They are used up only on success.
    Every attack has one essence slot; overmaster it three times for a second.</p>
    ${
      held.length
        ? held
            .map((e) => {
              const def = reg.essence(e.ref.slice(4))!;
              return `<div class="prow"><span class="ico">${def.icon}</span><span><b>${esc(def.name)}</b> <small>×${e.count} · ${def.category} · ${def.appliesTo.join(', ')}</small><small>${esc(def.desc)}</small></span></div>`;
            })
            .join('')
        : '<p class="sub">You hold no essences. Monsters drop the essence of what they do — hunt one kind long enough and it will give some up.</p>'
    }`;
}

export function renderSkills(host: PanelHost, arg?: string): void {
  if (arg) return renderSkill(host, arg);
  const t = tab(host, 'skills.tab', 'skills');
  const body =
    tabsHtml(
      'skills.tab',
      [
        ['skills', 'Skills'],
        ['passives', 'Passives'],
        ['essences', 'Essences'],
      ],
      t,
    ) + (t === 'passives' ? passivesTab(host) : t === 'essences' ? essencesTab(host) : skillsTab(host));
  host.sheet('📖 Skills', body);
  wireTabs(host, 'skills.tab');
  $$<HTMLButtonElement>(host.modal, '.skill-card').forEach((b) => b.addEventListener('click', () => host.open('skills', b.dataset.skill!)));
}

function renderSkill(host: PanelHost, id: string): void {
  const { ctrl } = host;
  const { book, reg } = ctrl;
  const s = reg.skill(id);
  const p = book.progress(id);
  if (!s || !p) return host.open('skills');
  const max = p.rank >= s.maxRank;
  const pct = (100 * p.xp) / book.barSize(id);
  const el = s.element ? reg.element(s.element) : undefined;
  const usable = ctrl.usable(id);
  const weapons = s.weapons ? s.weapons.map((w) => `${WEAPONS[w].icon} ${w}`).join(', ') : 'Any weapon';
  const morphs = book.morphOptions(id);
  const fuseNeed = fusionMinRank(s.maxRank);
  const slots = book.essenceSlots(id);
  const applied = (s.essences ?? []).map((e) => reg.essence(e)).filter((e) => !!e);
  const morphHtml = morphs.length
    ? `<h3>Morphs ${max ? '' : `<small>(unlock at rank ${s.maxRank})</small>`}</h3>
      <div class="morphs">${morphs
        .map((o) => {
          const spark = o.spark ? `<small class="spark">✦ Can spark mid-fight vs threat ~${o.spark.threat} (parent rank ${o.spark.minParentRank}+)</small>` : '';
          if (o.owned)
            return `<div class="morph owned"><span class="ico">${o.skill!.icon}</span><span><b>${esc(o.skill!.name)}</b><small>Tier ${o.tier} · Learned</small></span></div>`;
          if (!o.skill)
            return `<div class="morph locked"><span class="ico">❔</span><span><b>??? <small>Tier ${o.tier}</small></b><small>${esc(o.hint)}</small>${spark}</span></div>`;
          const can = max && p.charges > 0 && o.available;
          return `<div class="morph ${o.available ? 'ready' : 'sealed'}"><span class="ico">${o.skill.icon}</span><span><b>${esc(o.skill.name)} <small>Tier ${o.tier}</small></b>
            <small>${esc(o.skill.desc)}</small>${reqList(o.requirements)}${spark}</span>
            <button class="btn gold" data-morph="${esc(o.morph.to)}" ${can ? '' : 'disabled'}>${!max ? 'Master first' : p.charges ? 'Morph' : 'No charge'}</button></div>`;
        })
        .join('')}</div>
      ${max && p.charges === 0 ? '<p class="sub">Keep using this skill to fill the overmastery bar and earn another morph charge.</p>' : ''}`
    : '<h3>Morphs</h3><p class="sub">No known morphs. Perhaps fusion holds its future.</p>';
  const isBasic = BASICS.has(id);
  const body = `
    <button class="back">‹ Skills</button>
    <div class="skill-head">
      <span class="big-ico">${s.icon}</span>
      <div>
        <h3 class="nm">${esc(s.name)}</h3>
        <div class="chips">
          ${el ? `<span class="chip el" style="--c:${hex(el.color)}">${el.icon} ${el.name}</span>` : ''}
          ${s.tags
            .filter((t) => t !== s.element && !(s.weapons as string[] | undefined)?.includes(t))
            .map((t) => `<span class="chip">${esc(t)}</span>`)
            .join('')}
        </div>
      </div>
    </div>
    <p>${esc(s.desc)}</p>
    <div class="kv">
      <span>Rank</span><b>${max ? `★ ${p.rank} (max)` : `${p.rank} / ${s.maxRank}`} · Tier ${s.tier}</b>
      <span>${max ? 'Overmastery' : 'Mastery'}</span><b><span class="bar mini ${max ? 'over' : ''}"><i style="width:${pct}%"></i></span></b>
      <span>Morph charges</span><b>${p.charges}${p.overBars ? ` · ${p.overBars} overmastery bar${p.overBars > 1 ? 's' : ''}` : ''}</b>
      <span>Effect</span><b>${shapeText(s.shape)}</b>
      ${s.power ? `<span>Power</span><b>${Math.round(s.power * 100)}%${s.critBonus ? ` · +${s.critBonus}% crit` : ''}</b>` : ''}
      <span>Cost</span><b>${s.spCost} SP · ${s.cooldown ? `${(s.cooldown / 1000).toFixed(1)}s` : 'weapon speed'}${s.castMs ? ` · ${(s.castMs / 1000).toFixed(2)}s wind-up` : ''}</b>
      <span>Essences</span><b>${slots ? `${applied.length}/${slots} slot${slots > 1 ? 's' : ''}${applied.length ? ': ' + applied.map((e) => `${e!.icon} ${esc(e!.name)}`).join(', ') : ''}` : 'none (buff)'}</b>
      <span>Weapons</span><b>${weapons}</b>
      <span>Origin</span><b>${esc(sourceText(p.source, reg))}</b>
      <span>Uses</span><b>${p.uses}</b>
    </div>
    ${usable.ok ? '' : `<p class="warn">${esc(usable.reason ?? '')}</p>`}
    ${
      isBasic
        ? '<p class="sub">Your basic attack lives on the big button and auto-attacks when you tap an enemy.</p>'
        : `<h3>Hotbar</h3><div class="assign">${Array.from({ length: HOTBAR_SIZE }, (_, i) => {
            const cur = ctrl.session.player.hotbar[i];
            const curS = cur ? reg.skill(cur) : undefined;
            return `<button class="btn slotpick ${cur === id ? 'on' : ''}" data-assign="${i}">${curS ? curS.icon : '·'}<small>${i + 1}</small></button>`;
          }).join('')}</div>`
    }
    ${morphHtml}
    <p class="sub">Fusion: ${p.rank >= fuseNeed ? '✅ ready as an ingredient' : `reach rank ${fuseNeed} to use at the altar`}.</p>`;
  host.sheet('📖 Skills', body);
  $(host.modal, '.back').addEventListener('click', () => host.open('skills'));
  $$<HTMLButtonElement>(host.modal, '[data-morph]').forEach((b) => b.addEventListener('click', () => ctrl.morph(id, b.dataset.morph!)));
  $$<HTMLButtonElement>(host.modal, '[data-assign]').forEach((b) =>
    b.addEventListener('click', () => {
      const i = Number(b.dataset.assign);
      const cur = ctrl.session.player.hotbar[i];
      ctrl.assignSlot(i, cur === id ? null : id);
      host.render();
    }),
  );
}
