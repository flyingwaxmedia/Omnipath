# Omnipath v3 — Client Build Specification

v3 is the presentation pass driven by the owner's feedback:
1. **Look** like a lush, dense pixel-art mobile RPG (docs/ART-DIRECTION.md).
2. **Tap-to-move stays** — no virtual joystick.
3. **Skills get a star chart.**
4. **Every NPC has quests; trainers teach only as quest rewards** (docs/QUESTS.md).
5. **The player's sprite changes to match the worn class.**

6. **Sandbox loadouts** (docs/SPEC-v2.md §5.1): learned skills work with any weapon; the 8-slot skill bar IS the
   build — 4–5 similar skills make you a class, 2–3 slots are personal picks.

Everything in docs/CLIENT-v2.md still applies unless replaced here.

## 1. Art integration
- `src/game/textures.ts` calls, in order: `drawTiles` (art/tiles.ts — 2D atlas with variants + `tiles_edge`),
  `drawWorld` (art/world.ts — redrawn props/structures/objects/nodes/portals), `drawDressing` (art/dressing.ts),
  `drawCharacters` (art/characters.ts — players + NPCs with frames), `drawMonsters` (art/monsters.ts — 2 frames),
  `drawUi` (art/ui.ts), `drawIcons(scene, reg)` (art/icons.ts), effects. Keep the v2 keys working.
- Ground: `bakeGround(scene, compiled)` (render/ground.ts) replaces the tilemap layer; dressing:
  `placeDressing(scene, planDressing(compiled))` (render/dressing.ts). Both destroyed on scene shutdown.
- Animation: players play idle / walk (moving) / atk (on cast) from `CHAR_ANIMS`; NPCs idle 2-frame; monsters
  `MONSTER_ANIMS` (walk frames while moving, idle otherwise). Use Phaser `anims.create` once at boot.
- Camera zoom = clamp(shortSide / 560, 1, 2) (ART-DIRECTION §7). `pixelArt: true`, `roundPixels: true`.
- Target chevron `ui_chevron` above the current target and above monsters actively chasing the player.
- Floating text and name tags use the pixel font (bundled OFL font via npm `@fontsource/pixelify-sans`).

## 2. HUD v3 (`src/ui/hud.ts`, `src/ui/styles/hud.css`)
Layout per ART-DIRECTION §5 with **no joystick**:
- top-left portrait medallion (player head render) + level badge, framed "Lv N · Name", HP/SP bars with numbers, stat
  strip (ATK · MATK · DEF · worn class + CR);
- top-centre zone plate (name, safety tag Safe/Hunting/Dungeon/Warden, level band) with a slim strip (exploration %,
  local element-source icons, warden status);
- top-right row of framed buttons with labels: Skills (opens the Star Chart), Fuse, Class, Codex, Bag, Map, ☰ menu;
  the minimap is a small collapsible widget under that row;
- right edge **Pursuits** tracker: tracked quests (objective lines with progress) first, then up to 2 discovery goals
  (next morph, echo witness, nearest class); tap a quest → quest log; tap a goal → the relevant panel;
- left edge round buttons: quick heal (count), recall shard (count), rest;
- bottom-left compact log (3 lines, fades) above the EXP bar;
- bottom-centre horizontal skill bar: **8** framed slots (portrait: two rows of 4) with pixel icons (`iconUrl`), cooldown sweep, rank badge, element
  pip, AUTO ring (all slots while AUTO is on), spark rune; tap = cast;
- bottom-right attack cluster: big round attack button (`ui_round_big`), small round buttons on its arc: AUTO, Target
  (cycle to the next nearest enemy), Potion (count);
- full-width thin EXP bar at the very bottom with percentage.
Frames via `uiCss(scene)` custom properties (`border-image`), palette and font from ART-DIRECTION. Portrait and
landscape phones, iPad and desktop must all look intentional (portrait: tracker collapses to a tab, button row wraps
into two rows of 4, skill bar stays bottom-centre above the attack cluster).

## 3. Star Chart (`src/ui/panels/starchart.ts`, `src/ui/starchart/layout.ts`)
The Skills button opens the **Star Chart** (tabs: Chart | List | Passives | Essences — List/Passives/Essences are the
v2 skills panel views).
- **Sky**: a full-screen night-sky canvas (DOM canvas, DPR-aware) with faint star dust; drag to pan, pinch / wheel to
  zoom (0.5–2.5), double-tap to zoom in; constellation chips at the top centre the view; header "Stars charted N / M".
- **Constellations** (layout precomputed, deterministic, pure function in `layout.ts`, unit-tested):
  - the three weapon trees (13 stars each) — *The Edge* (sword), *The Fang* (dagger), *The Lantern* (staff) — root at
    each constellation's centre, T1 at r≈120, T2 at r≈240 (±18° per branch), T3 capstones at r≈360;
  - *The Heart* at the centre: the 7 primal elements in a ring, fused elements between their two parents;
  - *The Craft* (trainer techniques), *The Wild* (echo skills, grouped by region), *The Crown* (class signatures),
    universal skills near The Craft;
  - authored fusion results placed between their ingredients' stars (weighted midpoint + a deterministic offset to
    avoid overlap); generated variants as tiny satellite stars orbiting their base.
- **Lines**: morph edges in each tree (solid when both ends known, faint dotted toward revealed-but-locked targets);
  recipe edges from both ingredients to the result, drawn only once that recipe is discovered.
- **Star states**: known (bright, size by tier, colour by element — unaligned stars take their constellation's tint —
  with a mastery-ring arc showing rank/maxRank); mastered (gold halo); **morph available now** (pulsing); revealed but
  locked (dim outline + "?"; its requirements checklist on tap); unknown stars are drawn only as faint "?" when
  directly linked to a known star (one-step fog); recipe results stay hidden until discovered (a whispered hint shows a
  faint "?" near its ingredients).
- **Tap a star** → info card (pixel icon, name, rank bar, state text, requirement checklist, actions: Morph, Auto-cast
  toggle, Assign to hotbar, Details → v2 skill detail).
- Performance: draw only what is in view; ≤ 4 ms per frame on a mid phone; redraw on interaction/animation only.

## 4. Quests UI (docs/QUESTS.md §5)
- Markers above NPCs: `!` (gold) available, `?` (gold) ready to turn in, `…` (grey) active; updated on quest events.
- Talking to an NPC opens their dialog with their quests (offer → Accept/Later; active → progress lines; ready →
  Complete with reward preview). Trainers no longer sell lessons: the trainer panel becomes the NPC's quest list, and
  once the quest UI ships every LessonDef gets `questOnly: true`.
- Game events feed `book.notifyQuest`: kill, gather, visit (map entry), talk (NPC interaction), use (engaged cast),
  cast (any cast + map), witness.
- Codex gains a **Quests** tab: active (with objectives and track toggle), available (where/from whom), completed.
- Toasts: "Quest accepted", objective progress (throttled), "Ready to turn in — <NPC>", completion reward card (skills
  learned, coins, items, exp).

## 5. Class looks (`src/game/art/classLooks.ts`, entities)
- Every class (30) defines an original outfit: palette (primary / secondary / trim), armour type (cloth, leather,
  plate, robe), headgear (none, hood, wide hat, tall hat, helm, circlet, crown, horns, bandana…), cape (Tier II+),
  shoulder pieces, chest emblem, and an aura particle colour (Tier III). Novice = the default weapon look.
- Textures are generated lazily for (weapon × worn class) with the same frame set as the base player:
  `player_<w>__<classId>` (+ `_idle_1`, `_walk_0..3`, `_atk_0..1`), using the character module's look-based drawer.
- The player switches look on wear, on equip-weapon and on load; the class discovery card and the Class panel show an
  outfit preview.

## 6. Sandbox loadouts (docs/SPEC-v2.md §5.1)
- `HOTBAR_SIZE = 8`; saves pad old 6-slot bars; keys 1–8 cast, A toggles AUTO battle (docs/CLIENT-v2.md §6.1).
- `usable()` no longer checks the equipped weapon (only tier-0 basics are weapon-bound and never sit on the bar).
- Every skill-bar change (assign, clear, learn auto-slot, load) calls `book.setLoadout(hotbar ids)`; on
  `classActive` the player's outfit (§5) and the HUD class line update instantly, with a short "You fight as a
  <Class>" banner (or "Wanderer" when no class qualifies).
- Class panel: header = active class (or "No class — equip 4 similar skills"), the qualifying classes with a
  "Prefer" toggle, and for each discovered class a loadout line ("Equipped 3 / 4 blade skills") with a one-tap
  "Show matching skills" filter into the star chart / list. Wearing is replaced by preferring.
- Star chart + skill list: equipped skills are marked; a skill's info card lists the classes it counts toward.
- Pursuits tracker adds a loadout goal when a discovered or near class is 1–2 equipped skills away.
