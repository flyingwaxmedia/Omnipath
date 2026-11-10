# Omnipath — Art Direction v4 ("Lush Pixel", composed)

The owner supplied a reference screenshot of a mobile pixel-art RPG (kept outside the repo: it is another game's art). It is a
**direction**, not a template: we match its *qualities* (dense, outlined pixel art; earthy palette; ornate framed HUD;
horizontal skill bar; quest tracker) with **entirely original** assets, ornaments, layout details and names.
Never trace its sprites, icons or frames, never reuse its names, and never place UI elements pixel-for-pixel like it.

## 1. What the reference does well (the qualities we want)
1. **True pixel art**: hard-edged pixels, 1 px dark outlines on every sprite, 3–5 tone ramps per material, light from
   the top-left, no anti-aliased vector blobs, no soft gradients on sprites.
2. **Composition, not density**: big things tower (trees three to four heroes tall), props stack into groups and
   overlap, roads are lined in rhythm, and the fighting ground is kept clean so a dozen monsters read at once.
   Dressing follows rules (§3d); there is no density target — an even sprinkle is what reads as generated.
3. **Soft terrain borders**: grass meets dirt along an irregular, outlined edge (autotiling), never a staircase of
   squares.
4. **Readable characters**: chibi proportions (~2.5 heads), weapon silhouettes, name tags with outline, walk/attack
   animation, many monsters on screen with small target chevrons.
5. **Muted earthy palette**: olive greens, warm dirt, muted reds/pinks as accents, desaturated stone; the HUD uses
   dark brown + bronze/gold frames so the world stays the most colourful thing on screen.
6. **Framed HUD**: every widget sits in a bevelled bronze/wood frame; pixel font; icons are painted pixel art (not
   emoji).

## 2. Palette (v4 — SPEC-v4 §11.2 H; `RAMPS` in `src/game/art/pixel.ts`)
Every ramp is **hue-shifted**: shadows lean cool and violet, lights lean warm and yellow. Six steps, shared darks.
Never shade toward grey or black, never pillow-shade.

| material | shadow → highlight |
|---|---|
| grass | `#1f3b33` `#2f5435` `#47702f` `#6a8f36` `#93ab45` `#c4c765` |
| foliage | `#17302f` `#23483a` `#32663a` `#4f8a3c` `#86ad45` `#c9cf6a` |
| dirt / path | `#4a3340` `#6e4f48` `#94714f` `#b8955f` `#d9bd7c` `#efdc9e` |
| stone | `#2b2a40` `#454660` `#69708a` `#959aa6` `#c2c2b4` `#e8e2c6` |
| wood | `#2e1a26` `#4d2a2a` `#74432d` `#9c6534` `#c48e48` `#e3bb6c` |
| water | `#1b2f5a` `#23508a` `#2f7fa8` `#4fb0b8` `#9adcc8` `#e4f6e0` |
| roofs | terracotta `#4a1f33`…`#e89a52` · slate `#232a4a`…`#7a9cab` · thatch `#5a4326`…`#d9bd5e` · verdigris `#173b40`…`#74b890` |
| flower accents | crimson `#b8323a`, rose `#e0788a`, cream `#efe6c8`, violet `#8a6cc0` |
| UI frame | `#24180f` outline, `#4a3220` wood, `#7a5430` bevel, bronze `#b0803a`, gold highlight `#e9c46a`, panel fill `rgba(28,20,14,.92)` |
| UI text | parchment `#f2e6c9`, muted `#b9a98a`, HP `#d8433f`, SP `#3f7fd8`, EXP `#e9c46a` |

- **Value plan.** Ground is dark-mid (grass base `#476630`, dark wood floor `#30503a`), paths and plazas are light
  (path base `#bfa272`), tree masses and cliffs are dark, and actors and accents are the brightest, most saturated
  pixels on screen. Tested per biome (`tests/render-ground.test.ts`): path at least 25% lighter than the ground, tree
  masses at least 20% darker.
- **Outlines.** `#24180f` (warm black) only on characters and monsters. World props, buildings and dressing are
  outlined in the darkest step of their own ramp (trees: foliage `#17302f`; rocks and everything else: the shared dark
  `#2b2a40`, `WORLD_OUTLINE`), so the world sits back and the actors pop.
- **Shadows** are the violet `#3a3560`, multiplied (§3a). Never black alpha, anywhere.
- **Dither** only in light falloff and water depth bands. Ground tone variation is hard-edged two-tone 4 px clusters
  (`render/ground.ts toneWash`): no per-pixel noise, no soft blobs.
- Biome palettes (frost, basalt, storm, dusk, crypt, cave) keep the same value steps with their own hue.

## 3. World art rules
- **Grid**: 32×32 px tiles authored pixel-by-pixel (use `fillRect` on integer coordinates only; no arcs/ellipses on
  sprites except where rasterized to the pixel grid by hand helpers). Rendered with nearest-neighbour (`pixelArt`).
- **Ground tiles**: base + 2 variants per terrain; texture comes from small clustered details (grass tufts 2–3 px tall,
  pebbles, cracks) — never per-pixel salt-and-pepper noise.
- **Autotile transitions**: soft terrains (path, sand, dark grass, snow, ember…) blend into their neighbours with an
  outlined, irregular edge using 4-bit corner masks (16 transition pieces per pair family). Water gets a foam/shore
  edge; walls/cliffs get a 2-tone top + darker face + outline on the walkable side.
- Light is always from the **top-left**. A sprite with a lit face is never mirrored (`PROP_NO_FLIP`, `DRESSING_LIT`).

### 3a. Cast shadows (`render/shadows.ts`)
- Everything that stands throws its **own silhouette down-right**: laid down at half height and sheared so its top
  lands `0.6 ×` its height to the right, never more than 48 px (dusk and glade maps: `0.9`, one constant).
- Colour `#3a3560`, **multiply**, 40% outdoors, 30% underground. A 1 px contact line under whatever touches the ground
  is multiplied in a second time (35%).
- Static casters (props, structures, standing dressing, objects, gather nodes) are baked **into the ground chunks** as
  one flat layer: no sprite, no draw call, and overlapping shadows never add up. Moving actors (player, monsters,
  NPCs) show the silhouette of the frame they are on, from one shared atlas (`cast_shadows`, baked lazily).
- There is no ellipse blob under anything. The one exception: flying monsters keep a small offset ellipse.
- Whole pixels only: the shear is rounded per row; nothing is scaled or rotated at draw time.

### 3b. Size tiers (`art/world.ts propKey`, `PROP_TIER_LOOKS`)
The hero is 40 px tall. Every screen must show something three heroes tall.

| Tier | Height | Trees | Rocks | Other |
|---|---|---|---|---|
| S | 8 – 36 px | sapling, bush | small stones (`rock_S`) | tufts, flowers, mushrooms (dressing) |
| M | 32 – 64 px | young tree (`tree`, `tree~1`, `tree~2`) | `rock`, `boulder` | stump, crates, signpost |
| L | 64 – 112 px | grown tree (`tree_L`: round oak, tall elm, forked) | boulder group two tiles wide (`rock_L`), standing stone (`menhir_L`, 88 px) | fallen giant log (`log_L`) |
| XL | 104 – 160 px | hero tree (`tree_XL`, 3 – 4 heroes) | outcrop three tiles wide (`rock_XL`) | landmark stamps (Phase 2) |

- **Three drawn looks per tier** of the tree and rock families: different silhouettes, never a recolour or a mirror.
  The compiler gives neighbours within 6 tiles different looks wherever three looks can cover them.
- Trees and rocks are placed as **groups of big + medium + small** (three pieces), never a lone medium, and never an
  even sprinkle: the compiler rolls one group per lattice cell against a low-frequency density mask.
- **Tallness**: outdoors, 95% of walkable tiles have an L or XL prop or a structure within 12 tiles (the compiler adds
  a group where the rolls left a gap; tested).
- A big crown hangs low: about a third of the trunk shows. A bare pole under a ball reads as a lollipop.
- **Walking behind**: L and XL props and buildings are single y-sorted sprites; while the hero stands behind one it
  fades to 40% in a few alpha steps (`render/stage.ts fadeTall`). Only the trunk tile blocks.

### 3c. Tree lines (`core/world/compile.ts`, `'T'`)
`T` is not "a tree on every tile". Collision is unchanged (every tile of the line blocks); what is drawn, from the
open side inward:
1. **undergrowth**: bushes, saplings, mushrooms on the front tiles, staggered;
2. **front row**: full trees of three looks and three heights (M / L / XL), offset by up to half a tile. Where open
   ground lies to the north the tree stands a row back and stays low, so its crown does not swallow the clearing;
3. **second row**: trees tinted one step darker and cooler;
4. **interior**: trunkless canopy masses (`<kind>_mass`), darker each row, on a floor shaded with the shadow violet.
About one front cell in six is a **notch** — a fallen giant log or a low bay — so no border runs unbroken.
A tree line costs about a third of the sprites of one tree per tile.

### 3d. Dressing rules (`render/dressing.ts planZones`, `planScatter`) — there is no density target
- Every walkable cell is **calm, medium or dense**: about 60 / 30 / 10 by area. Dense within a tile of a border (tree
  line, cliff, water), a structure or a big prop, where the map's low-frequency mask allows; calm on paths (+1 tile),
  plazas, portal arrivals (+2) and wherever the mask says so.
- Anchors keep a **Poisson spacing** of 5 / 2.5 / 1.2 tiles; each anchor grows the cluster its surroundings call for.
- **Clearings**: every spawn entry's circle is a clearing — no scattered blockers, at most a fifth of the medium
  dressing — with a dressed rim two tiles wide. Monsters read instantly on clean ground.
- **Ecology**: mushrooms, stumps and logs only under trees · reeds only at water · flowers as a drift of one colour on
  the sunlit side of a wood, or a small pair in medium ground · tall grass at cliff feet and fences · a lone low tuft,
  stone or pebbles in the open · bones and rubble only in dungeons and ash.
- **Road lining**: fences in runs of 2 – 5 with gaps; lanterns along the roads about every 6 tiles and where a road
  meets a plaza — never a ring round a plaza. Plaza goods stand in a few stacks of two or three, not a dotted rim.

## 4. Characters & monsters
- Player: 32×40 canvas, chibi (~2.5 heads), 1 px outline, weapon silhouette readable. The outfit CHANGES with the worn
  class (docs/CLIENT-v3.md §Class looks): palette, headgear, armour type, cape (Tier II+), aura (Tier III). Frames:
  `player_<w>` (= idle 0, kept for compatibility), `player_<w>_idle_1`, `player_<w>_walk_0..3`, `player_<w>_atk_0..1`.
  Facing left/right by flipX. Weapons `<w>`: `sword`, `dagger`, `staff`, and **`fists`** (Bare Hands, v4): bare arms,
  an ochre tunic, a red headband and cloth-wrapped fists; it idles and walks in a **guard** (both fists up) and its
  attack is wind-up → straight punch with a knuckle flash. Every class outfit also draws over the fists frames
  (`player_fists__<classId>`).
- NPCs: 32×40, frames `npc_<look>` (= idle 0) and `npc_<look>_1`.
- Monsters: same outline rule, personality (weapons, accessories, faces), frames `mon_<id>` (= frame 0) and
  `mon_<id>_1` (idle/walk alternate). Sizes as before (S ~32, M ~40, L elites ~64, wardens ~96).
- **A pack is never N copies of one sprite** (v4): common monsters wear one of four instance looks dealt in a fixed
  shuffled cycle (`art/monsters.ts MONSTER_INSTANCE_LOOKS`): as drawn, 8% smaller and cooler, 8% bigger and warmer,
  duller. Sizes are painted natively in whole pixels with the palette nudge baked in (`mon_<id>~1..3`); never a sprite
  scale or a run-time tint. Elites and wardens keep their one look.
- Floating combat text: pixel font, 1 px dark outline; crits larger + gold; target chevron `ui_chevron` above the
  current target and above aggressive monsters that are chasing the player.

## 5. HUD layout (landscape-first; portrait adapts)
- **Top-left**: round portrait medallion (player head render) with level badge; beside it a framed block with
  "Lv N · Name", HP bar, SP bar (numbers inside), and a stat strip (ATK · MATK · DEF · worn class + CR).
- **Top-centre**: zone plate — map name, safety tag (Safe / Hunting / Dungeon / Warden), level band; under it a slim
  strip with exploration %, local element source icon(s) and warden status.
- **Top-right**: a row of framed square buttons with tiny labels: Skills, Fuse, Class, Codex, Bag, Map, ☰ (menu).
- **Right edge**: *Pursuits* tracker (collapsible): tracked QUESTS first (objective progress, e.g. "Mine ore 3/10"),
  then live discovery goals from the SkillBook — next mastery/morph ("Slash 7/10 → morph"), echo witness
  ("Boulder Roll 2/3"), nearest class ("Pyroblade 1/2"). Tap → opens the quest log / relevant panel.
- **Left edge**: round buttons — quick heal (count), recall shard (count), rest/sit.
- **Movement stays tap-to-move** (owner's choice — no virtual joystick). Bottom-left holds the compact combat/chat log
  above the EXP bar.
- **Bottom-centre**: horizontal skill bar — 6 framed square slots (painted pixel icons, cooldown sweep, rank badge,
  element pip, auto-cast ring), hotkeys 1–6.
- **Bottom-right**: big round attack button in an ornate frame, with smaller round buttons on its arc: AUTO, Target
  (cycle nearest enemies), Potion (count).
- **Very bottom**: full-width thin EXP bar with percentage text; minimap moves into the Map button long-press /
  a collapsible corner widget under the top-right row.
- **Type (v4): two faces, three sizes.** Display — zone names and headers — is the game's own drawn bitmap face (the
  in-world glyphs at 2×, a 3-step ramp, dark outline), painted to an image by `render/fonts.ts displayLabel()`.
  Body — numbers and text — is Tiny5, a plain even-stroke pixel face, through `var(--ui-font-body)` at
  `--ui-text-s|m|l` (8 / 16 / 24 px, its pixel-exact sizes). Pixelify Sans is only the fallback stack now.
- **Frames (v4): three weights**, procedural 9-slices generated at boot as data URLs and used via CSS `border-image`.
  **Heavy** (`--ui-frame-heavy`; portrait, attack button, the round pieces) carries the gold bevel. **Light**
  (`--ui-frame-light`, `--ui-frame-light-on` when active) is a quiet 1 px dark-bronze line for slots and rows.
  **None** (`--ui-strip`) is a dark strip with a stepped edge for tracker and log text. Gold only on things you can tap.
  The older panel / plate / slot / card / button frames remain for panels.
- Panels keep their structure but adopt the frames, palette, font and pixel icons.

## 6. Icons
All skill/element/essence/item/class icons become procedural **pixel icons** (32×32, outlined): composed from a motif
by shape (blade arc, spiral, thrown blade, dash streak, burst, chain bolt, aura), weapon (sword/dagger/staff glyph),
element palette, and a per-skill seed for variation. Exposed as Phaser textures (`icon_skill_<id>` …) and as cached
data URLs for the DOM. Emoji remain only as an accessibility fallback (`aria-label`).

## 7. Camera (pixel-perfect — see docs/QUALITY-PLAN.md §1)
Render to a low-resolution backbuffer in art pixels and upscale by an INTEGER factor (crisp CSS scaling); camera
zoom stays 1 so Phaser rounds every sprite to whole art pixels. Choose the factor so the short screen side shows
≈ 360–560 art px (phones and iPads both show more world than v2). Never use a fractional zoom.
