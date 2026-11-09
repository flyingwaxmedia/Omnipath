# Omnipath — Art Direction v3 ("Lush Pixel")

The owner supplied a reference screenshot of a mobile pixel-art RPG (kept outside the repo: it is another game's art). It is a
**direction**, not a template: we match its *qualities* (dense, outlined pixel art; earthy palette; ornate framed HUD;
joystick + horizontal skill bar; quest tracker) with **entirely original** assets, ornaments, layout details and names.
Never trace its sprites, icons or frames, never reuse its names, and never place UI elements pixel-for-pixel like it.

## 1. What the reference does well (the qualities we want)
1. **True pixel art**: hard-edged pixels, 1 px dark outlines on every sprite, 3–5 tone ramps per material, light from
   the top-left, no anti-aliased vector blobs, no soft gradients on sprites.
2. **Density**: the ground is *dressed* — flower clumps, mushrooms, tall grass, stones, stumps, fallen logs, crates,
   banners, fences lining roads. Little bare ground away from the path; roads read as roads.
3. **Soft terrain borders**: grass meets dirt along an irregular, outlined edge (autotiling), never a staircase of
   squares.
4. **Readable characters**: chibi proportions (~2.5 heads), weapon silhouettes, name tags with outline, walk/attack
   animation, many monsters on screen with small target chevrons.
5. **Muted earthy palette**: olive greens, warm dirt, muted reds/pinks as accents, desaturated stone; the HUD uses
   dark brown + bronze/gold frames so the world stays the most colourful thing on screen.
6. **Framed HUD**: every widget sits in a bevelled bronze/wood frame; pixel font; icons are painted pixel art (not
   emoji).

## 2. Palette (anchors — derive ramps from these)
| material | dark → light |
|---|---|
| outline (never pure black) | `#24180f` |
| grass | `#3f5a26` `#56772f` `#6c8f3a` `#86a64a` `#a2bd62` |
| dirt road | `#7a6446` `#96805c` `#ad9a74` `#c2b18a` |
| foliage | `#2b4a22` `#3d6630` `#548540` `#74a655` |
| bark / wood | `#3d2817` `#5c3d22` `#7d5530` `#9c6d3e` |
| stone | `#4a4d55` `#666a73` `#878b93` `#a9adb3` |
| water | `#25507a` `#2f6fa3` `#4a92c4` `#8cc6e6` (foam `#d8eef6`) |
| flower accents | crimson `#b8323a`, rose `#e0788a`, cream `#efe6c8`, violet `#8a6cc0` |
| UI frame | `#24180f` outline, `#4a3220` wood, `#7a5430` bevel, bronze `#b0803a`, gold highlight `#e9c46a`, panel fill `rgba(28,20,14,.92)` |
| UI text | parchment `#f2e6c9`, muted `#b9a98a`, HP `#d8433f`, SP `#3f7fd8`, EXP `#e9c46a` |
Biome palettes (frost, basalt, storm, dusk, crypt, cave) keep the same *value structure* with their own hue.

## 3. World art rules
- **Grid**: 32×32 px tiles authored pixel-by-pixel (use `fillRect` on integer coordinates only; no arcs/ellipses on
  sprites except where rasterized to the pixel grid by hand helpers). Rendered with nearest-neighbour (`pixelArt`).
- **Ground tiles**: base + 2 variants per terrain; texture comes from small clustered details (grass tufts 2–3 px tall,
  pebbles, cracks) — never per-pixel salt-and-pepper noise.
- **Autotile transitions**: soft terrains (path, sand, dark grass, snow, ember…) blend into their neighbours with an
  outlined, irregular edge using 4-bit corner masks (16 transition pieces per pair family). Water gets a foam/shore
  edge; walls/cliffs get a 2-tone top + darker face + outline on the walkable side.
- **Dressing** (non-blocking, purely visual, deterministic per map seed): flower clumps (3–7 blooms), mushroom groups,
  tall-grass tufts, small stones, stumps, fallen logs, crates/barrels and banners near structures/portals/camps,
  rustic fences lining roads in town/meadow/camp areas, lanterns in towns. Target ≈ 1 dressing per 6–10 walkable
  off-path tiles in fields, more along road edges, less in dungeons (bones, rubble, candles, cobwebs instead).
- **Props** (trees, rocks, ruins…): bigger, layered, outlined; trees have trunk + 2–3 canopy clusters with highlight.

## 4. Characters & monsters
- Player: 32×40 canvas, chibi (~2.5 heads), 1 px outline, weapon silhouette readable; frames:
  `player_<w>` (= idle 0, kept for compatibility), `player_<w>_idle_1`, `player_<w>_walk_0..3`, `player_<w>_atk_0..1`.
  Facing left/right by flipX.
- NPCs: 32×40, frames `npc_<look>` (= idle 0) and `npc_<look>_1`.
- Monsters: same outline rule, personality (weapons, accessories, faces), frames `mon_<id>` (= frame 0) and
  `mon_<id>_1` (idle/walk alternate). Sizes as before (S ~32, M ~40, L elites ~64, wardens ~96).
- Floating combat text: pixel font, 1 px dark outline; crits larger + gold; target chevron `ui_chevron` above the
  current target and above aggressive monsters that are chasing the player.

## 5. HUD layout (landscape-first; portrait adapts)
- **Top-left**: round portrait medallion (player head render) with level badge; beside it a framed block with
  "Lv N · Name", HP bar, SP bar (numbers inside), and a stat strip (ATK · MATK · DEF · worn class + CR).
- **Top-centre**: zone plate — map name, safety tag (Safe / Hunting / Dungeon / Warden), level band; under it a slim
  strip with exploration %, local element source icon(s) and warden status.
- **Top-right**: a row of framed square buttons with tiny labels: Skills, Fuse, Class, Codex, Bag, Map, ☰ (menu).
- **Right edge**: *Pursuits* tracker (collapsible): 2–3 live goals derived from the SkillBook — next mastery/morph
  ("Slash 7/10 → morph"), echo witness ("Boulder Roll 2/3"), nearest class ("Pyroblade 1/2 blade+fire"), element
  source progress ("Fishing 2/3 → Water"). Tap → opens the relevant panel.
- **Left edge**: round buttons — quick heal (count), recall shard (count), rest/sit.
- **Bottom-left**: virtual joystick (appears under the thumb in the left 40% of the screen when the touch starts on
  the world; fixed ghost base when idle). Tap-to-move keeps working everywhere else.
- **Bottom-centre**: horizontal skill bar — 6 framed square slots (painted pixel icons, cooldown sweep, rank badge,
  element pip, auto-cast ring), hotkeys 1–6.
- **Bottom-right**: big round attack button in an ornate frame, with smaller round buttons on its arc: AUTO, Target
  (cycle nearest enemies), Potion (count).
- **Very bottom**: full-width thin EXP bar with percentage text; minimap moves into the Map button long-press /
  a collapsible corner widget under the top-right row.
- **Fonts**: a pixel font (OFL, bundled via npm, e.g. Pixelify Sans) for all HUD/panel text; body text in panels may
  use the pixel font at ≥ 14 px for readability.
- **Frames**: procedural 9-slice frames (wood + bronze bevel + outline) generated at boot as data URLs and used via CSS
  `border-image`; distinct styles for panel, plate, slot, round button, tracker card.
- Panels keep their structure but adopt the frames, palette, font and pixel icons.

## 6. Icons
All skill/element/essence/item/class icons become procedural **pixel icons** (32×32, outlined): composed from a motif
by shape (blade arc, spiral, thrown blade, dash streak, burst, chain bolt, aura), weapon (sword/dagger/staff glyph),
element palette, and a per-skill seed for variation. Exposed as Phaser textures (`icon_skill_<id>` …) and as cached
data URLs for the DOM. Emoji remain only as an accessibility fallback (`aria-label`).

## 7. Camera
Show more world than v2 on tablets: zoom = clamp(shortSide / 560, 1, 2) (iPad landscape ≈ 1.37, phones 1.0).
