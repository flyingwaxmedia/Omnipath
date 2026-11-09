// Announcements (panels lane; docs/INTEGRATION-v3.md §2): every player-facing message the game's events cause —
// log lines, toasts, discovery cards and headline banners for SkillBook events (learned, element, rank, mastered,
// class, spark, echo, passive, essence, lesson, bestiary, quests) and game-bus events (class change). Wired ONCE by
// the UI (the book and the bus outlive map restarts). The game keeps only the effects (MapScene.wireEvents).
// Words follow docs/UX-SIMPLE.md (friendly names, one short line, no internals) — the panels lane rewrites them;
// wireDiscoveryCards (dialogs.ts) adds the richer cards for spark / echo / passive / essence / class rank / bestiary.
import { gameBus } from '../game/events';
import type { GameController } from './controller';
import type { DiscoveryCard } from './dialogs';
import type { LogKind } from './hud';
import { esc, hex, sourceText } from './util';

/** What announcements need from the UI facade. */
export interface AnnounceHost {
  log(msg: string, kind?: LogKind): void;
  toast(msg: string): void;
  discovery(card: DiscoveryCard): void;
  sparkBanner(title: string, sub?: string): void;
  /** Big centre banner ("You are now a Pyroblade"). */
  headline(title: string, sub?: string, accent?: string): void;
}

/** Subscribes every announcement; returns the unsubscribe function. */
export function wireAnnouncements(ui: AnnounceHost, ctrl: GameController): () => void {
  const ev = ctrl.book.events;
  const reg = ctrl.reg;
  const offs: (() => void)[] = [];
  const add = (off: () => void) => offs.push(off);

  add(
    ev.on('learned', ({ skill, source }) => {
      const origin = sourceText(source, reg);
      ui.log(`📖 Learned <b>${esc(skill.name)}</b> <small>(${esc(origin)})</small>`, 'rare');
      if (!source.startsWith('spark:') && source !== 'debug') {
        const el = skill.element ? reg.element(skill.element) : undefined;
        ui.discovery({
          icon: skill.icon,
          kicker: source.startsWith('class:')
            ? 'SIGNATURE SKILL'
            : source.startsWith('echo:')
              ? 'ECHO LEARNED'
              : source.startsWith('lesson:')
                ? 'TECHNIQUE LEARNED'
                : skill.generated
                  ? 'NEW INFUSION'
                  : 'NEW SKILL',
          title: skill.name,
          body: `${esc(skill.desc)}<br><small>${esc(origin)}</small>`,
          accent: el ? hex(el.color) : undefined,
        });
      }
    }),
  );
  add(
    ev.on('element', ({ element, source }) => {
      ui.log(`${element.icon} Attuned to <b>${element.name}</b>!`, 'rare');
      ui.discovery({
        icon: element.icon,
        kicker: 'ELEMENT ATTUNED',
        title: element.name,
        body: `${esc(element.desc)}<br><small>${esc(sourceText(source, reg))}</small><br><br>Combine it with a skill at a <b>⚗️ Fusion Altar</b>.`,
        accent: hex(element.color),
      });
    }),
  );
  add(ev.on('rankUp', ({ skill, rank }) => ui.log(`⬆ <b>${esc(skill.name)}</b> reached rank ${rank}.`, 'good')));
  add(
    ev.on('mastered', ({ skill }) => {
      const opts = ctrl.book.morphOptions(skill.id);
      const avail = opts.filter((o) => o.available && !o.owned).length;
      ui.discovery({
        icon: skill.icon,
        kicker: '★ MASTERED',
        title: skill.name,
        body: opts.length
          ? `${avail} form${avail === 1 ? '' : 's'} ready to morph${opts.length > avail ? `, ${opts.length - avail} still sealed` : ''}.
             Open <b>📖 Skills</b> to morph it — you keep ${esc(skill.name)}.`
          : 'Its future lies in fusion. Keep training it: overmastery opens a second essence slot.',
      });
    }),
  );
  add(
    ev.on('charge', ({ skill, charges }) => {
      if (charges > 1) ui.toast(`✨ ${esc(skill.name)}: another morph charge (${charges})`);
    }),
  );
  add(
    ev.on('classDiscovered', ({ cls, worn }) => {
      ui.log(`🏛️ Class discovered: <b>${esc(cls.name)}</b>`, 'rare');
      ui.discovery({
        icon: cls.icon,
        kicker: 'CLASS DISCOVERED',
        title: cls.name,
        body: `${esc(cls.desc)}<br><small>${worn ? 'You now wear it.' : 'Wear it from 🏛️ Class in a safe town.'}</small>`,
        accent: '#c9a0ff',
      });
    }),
  );
  add(ev.on('classRank', ({ cls, rank }) => ui.toast(`🏛️ <b>${esc(cls.name)}</b> reached Class Rank ${rank}`)));
  add(ev.on('hint', ({ text }) => ui.log(`🌫️ <i>“${esc(text)}”</i>`, 'info')));
  add(ev.on('spark', ({ from, to }) => ui.sparkBanner(`✦ New form: ${to.name}`, `${from.name} cracked open mid-fight`)));
  add(
    ev.on('witness', ({ skill, status, marks, need, anchorShape }) => {
      if (status === 'progress') ui.toast(`👁 Witnessed ${Math.min(marks, need)}/${need}: <b>${esc(skill.name)}</b>`);
      else if (status === 'blocked')
        ui.log(`🌫️ <i>The echo of <b>${esc(skill.name)}</b> slips away — you need a ${anchorShape} skill at rank 3 to hold it.</i>`, 'info');
    }),
  );
  add(ev.on('echo', ({ skill, monster }) => ui.log(`👁 You echo the ${esc(monster.name)}: <b>${esc(skill.name)}</b>`, 'rare')));
  add(
    ev.on('passive', ({ def, rank }) => {
      ui.toast(`✧ Passive <b>${esc(def.name)}</b>${rank > 1 ? ` rank ${rank}` : ''}`);
      ui.log(`✧ Passive: <b>${esc(def.name)}</b> rank ${rank} — ${esc(def.desc)}`, 'good');
    }),
  );
  add(
    ev.on('essence', ({ essence, added, source }) => {
      if (source.startsWith('drop:')) ui.toast(`${essence.icon} Essence of <b>${esc(essence.name)}</b>`);
      ui.log(`${essence.icon} +${added} Essence of <b>${esc(essence.name)}</b>`, 'loot');
    }),
  );
  add(ev.on('lesson', ({ lesson, trainer }) => ui.log(`📜 ${esc(trainer.title)}: <b>${esc(lesson.name)}</b>`, 'good')));
  add(
    ev.on('bestiary', ({ monster, stars, starUp }) => {
      if (starUp) ui.toast(`📕 Bestiary: <b>${esc(monster.name)}</b> ${'★'.repeat(stars)}`);
    }),
  );

  // Quests (docs/CLIENT-v3.md §4). LANE panels: throttled objective progress toasts and the completion reward card.
  add(ev.on('questAccepted', ({ quest }) => ui.toast(`📜 Quest accepted: <b>${esc(quest.name)}</b>`)));
  add(ev.on('questReady', ({ quest, turnIn }) => ui.toast(`✔ Ready to turn in — <b>${esc(ctrl.npcQuests(turnIn).name)}</b> <small>(${esc(quest.name)})</small>`)));

  // Class change (becomeClass / wear): the headline banner.
  add(
    gameBus.on('classChanged', ({ classId, reason }) => {
      if (reason !== 'wear' || !classId) return;
      const cls = reg.classDef(classId);
      if (cls) ui.headline(`You are now ${/^[aeiou]/i.test(cls.name) ? 'an' : 'a'} ${cls.name}`, '', ctrl.wornClass()?.color);
    }),
  );

  return () => offs.forEach((off) => off());
}
