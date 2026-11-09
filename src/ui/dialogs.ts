// Dialogs, discovery cards and minigames (panels lane; docs/CLIENT-v2.md §1/§7, docs/UX-SIMPLE.md). Pure renderers
// into the shared modal element; the UI facade owns modal state (which panel is open, the discovery queue, pausing).
// wireDiscoveryCards() adds the cards for moments the HUD only toasts (a move seen, a Mastery bonus, a first essence,
// Class Level milestones, Bestiary stars). A sudden insight has no card: its banner (with "See it") is the moment's one
// announcement (announce.ts; docs/UX-SIMPLE.md rule 9).
// Words: a kicker, a name, ONE short line, and at most one primary button (docs/UX-SIMPLE.md rules 1, 5, 9).
import { CLASS, classMaxRank } from '../core/classes';
import type { GameController } from './controller';
import { SPARK_RUNE } from './hud';
import { $, $$, esc, hex } from './util';
import { classLevel, effectLine, familyName, oneLine, seen, shapeWord, stars } from './words';

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
  | 'bestiary'
  | 'quest'
  | 'reward';

export interface DiscoveryCard {
  /** Emoji / glyph shown when there is no `image`. */
  icon: string;
  kicker: string;
  title: string;
  /** ONE short line (HTML: may hold <b>/<small>). */
  body: string;
  accent?: string;
  kind?: DiscoveryKind;
  /** Extra HTML under the body (reward chips, skill icons, pips). */
  extra?: string;
  /** Secondary button: closes the card, then runs (e.g. opens the panel that explains it). */
  cta?: { label: string; run: () => void };
  /** Pixel art (data URL) shown instead of `icon`: a skill / element / class icon or an outfit preview. */
  image?: string;
  /** Width the image is drawn at (CSS px; whole multiples of the art keep it crisp: 64 for icons). Default 64. */
  imageSize?: number;
  /** The card's ONE primary action (e.g. "Become"): closes the card, then runs. `.ok` becomes its "Later". */
  action?: { label: string; run: () => void };
  /** Label of `.ok` (default "OK", "Next" while more cards wait, "Later" beside an action). */
  okLabel?: string;
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
  quest: '#e9c46a',
  reward: '#e9c46a',
};

function kindOf(card: DiscoveryCard): DiscoveryKind {
  if (card.kind) return card.kind;
  const k = card.kicker.toUpperCase();
  if (k.includes('ELEMENT')) return 'element';
  if (k.includes('ECHO')) return 'echo';
  if (k.includes('CLASS')) return 'class';
  if (k.includes('MASTER') || k.includes('MAX RANK')) return 'mastered';
  if (k.includes('INSIGHT')) return 'spark';
  if (k.includes('QUEST')) return 'reward';
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
  const gold = options.findIndex((o) => !o.disabled);
  modal.innerHTML = `
    <div class="dialog" role="dialog" aria-label="${esc(speaker)}">
      <div class="speaker"><span class="ico">${portrait}</span><span class="who"><b>${esc(speaker)}</b></span></div>
      <p class="say">${text}</p>
      <div class="opts">${options
        .map((o, i) => `<button class="btn ${i === gold ? 'gold' : ''}" data-opt="${i}" ${o.disabled ? 'disabled' : ''}>${o.label}</button>`)
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

/** The card's big picture: pixel art when given (crisp, whole-pixel size), else the glyph. */
function cardArt(card: DiscoveryCard): string {
  if (card.image) {
    // Width only: square icons stay square and outfit previews (40×48) keep their shape.
    const size = card.imageSize ?? 64;
    return `<img class="px art" src="${card.image}" width="${size}" alt="" draggable="false">`;
  }
  return `<span class="glyph">${card.icon}</span>`;
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
          : kind === 'passive' || kind === 'class' || kind === 'mastered' || kind === 'reward'
            ? '<span class="halo ring"></span>'
            : '';
  const okLabel = card.okLabel ?? (card.action ? 'Later' : more ? 'Next' : 'OK');
  modal.innerHTML = `
    <div class="discovery k-${kind} ${card.image ? 'has-art' : ''}" style="--accent:${accent}" role="dialog" aria-label="${esc(card.title)}">
      <div class="rays"></div>
      <div class="kicker">${card.kicker}</div>
      <div class="big-ico">${halo}${cardArt(card)}</div>
      <h2>${esc(card.title)}</h2>
      <p>${card.body}</p>
      ${card.extra ? `<div class="extra">${card.extra}</div>` : ''}
      <div class="d-btns">${card.cta ? `<button class="btn cta">${card.cta.label}</button>` : ''}${
        card.action ? `<button class="btn gold big act">${card.action.label}</button>` : ''
      }<button class="btn ${card.action ? 'later' : 'gold'} ok">${okLabel}</button></div>
    </div>`;
  $(modal, '.ok').addEventListener('click', onOk);
  modal.querySelector('.cta')?.addEventListener('click', () => {
    onOk();
    card.cta?.run();
  });
  modal.querySelector('.act')?.addEventListener('click', () => {
    onOk();
    card.action?.run();
  });
}

// ==================================================================== discovery cards

/** What wireDiscoveryCards needs from the UI facade. */
export interface DiscoveryHost {
  readonly isOpen: boolean;
  readonly state: Record<string, unknown>;
  discovery(card: DiscoveryCard): void;
  open(name: string, arg?: string): void;
}

/** Client-only book flags remembering which first-time cards were shown (never read by content). */
const SEEN = { essence: 'card:ess:', classRank: 'card:cr' } as const;

function pipRow(n: number, max: number): string {
  return `<span class="pips violet">${Array.from({ length: max }, (_, i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('')}</span>`;
}

/** Safe pixel-art lookup (the controller draws lazily; never let a missing texture break a card). */
function art(ctrl: GameController, kind: Parameters<GameController['iconUrl']>[0], id: string): string | undefined {
  try {
    return ctrl.iconUrl(kind, id) || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Subscribes discovery cards to the book, once for the page lifetime (the UI and the book both outlive map
 * restarts; the scene's own subscriptions are per map). Returns an unsubscribe.
 */
export function wireDiscoveryCards(ui: DiscoveryHost, ctrl: GameController): () => void {
  const { book, reg } = ctrl;
  const ev = book.events;
  const offs: (() => void)[] = [];
  const blockedShown = new Set<string>();

  const openTab = (panel: string, tabName: string, arg?: string) => () => {
    ui.state[`${panel}.tab`] = tabName;
    ui.open(panel, arg);
  };

  offs.push(
    ev.on('witness', ({ skill, status, marks, need, anchorShape }) => {
      const total = Object.values(book.state.witness).reduce((a, n) => a + n, 0);
      if (status === 'progress' && total === 1) {
        ui.discovery({
          kind: 'witness',
          icon: '👁',
          image: art(ctrl, 'skill', skill.id),
          kicker: 'YOU SAW A NEW MOVE',
          title: skill.name,
          body: `Defeat monsters that use it. ${seen(marks, need)} — then it is yours.`,
          extra: pipRow(Math.min(marks, need), need),
          cta: { label: 'Echoes', run: openTab('codex', 'echoes') },
        });
      } else if (status === 'blocked' && !blockedShown.has(skill.id)) {
        blockedShown.add(skill.id);
        ui.discovery({
          kind: 'echo',
          icon: skill.icon,
          image: art(ctrl, 'skill', skill.id),
          kicker: 'ALMOST LEARNED',
          title: skill.name,
          body: `Raise a ${esc(shapeWord(anchorShape))} skill to rank 3 to keep it.`,
          extra: pipRow(Math.min(marks, need), need),
        });
      }
    }),
  );

  offs.push(
    ev.on('passive', ({ def, rank, source }) => {
      if (rank !== 1 || source === 'debug' || source.startsWith('quest:') || source.startsWith('lesson:')) return;
      const bond = source.startsWith('fusion:');
      ui.discovery({
        kind: 'passive',
        icon: def.icon,
        image: art(ctrl, 'passive', def.id),
        kicker: source === 'tag' ? 'MASTERY BONUS' : bond ? 'ELEMENT BOND' : 'NEW BONUS',
        title: def.name,
        body: `${esc(effectLine(def.desc))}<br><small>Always on. ${stars(rank, def.maxRank)}</small>`,
        cta: ctrl.unlocks().passives ? { label: 'Passives', run: openTab('skills', 'passives') } : undefined,
      });
    }),
  );

  offs.push(
    ev.on('essence', ({ essence, source }) => {
      if (source === 'debug' || source.startsWith('lesson:') || source.startsWith('quest:')) return;
      const flag = SEEN.essence + essence.id;
      if (book.flag(flag) > 0) return;
      book.incFlag(flag);
      ui.discovery({
        kind: 'essence',
        icon: essence.icon,
        image: art(ctrl, 'mod', essence.id),
        kicker: 'NEW ESSENCE',
        title: essence.name,
        body: `${esc(oneLine(essence.desc))}<br><small>Fuse it into a skill at a Fusion Altar.</small>`,
        cta: { label: 'Essences', run: openTab('skills', 'essences') },
      });
    }),
  );

  offs.push(
    ev.on('classRank', ({ cls, rank }) => {
      const max = classMaxRank(cls);
      const keepsake = cls.imprint ? reg.passive(cls.imprint) : undefined;
      const first = book.flag(SEEN.classRank) < 1;
      const image = art(ctrl, 'cls', cls.id);
      let card: DiscoveryCard | null = null;
      if (rank >= max) {
        card = { kind: 'class', icon: cls.icon, image, kicker: 'CLASS MASTERED', title: cls.name, body: `${esc(cls.name)} reached its top ${classLevel(rank)}.` };
      } else if (keepsake && rank === CLASS.imprintAt[cls.tier]) {
        card = {
          kind: 'class',
          icon: keepsake.icon,
          image,
          kicker: 'KEEPSAKE UNLOCKED',
          title: keepsake.name,
          body: `Keep this ${esc(cls.name)} bonus even as another class.<br><small>${esc(effectLine(keepsake.desc))}</small>`,
          cta: { label: 'Keepsakes', run: () => ui.open('classes') },
        };
      } else if (first) {
        card = {
          kind: 'class',
          icon: cls.icon,
          image,
          kicker: classLevel(rank).toUpperCase(),
          title: cls.name,
          body: 'Use your class skills to level it up. Each level gives a perk point.',
          cta: cls.tree?.length ? { label: 'Perks', run: () => ui.open('classes', `tree:${cls.id}`) } : undefined,
        };
      }
      if (!card) return;
      if (first) book.incFlag(SEEN.classRank);
      card.extra = `<span class="cr-pill">${classLevel(rank)} / ${max}</span>`;
      ui.discovery(card);
    }),
  );

  offs.push(
    ev.on('bestiary', ({ monster, stars: n, starUp }) => {
      if (!starUp || n < 2) return;
      const el = monster.element ? reg.element(monster.element) : undefined;
      ui.discovery({
        kind: 'bestiary',
        icon: el?.icon ?? '📕',
        kicker: `BESTIARY ${'★'.repeat(n)}`,
        title: monster.name,
        body: n === 2 ? `You know them well: you hit all ${esc(familyName(monster.family))} a little harder.` : 'A hundred defeated: a little more max HP, for good.',
        accent: el ? hex(el.color) : undefined,
        cta: { label: 'Bestiary', run: openTab('codex', 'bestiary') },
      });
    }),
  );

  return () => offs.forEach((off) => off());
}

/** Brann's forge: three strikes on a moving marker; resolves with the number of good strikes. */
export function runForge(modal: HTMLElement, done: (good: number) => void): void {
  modal.innerHTML = `
    <div class="dialog minigame">
      <div class="speaker"><span class="ico">🔨</span><b>The Forge</b></div>
      <p>Tap Strike when the marker is in the <b class="hot">glow</b>.</p>
      <div class="meter"><div class="zone"></div><div class="marker"></div></div>
      <div class="strikes"><span>·</span><span>·</span><span>·</span></div>
      <button class="btn gold big strike">🔨 Strike!</button>
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
      <p class="fish-msg">Wait for a bite…</p>
      <div class="pond"><span class="bob">🔴</span></div>
      <button class="btn gold big reel">Reel in!</button>
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
      finish(false, 'Too early! It swam off.');
    }
  });
}
