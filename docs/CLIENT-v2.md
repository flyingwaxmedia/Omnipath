# Omnipath v2 — Client Build Specification

The client stage turns the v2 core (`src/core/**`, `docs/SPEC-v2.md`) and v2 content (`src/data/**`) into the
playable game. It replaces the single-map `WorldScene` with a multi-map `MapScene`, ports combat to the SkillBook v2
API, adds monster techniques, sparks, echoes, essences, trainers, waystones, a minimap and a world map, and rebuilds the
panels. This document is the contract between the client agents.

## 1. Files and ownership

| area | files | owner (stage) |
|---|---|---|
| session + save v2 | `src/game/session.ts` | foundation |
| world runtime state | `src/game/world/runtime.ts` | foundation |
| scene lifecycle, map render, input, portals, interactions | `src/game/scenes/MapScene.ts` (replaces `WorldScene.ts`), `src/game/systems/Interactions.ts` | foundation |
| combat (casting, hits, kills, statuses, monster AI) | `src/game/systems/Combat.ts`, `src/game/entities/*.ts` | foundation → combat-depth |
| shape FX + projectiles + riders | `src/game/systems/SkillSystem.ts` | foundation → combat-depth |
| monster techniques, telegraphs, witness | `src/game/systems/MonsterSkills.ts` | combat-depth |
| HUD, hotbar, log, toasts, target, banner | `src/ui/hud.ts`, `src/ui/styles/hud.css` | foundation → hud-maps |
| minimap, world map, travel | `src/ui/minimap.ts`, `src/ui/worldmap.ts`, `src/ui/styles/maps.css` | hud-maps |
| panels: skills, altar, classes, codex, bag, trainer | `src/ui/panels/*.ts`, `src/ui/styles/panels.css` | foundation (port) → panels |
| dialogs, discovery cards, minigames | `src/ui/dialogs.ts`, `src/ui/styles/dialogs.css` | foundation |
| UI facade + controller interface | `src/ui/ui.ts`, `src/ui/controller.ts` | foundation (others may ADD controller methods only by asking) |
| entry | `src/main.ts`, `src/game/scenes/BootScene.ts`, `src/ui/title.ts` | foundation |
| art | `src/game/textures.ts`, `src/game/art/*` | art (done) |

Old files to delete in the foundation stage: `src/game/scenes/WorldScene.ts`, `src/game/world/map.ts`,
`src/game/world/pathfinding.ts` (use `src/core/world/*`), the monolithic `src/ui/styles.css` (split).

## 2. Session & save v2 (`src/game/session.ts`)

```ts
interface PlayerSave {
  name; weapon; ownedWeapons; level; exp; hp; sp; coins;
  hotbar: (string | null)[];          // 6 slots
  bag: Record<string, number>;         // item id -> count (materials, consumables, relics)
  createdAt: number;
}
interface WorldState {
  mapId: string; x: number; y: number;           // where the player stands
  visited: string[];                              // map ids
  seenPortals: string[];                          // 'map#portal' (world map edges)
  revealed: string[];                             // hidden portals revealed 'map#portal'
  waystones: string[];                            // attuned 'map#objectId'
  savePoint: string | null;                       // waystone key used for respawn
  nodes: Record<string, number>;                  // 'map#nodeId' -> depletedUntil (epoch ms)
  chests: string[];                               // opened 'map#objectId'
  wardens: Record<string, number>;                // monster id -> defeatedAt (epoch ms)
  fog: Record<string, string>;                    // mapId -> base64 bitset of explored 4x4-tile cells
}
interface SaveData { v: 2; player: PlayerSave; book: SkillBookState; world: WorldState }
```
- Key `omnipath.save.v2`. On load: if absent, read `omnipath.save.v1`, migrate (player → vale.hearthvale spawn,
  `bag {ore, fish}` → `bag`, book via `migrateBookState`), write v2, keep v1 untouched.
- `Session.book.inv` is wired to the player bag/coins (`count`, `coins`, `spend`).
- `navigator.storage?.persist?.()` after the first save (ignore failures).
- Prune expired `nodes` entries on save.

## 3. Scene lifecycle (`MapScene`)

- One `MapScene` (key `'Map'`). Changing maps = `this.scene.restart({ session, ui, mapId, arrive })` where
  `arrive` is a portal id in the destination map (or `{ waystone: id }`, or undefined → saved x/y, else spawn).
- `init()` resets every per-map field; `create()` compiles the map (`compileMap`, cached per id in a module Map),
  builds layers, places the player, spawns monsters, then `cameras.main.fadeIn(220)`.
- Every listener on `this.scale`, `window`, `document`, `book.events` is registered through a disposer list that runs on
  `Phaser.Scenes.Events.SHUTDOWN`. Warping 50 times must not grow listener counts.
- The DOM `UI` is created ONCE in `main.ts` (after the title screen) and passed in scene data; it holds the scene as
  its `GameController` (the same scene instance survives restarts).
- Warp: lock input → fade out 220 ms → restart. Arrival: 2 s spawn protection, target cleared.
- Camera: follow player, bounds = map, zoom `clamp(min(w,h)/380, 1, 1.7)`; arenas zoom out to fit the arena
  height (min 0.8).

## 4. Rendering (texture keys are a contract with `src/game/textures.ts`)

- Ground: tilemap layer from `CompiledMap.ground` with tileset `'tiles'` (`addTilesetImage('tiles','tiles',32,32,
  TILE_MARGIN, TILE_SPACING)`), depth -100000.
- Props: `PropInst.kind` = texture key, origin (0.5, 1) at the tile's bottom-centre, depth = y. Hide props outside a
  3×3 chunk window (16×16-tile chunks) around the camera.
- Structures: `struct_<kind>` at footprint bottom-centre, depth = bottom y.
- Objects: `obj_<kind>` (waystone uses `obj_waystone_lit` once attuned; chests `obj_chest_open` once opened).
- Nodes: `node_<kind>`; depleted → `node_depleted` (fishing nodes stay but stop bobbing).
- NPCs: `NpcDef.texture` with name label (title on second line), idle bob.
- Portals: edge → `portal_edge` chevrons tinted gold + floating label "To <map name> (Lv a–b)"; door →
  `portal_door`; stairs → `portal_stairs_down/up`; gated portals → `gate_prism` with `gate_socket` gems tinted by
  element (lit if attuned, grey if not; for `elementsKnown` show 7 sockets lighting in attune order); hidden portals →
  draw `hide_<look>` overlay until revealed (shimmer is subtle and only visible within 3 tiles).
- Monsters: `MonsterDef.texture ?? 'mon_' + id`, tint/scale from def, elites get a soft coloured aura ring, wardens a
  name plate + HP bar at the top of the screen (HUD target pill in boss mode).

## 5. Interactions (`src/game/systems/Interactions.ts`)

Tap an NPC/object/node/portal → walk next to it → act. Channels are cancelled by moving; meditation is also cancelled by
damage.

| thing | action |
|---|---|
| smith (brann) | dialog: Forge (2 ore, timing minigame; each good forge → `forge_success` +1; 3 → fire), Lessons, Buy weapons (60 coins). First visit: gift 6 ore (flag `brann_gift`). |
| priestess (alba) | full heal; grants holy when ≥ 3 elements; Lessons |
| hermit / fisher / trainer | lines + Lessons (trainer panel) |
| waykeeper | set save point here, Travel (attuned waystones: same region free, other region 40 coins), sell materials |
| loremaster / archivist | explains tiers; reveals ONE not-yet-whispered class riddle per visit (`state.whispered`) |
| villager | random line |
| waystone | attune (first touch: toast + lit texture) then Travel menu |
| altar | opens the Fusion panel (fusion is only possible at an altar) |
| wind_shrine | meditate 4 s (interrupt on damage) → `meditations` flag; first → wind |
| obelisk | shadow after 5 gloomcap kills (v1 rules) |
| signpost / statue | show `text` |
| chest | loot once (coins, items, essences via `book.addEssence`, hint → `book.state.hints` + log) |
| campfire | rest: full HP/SP, sets save point if the map has a waystone |
| node | gather (ore 1.2 s channel; fishing minigame; others 1.5 s) → bag item + flag (SPEC §7.4); deplete 150 s; element thresholds (ore 10 → earth, fish 3 → water) |
| portal | gate check → dialog showing sockets/hint if closed; else warp |

Hidden portal reveal: whenever the player casts a skill whose tags/element/shape match `reveal` within 3 tiles of
the portal rect (any-of: `tag` OR `element`/`elements` OR `shape`) → add to `world.revealed`, burst FX, toast "A
hidden way opens".
Map entry: `book.incFlag('visited:' + mapId)` the first time, `world.visited`, banner with name + level band.
Fog: mark the 4×4 cells within 6 tiles of the player every 500 ms.

**Flag contract.** Content `Requirement`s (morphs, recipes, lessons, classes) and portal gates may read ONLY these
SkillBook flags (`tests/content.test.ts` enforces it), so the client must set every one of them with `book.incFlag`:

| flag | set by | when |
|---|---|---|
| `visited:<mapId>` | client (§5) | first entry into a map (to 1) |
| `ore_mined`, `fish_caught`, `herb_gathered`, `ember_gathered`, `chime_gathered`, `storm_gathered`, `spore_gathered`, `sun_gathered`, `frost_gathered` | client (§5) | +1 per successful gather of that node kind (SPEC §7.4) |
| `meditations` | client (§5) | +1 per completed wind-shrine meditation |
| `forge_success` | client (§5) | +1 per good forge at Brann (3 → fire) |
| `brann_gift` | client (§5) | Brann's first-visit ore gift (to 1) |
| `kills` | client (§6) | +1 per monster killed (any species) |
| `kill_<monsterId>` | client (§6) | +1 per kill of that species (elites/wardens under their own id) |
| `warden_<wardenId>` | client (§6) | +1 per warden defeat |
| relic flags (`relic_stone`, `relic_dusk`, `relic_storm` — `ItemDef.flag` of relic items) | client (§6) | relic picked up |
| `mastered_any`, `class_worn` | core SkillBook | first skill at max rank / first class worn (to 1) |

## 6. Combat (`src/game/systems/Combat.ts`, `SkillSystem.ts`, `MonsterSkills.ts`)

- Casting: check `usable` (weapon), SP, cooldown, after-cast lock. `castMs > 0` → wind-up bar on the player
  (moving cancels, no cost). After the effect fires: cooldown × (1 + cooldownPct/100) × (1 − cdr/100), SP ×
  (1 + spCostPct/100), then `afterCastMs` (default 250) global lock for skills (walking/auto-attack allowed).
- Use XP: on a cast's **first hit** call `book.recordUse(skillId, monsterThreat(m))`; buffs: if in combat (dealt or
  took damage in the last 5 s) `book.recordBuffUse(id, maxEngagedThreat)`.
- Hit: `computeDamage(reg.elements, skill, rank, {atk, matk, crit, weapon}, {def, element, elementLevel, size, family,
  statuses}, {tagPct: book.tagPowerFor(skill), familyPct: vsFamilyPct, statusPct: vsStatusPct})`; show "Resist" for 0;
  combo name as floating text; apply the combo consumption; then statuses (element status + skill status; `soak` = slow
  0.55 × 2.2 s + soaked marker), riders: `arc` (zap up to N nearest other monsters within 120 px at mult, no chaining),
  `leech` (heal fraction, cap 8 % max HP per cast), `knockback`; `returns` (projectile flies back to the caster, hit set
  cleared once), `reprise` (re-execute the cast after delayMs at mult, no further reprise).
- XP: `book.recordHit(skillId, { monster: def, killed, hitIndex: cast.tally.hits++, instanceHits })` where
  `instanceHits` counts hit-XP grants for (skill, monster instance).
- Sparks: on every hit by a skill with unknown spark morphs: `const s = book.trySpark(skill.id, m.def, now)`; on success:
  250 ms hit-stop (`this.time.timeScale`/tween pause), radial flash, banner "✦ New form: <name>", `navigator.vibrate?.(60)`.
- Kills: `book.recordKill(def)` (essence → toast "Essence of <X>"), flags `kills` and `kill_<id>` (see the §5 flag
  contract), bestiary star toasts; wardens:
  `book.incFlag('warden_' + id)`, `world.wardens[id] = Date.now()`; drops: relic → bag item + `book.incFlag(relic.flag)`;
  tome → learn; shard → element.
- Echo witness: when a monster BEGINS an echo technique targeted at the player within 6 tiles, mark it witnessed on that
  instance (first time per instance: small "👁" floater). On kill, for each witnessed echo: `book.witness(skillId)` →
  learned (discovery card via events) / progress toast "Witnessed 2/3: Boulder Roll" / blocked whisper.
- Monster techniques (`MonsterSkills`): monsters with techniques pick one (weighted, `hpBelow`, cooldown, range) instead
  of an auto-attack; telegraphs: nova = red ellipse at the player's position for `delay` ms; projectile = 300 ms wind-up
  then a projectile that damages the player on contact; dash = line telegraph 400 ms then dash; strike = arc 300 ms;
  spin = ring around the monster 400 ms; chain = 300 ms then zap. Damage = monster atk × skill.power (element vs player
  neutral). Wardens: pick techniques more often; HP < 50 % uses enrage techniques.
- Elites/wardens respawn: elites 180 s runtime-only; wardens use `world.wardens` (`respawn` ms after defeatedAt) and do
  not respawn while the player is in the map.
- AFK: auto-attack chains stop after 30 s without player input.
- Death: respawn at `world.savePoint` waystone (else region hub spawn), 50 % HP/SP, lose 5 % EXP.

### 6.1 AUTO battle (one switch)
- AUTO is a single on/off switch (the pill beside the attack button; key **A** on desktop). Off: nothing casts by
  itself. On: **every** equipped skill auto-casts — there are no per-skill marks.
- On, with no live target: the player walks to the **nearest** monster (monsters already chasing the player first;
  wardens only once engaged; monsters AUTO cannot path to are skipped for 15 s), and the normal engage logic
  auto-attacks it.
- Skills fire in skill-bar order as soon as they are ready, **only when the target is within that skill's reach**
  (buffs: target within ~6 tiles and the buff not already running); pure-movement skills (power 0) never auto-fire.
  Cooldowns, the after-cast lock, wind-ups, stuns and SP apply as usual.
- Manual control wins: a ground tap or an NPC/object/portal tap pauses target hunting until 4 s after the player
  stops (auto-casting at an existing target continues); tapping a monster just retargets. The 30 s AFK stop is
  disabled while AUTO is on. Auto casts earn mastery like manual ones (XP still requires real hits).
- Saved as `PlayerSave.autoOn` (default off). Controller: `autoCastOn()`, `setAutoCastOn(on)`.

## 7. UI (`src/ui/**`)

`GameController` v2 (`src/ui/controller.ts`) — the only API the DOM may call:
```ts
interface GameController {
  readonly session: Session; readonly reg: Registry; readonly book: SkillBook;
  stats(): Stats;
  castSlot(i: number): void;                    // -1 = basic attack
  assignSlot(i: number, id: string | null): void;
  cooldown(id: string): { remain: number; total: number };
  usable(id: string): { ok: boolean; reason?: string };
  sparkWindow(id: string): 'none' | 'low' | 'good' | 'peak';
  morph(from: string, to: string): void;
  fuse(a: string, b: string): FuseResult;
  atAltar(): boolean;
  wearClass(id: string): Outcome; buyClassNode(classId: string, nodeId: string): Outcome;
  respecClass(classId: string): Outcome; setImprints(ids: string[]): Outcome;
  takeLesson(lessonId: string): Outcome;
  buyWeapon(w: WeaponType): Outcome; equipWeapon(w: WeaponType): Outcome;
  useItem(itemId: string): Outcome; sellItem(itemId: string, count: number): Outcome;
  isSafe(): boolean;
  map(): { def: MapDef; compiled: CompiledMap };
  world(): WorldState;
  minimap(): { px: number; py: number; monsters: { x: number; y: number; rank: MonsterRank }[];
               npcs: { x: number; y: number }[]; portals: { x: number; y: number; open: boolean; label: string }[];
               nodes: { x: number; y: number; ready: boolean }[]; objects: { x: number; y: number; kind: string }[] };
  travelTargets(): { key: string; mapId: string; name: string; region: string; cost: number }[];
  travel(key: string): Outcome;
  navigateTo(mapId: string): Outcome;            // BFS over discovered portals + auto-walk, resumes after warps
  setPaused(paused: boolean): void;
  newGame(): void;
}
type Outcome = { ok: boolean; message?: string };
```
HUD: vitals (name, Lv, worn class + CR, HP/SP/EXP), menu column (Skills, Fuse, Class, Codex, Bag, Map), minimap (top-
right circle, 112 px, 20-tile radius; collapsible; tap → world map), zone banner "<name> · Lv a–b", target pill
(warden mode), hotbar (6 + basic) with rank badge, mastery ring, cooldown, element badge, **spark glyph** (cracked-star
rune: dim = low, lit = good, gold pulse = peak), log, toasts, channel bar, cast wind-up bar.

Panels (bottom sheets on phones, centred on desktop; the world pauses while open in single-player):
- **Skills**: tabs Skills | Passives | Essences. Skills grouped by weapon tree/base with variants nested, morph tree view
  per weapon (13 nodes; known/available/hidden states with requirement checklist and spark info), hotbar assignment,
  essence slots shown per skill. Passives: tag totals toward the next rank, learned, class, imprints.
- **Fuse**: only usable at an altar (else explains where altars are). Tabs Elements | Skills | Essences; two sockets;
  remembered-pair memory; result card; whispers.
- **Class**: worn class header (tier, CR bar, points); list of discovered classes (wear — only in safe maps); class
  tree view (buy ranks, respec in safe maps); imprint slots; codex of undiscovered classes by state.
- **Codex**: elements (with sources), bestiary (species by family, kills, stars, techniques seen, essence), echoes
  (witness marks / need / anchor shape), fusion codex, whispers, discovery stats.
- **Bag**: coins, materials, consumables (use), relics, weapons (equip/buy hint).
- **Trainer**: opened from NPC dialogs: lessons with grant, requirement checklist (✓/✗), cost, "Learn" button.
- **Map**: region graph (cells by `worldCell`, visited/seen/unknown, level bands, gate pins, dungeon floors popover,
  current position) + local map (1:1 compiled map render with fog, portals, NPCs, nodes, waystones) + Travel list when
  standing at a waystone/waykeeper + "Navigate" to a visited map.

## 8. Quality bar
- `npx tsc --noEmit` and `npm test` green; `npm run build` succeeds.
- Playwright smoke (`scripts/playtest.mjs`, run against `vite preview`): new game → each panel opens without console
  errors → walk Hearthvale → Greenmeadow → fight → back → Mirror Lake → warp chain to Stormbreak via debug teleport →
  portrait phone and iPad landscape screenshots.
- 60 fps target on mid phones: ≤ 250 visible prop images, pooled float texts, no per-frame DOM layout thrash
  (HUD updates ≤ 10 Hz).
