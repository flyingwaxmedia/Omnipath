// Interactions (docs/CLIENT-v2.md §5): tap an NPC / object / node / portal -> walk next to it -> act.
// Every NPC role, object kind, gather node and portal behaviour lives here, plus channels (mining, gathering,
// meditation) and the forge / fishing minigames. Channels are cancelled by moving; meditation also by damage.
import type Phaser from 'phaser';
import type { NodeDef, NodeKind, ObjectDef, PortalDef } from '../../core/world/types';
import type { NpcDef } from '../../data/npcs';
import { WEAPONS } from '../../data/weapons';
import type { WeaponType } from '../../core/types';
import { esc } from '../../ui/util';
import type { MapScene } from '../scenes/MapScene';
import {
  TILE,
  addOnce,
  distToRect,
  gateText,
  nodeKey,
  nodeReady,
  objectKey,
  waystoneOf,
} from '../world/runtime';

export interface NpcView {
  kind: 'npc';
  def: NpcDef;
  x: number;
  y: number;
  sprite: Phaser.GameObjects.Image;
  label: Phaser.GameObjects.Text;
}
export interface ObjectView {
  kind: 'object';
  def: ObjectDef;
  x: number;
  y: number;
  sprite: Phaser.GameObjects.Image;
  label: Phaser.GameObjects.Text | null;
}
export interface NodeView {
  kind: 'node';
  def: NodeDef;
  x: number;
  y: number;
  sprite: Phaser.GameObjects.Image;
  bobber: Phaser.GameObjects.Image | null;
  ready: boolean;
}
export interface PortalView {
  kind: 'portal';
  def: PortalDef;
  /** Rect centre (px). */
  x: number;
  y: number;
  open: boolean;
  /** Hidden-portal blocker overlay until revealed. */
  overlay: Phaser.GameObjects.Image | null;
  /** Everything else drawn for the portal (chevrons, door, gate, sockets, label). */
  parts: Phaser.GameObjects.GameObject[];
  label: Phaser.GameObjects.Text | null;
}
export type Interactable = NpcView | ObjectView | NodeView | PortalView;

interface Channel {
  label: string;
  start: number;
  until: number;
  done: () => void;
  interruptOnHit: boolean;
}

/** Gather nodes (SPEC §7.4): kind -> item, flag, channel. */
export const NODE_TABLE: Record<NodeKind, { item: string; flag: string; verb: string; ms: number }> = {
  ore: { item: 'ore', flag: 'ore_mined', verb: '⛏️ Mining...', ms: 1200 },
  fishing: { item: 'fish', flag: 'fish_caught', verb: '🎣 Fishing...', ms: 0 },
  herb: { item: 'herb', flag: 'herb_gathered', verb: '🌿 Gathering...', ms: 1500 },
  ember_vent: { item: 'ember_shard', flag: 'ember_gathered', verb: '🔸 Chipping shards...', ms: 1500 },
  wind_chime: { item: 'chime_feather', flag: 'chime_gathered', verb: '🪶 Untangling feathers...', ms: 1500 },
  storm_tree: { item: 'storm_wood', flag: 'storm_gathered', verb: '🪵 Cutting stormwood...', ms: 1500 },
  shadow_fungus: { item: 'umbral_spore', flag: 'spore_gathered', verb: '🍄 Harvesting spores...', ms: 1500 },
  sun_spring: { item: 'sun_water', flag: 'sun_gathered', verb: '💧 Drawing sun water...', ms: 1500 },
  frost_crystal: { item: 'frost_crystal', flag: 'frost_gathered', verb: '❄️ Prying crystal...', ms: 1500 },
};

/** Gather nodes recover after this long (absolute timestamps in the save). */
export const NODE_RESPAWN_MS = 150000;
const ORE_FOR_EARTH = 10;
const FISH_FOR_WATER = 3;
const FORGES_FOR_FIRE = 3;
const GLOOMCAPS_FOR_SHADOW = 5;
const REACH = TILE * 1.7;

export class Interactions {
  pending: Interactable | null = null;
  channel: Channel | null = null;
  /** Loremasters whisper one riddle per visit (map entry). */
  private readonly whisperedThisVisit = new Set<string>();
  /** Scene time of the last update (pause-gap detection for channels). */
  private clockAt = -1;

  constructor(private s: MapScene) {}

  /** Walk next to `v`, then act. */
  approach(v: Interactable): void {
    const s = this.s;
    s.combat.setTarget(null);
    this.cancelChannel();
    this.pending = v;
    if (this.inReach(v)) return;
    const goal = v.kind === 'npc' || v.kind === 'object' || v.kind === 'node' ? { x: v.x, y: v.y + TILE * 0.7 } : { x: v.x, y: v.y };
    s.player.path = s.pathTo(goal.x, goal.y) ?? [];
  }

  private inReach(v: Interactable): boolean {
    const p = this.s.player;
    if (v.kind === 'portal') return distToRect(v.def, p.x, p.y) <= REACH;
    return Math.hypot(v.x - p.x, v.y - p.y) <= REACH;
  }

  update(now: number): void {
    // Scene time is the game-loop clock, so it jumps across pauses (open panels, hit-stops). Slide a running channel
    // by the gap so mining / meditating never completes while the world was paused (the playtest saw a 4 s meditation
    // finish the instant a panel closed).
    if (this.clockAt >= 0 && this.channel) {
      const gap = now - this.clockAt - Math.min(this.s.game.loop.delta, 50);
      if (gap > 120) {
        this.channel.start += gap;
        this.channel.until += gap;
      }
    }
    this.clockAt = now;
    const c = this.channel;
    if (c) {
      this.s.ui.setChannel(c.label, (now - c.start) / (c.until - c.start));
      if (this.s.player.path.length) this.cancelChannel('Interrupted.');
      else if (now >= c.until) {
        this.channel = null;
        this.s.ui.setChannel(null);
        c.done();
      }
    }
    const v = this.pending;
    if (!v) return;
    if (this.inReach(v)) {
      this.pending = null;
      this.s.player.path = [];
      this.s.player.face(v.x, v.y);
      this.act(v);
    } else if (!this.s.player.path.length) this.pending = null;
  }

  startChannel(label: string, ms: number, interruptOnHit: boolean, done: () => void): void {
    this.s.player.path = [];
    const now = this.s.time.now;
    this.channel = { label, start: now, until: now + ms, done, interruptOnHit };
  }

  cancelChannel(msg?: string): void {
    if (!this.channel) return;
    this.channel = null;
    this.s.ui.setChannel(null);
    if (msg) this.s.ui.toast(msg);
  }

  onDamaged(): void {
    if (this.channel?.interruptOnHit) this.cancelChannel('Interrupted!');
  }

  // ---------------------------------------------------------------- dispatch

  act(v: Interactable): void {
    switch (v.kind) {
      case 'npc':
        return this.npc(v);
      case 'object':
        return this.object(v);
      case 'node':
        return this.node(v);
      case 'portal':
        return this.portal(v);
    }
  }

  private line(npc: NpcDef): string {
    return npc.lines[Math.floor(Math.random() * npc.lines.length)] ?? '...';
  }

  private lessonsOpt(npc: NpcDef) {
    return npc.trainer ? [{ label: '📜 Lessons', action: () => this.s.ui.open('trainer', npc.id) }] : [];
  }

  // ---------------------------------------------------------------- NPCs

  private npc(v: NpcView): void {
    const s = this.s;
    const { book, ui } = s;
    const npc = v.def;
    const pl = s.session.player;
    switch (npc.role) {
      case 'smith': {
        if (!book.flag('brann_gift')) {
          book.incFlag('brann_gift');
          s.session.addItem('ore', 6);
          ui.log('🪨 Brann presses <b>6 ore</b> into your hands: "Your first forgings are on me."', 'loot');
        }
        const forged = book.flag('forge_success');
        const fireLine = book.hasElement('fire')
          ? 'The forge-fire lives in you now. Take it to the altar and see what it does to your techniques.'
          : `Work the forge with me. Do it right ${FORGES_FOR_FIRE} times and the heat will get into your bones. <small>(${Math.min(forged, FORGES_FOR_FIRE)}/${FORGES_FOR_FIRE})</small>`;
        const forSale = (Object.keys(WEAPONS) as WeaponType[]).filter((w) => !pl.ownedWeapons.includes(w));
        const ore = s.session.count('ore');
        ui.dialog(npc.name, npc.portrait, `${fireLine}<br><br>Each forging takes <b>2 ore</b>. You have <b>${ore}</b>.`, [
          { label: '🔥 Forge', action: () => this.forge(), disabled: ore < 2 },
          ...this.lessonsOpt(npc),
          ...forSale.map((w) => ({
            label: `${WEAPONS[w].icon} Buy ${WEAPONS[w].name} (🪙${WEAPONS[w].price})`,
            action: () => {
              const r = s.buyWeapon(w);
              if (!r.ok && r.message) ui.toast(esc(r.message));
            },
            disabled: pl.coins < WEAPONS[w].price,
          })),
          { label: 'Leave' },
        ]);
        return;
      }
      case 'priestess': {
        const st = s.stats();
        pl.hp = st.maxHp;
        pl.sp = st.maxSp;
        const n = book.knownElements().length;
        let text = 'Be healed, traveler. <i>(HP and SP restored.)</i><br><br>';
        if (!book.hasElement('holy') && n >= 3) {
          text += 'Three elements dwell within you, in balance. Then you are ready for the light.';
          ui.dialog(npc.name, npc.portrait, text, [
            { label: 'Receive the light', action: () => book.learnElement('holy', "Sister Alba's blessing") },
            ...this.lessonsOpt(npc),
          ]);
          return;
        }
        text += book.hasElement('holy')
          ? esc(this.line(npc))
          : `When <b>three elements</b> dwell in you, return to me. <small>(${n}/3)</small>`;
        ui.dialog(npc.name, npc.portrait, text, [{ label: 'Thank you' }, ...this.lessonsOpt(npc)]);
        return;
      }
      case 'fisher': {
        const caught = book.flag('fish_caught');
        const extra = book.hasElement('water') ? '' : ` <small>(${Math.min(caught, FISH_FOR_WATER)}/${FISH_FOR_WATER} fish)</small>`;
        ui.dialog(npc.name, npc.portrait, `${esc(this.line(npc))}${extra}`, [{ label: 'Got it' }, ...this.lessonsOpt(npc)]);
        return;
      }
      case 'hermit':
      case 'trainer':
        ui.dialog(npc.name, npc.portrait, esc(this.line(npc)), [...this.lessonsOpt(npc), { label: 'Leave' }]);
        return;
      case 'waykeeper': {
        const wsId = waystoneOf(s.def);
        const key = wsId ? objectKey(s.mapId, wsId) : null;
        const here = key !== null && s.session.world.savePoint === key;
        ui.dialog(npc.name, npc.portrait, esc(this.line(npc)), [
          ...(key
            ? [
                {
                  label: here ? '✓ Your save point' : '🛏️ Set save point here',
                  disabled: here,
                  action: () => this.setSavePoint(key),
                },
              ]
            : []),
          { label: '🧭 Travel', action: () => ui.open('map', 'travel') },
          { label: '🪙 Sell materials', action: () => ui.open('bag', 'sell') },
          { label: 'Leave' },
        ]);
        return;
      }
      case 'loremaster':
        return this.loremaster(npc);
      case 'villager':
      default:
        ui.dialog(npc.name, npc.portrait, esc(this.line(npc)), [{ label: 'Bye' }]);
    }
  }

  /** Lines in order (one per talk), plus ONE not-yet-whispered riddle per visit. */
  private loremaster(npc: NpcDef): void {
    const s = this.s;
    const { book, reg } = s;
    const n = book.flag(`talk:${npc.id}`);
    book.incFlag(`talk:${npc.id}`);
    let text = esc(npc.lines[n % npc.lines.length] ?? '');
    if (!this.whisperedThisVisit.has(npc.id)) {
      const tiers = npc.id === 'tamsin' ? [1] : [2, 3];
      const cls = reg.classes.find(
        (c) => !c.hidden && tiers.includes(c.tier) && !book.state.classes[c.id] && !book.state.whispered.includes(c.id),
      );
      if (cls && book.whisperClass(cls.id, 'trainer')) {
        this.whisperedThisVisit.add(npc.id);
        text += `<br><br><i>She reads from the Codex:</i> “${esc(cls.hint)}”<br><small>(Riddle added to your Codex.)</small>`;
      } else if (!cls) text += '<br><br><small>I have no riddles left that you have not already heard.</small>';
    }
    s.ui.dialog(npc.name, npc.portrait, text, [{ label: 'Thank you' }]);
  }

  private setSavePoint(key: string): void {
    const s = this.s;
    s.session.world.savePoint = key;
    if (addOnce(s.session.world.waystones, key)) s.refreshObjects();
    s.ui.toast('🛏️ Save point set. You will wake here if you fall.');
    s.save();
  }

  private forge(): void {
    const s = this.s;
    if (!s.session.takeItem('ore', 2)) return;
    s.ui.forgeMinigame().then((good) => {
      if (good >= 2) {
        const n = s.book.incFlag('forge_success');
        const pay = 10 + good * 5;
        s.session.player.coins += pay;
        s.ui.log(`🔨 A fine piece! Brann buys it for 🪙${pay}. (${Math.min(n, FORGES_FOR_FIRE)}/${FORGES_FOR_FIRE})`, 'good');
        if (n >= FORGES_FOR_FIRE) s.book.learnElement('fire', "Brann's forge in Hearthvale");
      } else {
        s.ui.log('🔨 The metal cracked. Brann shakes his head. Try again.', 'warn');
      }
      s.save();
    });
  }

  // ---------------------------------------------------------------- objects

  private object(v: ObjectView): void {
    const s = this.s;
    const { book, ui } = s;
    const d = v.def;
    const world = s.session.world;
    const key = objectKey(s.mapId, d.id);
    switch (d.kind) {
      case 'waystone': {
        if (addOnce(world.waystones, key)) {
          v.sprite.setTexture('obj_waystone_lit');
          s.skills.fxRing(v.x, v.y - 10, 50, 0x7ff0ff, false);
          ui.toast(`🔷 Waystone attuned: <b>${esc(s.def.name)}</b>`);
          ui.log('🔷 The waystone remembers you. Travel between attuned stones from here or any Waykeeper.', 'rare');
          if (!world.savePoint) world.savePoint = key;
          s.save();
        }
        const here = world.savePoint === key;
        ui.dialog('Waystone', '🔷', `The stone hums with every road you have walked.${here ? '<br><small>This is your save point.</small>' : ''}`, [
          { label: '🧭 Travel', action: () => ui.open('map', 'travel') },
          { label: here ? '✓ Save point' : '🛏️ Rest here (save point)', disabled: here, action: () => this.setSavePoint(key) },
          { label: 'Leave' },
        ]);
        return;
      }
      case 'altar':
        ui.open('altar');
        return;
      case 'wind_shrine':
        this.startChannel('🧘 Meditating...', 4000, true, () => {
          const n = book.incFlag('meditations');
          s.skills.fxRing(s.player.x, s.player.y, 80, 0x9be8c8, true);
          if (!book.learnElement('wind', 'Meditation at the Shrine of Winds')) ui.log(`🍃 Your mind clears. (${n} meditations)`, 'good');
          s.save();
        });
        ui.toast(esc(d.text ?? 'Sit still. Do not be struck.'));
        return;
      case 'obelisk': {
        const n = book.flag('kill_gloomcap');
        if (book.hasElement('shadow')) {
          ui.dialog('Umbral Obelisk', '🌑', 'The obelisk is silent. Its darkness already lives in you.', [{ label: 'Leave' }]);
        } else if (n >= GLOOMCAPS_FOR_SHADOW) {
          ui.dialog('Umbral Obelisk', '🌑', 'With its guardians fallen, the obelisk opens. Shadow pours out — and into you.', [
            { label: 'Embrace it', action: () => book.learnElement('shadow', 'The Umbral Obelisk') },
          ]);
        } else {
          ui.dialog(
            'Umbral Obelisk',
            '🌑',
            `A dark stone hums. Its guardians still lurk in the wood. <small>(${n}/${GLOOMCAPS_FOR_SHADOW} Gloomcaps)</small>`,
            [{ label: 'Leave' }],
          );
        }
        return;
      }
      case 'signpost':
        ui.dialog('Signpost', '🪧', esc(d.text ?? 'The words have worn away.'), [{ label: 'OK' }]);
        return;
      case 'statue':
        ui.dialog('Statue', '🗿', esc(d.text ?? 'A weathered figure, its face long smoothed by rain.'), [{ label: 'OK' }]);
        return;
      case 'chest':
        return this.chest(v, key);
      case 'campfire': {
        const st = s.stats();
        const pl = s.session.player;
        pl.hp = st.maxHp;
        pl.sp = st.maxSp;
        s.skills.fxRing(v.x, v.y - 6, 40, 0xffa040, false);
        const ws = waystoneOf(s.def);
        if (ws) {
          const wsKey = objectKey(s.mapId, ws);
          world.savePoint = wsKey;
          if (addOnce(world.waystones, wsKey)) s.refreshObjects();
          ui.toast('🔥 You rest by the fire. HP and SP restored — save point set.');
        } else ui.toast('🔥 You rest by the fire. HP and SP restored.');
        s.save();
        return;
      }
    }
  }

  private chest(v: ObjectView, key: string): void {
    const s = this.s;
    const world = s.session.world;
    if (world.chests.includes(key)) {
      s.ui.toast('The chest is empty.');
      return;
    }
    world.chests.push(key);
    v.sprite.setTexture('obj_chest_open');
    s.skills.fxBurst(v.x, v.y - 12, 0xffd76a, 14);
    const loot = v.def.loot ?? {};
    const got: string[] = [];
    if (loot.coins) {
      s.session.player.coins += loot.coins;
      got.push(`🪙${loot.coins}`);
    }
    for (const [id, n] of Object.entries(loot.items ?? {})) {
      s.obtain(id, n, 'chest');
      const it = s.reg.item(id);
      got.push(`${it?.icon ?? ''} ${it?.name ?? id} ×${n}`);
    }
    for (const [id, n] of Object.entries(loot.essences ?? {})) {
      if (!s.reg.essence(id)) continue;
      s.book.addEssence(id, n, 'chest');
      const e = s.reg.essence(id)!;
      got.push(`${e.icon} Essence of ${e.name} ×${n}`);
    }
    s.ui.log(`📦 Opened a chest: ${got.map(esc).join(', ') || 'nothing but dust'}.`, 'loot');
    if (loot.hint) {
      if (!s.book.state.hints.includes(loot.hint)) s.book.state.hints.push(loot.hint);
      s.ui.log(`🌫️ <i>“${esc(loot.hint)}”</i>`, 'info');
      s.ui.dialog('Chest', '📦', `${got.map(esc).join('<br>')}<br><br><i>${esc(loot.hint)}</i>`, [{ label: 'Take it all' }]);
    }
    s.save();
  }

  // ---------------------------------------------------------------- nodes

  private node(v: NodeView): void {
    const s = this.s;
    const { book, ui } = s;
    const d = v.def;
    const world = s.session.world;
    const info = NODE_TABLE[d.kind];
    if (!nodeReady(world, s.mapId, d.id)) {
      ui.toast(d.kind === 'fishing' ? 'The fish here have scattered. Try again soon.' : 'Spent for now. It will recover soon.');
      return;
    }
    const finish = () => {
      world.nodes[nodeKey(s.mapId, d.id)] = Date.now() + NODE_RESPAWN_MS;
      s.refreshNodes();
      const total = s.session.addItem(info.item, 1);
      const n = book.incFlag(info.flag);
      const item = s.reg.item(info.item);
      s.skills.fxBurst(v.x, v.y - 8, 0xf0d070, 8);
      ui.log(`${item?.icon ?? '✓'} +1 <b>${esc(item?.name ?? info.item)}</b> (${total} in bag)`, 'loot');
      if (d.kind === 'ore') {
        if (n === 6) ui.log('Your arms feel heavier — your swing has learned something from the stone.', 'rare');
        if (n >= ORE_FOR_EARTH) book.learnElement('earth', 'Mining at Greystone Quarry');
      }
      if (d.kind === 'fishing' && n >= FISH_FOR_WATER) book.learnElement('water', 'Fishing at Mirror Lake');
      s.save();
    };
    if (d.kind === 'fishing') {
      ui.fishingMinigame().then((ok) => {
        if (ok) finish();
      });
      return;
    }
    this.startChannel(info.verb, info.ms, false, finish);
  }

  // ---------------------------------------------------------------- portals

  private portal(v: PortalView): void {
    const s = this.s;
    const p = v.def;
    if (p.reveal && !s.portalIsRevealed(p)) {
      s.ui.dialog('Something hidden', '🌫️', esc(p.reveal.hint), [{ label: 'Hm.' }]);
      return;
    }
    if (p.gate && !v.open) {
      s.ui.dialog(p.label ?? 'Prism Gate', '🔒', `${esc(p.gate.hint)}<br><br>${gateText(s.book, p.gate)}`, [{ label: 'Leave' }]);
      return;
    }
    s.warp(p.to.map, p.to.portal);
  }
}
