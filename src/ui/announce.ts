// Announcements (panels lane; docs/INTEGRATION-v3.md §2.6): every player-facing message the game's events cause —
// log lines, toasts, discovery cards and headline banners for SkillBook events (learned, element, rank, mastered,
// class, spark, witness, passive, essence, bestiary, quests) and game-bus events (class change, skill bar changes).
// Wired ONCE by the UI (the book and the bus outlive map restarts). The game keeps only the effects.
// Words follow docs/UX-SIMPLE.md: friendly names (src/ui/words.ts), one short line, no internals. dialogs.ts
// (wireDiscoveryCards) adds the cards for sudden insight / moves seen / bonuses / essences / Class Level / Bestiary.
//
// One card per moment: a quest turn-in teaches its skill with the book's 'learned' event first and then
// 'questCompleted' — the skill goes on the quest's reward card instead of a second card.
import { CLASS_SLOTS, classTreeTags } from '../core/classes';
import type { Registry } from '../core/registry';
import type { ClassDef } from '../core/types';
import { gameBus } from '../game/events';
import { tagWords } from '../game/steps';
import type { GameController } from './controller';
import type { DiscoveryCard } from './dialogs';
import type { LogKind } from './hud';
import { learnIconUrl, learnedLine, rewardChipsHtml } from './panels/quests';
import { esc, gate, hex, sourceText } from './util';
import { becomeSwapLine, classRewards, rarityOf } from './classinfo';
import { FRIENDLY, article, classLevel, objectiveWords, oneLine, rarityHtml, seen, shapeWord, stars } from './words';

/** What announcements need from the UI facade. */
export interface AnnounceHost {
  log(msg: string, kind?: LogKind): void;
  toast(msg: string): void;
  discovery(card: DiscoveryCard): void;
  /** Mid-fight banner; `skillId` adds its "See it" button (that skill's card). */
  sparkBanner(title: string, sub?: string, skillId?: string): void;
  /** Big centre banner ("You are now a Pyroblade"). */
  headline(title: string, sub?: string, accent?: string): void;
  /** Opens a panel (cards' buttons: the picker when every own slot is full, a skill card). Optional: UI has it. */
  open?(name: string, arg?: string): void;
}

/** Learn sources whose moment already has its own card or panel (no extra 'learned' card). */
const QUIET_SOURCES = ['spark:', 'quest:', 'lesson:', 'fusion:', 'class:'];
/** Per-quest progress toasts at most this often (ms); the last step always shows as "Ready". */
const PROGRESS_TOAST_MS = 2500;

/** Turn-ins whose reward is shown inline (the NPC dialog): their questCompleted gets no card of its own. */
let inlineRewards = 0;

/** Runs a turn-in whose reward the caller shows itself (the NPC dialog's "Quest complete!" block). */
export function withInlineReward<T>(fn: () => T): T {
  inlineRewards++;
  try {
    return fn();
  } finally {
    inlineRewards--;
  }
}

/** Kicker of the 'learned' card by where the skill came from. */
export function learnedKicker(source: string): string {
  if (source.startsWith('morph:')) return 'TRANSFORMED';
  if (source.startsWith('echo:')) return 'NEW MOVE LEARNED';
  return 'NEW SKILL';
}

/** True when a 'learned' event gets no card of its own (its moment has one already). */
export function quietLearn(source: string): boolean {
  return source === 'start' || source === 'debug' || QUIET_SOURCES.some((p) => source.startsWith(p));
}

/**
 * Worth a toast: an objective finished, its first step, or a new quarter of the way (3/12, 6/12…) — big counts do
 * not toast every kill (docs/UX-SIMPLE.md: teach in the moment, never spam).
 */
export function notableStep(prev: number | undefined, have: number, need: number, done: boolean): boolean {
  if (done) return true;
  if (prev === undefined || prev <= 0) return have > 0;
  if (need <= 4) return have > prev;
  return Math.floor((have * 4) / need) > Math.floor((prev * 4) / need);
}

/** The objective a progress event moved (compared with the previous counts), else the first one still open. */
export function movedObjective<T extends { have: number; done: boolean }>(prev: readonly number[] | undefined, now: readonly T[]): T | undefined {
  const moved = prev ? now.find((o, i) => o.have !== prev[i]) : undefined;
  return moved ?? now.find((o) => !o.done);
}

/** The kind of skill a class wants, in plain words: its tree's main tag ("fire", "piercing"), "elemental" for classes
 *  built on many elements. */
export function classSkillWord(reg: Registry, cls: ClassDef): string {
  if (cls.distinctElements || cls.source === 'prism') return 'elemental';
  // v4: a class is a weapon and a power source — its element names what it wants, else its weapon.
  if (cls.source && cls.source !== 'physical' && cls.source !== 'none') return tagWords([cls.source]);
  const tag = classTreeTags(reg, cls)[0] ?? cls.clauses?.[0]?.tags[0];
  if (tag) return tagWords([tag]);
  const w = cls.weapon && cls.weapon !== 'any' ? cls.weapon : undefined;
  return w ? { sword: 'sword', dagger: 'dagger', staff: 'rod', fists: 'fist' }[w] : '';
}

/**
 * The line under "You are now a Pyroblade" (docs/UX-SIMPLE.md: one short line): "All class slots filled" when the
 * class filled every class slot (no digit: the pixel font's 5 reads like an S), "3 class skills equipped" when it
 * filled some, or — when it knows nothing it relates to — the one next step ("Learn fire skills to fill your class
 * slots"). Never "Class skills equipped" over empty slots.
 */
export function classSlotsLine(reg: Registry, cls: ClassDef, filled: number, slots = CLASS_SLOTS): string {
  if (filled > 0 && filled >= slots) return 'All class slots filled';
  if (filled > 0) return `${filled} class skill${filled === 1 ? '' : 's'} equipped`;
  const word = classSkillWord(reg, cls);
  return `Learn ${word ? `${word} ` : 'more '}skills to fill your class slots`;
}

/** Subscribes every announcement; returns the unsubscribe function. */
export function wireAnnouncements(ui: AnnounceHost, ctrl: GameController): () => void {
  const ev = ctrl.book.events;
  const reg = ctrl.reg;
  const offs: (() => void)[] = [];
  const add = (off: () => void) => offs.push(off);
  const icon = (kind: Parameters<GameController['iconUrl']>[0], id: string): string | undefined => {
    try {
      return ctrl.iconUrl(kind, id) || undefined;
    } catch {
      return undefined;
    }
  };
  const onBar = (id: string) => ctrl.barSlots().some((s) => s.skillId === id);
  // One channel per moment (docs/UX-SIMPLE.md rule 9): a skill whose moment already has a card or a banner gets no
  // "is on your bar" / "Blademaster equipped …" toast too. Bar toasts wait one microtask (a moment's card event can
  // come after its bar event in the same burst) and drop when a card claimed their skill — or, for a new class's
  // card ('*'), every bar toast of that burst: the card shows the class skills.
  const claims = new Map<string, number>();
  const claim = (id: string, ms = 1500) => claims.set(id, Date.now() + ms);
  const claimed = (id: string): boolean => {
    const now = Date.now();
    for (const [k, until] of claims) if (until < now) claims.delete(k);
    return claims.has(id) || claims.has('*');
  };
  const barToast = (id: string, msg: string) =>
    queueMicrotask(() => {
      if (!claimed(id)) ui.toast(msg);
    });
  /** Class slots the worn class has filled right now, of how many (none filled when the view is not ready). */
  const classFill = (): { filled: number; slots: number } => {
    try {
      const slots = ctrl.barSlots().filter((s) => s.kind === 'class');
      return { filled: slots.filter((s) => s.skillId).length, slots: slots.length };
    } catch {
      return { filled: 0, slots: CLASS_SLOTS };
    }
  };
  /** "Equip" for a fresh skill that did not find a free slot (the picker opens when every own slot is full). */
  const equipCta = (id: string): DiscoveryCard['cta'] => {
    try {
      if (onBar(id) || ctrl.skillCard(id).action.kind !== 'equip') return undefined;
    } catch {
      return undefined;
    }
    return {
      label: 'Equip',
      run: () => {
        const r = ctrl.equipSkill(id);
        if (r.ok) ui.toast(`<b>${esc(reg.skill(id)?.name ?? '')}</b> is on your bar`);
        else if (ui.open) ui.open('picker', `skill:${id}`);
        else if (r.message) ui.toast(esc(r.message));
      },
    };
  };

  // ------------------------------------------------------------------ skills

  add(
    ev.on('learned', ({ skill, source }) => {
      ui.log(`📖 New skill: <b>${esc(skill.name)}</b>`, 'rare');
      if (quietLearn(source)) return;
      const el = skill.element ? reg.element(skill.element) : undefined;
      claim(skill.id);
      ui.discovery({
        kind: source.startsWith('echo:') ? 'echo' : 'skill',
        icon: skill.icon,
        image: icon('skill', skill.id),
        kicker: learnedKicker(source),
        title: skill.name,
        body: `${esc(oneLine(skill.desc))}<br><small>${esc(sourceText(source, reg))}</small>`,
        accent: el ? hex(el.color) : undefined,
        cta: equipCta(skill.id),
      });
    }),
  );
  add(
    ev.on('element', ({ element, source }) => {
      ui.log(`${element.icon} <b>${esc(element.name)}</b> awakened in you!`, 'rare');
      if (source.startsWith('quest:') || source.startsWith('lesson:')) return; // on the reward card
      ui.discovery({
        kind: 'element',
        icon: element.icon,
        image: icon('el', element.id),
        kicker: 'NEW ELEMENT',
        title: element.name,
        body: `${esc(oneLine(element.desc))}<br><small>Fuse it into a skill at a ${FRIENDLY.altar}.</small>`,
        accent: hex(element.color),
      });
    }),
  );
  add(ev.on('rankUp', ({ skill, rank }) => ui.log(`⬆ <b>${esc(skill.name)}</b> ${stars(rank, skill.maxRank)}`, 'good')));
  add(
    ev.on('mastered', ({ skill }) => {
      const ready = ctrl.book.morphOptions(skill.id).some((o) => o.available && !o.owned);
      ui.discovery({
        kind: 'mastered',
        icon: skill.icon,
        image: icon('skill', skill.id),
        kicker: '★ MAX RANK',
        title: skill.name,
        body: ready ? `${FRIENDLY.morphReady} — open its card to transform.` : `Keep using it to fill its ${FRIENDLY.overmastery}.`,
        cta: ui.open ? { label: ready ? FRIENDLY.morph : 'Open', run: () => ui.open?.('skill', skill.id) } : undefined,
      });
    }),
  );
  add(
    ev.on('charge', ({ skill, charges }) => {
      if (charges > 1) ui.toast(`✨ <b>${esc(skill.name)}</b>: another Transform ready`);
    }),
  );
  // A sudden insight's one announcement: the banner (with "See it" → the new skill's card); no card later, no toast.
  add(
    ev.on('spark', ({ from, to }) => {
      claim(to.id);
      ui.sparkBanner(`✦ ${FRIENDLY.spark}: ${to.name}`, `${from.name} changed mid-fight`, to.id);
    }),
  );
  add(
    ev.on('witness', ({ skill, status, marks, need, anchorShape }) => {
      if (status === 'progress') ui.toast(`👁 <b>${esc(skill.name)}</b> · ${seen(marks, need)}`);
      else if (status === 'blocked') ui.log(`👁 <b>${esc(skill.name)}</b> slipped away. Raise a ${esc(shapeWord(anchorShape))} skill to rank 3.`, 'info');
    }),
  );
  add(
    ev.on('passive', ({ def, rank, source }) => {
      const label = source === 'tag' ? FRIENDLY.tagPassive : source.startsWith('fusion:') ? FRIENDLY.resonance : 'New bonus';
      if (rank > 1 || source === 'tag') ui.toast(`✧ ${label}: <b>${esc(def.name)}</b> ${stars(rank, def.maxRank)}`);
      ui.log(`✧ <b>${esc(def.name)}</b> ${stars(rank, def.maxRank)}`, 'good');
    }),
  );
  add(
    ev.on('essence', ({ essence, added, source }) => {
      if (source.startsWith('drop:')) ui.toast(`${essence.icon} Found <b>${esc(essence.name)}</b>`);
      ui.log(`${essence.icon} +${added} <b>${esc(essence.name)}</b>`, 'loot');
    }),
  );
  add(
    ev.on('bestiary', ({ monster, stars: n, starUp }) => {
      if (starUp && n === 1) ui.log(`📕 New in your Bestiary: <b>${esc(monster.name)}</b>`, 'info');
    }),
  );
  add(ev.on('hint', ({ text }) => ui.log(`🌫️ <i>“${esc(text)}”</i>`, 'info')));

  // ------------------------------------------------------------------ classes

  add(
    ev.on('classDiscovered', ({ cls, worn }) => {
      ui.log(`🏛️ New class: <b>${esc(cls.name)}</b>`, 'rare');
      if (worn) {
        claim('*', 300);
        // The card says it ("Its skills are in your class slots"): the HUD's first-time hint is spent.
        try {
          ctrl.firstTime('class_slots');
        } catch {
          /* scene not ready */
        }
      }
      // The book learns the class's signature skills right after this event: build the card once they are in (its
      // skill icons and "Its skills are in your class slots" then match the bar).
      queueMicrotask(() => classCard(cls, worn));
    }),
  );
  /** The new-class card ("You are now a Blademaster"): built after the class's signature skills are learned. */
  const classCard = (cls: ClassDef, worn: boolean): void => {
    let skills: string[] = [];
    let color: string | undefined;
    try {
      const v = ctrl.classCards();
      const card = [v.current, ...v.unlocked].find((c) => c?.id === cls.id);
      skills = card?.skills ?? [];
      color = card?.color;
    } catch {
      skills = [];
    }
    const icons = skills
      .map((id) => icon('skill', id))
      .filter((u): u is string => !!u)
      .map((u) => `<img class="px" src="${u}" width="32" height="32" alt="" draggable="false">`)
      .join('');
    let outfit: string | undefined;
    try {
      outfit = ctrl.outfitUrl(cls.id) || undefined;
    } catch {
      outfit = undefined;
    }
    // Becoming it also equips its weapon (the game does it): the card says so in one short line when that swaps.
    let swap: ReturnType<typeof becomeSwapLine> = null;
    try {
      // Found and worn by itself (maybe mid-fight, maybe with another weapon in hand): the game equips the class
      // weapon as soon as the fight is over, and the card says so — or says where to get one.
      swap = becomeSwapLine(cls, ctrl.session.player);
    } catch {
      swap = null;
    }
    ui.discovery({
      kind: 'class',
      icon: cls.icon,
      image: outfit,
      imageSize: 80,
      kicker: 'NEW CLASS',
      accent: color,
      title: worn ? `You are now ${article(cls.name)}` : cls.name,
      body: worn
        ? `${esc(oneLine(cls.desc))}<br><small>${swap ? esc(swap.line.replace(/^Also /, 'It ')) : classFill().filled > 0 ? 'Its skills are in your class slots.' : `${esc(classSlotsLine(reg, cls, 0))}.`}</small>`
        : `${esc(oneLine(cls.desc))}${swap ? `<br><small>${esc(swap.line)}</small>` : ''}`,
      extra: `<div class="cnew-tags">${rarityHtml(rarityOf(reg, cls.id))}</div>${icons ? `<div class="cskills">${icons}</div>` : ''}`,
      ...(worn
        ? { okLabel: 'Great!' }
        : {
            action: {
              label: `${FRIENDLY.becomeClass} ${article(cls.name)}`,
              run: () => {
                const r = ctrl.becomeClass(cls.id);
                if (!r.ok && r.message) ui.toast(esc(r.message));
              },
            },
          }),
    });
  };
  // A Class Level's fixed reward rides on its toast ("Class Level 4 — New skill: Flame Wheel").
  add(
    ev.on('classRank', ({ cls, rank }) => {
      const reward = classRewards(reg, cls).find((r) => r.level === rank);
      ui.toast(`🏛️ <b>${esc(cls.name)}</b> · ${classLevel(rank)}${reward ? ` — ${esc(reward.text)}` : ''}`);
    }),
  );
  // Rare and rarer classes ask for a Trial first: one card, one action (the quest giver holds the Trial).
  add(
    ev.on('trialReady', ({ cls, quest }) => {
      let who = '';
      let where = '';
      try {
        const q = ctrl.questCard(quest);
        who = q?.giverName ?? '';
        where = q?.where ?? '';
      } catch {
        who = '';
      }
      ui.log(`🏛️ ${FRIENDLY.trial} ready: <b>${esc(cls.name)}</b>`, 'rare');
      ui.discovery({
        kind: 'class',
        icon: cls.icon,
        image: icon('cls', cls.id),
        kicker: `${FRIENDLY.trial.toUpperCase()} READY`,
        title: cls.name,
        body: who ? `${esc(who)}${where ? ` in ${esc(where)}` : ''} holds your ${FRIENDLY.trial}.` : `Your ${FRIENDLY.trial} is waiting.`,
        extra: `<div class="cnew-tags">${rarityHtml(rarityOf(reg, cls.id))}</div>`,
        cta: ui.open ? { label: FRIENDLY.beginTrial, run: () => ui.open?.('codex', `quests:${quest}`) } : undefined,
      });
    }),
  );
  add(
    gameBus.on('classChanged', ({ classId, reason }) => {
      if (reason !== 'wear') return;
      if (!classId) {
        ui.headline('No class', 'Every slot is yours now');
        return;
      }
      const cls = reg.classDef(classId);
      if (!cls) return;
      const { filled, slots } = classFill();
      ui.headline(`You are now ${article(cls.name)}`, classSlotsLine(reg, cls, filled, slots), ctrl.wornClass()?.color);
    }),
  );
  add(
    gameBus.on('barChanged', ({ reason, skillId, classId }) => {
      const skill = skillId ? reg.skill(skillId) : undefined;
      if (!skill) return;
      if (reason === 'learned') barToast(skill.id, `<b>${esc(skill.name)}</b> is on your bar`);
      // classLearned: the class took a new skill; assign + classId: a player edit emptied a class slot and the class
      // filled it ("Blademaster equipped Blindside"), so the change never goes unexplained.
      else if (reason === 'classLearned' || (reason === 'assign' && classId)) {
        const cls = classId ? reg.classDef(classId) : undefined;
        barToast(skill.id, cls ? `<b>${esc(cls.name)}</b> equipped <b>${esc(skill.name)}</b>` : `<b>${esc(skill.name)}</b> is on your bar`);
      }
    }),
  );

  // ------------------------------------------------------------------ quests (docs/CLIENT-v3.md §4)

  const lastCounts = new Map<string, number[]>();
  const gates = new Map<string, () => boolean>();
  add(
    ev.on('questAccepted', ({ quest }) => {
      lastCounts.set(quest.id, ctrl.book.questProgress(quest.id).map((o) => o.have));
      ui.toast(`📜 Quest accepted: <b>${esc(quest.name)}</b>`);
    }),
  );
  add(
    ev.on('questProgress', ({ quest, progress }) => {
      const prev = lastCounts.get(quest.id);
      lastCounts.set(
        quest.id,
        progress.map((o) => o.have),
      );
      if (progress.every((o) => o.done)) return; // "Ready to turn in" follows
      const o = movedObjective(prev, progress);
      if (!o) return;
      const before = prev?.[progress.indexOf(o)];
      if (!notableStep(before, o.have, o.need, o.done)) return;
      let g = gates.get(quest.id);
      if (!g) gates.set(quest.id, (g = gate(PROGRESS_TOAST_MS)));
      if (o.done || g()) ui.toast(`📜 ${esc(objectiveWords(o.text).replace(/\s*✓\s*$/, ''))}${o.done ? ' ✓' : ''}`);
    }),
  );
  add(
    ev.on('questReady', ({ quest, turnIn }) => {
      let who = turnIn;
      try {
        who = ctrl.npcQuests(turnIn).name;
      } catch {
        /* keep the id-less fallback below */
      }
      ui.toast(`✔ Ready to turn in — <b>${esc(who)}</b>`);
      ui.log(`📜 <b>${esc(quest.name)}</b> is done. Return to ${esc(who)}.`, 'good');
    }),
  );
  add(
    ev.on('questCompleted', ({ quest, gameRewards }) => {
      lastCounts.delete(quest.id);
      gates.delete(quest.id);
      const card = ctrl.questCard(quest.id);
      const rewards = card?.rewards ?? { coins: 0, exp: 0, items: [], learn: [], secret: false };
      // What the game actually pays now (coins / items / exp); what it teaches comes from the quest card.
      const learned = rewards.learn[0];
      const shown = {
        ...rewards,
        // The first thing learned is the card's headline ("You learned Hammer Toss!"); the chips list the rest.
        learn: rewards.learn.slice(1),
        coins: gameRewards.coins,
        exp: gameRewards.exp,
        items: Object.entries(gameRewards.items).map(([id, count]) => ({ id, name: reg.item(id)?.name ?? '', count })),
      };
      const skill = rewards.learn.find((l) => l.kind === 'skill');
      ui.log(`📜 Quest complete: <b>${esc(quest.name)}</b>`, 'good');
      if (inlineRewards > 0) return; // the NPC dialog shows it in place
      ui.discovery({
        kind: 'reward',
        icon: '📜',
        // The picture is the headline's (the first thing learned), so the art and the words always match.
        image: learned ? learnIconUrl(ctrl, learned) || undefined : undefined,
        kicker: 'QUEST COMPLETE',
        title: quest.name,
        body: learnedLine(learned),
        extra: rewardChipsHtml(ctrl, shown, true) || undefined,
        cta: skill ? equipCta(skill.id) : undefined,
      });
    }),
  );

  return () => offs.forEach((off) => off());
}
