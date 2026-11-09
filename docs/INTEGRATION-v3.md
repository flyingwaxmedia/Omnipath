# Omnipath v3 — Integration contract (six parallel lanes)

Owner feedback driving v3 (verbatim): *"The skill system, especially equipping is confusing, everything needs to be
simple and intuitive, not ai data driven explanations. When you have a class unlocked it should auto equip related
skills when you switch or are that class."* Still binding: tap-to-move (no joystick), skills get a star chart, every NPC
has quests and trainers teach only as quest rewards, the player sprite matches the worn class, learned skills work with
any weapon (5 class slots + 3 own slots), AUTO is one switch for every skill including the basic attack.

Read with: docs/CLIENT-v3.md (what to build), docs/UX-SIMPLE.md (binding words and layout rules), docs/SPEC-v2.md §5.1
(class slots), docs/QUESTS.md (§3 SkillBook quest API, §5 client), docs/QUALITY-PLAN.md (Phase A), docs/ART-DIRECTION.md,
docs/VFX.md §8 (what the VFX runtime needs from the bus).

The foundations below are already in the tree and green (`tsc`, `vitest`, `npm run build`, the Playwright playtest):
named depth layers, the game event bus with emits in every system, GameController v3 with working views, and one seam
per lane so no lane edits another lane's file.

## 1. Rules for every lane

1. **Edit only files you own** (§2). The few shared edits are listed per lane, with the exact place. If you need
   something from another lane, use what exists (stubs return sensible data) and write the request in your report.
2. **Never run git commands that change state** (no commit, stash, checkout, reset, add). Other agents commit WIP.
3. **Re-read a file right before editing it**; prefer small, exact edits. Scratch files go in the session scratchpad,
   never in the repo.
4. **Off limits to all six lanes** (other agents are working there right now): `src/game/art/icons.ts`,
   `src/game/art/ui.ts` (art agent), `src/game/vfx/**`, `tests/vfx*.test.ts`, `docs/VFX.md` (VFX agent),
   `scripts/playtest.mjs`, `docs/screenshots/**` (playtest agent). Import their exports read-only.
5. **Core stays engine-agnostic**: `src/core/**` and `src/data/**` are frozen except the two shared edits granted to
   the game lane (§2.3). No Phaser, DOM, `Math.random` or `Date.now` in core.
6. **Contracts are append-only while lanes run**: `src/ui/controller.ts`, `src/game/events.ts` and
   `src/game/render/depths.ts` only ever gain members; nothing is renamed, removed or re-typed. Every exported
   function / type another lane imports (listed in §2 per owner) keeps its signature.
7. **Words**: every player-facing string follows docs/UX-SIMPLE.md and the friendly-name table (§7). In-world text has
   no emoji (bitmap pixel font): use `icon_*` textures.
8. **Keep it green**: `npx tsc --noEmit`, `npx vitest run`, `npm run build` must pass when you stop; run the
   Playwright checks in §8.
9. **Your words live in your files.** Every player-facing string a lane's own files produce is that lane's to rewrite
   per docs/UX-SIMPLE.md — the game lane owns the intro dialog (MapScene.create), every NPC / object line and option
   label (Interactions), and the toasts / logs / floating text in MapScene, Combat, SkillSystem, Interactions; the
   panels lane owns announce.ts, dialogs.ts and the panels; the HUD lane owns the HUD's labels and the AUTO toasts in
   ui.ts. A message that needs words from another lane goes over the bus (e.g. `barChanged.reason`, §4) or the
   controller, never by editing that lane's file.
10. **CSS**: a new stylesheet is imported from your own TS module (never from `src/main.ts`), its selectors are
    scoped under your own root (`.hud-layer …`, `.starchart …`, `.picker …`), and you override another lane's rules
    from your own file instead of editing theirs. Use `var(--font-ui)` / `var(--font-small)` and the `uiCss` frame
    properties.
11. **Tests run in node** (`environment: 'node'`, no jsdom / happy-dom, and only the render lane installs packages):
    test pure functions, layout maths and HTML-string builders; drive the DOM with Playwright (§8).
12. **Keep the selectors the playtest drives** (§8.1) — or keep the old one working beside the new one and name the
    replacement in your report (the playtest agent owns scripts/playtest.mjs).

## 2. Lanes and ownership (every file under src/game/** and src/ui/** that a lane touches has exactly one owner)

### 2.1 render
Owns: `src/game/render/**` (`depths.ts`, `stage.ts`, `text.ts`, `fonts.ts`, `config.ts`, `ground.ts`, `dressing.ts`,
`autotile.ts`, new files), `src/game/textures.ts`, `src/game/scenes/BootScene.ts`, `src/game/art/tiles.ts`,
`src/game/art/world.ts`, `src/game/art/dressing.ts`, `src/game/art/common.ts`, `src/game/art/pixel.ts`,
`src/ui/styles/fonts.css` + `src/ui/styles/render.css` (new: font faces, the `#game canvas` pixel-scaling rules — base.css
keeps only `#game canvas { display: block }`), `index.html` (boot splash markup), `public/**` (font licences),
`tests/depths.test.ts`, `tests/render*.test.ts`.
Shared edits: `package.json` / `package-lock.json` — ONLY `npm install @fontsource/pixelify-sans @fontsource/tiny5`
(the render lane is the only lane that installs packages).
Exports others import (keep signatures): `DEPTH`, `ySort`, `Y_BIAS`, `WORLD_MAX` (depths.ts); `buildStage`, `Stage`,
`StageHost`, `Insets` (stage.ts); `WorldText`, `worldLabel`, `WorldLabel`, `LabelStyle` (text.ts); `createGame(scenes,
reg?)`, `REGISTRY_KEY`, `bootRegistry(scene)` (config.ts); `generateTextures`, `PRISM_SOCKETS`, `PRISM_GATE_SIZE`
(textures.ts); `pixelTex`, `textureDataUrl`, `PAL` (art/pixel.ts).
Also yours: `drawIcons(this, bootRegistry(this)!)` + `drawUi` in boot (icons are generic until then — iconUrl needs the
registry), injecting `uiCss(scene)` once, removing the boot splash before `'omnipath:ready'`, converting
`StageHost.safeInsets()` (CSS px) to art px in the stage, and a safety net in text.ts that drops glyphs the bitmap
font lacks (emoji) instead of drawing boxes. textures.ts switches to art/characters.ts `drawCharacters` /
art/monsters.ts `drawMonsters` (actors keep their signatures and the v2 keys).

### 2.2 actors
Owns: `src/game/entities/**` (`Player.ts`, `Monster.ts`, `actors.ts`, new files), `src/game/art/characters.ts`,
`src/game/art/monsters.ts`, `src/game/art/classLooks.ts` (new), `tests/actors*.test.ts`, `tests/class-looks*.test.ts`.
Shared edits: none.
Keep stable (used by the game lane): every public member of `Player` and `Monster` used outside `entities/`
(position, path, facing, aimAngle, moving, timers, statuses, `sprite`, `shadow`, `bar`, `aura`, `label`, `castBar`,
`setWeapon`, `face`, `attackAnim`, `setCast`, `sync`, `hurt`, `flash`, `restoreTint`, `stepToward`, `moveTo`, `reset`,
`destroy`, `shiftTime`…; `sprite` may become a `Phaser.GameObjects.Sprite`), the constructor signatures, and
`actors.ts` exports `createActors`, `Actors`, `createNpcActor`, `NpcActor`, `registerActorAnims`, `playerLookKey`.
Keep stable (used by the render lane's textures.ts / BootScene): `drawCharacters(scene)`, `CHAR_ANIMS`, `CHAR_W`,
`CHAR_H` (art/characters.ts), `drawMonsters(scene)`, `MONSTER_ANIMS` (art/monsters.ts), and every v2 texture key
(`player_<w>` + its frames, each `NpcDef.texture`, monster keys).
Also yours: quest markers refresh on the bus (`questChanged`, `levelUp`, `skillLearned`, `classChanged`) plus a ≤ 1 Hz
re-check (elements, flags and bag changes also unlock quests and have no bus event; `book.questMarker` is indexed and
cheap); the look switch on `classChanged` (wear, become, "No class", discovered-and-worn) and in `Player.setWeapon`.

### 2.3 game
Owns: `src/main.ts`, `src/game/scenes/MapScene.ts`, `src/game/session.ts`, `src/game/views.ts`, `src/game/events.ts`
(append-only), `src/game/systems/**`, `src/game/world/runtime.ts`, new `src/game/loadout.ts` / `src/game/quests.ts` /
`src/game/*.ts`, `src/ui/controller.ts` (append-only), `tests/events.test.ts`, `tests/loadout*.test.ts`,
`tests/game*.test.ts`.
Shared edits: `src/data/trainers.ts` — add `questOnly: true` to every LessonDef (and fix `tests/trainers.test.ts` /
`tests/quests.test.ts` expectations that assumed buyable lessons); `src/core/skillbook.ts` — add ONE method
`unwear(): BookOutcome` right after `wear()` (worn → null, invalidate caches, re-evaluate classes), tested in
`tests/loadout.test.ts`.
Exports others import: `HOTBAR_SIZE`, `Session`, `Stats`, `WorldState`, `expToNext` (session.ts); `gameBus`, event
types (events.ts); `discoveredRoute`, `TILE`, fog / portal helpers (world/runtime.ts).
Also yours (nobody else can do these): the class-slot refill on `becomeClass` / `wearClass` (both go through one
path), on "class discovered and worn" (MapScene.wireEvents) and on load when a class is worn but its slots are empty;
the matching-skill update when a skill is learned (replacing `Session.autoSlot` for class slots); the `reason` /
`skillId` / `classId` on every `barChanged` you emit (§4 — announce.ts turns them into toasts); `book.refreshQuests()`
after every bag change (obtain, sell, use, gather, drops, turn-in); flipping `questOnly`; the `// LANE game:` spots in
views.ts (incl. `unlocks` / `badges` refinements and the element card's one step); the VFX bus additions (§4); the
new controller members' behaviour (§5); the words of your files (§1.9).

### 2.4 hud
Owns: `src/ui/hud.ts`, `src/ui/ui.ts`, `src/ui/minimap.ts`, `src/ui/picker.ts`, `src/ui/hud/**` (new),
`src/ui/styles/hud.css`, `tests/hud*.test.ts`.
Shared edits: none (restyle the minimap from hud.css with `.hud-layer .minimap …` selectors; maps.css belongs to panels).
Keep stable: `UI` methods the game calls (`tick`, `mapChanged`, `banner`, `sparkBanner`, `headline`, `npcDialog`,
`setTarget`, `setChannel`, `setCast`, `log`, `toast`, `renderHotbar`, `pulseSlot`, `safeInsets`, `updateVitals`,
`dialog`, `discovery`, `open`, `close`, `refresh`, `isOpen`, `current`, `forgeMinigame`, `fishingMinigame`); hud.ts
exports `SPARK_RUNE`, `MENU`, `LogKind`, `CastInfo`, `TargetInfo`; `HUD_PANELS` (picker.ts); UI keeps implementing
every `PanelHost` member (panels/common.ts).
Also yours: subscribing `ctrl.onChange` ONCE in ui.ts (bar, Pursuits, portrait, stat strip, then `refresh()` of an open
panel); the Skills button → `open('skills')` (the Star Chart), an empty own slot → `open('picker', '<slot>')`, a class
slot → `open('skill', id)`; the ☰ menu (HUD panel `menu`: New game with a one-line confirm, and only what exists);
hiding Fuse until `ctrl.unlocks().fusion`; badges from `ctrl.badges()`; rendering toasts / banners / headline (the
words come from announce.ts); one-time hints through `ctrl.firstTime(key)`; the FULLSCREEN merge in ui.ts (done for
STARCHART_FULLSCREEN + PANELS_FULLSCREEN; a full-screen HUD panel joins it there).

### 2.5 starchart
Owns: `src/ui/panels/starchart.ts`, `src/ui/panels/skills.ts`, `src/ui/starchart/**` (`data.ts`, `layout.ts`,
`card.ts`, `index.ts`, new files), `src/ui/styles/starchart.css` (new, imported from starchart.ts),
`tests/starchart*.test.ts`.
Shared edits: none.
Keep stable: skills.ts exports `sheet`, `pips`, `rune`, `elChip`, `socketsHtml`, `weaponPath`, `pathOf`, `PathNode`
(panels and dialogs import them); `buildStarChartData` + `StarChartData` (data.ts — the game serves it through
`ctrl.starChartData()`); `STARCHART_PANELS`, `STARCHART_FULLSCREEN` (index.ts); the `skills` panel args other lanes
already pass (§3.1: a skill id, `tree:<weapon>`, and `ui.state['skills.tab']` preset to `passives` / `essences` by
dialogs.ts).
Also yours: the star card for every star kind — skills and variants through `ctrl.skillCard(id)`, element stars through
`ctrl.skillCard('el:<id>')` (`kind: 'element'`); the Passives / Essences tabs only after `ctrl.unlocks()` says so. The
star card has no per-skill "Auto-cast toggle" (owner: AUTO is one switch for every skill) — its one action is
Equip / Equipped ✓ / Transform / the next step.

### 2.6 panels
Owns: `src/ui/panels/{altar,bag,classes,codex,common,index,map,npc,trainer}.ts` + new panel files (quests, rewards…),
`src/ui/dialogs.ts`, `src/ui/announce.ts`, `src/ui/words.ts`, `src/ui/title.ts`, `src/ui/worldmap.ts`, `src/ui/util.ts`,
`src/ui/styles/base.css`, `panels.css`, `dialogs.css`, `maps.css`, `tests/panels*.test.ts`, `tests/words*.test.ts`.
Shared edits: none.
Keep stable: util.ts exports (`esc`, `$`, `$$`, `hex`, `bandText`, `shapeText`, `sourceText`, `gate`) — the game imports
them; `PanelHost`, `PanelRender`, `tabsHtml`, `wireTabs`, `tab`, `reqList`, `costText`, `armTwice` (common.ts);
`DialogOption`, `DiscoveryCard`, `wireDiscoveryCards`, minigames (dialogs.ts); `openNpcDialog` (npc.ts); `PANELS`,
`PANELS_FULLSCREEN` (index.ts); `wireAnnouncements`, `AnnounceHost` (announce.ts); every words.ts export; base.css
tokens (`--font-ui`, `--font-small`, colours). `PanelHost` (common.ts) is frozen: a new member must already exist on
UI (src/ui/ui.ts, HUD lane) or be optional — it now also carries `discovery`, `headline`, `log`, `refresh`.
Also yours: every message for game events (announce.ts: quest accepted / progress (throttled) / ready / reward card,
"You are now a Pyroblade", the `barChanged` toasts "Pyroblade equipped Flame Spin" / "Flame Spin is on your bar"); the
class discovery card with its one **Become** button (`ctrl.becomeClass(id)`); avoiding a double card when a quest
reward teaches a skill (the book's `learned` card and the reward card); the Codex Quests tab once
`ctrl.unlocks().quests`; Keepsakes once `ctrl.unlocks().keepsakes`.

Unowned and frozen: everything else under `src/` (core, data except the game lane's two edits), the core tests
(`tests/*.test.ts` not listed above, except the game lane's trainers / quests fixes), `vite.config.ts`,
`tsconfig*.json`, `scripts/build-single.mjs`, `README.md`, the external agents' files (§1.4), and every doc (lanes
report doc changes; docs/INTEGRATION-v3.md is the architect's).

Who does what (the cross-lane questions, one owner each):
| job | owner | where |
|---|---|---|
| quest markers over NPCs (draw + refresh) | actors | entities/actors.ts (bus + ≤ 1 Hz re-check) |
| refill class slots on become / wear / discovered-and-worn / load | game | views.ts / MapScene / session.ts |
| matching skill learned → class slot | game | MapScene.wireEvents (emits `barChanged` reason `classLearned`) |
| toast / banner WORDS for game events | panels | announce.ts |
| toast / banner / headline RENDERING | hud | hud.ts (`ui.toast`, `ui.headline`) |
| Skills button → Star Chart | hud | hud.ts `MENU` (`skills` → STARCHART_PANELS) |
| empty own slot → picker; class slot → skill card | hud | ui.ts `renderHotbar` |
| `questOnly: true` on every lesson + the tests that assumed buying | game | src/data/trainers.ts, tests/trainers.test.ts, tests/quests.test.ts |
| trainer panel → the NPC's quest list | panels | panels/trainer.ts |
| outfit switch on class change | actors | `classChanged` via `sceneScope` + `Player.setWeapon` |
| loop sleep under full-screen panels | render | render/config.ts (`uiOpen.fullscreen` / `uiClose`) |
| icons need the registry at boot | render | BootScene: `drawIcons(this, bootRegistry(this)!)` (main.ts passes `reg` to createGame — done) |
| `notifyQuest` from the bus | game | new src/game/quests.ts |
| intro dialog / NPC lines in plain words | game | MapScene.create, Interactions |

## 3. Seams — how each lane plugs in without touching the others

| seam | call site (owner) | implemented in (owner) |
|---|---|---|
| Phaser config, pixel scaling, fonts | `src/main.ts`: `createGame([BootScene, MapScene], reg)` (game) | `render/config.ts` (render) — the render lane adds there: `gameBus` `uiOpen` with `fullscreen` → `game.loop.sleep()`, `uiClose` → `wake()` |
| Boot | `BootScene.create()` (render) calls `registerActorAnims(this)` after textures | `entities/actors.ts` (actors) |
| Registry at boot | `createGame(scenes, reg)` stores the content registry in `game.registry` (`REGISTRY_KEY`) — done | BootScene reads `bootRegistry(this)` for `drawIcons(this, reg)` (render) |
| World art + camera | `MapScene.create()`: `this.stage = buildStage(this, this)`; `stage.follow(player, x, y)`; `stage.fit({x,y})` after `ui.mapChanged()`; `stage.update(dt, player)` per frame; `stage.destroy()` on shutdown (game) | `render/stage.ts` (render): ground (→ `bakeGround`), dressing (→ `placeDressing(planDressing(cm))`), props + culling, structures, darkness, background, zoom / bounds / follow. MapScene is the `StageHost` (`cm`, `def`, `safeInsets()`) |
| In-world text | `MapScene.floatText()` → `this.text.float()`; `MapScene.label()` → `worldLabel()` (game) | `render/text.ts` (render): switch to the boot-baked bitmap font in one place |
| NPC sprites | `MapScene.buildNpcs()`: `createNpcActor(this, def, x, y)` → `{ sprite, shadow, label }` (game) | `entities/actors.ts` (actors): 2-frame idle anim, name tag via `worldLabel` |
| Markers, chevron, looks, anims | `MapScene.create()`: `this.actors = createActors(this)` after player / NPCs / monsters; `actors.update(dt, now)` per frame; `actors.destroy()` on shutdown (game) | `entities/actors.ts` (actors): reads `scene.npcs`, `scene.player`, `scene.combat.monsters/target`, `scene.book.questMarker()`; subscribes to the bus (`questChanged`, `classChanged`, `skillLearned`, `levelUp`, `castFire`) through `sceneScope(scene)`, plus a ≤ 1 Hz marker re-check from `update()` |
| Weapon look | `MapScene.equipWeapon()` calls `player.setWeapon(w)` (game) | `Player.setWeapon` applies `playerLookKey(scene, w, worn)` (actors) |
| Portrait / outfit art | `ctrl.portraitUrl()`, `ctrl.outfitUrl(classId)` (game, views) | `playerLookKey()` (actors) — generate `player_<w>__<classId>` lazily |
| Panels | `ui.open(name, arg)` (hud owns ui.ts) merges three registries | `PANELS` panels/index.ts (panels), `STARCHART_PANELS` starchart/index.ts (starchart), `HUD_PANELS` picker.ts (hud) |
| NPC dialog | `Interactions.say()` → `ui.npcDialog(view: NpcDialogView)` (game builds line + role options) | `openNpcDialog(host, view)` panels/npc.ts (panels): adds the NPC's quests from `ctrl.npcQuests(npcId)` |
| Messages for events | the UI calls `wireAnnouncements(this, ctrl)` once (hud) | `src/ui/announce.ts` (panels): logs, toasts, cards, `ui.headline("You are now a Pyroblade")`; `MapScene.wireEvents()` keeps only game effects |
| Star chart data | `ctrl.starChartData()` (game) | `buildStarChartData(reg, book)` starchart/data.ts (starchart) — the starchart lane changes the shape freely |
| Views | every v3 controller method is a one-line delegation in MapScene (game) | `src/game/views.ts` (game) |
| Change feed | `ctrl.onChange(fn)` (game: bar / class / quests / skills from the bus + book) | ui.ts subscribes ONCE (hud): re-renders the bar, Pursuits, portrait, stat strip, then `refresh()` |
| Class slots | `becomeClass` / `wearClass` / class discovered-and-worn / load refill the class slots and emit `barChanged {reason: 'class', classId}`; a learned matching skill emits `barChanged {reason: 'classLearned', skillId, classId}`; a skill dropped into an empty own slot `{reason: 'learned', skillId}` (game) | announce.ts words the toasts (panels); `classChanged` → headline (panels) + outfit (actors); the bar re-renders through `onChange('bar')` (hud) |
| Full-screen panels | ui.ts merges `STARCHART_FULLSCREEN` + `PANELS_FULLSCREEN` into `uiOpen.fullscreen` (hud — done) | each registry owner lists its own full-screen panels; render/config.ts sleeps the loop (render) |
| Progressive disclosure | `ctrl.unlocks()`, `ctrl.badges()` (game) | HUD buttons (hud), Star Chart tabs (starchart), Codex / Class screen sections (panels) — nobody reads core internals for it |
| One-time hints | `ctrl.firstTime(key)` → true once per save (game) | whoever shows the hint (hud / panels / starchart) |

### 3.1 Panel names (ui.open) and their args
| name | owner | arg |
|---|---|---|
| `skills` | starchart | none (last tab, default Chart); a tab id `chart` / `skills` (the List — keeps `data-tab="skills"`, the playtest clicks it) / `passives` / `essences`; `star:<skillId>` (centre on it); `card:<skillId>` (back from the picker: the same tab with that star's card open, the camera where it was); and the v2 args other lanes already pass: a skill id (→ that skill's card or detail) and `tree:<weapon>`. dialogs.ts presets `ui.state['skills.tab']` = `passives` / `essences` before opening it |
| `skill` | starchart | skill id, or `el:<element>` → the simple card (`ctrl.skillCard`) |
| `picker` | hud | `<slot>` (choose a skill for that own slot) or `skill:<id>` (choose the own slot for that skill; after the pick it goes back where it was opened from — the Star Chart with that card (`skills` `card:<id>`), the `skill` card, or the NPC dialog — else to the world; ui.ts records the panel it was opened over in `ui.state['ui.from']`) |
| `classes` | panels | optional class id to focus |
| `codex` | panels | tab id; `quests` or `quests:<questId>` opens the quest log on that quest |
| `trainer` | panels | NPC id → that NPC's quest list (lessons are never bought) |
| `npc` | panels (optional) | NPC id — only if the NPC dialog becomes a re-renderable panel; `ui.npcDialog` stays the entry point |
| `bag` | panels | `sell` |
| `map` | panels | `travel` / `route` |
| `altar` | panels | — |
| `menu` | hud | — (the ☰ button: Sound On/Off + Volume, "Reduce shake & flashes", New game with a one-line confirm) |
New names (quest reward card, …) go into the owner's registry and must not collide. `STARCHART_FULLSCREEN` and
`PANELS_FULLSCREEN` name the panels that hide the world (`uiOpen.fullscreen`).

## 4. Depth layers (`src/game/render/depths.ts`) and the game event bus (`src/game/events.ts`)

Every `setDepth` in src/game/** uses `DEPTH.*` or `ySort(footY, Y_BIAS.*)` — never a bare number. Bottom → top:
BACKDROP −110000 · GROUND −100000 · GROUND_DECAL −60000 · PORTAL_DECAL · HIDDEN_DECAL · DRESSING_FLAT −50000 ·
MOVE_MARKER −49000 · AIM_PREVIEW −41000 · TELEGRAPH −40000 · SHADOW −30000 · AURA −29000 · TARGET_RING −28900 ·
FX_GROUND −20000 · **y-sorted band 0…80000** (`ySort(y, bias)`, biases PROP −4, DOOR −2, BEHIND −1, GHOST/GEM +1,
GEM_GLOW +2, PROJECTILE +20, PARTICLE +30, ARC +40, PILLAR +50) · CANOPY 90000 · RIM 99000 · FX_FRONT 99500 · NAME_TAG
100000 · HP_BAR 100010 · MARKER 100020 · FX_GLOW 100050 · CAST_BAR 100100 · STATUS_ICON 100110 · CHEVRON 100120 ·
DARKNESS 150000 · LIGHT 150001 · LIGHT_TOP 150002 · TELL_TOP 150010 · WORLD_TEXT 200000 · SCREEN_FX 210000.
Collisions fixed: the move marker vs flat dressing, the player's aim preview vs monster telegraphs (danger on top),
shadows / auras / ground FX no longer y-relative (−1000 / −999 / −900 offsets), labels vs HP bars vs additive FX (all
were 100000), monster rims vs the band (clamped band below CANOPY < RIM), projectiles' first frame at depth 0.

**Bus**: `gameBus` (run-wide; `on` / `off` / `once` / `emit` / `has` / `count` / `clear`; a throwing listener is
reported and skipped). Per-map listeners use `sceneScope(scene).on(...)` — cleared on the scene's SHUTDOWN. Payloads
may hold scene objects (Monster, images, movers): never keep them past their map. `Actor = 'player' | Monster`.
Every skill event carries `SkillRef { skillId, skill, element?, castId? }` (`castId` links the parts of ONE player cast).

| event | payload (besides SkillRef where marked ★) | emitted at |
|---|---|---|
| hit ★ | source 'player', target Monster, x, y, damage, crit, resisted, multiplier, combo?, killed, hitIndex (0 = engaged cast), ang | Combat.hit (also resisted, damage 0) |
| dotTick | target, damage, kind, x, y | Combat.updateMonster DoT tick |
| kill | monster, def, x, y, exp, coins, elite, warden | end of Combat.kill (rewards, quests) |
| death | target Actor, x, y, rank? (monster), from? + expLost? (player) | Combat.kill (after kill) / Combat.die |
| castStart ★ | x, y, aim, target, durationMs, auto | Combat.castSkill when a wind-up starts |
| castFire ★ | x, y, shape, aim, target, rank, basic, map | Combat.fire (once per cast: SP paid, cooldown started) |
| projectileSpawn ★ | owner, obj (image), mover (live record), x, y, angle, speed, range, size | SkillSystem.spawnProjectile, MonsterSkills.shoot |
| projectileEnd ★ | owner, obj, mover, x, y, reason 'hit' / 'expire' / 'wall' / 'caught' | both projectile update loops |
| chainHop ★ | owner, from, to, index, target Actor, knives | SkillSystem.chain (each hop, before its hit); MonsterSkills chain zap |
| novaTelegraph ★ | owner, x, y, radius, delayMs, timing {start, at} | SkillSystem nova marker |
| novaBlast ★ | owner, x, y, radius, heavy | SkillSystem / MonsterSkills nova detonation |
| dash ★ | owner, from, to, durationMs, width, spin | SkillSystem.dash, MonsterSkills sweep |
| buffApplied ★ | target Actor, stat, amount, durationMs, x, y | Combat.applyBuff, MonsterSkills buff |
| statusApplied | target Actor, kind, x, y, blocked? | Combat.applyStatus / applyPlayerStatus |
| combo ★ | target, name, consumes, x, y | Combat.applyCombo |
| heal | amount, source 'leech' / 'smite', x, y | Combat.hit (leech), applyStatus (smite) |
| playerHurt | damage, hp, maxHp, from, origin?, heavy, dot?, x, y | Combat.hurtPlayer, tickPlayer |
| levelUp | level, x, y | Combat.gainExp (per level) |
| gather | node, item, total, x, y, map | Interactions.node payout |
| mapEnter | map, first, x, y | MapScene.enterMap (every entry) |
| warp | from, to | MapScene.warp |
| talk | npcId, map, x, y | Interactions.npc (before the dialog) |
| interact | kind npc / object / node / portal, id, x, y, map | Interactions.act |
| questChanged | questId, reason accepted / progress / ready / completed / abandoned / tracked | Session (book quest events), views (abandon, track) |
| uiOpen / uiClose | panel, arg?, fullscreen / panel | ui.ts open / dialog / minigame; close / last card dismissed |
| discovery | kind, title | ui.ts when a card is shown |
| classChanged | classId, prev, reason wear / discovered | MapScene.wearClass, classDiscovered (worn) |
| skillLearned ★ | source | Session (book 'learned') |
| barChanged | slots, reason? (`assign` / `clear` / `learned` / `class` / `classLearned` / `load`), skillId?, classId? | MapScene.assignSlot, Session.autoSlot (game lane: every refill / auto-equip with its reason) |
| spark | from, to | Session (book 'spark') |
| monsterTelegraph ★ | monster, shape, x, y, at, durationMs, radius?, echo; VFX: id?, timing?, tell?, rank? | MonsterSkills.start |
| skillPulse ★ | owner, index, count, ang, aim?, x, y | **declared, not emitted yet** — game lane: SkillSystem.run per swing / pulse / release / launch; MonsterSkills swing / pulse |
| monsterTelegraphEnd | id, monster, reason 'resolve' / 'cancel' | **declared, not emitted yet** — game lane: MonsterSkills resolve / cancel |
| enrage | monster, x, y | **declared, not emitted yet** — game lane: MonsterSkills.enrage |

**VFX requests** (docs/VFX.md §8.2; the VFX bridge adapts flat payloads itself). They are now DECLARED in events.ts
with the names docs/VFX.md and src/game/vfx/types.ts use — the game lane only adds the emits / fills the fields, never
renames: `skillPulse` (each strike swing, spin pulse, nova release, volley launch of one cast, player and monster);
`castId` on castStart (reserve the cast id at wind-up) and `reprise` on SkillRef; projectile `id` + `index` / `count`
(and `id` on projectileEnd); `monsterTelegraph.id` / `timing` (the live pending record) / `tell` (`TellShape`, exact
hit-test geometry) / `rank`, and `monsterTelegraphEnd {id, reason}` for resolve / cancel; `untilMs` on statusApplied /
buffApplied and `source` on statusApplied; `hit.via` / `hit.from` (arc zaps, pierce, return); `spreadTo` on combo;
`heal.from`; `spark` x / y; `enrage`; `death.killer` (the killing cast). Monster blows on the player stay
`playerHurt` (`hit` keeps `source: 'player'` — re-typing it would break listeners) and gain `attacker?`, `skillId?`,
`skill?`.

## 5. GameController v3 (`src/ui/controller.ts`; views in `src/game/views.ts`)

All v2 methods stay. Added (plain-language view types are in controller.ts; ids are keys only):
- `onChange(fn(what: 'bar'|'class'|'quests'|'skills')) → off` — run-wide change feed (subscribe once).
- `barSlots() → BarSlotView[]` {index, skillId, kind 'class'|'own', classId?, key '1'..'8'; filled slots also name,
  rank, maxRank, element?, transformReady} — the bar never needs core internals.
- `equipSkill(skillId, slot?) → Outcome` (first empty own slot; full → message, open the picker `skill:<id>`).
- `clearSlot(slot)`; `slotPicker(slot) → SlotPickerView` {slot, current, choices [{skillId, name, fresh, slot}]} newest first.
- `skillCard(id) → SkillCardView` {kind? 'skill'|'element', name, line, element, known, rank, maxRank, progress,
  cooldown s, sp, transformReady, action equip | equipped{slot, byClass?} | transform{to, toName} | step{text} | none,
  next?, details[]}; `skillCard('el:<id>')` is an element star's card (The Heart).
- `starChartData() → StarChartData` {stars, links, charted, total} (owned by the starchart lane's data.ts).
- `classCards() → ClassScreenView` {current, unlocked[], locked[] (with ONE hint), canChange, changeHint?}; each card
  {id, name, line, state, level, maxLevel, levelProgress, hint?, color, skills[5]}.
- `becomeClass(id | null) → Outcome`; `wornClass() → WornClassView | null` {name, level, maxLevel, progress, color}.
  Rule (SPEC-v2 §5.1 v3.1 "any time, instant"): becoming a class works anywhere — the class discovery card's
  **Become** must work in the field; the game lane may block it only mid-fight or while dead, and then `canChange` is
  false with a one-line `changeHint` ("Finish the fight first."). `wearClass(id)` follows the same path (refill
  included), so v2 callers stay correct.
- `npcQuests(npcId) → NpcQuestsView` {name, title, portrait, quests [QuestCardView + dialog line]}.
- `acceptQuest(id, npcId)`, `turnInQuest(id, npcId) → QuestTurnInView` {ok, message, rewards}, `abandonQuest(id)`,
  `trackQuest(id, on)`; `questLog() → {active, available, done}`; `questMarker(npcId) → '!' | '?' | '…' | null`;
  `questCard(id) → QuestCardView | null` (log focus, progress toasts, reward previews).
- `pursuits() → PursuitView[]` tracked quests first, then ≤ 2 goals: {key, kind, title, ONE line, progress?, ready?,
  icon?, open {panel, arg}}.
- `zone() → ZoneView` {name, tag Safe|Hunting|Dungeon|Warden, band, explored %, sources, warden}.
- `quickSlots() → {heal, recall, potion}` with counts; `useQuick(kind)`; `cycleTarget()`.
- `unlocks() → UnlocksView` {fusion, essences, passives, classes, keepsakes, quests} — progressive disclosure
  (UX-SIMPLE rule 7) read by every lane; `badges() → MenuBadgesView` {skills, classes, codex, altar} — gold dots.
- `firstTime(key) → boolean` — true once per save (flag `tip_<key>`): one-line "teach in the moment" hints.
- `iconUrl(kind, id)`, `pipUrl(kind, id)`, `uiUrl(key)`, `portraitUrl()`, `outfitUrl(classId | null)` — cached data URLs.
Working today: everything above except the spots marked `// LANE game:` in views.ts (becomeClass refill + "No class",
the any-time class change, the friendly wording of next steps / class hints / the element card's step, echo-witness
goals, rest, the "never worn" class badge).
`PanelHost` (panels/common.ts, implemented by UI) also gained `discovery`, `headline`, `log`, `refresh` — members UI
already had, so panels never need a cast. The bar is still 6 slots until the game
lane sets `HOTBAR_SIZE = 8` — read sizes from `barSlots()`, never hard-code 6 or 8.

## 6. Lane deliverables (summary; the full briefs are in the architect's report)

1. **render** — low-res backbuffer + integer CSS upscale, Scale.NONE, zoom 1, rounded scroll, resize; textures.ts calls
   every drawer in CLIENT-v3 §1 order keeping v2 keys; boot splash + time-sliced generation; pixel fonts + bitmap font
   for all in-world text; bakeGround + placeDressing in the stage; loop sleep under full-screen panels; inject `uiCss`.
2. **actors** — animated player / monster / NPC sprites, 30 class outfits (classLooks.ts, lazy `player_<w>__<id>`),
   look switch on wear / weapon / load, target chevron, quest markers, name tags via `worldLabel`.
3. **game** — HOTBAR_SIZE 8 with padded saves, class auto-equip + refill + matching-skill updates, keys 1–8, quest hooks
   from the bus into `book.notifyQuest`, accept / turn-in with rewards, `questOnly` lessons, the `// LANE game:` views,
   VFX requests (§4), debug hooks.
4. **hud** — HUD v3 per CLIENT-v3 §2 (no joystick), 8-slot bar with class / own slots, picker, Pursuits, attack cluster,
   toasts / banners, EXP bar.
5. **starchart** — the Star Chart panel, pure tested layout, the simple skill card.
6. **panels** — Class screen, quest-aware NPC dialog, trainer → quest list, Codex Quests tab, UX-SIMPLE rewrite of every
   panel / card / toast / announcement.

The "Also yours" lines in §2 and the "Who does what" table are part of every brief.

## 7. Friendly names (player text only — ids unchanged; `src/ui/words.ts` `FRIENDLY`)
| internal | shown as |
|---|---|
| Class Rank / CR | Class Level |
| morph | Transform |
| morph charge | Transform ready ✨ |
| overmastery | Mastery bar (after max rank) |
| imprint | Keepsake |
| witness marks | "Seen 2/3" (`seen(marks, need)`) |
| spark | Sudden insight |
| essence slot | Rune socket |
| tag passive | Mastery bonus |
| resonance | Element bond |
| threat / grey XP | "Too weak to learn from" (only when it happens) |
| class slots / own slots | Class slots (class emblem) / Your slots |
| tier, tags, ids, clauses, formulas, requirement lists | never shown — one next step instead ("Reach rank 10 to transform.") |
Helpers: `stars(rank, max)` → ★★★☆☆, `article(name)` → "a Pyroblade" / "an Earthshaper", `plural`, `oneLine`.

## 8. Verification
```
npx tsc --noEmit
npx vitest run
npm run build                                    # final check only (writes the shared dist/)
```
Six lanes and the playtest agent run at once: never preview the shared `dist/` or port 4173 while lanes run. Build
into your scratchpad and preview it on your lane's own port (render 4181, actors 4182, game 4183, hud 4184,
starchart 4185, panels 4186):
```
npx vite build --outDir "$SCRATCH/dist" --emptyOutDir
npx vite preview --outDir "$SCRATCH/dist" --port 4184 --strictPort &
node scripts/playtest.mjs http://localhost:4184/ --quick --device phone   # also phone-landscape, ipad, ipad-portrait, desktop
```
Ad-hoc Playwright (scratch script outside the repo): `const { chromium } = require('playwright'); const b = await
chromium.launch();` — start a new game (`.title-screen .new`, fill `input.name`, `.wcard[data-w="sword"]`, `.go`), then
drive `window.omnipath.debug`:
`info()`, `warp(mapId, portal?)`, `give(item, n)`, `learn(skillId)`, `element(id)`, `setLevel(n)`, `heal()`, `fight()`,
`place(x, y)`, `walkToPortal(id)`, `portals()`, `assign(slot, id)`, `cast(slot)`, `listeners()` → {book, bus, resize,
sceneEvents} (warping must not grow them), and the v3 views `bar()`, `quests(npcId?)`, `classes()`, `pursuits()`,
`card(skillId)`, `stars()`, `tapBus(on)` (counts every bus event until `tapBus(false)`). `window.omnipath.ui.open(name,
arg)` opens any panel; `window.omnipath.scene` is the GameController. No console errors, no page errors.

### 8.1 Selectors the playtest drives (keep them, or keep the old one working and report the new one)
| selector | owner | what the playtest does |
|---|---|---|
| `.title-screen .new` / `.cont` / `.go`, `input.name`, `.wcard[data-w="<weapon>"]` | panels (title.ts) | new game / continue |
| `.menu button[data-panel="<name>"]` for `skills`, `altar`, `classes`, `codex`, `bag`, `map` | hud | opens every panel on a FRESH game, then clicks every `.tabs .tab[data-tab]` in it — hiding Fuse until the first element (UX-SIMPLE rule 7) breaks this loop: the HUD lane names it in its report so the playtest agent grants an element first (`debug.element('fire')`) |
| `.sheet .x` | hud (ui.ts `sheet`) | closes a panel — every sheet, the Star Chart included, keeps it |
| `.tabs .tab[data-tab="skills"]`, `.skill-card` → `.skill-head`, `.sheet .back` | starchart | the List tab keeps id `skills`; a skill card opens a detail with `.skill-head` and a `.back` |
| `.dialog [data-opt="<i>"]` (index in the game's option order: Brann's forge and Alba's blessing are option 0) | panels (dialogs.ts / npc.ts) + game (Interactions builds the options) | quest rows get their own attributes (`data-quest`), never shift the role options' indices; the game keeps option 0 of Brann / Alba |
| `.discovery .ok` | panels (dialogs.ts) | dismisses cards (a card with a Become button keeps `.ok` as its "Later") |
| `.minigame .strike`, `.minigame .reel`, `.bob.bite` | panels (dialogs.ts) | forge / fishing minigames |
| `.toast`, `.zone-banner b`, `#hud-root button` ≥ 44 px | hud | toast / zone checks, touch-target sizes |
| `<html>` inline `--ui-px` vs `window.omnipath.render.scale()` | hud | the HUD's pixel = the world's (`--ui-px` × dpr = k, whole device px) |
| `window.omnipath.render.asleep()` | render | the loop sleeps under the Star Chart, wakes for a card over it, sleeps again after it |
| `.sc-card[data-card="<id>"] .sc-act > :is(.sc-primary, .sc-done, .sc-step)`, `[data-act="equip"]` | starchart | a star card shows ONE action; Equip with every own slot full opens the picker |
| `[data-become="<classId>"]` | panels (classes.ts) | Become a class → the class slots fill (`debug.bar()`) |
| `.hotbar .slot.own.empty[data-slot]`, `.picker-sheet .pk-tile[data-skill]` / `[data-slot]` | hud | tap an empty own slot → picker → equip; the `skill:<id>` picker → back to the card |
| `.cluster .rb.auto` (`.on`), `.cluster .atk.auto` | hud | AUTO on / off |
| `debug.npc('hale')` + `.dialog [data-accept="hale_first_drill"]` / `[data-complete=…]` / `[data-equip-skill="rising_kick"]` | panels / game | lessons are quest rewards: accept in Hale's dialog, `debug.complete` + the basic attack to rank 3, Complete → Rising Kick learned and on the bar (Equip → picker → back to the dialog when the own slots are full). `[data-lesson]` stays on the quest that teaches a lesson |
