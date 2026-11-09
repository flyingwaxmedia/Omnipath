# Omnipath — VFX v1 ("every spell gets a pixel effect")

Adopted design and code contract for skill and combat effects. It merges the research spec (Sprite Fusion / pixelfx
techniques, free-pack conventions, Saint11, open-source generators, Phaser 3.90 facts) with its critique. Each critique
item is fixed below; §2.1 says where.

- Shared contract: `src/game/vfx/types.ts`. It is frozen for both work packages; change it only through this document.
- Work package **P** (pixels) and work package **R** (recipes) are built in parallel and share no other file (§10).
- Runtime wiring into SkillSystem / MonsterSkills / Combat (§8) is not part of P or R. It is built: the player half
  (§8.8: `src/game/vfx/runtime/**`, `src/game/vfx/bridge.ts`), the world lane (§8.9: monster techniques,
  auto-attacks, telegraphs, statuses, deaths, hit feel, camera), an in-game QA pass over every skill and technique
  (§8.10), its adversarial review (§8.11) and the polish pass (§8.12: body-flash gate, warden pan trigger, cone and
  blink reads, bolt strip pool, long ring chunks, monster shots); open items in §13.
- 15-minute path: §2, §5, §6.1–6.3, §7 and §10. The rest is reference for the package that needs it.

Counts in this document come from the data at the time of writing: 160 authored `SkillDef`s in `SKILLS` (10
monster-only, 19 echo-tagged), 27 distinct monster techniques, and about 4,000 legal shape merges. Tests read these
numbers from the data and never hard-code them.

---

## 1. Goals

1. Every skill gets a complete effect that reads as its shape and element: the 160 authored skills, every generated
   variant (`base@el`, `~mod`, `fuse:a|b`), the monster techniques and monster auto-attacks. No skill falls back to a
   tinted circle.
2. The effects follow "Lush Pixel": 1 art px = 1 world px, hard pixels, ramps lit from the top-left, the `#24180f`
   outline on matter, and no soft gradients.
3. All art is procedural and original. There are no image files, no new runtime dependencies, and no copied pixels.
4. Effects are deterministic and Phaser-free up to colourised RGBA frames, so vitest checks every skill headlessly.
5. Effects stay readable on a phone. Each telegraph covers the hit test exactly, player and enemy effects never look
   alike, and the screen stays readable with 12 or more monsters.
6. Effects run within hard mobile budgets (§9), and a quality governor degrades them before the frame rate drops.
7. The system stays as simple as the job allows: 17 components instead of 34, and 40 signature patches instead of 80.

## 2. Principles

| # | Principle (adopted) | Critique fix / note |
|---|---|---|
| 1 | **One data-driven system.** `deriveVfx(skill, owner)` is pure. Signature patches adjust a derived recipe using the same components. A skill nobody anticipated still gets a full effect. | Signatures are cut to 40 and keyed by the **root id**, so variants inherit them. The carrier comes from the root or the merge's primary parent, never from merged tag unions. |
| 2 | **Same pixel grid.** Every position is `Math.round`-ed. Nothing is rotated or given a non-integer scale at runtime. Headings are pre-baked: 16 headings come from 5 unique bakes plus flips, and 8 from 3 plus flips. Sizes come from buckets, never from `setScale`. | Zoom is no longer an open question: QUALITY-PLAN §1 uses an integer backbuffer at camera zoom 1. The spec's "small mote may rotate" exception is dropped. |
| 3 | **Draw indices, colour later.** Templates write index maps (§3.4). A LUT per ramp colours them at bake time, so one geometry serves all 17 families. | Glow twins are baked **white** and tinted at runtime, so they are shared across families (fixes the memory estimate). |
| 4 | **Lines and light, not fills.** Use 1–2 px rims, trails, sparks and white-hot cores, with deep colours only in shadows. Shadow is inverted: a dark core with a bright rim. | — |
| 5 | **Fade by dithering or erosion, never by tweened alpha.** Use a Bayer 4×4 threshold with a per-effect origin offset, a hash dissolve for debris, and crescent erosion for puffs. Stepped alpha (0.6/0.4/0.2) is allowed only for afterimages. | Smoke and puffs are **opaque** Bayer coverage, not 0.45-alpha discs, so QUALITY-PLAN's 0/255 alpha lint holds. |
| 6 | **Phase grammar for one-shots:** anticipation → (contrast) → hero → hold → spread → break → decay → **empty final frame**. The peak falls in the first 30%. | Every frame time is a `VSYNC_MS` value (multiples of 16.7 ms). A hero frame lasts 33 ms (2 vsyncs). |
| 7 | **Outline rule.** Matter (rocks, blades, shards, chips, crust) gets the `#24180f` outline. Energy uses its own R0/R1 rim. Light emitters never get a dark outline on the bright side, and pure black never appears. | A 50% Bayer keyline is added on light biomes (§3.5). |
| 8 | **Blend policy.** Bodies and outlined pieces use NORMAL. ADD is for glow twins only. Scorch and ink decals use MULTIPLY. Shadow, earth, wind, toxin, stealth and steel never use ADD. | Glow twins go on front halves only, so a back-half glow never lights the actor in front of it. |
| 9 | **Depth reads 3D.** Rings, auras and bands split into a back half (anchorY − 1) and a front half (anchorY + 1). | The ground aspect comes from the **hit test**: player shapes are circles (aspect 1), monster zones are ellipses (0.65). Owner decision in §13. |
| 10 | **Readability before spectacle.** The danger ramp, dashed marching rims and straight inward-converging motes belong to monsters only. Player effects burst outward. A target shows at most 2 status loops. | Player charge-ups orbit the hand instead of converging. Telegraph rims are 2 px + keyline and sit above glow and darkness. Off-screen tells get an edge indicator. Every gameplay cue is at least 2 px wide. |
| 11 | **Hits are confirmed on the same frame** by sprite flash, spark and juice. Hit-stop is local to the victim. Shake is trauma-based in integer pixels. | Flashes are counted by **area** (19k art px), and periodic flicker stays ≤ 2 Hz. Hit-stop has a budget of ≤ 150 ms per second (QUALITY-PLAN). Sparks fire only on damage events. Strong, immune, expire and wall outcomes get their own variants. |
| 12 | **Multi-hit restraint.** Only the first hit of a cast gets the full spark. Later hits within 100 ms get tick sparks. | — |
| 13 | **Budgets are hard caps (§9).** A cache miss plays a fallback, so an effect is never blank and the game never stalls. | The caps are now consistent with each other. The telegraph pool is reserved and never starved. Ring arcs and beads are Blitter bobs. Uploads are capped per frame. |
| 14 | **Decals never outlive the mechanic.** They live ≤ 1.0 s (magma pool 1.6 s) and have no rim. | Rimless and ≤ 25% density after 0.6 s, so they never resemble a hazard telegraph. |
| 15 | **Deterministic.** Template geometry is seeded by `hashSeed('vfx', geometryKey, u)`. Per-skill identity comes from cheap runtime choices (`recipe.variety`, cast streams). | The old seeding by skill made output depend on bake order. A test now bakes in shuffled order and compares hashes. |
| 16 | **Original pixels only.** Packs and tutorials supply numbers and techniques only (§12). | `painter.ts` carries a technique-credit header regardless. |

### 2.1 Critique disposition (where each gap or risk is handled)

| # | critique item (severity) | handled in |
|---|---|---|
| 1 | effects and telegraphs do not match the hit tests (critical) | §8.1 ground truth, P9 aspect, REACH/ARC buckets (§5), automated hitbox check (§11.2) |
| 2 | element infusion of matter carriers mis-ordered (high) | §6.1 steps 1–2, §7.1, generic big-orb `orbit`, aqua_lance signature, infusion test |
| 3 | merges derived from the tag union (high) | §7.3: primary parent's tags, accent from the mechanical difference, every merge tested |
| 4 | seeding vs template sharing (high) | P15: seeds from the geometry key; shuffled-order bake test |
| 5 | sameness and bespoke sprawl (high) | tier escalation (§5 slash), 40 root-keyed signatures, distinctness test; missing pieces became params (goo core, rift / shadow decals, net `wrap`, funnel = ring stack, cloud = puff stack) |
| 6 | ramps reuse world colours (high) | §3.2 retune + palette lint |
| 7 | family collisions, CVD, no glyph data (high) | §3.2 lint incl. CVD; `glyphs.ts` 5×5 element and status glyphs (§3.3) |
| 8 | photosensitivity counted by screen flashes only (high) | §9 area-weighted flash budget; no blank frames in spark orbs; shock ≤ 2 Hz; one flash per thunderstorm |
| 9 | budget numbers contradict (high) | §9 / `VFX_BUDGET`; reserved telegraph pool; Blitter bobs |
| 10 | texture re-upload cost (high) | §8.5 dirty-rect uploads, 1 MB/frame, pooled bolt textures, bead-line fallback |
| 11 | memory and bake time optimistic (medium) | P3 shared white glow; status units instead of body loops (§6.4); map-scoped warm set (§8.5); worker / IndexedDB deferred (§13) |
| 12 | actor API does not exist (high) | §8.6 items 3–4 (hit-stop on bob/integrator, TintArbiter, exported hide colour and anchors) |
| 13 | conflicts with QUALITY-PLAN (high) | P2 zoom, P5 opaque smoke, P11 150 ms/s hit-stop, §8.3 depths / grade / light map, §8.4 battery saver, §8.5 Canvas tier + context loss, §9 ambient particles |
| 14 | telegraphs can be hidden (high) | §8.3 rim layer above glow and darkness, §6.5 2 px + keyline, §9 thinner player effects inside zones |
| 15 | off-screen threats (medium) | §6.5 edge indicator, tells never culled; §8.4 oversized player novas |
| 16 | four clocks (medium) | §8.4 world / real channels, progress from the gameplay record |
| 17 | frame times vs vsync (medium) | P6 `VSYNC_MS` |
| 18 | determinism holes (medium) | §8.4 per-cast streams, `onEmit` only, capture stepping |
| 19 | haste / reprise misdrawn (medium) | §7.2 |
| 20 | missing outcomes, misses look like hits (medium) | §6.3 impact table; §8.2 `projectileEnd` reasons; sparks only on `hit` |
| 21 | monster coverage gaps (medium) | §6.5 auto-attacks by monster family; echo skills share one silhouette |
| 22 | marks too small (medium) | P10 ≥ 2 px cues, 7×7 pips, §8.4 thumb callout, device-scale sheets (§11.2) |
| 23 | no biome adaptation (medium) | §3.5 biome profiles |
| 24 | status overlays vs budget (medium) | §6.4 units at anchor points, LOD, own cap |
| 25 | ADD glow breaks the wrap (low) | P8 front halves only |
| 26 | no real-device gate (medium) | §11.3 device gate |
| 27 | stale facts (low) | counts read from data (header); decals rimless (P14) |
| R | licence and asset risks (Sprite Fusion primary text unread, Hollow Crown, forge NOTICE, raw assets near the repo, AI outputs, brand) | §12; `vfx-guard` (§11.1) |
| R | scope, memory ceilings, governor tuning, grading | 17 components / 40 signatures; §8.5 pooling; §11.3 device tuning; §3.2 lint on graded output; §8.7 migration |

## 3. Families, palettes and motifs

### 3.1 Family resolution

`familyOf(skill)` = `skill.element` ?? the first of `arcane`, `stealth`, `toxin`, `spirit` found in `tags` ??
`'steel'`. This is the same precedence as `Combat.colorFor`, so HUD pips, icons and VFX agree. `danger` is assigned
only by monster telegraph pieces. Matter bodies keep their **material** family (steel) and carry the element as
`imbue` (§7.1).

### 3.2 Palettes (v1; `ramps.ts` implements them exactly)

R0–R5 run dark → light (indices 1–6), S0–S3 is the secondary ramp (indices 9–12) and A is the accent (index 8).

| family | R0 | R1 | R2 | R3 | R4 | R5 | A (accent) | S0–S3 (role) |
|---|---|---|---|---|---|---|---|---|
| fire | #4a1408 | #a02a0c | #e05a18 | #ff9a2a | #ffd860 | #fff8d8 | #ffe9a8 ember | #2a2420 #4a403a #6a605a #8a8278 smoke |
| water | #08204a | #0a3e96 | #0a64e0 | #1aa0ff | #7ce4ff | #e8fcff | #ffffff foam | #b8e4f8 #d8f2fc #eefaff #ffffff mist |
| earth | #2e1a0c | #623414 | #a05a18 | #cc8a2c | #eabc5c | #f8e8b4 | #b0c858 moss | #3a302c #5a4c44 #7e6c5e #a8927c basalt |
| wind | #103a30 | #1a6a56 | #2eaa88 | #6ceac0 | #c4ffec | #f4fffb | #c4d84a leaf | #5a7a1a #8fae2a #c4d84a #e8f080 leaf |
| lightning | #1a1040 | #3a2c70 | #6a5ab0 | #fff060 | #ffffb0 | #ffffff | #ffe14a | #2a1e50 #4a3a8a #7a6ac8 #b0a4f0 halo |
| shadow | #0e0a16 | #24163a | #4a2a78 | #7446c0 | #a87cff | #dcc8ff | #b8e05a acid | #08060c #140e20 #20162e #2e2040 ink |
| holy | #5a3c10 | #9a6a20 | #d8a030 | #f4c850 | #ffe890 | #fffbe8 | #ffffff | #e8dcc0 #f4ecd8 #fbf6ea #ffffff cream |
| ice | #20204e | #40489a | #7c84e0 | #a8ecff | #e4fcff | #ffffff | #aee9ff | #c8d8e8 #e0ecf4 #f0f6fa #ffffff snow |
| magma | #1e0806 | #4e0c06 | #96180a | #dc3810 | #ff8020 | #ffe070 | #ffd27a | #24180f #3a2a24 #5a4436 #7a5e48 crust |
| storm | #141826 | #2a3048 | #4e5a84 | #8494c4 | #c8f0ff | #ffffff | #9fd8ff rain | #2a3444 #4a5c74 #7a90a8 #a8b8cc cloud |
| twilight | #1a1030 | #3e2260 | #8a3ea0 | #d870d8 | #ff9ec0 | #fff0e0 | #fff4d0 star | #2a1a40 #4a2a5a #7a4a7a #a86a8a dusk |
| steel | #2a3040 | #56647c | #8ea4c0 | #c8d8ec | #f0f6ff | #ffffff | #ffd27a hot spark | #3d2817 #5c3d22 #7d5530 #9c6d3e handle |
| arcane | #141850 | #2a2490 | #4a3ce0 | #7c78ff | #bcc0ff | #f4f4ff | #8ff0ff rune | #1a1440 #2e2670 #4a40a0 #6c64c8 |
| stealth | #120e1a | #26203a | #403858 | #6a6488 | #a8a4c8 | #e8e6f8 | #c8b0ff | #2a2630 #3e3848 #554e60 #6e6678 veil |
| toxin | #1a2408 | #3a560a | #8cc800 | #ccff20 | #efff80 | #f8ffd8 | #b04ad0 violet rim | #22301a #3a4a26 #566a36 #74884a gas |
| spirit | #3a2418 | #7a4c34 | #c08a68 | #ecc0a0 | #fbe4d0 | #fffaf4 | #ffffff | #5a4030 #8a6a50 #b8987a #e0c8a8 |
| danger | #3a0820 | #7a0c3c | #d01060 | #ff3c78 | #ff9ab8 | #fff0f4 | #fff8f0 contrast line | #24180f #3a1420 #5a1c30 #7a2440 keyline |

Utility ramps (R0–R5; accent = R5, S = R1–R4): **smoke** #1e1a18 #2a2420 #4a403a #6a605a #8a8278 #b0a698 ·
**dust** #4a3420 #6a5034 #8a7050 #a8906c #c8b490 #e6d8b8 · **blood** #300612 #66101e #a8142a #e83a4e #ff8090 #ffd0d8 ·
**heal** #0e3a1e #1a6a30 #2ea848 #6ae078 #c0ffc8 #f0fff2.

Provenance: the ramps were authored for Omnipath from the ART-DIRECTION anchors and then retuned against the critique.
No ramp is taken from a pack or from pixelfx. The retuning (checked with CIEDE2000) did the following:
- moved water, earth, wind, steel and toxin away from the world tiles (water, dirt, wood, grass, stone, foam)
- separated colliding families (fire/lightning/holy, storm/arcane, ice/water/steel, wind/heal, spirit/holy)
- kept violet for shadow, twilight and stealth only, with arcane moved to indigo-blue
- moved danger to a magenta-red that does not collide with magma or the crimson flowers
- replaced the cream telegraph line (a flower colour) with #fff8f0 plus the keyline

**Palette lint** (`tests/vfx-palette.test.ts`, package P):
- Any two families: the mean ΔE2000 of R2–R4 is ≥ 10. Kin pairs pass at about 11 (fire~earth, ice~steel).
- Each family's R3 is ≥ ΔE 7 from every core world anchor (PAL grass, dirt, foliage, wood, stone, water, foam, flowers).
- Danger R3 stays ≥ ΔE 10 from every player family's R3 under Machado-2009 protan and deutan simulation, and ≥ 8
  under tritan (v1: 11.0 / 13.1 / 8.4). If colour fails, telegraphs still differ by **pattern** (dashes, chevrons).
- The check also runs on OmniGrade output once that pass exists.

### 3.3 Motifs: the grayscale signature of each family

Elements must stay distinguishable in grayscale by shape. `ElementDef.glyph` is unset in the data, so P also authors
5×5 glyph bitmasks for the 11 elements and the 11 statuses (`glyphs.ts`), used by `strong` sparks and status pips.

| family | signature (grayscale) | carrier overlays (strike / spin / projectile trail) | nova core · unit · decal | glow |
|---|---|---|---|---|
| fire | rising S-curve tongues, bubbles, embers | tongues on the arc edge / embers thrown tangentially / puffs cooling to smoke | blast · flame-column · scorch | cores |
| water | arcs, droplets, rings | droplets / droplets / droplets + mist | ripple · splash-crown · wet | R5 glints |
| earth | outlined chunks, spikes, cracks, weight | dust + chips / chips / dust falling | blast · rock-spike (crystal-spike for geode/crystal roots) · cracks | none |
| wind | 1 px curved streaks, no fill, no outline | parallel echo arcs, no white / orbiting leaves / parallel streaks | ripple · gust-swirl · — | none |
| lightning | jagged, flickering, forked | crackle / band-to-outside zigzags / crackle beads | sky · sky-bolt (1–3) · scorch ticks | cores |
| shadow | inverted value, tendrils, inward pull | inverted ink / wisps pulled in / sideways wisps | implode · tendril · ink | tiny rim |
| holy | vertical light, round/square, sequences | tip twinkle / rising sparkles / sparkles rising | radiant · light-pillar (1) · rune | yes |
| ice | facets, hard planes, travelling glint | shard teeth / flakes / twinkle crosses | blast · ice-spike · frost | glints |
| magma | dark crust with glowing cracks, goo | crust chips + cracks / embers / drips + smoke | blast · lava-geyser · pool | cracks, pool |
| storm | cloud overhead, slanted rain, blue-white bolts | crackle + rain / zigzags + rain / rain flecks + crackle | sky · sky-bolt · wet | bolts |
| twilight | crescents, 4-point stars, slow drift | star motes / star motes / star motes walking the ramp | implode · moon-mote · ink | star cores |
| steel | white-hot rim, 1 px glints, warm sparks | glint / — / ghosts only | blast · debris · cracks (heavy) | glints only |
| arcane | rune geometry: circles, glyphs, star polygons | runes / glyphs / glyph motes | rune · star-shard · rune | cores |
| stealth | veils, dissolve, thin violet cuts | slit contrast + violet afterglint / veil puffs / — | cloud · smoke-sheet · — | none |
| toxin | gas clouds, bubbles, drips | drips / spore puffs / bubbles | cloud · spore-puff · — | none |
| spirit | ki ripples: double rings 3 px apart, rounded | ripple rings / ripples / tiny rings | ripple · ki-ripple · — | core |
| danger | dashed marching rims, chevrons, beads, converge | monster tells only | — | never |

### 3.4 Index map and colourising

| index | 0 | 1–6 | 7 | 8 | 9–12 | 13 |
|---|---|---|---|---|---|---|
| meaning | clear | R0..R5 | matter outline #24180f | accent | S0..S3 | white (hero frames only) |

- LUT variants: `base`; `shift` (one step darker; reprise, far-half units, weak hits); `monster` (saturation ×0.85,
  13 → R5, 8 → danger R3); `reduceFlash` (13 → R5).
- Glow levels 1/2/3 are white at 25/50/75% Bayer coverage, opaque and tinted at runtime with the family R3/R4/R5.
  Families without glow (§3.3) bake no glow twin.

### 3.5 Biome contrast profiles (`VfxBiomeProfile`)

| biome group | keyline families (50% Bayer #24180f under energy pieces) | glow gain | notes |
|---|---|---|---|
| meadow, forest, road (default) | — | 0.6 | wind streak heads may reach R5 (wind otherwise vanishes on grass) |
| frost, snow, cream sand | ice, storm, steel, water, holy, spirit, lightning | 0.6 | white cores wash out on light ground |
| ember, basalt, lava | fire, magma, holy, lightning | 0.6 | same-hue ground |
| crypt, cave, night (dark) | shadow, stealth, twilight | 1.0 | glow moves to the `light` layer (§8.3) |

## 4. Painter, dither and glow (package P internals)

- Frame model: `IndexFrame { w, h, ox, oy, body, glow, ms }`, as in `types.ts`. `ox/oy` is the anchor (feet, impact
  point, muzzle or arc centre).
- `put(x, y, i, a = 1)` skips the pixel when `a <= (BAYER4[((y+oy0)&3)*4 + ((x+ox0)&3)] + 0.5) / 16`, with
  `BAYER4 = [0,8,2,10,12,4,14,6,3,11,1,9,15,7,13,5]`. The origin offset `ox0/oy0` comes from the seed, which avoids
  moiré between overlapping effects.
- Shapes are tested in inverse-mapped local space at pixel centres (`sx+0.5, sy+0.5`). This is how the 5 unique
  headings are baked without `ctx.rotate` or anti-aliased paths.
- Primitives:
  - px, Bresenham line and polyline, stamp(r)
  - span disc and ellipse (`chord = floor(sqrt(r² − row²))`)
  - ring(r, w), arc(R, w(u), a0, a1, ink), crescent (disc minus an offset disc)
  - star(n, r0, r1), poly, spike
  - `field()` (metaballs `r²/d²`, rings `exp(−((d−R)/w)²)`) with `quantize()`: < 0.18 clear · 0.18–0.28 index 2 at 50% Bayer · 0.28–0.45 index 2 · 0.45–0.65 index 3 · 0.65–0.85 index 4 · > 0.85 index 5–6
  - `outlineMatter()` writes index 7 on transparent 4-neighbours of matter pixels
  - `erode(progress, 'bayer' | 'hash' | 'crescent')`
  - `glow(x, y, r, max)` and automatic glow dilation of R4/R5/13 (Chebyshev ring 1 → level 2, ring 2 → level 1)
- Orphan pass: a pixel with no same-or-brighter 4-neighbour drops one index, except in the last 2 frames.
- Closed-form particles for baked motion: drag `f = (1 − e^(−kt))/k`. Loops render `i = 0..N−1` at `t = i/N·P`, never
  `i = N`.
- Erosion schedule: coverage 1 → 0.75 → 0.5 → 0.25 → 0, one step per frame. Decals step every 100 ms. Directional
  dissolve (`progress + (1−u)·0.4`) makes tails dissolve first.
- Cost target: ≤ 0.5 ms per 48² frame.

### 4.1 Package P as built (reading rules for R and the runtime step)

Files: `painter.ts` (index-map painter, `quantize`, `midpoint`), `dither.ts` (Bayer 4×4, hash dissolve, crescent
eraser), `glow.ts` (emissive dilation, glow discs, matter rim), `ramps.ts` (`RAMPS`, `lut`, `fit`, `NO_GLOW`),
`glyphs.ts`, `components/*.ts` (17 templates + `kit.ts` + `index.ts` with `TEMPLATES`, `outlineAllowed`),
`bake.ts` (`indexFrames`, `bakePiece`, `bakePhase`, `pieceKey`), `grid.ts` (the §11.1 QA grid). Tests:
`tests/vfx-painter.test.ts` (also covers the vfx-bake checks) and `tests/vfx-palette.test.ts`. Sheets:
`node scripts/vfx-sheets.mjs [outDir]` (defaults to the OS temp dir). No change to `types.ts` was needed.

- **Anchor halves.** `bake.ts` passes `piece.anchor.half` to the template. Ring (whole) and aura pieces with
  `half: 'back'` bake only what lies above the anchor row (far arc, orbiting units with sin < 0, the ward's upper half);
  `'front'` bakes the rest; no `half` bakes everything. The geometry key gains `|hback` / `|hfront`. Other components
  ignore `half` (the runtime only sets their depth).
- **Ring pieces (r > 64).** The tile set is a 10 px band chunk per unique direction, and `u` indexes the chunk's
  **outward normal** angle (u · 22.5°). The runtime picks a chunk with `pickDir(normalAngle, 16)`, not the tangent
  angle: normals mirror correctly under flipX / flipY, tangents would put the bright rim on the inside. Dash and gap
  patterns are placement (hide 2 of 5 / every 4th chunk). Ring `arc` is baked in screen degrees; for aim-relative
  arcs (§6.8) the runtime adds the event angle before baking the `geometryFromEvent` piece.
- **Frames.** Templates crop each frame to its content (+3 px). The bake trims again, so an `RgbaFrame`'s `ox/oy` is
  the anchor inside the trimmed frame (it may lie outside it) and the runtime draws at anchor − (ox, oy). Empty frames
  are 0×0. A frame identical to the previous one reuses its `data` buffer (same reference), so the atlas can store it
  once (decal and sigil holds).
- **Uses.** `motes` strips are `'pieces'`: frame k is an age step (frame = ⌊age / life · n⌋). `tell` chevron / arrow /
  bead / edge are `'pieces'`; lock and fizzle are one-shots. Decal `fill` and `shadow`, ring `march` / `static`,
  sigil `static`, aura loops, orbs, missiles and status loops are `'loop'`; everything else is `'once'`.
- **Decals.** `shape: 'line'` follows §6.8: `r` is half the length and the anchor is the midpoint (16 dirs).
  Aftermath kinds hold, then dissolve 50 → 25 → 12.5 % at 100 ms; `frost` rises 12.5 → 50 % first; `pool` cools over
  1.5 s; `rift` opens and closes over 4 frames each.
- **Sigil.** `draw` ends with a 200 ms hold and a 2-frame dissolve. For a longer hold, R adds a `static` sigil piece.
- **Grey outcomes.** Burst `resist`, `immune` and `fizzle` and tell `fizzle` are drawn in R1–R3 only; R gives them
  `ramp: 'smoke'` to read grey.
- **WHITE.** Only on declared hero frames of one-shots, starting within the first 30 % of the strip; loops never use
  it (orb highlights are R5). `heroFrames` is empty unless the LUT is `base` (shift / monster / reduceFlash map WHITE
  to R5). The zap peaks on its first frame (white), then shows the re-seeded shape.
- **Reduce flash.** Contrast and blank frames are dropped and their time is added to the neighbouring frame (totals
  stay within ±2 ms after re-snapping to `VSYNC_MS`).
- **Glow.** Templates dilate R5 + WHITE (orbs, sigils: R4 too). Ramps in `NO_GLOW` (earth, wind, stealth, toxin,
  danger, smoke, dust, blood) bake 0×0 glow twins, except missiles, whose glow twin is the imbue rim (shown by the
  runtime only when the body carries an element).
- **Outline (#24180f).** Allowed only where `outlineAllowed(piece)` says: missiles, chip motes, blunt and star bursts,
  matter erupt units, freeze crystal / icicle / pip status units, dashed rings, danger tells and the edge badge, orbit
  shards, earth / magma family marks (chips, crust) in magic sparks and tier-2 smears, and the rocks and metal chips
  of earth / steel blast cores. The biome keyline option allows it anywhere.
- **Orphans.** A lone pixel has no non-clear 8-neighbour. Slash, thrust, orb, missile, burst, nova and erupt remove
  them outside the last two non-empty frames. Dissolves use ordered Bayer (with a radial bias for nova cores) or
  crescent erosion; the hash dissolve is kept for crack decals only, so nothing turns into salt-and-pepper noise.
- **Bolts.** The canvas is the path box plus the displacement margin, capped at 512 px (the largest pooled texture).
- **Seeds.** Every strip is seeded by `hashSeed('vfx', geometryKey, u)`; bolts additionally use `params.seed` for the
  two path shapes. Bake order never changes output (tested by hash in shuffled order).
- **Whirls.** A slash with arc ≥ 240° (a sweep round the caster whose gap faces away) bakes 8 headings (3 unique,
  within 22.5°) and no heavy contrast frame. Claw rakes (monster auto-attacks, which hit all round) bake 8 headings.
- **Measured (Node, this container).** Boot set (75 pieces: motes, puffs, danger ring pieces, steel bursts, tells)
  30–40 ms; 0.17–0.26 ms per 48² orb frame; slash r56 (5 dirs) 17 ms; heavy blast core c56 16 ms; the widest smear
  (tidal_crescent, r104 at 270°, 3 dirs) 96 ms. The worst loadout + the densest map's warm set (§8.5) bakes in about
  0.45 s and stores 2.97 atlas pages (tests/vfx-pipeline logs both).

### 4.2 Sheet review pass (QA loop over the contact sheets)

The §11.2 sheets were reviewed at device scale against §2, §3.3 and ART-DIRECTION. What changed, and why:
- **Nova cores read the motif** (geometry key gains `v=<style>`; `coreStyle(core, motif)` in `components/nova.ts`).
  `blast` was one fireball shared by fire, magma, earth, ice and steel; it now has fire (fireball + rising tongues +
  embers), magma (dark crust lumps with glowing cracks, S0-rimmed, falling drips), earth (no white, no glow: a ground
  shock, outlined rocks on arcs, a dust dome lit from the top-left), ice (faceted crystal flash, flying shards, frost
  ring), steel (spark spray in the warm accent, outlined chips, a thin ground ring) and a plain energy style for the
  other families and death pops. The hold frame is an irregular two-layer flash instead of a flat 8-point clip-art
  star. `ripple` has water (droplets + splash column), wind (spiral streaks, no white, no fill) and spirit (ki double
  rings exactly 3 px apart); `sky` has a storm style (cloud cap + slanted rain); `radiant` (holy) adds a vertical beam
  and a cross flare over a round core before its rings.
- **Bolts** use two-scale midpoint displacement (sharp kinks every ~L/8, then ±1 px roughness) with the wander
  bounded on long hops (`off0 = jag · min(L, 48 + 0.3 L)`), and thinner ink: a 3 px band with a 1 px hot core, forks one
  step thinner and dimmer than the trunk. Before, a 180 px hop read as a wavy worm 5 px thick.
- **Magic hit sparks** open on a white-hot core with a 4-point flare (R5 for wind) instead of a 3 px plus.
- **Puffs** have a lobed silhouette (base + two top lobes) with one lit cap and a base shadow crescent, so smoke and
  dust read as soft volume, not balls; `smoke` leaves the flame hot (R4, R3) and cools through the S ramp (fire: grey
  smoke, magma: crust). Gas puffs, spore puffs and cloud cores use a solid 1 px accent rim instead of a 50 % dithered
  halo (mush on grass).
- **Erupt units:** `rock-spike` is a broken, notched basalt spire (S ramp, stratum line, ochre catch-light) instead of
  an orange cone; `smoke-sheet` is a low cumulus bank instead of flat striped capsules.
- **Monster zone tells:** sequential danger fills and a 12.5 % family hint (§6.5).
### 4.3 Adversarial review pass (VFX_VERSION 2)

A review against the data, the hit tests and the budgets found and fixed:
- **Atlas budget.** The worst 8-skill loadout + the densest map needed about 7.7 pages against a 4-page cap, and no
  test checked it. Fixes: aftermath decals mark the core only (≤ 96 px, coarse buckets); the arcane nova marker sigil
  is r ≤ 32 and starfall_lattice no longer adds a second one; inner shock rings hidden under the nova core are skipped;
  a contract ring from r0 > 64 bakes as pieces; whirls (arc ≥ 240°) and claw rakes bake 8 headings and whirls skip the
  contrast frame; wardens share the elite death pop. The warm set is now 2.97 pages (tested, §8.5).
- **Merges.** The `extra` accent was built before the signature patch, so 427 merges repeated a pre-patch body (e.g.
  an arcane shard missile under glacial_orb's orb, a plain ring under tornado's funnel). Arc, knockback, spin-dash and
  `none` accents drew their pieces twice (1,808 merges had two arc zaps). Accents are now applied once, after the
  patch, in the echo family (§7.3).
- **Knockback** was drawn twice (status phase + `riders.knockback`); it is a status only.
- **Monster strikes** drew their smear at `range`, short of the real `range + m.radius`; smears now take their reach
  from the event like the cone rims.
- **Guard.** `tests/vfx-guard.test.ts` (no clock, randomness, rotation, DOM or Phaser in the core; no image or font
  files; credits kept) did not exist; it does now. Dead helpers (painter `with` / `glowPx` / `sdot`, `covered`,
  `holdMs`, `lerp`, a duplicate bake-API pin) were removed.

Not changed, by design: staff strikes draw a shorter smear (0.8 R, 60 % of the arc) plus a sigil at the tip, and fist
strikes a ki burst at 0.8 R, as §6.2 specifies; monster area cores keep the monster LUT (accent → danger R3), so a
monster blast reads as hostile.

## 5. Components (17)

Frame times are `VSYNC_MS` values. "Key params" are the bake params in `types.ts` (`ComponentParams`). Runtime
placement (counts, patterns, speeds) lives in `VfxPiece.place` and is never part of a bake key.

| id | purpose | frames · timing | key params | dirs | layer · blend |
|---|---|---|---|---|---|
| **slash** | melee crescents; claws (`rakes: 3`, monster auto-attacks); execute chops (`form: 'chop'`) | 33 snap · 33 hero · 50 hold · 50 tail-eats-40% · 67 split + sparks · 67 dotted trace · 83 dots · empty (≈ 400 ms). Heavy: +33 contrast first (not on whirls), hold ×2, +2 decay frames | r (REACH 40–128/8), arc (ARC 60–360/30), rakes, form, weight, tier, sense, rune | 16; 8 for whirls (arc ≥ 240°) and claw rakes; chop 1 | body NORMAL; glow head on hero/hold |
| **thrust** | pierce lunge streak + X-cut at the tip | 33 half streak · 33 hero + 1st stroke · 50 2nd stroke · 67 fragments + 4 sparks · 67 dots · empty | len (REACH), weight, tier, slit | 16 | body; glow on tip only |
| **orb** | energy projectile bodies (`OrbForm`); hand charge orb (`mode: 'charge'`, 3 sizes) | loop 4 × 67 ms; big orbs (`orbit`) 8 × 83 | form, cell (16/24/32/48), orbit, halo, mode | 16 directional · 1 radial/charge | body NORMAL + glow twin |
| **missile** | thrown matter (`MissileForm`), always outlined | spinning: 8 × 50 (4 rotations + 4 smear frames, ≈ 15.7 rad/s); directional: 2 × 67 + glint every 4th tick; `pose: 'wrap'` held on the target | form, cell, halo, pose | 1 spinning · 16 directional | body NORMAL; imbue glow rim |
| **bolt** | chain lightning, arc zaps, palm bolts, tethers | chain: 33 contrast+bolt · 33 white re-seed · 33 blank · 50 remnant · 33 blank · 50 fragments. zap: 33 · 33 · empty. `reduceFlash` drops contrast, blank and white | dx, dy, jag, forks, strength, seq, seed | 1 (vector) | body + glow. **Baked at hop time** (§8.5) |
| **burst** | hit sparks by class, muzzle flash, split star, glint, fizzle, spark-moment star | 50 · 50 · 67 · 67 · 67 · empty (tick: 33 · 50 · 50 · empty) | cls, size (s 16 / m 24 / l 32; star 64), glyph | 8 for slash/pierce, else 1 | body (target.y + 2); glow core |
| **motes** | the mote kit: spark, ember, mote, streak, flake, droplet, chip, bubble, leaf, glint, glyph, wisp, line, bead, disc, star | 1–4 frames per kind; colour steps through the ramp by age | kind, size (1–3) | 16 for spark/line/streak, else 1 | emitters: body / glow / ground |
| **puff** | smoke, dust, vapour, veil, gas, cloud, steam | 8 × 83: grow, lit cap while age < 0.5, one ramp step darker every 2 frames, crescent erosion in the last 3 | kind, r (3/5/7/10) | 1 | ground or body |
| **ring** | shockwaves, spin bands, rims, fill fronts, cone edges, accretion arcs | expand/contract 6 × 50–67. sweep/march are stepped by the runtime at 33 ms ticks: ink by age since the head passed (hot 1 tick → lit 2 → mid 4 → dim → gone). **Smear** sweeps (`smear` 4/6/8, spin bands): each head is a white-hot edge `smear` px wide (2 px R5 + R4), the tail thins (×0.7 → ×0.45 → 2 px) and cools (lit → mid → dim) and is gone after `SMEAR_TAIL` (0.32) of a turn (`smearStage` / `smearWidth` in types.ts, shared by the whole bake and the chunk runtime) | r, r0, aspect, thick, style, ink, anim, arc, heads, smear, ms | 1 whole (r and an expand / contract r0 ≤ 64) · **pieces** (otherwise: 16 outward-normal buckets × thick × style × ink) | ground / preview / tell / rim; back/front halves |
| **decal** | telegraph fills, scorch, frost, wet, ink, rune glow, cracks, cooling pool, rift slit, falling shadow | static at density 12.5/25/50%; dissolve 50 → 25 → 12.5 → 0 every 100 ms; life ≤ 1000 ms (pool 1600) | kind, r (DECAL 16–176/8, floor), aspect, density, shape (disc/line) | 1 (line: 16) | ground / tell / glow; MULTIPLY for scorch and ink |
| **sigil** | rune circle: 2 rings + star polygon + glyphs drawn in sequence | draw 8 × 50 then hold; flash 2 × 33 | r (16/24/32/48), points, glyphs, anim | 1 | preview / ground / glow |
| **nova** | release core: blast, ripple, implode, radiant, sky, rune, cloud, goo; death pops; dash landings | (33 contrast if heavy) · 50 hero · 100 hold · 67 × 6 · empty | core, c (24/40/56), heavy | 1 | body (cy + 1) + glow |
| **erupt** | area units: flame-column, lava-geyser, rock-spike, crystal-spike, ice-spike, splash-crown, gust-swirl, sky-bolt, light-pillar, tendril, moon-mote, star-shard, spore-puff, smoke-sheet, debris, ki-ripple | 6–10 frames at 50–67 | unit, scale (s/m/l) | 1 | body; far-half units use LUT `shift` |
| **status** | small status units placed on silhouette anchor points: tongue, drip, puddle, chevron, star, microarc, crystal, icicle, bubble, drop, splash, beam, speedline, spiral, pip (7×7 + 5×5 glyph) | loops 4–8 × 100–117; one-shots ≤ 800 ms | kind, unit, body (S/M/L/W) | 1 (speedline 16) | body |
| **aura** | buff activation + sustained loop with a motif per stat; hex ward; halo | activate 6 × 83; loop 16 × 100 (1.6 s, seamless); break 6 × 50 | motif, phase, activation, body, halo | 1 | body, back half y − 1 / front half y + 1 |
| **tell** | lane chevrons (8×8), arrowheads, aim beads (2–3 px), lock flash, off-screen edge indicator, fizzle | chevrons march 1 px per 2 ticks; lock = 1 frame × 50 ms | piece, danger | 16 for chevron and arrow | tell / rim |
| **afterimage** | dash ghosts, blink slices, reprise mirror: a snapshot of the actor's own frame | runtime only: tintFill family R3, stepped alpha `steps` at 50 ms | mode, steps | — | body (actor.y − 1) |

Component notes (exact geometry):
- **slash**
  - Annulus between R − w(u) and R, centred on the anchor. Aspect is 1 because the strike hit test is a circular
    sector.
  - Width: `w(u) = W·sin(π·u^2.2)^0.6`, where u runs tail → head. W = 0.22R, heavy 0.3R, light 0.18R.
  - Ink by depth q:
    - outer px is R5 (index 13 on the hero frame)
    - q < 0.5 is R3, q < 0.8 is R2, innermost R1
    - the tail third is one step darker
    - a 50% R0 inner edge adds contrast on grass
  - Tier escalation: tier 1 adds an echo arc at R − w − 2. Tier 2 adds family overlay motes on frames 2–4. Tier 3 adds a
    tip ring. The `lastHit` swing of a multi-hit cast gets tier + 1.
  - Chop: a 60° crescent of length 1.4R, falling top → bottom over the target, in a cell 48 × ⌈1.4R⌉.
  - Sense: flipping a heading mirrors the sweep, so the runtime picks the baked `sense` that reads correctly after the
    flip.
- **orb forms**
  - orb: rim R1 at r + 1, body R3, core R5 offset toward travel, a 1 px 13 highlight, a 3–6 px tail.
  - fireball: corona of 6–8 tongues. shade: R0 core with an R4 rim. spark: crackle re-seeded every frame, **no blank
    frames**, so there is no 3.75 Hz flicker. storm: rain-fleck tail. lightbolt: holy diamond. moon: crescent.
  - prism: 6 facets. lance: 3 × 3·size capsule with a white core line. wave: a flying crescent. gust: an air crescent
    with no white. spellblade: a translucent sword. bubble: a ring. droplet: a teardrop.
- **missile forms**: blade, cleaver, hammer (spin); knife, needle, dart, feather, shard, thorn (directional); rock, net
  (spin); glob (crust with cracks shifting 1 px every 2 ticks); hook (12 px head; the runtime draws chain beads back to
  the caster).
- **bolt**
  - Midpoint displacement: off = jag·L, ×0.52 per level, down to segments of about 3 px.
  - Forks: p = 0.35·forks/(1 + depth)/max(4, n/6), at ±0.35–0.9 rad, depth ≤ 2.
  - Max-wins inking: trunk halo r 2.1 (R1, S for lightning), fork halo r 1.1 (R3), trunk r 1.3 (R4), and a 1 px core
    (13 for lightning, R5 otherwise).
- **burst classes**: slash, pierce, blunt (dust + outlined chips), magic (family spokes by motif), ki (6 blunt rays +
  double ripple), crit (8-point star with a baked overshoot), tick, strong (crit-like + element glyph), resist (grey
  dull ring), immune (grey ring + cross), muzzle, split (6-point star), glint, fizzle (grey puff, for expire / cancel),
  star (64² cracked-star rune for the spark moment).
- **ring styles**:
  - solid; double (2 px apart: holy, spirit); gapped (every 4th piece hidden: wind); jagged (±1 px: earth)
  - dashed (3 on / 2 off, with a 1 px ACCENT outer line and an OUTLINE keyline: danger tells)
  - inverted (R0 band + R4 rim: wail)
  - Rings over 64 px radius are placed from pieces: N = ⌈perimeter/10⌉ (Ramanujan perimeter). Each piece's tangent
    angle picks its bake through `pickDir(θ_t, 16)`. Pieces with sin θ < 0 are the back half.

## 6. Recipe model (package R)

`deriveVfx(skill, owner = 'player', lookup = authored SKILLS) → VfxRecipe` is pure and memoised by
`${skill.id}#${owner}`.

### 6.1 Pipeline

1. **Root.**
   - `parseVariantId(skill.id)` gives the root: the authored base, or for a merge base `fuse:a|b` its **primary
     parent**.
   - Primary parent: higher `SHAPE_PRIORITY`, then higher tier, then the lower id (as `compose.mergeOrder`).
   - Carrier, style and body are derived from the **root's own tags, status and element**, so an infusion's added
     element never changes the carrier. Numbers (range, radius, arc, count) come from the **composed** shape.
2. **Family.** Apply `familyOf` (§3.1) to the composed skill. A matter body keeps `steel` and sets
   `imbue = skill.element`. The native matter bodies shard, glob, rock and feather use their element as the family.
3. **Weight** (from the root, then essences):
   - ultimate: tier ≥ 3 and (power ≥ 3 or castMs ≥ 500)
   - heavy: tag `heavy` or `execute`, or power ≥ 2
   - light: tag `basic`, or a monster-only technique with power < 1
   - normal: everything else
   - The `heavy` essence raises the weight one step, up to heavy at most.
4. **Tier** = `skill.tier` (compose already gives variants +1).
5. **Carrier** by shape, from the tables in §6.2.
6. **Geometry** = the hit test (§8.1) for this shape and owner.
7. **Phases** from the per-shape skeleton (§6.3), plus family overlays, imbue overlays and echo overlays.
8. **Statuses**:
   - player: `[element.status] + [skill.status] + ('knockback' if riders.knockback)`, deduplicated in that order
     (Combat.hit)
   - monster: the same without `smite` (MonsterSkills.statusesOf)
9. **Riders** (`skill.riders`), **essences** (`skill.essences`) and the **merge accent** (§7).
10. **Owner monster** (§6.5).
11. **Juice** (§6.6). `quota` = 1 for players and 0.5 for monsters. `variety` = `hashSeed(rootId)`.
12. **Signature**: if `SIGNATURES[rootId]` exists, apply `patch(recipe, skill)` last (§6.7).

### 6.2 Carrier tables (first match wins; root tags)

**strike**

| style | condition | pieces (cast) | examples |
|---|---|---|---|
| execute | `execute` | slash `form: 'chop'` over the target; heavy | guillotine, assassinate, coup_de_grace (2 hits → crossed chops) |
| cone | `aoe` && element && !`melee` | 8–14 family puffs (wind: line motes, since wind has no fills) streaming apex → range at range/0.3 s + a ring `arc` edge at the range on frame 3 | rime_breath, mon_gust |
| staff | `arcane` && !`blade` | short slash (0.8R, 60% of the arc) + sigil r16 at the tip | hex_blade |
| thrust | `pierce` && !`blade` | thrust; stealth → `slit`; toxin → 2 drip motes | stab, backstab, venom_edge, umbral_strike, pressure_point |
| fist | !`blade` && !`pierce` && (`technique` \|\| `spirit`) | burst `ki` at 0.8·range + 3 line motes; knockback → an upward slash flick r40/90° | palm_strike, rising_kick, soaring_heel, crack_armor |
| crescent | else | slash; `rune` when `arcane` && `blade` | slash, heavy_cleave, crescent_sweep, tidal_crescent, twin_fang, felling_cut, runic_blade, umbral_rend, dusk_lash |
| claw | monster auto-attacks only | slash `rakes: 3` | (`deriveAttackVfx`) |

slash: `r = nearestBucket(range, REACH)`, `arc = nearestBucket(arc, ARC)`, and `sense` = −1 on odd swings.

**spin** (ring at `geometry.r`, back/front halves, plus ≤ 12 family motes per pulse)

| style | condition | ring | examples |
|---|---|---|---|
| vortex | status `pull` | one solid (earth / magma: jagged) ring collapsing R → 0.3R over 250 ms per pulse (the pull reads inward), a 2-head `smear: 4` swirl at 0.7R + spiral debris motes at the zone aspect | tornado, firestorm, eye_of_the_storm |
| halo | family holy | `double` expand + sparkle motes | radiant_burst, moonwarden_sig |
| wail | owner monster && family shadow | `inverted` expand + wisps | mon_wail |
| ripple | `spirit` && !`blade` | `double` 3 px apart, expand | rippling_palm |
| ring | !`blade` && !`pierce` | 2 concentric expand 0.3R → R | inferno_ring, static_field, tidal_ripple, thunder_peal, resonant_pulse, prism_burst, spore_burst, vortex_dancer_sig, stormreaver_sig, echo_sovereign_sig |
| blades | else | `sweep` blade smear (`smear` 6, heavy 8), heads 3 (pierce) or 2 (blade), one turn in 117 ms, + 6 rim sparks staggered round the band | whirlwind, flame_spin, rotspore_whirl, thousand_cuts, blight_whirl, arcane_cyclone |

**projectile** (body; cell = CELL by `size`, one bucket up for monsters)

| # | condition | body | matter | examples |
|---|---|---|---|---|
| 1 | signature | per §6.7 | | |
| 2 | `blade` && `heavy` | missile cleaver | yes | cleaver_toss |
| 3 | `blade` && `arcane` | orb spellblade | no | spell_sabre |
| 4 | `blade` | missile blade (spin) | yes | sword_throw, boomerang_blade, blade_volley, hundredfold_edge, cyclone_blades, thunder_tether |
| 5 | `pierce` && !`arcane` | missile: `stealth` → needle, wind → dart, else knife | yes | fan_of_knives, blade_storm, ember_fan, fletched_fan, coffin_nail |
| 6 | `heavy` | missile hammer | yes | hammer_toss |
| 7 | status `pull` && !`arcane` | missile hook (+ chain beads) | yes | hook_pull, grave_hook |
| 8 | status `slow` && !`arcane` && size ≥ 24 | missile net | yes | net_throw |
| 9 | no element && status `bleed` | missile thorn | yes | mon_thorn_volley |
| 10 | ice / magma / earth | missile shard / glob / rock (native) | native | mon_frost_shard, magma_spit |
| 11 | wind | `echo` → missile feather (native), else orb gust | | gale_feather, wind_cutter |
| 12 | water | size ≥ 14 → orb bubble, else orb droplet | no | bubble_lance, mon_water_spit |
| 13 | by family | fire fireball · shadow shade · lightning spark · storm storm · holy lightbolt · twilight moon · else orb | no | firebolt, mon_ember_spit, grave_chill, holy_light, bolt, arcane_barrage, arcane_deluge |

- A big orb (pierce ≥ 99 and size ≥ 22) gets `orbit`: arcane glyphs, ice shards, water spiral, else motes.
- Directions: blade, cleaver, hammer, rock and net spin (1 dir). Everything else uses 16.

**dash**

| mode | condition | examples |
|---|---|---|
| roll | signature | boulder_roll |
| spin | `shape.spin` | spinning_assault, tempest_waltz, nightfall_waltz, millstone_whirl |
| blink | `stealth` \|\| `arcane` | shadowstep, phantom_rush, ambush, ashen_pounce, cinder_blink, phantom_sig, eclipse_walker_sig |
| charge | `heavy` | rockslide_charge, shoulder_charge, quakestride |
| dive | storm, or owner monster && shadow | storm_dive, mon_rift_lunge |
| ghost | else | quickstep, flare_dash, ember_pounce, windblade_sig |

**nova**

- Core (first match):
  - status `pull` or tag `gravity` → implode
  - holy → radiant
  - lightning / storm → sky
  - arcane → rune
  - toxin / stealth → cloud
  - shadow / twilight → implode
  - water / wind / spirit → ripple
  - else → blast
- Unit = the family's unit (§3.3). Count = `clamp(round(π·R·aspect·R / 1400), 3, 14)`, ×1.3 with expanse (cap 14).
  Exceptions: sky-bolt counts 1 / 2 / 3 for R < 100 / < 150 / else, and light-pillar is 1 at the centre.
- Placement: Poisson with 18 px spacing inside the hit area, popping as the wavefront arrives.
- `c = floorBucket(min(R, 56), CORE)`.
- Inner shock rings that would end under the core (r ≤ c + 8) are skipped: the core hides them.
- The aftermath decal marks the core, not the area: r = `aftermathR(R)` (≤ 96 px, buckets 16 / 32 / 48 / 64 / 96).
  The rim, rings and units carry the true radius.

**chain**

| mode | condition | body per hop | hop |
|---|---|---|---|
| knife / blade | `isKnifeChain` (`projectile` or `pierce` tag); blade if `blade` | missile knife/blade on the quadratic bow (steel + imbue) | 90 ms |
| palm | `spirit` && `melee` | bolt strength 0.7 + burst ki at each target | 60 ms |
| bolt | else | bolt `seq: 'chain'` + electric node at each target (microarc, 150 ms) | 60 ms |

**buff**

- Motif by stat: atk → edge · matk → runes · speed → gust · crit → glint · regen → bloom · def → ward.
- Activation (first match): holy → pillar · arcane → sigil · `technique` with atk → shout · else ring.

### 6.3 Phase skeleton per shape

| shape | telegraph | charge (castMs > 0) | cast (`pulse` per swing / pulse; `castFire` once) | body | trail | impact | area |
|---|---|---|---|---|---|---|---|
| strike | monster: cone | orb charge at the hand + 2–3 motes `orbit`; preview cone (§8.4) | §6.2 strike pieces | — | — | burst by class | heavy: ring shock r 8→24 + decal cracks + chip motes |
| spin | monster: zone | " + preview ring | §6.2 spin ring + family motes | — | — | burst (tick after the first hit) | floor band: 2 px ring on ground (R3 rim over an R1 line), 0 → R outCubic over 300 ms, ink mid → dim (flares R5 on the first and last pulse only) |
| projectile | monster: aim | " | burst muzzle s; count ≥ 5 or radial → one ring r12→28 instead; split essence → burst split | orb / missile | family motes by distance (every 5 px, 3 for fast blades); orbs also leave 5 ghost discs; knives leave afterimages | burst | — |
| dash | monster: lane | " + preview lane | afterimage (ghost / blink) + 3 dust puffs | roll: missile rock 32 | afterimage every 10 px (≤ 6) + 4–6 line motes + family trail motes | burst (hit at 60% of the dash) | end: charge → nova blast c24 + ring + cracks · dive → family core c24 + ring · spin → ring sweep re-anchored every 67 ms |
| nova | player: ring solid 2 px at R + decal fill 12.5% (rim ink hot in the last 117 ms); arcane → + a centre sigil r ≤ 32. Monster: zone | " | — | — | — | burst | nova core + erupt units (wave) + ring shocks (outer 0.45R → R in 333 ms, thick 3 → 1; inner 0.3R → 0.6R in 217 ms; heavy adds a 3rd at 0.35R; inner rings ending under the core are skipped) + family decal (core only, ≤ 96 px) + light pool (decal fill in the glow layer, 2 frames) |
| chain | monster: range + aim beads | " | burst muzzle s at the chest | bolt / missile per hop | knives: 2 afterimages + arrival glint | burst tick + status node | — |
| buff | monster: aura | " | aura activate + activation piece | — | — | — | — (aura phase: loop until `untilMs`, then break) |

Impact class (root): blade → slash · pierce → pierce · heavy, technique, spirit or a blunt matter body (hammer,
cleaver, rock, net, glob) → blunt · fist style → ki · else magic. Size: heavy/ultimate → l · light or
`shapeHits > 1` → s · else m.

`impactPieces(recipe, hit)` picks the variant:

| outcome | variant |
|---|---|
| later hit of the cast within 100 ms | tick |
| crit | crit + class |
| `strong` | strong + element glyph |
| `weak` | class with LUT shift |
| `immune` | immune (grey, no sparks) |
| target is the player | blunt s in the danger ramp |

Imbue and echo overlays add their spokes and motes.

### 6.4 Statuses (`statusPieces(kind, source, body, owner)`)

| kind | units | cadence |
|---|---|---|
| burn | 2–3 tongues on top-edge anchors (magma ramp if the source is magma) + ember motes | flicker 100 ms, ember every 300 ms |
| soak | drip + smallest puddle decal | drip every 400 ms |
| slow | 2 chevrons under the feet, source family | pulse 117 ms |
| stun | 3 stars orbiting a 14×4 ellipse over the head (holy ramp); back stars one step darker | 8 positions × 100 ms |
| shock | microarc at 2 silhouette points | every 500 ms (≤ 2 Hz) |
| freeze | crystal block (body bucket) + 2 icicles + shine sweep; on expiry or Shatter: 6–8 shard motes + glints | shine every 1.2 s |
| poison | bubble rising from the upper body, pops into 4 dots | every 350 ms |
| bleed | splash on apply, then a drop that leaves a stain (blood; violet accent from shadow/twilight sources) | every 500 ms |
| smite | beam (mini light-pillar 48 px) + small ring + heal motes stream to the caster | one-shot 800 ms |
| knockback | 3 speedlines opposite the push + 3 dust puffs + ring r4→16 | one-shot 300 ms |
| pull | 6 spiral streak motes into the chest + 3 ground arcs | one-shot |

- At most 2 loops per target, with priority freeze > stun > shock > burn > poison > bleed > soak > slow. One-shots are
  exempt.
- Hidden loops show as 7×7 pips with the status glyph.
- Targets that are off-screen, or more than 8 affected targets, get pips only.

### 6.5 Owner monster

- **Telegraph by shape** (exact geometry from `monsterTelegraph.tell`, pieces tagged `neverGoverned` and
  `geometryFromEvent`):
  - nova / spin → zone:
    - danger fill decal at 12.5% → 25% at 33% → 50% at 66%; each step replaces the previous one (stacked ordered
      fills with different Bayer origins union into a plaid)
    - a faint family fill (12.5%) under it for the whole tell
    - a ring `dashed` thick 2 + #fff8f0 line + keyline, marching every 2 ticks (doubled speed in the last 25%, R5 in
      the last 15%)
    - one lock flash on the final tick
  - strike → cone: a ring `arc` rim at r + 4 bands lit in sequence + bead edges.
  - dash → lane: chevrons + bead edges + arrow.
  - projectile → aim: a bead line per shot + an orb charge at the mouth.
  - chain → range: a ring `dashed` at aspect 1 + a bead line to the player while in range.
  - buff → aura activate, growing.
  - Every tell gets an edge indicator when the caster or zone is off-view or under the HUD. Interrupt / cancel:
    every piece dissolves in 2 frames + burst fizzle.
- **Charge (caster cue):** `converge` streak motes in the technique family + a ring under the feet (danger, thick 2).
- **Bodies:** cell +1 bucket, `halo: true`, LUT `monster`.
- **Echo skills** keep one silhouette for both owners; only the LUT, the tells and the quota differ (the
  witness-then-learn moment).
- **Auto-attacks** (`deriveAttackVfx`):

  | monster family | carrier |
  |---|---|
  | beast, fiend, wyrm | slash rakes 3 |
  | revenant | slash rakes 1, inverted ink |
  | sylvan (lash), swarm (sting) | thrust |
  | construct | burst blunt l + dust |
  | sprite | burst magic |

  The family ramp is the monster element, else steel. `r` = bucket(attackRange).

### 6.6 Juice (`VfxJuice`; the runtime's juice rig applies it within its budgets)

| weight | victim hit-stop | trauma (player's cast) | flash |
|---|---|---|---|
| light | 0 | 0 | none |
| normal | 33 ms | 0 | none |
| heavy | 67 ms | 0.1 | local |
| ultimate | 100 ms | 0.25 | local; screen only for ultimate novas, governed |

- Crit adds 17 ms (cap 100). Later hits of a multi-hit cast get 0, and hits on the player are halved.
- Trauma: player hurt by ≥ 15% max HP 0.35; warden slam / enrage 0.5.
- Monster recipes never flash the screen.
- Reprise replays carry no juice.

### 6.7 Signatures (40, keyed by root id; `signatures.ts`)

Each patch uses only §5 components. A test fails on an unknown id or a non-root id.

| id | patch |
|---|---|
| worldbreaker | slash `chop` r128 falls onto the nova centre over the 250 ms delay (`move` from dy −120); nova blast c56 heavy; 12 rock-spike units; cracks; trauma 0.3 |
| tornado | vortex funnel: 3 stacked sweep smears (dy 0 / −12 / −24; r ×1 / 0.7 / 0.45; smear 6 / 4 / 4; 117 / 133 / 150 ms; solid) replacing the swirl (the collapsing pull rings stay) + leaf motes on a log spiral |
| firestorm | the tornado funnel in fire + ember spiral |
| eye_of_the_storm | the tornado funnel ×1.2 + cloud puffs stacked at dy −36 + rain line motes (storm ramp) |
| spirit_crescent | orb `wave` cell 48 (spirit) + a dotted bead wake |
| molten_sunder, magma_knight_sig | slash in the skill's own family + crust chip motes (magma S ramp, outlined) + crack decal on each swing |
| gloom_shroud | nova `cloud` + 6 smoke-sheet units in the shadow ramp, drifting 1.0 s (not implode) |
| moonveil | the gloom_shroud patch in the stealth ramp + 4 moon-motes (holy) |
| arcane_orb | orb `orbit: 'glyphs'`, cell 48 |
| glacial_orb | orb (ice) `orbit: 'shards'`, cell 48 (not a missile shard) |
| undertow_orb | orb (water) `orbit: 'spiral'` |
| tangle_orb | orb `orbit: 'vines'`, ramp wind (leaf S) |
| prism_orb, dawn_prism, prism_sage_sig | orb `prism` (arcane / holy / arcane) + tri-glint motes |
| prism_burst | ring `double` per pulse + 3 glint motes (prism facets) |
| aqua_lance | orb `lance` (water) |
| plasma_lance | orb `lance` (fire) + a lightning bolt zap every 3rd trail tick; impact fire + shock spokes |
| featherstorm | missile `feather` (wind, 16 dirs) |
| singularity | an implode core held through the 400 ms delay (accretion: 2 ring `arc` pieces sweeping); release = ring `contract` |
| geode_maw | the singularity patch + 10 crystal-spike units placed on the `rim`, closing; release burst blunt l |
| meteor | missile `glob` cell 24 (fire ramp) falls from (−60, −160) over the delay with a smoke puff trail; a decal `shadow` grows under it; release blast c56 + flame-columns |
| thunderstorm | 4 cloud puffs stack at dy −64 during the delay; at release 3 sky-bolts at 0 / 117 / 233 ms, of which only the first carries contrast and white (one flash transition); rain line motes |
| ascendant_sig | the thunderstorm patch + 6 missile blades on an `orbit` halo at release |
| starfall_lattice | 10 star-shard units on `lattice` points falling, joined by bead `path` lines during the delay, over the arcane nova's centre sigil |
| halo_ward | aura `ward` + `halo` |
| astral_form | aura `runes` + star motes twinkling (loop) |
| blade_aura | aura `blades` (3 orbiting spectral blades) |
| searing_edge | aura `edge` in the fire ramp (weapon flame) |
| shade_cloak | aura `veil` (rising wisps; the actor's alpha 0.55 is an integration item) |
| millstone_whirl | dash spin with a ring `jagged` (earth) + chip motes |
| boulder_roll | dash `roll`: missile rock cell 32 spinning instead of ghosts + dust trail; end ring shock + cracks |
| earthsplitter | decal cracks `shape: 'line'` along the aim (length = range) + rock-spikes placed on the `line` |
| net_throw | impact: missile `net` `pose: 'wrap'` held on the target for 600 ms |
| jelly_slam | family water; nova `goo` + decal wet |
| lunar_dust | telegraph: holy motes `fall` inside the zone over the 700 ms delay; release 6 moon-motes instead of a pillar |
| tremor_stomp | nova blast heavy + an extra outer ring + cracks; monster owner (warden) trauma 0.5 |
| mon_magma_glob | missile glob lobbed on a `move` `arc` over the delay; release burst blunt + decal pool |
| mon_rift_lunge | dash dive + decal `rift` at both ends (opening and closing over 4 frames) |

### 6.8 Package R as built (reading rules for P and the runtime step)

Files: `families.ts` (familyOf + each family's motif language as data), `pieces.ts` (constructors, `nominalMs`,
`pieceProblems`, `recipePieces`), `recipe.ts`, `signatures.ts`. Test: `tests/vfx-recipes.test.ts`. No change to
`types.ts` was needed.

- **Carrier vs overlay.** Carrier geometry (ring styles, cores, bodies, buckets) reads the **root** family, so an
  infusion never changes a bake key. Motes, trails, units, decals and impact spokes read the accent family
  (`imbue ?? family`).
- **Angles.** A ring `arc` on a `geometryFromEvent` piece (cone rims, strike previews) is relative to the aim:
  0° is the aim direction. The runtime places it at the event's angle.
- **Anchors.** `body` anchors use the mover's drawn position, which is already at y − 14, so their `dy` is 0.
  `hop` anchors start at the hop's `from` point. A decal with `shape: 'line'` has `r` = half its length and is
  anchored at its midpoint (`along`).
- **Pulses.** Every swing or pulse re-plays the cast phase. The runtime flips `slash.sense` on odd indices. A
  multi-hit cast also plays its `lastHit` pieces on the final swing. A merge's `extra` accent
  (`riders.merge.pieces`) replaces the carrier piece on the final swing, pulse, shot or hop.
- **Monster strikes** reach `range + m.radius` (MonsterSkills), so their smears (slash, thrust) carry
  `geometryFromEvent`: the runtime bakes `reachBucket(tell.r)` from the cone, like the cone rims.
- **Knockback** is a status (Combat.applyStatus emits `statusApplied` for it), so `phases.status` draws it once;
  `RiderFx` has no knockback entry.
- **What never hits.** Buffs and zero-power skills (quickstep) have no impact phase, no statuses and light juice.
- **Strike ground impact** (ring shock + cracks + chips) needs the `heavy` or `execute` tag or the heavy essence.
  Power alone is not enough, so a heavy backstab stays a stab.
- **Echo techniques** keep their player silhouette when a monster casts them: no cell bump and no halo. They get only
  the monster LUT, the tells and the quota (§6.5). The hit-test aspect (0.65 zones) still applies.
- **Merges.** `spinDash` is the one accent that changes the carrier (dash mode `spin`, §7.3). Every other merge keeps
  the primary parent's carrier. A nova's `unit` follows the accent family. Statuses and the merge accent are built
  after the signature patch, so they always match the body and palette the player sees.
- **Timings.** Charge pieces span exactly `castMs`. A player nova rim spans the delay. Monster tells span
  `monsterTellMs` (the tell plus the wind-up). Cast, impact and area pieces end within the skill's cooldown (or the
  weapon delay). Status loops live for Combat's durations, and aura loops for the buff duration.

## 7. Variants

### 7.1 Element infusion (`base@el`) = palette swap

The root's carrier, geometry and bake keys are unchanged. Two cases:
- **Energy carriers** (slash, thrust, fist, staff, spin rings, orbs, nova, bolt): `family = element`. Only the ramp in
  the LUT changes. The element's overlays, trail, impact spokes and statuses are added.
- **Matter carriers** (blade, cleaver, hammer, knife, needle, dart, hook, net, thorn): the material family is kept and
  `imbue = element`. The element arrives as:
  - a glow-twin rim dilated in element R3
  - element trail motes
  - element impact spokes
  - element status overlays
- Both: tier +1 (from compose) is drawn as visual tier +1.
- Test: an infused skill keeps its root's carrier and body for every root × element.

### 7.2 Essences (`~mod`) = parameter tweaks

| essence | visual |
|---|---|
| split | burst `split` (6-point star) at spawn |
| flurry | the extra swing alternates `sense` |
| arc | `riders.arc` → bolt zaps (strength 0.7, `seq: 'zap'`) from the struck target; on chains, the extra jumps only |
| pierce | pierce marks at each pass-through: burst pierce tick + 6 spark motes in an exit cone + a 2 px trace |
| return | `riders.returns` → turn glint + ring r8→16 · 2 px bead tether every 6 px (lightning/storm: ±1 px jitter, blink ≤ 2 Hz) · catch glint |
| reprise | `riders.reprise` → caster afterimage `mirror` (0.75 / 0.5 / 0.25) + small ring; the replay uses the **same** geometry and buckets with LUT `shift` and no hero frames or juice |
| expanse | geometry comes from the composed (larger) shape; + one outer ring (thick 1, ink dim, r + 4) on cast/area rings; unit count ×1.3 (cap 14) |
| haste | 4 line motes on cast; **playback speed unchanged** (haste only shortens the cooldown) |
| heavy | weight +1 (cap heavy): contrast frame, wider smear, ground impact (ring shock + cracks + chips); knockback comes through statuses |
| leech | `riders.leech` → 3–6 blood motes on quadratic paths (±8–16 px), 3 waves 60 ms apart over 250–400 ms, turning heal ramp for the last 30%; heal glint at the caster |

Test: a variant's visual radius and arc equal its composed shape's (within bucket tolerance).

### 7.3 Shape merges (`fuse:a|b`) = secondary accent

- Carrier, style and body come from the **primary** parent's own tags (§6.1). They never come from the merged tag union.
- `echo = familyOf(secondary)` when it differs from the family.
- The accent comes from the mechanical difference compose() made (compare the merged and primary shape and riders):

| difference | accent | what wears the echo family (drawn once) |
|---|---|---|
| hits / pulses / count / jumps + 1 | extra | `riders.merge.pieces` = the carrier piece of the extra swing, pulse, shot or hop (it replaces the plain one) |
| `radial` added | radial | `riders.merge.pieces` = a second muzzle ring after the plain one |
| dash `spin` added | spinDash | dash mode spin; its spin band |
| `riders.knockback` added | knockback | the knockback status pieces |
| `riders.arc` added | arc | the arc rider zap (`riders.arc`) |
| none | none | only the echo overlays on the cast and impact phases |

Every merge also gets echo motes on the cast and impact phases. The accent is applied after the signature patch, so
an `extra` hit repeats the signature's body (e.g. glacial_orb's shard orb, tornado's funnel), never the pre-patch one.

Tests: every legal merge (mergeBlocker null, about 4k) derives, its carrier equals the primary parent's, and each
accent is drawn once in the echo family on the finished carrier.

## 8. Runtime contract (the later wiring step)

### 8.1 Ground truth from the code (VFX geometry must match)

| shape | player hit test (SkillSystem) | monster hit test (MonsterSkills) | timing |
|---|---|---|---|
| strike | sector from the feet, r = range + m.radius, half-arc + atan(m.r/d); always hits within m.radius + 8 | sector from the feet, r = range + m.radius (+ PLAYER_R) | swings 130 ms apart (player), 220 ms (monster); tell 300 ms |
| spin | circle ≤ radius + m.radius | ellipse rx = radius + m.radius, ry = 0.65·rx | pulses 170 ms (player), 260 ms (monster); falloff 0.85 after the first; tell 400 ms |
| projectile | circle ≤ m.radius + size/2; drawn at y − 14, depth y + 20 | circle ≤ PLAYER_R + size/2; spawns at m.y − min(30, h/2) | tell 300 ms |
| dash | segment ≤ width/2 + m.radius, resolved at 60% of 170 ms | segment ≤ max(24, width)/2 + PLAYER_R; sweep max(140, len/1.1) ms | tell 400 ms |
| nova | circle ≤ radius + m.radius at the aim (≤ range) after `delay` (default 200) | ellipse (r, 0.65r) at the player's position after max(500, delay) + castMs | — |
| chain | first ≤ range + m.radius; hops ≤ 150 px; start y − 16, targets y − 10; 60 ms (bolt) / 90 ms (knife) | circle ≤ range + PLAYER_R | tell 300 ms |
| buff | — | — | tell 400 ms |

Other values:
- Arc rider: 120 px radius, zaps at 50 + 40·i ms.
- Status durations: burn 1.6 s (ticks every 500 ms) · poison 4 s · bleed 2 s · slow / soak / freeze 2.2 s · stun 0.65 s
  · shock 1.2 s · smite 1 s.
- PLAYER_R: one constant, 12 px (`SkillSystem.PLAYER_R`), used by Combat and MonsterSkills (§13 item 4).
- Monster zone (nova / spin) and cone (strike) tells last at least `fairTellMs(tell, r)` = max(tell, min(900, 350 +
  2.5 r)) ms, r = the zone radius (spins and cones: + m.radius) (`recipe.ts`, MonsterSkills; §13 item 3).

VFX consequences:
- Player rings and fills use aspect 1. Monster zones use 0.65. The monster chain range uses aspect 1.
- Smears reach the true range ± 4 px.
- Telegraph rims must lie within 2 px of the hit test in 16 directions (gallery check, automated).

### 8.2 Events: game bus → VFX stream

The game bus is `src/game/events.ts` (`gameBus`, `GameEvents`; it landed during this work). The VFX runtime does not
read it directly: the bridges (`src/game/vfx/bridge.ts` for player skills, `src/game/vfx/world.ts` for the world)
subscribe through `sceneScope(scene)` and play recipes; the table maps every field the way the normalized `VfxEvents`
(`types.ts`) describes it. Recipes and pieces never see the bus.

| VfxEvents | from GameEvents | bridge derivation until the bus carries the field | VFX phase |
|---|---|---|---|
| castStart | castStart | caster = player | charge (+ preview) |
| castFire | castFire (once per cast) | — | cast muzzles; charge ends |
| pulse | **skillPulse (requested)**: each strike swing / spin pulse, player (SkillSystem.run delayedCalls) and monster (MonsterSkills swing / pulse) | none (VFX must not re-time swings); fallback: index 0 only from castFire | cast (smears, spin bands) |
| projectileSpawn | projectileSpawn (`obj`, `angle`, `size`) | `mover` = `obj`; id = bridge counter keyed by obj | body + trail |
| projectileEnd | projectileEnd (`hit` / `range` / `wall` / `return`) | range → expire, return → caught | expire → fizzle · wall → dust puff · caught → glint · hit → nothing (the hit draws it) |
| chainHop | chainHop (`knives`, `from`, `to`, `index`) | — | body (bolt / knife) |
| novaTelegraph | novaTelegraph (`radius`, `delayMs`) | timing = { now, now + delayMs } on the world clock; aspect 1 for the player | telegraph |
| novaBlast | novaBlast (`radius`, `heavy`) | aspect: player 1, monster 0.65 | area |
| dash | dash | spin = `skill.shape.spin` | cast + trail + area |
| buffApplied | buffApplied | untilMs = now + durationMs | aura |
| statusApplied | statusApplied (dropped when `blocked`) | untilMs from Combat's fixed durations (§8.1); source = last hit's skill on that target | status |
| hit | hit (monster targets); playerHurt (player target, `dot` dropped) | relation from `resisted` / `multiplier` (> 1 strong, < 1 weak); ang from player → target; `via`/`from` unknown → no arc zap | impact |
| heal | heal (leech / smite) | from = last hit target | leech / smite stream |
| combo | combo (`consumes`) | freeze → shatter, soak → conduct, burn → fan; spreadTo = monsters within 48 px | combo pieces (below) |
| death | kill (monster); death (player) | — | death pop |
| monsterTelegraph | monsterTelegraph (`shape`, `at`, `durationMs`, `radius`) | tell from the §8.1 rules (zone rx = radius + m.radius, ry 0.65·rx; cone r = range + m.radius; lane to dashEnd; aim to the player; range circle); timing = { now, now + durationMs }; state `cancel` when the monster dies or `monsterTelegraphEnd` says so | telegraph + charge |
| spark / levelUp (extra) | spark / levelUp | spark at = last hit target | extras |
| (chain links) | **chainLaunch** (runtime addition) `{ from, to, index, target \| null, knives, flightMs }` | — | a link leaves: lightning shows at once, knives fly `flightMs` (90) before their chainHop; also the fizzle of a chain with no target |

Bus additions requested from the events.ts owner (one-line emits; behaviour unchanged):
1. **`skillPulse`** `{ skill, owner, index, count, x, y, aim }`, emitted per strike swing and spin pulse (player and
   monster). This is the only addition without a usable fallback.
2. **`castId`** on castFire, skillPulse, hit, projectileSpawn, chainHop and novaBlast, plus `reprise: boolean`.
3. `hit.arc?: { from: Pt }` for arc-rider zaps, and `hit.via?: 'pierce' | 'return'`.
4. `statusApplied.untilMs` and `statusApplied.source` (skill).
5. `monsterTelegraph.id`, the live `timing` record and the exact `tell`, plus `monsterTelegraphEnd { id, reason:
   'resolve' | 'cancel' }`.
6. `spark` / `heal` positions, `combo.spreadTo`, and an `enrage` event.

Combo pieces:
- Shatter: freeze shatter + an ice crit ring.
- Conduct: lightning ring + zap across the target + steam puffs.
- Fan the Flames: a small fire pulse + ember streams to `spreadTo`.

Death pop (replaces the alpha/scaleY tween in Combat.kill): a 1-tick white silhouette → actor hidden → nova blast in
the killer's family (c24 for S / M bodies, c40 heavy for L / W) + 4–8 chips in the hide colour + puff (r5–r10).

Extras:
- spark: burst `star` held through the freeze + 14 ray streaks + glow pool
- levelUp: gold light-pillar + double ring
- enrage: 2 danger rings + burst; trauma 0.5

### 8.3 Layers, depth and blend (src/game/render/depths.ts)

| VfxLayer | depth | blend | contents |
|---|---|---|---|
| ground | `DEPTH.FX_GROUND` | normal / multiply | decals, floor bands, back halves of area rings, dust |
| preview | `DEPTH.AIM_PREVIEW` | normal | player wind-up previews and nova markers (danger fills draw above them) |
| tell | `DEPTH.TELEGRAPH` | normal | monster fills, lane chevrons |
| body | `ySort(anchorY ± 1, Y_BIAS.ARC / PROJECTILE / PARTICLE / PILLAR)` | normal | smears, bodies, units, bursts, puffs, status units, aura halves |
| rim | `DEPTH.TELL_TOP` (150010, above `LIGHT_TOP`; added to depths.ts during this work) | normal | monster rim duplicates, aim beads, arrows, lock flash, edge indicators. They stay above glow and darkness |
| glow | `DEPTH.FX_GLOW`, one Layer with ADD | add | white glow twins tinted per family (front halves only); gain from the biome profile |
| light | `DEPTH.LIGHT` on dark maps | add | glow twins move here; when QUALITY-PLAN's light map lands they become hard-banded light stamps |

- Expected blend switches: about 3 per frame.
- Telegraph layers render after OmniGrade (or on the ungraded camera), so they are never regraded or desaturated.

### 8.4 Clocks and playback

- **World channel**: scene time. It pauses with global hit-stop, so impact sparks hold their hero frame. A victim
  under local hit-stop also freezes its status units.
- **Real channel**: `performance.now` delta, for UI-like pieces (edge indicators).
- Telegraph and fill progress always come from the event's `timing` record (`start`, `at`), read every frame, never
  from a VFX timer. This keeps the lock frame on the damage tick through hit-stops and `shiftTime`.
- Gameplay triggers stay where they are (strike 130 ms, spin 170 ms, nova delay, chain 60/90 ms). The VFX never
  schedules gameplay-timed repeats; each swing, pulse and hop is its own event.
- Battery saver (30 fps): frame times round to multiples of 33 ms; totals stay within one frame.
- Player wind-up previews come from `recipe.geometry` + aim:
  - nova: ring + fill
  - dash: lane edges
  - spin: ring
  - strike: cone arc
  - They use the family ramp, 2 px solid rims, 12.5% fills in the family's darkest stop (a tint, not bright specks) and never danger.
  - A nova wider than the view shows the visible arc of its rim plus a centre marker. When the touch point covers the
    target, the marker gets an offset callout.
- Runtime randomness: one stream per cast, `mulberry32(hashSeed(recipe.variety, castId))`. Particle emitters get every
  value through `onEmit` callbacks from that stream. They never use `{min, max}` or array-random ops, which use
  Math.random inside Phaser.
- Capture mode (`?vfx=gallery&capture`): `game.loop.sleep()` + `game.step(t, 1000/60)`. Monster bob is seeded from the
  monster id.

### 8.5 Atlas, bake scheduling and uploads

- Pages:
  - 1024² canvases registered with `textures.addImage`, at most 4 (16 MB GPU + backing)
  - shelf packing with a 2 px gutter; one animation's frames stay contiguous on one page
  - `Texture.add` + `Frame.setTrim` keep a fixed anchor on trimmed frames
- Animations use per-frame `duration` and never pass `frameRate` to `play()`.
- Uploads: dirty rectangles via `texSubImage2D` (or a 512² staging page), ≤ 1 MB per frame, at most one page flush
  per frame.
- **Bake schedule**:
  - boot (≤ 150 ms, time-sliced at ≤ 4 ms per frame): motes, puffs, the danger and steel ring pieces, burst steel, tell
    pieces
  - map create / loadout change, behind the fade (`mapBakeMs` 600; the worst case measures about 0.45 s in Node), one
    strip direction per slice, cast / body / impact pieces first: the **warm set** = the recipes of the 8 equipped
    skills with every spark variant, the techniques and auto-attacks of the map's spawns, their statuses. It must fit
    the atlas: `tests/vfx-pipeline` bakes the worst 8-skill loadout + the densest map (2.97 pages today) against
    4 pages at 85 % shelf-packing efficiency (3.40).
  - lazy (bake on first use into the remaining space, evict least recently used): death pops, combos, extras,
    reduce-flash and keyline variants (with them the worst case is 3.41 pages)
  - mid-combat miss: ≤ 1 strip per frame when the strip bakes in ≤ 2 ms; a bigger strip waits for the next fade or
    pause. Until it is ready, play the family fallback (white burst tinted R3 + ring), never blank
  - a newly learned morph bakes during the spark freeze
- **Bolts** are the only cast-time bakes. Each hop rasterises into a pooled transient texture (8 × 256², 2 × 512²).
  Hops longer than `boltMaxLen` split at the midpoint. If the upload budget is spent, the hop is drawn as a 2 px bead
  line.
- Memory: pool every canvas and texture; release transient canvases explicitly (width = height = 0).
- Context loss: re-bake the pages from the cached recipes. Canvas renderer (Low tier): no glow, no ghosts, no
  tint-dependent pieces; white silhouettes baked where needed.

### 8.6 Integration requests (owned by other agents; not done by P or R)

1. ~~`DEPTH.TELL_TOP` in depths.ts~~ (done: 150010).
2. ~~events.ts gains the §8.2 bus additions (`skillPulse` first).~~ (done; `chainLaunch` added by the runtime step).
3. Monster:
   - ~~local hit-stop on its sprite~~ (done, §8.9: `hold()` freezes the sprite and its frame, visual only; a post-hold
     catch-up avoids a snap after knockback). Slow / freeze still read from the status tints.
   - a TintArbiter in `restoreTint` (hit flash > freeze > shock tick > DoT tick > elite tint) (partly done: impact flash
     frames > frozen > stunned > slowed > elite tint; no shock / DoT tick tints yet)
   - overlay anchors mapped through the sprite transform
4. art/monsters.ts exports each texture's hide colour (elite tint applied) and top-edge anchor points, so nothing is
   read back from the GPU.
5. Settings: "Reduce shake & flashes" (trauma ×0.3, no screen flash, `reduceFlash` bakes, shock tint → R4). (runtime side
   done: `runtime/settings.ts`; the settings-panel toggle is the UI lane's)
6. ~~The juice rig replaces direct `cameras.main.shake` / `flash` calls~~ (done, §8.9: render/camera.ts `CameraRig`;
   every remaining legacy call is routed into it by `install()`).
7. Shade_cloak sets the actor's alpha to 0.55 (open); ~~the player's class aura Graphics move to the aura loop~~ (done,
   §8.9).

### 8.7 Migration

The runtime step turns today's `fx*` helpers in SkillSystem into thin adapters onto the VFX runtime, one shape at a
time, behind `?vfx=legacy` for A/B comparison until each gallery sheet is signed off. Order:
1. sparks, strikes, projectiles
2. novas, spins, telegraphs
3. statuses, buffs, riders, dashes, chains
4. signatures and monsters
5. then the legacy code and the `cfx_*` / `fx_*` textures are deleted

Graphics objects leave the VFX path entirely; only debug overlays keep them.

### 8.8 Runtime as built (player skills)

Files: `src/game/vfx/play.ts` (the play contract, Phaser-free), `src/game/vfx/bridge.ts` (bus → plays, Phaser-free,
`tests/vfx-bridge.test.ts`), `src/game/vfx/runtime/` — `index.ts` (`attachVfx(scene)`: MapScene's one seam),
`runtime.ts` (instances, placement, particles, governor), `atlas.ts`, `baker.ts`, `bolts.ts`, `pools.ts`,
`place.ts`, `settings.ts`. The camera rig is `Stage.addTrauma()` in `render/stage.ts`.

- **Seam.** `MapScene.create()` calls `this.vfx = attachVfx(this)` after the stage and player exist; the bridge
  subscribes through `sceneScope` and the runtime tears down on SHUTDOWN. The atlas, the baker queue and the bolt
  canvases are run-wide (one per Phaser.Game): a map change keeps everything baked.
- **What the bridge plays** (player only): castStart → charge (alive while `Combat.windup.castId` matches; a
  cancelled wind-up ends it); castFire → ends the charge, chain muzzles; skillPulse → cast phase per swing / pulse
  (odd swings `sense -1`; `firstHitOnly` / `laterHits` / `lastHit` filtering; the merge `extra` piece replaces the
  carrier on the final swing; spin floor bands each pulse; heavy strike ground impact on the last swing);
  projectileSpawn → body + trail following the mover (drawn at y − 14, sorted by its ground y; heading from its
  velocity), returns rider via a per-frame watcher (turn glint, bead tether); projectileEnd → fizzle / dust / catch;
  chainLaunch → cast-time bolt or a knife flying a quadratic bow; novaTelegraph / novaBlast → marker / area;
  dash → cast, trail (ghosts by distance), landing; buffApplied → activation + aura loop (a refresh ends the old
  loop and its pending break); hit → `impactPieces` (tick sparks within 100 ms), victim hold on the first spark
  (juice hit-stop + 17 ms on crits, ≤ 100 ms, a visual hold only: gameplay untouched), trauma once per cast, arc
  zaps from `hit.from`, leech streams (paired with the `heal` event of the same hit); statusApplied on monsters →
  status units (≤ 2 loops per target by priority, one-shots exempt, loops live until `untilMs`); combo; spark;
  levelUp. Warm set: the bar's recipes + impact variants + statuses, re-warmed on barChanged / skillLearned.
- **Removed legacy** (player path): SkillSystem `fxStrike/fxSpin/fxNova/fxTelegraph/fxGhost/fxKnifeHop/fxArcZap/
  fxSpark/fxStream/fxImpact`, projectile textures, trails and tethers, dash ghosts, buff rings and their camera
  shakes; Combat's hit / combo / arc / leech / spark / knockback / level-up visuals and monster status motes;
  MapScene's spark ring + camera flash. Timings, hit tests and gameplay are unchanged (vitest green).
- **Atlas.** ≤ 4 pages of 1024², best-fit shelves, 2 px gutters; a strip direction stays on one page; white glow
  twins stored once per geometry key; repeated frames share one rectangle. Uploads are dirty rectangles via
  `texSubImage2D` on the page's own GL texture (Phaser's binding restored), ≤ 1 MB per frame in PRE_RENDER; a strip
  draws only when uploaded. Full atlas → the least recently used page with no live user is freed.
- **Baker.** One unique direction per step (mirrors `bakePiece`). In-frame: urgent small strips within 2 ms; big
  strips (`bigBake`: smears r ≥ 56, c ≥ 40 cores, orbit orbs, big decals, auras, m / l units) and the warm set run in
  `requestIdleCallback` slices (≤ 8 ms), which also run while a panel pauses the scene. Until a strip is ready the
  piece plays the family fallback (steel burst tint-filled R3; a steel charge orb tinted R3 for bodies).
- **Placement.** Strips are pooled Images (origin 0,0; trimmed frames placed at anchor − (ox, oy); flips mirror
  around the anchor pixel); body pieces sort with `ySort(anchor y, bias)`; whole body-layer rings and auras round an
  actor bake `half: back / front` and sort at y − 1 / y + 1 (glow on the front half only). Rings over 64 px and
  aim-relative arcs are 10 px band chunks on Blitter bobs (sweep / expand ink from per-ink chunk sets, smear sweeps
  from per-stage sets; a crowded pool — over 60 %, thin / dim bands over 50 % — places every 2nd or 3rd chunk; cue
  rings never thin). Motes are runtime particles on
  shared Blitters (closed-form drag + gravity, age-stepped frames, directional kinds by velocity); mote blitters
  sit at `VFX_DEPTH.FX_MOTES` (89000, over the y-sorted band). Glow twins: one ADD Layer at `FX_GLOW`
  (`LIGHT` on dark maps), tinted family R4 at the biome gain. Afterimages snapshot the actor's frame
  (tint-fill R3, stepped alpha). Bolts compose per hop from their look's pre-baked strip pool (§8.12) into pooled
  256² / 512² canvases (bead line when none is free).
- **Simplifications.** A slash bakes one sweep sense; flipped headings are not mirror-corrected (a left-facing swing
  sweeps the other way round); multi-hit strikes also warm sense −1 for their back-swings. Far-half erupt units
  keep the base LUT. The screen flash for ultimate novas is not drawn (trauma only).
- **Governor.** EMA of the frame delta: 1 → 0.5 after 30 frames > 20 ms, → 0.25 after 30 > 26 ms, back up after 120
  < 15 ms. 0.5: counts ×0.5, every 2nd chunk, no echo pieces; 0.25: no trails, ≤ 3 units, no decals, no glow, no
  ghosts. The Canvas renderer runs at 0.25. `neverGoverned` pieces are exempt. `vfx.setQuality(q | null)` pins.
- **Reduce shake & flashes**: `setReduceFlash(on)` (runtime/settings.ts): reduce-flash bakes for every new play,
  trauma × 0.3. The area flash budget (`flashOk`) gates every frame's hero pieces (§8.11).
- **Measured** (Playwright + SwiftShader on a shared container CPU, `window.omnipath.scene.vfx.stats()`, 8 AoE-heavy
  skills on the bar, AUTO, 14 monsters kept round the player, discovery cards dismissed, 20 s; grass and a dark crypt,
  several runs): peak body sprites 59-75 / 96, glow 47-58 / 64, ground 4-27 / 40, bobs 267-280 / 280 player share
  (≤ 14 chunks refused: rings thin to every 2nd / 3rd chunk under pressure), particles 74-96 / 250, atlas 3 / 4 pages
  (1.6 pages of pixels), ≤ 6 mote blitters. VFX update EMA 1.3-2.4 ms (instances 0.9-1.3, in-frame bakes ≤ 0.3,
  particles ≤ 0.2) against the 1.5 ms budget, single-frame peaks 7-11 ms (cast-time bolt bakes). Status units are
  low priority (≤ 2/3 of the sprite pools) and > 8 affected targets show pips, so casts and sparks are never starved.
  Frames p50 / p95: 17-24 / 24-46 ms with VFX vs 17 / 30 ms without (software GL is fill-rate bound; the governor
  sat at 0.25-0.5). The device gate (§11.3) is still to do.
- **QA.** `window.omnipath.scene.vfx` exposes `stats()`, `resetPeaks()`, `setReduceFlash()`, `setQuality()`.
  Effects were checked mid-frame by stepping `game.step()` with the loop asleep, with the hit-test geometry drawn
  over them (rims sit on the hit circles; strike smears ride 12 px up at swing height, as SkillSystem draws them).

### 8.9 World lane as built (monsters, statuses, hit feel, camera)

Files: `src/game/vfx/world.ts` (WorldBridge: the bus events bridge.ts leaves alone, Phaser-free), `juice.ts` (JuiceRig,
`holdFor`), `tellraster.ts` (TellRaster: telegraph pixels), `runtime/telegraph.ts` (TelegraphFx: pooled tell canvases),
`src/game/render/camera.ts` (CameraRig) + its hook in `render/stage.ts`, `src/game/systems/tellhit.ts` (the monster hit
tests and `PLAYER_R`, Phaser-free). Tests: `tests/vfx-tell.test.ts`, `tests/vfx-world.test.ts`. Bus additions
(append-only): `monsterTelegraph.live` (the tell's live geometry function) and `.phases` (`TellPhase` records: the
wind-up, then each follow-up swing / pulse), `monsterSpawn`, and `chainLaunch` with `target: null` for a monster chain
that found nothing in reach.

- **One geometry, two readers.** MonsterSkills builds ONE `geom()` per tell (zone, cone, lane, aim, range, aura; live:
  a pushed caster moves it, an aim follows the player). TelegraphFx draws it every frame and the tellhit.ts predicates
  hit-test the very same shape when it lands, so a rim cannot drift from its hit area. MonsterSkills draws nothing.
- **Telegraphs are rasterised, not baked** (exact radii never fit buckets). Per tell a pooled canvas texture holds three
  regions: the **fill** (`DEPTH.TELEGRAPH`, under bodies): danger R1 at 12.5 % over the whole area (25 % in the last
  third) and the **fill-up front** — 31.25 % danger (12.5 % R2 + 18.75 % R1: a wine-red tint, not a neon sheet; in-game QA
  pass) + a 6.25 % family hint inside a front growing from the centre /
  caster / lane start to the rim as the wind-up runs out, edged by a 1 px R4 line (the gap to the rim is the time left);
  lanes add `>` chevrons marching toward the far end. The **rim** (`DEPTH.TELL_TOP`, above canopies, glow and
  darkness): 2 px dashes whose OUTER edge is the hit boundary, a #24180f keyline outside each dash and a 1 px dark
  connector in the gaps; lanes add an arrow head past the far cap; aims are 2 px dashed lines marching outward; chain
  ranges a static dashed circle (aspect 1, as hit-tested) plus a bead tether to the player while in reach. The rim is
  white + keyline, **tinted** per state (danger R3 → R4 in the last 15 % → #fff8f0 lock in the last 50 ms), so a state
  change uploads nothing. The **edge marker** (13 px danger disc with a "!") sits at the view edge toward an off-view
  tell. Cancels dissolve in two dithered frames (+ a fizzle at the caster).
- **Cadence and uploads.** Everything moves on 67 ms ticks (marching 2 px per tick, doubled in the last 25 %); the fill
  re-rasterises only when the front moved a pixel or the density stepped, the rim re-uploads only the 8-row stripes
  that hold rim pixels (a few KB instead of its box). Tells share a 512 KB / frame upload budget; over it a re-raster
  waits a frame (the last one keeps showing); the fill likewise uploads only the stripes the front crossed (all of it
  only at the 66 % density step). Never governed, culled or dropped.
- **Follow-up phases** (strike `hits`, spin `pulses`) keep the rim and restart the front half full; the progress of each
  phase is read from its live record every frame (`shiftTime`, hit-stops and pauses keep the lock on the hit).
- **Caster cue** (the recipe's `charge` phase) re-timed to the real wind-up: converge motes + the danger ring under the
  feet scaled to the body (`rScale`); shots add the mouth charge orb at `m.y − min(30, h/2)`; buffs the aura activation
  at the monster's body bucket; **elites and wardens** gather a family glow pool (fill decal on the glow layer).
- **Monster bodies and impacts** (`deriveVfx(skill, 'monster')`, quota 0.5, monster LUT): skillPulse swings / pulses /
  volley releases (geometryFromEvent rings and smears scaled by `PlayCtx.rScale` = true reach / nominal: spins and
  strikes reach + the caster's radius), shots (invisible bus Image; body + trail follow the mover), chain zaps (cast-time
  bolt to the player; a fizzle when nothing was in reach), novas (0.65 pieces), dashes (ghosts of the monster's own
  sprite), buffs (activation + aura loop until it ends). **Auto-attacks** (`playerHurt` with an attacker and no
  technique): `deriveAttackVfx` claws / lash / sting / slam / spark from the attacker toward the player + its impact;
  Combat's sprite-y tween became a 3 px whole-pixel lunge (`recoil`).
- **The player**: technique impacts (danger burst), statuses (≤ 2 loops by priority, never low priority, pips for the
  rest, a grey immune glint when crowd-control immunity blocks a stun / freeze), the hex ward flaring on a blow, the Tier
  III class aura (aura loop: ascendant `glint` / holy, eclipse_walker `veil` / twilight). Player.sync no longer draws
  buff rings, stun stars, frost / poison tints or Tier III motes; Combat's player status motes are gone.
- **Deaths and spawns.** A monster death: two white frames on the real sprite, hidden 34 ms later, then `deathPieces`
  (nova blast in the killer's family, chips, puff) 33 ms delayed; Combat's alpha / fractional scaleY tween is gone. A
  respawn emits `monsterSpawn`: white frames + dust puff + ring + rising glints (no 400 ms alpha fade). Player death: a
  danger burst and smoke; status loops end.
- **Extras**: enrage (two danger rings + burst, trauma 0.5 near the player), gather sparkles by node kind, a discovery
  glint over the head, and named world moments (`VfxHandle.extra`: chest, waystone, campfire, meditate, rest, reveal,
  blink). SkillSystem keeps only `fxBurst` / `fxRing` as adapters (MapScene's portal reveal and blink); every other
  legacy fx helper and the `cfx_*` textures are deleted.
- **Hit feel (juice.ts).** Victim-local, visual hit-stop: `hold()` freezes the victim's sprite and frame (gameplay keeps
  running; the sprite catches up over ~3 frames after); requests coalesce (only the part past the current hold costs
  budget), each ≤ 100 ms and ≤ 150 ms per victim per rolling second. The hold = the recipe weight's (light 0, normal 33,
  heavy 67, ultimate 100; crit +17) × 0.5..1.2 by the share of the victim's HP the blow took; later hits of a cast hold
  0; hits on the player hold half. The impact spark holds its hero frame exactly as long. Impact frame: ONE rendered
  frame of white (reduce-flash: the element's R4), a 1-frame 2 px squash and a whole-pixel recoil along the blow (1 / 1 /
  2 / 3 px by weight; 2-3 px on the player), through the per-victim **body-flash gate** (§8.12): only a cast's first hit
  on a victim flashes, later ticks of it within 150 ms are spark-only, a victim flashes at most once per 220 ms and per
  8 rendered frames; DoT ticks share the gate (one frame of the tick colour); deaths and spawns are not gated. Kicks: the player's heavy / ultimate casts 2 / 3 px
  along the blow, a hit on the player 2 px (heavy 4) along it. Trauma: heavy blows on the player 0.35, warden slams 0.5
  (×0.6 when not heavy), elites' heavy blasts 0.15 — all faded by distance (full within r + 40, none past r + 200).
- **Camera rig (render/camera.ts).** Trauma² shake in whole art px (max 6, τ decays 2 / s, value noise, never
  rotation), a critically damped kick spring (≤ 6 px), a governed screen flash (a full-view rectangle stepped down over
  3 frames, alpha ≤ 0.35, ≥ 333 ms apart, ≤ 3 / s), the **warden intro pan** (once per warden per visit, on first sight
  after the arrival beat or on aggro, never on the arrival itself — `IntroWatch`, §8.12: ease 450 ms toward 55 % of the
  way, hold 650, ease back; never more than 32 % of the view away from the player) and a **lead** (18 %, ≤ 24 px) toward a warden / elite target in manual play. The stage adds
  the look before its map clamp and the jolt after. `install()` routes any remaining `cameras.main.shake / flash` into
  the rig. **Reduce shake & flashes**: trauma and kicks ×0.3, no flashes, no pans, impact frames without the white.
- **Fixes found in the browser pass**: the freeze crystal was keylined after its 25 % dither (a dark ring round every
  dot made an opaque checkerboard over the body): it now keylines the silhouette, then dithers; status units never take
  the biome keyline; the death puff uses the dust ramp (the smoke ramp's crescent erosion read as a black hole on grass).
- **QA.** A Playwright pass (scratch scripts, not shipped) forced every telegraphed technique family
  (`monsterSkills.start`) with the loop asleep and stepped frames: jelly_slam (nova), mon_gust (cone), mon_zap (range),
  gale_feather (3 aims), mon_ember_spit (aim), ember_pounce / boulder_roll (lanes), Hollow Regent's umbral_rend (140°
  two-swing cone) and wail on its dark map, Thunderhoof's thunder_stomp, Ironroot's tremor_stomp (dark), the matriarch's
  3-pulse spore_burst — screenshots at 50 % / 90 % / the hit, with and without a 1 px hit-test overlay (rims coincide).
  Then the hit feel (heavy cleave: white → element frames, 2 px recoil held through the hold, kicks), the death and
  spawn pops, burn / shock / freeze / soak / slow on the player, rimefang's claws, Conduct and Fan the Flames, the warden
  pan (look 0 → 143 px → 0 over 1.5 s) and the enrage roar; no console errors. Busy dark map (Hollow Barrow II, 14
  monsters kept round the player, SwiftShader): without AUTO (techniques firing) VFX update EMA 0.5 ms, peak 2.3 ms,
  tell uploads ~100 KB/s, frames p50 / p95 16.7 / 20.6 ms; with AUTO and 8 AoE skills the player-side pools hit their
  caps as in §8.8 (the governor at 0.5). `vfx.stats()` adds `tells`, `juice` and `camera` counters.

### 8.10 In-game QA pass (phone portrait, every skill and technique)

Harness (scratch, not shipped): a Playwright script at 390 × 844, DPR 1 (k = 1: one art px per device px) learns every
authored player skill (150) through the debug hooks and casts it at a staged monster trio on open grass (Greenmeadow)
and on a dark crypt floor (Hollow Barrow I), and spawns the owner of each of the 27 monster techniques next to the
player on both maps and forces the technique. The game loop sleeps for good after setup and every frame is a manual
16.7 ms step on one monotonic clock (waking the rAF loop moves scene time back to wall time and `Combat.syncClock`
then shifts timers over the jumps); only capture frames render the world camera. Three frames per effect: cast
(70 % of the wind-up, or the first frame), peak (fire + 3-7 frames) and impact (first `hit` / `playerHurt` + 2),
stitched into review sheets with a page canvas. Discovery cards are suppressed during capture (they pause the scene).

Fixed in this pass:
- **Crash (all builds since the runtime landed).** An atlas eviction removed every named frame of a page while
  Phaser's `Texture.firstFrame` still named one, so a new Blitter (and any Image) on that page resolved its default
  frame to `undefined` and threw `TypeError: cutWidth` inside the frame loop — the rAF loop then stops for good. It
  showed after ~30 different skills in one session. Eviction now resets `firstFrame` to `__BASE`, blitters are made
  on `__BASE`, the image / bob pools refuse frames a page no longer has, and a live entry pins the pages of its shared
  glow twins too (they can sit on another page).
- **Leak.** The pull status (tornado, firestorm, hooks) played three `static` arcs with no life; one-shot statuses are
  played without a status timer, so they lived as long as the monster (36 instances and a full ground pool after
  one tornado). They now carry the pull's life; `tests/vfx-qa.test.ts` checks every looping piece of the one-shot
  statuses.
- **Spin bands** were a hairline sweep plus a hairline floor band. Blade spins now sweep a **smear** (`smear` 6, heavy
  8: a white-hot head that thins and cools over 32 % of a turn) with 6 rim sparks; the floor band is a 2 px dim ripple
  (no flare). Vortex spins (pull) collapse one ring R → 0.3R under a 2-head swirl smear; the tornado / firestorm
  funnel is 3 stacked smears (it was 3 gapped rings = dashes, the monsters' rim language). Spin-dash bands smear too.
- **Legacy wind-up preview** (Combat `drawPreview`: anti-aliased alpha ellipses with the monster aspect for player
  circles, a soft rectangle lane, a grey cone) is gone; the charge phase's rims are the preview (§8.4).
- **No dashed player rings.** Thinning a chunk ring to every 2nd 10 px chunk read as a dashed rim (the monsters'
  language) and as a fan of loose dashes on shrinking rings. Thin / dim bands now thin only over 50 % of the bob share;
  a crowded shock ring (expand / contract) hides instead of dashing; a crowded smear keeps every chunk of its head and
  drops its mid / dim tail. Orbit and spiral motes follow the placement aspect (spin overlays orbited on a 0.5
  ellipse inside the player's circle).
- **Stranded one-shots.** A one-shot whose strip went missing mid-play (a direction re-baking, a fallback page gone)
  hid and waited forever; it now ends on time (its longest strip + 250 ms). Over 150 casts in one session the live
  instance count returns to 0 (it climbed to 70+ before).
- **Ground pool.** Ground dressing (dust puffs, decals, floor bands) may fill only 2/3 of the ground sprite pool; the
  rest stays free for the gameplay cues on the same pool (wind-up previews, nova markers). Death puffs in a busy fight
  filled all 40 before.

Busy fight (390 × 844, SwiftShader on a shared 4-core container, 8 monsters kept round the player, AUTO, the bar
worldbreaker / firestorm / meteor / thunderstorm / starfall_lattice / arcane_deluge / thousand_cuts / thunder_peal,
25 s, Greenmeadow and Hollow Barrow I): 23-42 fps (the no-VFX baseline measured 40 fps in the same conditions: the
software rasteriser is fill-rate bound and the machine load swung between runs), body sprites ≤ 65 / 96, glow ≤ 25 / 64
(the governor sat at 0.25), ground ≤ 29 / 40 (2/3 cap + cues; 40 / 40 before), bobs 280 / 280 player share (refusals
expected), particles ≤ 111 / 250, atlas ≤ 4 / 4 pages (2.0 pages of pixels), blend switches p50 2 / p95 2-4 per
frame, VFX update EMA 0.9-2.3 ms (mean 0.2-0.3 ms; insts ≤ 0.8, particles ≤ 0.2, bakes ≤ 1.0), single-frame peaks
4-20 ms (in-frame bakes, bolt canvases; before: 7-19 ms). No errors; the before build crashed (`cutWidth`) within 15
signature casts in one session.
- **Readability.** The monster fill-up front is a wine-red tint (12.5 % R2 + 18.75 % R1 + 6.25 % family) instead of a
  50 % neon sheet; the player nova marker fill uses the family's darkest stop (white specks before); the wet aftermath
  starts at 25 % (an r96 50 % disc read as a grey hole); at most two buff aura loops show on the player (the oldest
  gives way; the buff itself stays).

### 8.11 Adversarial review of the runtime integration

Checked against the running build (Playwright, 390 × 844, DPR 1, SwiftShader; scratch scripts) and vitest
(`tests/vfx-review.test.ts`). Gameplay (hit tests, timings, damage) is unchanged by the runtime: the systems' diffs
only drop drawing code, chain / nova / projectile timings match the pre-runtime code line for line, the full suite is
green.

Verified, no change needed:
- **Lifecycle.** Ten warps across five maps with an AUTO fight on each (WebGL and Canvas): bus listeners, scene /
  game / renderer / scale listeners, tweens and timers stay flat; textures plateau at the 4 atlas pages + the bolt and
  tell canvases (run-wide pools); live instances, sprites, bobs and particles return to 0 after each fight; the JS heap
  plateaus. No console errors.
- **Telegraph rims vs hit tests, in world space.** For 8 techniques (zone, cone, range, lane; incl. Hollow Regent's
  140° cone and two lanes) at 50 % and 90 %, every white rim pixel centre lies within [-2.7, +0.4] px of the live
  hit-test boundary (the 2 px dash inside it) and the outline covers the boundary everywhere (64 samples).
- **Saves.** The save carries no VFX state; the setting has its own key; Continue restores and plays.
- **Budgets in a busy fight** (8 heavy skills, AUTO, 8 monsters): body ≤ 55 / 96, ground ≤ 29 / 40, bobs 280 / 280
  player share (refusals expected), particles ≤ 53 / 250, atlas 4 / 4, blend switches p95 2-4, flash area of any one
  piece ≤ 3.6k px (the 19k budget is reached only by several heavy pieces in one frame).

Fixed:
- **Loops outlived their gameplay state.** `PlayCtx.alive` was ignored for loops carrying a lifeMs: a cancelled
  wind-up kept its charge orb, orbiting motes and landing preview for the rest of the cast time, and a killed
  monster's status units (poison bubbles, burn tongues) played on over the empty spot for up to 4 s. Groups now read
  `alive()` once per frame (`Group.halt`) and stop every loop, repeating mote wave, orbit / converge particle and
  not-yet-started one-shot when it turns false (a buff's own break, timed exactly at its end, still plays).
- **Deadlines on the wrong clock.** The bridges compared captured scene-time ends (statusApplied / buffApplied
  `untilMs`) with scene time; Combat shifts the real timers over panel pauses, loop sleeps and hit-stops, so with
  `alive()` honoured those loops would have ended early after any pause. Ends are now deadlines on the runtime's
  world clock (`VfxStage.now`, which stands still through the same gaps): player and monster buff auras, monster and
  player status loops, the hex-ward flare window.
- **Telegraph front during the spark freeze.** Tells read scene time, which runs on through `MapScene.hitStop`; the
  fill-up front ran ahead for 150 ms and snapped back when Combat shifted the timing records. The tell clock now holds
  while the world is hit-stopped (`timeScale` 0).
- **Canvas renderer rims were white.** Images cannot be tinted on the Canvas renderer, so the danger / hot / lock rim
  states all drew white. There the state colour is multiplied into the uploaded rim pixels (one small re-upload per
  state change).
- **"Reduce shake & flashes" ignored prefers-reduced-motion** whenever localStorage was available (an unset key read
  as "off"). A fresh install now follows the device; a stored choice wins. Changing it re-warms the loadout and the
  map's spawns in the new bake variant (`onReduceFlash`), so the next casts do not play fallbacks.
- **Flash budget not applied.** `flashOk` existed but nothing called it. Hero pieces now add their baked flash area per
  frame; past 19k px a frame counts as one flash (≤ 3 / s, ≥ 333 ms apart) and, when refused, that frame's remaining
  hero pieces play their reduce-flash bake.
- **CPU spikes over the frame budget.** In-frame bake slices started a step even with no time left, and nova c24
  cores (death pops) took 3-6 ms per direction on the container CPU: single frames reached 6-9 ms. Novas from c24 now
  bake in idle slices; a slice no longer starts a step its running step-time estimate would overrun; and a size class
  whose in-frame step overran the slice once is baked in idle slices from then on (adaptive, per device). Busy fight
  after: 0 of ~600 frames over 3 ms (peak 3.0, EMA ≤ 0.65 ms; before 3-4 frames over, peak 6-9 ms).
- **Bake retry churn when the atlas is pinned full.** A request that found no room even after evictions was re-queued
  by every waiting instance every frame, re-baking the whole direction just to fail again; it now backs off 1.5 s (the
  effect keeps its fallback).
- **Per-frame allocations.** The runtime's frame loop rebuilt its watcher, group, instance and particle arrays with
  `filter` (plus a closure per call) every frame; all are compacted in place now, as is the telegraph list; the camera
  shake's value noise no longer allocates a closure per call. Remaining per-frame garbage is a few small `{x, y}`
  anchor points per live sprite (young-generation, measured harmless).
- **A screen flash stuck behind a panel.** The rig steps flash frames in `update()`, which stops while a panel pauses
  the world: a warden-kill flash caught mid-way stayed up (≤ 0.35 alpha) behind a windowed panel. The stage settles it
  on the scene's PAUSE.

Not changed (noted): the "24 concurrent effect instances" figure is not a cap in code (busy fights reach ~45 groups);
the sprite, bob, particle, page and CPU caps bound the cost and are enforced. A thin (1 px) arcane floor band is
legitimate design, not a cue.

### 8.12 Polish pass (Phase C/D: flash gate, pan trigger, reads, bolt pool, long ring chunks, monster shots)

Measured with Playwright + SwiftShader on a shared, heavily loaded container CPU (scratch scripts, not shipped):
a frame sampler records, on every rendered frame (`postrender`), which monsters are a solid tint-fill silhouette
(`sprite.tintFill`), in a busy AUTO fight with multi-hit skills (thunder_peal, thousand_cuts, thunderstorm,
arcane_deluge, firestorm, starfall_lattice, whirlwind), monsters made tough and unkillable so the target stays on
screen, the player pinned beside it; plus 250 ms-apart crops round the target.

- **Body-flash gate** (`juice.ts` `BODY_FLASH`, `JuiceRig.impact / tick / pop`). Before: every hit queued two tint-fill
  frames (white, then the element's R4) and every DoT tick two more (`Monster.flash`), and Combat flashed the player red
  under the rig's own flash: under multi-hit skills Thunderhoof was a solid silhouette most of the time. Now an impact
  is ONE frame of white (reduce-flash: the hit colour) + squash + recoil, and only on the **first hit of a cast on that
  victim** (the bridge keys the cast record); later hits of the cast within 150 ms are spark-only (no flash, squash or
  recoil), later beats of it only recoil; a victim flashes at most once per **220 ms and per 8 rendered frames** (so a
  1-frame flash covers ≤ 12.5 % of the frames at ANY frame rate — 8 frames of cooldown is what holds the limit at
  12-20 fps). DoT ticks share the gate (`tick`: one frame of the tick colour; Combat.damageMonsterRaw); death and spawn
  pops (`pop`: two white frames) are not gated. Results (share of rendered frames the body is a silhouette; longest
  lit run; lit at 250 ms ticks):

  | target | before | after |
  |---|---|---|
  | Thunderhoof, Stormbreak, iPad 1180×820 @2 | 34.3 % (23.5 fps), run 11 frames, 22 of 57 ticks; 4 of 6 crops a silhouette | 9.2-9.9 % (12-13 fps), run 1, 3-5 of 57; 0-1 of 6 |
  | Thunderhoof, phone 390×844 @3 | — | 6.7 % (30 fps), run 1 |
  | Voltmane (elite) + 5 commons, Stormbreak Approach | elite 48.6 %, commons max 45 % (mean 36 %) | elite 7.7 %, commons max 5.9-7.7 % (mean 2-4 %) |

  (The before runs at a lower frame rate read worse still: 54 % at 6 fps.) tests/vfx-world.test.ts simulates the gate
  at 60 / 30 / 20 / 12 fps under a hit every 40 ms: ≤ 15 % everywhere.
- **Warden intro pan** (`render/camera.ts` `IntroWatch`, runtime/index.ts). It fired when a warden stood within 300 px of
  the player — at Stormbreak that is the arrival itself (288 px, during spawn protection and the fade). Now once per
  warden per visit, on **first sight** (it comes into view after the arrival beat) or on **aggro** (Combat.hostile:
  provoked, or aggressive with the player inside its 220 px aggro radius, never while spawn-protected); a warden already
  in view on arrival is not a sighting. In the browser: arrival at 288-304 px, no pan for 7 s of standing; walking in,
  the pan starts as Thunderhoof turns hostile (~200 px) and plays once.
- **Wind cone strikes** (`recipe.ts` cone style: mon_gust, rime_breath, every aoe elemental cone). A few hairline lines
  read as nothing. The gust now carries a **streak fan** (size-3 streaks across the arc at chest height, three waves 80
  ms apart, quota-aware) and a **hot leading-edge arc** that expands from 20 % of the reach to the hit reach over ~330
  ms while cooling, the rim lighting as the front nears it (117 ms, a swing's cast pieces start inside it) and holding
  until it lands.
- **Shadowstep blink** (`runtime.ts` `BlinkInst`, afterimage mode 'blink'). The departure ghost sat behind the player's
  own sprite, hidden for the dash's first ~80 ms. Now the cast frame turns the actor's frame into a family-R3 silhouette
  IN FRONT of the body (the vanish frame, 33 ms, alpha 0.85), which then splits into 4 px bands sliding apart by whole
  pixels (±1, ±2, ±3) while their alpha steps 0.6 / 0.4 / 0.2. It plays at every quality (bands above 0.25).
- **Death chips** take the monster's hide colour through `PlayCtx.chipTint` / `chipTint()` (bob multiply tint that lands
  the dust ramp's R3 on the hide colour) as soon as art/monsters.ts exports `monsterHideColor` (looked up by name; §13
  item 7). Until then: the dust ramp.
- **Bolt strip pool** (`boltpool.ts`, runtime/bolts.ts). Per bolt look (style × strength) the warm set queues a pool —
  trunk runs 6 / 10 / 16 / 24 px × 9 headings of a quadrant × 2 seeded variants in the bolt / white / remnant inks,
  wiggly fork runs 4 / 7 / 11 / 16 px, and every integer micro step ≤ 6 px — baked in idle slices (a look is ~50 ms of
  work; the pools get ≤ 3 ms of every idle slice so a busy fight's strip queue never starves them). A hop then composes
  its frames: the template's coarse kinks (same jag scaling, same seeds), each run laid as a chain of pool strips
  (quadrant flips only — never rotated or stretched) closing exactly on its kink, forks grown as the template grows
  them, max-wins by brightness rank, glow beads every ~9 px, the template's frame grammar and finalize rules
  (reduce-flash folding, keyline). One staging upload per hop replaces two uploads per frame, and the RGBA pass is
  fused (`boltRgba`, identical to colourise / glowTwin). Same look: tests/vfx-boltpool.test.ts holds trunk, fork and glow
  pixels per frame within 30 % of the template (measured within ~10-20 %), frames and times identical, both ends hit.
  Hop cost (whole bake: frames + pack + upload), busy fight, 8 skills incl. lightning_bolt / static_charge /
  thunder_peal, quality pinned at 1: before p50 1.2-1.3 ms, p90 4.2-4.4 ms, max 4.9-5.1 ms (paint alone 1-5 ms per
  hop in node); after p50 0.6-0.8 ms, mean 0.79-0.9 ms (frames 0.46-0.54 ms), all hops from the pool.
  `vfx.stats().boltHops` reports hops, pooled, peak / mean ms and the pool's bake time.
- **Long ring chunks** (`RING_LONG`, components/ring.ts `chunkLayout`). Chunked rings wider than 128 px place **20 px
  chunks (32 headings)** wherever the rim's radius of curvature is ≥ 100 px (a 20 px chord strays ≤ 0.5 px; the heading
  error at the chunk ends stays ≤ 1 px, as for 10 px chunks at 16 headings), 10 px chunks elsewhere (the tight ends of
  a wide 0.65 ellipse), spaced by arc length (no gaps at an ellipse's top). Solid styles and non-sweeps only (dashes,
  gaps and smear stages stay 10 px units). starfall_lattice (r 170): the marker ring 107 → 54 bobs, the blast peak
  234 → 128 bobs; the rims look the same at 1:1.
- **Monster shots** (MonsterSkills, tellhit.ts `shotHits` / `shotReach`). The QA note "a puddlewisp spit never hit a
  player on the same ground row" was a harness artefact: that pass ran with spawn protection set to Infinity
  (`hurtPlayer` refuses; the shot is consumed on contact with no `playerHurt`) and teleported the player behind
  blocked reed / water tiles while forcing techniques past their line-of-sight check. A clean probe (one wisp, protection
  off) hits a same-row player at ±56 / ±100 / -140 px. Two real issues were fixed on the way: the hit test was a point
  test per frame, so a frame over ~113 ms (a hitch, a slow device) could step a 300 px/s shot through the 34 px hit
  width — it is now **swept** along each step (up to the wall it enters); and the aim telegraph was drawn through walls
  and water to the player while its shot dies in the first blocked tile — each aim line now ends where its shot
  would die (`TellShape.aim.lens`), so telegraph = hit test.
- **Hygiene**: stale comments (the settings toggle "comes later", the bridge as "a later step", a missing juice test
  file) now name what is built.

## 9. Budgets, governors

| budget | cap (`VFX_BUDGET`) |
|---|---|
| atlas | 4 pages of 1024², 2 px gutter; the warm set (§8.5) must fit at 85 % packing (tested) |
| pooled sprites | body 96 · glow 64 · ground 40 · tell 24 (total 224; tell sprites reserved) |
| Blitter bobs (ring pieces, beads, chips) | 400, of which 120 are reserved for telegraphs |
| particles | 250 across ≤ 6 emitters (3 per active page: body, glow, ground) |
| concurrent effect instances | 24 |
| per event | hit 8 motes · spin pulse 12 motes · nova 1 core + ≤ 14 units + 2–3 rings + 24 motes · volley ≤ 12 bodies, beyond 6 trails on every 2nd · chain ≤ 6 hops · 2 status loops and ≤ 6 sparks per target · monsters ×0.5 |
| CPU | VFX update ≤ 1.5 ms, bake slice ≤ 2 ms, total ≤ 3 ms per frame |
| uploads | ≤ 1 MB per frame |
| decals | ≤ 48 live, ≤ 1000 ms (pool 1600), ≤ 25% density after 600 ms |
| flash | area-weighted: a transition over 19k art px of WHITE / R5 / contrast counts; ≤ 3 per second, ≥ 333 ms apart; periodic flicker ≤ 2 Hz; screen flash alpha ≤ 0.35. Over budget → play the `reduceFlash` bake |
| hit-stop | local by default, ≤ 100 ms; global ≤ 150 ms per rolling second, ≥ 250 ms apart, never inside spin or chain channels except on the final hit |
| body flash (`BODY_FLASH`) | one rendered frame; a cast's first hit per victim only (its ticks within 150 ms spark-only); per victim ≥ 220 ms and ≥ 8 rendered frames apart (≤ 12.5 % of frames); DoT ticks share it; death / spawn pops exempt |
| cues | ≥ 2 px wide (rims, fronts, tethers, aim lines); status pips 7×7 |

**Quality governor** (EMA of the frame delta):

| level | trigger | effect |
|---|---|---|
| 0.5 | > 20 ms for 30 frames | halve motes and units, every 2nd ring piece (+1 thickness), no echo arcs, no back-half glow, decay ×0.7 |
| 0.25 | > 26 ms for 30 frames | no trails, ≤ 3 units, no decals, no glow twins |
| recover | < 15 ms for 120 frames | step back up one level |

- Pieces tagged `neverGoverned` (all telegraph pieces) are never dropped, culled or governed. Monster tells are never
  view-culled.
- Inside an active monster zone, player area pieces use their 12.5% density / half-count variants, so the danger fill
  stays visible.
- Ambient particles (QUALITY-PLAN §12) never use R4–R5 hot stops or combat motifs, and they count toward the
  250-particle cap.

## 10. Module contract: two parallel packages

### 10.1 Ownership

| file | package | depends on |
|---|---|---|
| `src/game/vfx/types.ts` | shared, **frozen** | core/types, core/combat (types only) |
| `tests/vfx-contract.test.ts` (helpers, counts, budget consistency) | shared, **frozen** | types, data |
| `src/game/vfx/ramps.ts` | P | types |
| `src/game/vfx/painter.ts` | P | types, core/rng |
| `src/game/vfx/glyphs.ts` | P | types |
| `src/game/vfx/components/<id>.ts` (17) + `components/index.ts` | P | types, painter, glyphs, core/rng |
| `src/game/vfx/bake.ts` | P | types, ramps, components |
| `src/game/vfx/families.ts` | R | types, core, data |
| `src/game/vfx/recipe.ts` | R | types, families, signatures, core/compose, data |
| `src/game/vfx/signatures.ts` | R | types, pieces |
| `src/game/vfx/pieces.ts` (piece constructors; optional) | R | types |
| `scripts/vfx-sheets.mjs` | P (+ joint skill sheets) | P + R files and data (bundled with esbuild) |
| `tests/vfx-painter.test.ts` (painter + bake checks), `tests/vfx-palette.test.ts` | P | P files |
| `tests/vfx-recipes.test.ts` | R | R files |
| `tests/vfx-pipeline.test.ts`, `tests/vfx-guard.test.ts` | joint (written after both land) | P + R |
| `src/game/vfx/runtime/**` (bus bridge, atlas, pools, StatusFx, TelegraphFx, juice rig, gallery scene) | later wiring step (Phaser side) | P + R + Phaser + events.ts |

P never imports an R file and R never imports a P file. They meet only at `VfxPiece` / `ComponentParams`: R emits
pieces and P bakes any valid piece.

### 10.2 Exports (exact signatures; declared in `types.ts`)

**P**
```ts
// ramps.ts  — satisfies VfxRampApi
export const RAMPS: Readonly<Record<RampId, Ramp>>;            // §3.2 values exactly
export function lut(ramp: RampId, variant?: LutVariant): Uint32Array; // INDEX_COUNT entries, [0] transparent, endianness-checked

// components/index.ts
export const TEMPLATES: TemplateMap;                            // one Template<C> per ComponentId ('afterimage': use 'runtime', no frames)

// bake.ts   — satisfies VfxBakeApi
export function indexFrames(piece: VfxPiece, u: number, opts?: Partial<BakeOptions>): IndexFrame[];
export function bakePiece(piece: VfxPiece, opts?: Partial<BakeOptions>): BakedPiece;      // all unique dirs, colourised + white glow
export function bakePhase(pieces: readonly VfxPiece[], opts?: Partial<BakeOptions>): BakedPiece[];
export function pieceKey(piece: VfxPiece, opts?: Partial<BakeOptions>): string;          // `${geometryKey}|${ramp}|${lut}`
```
Template key format: `${component}|${sorted bake params}|${motif if used}|kl${keyline}|rf${reduceFlash}`. The seed is
`hashSeed('vfx', geometryKey, u)`, so output never depends on bake order or on the skill.

**R**
```ts
// families.ts
export function familyOf(skill: SkillDef): FamilyId;
// recipe.ts — satisfies VfxRecipeApi (with familyOf re-exported)
export function deriveVfx(skill: SkillDef, owner?: VfxOwner, lookup?: SkillLookup): VfxRecipe;
export function hitGeometry(skill: SkillDef, owner: VfxOwner): HitGeometry;
export function impactPieces(recipe: VfxRecipe, hit: HitOutcome): readonly VfxPiece[];
export function statusPieces(kind: StatusKind, source: FamilyId, body: BodySize, owner: VfxOwner): readonly VfxPiece[];
export function deriveAttackVfx(attacker: AttackerLook): VfxRecipe;
export function comboPieces(combo: ComboId, body: BodySize): readonly VfxPiece[];
export function deathPieces(body: BodySize, killer: FamilyId, owner: VfxOwner): readonly VfxPiece[];
export function extraPieces(event: keyof VfxExtraEvents): readonly VfxPiece[];
// signatures.ts — satisfies VfxSignatureApi
export const SIGNATURES: Readonly<Record<string, SignatureDef>>;
```
Each test file pins its module to the contract at compile time, for example `const api: VfxBakeApi = bake;` after
`import * as bake`.

### 10.3 Piece validity rules (R must emit, P must accept)

- `params` use the bucket values from `types.ts`: REACH, ARC, CELL, CORE, SIGIL, DECAL. Ring `r` is exact. Bolt
  `dx/dy` satisfy length ≤ `boltMaxLen`.
- `motif` is a player family, except in telegraph pieces. `ramp: 'danger'` and `lut: 'monster'` appear only in
  monster recipes and tells.
- Every frame time comes from `VSYNC_MS`. Every one-shot ends with an empty frame.
- Player recipes never contain `ramp: 'danger'`, ring `style: 'dashed'` with `anim: 'march'`, or motes
  `pattern: 'converge'`.
- Pieces tagged `geometryFromEvent` keep a nominal `r` (the shape value). The runtime re-bakes or places them at the
  event's exact geometry.

### 10.4 Done criteria

- **P** is done when every component bakes the §11.1 grid and passes `vfx-painter` (with the bake checks) and `vfx-palette`. The
  grid is each value of each bucketed param with the other params at defaults, every enum value, × 3 motifs.
  `scripts/vfx-sheets.mjs` must also write the contact sheets (§11.2).
- **R** is done when `vfx-recipes` passes over all authored skills, techniques, infusions, legal essence sets, merges
  and auto-attacks, and all 40 signatures apply.
- **Joint** is done when `vfx-pipeline` bakes every distinct piece of every authored recipe (player and monster), the
  worst loadout + the densest map fit in 4 pages (§8.5) and `vfx-guard` passes. `npx tsc --noEmit` must be clean for
  `src/game/vfx/**` and `tests/vfx*`.

## 11. QA plan

### 11.1 Headless tests (vitest)

- **vfx-recipes (R)**
  - Coverage: deriveVfx succeeds and has ≥ 1 cast or body piece for:
    - every authored skill
    - every MonsterDef technique (owner monster)
    - every element infusion of every `canTakeElement` root
    - every legal essence set of every root (all of them; derivation is cheap)
    - every legal merge
    - every monster auto-attack
  - Rules:
    - statuses equal Combat.hit / statusesOf
    - geometry equals the hit test (§8.1)
    - an infusion keeps the root's carrier and body
    - a merge's carrier equals the primary parent's
    - a variant's visual reach and arc stay within bucket tolerance of the composed shape
    - the monster tell kind matches the shape
    - no danger, dashed-march or converge pieces in player recipes
    - every signature id is an authored root
    - distinctness: at most 2 authored player skills share an identical cast-phase piece set
    - every merge accent is drawn once, in the echo family, on the signature-patched carrier (§7.3)
    - monster strike smears take their reach from the event; aftermath decals stay ≤ 96 px
- **vfx-painter / vfx-bake (P)**, over the grid (each bucket value and enum value of each param, others at defaults,
  × 3 motifs):
  - determinism: equal hashes across two bakes and in shuffled bake order
  - one-shots end with an empty frame; loops are seamless (t = P matches frame 0)
  - index discipline: OUTLINE only in matter templates and keylines; WHITE only on declared hero frames; no
    `#000000` after colourising
  - ≤ 2 orphan px in non-final frames
  - frame times are in `VSYNC_MS`; the hero frame falls in the first 30%
  - frame bounds ≤ cell; a pixel budget per template
- **vfx-palette (P)**: the ΔE and CVD rules of §3.2.
- **vfx-pipeline (joint)**:
  - bake every piece of every authored recipe; keys are stable
  - worst loadout + densest map fit in 4 pages at 85 % packing (2 px gutters; white glow twins stored once per
    geometry; bolts excluded, they live in pooled textures); the test also logs the warm set's cold bake time
  - the 1 s busy simulation (≤ 3 area flashes, global hit-stop ≤ 150 ms, trauma within [0, 1]) needs the runtime's
    juice rig and flash governor, so it moves to the runtime step's gallery checks (§11.2)
- **vfx-guard (joint)**:
  - no `Math.random`, `Date.now`, `performance.now`, `ctx.rotate`, DOM globals or `phaser` import under
    `src/game/vfx` outside `runtime/` (comments may name them)
  - no emitter `{min, max}` ops (checked once `runtime/` exists)
  - no `.png/.gif/.jpg/.webp/.ttf/.woff*` under `src/` or `public/` (public/icon.svg whitelisted)
  - no `Patch Pixel` or `DoomFire` strings under `src/`; painter.ts and §12 keep the technique credits

### 11.2 Contact sheets and gallery

- `node scripts/vfx-sheets.mjs <outDir> [--scale=3] [--only=family:fire,skills:sword] [--compare [--fams=…]]`: bundles
  the Phaser-free modules with esbuild (installed with vite; no new dependency), bakes **every authored recipe**
  (player skills, techniques as player and monster) and writes PNG sheets plus grayscale copies with Node's zlib.
  Output goes outside the repo. Bake errors are listed in `index.txt` and fail the run.
  - `family-<id>.png` (17): each component's frames for that family (unique direction 0), aligned on the anchor, once
    over mid grass #5f8a3a and once over a dark dungeon floor #1e1a24, with frame times (hero frames in yellow) and
    glow twins added at the biome gain.
  - `skills-<group>[-<page>].png`: the sword, dagger and staff trees, The Heart (every element infused into the three
    weapon basics), monster techniques (owner monster), monster auto-attacks and the other constellations, 14 skills
    per page. Each row is one skill, labelled, with three composited moments (CAST: telegraph / charge / wind-up;
    PEAK: the carrier's hero frame; HIT: impact + statuses + aftermath) on grass and on the dungeon floor, around a
    stand-in actor of the player's size. Placement patterns, ring chunk sets, moves, afterimages and blend modes are
    approximated the way the runtime will place them; the real runtime remains the reference.
  - `--compare` adds `compare-<component>.png`: one component across every family (a review aid).
  - Review at device scale (1 art px = 3 device px), not only at 2×.
- `tests/vfx-pipeline.test.ts` (joint, art-rule lint): every distinct piece of every authored recipe, technique,
  element infusion, auto-attack, status, impact variant, combo, death pop and extra bakes, and every baked pixel is
  in its own ramp + LUT palette, alpha is 0 or 255, never pure black, #24180f only where `outlineAllowed()` says
  (or where the ramp owns that colour: magma and danger S0), glow twins are white (none for no-glow ramps), one-shots
  end empty, frame times are `VSYNC_MS`, and no player piece shows a danger-ramp colour.
- Gallery scene (runtime step, `?vfx=gallery`):
  - biome strips: meadow, road, cave, crypt, frost, ember
  - caster + target dummies; a variant builder (base + element + essences + merge partner through the Registry)
  - time scale and frame-step; quality 1 / 0.5 / 0.25; reduce flashes
  - an automated **hitbox overlay** check: drawn rims within 2 px of the hit test in 16 directions
  - a "busy dark map" sheet: 14 monsters + AUTO with 8 skills, checking that telegraphs stay visible
- Playwright (like playtest.mjs): gallery smoke (no console errors) and a busy-scene perf log (p50/p95 frame, live
  sprites, particles, flushes, pages). Desktop SwiftShader is a regression check only.

### 11.3 Visual rubric and device gate

Sign-off happens per family × shape sheet:
1. The shape reads within 3 frames.
2. The element reads in grayscale.
3. The hero frame is ≤ 2 frames, with the peak in the first 30%.
4. One-shots end empty and loops have no seam.
5. No speckle; outlines only on matter.
6. The effect reads on grass, dirt, cave and frost.
7. Telegraphs equal the hitbox.
8. Danger appears only on monsters.
9. A busy screen stays readable, with ≤ 2 statuses per target.
10. ART-DIRECTION palette and light.

Device gate before shipping: a low-end Android (Mali, 3–4 GB) and an iPhone 11/SE on Safari, measured with the
QUALITY-PLAN `?perf` overlay.

## 12. Credits and licensing

Omnipath's VFX code is original. Techniques were learned from the sources below. **No pixels** from any pack,
tutorial or GIF were copied, traced, sampled, recoloured or palette-picked. Only numbers (sizes, frame counts,
timings) and written technique descriptions were used.

| source | licence | what we use |
|---|---|---|
| Sprite Fusion pixel-art VFX (spritefusion.com/pixel-art-vfx), © 2026 Hugo Duprez | MIT (as stated by pixelfx's NOTICE; primary text not reachable from this session) | techniques: colour + light buffers, limited ramps, dithering instead of blur, back/front passes |
| patch-gg/pixelfx (derivative of the above), © Patch | MIT | techniques: Bayer-threshold `put()`, quantised field ramps, closed-form particle maths. It also credits Hollow Crown (rehan-remade, MIT) for pose timing; we adapt none of it |
| Pixel ability-fx forge (GameDev-Toolkit/pixel-ability-fx-generator) | Apache-2.0 (no NOTICE file upstream) | ideas: seeded closed-form recipes |
| Pedro Medeiros (Saint11) pixel-art tutorials | CC BY 4.0 | techniques: contrast frame, held key frame, blank-frame electric flicker, crescent smoke dissolve, goo, defend bubble. Any doc that shows one of the GIFs credits "Pedro Medeiros (Saint11), CC BY 4.0" |
| B. E. Bayer (1973), ordered dithering | public algorithm | 4×4 threshold matrix |
| Squirrel Eiserloh, "Juicing Your Cameras With Math" (GDC 2016) | talk | trauma² shake |
| Midpoint-displacement lightning; CIEDE2000 (Sharma 2005); Machado 2009 CVD | public algorithms | bolts; palette tests |

Rules:
- No code is ported. If a function is ever adapted from pixelfx / Sprite Fusion (MIT), forge (Apache-2.0) or LittleJS
  (MIT), its file gets a header naming the source and `THIRD-PARTY-NOTICES.md` gets the full licence text. For MIT
  that means both MIT copyright lines (Patch; Hugo Duprez), plus Hollow Crown if its timing code is involved. For
  Apache that means the licence text and marked changes.
- `painter.ts` carries a technique-credit header for Sprite Fusion / pixelfx in any case (cheap insurance).
- Never use pixelfx's "Patch Pixel" font, Sprite Fusion's AI generator outputs (not even as private references), or
  pack assets (BDragon1727, XYEzawr, CodeManu, jojo-zhang, Foozle, Kenney, Thundersnow, ELV, Ansimuz, Brullov,
  RagnaPixel, PVFX Foundry, OpenGameArt / itch.io sets).
- "Sprite Fusion" appears only in docs and credits, never in game UI or store copy.

## 13. Owner decisions and open items

Decided (implemented with the runtime step):
1. **Ground geometry stays truthful.** Player hit tests are circles and monster zones are 0.65 ellipses; the VFX
   draws each exactly as hit-tested (rims verified against a hit-test overlay in the browser, §8.8). No gameplay
   geometry change.
2. **Spark freeze is 150 ms** (MapScene `hitStop(150)`), inside QUALITY-PLAN's 150 ms/s hit-stop budget; the spark
   star (`extraPieces('spark')`) holds through it. The old 250 ms exemption is gone, and so are the spark's
   `cameras.main.flash` and legacy ring.
3. **Fair telegraph minimums.** Monster zone (nova, spin) and cone (strike) tells last at least
   max(current, min(900, 350 + 2.5 × r)) ms with r the zone radius (+ m.radius for spins and cones): `fairTellMs` in
   `recipe.ts`, applied in MonsterSkills.start; `monsterTellMs(skill, casterRadius)` mirrors it for the recipes. A
   longer authored tell is kept. Lanes, aims, chain ranges and buff auras keep their 300-400 ms.
4. **One player radius**: `PLAYER_R = 12` exported from SkillSystem, used by Combat (separation) and MonsterSkills
   (every hit test against the player; it was 14 there).
5. **Monster blasts keep danger accents** (monster LUT: accent → danger R3), as §4.3 says.

Open:
6. Deferred for simplicity: a Web Worker for bakes and an IndexedDB page cache. Revisit only if a measured bake
   exceeds the §8.5 budgets.
7. ~~World lane~~ (done, §8.9): monster techniques, auto-attacks and telegraphs (rasterised at the hit-test geometry),
   player statuses and hurt impacts, death and spawn pops, enrage, the Tier III and buff auras (Player.sync's rings are
   gone), Interactions' world moments, victim-local hit-stop, impact frames, squash, recoil, kicks and the camera rig.
   DoT tick tints go through the body-flash gate (§8.12). Still open: **death chips in the hide colour** — the runtime
   reads `monsterHideColor` from art/monsters.ts by name (a 0xRRGGBB number or '#rrggbb' per monster id / def) and
   tints the chips with `chipTint` the moment the actors lane exports it; until then they keep the dust ramp. Monster's
   fractional breath squash and the player's stunned wobble (actors lane), MapScene's portal-reveal shake (it goes
   through the rig's `install()` shim; the scene keeps its one seam), shade_cloak's alpha.
8. ~~Settings UI~~ (done): "Reduce shake & flashes" lives on the runtime (`setReduceFlash`, persisted in localStorage,
   defaulting to `prefers-reduced-motion` until the player chooses — fixed in §8.11) and its toggle is in the ☰ menu
   (src/ui/hud/settings.ts).
9. Device gate (§11.3) still pending: SwiftShader numbers in §8.8 / §8.10 / §8.12 are a regression check only.
10. From the in-game QA pass (§8.10), now resolved in §8.12: per-hop bolt bakes (the pool composes a hop in ~0.5 ms of
    frames + one upload), big rings' bob share (long 20 px chunks: half the bobs), shadowstep's missing departure tell
    (the blink vanish frame plays on cast), the "never hit" puddlewisp spit (a QA-harness artefact, plus two real
    fixes: swept shot hits and wall-clipped aim lines). Still open: trying many different skills in one session churns
    the 4-page atlas (the first cast of a newly learnt big skill plays the fallback while it bakes; the bar's warm set
    is fine).
