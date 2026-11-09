// Dialogs, discovery cards and minigames (docs/CLIENT-v2.md §1/§7). Pure renderers into the shared modal element;
// the UI facade owns modal state (which panel is open, the discovery queue, pausing the world).
// wireDiscoveryCards() adds cards for the v2 events the scene only toasts or logs (spark, witness / echo, passive,
// essence, Class Rank milestones, bestiary stars). Spark cards wait until the fight is over.
import { CLASS, classMaxRank } from '../core/classes';
import { TAG_PASSIVE } from '../core/passives';
import type { GameController } from './controller';
import { SPARK_RUNE } from './hud';
import { pathOf } from './panels/skills';
import { $, $$, esc, hex } from './util';

export interface DialogOption {
  label: string;
  action?: () => void;
  /** Keep the dialog open after the action. */
  keep?: boolean;
  disabled?: boolean;
}

/** Visual family of a discovery card (derived from the kicker when absent). */
export type DiscoveryKind =
  | 'skill'
  | 'spark'
  | 'echo'
  | 'witness'
  | 'passive'
  | 'essence'
  | 'class'
  | 'element'
  | 'mastered'
  | 'bestiary';

export interface DiscoveryCard {
  icon: string;
  kicker: string;
  title: string;
  body: string;
  accent?: string;
  kind?: DiscoveryKind;
  /** Extra HTML under the body (pips, chips). */
  extra?: string;
  /** Secondary button: closes the card, then runs (e.g. opens the panel that explains it). */
  cta?: { label: string; run: () => void };
}

const KIND_ACCENT: Partial<Record<DiscoveryKind, string>> = {
  spark: '#ffd76a',
  echo: '#c8a8ff',
  witness: '#c8a8ff',
  passive: '#8ff0c0',
  essence: '#d7a8ff',
  class: '#c9a0ff',
  mastered: '#ffd76a',
  bestiary: '#ffb070',
};

function kindOf(card: DiscoveryCard): DiscoveryKind {
  if (card.kind) return card.kind;
  const k = card.kicker.toUpperCase();
  if (k.includes('ELEMENT')) return 'element';
  if (k.includes('ECHO')) return 'echo';
  if (k.includes('CLASS') || k.includes('SIGNATURE')) return 'class';
  if (k.includes('MASTERED')) return 'mastered';
  if (k.includes('SPARK')) return 'spark';
  return 'skill';
}

/** NPC / object dialog. `close` is called before an option's action unless the option keeps the dialog. */
export function renderDialog(
  modal: HTMLElement,
  speaker: string,
  portrait: string,
  text: string,
  options: DialogOption[],
  close: () => void,
): void {
  modal.innerHTML = `
    <div class="dialog">
      <div class="speaker"><span class="ico">${portrait}</span><b>${esc(speaker)}</b></div>
      <p>${text}</p>
      <div class="opts">${options
        .map((o, i) => `<button class="btn ${i === 0 ? 'gold' : ''}" data-opt="${i}" ${o.disabled ? 'disabled' : ''}>${o.label}</button>`)
        .join('')}</div>
    </div>`;
  $$<HTMLButtonElement>(modal, '[data-opt]').forEach((b) =>
    b.addEventListener('click', () => {
      const o = options[Number(b.dataset.opt)];
      if (!o.keep) close();
      o.action?.();
    }),
  );
}

export function renderDiscovery(modal: HTMLElement, card: DiscoveryCard, more: boolean, onOk: () => void): void {
  const kind = kindOf(card);
  const accent = card.accent ?? KIND_ACCENT[kind] ?? '#ffd76a';
  const halo =
    kind === 'spark'
      ? `<span class="halo rune-halo">${SPARK_RUNE}</span>`
      : kind === 'echo' || kind === 'witness'
        ? '<span class="halo eye-halo"><i></i><i></i></span>'
        : kind === 'essence'
          ? '<span class="halo orbit"><i></i><i></i><i></i></span>'
          : kind === 'passive' || kind === 'class' || kind === 'mastered'
            ? '<span class="halo ring"></span>'
            : '';
  modal.innerHTML = `
    <div class="discovery k-${kind}" style="--accent:${accent}" role="dialog" aria-label="${esc(card.title)}">
      <div class="rays"></div>
      <div class="kicker">${card.kicker}</div>
      <div class="big-ico">${halo}<span class="glyph">${card.icon}</span></div>
      <h2>${esc(card.title)}</h2>
      <p>${card.body}</p>
      ${card.extra ? `<div class="extra">${card.extra}</div>` : ''}
      <div class="d-btns">${card.cta ? `<button class="btn cta">${card.cta.label}</button>` : ''}<button class="btn gold ok">${more ? 'Next' : 'Onward'}</button></div>
    </div>`;
  $(modal, '.ok').addEventListener('click', onOk);
  modal.querySelector('.cta')?.addEventListener('click', () => {
    onOk();
    card.cta?.run();
  });
}

// ==================================================================== v2 discovery cards

/** What wireDiscoveryCards needs from the UI facade. */
export interface DiscoveryHost {
  readonly isOpen: boolean;
  readonly state: Record<string, unknown>;
  discovery(card: DiscoveryCard): void;
  open(name: string, arg?: string): void;
}

/** Client-only book flags remembering which first-time cards were shown (never read by content). */
const SEEN = { essence: 'card:ess:', classRank: 'card:cr' } as const;
/** A spark card waits for the fight to end: no monster this close (px) for CALM_TICKS checks in a row… */
const CALM_RADIUS = 230;
const CALM_TICK_MS = 700;
const CALM_TICKS = 3;
/** …or shows anyway once it has waited this long. */
const SPARK_CARD_MAX_WAIT_MS = 30000;

function pipRow(n: number, max: number): string {
  return `<span class="pips violet">${Array.from({ length: max }, (_, i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('')}</span>`;
}

/**
 * Subscribes discovery cards for the v2 event types to the book, once for the page lifetime (the UI and the book both
 * outlive map restarts; the scene's own subscriptions are per map). Returns an unsubscribe.
 */
export function wireDiscoveryCards(ui: DiscoveryHost, ctrl: GameController): () => void {
  const { book, reg } = ctrl;
  const ev = book.events;
  const offs: (() => void)[] = [];
  const blockedShown = new Set<string>();
  const deferred: { card: DiscoveryCard; at: number }[] = [];
  let calm = 0;

  const openTab = (panel: string, tabName: string, arg?: string) => () => {
    ui.state[`${panel}.tab`] = tabName;
    ui.open(panel, arg);
  };

  offs.push(
    ev.on('spark', ({ from, to, monster }) => {
      const w = pathOf(reg, to.id);
      deferred.push({
        at: Date.now(),
        card: {
          kind: 'spark',
          icon: to.icon,
          kicker: '✦ SPARK',
          title: to.name,
          body: `<b>${esc(from.name)}</b> cracked open mid-fight against the ${esc(monster.name)}. No morph charge spent — the form is yours to keep.<br><small>${esc(to.desc)}</small>`,
          cta: {
            label: w ? '🌳 See its path' : '📖 Open it',
            run: () => {
              if (w) ui.state[`skills.node:${w}`] = to.id;
              ui.open('skills', w ? `tree:${w}` : to.id);
            },
          },
        },
      });
    }),
  );

  offs.push(
    ev.on('witness', ({ skill, status, marks, need, anchorShape }) => {
      const total = Object.values(book.state.witness).reduce((a, n) => a + n, 0);
      if (status === 'progress' && total === 1) {
        ui.discovery({
          kind: 'witness',
          icon: '👁',
          kicker: 'FIRST WITNESS MARK',
          title: skill.name,
          body: `You saw this technique aimed at you, then felled its user. Earn <b>${need}</b> marks and hold a <b>${esc(anchorShape)}</b> skill at rank 3, and it becomes yours — an <b>Echo</b>.`,
          extra: pipRow(Math.min(marks, need), need),
          cta: { label: '📜 Echoes', run: openTab('codex', 'echoes') },
        });
      } else if (status === 'blocked' && !blockedShown.has(skill.id)) {
        blockedShown.add(skill.id);
        ui.discovery({
          kind: 'echo',
          icon: skill.icon,
          kicker: 'THE ECHO SLIPS AWAY',
          title: skill.name,
          body: `You have witnessed it enough, but nothing in you can hold its shape. Raise a <b>${esc(anchorShape)}</b> skill to rank 3 — your marks are kept, and the next kill will anchor it.`,
          extra: pipRow(Math.min(marks, need), need),
          cta: { label: '📜 Echoes', run: openTab('codex', 'echoes') },
        });
      }
    }),
  );

  offs.push(
    ev.on('passive', ({ def, rank, source }) => {
      if (rank !== 1 || source === 'debug') return;
      const resonance = source.startsWith('fusion:');
      const why =
        source === 'tag'
          ? `Your <b>${esc(def.tag ?? '')}</b> skills together passed ${TAG_PASSIVE.unlockAt} summed ranks. It grows as they do.`
          : resonance
            ? 'Two elements found a harmony inside you. It is always on.'
            : 'Always on. Train it again for more ranks.';
      ui.discovery({
        kind: 'passive',
        icon: def.icon,
        kicker: source === 'tag' ? 'PASSIVE AWAKENED' : resonance ? 'RESONANCE' : 'PASSIVE LEARNED',
        title: def.name,
        body: `${esc(def.desc)}<br><small>${why}</small>`,
        extra: pipRow(rank, def.maxRank),
        cta: { label: '📖 Passives', run: openTab('skills', 'passives') },
      });
    }),
  );

  offs.push(
    ev.on('essence', ({ essence, source }) => {
      if (source === 'debug' || source.startsWith('lesson:')) return;
      const flag = SEEN.essence + essence.id;
      if (book.flag(flag) > 0) return;
      book.incFlag(flag);
      ui.discovery({
        kind: 'essence',
        icon: essence.icon,
        kicker: 'ESSENCE FOUND',
        title: essence.name,
        body: `${esc(essence.desc)}<br><small>Shapes ${essence.appliesTo.map(esc).join(', ')} skills. Put it on a <b>⚗️ Fusion Altar</b> with one of them — it is used up only if something is made.</small>`,
        cta: { label: '📖 Essences', run: openTab('skills', 'essences') },
      });
    }),
  );

  offs.push(
    ev.on('classRank', ({ cls, rank }) => {
      const max = classMaxRank(cls);
      const imprint = cls.imprint ? reg.passive(cls.imprint) : undefined;
      const first = book.flag(SEEN.classRank) < 1;
      let card: DiscoveryCard | null = null;
      if (rank >= max) {
        card = {
          kind: 'class',
          icon: cls.icon,
          kicker: 'CLASS MASTERED',
          title: cls.name,
          body: `Class Rank ${rank} — as high as it goes. Its tree is yours to finish${imprint ? ', and its imprint can travel with you into any other class' : ''}.`,
        };
      } else if (imprint && rank === CLASS.imprintAt[cls.tier]) {
        card = {
          kind: 'class',
          icon: imprint.icon,
          kicker: 'IMPRINT UNLOCKED',
          title: imprint.name,
          body: `${esc(cls.name)} reached Class Rank ${rank}. ${esc(imprint.desc)}<br><small>Slot it from 🏛️ Class → Imprints while you wear another class.</small>`,
          cta: { label: '🏛️ Imprints', run: openTab('classes', 'imprints') },
        };
      } else if (first) {
        card = {
          kind: 'class',
          icon: cls.icon,
          kicker: `CLASS RANK ${rank}`,
          title: cls.name,
          body: `Using skills that fit a class raises its Class Rank. Each rank grants <b>${cls.tier} tree point${cls.tier > 1 ? 's' : ''}</b> to spend in its tree.`,
          cta: {
            label: '🏛️ Open the tree',
            run: book.state.worn === cls.id ? openTab('classes', 'worn') : () => ui.open('classes', `tree:${cls.id}`),
          },
        };
      }
      if (!card) return;
      if (first) book.incFlag(SEEN.classRank);
      card.extra = `<span class="cr-pill">CR ${rank} / ${max}</span>`;
      ui.discovery(card);
    }),
  );

  offs.push(
    ev.on('bestiary', ({ monster, stars, starUp, essence }) => {
      if (!starUp || stars < 2) return;
      const el = monster.element ? reg.element(monster.element) : undefined;
      ui.discovery({
        kind: 'bestiary',
        icon: el?.icon ?? '📕',
        kicker: `BESTIARY ${'★'.repeat(stars)}`,
        title: monster.name,
        body:
          stars === 2
            ? `You know the ${esc(monster.name)} well now: <b>+1% damage against every ${esc(monster.family)}</b>.${essence || !monster.essence ? '' : ' Its essence will not elude you much longer.'}`
            : 'A hundred felled. <b>+1% max HP</b>, for good.',
        accent: el ? hex(el.color) : undefined,
        cta: { label: '📜 Bestiary', run: openTab('codex', 'bestiary') },
      });
    }),
  );

  // Spark cards: shown once nothing hostile is near for a few checks (or after a long fight anyway).
  const timer = window.setInterval(() => {
    if (!deferred.length || ui.isOpen) {
      calm = 0;
      return;
    }
    let near = false;
    try {
      const v = ctrl.minimap();
      near = v.monsters.some((m) => Math.hypot(m.x - v.px, m.y - v.py) < CALM_RADIUS);
    } catch {
      near = false;
    }
    calm = near ? 0 : calm + 1;
    if (calm >= CALM_TICKS || Date.now() - deferred[0].at > SPARK_CARD_MAX_WAIT_MS) {
      calm = 0;
      for (const d of deferred.splice(0)) ui.discovery(d.card);
    }
  }, CALM_TICK_MS);
  offs.push(() => window.clearInterval(timer));

  return () => offs.forEach((off) => off());
}

/** Brann's forge: three strikes on a moving marker; resolves with the number of good strikes. */
export function runForge(modal: HTMLElement, done: (good: number) => void): void {
  modal.innerHTML = `
    <div class="dialog minigame">
      <div class="speaker"><span class="ico">🔨</span><b>The Forge</b></div>
      <p>Strike when the marker is in the <b class="hot">glowing zone</b>. Three strikes.</p>
      <div class="meter"><div class="zone"></div><div class="marker"></div></div>
      <div class="strikes"><span>·</span><span>·</span><span>·</span></div>
      <button class="btn gold strike">🔨 Strike!</button>
    </div>`;
  const marker = $(modal, '.marker');
  const zone = $(modal, '.meter .zone');
  const strikes = modal.querySelectorAll('.strikes span');
  let zoneStart = 0.35 + Math.random() * 0.3;
  const zoneW = 0.18;
  zone.style.left = `${zoneStart * 100}%`;
  zone.style.width = `${zoneW * 100}%`;
  let t = 0;
  let dir = 1;
  let speed = 1.1;
  let n = 0;
  let good = 0;
  let raf = 0;
  let last = performance.now();
  const tick = (now: number) => {
    const dt = (now - last) / 1000;
    last = now;
    t += dir * speed * dt;
    if (t > 1) {
      t = 1;
      dir = -1;
    } else if (t < 0) {
      t = 0;
      dir = 1;
    }
    marker.style.left = `${t * 100}%`;
    if (marker.isConnected) raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  $(modal, '.strike').addEventListener('click', () => {
    if (n >= 3) return;
    const hit = t >= zoneStart && t <= zoneStart + zoneW;
    strikes[n].textContent = hit ? '✦' : '✕';
    strikes[n].className = hit ? 'hit' : 'miss';
    if (hit) good++;
    n++;
    speed += 0.35;
    zoneStart = 0.15 + Math.random() * 0.65;
    zone.style.left = `${zoneStart * 100}%`;
    if (n >= 3) {
      cancelAnimationFrame(raf);
      setTimeout(() => done(good), 450);
    }
  });
}

/** Fishing: wait for the bite, then reel in within 900 ms. */
export function runFishing(modal: HTMLElement, done: (ok: boolean) => void): void {
  modal.innerHTML = `
    <div class="dialog minigame">
      <div class="speaker"><span class="ico">🎣</span><b>Fishing</b></div>
      <p class="fish-msg">Waiting for a bite...</p>
      <div class="pond"><span class="bob">🔴</span></div>
      <button class="btn gold reel">Reel in!</button>
    </div>`;
  const msg = $(modal, '.fish-msg');
  const bob = $(modal, '.bob');
  let biting = false;
  let finished = false;
  const finish = (ok: boolean, text: string) => {
    if (finished) return;
    finished = true;
    msg.textContent = text;
    setTimeout(() => done(ok), 700);
  };
  const biteAt = 1200 + Math.random() * 2600;
  const t1 = setTimeout(() => {
    biting = true;
    bob.classList.add('bite');
    msg.textContent = '❗ Something bites! Reel in!';
    setTimeout(() => {
      if (biting && !finished) finish(false, 'It got away...');
    }, 900);
  }, biteAt);
  $(modal, '.reel').addEventListener('click', () => {
    if (biting) finish(true, '🐟 Caught one!');
    else {
      clearTimeout(t1);
      finish(false, 'Too early — the fish swam off.');
    }
  });
}
