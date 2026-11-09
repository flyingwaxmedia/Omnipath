# Omnipath v2 — Build Specification

This file is the **contract** for skill-system v2 and world-maps v2. The design rationale lives in
`docs/DESIGN.md` and the research brief that preceded it. When this spec and the brief disagree,
**this spec wins** — it already resolves the contradictions the design review found.

Types: `src/core/types.ts`, `src/core/state.ts`, `src/core/world/types.ts`, `src/core/world/tiles.ts`.
Helpers already written: `src/core/balance.ts` (`monsterStats`, `classTreeTemplate`).

Hard rules for every contributor:
- `src/core/**` never imports Phaser, the DOM, or anything under `src/game`/`src/ui`.
- All randomness in core goes through `src/core/rng.ts` (`mulberry32`, `hashSeed`). No `Math.random` in core.
- Original names only (see §9). Never copy Ragnarok Online (or any game's) names, maps, monsters, art.
- `npm test` and `npx tsc --noEmit` must pass at the end of every stage.

---

## 1. Mastery v2 (`src/core/mastery.ts`)

```ts
MASTERY = { useXp: 1, hitXp: 1, killXp: 3, maxHitsPerUse: 4, instanceHitCap: 12,
            studyKills: 10, studyMult: 1.5, rate: 1, overMult: 2.5, fusionMinRank: 5, maxCharges: 3 }
xpToNext(rank, tier = 0) = round(14 * 1.3^(rank-1) * (1 + 0.4 * min(tier, 3)))
overmasteryCost(maxRank, tier) = round(MASTERY.overMult * xpToNext(maxRank, tier))
rankPower(rank) = 1 + 0.06 * (rank - 1)               // unchanged
fusionMinRank(maxRank) = min(MASTERY.fusionMinRank, maxRank)
skillLevel(tier, rank) = [0, 3, 6, 9][min(tier,3)] + rank * 0.5
monsterThreat(m) = m.threat ?? m.level + (elite ? 2 : warden ? 3 : 0)
threatMult(delta)  // delta = monsterThreat - skillLevel
  <= -7: 0 (grey) | -6..-5: 0.25 | -4..-3: 0.5 | -2..-1: 0.8 | -1<d<2 : 1.0 | 2..3: 1.3 | 4..5: 1.6 | >=6: 2.0
```
(Use `delta` floored to an integer before the lookup.)

**XP integrity**
- *Use XP* is granted only when the cast is engaged: the game calls `recordUse` lazily on the cast's **first hit**
  (any time in the cast's lifetime: traps, returns, reprises, slow projectiles all count).
- *Buff skills* earn use XP if the player is **in combat** (dealt or took damage within the last 5 s);
  threat = highest threat among engaged monsters. API: `recordBuffUse(id, threat)`.
- *Hit XP* = `hitXp * threatMult * study`; only the first `maxHitsPerUse` hits of a cast count, and at most
  `instanceHitCap` hit-XP grants per (skill, monster instance) — the game tracks the per-instance counter and passes it in.
- *Kill XP* = `killXp * threatMult * study` (not subject to the instance cap). Wardens: ×1.5.
- *Study bonus*: ×`studyMult` while this skill has killed fewer than `studyKills` of that species.
- Passive `masteryXp` bonuses multiply hit/kill XP.
- At max rank XP flows into overmastery (bar = `overmasteryCost(maxRank, tier)`); each full bar: `overBars++` and +1
  charge while charges < `maxCharges`. With charges capped a bar **still completes until the 2nd essence slot is
  open** (`overBars < 3`), so the slot never waits on spending a charge (even for a migrated save holding 3 charges
  at `overBars` 0); once every slot the skill can have is open (buffs: 0 slots, so at once) the bar holds full
  (`xp` = bar size). `overBars >= 3` opens the 2nd essence slot (`fusion.SECOND_SLOT_OVERBARS`).
- Class Rank XP: every skill-XP grant also feeds classes (§5).

## 2. Combat v2 (`src/core/combat.ts`)

**Element relation** (attacker vs defender, from `ElementDef.strongVs`): `strong` if attacker lists defender
(this wins even when the defender also lists the attacker — mutual pairs like holy/shadow are strong both ways);
else `weak` if defender lists attacker; `same` if equal; else `neutral`. Unaligned attacks are always ×1.0.

| defender element level | 1 | 2 | 3 |
|---|---|---|---|
| strong | 1.5 | 1.75 | 2.0 |
| weak | 0.6 | 0.5 | 0.4 |
| same | 0.5 | 0.25 | 0.0 (grey "Resist") |
| neutral | 1 | 1 | 1 |

Nothing ever heals the target. Fused-element defenders use their own authored `strongVs`.

**Size** (`SIZE_TABLE`, S/M/L): dagger 1.0/0.85/0.65 · sword 0.85/1.0/0.9 · staff 1.0/1.0/1.0 · skills tagged
`heavy` use 0.7/0.9/1.15 regardless of weapon · `arcane` skills ignore size (1.0).

**Status combos** (`comboFor(attackElement, targetStatuses)`), each consumes the status:
- *Shatter*: earth or magma hit on a `freeze`d target → ×1.75, ends freeze.
- *Conduct*: lightning or storm hit on a `soak`ed target → ×1.5, ends soak (+1 chain jump if the shape is chain).
- *Fan the Flames*: wind or storm hit on a `burn`ing target → ×1.25 and spreads burn to enemies within 48 px.
Water's element status is now `soak` (slow ×0.55 for 2.2 s + soaked marker).

**Stacking**: `dmg = base * power * rankPower * (1+tagPct/100) * (1+familyPct/100) * (1+statusPct/100) * size *
element * combo * falloff * variance(0.9..1.1) * (crit ? 1.5 : 1) - def * (crit ? 0.5 : 1)`, min 1 (0 when
element multiplier is 0). **Hybrid** skills use max(atk, matk) (`combat.isHybrid`): arcane + blade/pierce
techniques, and every skill tagged `spirit`, `technique` or `echo` (`HYBRID_TAGS` — the any-weapon skills, so a staff
user is never crippled by a trainer technique or an echo; variants and merges keep the tag). Any-weapon authored
results built only from techniques/echoes carry `technique` (or `spirit`) for the same reason (`tests/content.test.ts`).
Only `arcane` forces MATK and ignores size; a non-arcane hybrid uses the weapon's size row.

`computeDamage(elements, skill, rank, attacker, defender, mods)` returns `{ amount, crit, multiplier, resisted, combo }`.
`Attacker = { atk, matk, crit, weapon }`, `Defender = { def, element?, elementLevel?, size?, family?, statuses? }`,
`mods = { tagPct?, familyPct?, statusPct?, falloff?, rng? }`.

**Cast timing**: `castMs` wind-up (moving cancels it), `afterCastMs` (default 250) global skill lockout during
which walking and auto-attacking are allowed; cooldown starts when the effect fires.

## 3. Essences, variants & the fusion pipeline (`src/core/compose.ts`, `src/core/fusion.ts`)

**Variant ids**: `<base>[@<element>][~<mod>[~<mod>]]`, mods sorted alphabetically. Shape merges use base
`fuse:<a>|<b>` (a,b sorted) and may carry `@el` / `~mods` too: `fuse:sword_throw|whirlwind@fire~split`.
Authored ids may not contain `@ ~ | :`. `Registry.skill(id)` parses, composes and caches any valid id
deterministically (old v1 ids like `slash@fire` stay valid).

**compose(base, element?, mods[])**:
- name: `[element prefix] [prefix-affix of 1st essence] <base name> [suffix-affix of 1st essence]` (2nd essence shown
  only as an icon badge), ≤ 4 words (drop the essence affix if it would exceed).
- tier = min(3, base.tier + 1) when anything is applied; maxRank = min(base.maxRank, 8); `generated: true`,
  `baseId`, `essences` set; tags = base tags (minus `basic`) + element + essence `tag`s + `'infused'` if element.
- element: power ×1.2, spCost = ceil(sp*1.25 + 2), cooldown = base.cooldown || 800 (as v1 infusion).
- each essence (alphabetical order): power × `essencePowerMul`, sp ×spMul (an SP-free base starts at 2), cooldown
  ×cdMul; apply `mod` to the shape (counts add, multipliers multiply, `arcAdd` adds degrees to strike arc,
  `radiusMul` to spin/nova radius, `rangeMul` to range/distance) and riders (`returns`, `reprise`, `arc`, `leech`,
  `knockback`).
  - `essencePowerMul` is `powerMul`, except for a **multiply essence that adds projectiles** (`mod.count`: split),
    whose `powerMul` budgets the whole volley: each of the `c + count` projectiles deals `powerMul × c / (c + count)`
    (c = the projectile count before the essence). Split: **1.1 × c / (c + 2)** per projectile, so the volley deals
    1.1× the base volley for 1.3× SP whatever c is (1 → 0.367 each, 4 → 0.733, 10 → 0.917). It is keyed on
    category + `mod.count`, never on the essence id.
- **Hit clamp**: `potentialHits = count × pulses × hits × (1 + jumps) × (reprise ? 2 : 1) × (returns ? 2 : 1) ×
  (arc ? 1 + arc.targets : 1)` must be ≤ `MAX_HITS = 12`; trim in order jumps → pulses → count → arc.targets, then
  strike hits as a last resort.
- **Hit renormalization**: when the clamp trims hits, power ×= `hitsBefore / hitsAfter` so the cast's total
  potential damage is preserved — capped so that **no essence step gains more than +35% damage per SP**
  (`ESSENCE_BUDGET_BAND`) over the same skill (same base and element) with any one of its essences removed, measured
  with `budgetDamage` (power; power × shapeHits once a multiply essence is on the skill) and skipping SP-free
  references; never below the unrenormalized power. Values round to 0.01 (the cap rounds down).
- cooldown ≥ 300 ms.

**Element slot rules**: an *authored unaligned* attack (non-buff, power > 0) has one element slot. A generated variant
of such a base may swap element (`sword_throw@fire~split` + water → `sword_throw@water~split`, essences kept, none
consumed). Authored *aligned* skills (Flame Spin, Ember Dart…) cannot take an element ("already bound").

**Essence slots** (`fusion.essenceSlots`): buffs 0; 1 slot for every other skill; 2 when that skill id's own
`overBars ≥ 3` (a variant overmasters separately from its base; see §1 for how capped charges never block the bars).
Same-category essences never stack. `appliesTo` must include the skill's shape kind. Essences are **consumed on
success only** (and not at all when the player already knows the resulting variant).

**Starter essences** (`src/data/essences.ts`):

| id | category | appliesTo | effect | power / sp / cd |
|---|---|---|---|---|
| split | multiply | projectile | count +2, spread +25 | 1.1 per volley (1.1·c/(c+2) per projectile) / 1.3 / 1 |
| flurry | multiply | strike | hits +1 | 0.7 / 1.3 / 1 |
| arc | propagate | projectile, strike, chain | chain: jumps +2; others: arc {2, 0.6} | 0.9 / 1.3 / 1 |
| pierce | propagate | projectile | pierce +2 | 0.9 / 1.2 / 1 |
| return | propagate | projectile | returns, rangeMul 0.8 | 0.9 / 1.3 / 1 |
| reprise | repeat | strike, spin, nova, projectile | reprise {400, 0.5} | 1 / 1.4 / 1 |
| expanse | area | spin, nova, strike | radiusMul 1.35, rangeMul 1.2, arcAdd 30 | 0.85 / 1.25 / 1 |
| haste | tempo | strike, spin, projectile, dash, nova, chain | — | 0.8 / 1.2 / 0.7 |
| heavy | tempo | strike, spin, dash | knockback, tag `heavy` | 1.5 / 1.2 / 1.6 |
| leech | sustain | strike, spin, projectile, dash, nova, chain | leech 0.04 | 0.9 / 1.2 / 1 |

**resolveFusion(reg, ctx, a, b)** (pure; `src/core/fusion.ts`), first match wins:
1. Authored recipe for the sorted pair (requirements checked; unmet → `requirement`).
2. skill/variant + `mod:<id>` → compose with the essence (fails: `shape`, `slot`, `category`, `missing` essence).
3. skill/variant + `el:<id>` → element apply/swap (fails: `bound` for authored aligned skills or buffs).
4. `el` + `el` → authored fused element (step 1) else **Resonance** recipe (authored in recipes as
   `result: 'passive:res_*'` with `tagCount` requirements) — so this is also step 1.
5. skill + skill (both authored, not generated, tier ≥ 1, rank ≥ fusionMinRank, **neither a buff**, not monster
   techniques, sharing ≥ 1 of blade/pierce/arcane/spin/projectile/dash/aoe/stealth/heavy) → **shape merge**
   `fuse:a|b`. A buff parent is refused (`mergeSkills` → null; `resolveFusion` → `nothing`, "<Buff> is a stance, not
   a strike; stances cannot be shape-merged."): it adds no rider, so it could only dilute the SP budget.
   Shape priority dash > nova > projectile > chain > spin > strike (> buff): the higher skill sets the shape, the
   lower adds a rider (spin: +1 pulse / radial for projectiles / spin:true for dash; strike: +1 hit; chain: +1 jump;
   nova: arc {2, 0.5}; projectile: +1 count; dash: knockback); a "+1" the merged shape has no axis for (nova, dash)
   becomes arc {1, 0.5}; the rider set is then hit-clamped. **Power**: the merge's per-cast damage
   (`power × shapeHits`) = 1.1 × the stronger parent's per-cast damage, spread over the merged shape's hits —
   `power = round2(1.1 × max(power_a × shapeHits_a, power_b × shapeHits_b) / shapeHits_merged)` (= max power × 1.1 when
   both hit once; a heavy single hit never multiplies across extra pulses). sp = max + 0.6×min, cooldown = max (≥ 300;
   800 if both are 0), tier = min(3, max tier + 1), maxRank 5, tags = union, weapons = union (or undefined if either is
   any-weapon), element/status from the primary (else the other parent), `baseId` = the higher-tier parent (ties:
   the primary). Name = higher skill name + rider noun (Cyclone, Rend, Arc, Burst, Volley, Rush) ≤ 4 words: a long
   name keeps its last 3 words, minus any leading lowercase word ('Eye of the Storm' + spin → 'Storm Cyclone').
   Merges can take an element and essences but are never merged again.
6. Otherwise `nothing` (+ whisper hint from an undiscovered recipe using either ingredient, as v1).
Skill ingredients need rank ≥ `fusionMinRank`. Ingredients are never consumed except essences.
Every attempt is remembered (attempts/discoveries keyed by the sorted pair).

Budget test (`tests/budget.test.ts`, **no waivers**): enumerate every authored non-buff attack × (none + each element
it can take) × every legal essence set of size 0–2, plus every legal shape merge (± element ± 1 essence; pairs with an
authored recipe never merge): assert hits ≤ 12, cooldown ≥ 300, name ≤ 4 words (first word capitalized), and
damage-per-SP within ±35% for every essence step — a 1-essence variant vs base (or base@element), a 2-essence
variant vs each 1-essence subset; damage is `power`, or `power × hits per cast` once a multiply essence (split/flurry)
is on the skill — and every merge within [0.65 × the weaker, 1.35 × the stronger] attacking parent (per-cast
damage). SP-free references are skipped.
Split's volley rule, hit renormalization and the buff-merge ban are what make this hold; the test also checks split's
1.1× volley on every untrimmed projectile and that no buff ever merges.

## 4. Discovery systems

**Requirements** (`src/core/requirements.ts`) are shared by morphs, recipes, lessons, classes: `tagCount { tags,
count, minRank? }` counts distinct authored skills carrying every tag (a variant counts as its base, a merge as its
higher-tier parent, at the max rank among them); **an empty `tags` list counts any skill** ("Any skill rank 3"). A
`flag` requirement may only read a flag the game sets — `kills`, `kill_<monsterId>` (existing monsters), the node
flags of §7.4, `meditations`, `forge_success`, `visited:<mapId>` (existing maps; `mapVisited` reads it),
`warden_<wardenId>`, relic flags of relic items, `mastered_any`, `class_worn`, `brann_gift` (set-by table in
`docs/CLIENT-v2.md` §5; enforced by `tests/content.test.ts`).

**Reachability** (`tests/content.test.ts`): every authored skill except monster-only techniques (tag `monster`) is
obtainable from a weapon basic, a morph from an obtainable parent, a recipe whose skill ingredients are obtainable, a
class grant or tree `skill` node, a lesson of a trainer placed on a map, an echo technique of a spawned monster, or a
tome that drops or sits in a chest.

### 4.1 Morph trees (`src/data/morphs.ts`)
Every weapon tree (the weapon's basic attack + everything reachable from it by morphs) has **13 nodes**: root, 3×T1,
6×T2 (2 per branch), 3×T3 capstones (1 per branch) — skill tiers 0/1/2/3 = 1/3/6/3 (`tests/content.test.ts`).
- T1: parent at max rank + 1 charge (v1 rule).
- T2: + `requires` ≥ 1 sibling-branch skill at rank ≥ 5.
- T3: + ≥ 2 other tree skills at rank ≥ 5, 1 element, and the weapon's warden relic flag
  (`relic_stone` sword, `relic_dusk` dagger, `relic_storm` staff — set when the relic item is obtained).
- Per tree: ≥ 2 T1/T2 nodes have a `spark` spec; ≥ 2 nodes have a world-flag `requires` (hidden, hint shown).
- **Sparks** waive only the charge and the parent max-rank requirement (parent must be ≥ `minParentRank`, default 3).
  Every other `requires` entry still applies. Capstones never have `spark`, and neither does a morph whose parent is a
  buff (a buff never lands the hit a spark rolls on) — both are `Registry.validate` errors.

### 4.2 Sparks (`src/core/spark.ts`)
```
SPARK = { cooldownMs: 60000, pityPerFail: 0.1, pityCap: 3 }
sparkChance(si) percent: si<=-4: 0 | -3: 0.4 | -2: 0.8 | -1: 1.5 | 0: 3.0 | +1: 2.5 | +2: 2.0 | >=3: 1.5
si = floor(monsterThreat - spark.threat)
```
On a hit by a parent skill: candidates = unknown morphs from it with `spark`, parent rank ≥ minParentRank, family
allowed, all non-waived requirements met, si ≥ -3. If `now - lastAt < cooldownMs` → no roll. Walk candidates by
ascending spark.threat; roll each once with `rng = mulberry32(hashSeed(seed, counter++))`; chance = sparkChance + pity
(pity capped at `pityCap`); fail → pity += 0.1; success → pity = 0, lastAt = now, return the morph (learned
charge-free with source `spark:<parent>`). `sparkWindow()` returns `'none'|'low'|'good'|'peak'` (chance 0 / <1 / <2.5 /
≥2.5) for the hotbar telegraph — never a percentage.

### 4.3 Echoes (`src/core/echo.ts`)
Monster techniques with `echo: {marks}` can be learned. The game marks a technique as *witnessed* on a monster
instance when that technique targets/hits the player within 6 tiles; when the player kills that instance,
`SkillBook.witness(skill)` adds a mark. At `marks >= need` the echo is learned if the player owns a skill of the same
**shape kind** at rank ≥ 3 (the *anchor*); otherwise the result is `blocked` (whisper names the needed shape) and the
marks are kept. Echo skills are authored SkillDefs tagged `echo` (any weapon, tier 1–2, maxRank 5).
Commons: 3 marks · rare: 5 · wardens: 1 (plus their relic drop).

### 4.4 Trainers (`src/core/trainers.ts`, `src/data/trainers.ts`)
`lessonState(reg, ctx, lesson)` → `{ owned, available, affordable, missing: string[] }`. Lessons grant a skill
(technique: tier 1, maxRank 5, no charge), a passive (rank 1, or +1 rank up to maxRank if `repeatable`), an essence
(count; `repeatable`), or an element. Costs use the game inventory (`SkillBook.inv`).

### 4.5 Passives (`src/core/passives.ts`)
- **Tag passives** (12, derived, never saved): for each tag in TAG_PASSIVE_TAGS
  `[blade, pierce, arcane, spin, projectile, dash, aoe, stealth, heavy, spirit, echo, melee]`, total = sum of ranks of
  distinct **authored** skills carrying the tag; a generated variant counts toward its `baseId` (use the max rank of
  base and its variants). Unlock at 15; rank = min(5, 1 + floor((total - 15) / 8)). PassiveDef ids `tag_<tag>`.
- **Learned** passives: `state.passives[id] = rank` (trainer lessons, resonances).
- **Class**: nodes bought in the *worn* class tree; **imprints**: slotted classes' imprint passives (Tier I ×1.0,
  Tier II/III ×0.6).
- **Bestiary**: per family, +1% damage per species of that family at ≥ 25 kills (family cap 10%) — derived.
- `aggregate()` folds everything into `PassiveTotals`; caps: tag-passive power ≤ 25% per skill, total
  passive+class power ≤ 45% per skill. `powerPctFor(totals, skill)`, `spCostPctFor`, `cooldownPctFor`,
  `statPct(stat)`, `vsFamilyPct(family)`, `vsStatusPct(element, statuses)`.

### 4.6 Bestiary & codex
`state.bestiary[species]` kills (elites/wardens count under their own id). Stars: 1 at 1 kill (reveals stats),
2 at 25 (family bonus, guaranteed species essence if none dropped yet), 3 at 100 (+1% max HP, cap +10%).
Essence drops: 3% per kill of a species with `essence`; guaranteed on the 25th kill if never dropped.
Codex states for classes: `unknown` (progress < 25% and not whispered) → `whispered` (hint shown) → `near`
(progress ≥ 50%: clause bars) → `known`. A class becomes whispered when a trainer, failed fusion, echo, or bestiary
star 2 reveals it, or progress ≥ 25%.

## 5. Classes v2 (`src/core/classes.ts`)

```
CLASS = { maxRank: {1: 10, 2: 8, 3: 5}, wornShare: 0.5, bleedShare: 0.15, imprintAt: {1: 5, 2: 4, 3: 3} }
classXpToNext(rank, tier) = round(60 * 1.22^(rank-1) * [1, 1.8, 3][tier-1])
points(cls, progress) = progress.rank * cls.tier - sum(spent node ranks * node.cost)
```
- State: `state.classes[id] = { rank, xp, spent }`, `state.worn`, `state.imprints`.
- **CR XP**: whenever a skill earns mastery XP, the worn class gains `wornShare ×` that XP if the skill matches any
  clause of the class (has all tags of a clause); every other discovered class whose clause matches gains `bleedShare ×`.
- **Discovery**: Tier I — v1 permissive counting (any known skill incl. variants). Tier II/III — *hardened*: count only
  distinct authored skills at rank ≥ 5 (a variant counts as its base), all `parents` at their required CR, and all
  `requires` met. For `distinctElements`, hardened: each distinct authored skill contributes at most one element
  (five `slash@<element>` variants count as 1). Hidden classes are never shown in the codex until whispered.
- First discovered class becomes worn if none is worn. `wear(id)` is free in safe maps (the game enforces where).
- **Tree**: buy node ranks with points; node `requires` and `minSpent` respected; `respec(id)` refunds every passive
  and capstone node; skill nodes stay bought, since their skill is kept (safe maps). Worn class: tree passives active
  and its `bonus` applies. Signature skills (`grants`) learned on discovery.
- **Imprints**: unlocked at CR `imprintAt[tier]`. Slots: 1 when any class reaches its imprint CR, 2 at first Tier II
  discovered, 3 at first Tier III or 12 classes discovered. The worn class's own imprint cannot be slotted.
- **Class power budget** (`balance.CLASS_POWER_BUDGET = 25`, `tests/class-budget.test.ts` over every class): for
  any single skill — every authored attack and legal shape merge, with any element it can take (+ `infused`) and any
  legal tag-adding essence (heavy) — the worst-case extra damage, in **percentage points summed**, of
  - the worn class's `bonus`: Σ `tagPower` over the skill's distinct tags + its ATK % (physical), MATK % (arcane) or
    max of the two (hybrids, §2), counting the tree's atk/matk stat node at max rank as part of that stat;
  - + the worn tree's power nodes that apply to the skill (primary-tag node, untagged capstone), at max rank;
  - + the 3 best imprints of other classes that apply to the skill, × their strength (§4.5)

  is **≤ 25**. (The points add inside `powerPctFor`'s `tagPct`, except the stat, which multiplies ATK/MATK, so the
  real multiplier is at most ≈ +26.6%.) Template numbers (`balance.CLASS_TREE_POWER`, flat across tiers): tag Focus
  +2%/rank (×3), capstone +3% to every skill, imprint +2% (Tier I) / +3% × 0.6 = 1.8% (Tier II/III), an atk/matk
  Training node +1%/rank (×3); SP economy, tempo and non-damage stat nodes still scale ×1/×1.25/×1.5 by tier. That
  leaves a worn `bonus` at most 10 points on any one skill (7 when the tree's stat node is atk/matk). Non-damage
  bonus stats (hp, sp, speed, crit, cdr) are outside the budget.

### 5.1 Classes and the skill bar (owner direction v3.1 — supersedes the earlier loadout rule)

Simple and automatic: **pick a class and it equips its own skills.**

- **Weapons never gate learned skills.** `SkillDef.weapons` only says which weapon tree a skill came from. Tier-0 basic
  attacks stay the equipped weapon's auto-attack and never sit on the bar.
- **Skill bar = 8 slots**: slots 1–5 are **class slots** (filled automatically by the active class), slots 6–8 are
  **your slots** (any skill you like). With no class, all 8 slots are yours and newly learned skills drop into empty
  ones.
- **Unlocking a class** works from the skills you KNOW (§5 counting: Tier I permissive; Tier II/III hardened + parent
  Class Levels + requirements). The player sees one card: "New class: Pyroblade — Become a Pyroblade?".
- **Becoming a class** (Class screen, any time, instant) refills the 5 class slots with
  `classSkills(reg, state, cls, 5)` — a pure, deterministic pick from KNOWN bar-eligible skills, most relevant first
  (owner: "auto equip RELATED skills"):
  1. enough **pattern matches** to satisfy each of the class's patterns (e.g. 1 finisher + 2 stealth), in pattern order;
  2. elemental classes (`distinctElements`): one matching skill per distinct element;
  3. the best remaining pattern matches, then the best **related** skills — a skill is related
     (`classSkillFit(...) === 'related'`) when it shares any tag with the class's patterns or its tree (`tree.tag` /
     `tree.tag2`, read back by `classTreeTags`), or carries an element the class's patterns, requirements or bonus
     (`tagPower`) name. A Pyroblade who knows only sword skills fills all 5 slots with blade skills; an Arcanist takes
     arcane and area skills. One skill per authored base first (a variant and its base share slots only when nothing
     else fits);
  4. only when nothing related is known does a class slot stay empty.
  "Best" = higher tier, then higher rank, then the class's own signature skills, then most recently learned, then id.
  A class pick already sitting in one of **your** slots moves into the class slot and frees your slot (no duplicates);
  your other picks stay where they are. On EVERY change of class the skills the new class pushes out of slots 1–5 move
  into your empty slots while there is room, and any slot of yours still empty takes your most recently used skill
  that is not on the bar (auto-equip: no empty slot of yours while unused skills are known). A skill an active quest
  asks you to use ("Use Rising Kick 0/8") is picked ahead of the class's other picks.
  Refreshes that are not a change of class (equipping or clearing one of your slots, loading a save) never touch your
  slots and only fill EMPTY class slots: a filled class slot keeps its skill while the class relates to it, wherever it
  ranks, so editing your slot never swaps a class skill. When a refresh fills a class slot the player emptied, one toast
  names it ("Blademaster equipped Blindside").
- **Learning a new related skill** while in a class drops it into an empty class slot, or replaces the weakest class
  skill (the class's last pick; never one an active quest asks for) only when it is clearly better — a closer fit
  (pattern match over related) or, at the same fit, a higher tier ("Pyroblade equipped Flame Spin"); the replaced skill
  moves into an empty slot of yours when there is one. Otherwise it drops into an empty slot of yours. The result is
  stable: the refresh after the next edit or reload keeps it.
- The headline after becoming a class says what happened in one line: "All class slots filled", "3 class skills
  equipped", or, with nothing related known, "Learn fire skills to fill your class slots" (the class tree's main tag,
  in plain words).
- The active class (`state.worn`) gives its bonus, tree, outfit and Class Level XP exactly as §5. Leaving a class
  (or choosing "No class") turns the class slots back into free slots keeping their skills.
- Player-facing words: "Class Level" (not CR), "patterns" are never shown as tags — only as plain goals
  ("Learn 1 more fire skill").

## 6. SkillBook v2 orchestration (`src/core/skillbook.ts`)

Owns `state: SkillBookState` (v2), `events`, `level`, `now()`, and `inv: Inventory`
(`{ count(id): number; coins(): number; spend(cost: {coins?, items?}): boolean }`, default all-zero, set by the game).
Public API (the client builds on exactly this):
```
has, hasElement, progress, rank, known(), knownElements(), flag, isMaxed, barSize, essenceSlots(id)
learn(id, source), learnElement(id, source), incFlag(id, n), addEssence(id, n), learnPassive(id, source)
recordUse(id, threat) / recordBuffUse(id, threat)       // threat = engaged monster threat
recordHit(id, { monster: MonsterDef; killed: boolean; hitIndex: number; instanceHits: number })
recordKill(monster)  -> { stars: number; starUp: boolean; essence?: string }   // bestiary + essence roll
trySpark(skillId, monster, now) -> SkillDef | null;  sparkWindow(skillId, monster)
witness(skillId) -> { status: 'learned' | 'progress' | 'blocked'; marks; need; anchorShape }
morphOptions(id) (v2: includes tier, requirement list with met flags, spark info), canMorph, morph(from, to)
ingredients() (elements, skills, essences), rememberedPair, fuse(a, b)
passives() -> {def, rank, strength}[];  totals() -> PassiveTotals (cached; invalidated on any learn/rank/class change
                                        // that alters passives — a Class Rank only at its imprint CR)
lessonState(lessonId), takeLesson(lessonId)
classProgress(cls), evaluateClasses(), wear(id), buyNode(classId, nodeId), respec(classId),
setImprints(ids), imprintSlots(), activeBonus(), tagPowerFor(skill)  // class bonus + passives (%)
stats(), serialize()
```
Events: `learned, element, rankUp, mastered, charge, morphed, fused, classDiscovered, classRank, hint, spark,
witness, echo, passive, essence, lesson, bestiary`. Discovery checks run on events only, never per frame.
`incFlag` re-runs class discovery only for flags some class requirement reads (`flag` ids, `visited:<map>` for
`mapVisited`) and on its first call after the book is constructed (catch-up for a loaded save); `kills`,
`kill_<id>`, `talk:<id>`… skip it.

**Save v2** (`src/core/save.ts`): `migrateBookState(raw): SkillBookState` handles v1 (classes `string[]` →
`{rank:1,xp:0,spent:{}}`, `activeClass` → `worn`, adds new fields, clamps xp to the new curve) and v2 (fills any
missing fields). Session save key `omnipath.save.v2`; v1 key read once and migrated (never deleted before a v2 write).

## 7. World v2

### 7.1 Macro grid
Each layout character = a 2×2 tile block. `MACRO_LEGEND` (`src/core/world/compile.ts`):

| char | meaning | blocks |
|---|---|---|
| `.` | biome ground | |
| `,` | biome alt ground (variant tiles, more small decor) | |
| `t` | light woods: biome ground + 35% biome trees | trees block |
| `T` | dense forest: biome tree on every tile | yes |
| `#` | wall: cave/crypt wall in cave/crypt biomes, cliff elsewhere | yes |
| `~` | deep water | yes |
| `-` | shallow water (fishable edge) | yes |
| `=` | path (dirt) | |
| `+` | cobble plaza | |
| `:` | sand | |
| `o` | stony ground + 20% rocks/boulders | rocks block |
| `g` `h` `d` `e` `*` `i` `c` `x` `m` `l` | grass · hill grass · dark grass · ember · snow · ice · cave floor · crypt floor · moss · dusk grass | |
| `b` | bridge / planks | |
| `L` | lava | yes |
| `C` | rock cluster (boulders) | yes |
| ` ` (space) | void (outside the dungeon) | yes |

Biome table (ground `.` / alt `,` / tree / wall): meadow GRASS/FLOWERS/tree/CLIFF · lake GRASS/GRASS2/tree/CLIFF ·
hill HILL/GRASS2/pine/CLIFF · quarry STONE/GRASS2/pine/CLIFF · grove DARK/MOSS/darktree/CLIFF · glade GLADE/MOSS/duskwillow/CLIFF ·
ember EMBER/STONE/deadtree/CLIFF · plateau STONE/STORMGRASS/deadtree/CLIFF · town GRASS/FLOWERS/tree/CLIFF ·
cave CAVE/MOSS/stalagmite/CAVE_WALL · crypt CRYPT/CAVE/tombstone/CRYPT_WALL · frost SNOW/ICE/frostpine/CLIFF ·
basalt BASALT/EMBER/basalt_spire/CLIFF · storm STORMGRASS/HILL/pine/CLIFF · dusk DUSK/GLADE/duskwillow/CLIFF.
Ground adjacent to water becomes SAND in meadow/lake/town biomes. Decor scatter (seeded from `def.seed`) never lands on
paths (+1 tile margin), portals (+2), structures, NPCs, nodes, objects (+1) or spawn centres.

### 7.2 Map rules (checked by `tests/world.test.ts` / `validateWorld`)
- Sizes (tiles): town 40×32 · outpost 24×20 · field 56×44 to 64×48, **or exactly 40×32** (`vale.stormbreak_approach`)
  · dungeon floor 40×40 · arena 24×24 · secret 16×16–24×24 (`MAP_SIZES` in `src/core/world/validate.ts`).
- Every portal `to` exists and pairs back (unless `oneWay`); arrival tiles (2 tiles inward from the destination rect
  centre along the reverse facing) are walkable; edge portals are ≥ 3 tiles wide and sit on the map border.
- Flood fill from every arrival reaches every NPC, node, object, other portal and spawn centre (hidden-portal and
  gated destinations excluded from *their* map's requirement only).
- Every map has ≤ 60 monsters total, ≤ 12 spawn entries, ≤ 12 NPCs, ≤ 8 portals; safe maps have 0 spawns.
- Spawn spread (soft, `spawnWarnings`; `tests/world.test.ts` keeps it empty): the client may home a monster on any
  walkable tile of its spawn square (cx ± r, cy ± r), so ≤ 5% of those tiles may lie more than 3 × r walking steps
  from the centre (`SPAWN_SPREAD`) — a square must not reach over a cliff or wall onto another terrace. Clients
  should also sample only tiles in the centre's walkable component.
- **Hidden portals** (`PortalReveal`) are revealed by a cast within 3 tiles whose skill matches **any of**: `tag`, OR
  its element is `element` or one of `elements`, OR its shape kind is `shape` (e.g. the quarry shaft: tag heavy OR
  shape nova; the gloomwood glade: element shadow OR holy).
- Graph test: from `vale.hearthvale`, using only non-hidden, non-gated portals, reach a source for ≥ 3 primal elements
  (fire: hearthvale forge, holy needs 3, earth: quarry ore, water: mirror lake fishing, wind: windcrest shrine,
  shadow: gloomwood obelisk) — so the 3-element Prism Gate to Stormbreak can never soft-lock.

### 7.3 Region manifest (ids are fixed — portals must match exactly)

Region `vale` "Hearth Vale" (Lv 1–12, hub `vale.hearthvale`):

| map id | kind | tiles | biome | band | worldCell | portals (id → destination) |
|---|---|---|---|---|---|---|
| vale.hearthvale | town | 40×32 | town | — | 2,2 | west→greenmeadow#east · north→mirror_lake#south · east→greystone_quarry#west · south→gloomwood#north |
| vale.greenmeadow | field | 56×44 | meadow | 1–3 | 1,2 | east→hearthvale#west · north→mirror_lake#southwest |
| vale.mirror_lake | field | 64×44 | lake | 2–4 | 2,1 | south→hearthvale#north · southwest→greenmeadow#north · northeast→windcrest_hill#southwest · islet(hidden, shape dash, look shimmer)→lake_islet#shore |
| vale.lake_islet | secret | 16×16 | lake | 3–3 | 2,0 | shore→mirror_lake#islet |
| vale.windcrest_hill | field | 56×48 | hill | 4–6 | 3,1 | southwest→mirror_lake#northeast · south→greystone_quarry#north · falls(hidden, element wind, look fog)→falls_hollow#mouth |
| vale.falls_hollow | secret | 20×20 | glade | 6–6 | 4,0 | mouth→windcrest_hill#falls |
| vale.greystone_quarry | field | 64×48 | quarry | 3–6 | 3,2 | west→hearthvale#east · north→windcrest_hill#south · south→cinder_fields#north · depths(door)→quarry_depths.1#entrance · shaft(hidden, tag heavy OR shape nova, look cracked_rock)→collapsed_shaft#ladder |
| vale.collapsed_shaft | secret | 16×16 | cave | 5–5 | 4,1 | ladder→greystone_quarry#shaft |
| vale.quarry_depths.1 | dungeon | 40×40 | cave | 5–7 | 4,2 | entrance→greystone_quarry#depths · down(stairs)→quarry_depths.2#up |
| vale.quarry_depths.2 | dungeon | 40×40 | cave | 6–8 | 4,2 | up→quarry_depths.1#down · down→quarry_depths.3#up |
| vale.quarry_depths.3 | arena | 24×24 | cave | 9–9 | 4,2 | up→quarry_depths.2#down |
| vale.gloomwood | field | 64×48 | grove | 5–7 | 2,3 | north→hearthvale#south · east→cinder_fields#west · barrow(door)→hollow_barrow.1#entrance · glade(hidden, element shadow OR holy, look glyph)→moonlit_glade#path |
| vale.moonlit_glade | secret | 24×24 | glade | 7–7 | 1,3 | path→gloomwood#glade |
| vale.hollow_barrow.1 | dungeon | 40×40 | crypt | 7–8 | 2,4 | entrance→gloomwood#barrow · down→hollow_barrow.2#up |
| vale.hollow_barrow.2 | dungeon | 40×40 | crypt | 8–9 | 2,4 | up→hollow_barrow.1#down · down→hollow_barrow.3#up |
| vale.hollow_barrow.3 | dungeon | 40×40 | crypt | — (rest floor, no spawns, safety pve) | 2,4 | up→hollow_barrow.2#down · down→hollow_barrow.4#up · vault(door, gate elements shadow+holy)→barrow_vault#door |
| vale.barrow_vault | secret | 16×16 | crypt | — | 2,4 | door→hollow_barrow.3#vault |
| vale.hollow_barrow.4 | arena | 24×24 | crypt | 11–11 | 2,4 | up→hollow_barrow.3#down |
| vale.cinder_fields | field | 56×44 | ember | 6–9 | 3,3 | west→gloomwood#east · north→greystone_quarry#south · east→stormbreak_approach#west · outpost(door)→emberwatch#gate |
| vale.emberwatch | outpost | 24×20 | ember | — | 3,4 | gate→cinder_fields#outpost |
| vale.stormbreak_approach | field | 40×32 | plateau | 8–10 | 4,3 | west→cinder_fields#east · gate(edge, gate elementsKnown 3)→stormbreak#entrance |
| vale.stormbreak | arena | 24×24 | plateau | 12–12 | 5,3 | entrance→stormbreak_approach#gate · rift(edge, gate flag warden_thunderhoof)→rift.riftgate_road#vale |

Region `rift` "Riftmarch" (Lv 11–21, hub `rift.riftmarch`):

| map id | kind | tiles | biome | band | worldCell | portals |
|---|---|---|---|---|---|---|
| rift.riftgate_road | field | 64×48 | storm | 11–13 | 0,1 | vale→vale.stormbreak#rift · town→riftmarch#west |
| rift.riftmarch | town | 40×32 | town | — | 1,1 | west→riftgate_road#town · north→frost_shelf#south · east→basalt_steps#west · south→dusk_orchard#north |
| rift.frost_shelf | field | 64×48 | frost | 12–15 | 1,0 | south→riftmarch#north · east→thunderhead_ridge#west |
| rift.basalt_steps | field | 64×48 | basalt | 14–17 | 2,1 | west→riftmarch#east · north→thunderhead_ridge#south |
| rift.thunderhead_ridge | field | 64×48 | storm | 16–19 | 2,0 | west→frost_shelf#east · south→basalt_steps#north |
| rift.dusk_orchard | field | 64×48 | dusk | 18–21 | 1,2 | north→riftmarch#south |

Portal destinations in the tables omit the region prefix when it is the same region: `greenmeadow#east` means
`vale.greenmeadow#east`. Waystones (`objects` kind `waystone`): hearthvale, windcrest_hill, emberwatch,
quarry_depths.1, quarry_depths.2, hollow_barrow.1, hollow_barrow.3, stormbreak_approach, riftgate_road, riftmarch.
Altars: hearthvale, emberwatch, riftmarch. Region file: `src/data/world.ts` (`REGIONS`, `MAPS`).

### 7.4 Per-map content manifest

| map | NPCs | nodes | objects | spawns (commons / elite / warden) |
|---|---|---|---|---|
| hearthvale | brann, alba, mirelle, tamsin | — | waystone, altar, signpost | — |
| greenmeadow | hale, child_lio | herb ×6 | signpost | jellop, pipsprout / jellop_monarch |
| mirror_lake | pell | fishing ×4 (on `-` edges/pier), herb ×3 | — | puddlewisp, jellop / brinewisp |
| lake_islet | — | fishing ×2, sun_spring ×1 | chest | puddlewisp ×3 |
| windcrest_hill | oru | wind_chime ×5 | waystone, wind_shrine | gustling, sparkbug / galeplume |
| falls_hollow | — | wind_chime ×3 | chest | gustling ×4 |
| greystone_quarry | miner_gus | ore ×10 | signpost | mossling, cragling / boulderback |
| collapsed_shaft | — | ore ×5 | chest | cragling ×4 |
| quarry_depths.1 | — | ore ×4 | waystone | cragling, glowmite |
| quarry_depths.2 | — | ore ×3 | waystone | glowmite, cragling / geode_sentinel (den) |
| quarry_depths.3 | — | — | — | — / — / ironroot_colossus |
| gloomwood | — | shadow_fungus ×6 | obelisk | gloomcap, hollowshade / gloom_matriarch |
| moonlit_glade | — | sun_spring ×3 | statue | moonmoth ×3 (rare) |
| hollow_barrow.1 | — | shadow_fungus ×3 | waystone | hollowshade, cairn_wraith |
| hollow_barrow.2 | — | — | — | cairn_wraith, hollowshade / crypt_keeper (den) |
| hollow_barrow.3 | — | sun_spring ×1 | waystone, campfire, chest | — |
| barrow_vault | — | — | chest (twilight hint), statue | — |
| hollow_barrow.4 | — | — | — | — / — / hollow_regent |
| cinder_fields | scout_rhea | ember_vent ×6 | signpost | emberkit, ashfly / emberkit_alpha |
| emberwatch | vey, mirelle_2 (waykeeper) | — | waystone, altar, campfire | — |
| stormbreak_approach | — | storm_tree ×4 | waystone | sparkbug, voltcalf / voltmane |
| stormbreak | — | — | — | — / — / thunderhoof |
| riftgate_road | korrin | storm_tree ×3, herb ×3 | waystone | riftling, rift_stalker |
| riftmarch | ione, dask | — | waystone, altar, signpost | — |
| frost_shelf | — | frost_crystal ×6, fishing ×3 | — | frostling, rimefang / glacier_matron |
| basalt_steps | — | ember_vent ×5, ore ×4 | — | basalt_crawler, cinder_toad / magma_brute |
| thunderhead_ridge | — | storm_tree ×5, wind_chime ×3 | — | cloudray, thunderwing / tempest_drake |
| dusk_orchard | — | shadow_fungus ×4, sun_spring ×3 | — | duskhound, gloamthorn / dusk_sovereign |

Nodes: kind → item, flag, action: ore → `ore`, `ore_mined` (1.2 s channel; 10 → earth) · fishing → `fish`,
`fish_caught` (minigame; 3 → water) · herb → `herb`, `herb_gathered` · ember_vent → `ember_shard`, `ember_gathered` ·
wind_chime → `chime_feather`, `chime_gathered` · storm_tree → `storm_wood`, `storm_gathered` · shadow_fungus →
`umbral_spore`, `spore_gathered` · sun_spring → `sun_water`, `sun_gathered` · frost_crystal → `frost_crystal`,
`frost_gathered`. Nodes respawn 150 s (absolute timestamps in the save).
Element sources stay as v1: forge 3× (fire; Brann gifts 6 ore on first visit so fire never needs the quarry),
fishing 3 (water), ore 10 (earth), wind shrine meditation (wind), obelisk after 5 gloomcaps (shadow), Alba with 3
elements (holy), Storm Shard from Thunderhoof (lightning). Fused elements only via the altar.

## 8. Content manifest (ids are fixed)

**Monsters** (`src/data/monsters.ts`; stats from `monsterStats(level, rank)` ±20%):

| id | name | lv | family | size | element (lvl) | rank | essence | techniques (echo marks) |
|---|---|---|---|---|---|---|---|---|
| jellop | Jellop | 1 | sprite | S | — | common | reprise | — |
| pipsprout | Pipsprout | 2 | sylvan | S | earth | common | leech | — |
| puddlewisp | Puddlewisp | 3 | sprite | S | water | common | return | mon_water_spit |
| gustling | Gustling | 4 | sprite | S | wind | common | split | mon_gust (drops tome_quickstep 12% once) |
| sparkbug | Sparkbug | 5 | swarm | S | lightning | common | arc | mon_zap |
| mossling | Mossling | 3 | sylvan | M | earth | common | expanse | — |
| cragling | Cragling | 5 | construct | M | earth | common | heavy | — |
| glowmite | Glowmite | 6 | swarm | S | — | common | pierce | — |
| gloomcap | Gloomcap | 6 | sylvan | M | shadow | common | leech | mon_spore_puff |
| hollowshade | Hollowshade | 7 | revenant | M | shadow | common | haste | — |
| cairn_wraith | Cairn Wraith | 8 | revenant | M | shadow (2) | common | reprise | mon_wail |
| emberkit | Emberkit | 7 | beast | M | fire | common | flurry | — |
| ashfly | Ashfly | 7 | swarm | S | fire | common | split | mon_ember_spit |
| voltcalf | Voltcalf | 9 | beast | M | lightning | common | haste | mon_zap |
| moonmoth | Moonmoth | 7 | sprite | S | holy | elite (rare) | expanse | lunar_dust (5) |
| jellop_monarch | Jellop Monarch | 3 | sprite | M | — | elite | reprise | jelly_slam (3) |
| brinewisp | Brinewisp | 4 | sprite | M | water (2) | elite | return | bubble_lance (3) |
| galeplume | Galeplume | 6 | sprite | M | wind (2) | elite | split | gale_feather (3) |
| boulderback | Boulderback | 6 | construct | L | earth (2) | elite | heavy | boulder_roll (3) |
| geode_sentinel | Geode Sentinel | 8 | construct | L | earth (2) | elite | pierce | geode_spikes (3) |
| gloom_matriarch | Gloomcap Matriarch | 8 | sylvan | L | shadow (2) | elite | leech | spore_burst (3) |
| crypt_keeper | Crypt Keeper | 10 | revenant | L | shadow (2) | elite | reprise | grave_chill (3) |
| emberkit_alpha | Emberkit Alpha | 9 | beast | M | fire (2) | elite | flurry | ember_pounce (3) |
| voltmane | Voltmane | 10 | beast | L | lightning (2) | elite | arc | static_charge (3) |
| ironroot_colossus | Ironroot Colossus | 9 | construct | L | earth (2) | warden | heavy | tremor_stomp (1); drops relic_stone |
| hollow_regent | Hollow Regent | 11 | revenant | L | shadow (2) | warden | reprise | umbral_rend (1); drops relic_dusk |
| thunderhoof | Thunderhoof | 12 | beast | L | lightning (2) | warden | arc | thunder_stomp (1); drops storm_shard, tome_static_field (60%), relic_storm |
| riftling | Riftling | 12 | fiend | S | — | common | haste | — |
| rift_stalker | Rift Stalker | 13 | fiend | M | shadow | common | flurry | mon_rift_lunge |
| frostling | Frostling | 13 | sprite | S | ice | common | split | mon_frost_shard |
| rimefang | Rimefang | 14 | beast | M | ice | common | flurry | — |
| glacier_matron | Glacier Matron | 15 | beast | L | ice (2) | elite | expanse | rime_breath (3) |
| basalt_crawler | Basalt Crawler | 15 | construct | M | magma | common | heavy | — |
| cinder_toad | Cinder Toad | 16 | beast | S | magma | common | return | mon_magma_glob |
| magma_brute | Magma Brute | 17 | construct | L | magma (2) | elite | heavy | magma_spit (3) |
| cloudray | Cloudray | 17 | sprite | M | storm | common | arc | mon_zap |
| thunderwing | Thunderwing | 18 | wyrm | M | storm | common | haste | — |
| tempest_drake | Tempest Drake | 19 | wyrm | L | storm (2) | elite | arc | storm_dive (3) |
| duskhound | Duskhound | 19 | beast | M | twilight | common | flurry | — |
| gloamthorn | Gloamthorn | 20 | sylvan | M | twilight | common | leech | mon_thorn_volley |
| dusk_sovereign | Dusk Sovereign | 21 | fiend | L | twilight (2) | elite | reprise | dusk_lash (3) |

Elites reuse their base texture (`texture: 'mon_<base>'`, tint, scale 1.3–1.4) where noted by `base`; new species
get their own `mon_<id>` texture. `mon_*` techniques are monster-only attacks (tag `monster`, never learnable).

**Echo skills** (`src/data/skills/echoes.ts`, tag `echo`, any weapon, tier 1 unless noted, maxRank 5):
jelly_slam (nova), bubble_lance (projectile, water), gale_feather (projectile, wind), boulder_roll (dash, earth, heavy),
geode_spikes (nova, earth), spore_burst (spin, poison status), grave_chill (projectile, shadow, slow), ember_pounce
(dash, fire), static_charge (chain, lightning), lunar_dust (nova, holy, tier 2), tremor_stomp (nova, earth, heavy,
tier 2), umbral_rend (strike, shadow, tier 2), thunder_stomp (nova, lightning, tier 2), rime_breath (strike ice),
magma_spit (projectile magma), storm_dive (dash storm), dusk_lash (strike twilight).

**Weapon trees** (`src/data/skills/{sword,dagger,staff}.ts`, morphs in `src/data/morphs.ts`). Existing ids keep their
data; new nodes in **bold**:

| weapon | T1 | T2 (parent) | T3 capstone (parent) |
|---|---|---|---|
| sword | whirlwind, sword_throw, heavy_cleave | spinning_assault, **crescent_sweep** (whirlwind) · boomerang_blade, blade_volley (sword_throw) · guillotine, **sundering_blow** (heavy_cleave) | **tempest_waltz** (spinning_assault) · **hundredfold_edge** (blade_volley) · **worldbreaker** (guillotine) |
| dagger | backstab, fan_of_knives, shadowstep | assassinate, venom_edge (backstab) · blade_storm, **ricochet_knives** (fan_of_knives) · phantom_rush, **smoke_veil** (shadowstep) | **coup_de_grace** (assassinate) · **thousand_cuts** (blade_storm) · **nightfall_waltz** (phantom_rush) |
| staff | arcane_orb, arcane_nova, focus | singularity, **prism_orb** (arcane_orb) · arcane_barrage, **resonant_pulse** (arcane_nova) · **arcane_ward**, **quicken** (focus) | **starfall_lattice** (singularity) · **arcane_deluge** (arcane_barrage) · **astral_form** (arcane_ward) |

Existing alternates stay (quickstep→shadowstep with shadow, meditation→focus, firebolt→meteor).
Display renames (ids unchanged): fan_of_knives "Knife Fan", shadowstep "Umbral Step", blade_storm "Steel Bloom",
sanctuary "Hallowed Rest", backstab "Blindside", firebolt "Ember Dart", lightning_bolt "Forked Spark", wind_cutter
"Twin Gale", holy_light "Dawn Dart", thunderstorm "Squall Cell" (§9: those names matched Ragnarok Online skills).

**Trainers** (`src/data/trainers.ts`) and their techniques (`src/data/skills/techniques.ts`, tier 1, maxRank 5, any
weapon unless noted):

| trainer id | NPC | lessons |
|---|---|---|
| hale | Drillmaster Hale (greenmeadow) | rising_kick (strike, knockback; always) · shoulder_charge (dash, heavy; any skill r3) · passive sure_footing (speed) |
| brann | Brann the Smith (hearthvale) | crack_armor (strike heavy, stun; 20 ore + any blade r5) · hammer_toss (projectile heavy; forge_success 3) · passive forgehand (atk) · essence heavy (coins, repeatable) |
| alba | Sister Alba (hearthvale) | mending_light (buff regen; holy) · radiant_burst (spin holy; holy + any r5) · passive devotion (sp) |
| pell | Fisher Pell (mirror_lake) | hook_pull (projectile, pull; 10 fish) · net_throw (projectile, slow; 5 fish) · passive patience (regenStill) · essence return (fish, repeatable) |
| oru | Old Hermit Oru (windcrest_hill) | meditation (existing; any skill mastered) · palm_strike (strike spirit; meditation r3) · passive still_mind (masteryXp) |
| vey | Quartermaster Vey (emberwatch) | flare_dash (dash fire; worn class) · rally_cry (buff atk; worn class) · passive field_drill (hp) · essence haste (ember_shard, repeatable) |
| korrin | Korrin the Wayfinder (riftgate_road) | essences split/arc/pierce/expanse (rift materials or coins, repeatable) · passive pathfinder (speed) |

**NPCs** (`src/data/npcs.ts`): brann, alba, mirelle (Waykeeper, hearthvale), tamsin (Loremaster, hearthvale — class
codex hints), hale, child_lio, pell, oru, miner_gus, scout_rhea, vey, mirelle_2 (Waykeeper, emberwatch), korrin,
ione (Archivist, riftmarch — Tier II/III guidance), dask (Waykeeper, riftmarch).
`NpcDef { id, name, title, portrait (emoji), texture, role: 'smith'|'priestess'|'hermit'|'fisher'|'trainer'|
'waykeeper'|'loremaster'|'villager', trainer?: string, lines: string[] }`.

**Items** (`src/data/items.ts`): materials ore, fish, herb, ember_shard, chime_feather, storm_wood, umbral_spore,
sun_water, frost_crystal · relics relic_stone/relic_dusk/relic_storm (flags of the same id) · shard storm_shard ·
tomes tome_quickstep, tome_static_field · consumables healing_draught (heal 40), mana_draught (sp 40),
waystone_shard (recall), blink_seed (blink).

**Passives** (`src/data/passives.ts`): tag_* (12, §4.5) · trainer passives sure_footing, forgehand, devotion,
patience, still_mind, field_drill, pathfinder (maxRank 3, repeatable lessons raise rank) · resonances `res_<a>_<b>`
(sorted primal pair, the 17 pairs that are not ice/magma/storm/twilight; each a `vsStatus` or `power` effect ≤ 15%)
· class tree passives + imprints from `classTreeTemplate` for every class.

**Classes** (`src/data/classes.ts`, 30; ids fixed, names may change only where noted):

| tier | ids |
|---|---|
| I (18) | blademaster, tempest_dancer, pyroblade, shadowstalker, knife_juggler, assassin ("Nightblade"), arcanist, pyromancer, tidecaller, stormcaller, earthshaper, elementalist, spellblade, wayfarer, paladin ("Oathsworn"), twilight_sage, **windblade** (2× blade+wind), **mimic** (3× echo) |
| I hidden | **moonwarden** (mapVisited vale.moonlit_glade + 1× holy) |
| II (8) | **sword_saint** (blademaster 10), **magma_knight** (pyroblade 10 + magma element), **phantom** (shadowstalker 10), **archmage** (arcanist 10), **prism_sage** (elementalist 10, 5 distinct elements), **vortex_dancer** (tempest_dancer 10), **runeknight** ("Glyphwarden"; spellblade 6 + earthshaper 6), **stormreaver** (stormcaller 6 + tempest_dancer 6) |
| II hidden | **echo_sovereign** (mimic 8 + 6 echoes) |
| III (2) | **ascendant** (sword_saint 6 + archmage 6, flag relic_storm), **eclipse_walker** (phantom 6 + prism_sage 6, flag relic_dusk) |

Every class: `tier`, `tree` + `imprint` via `classTreeTemplate`, a hint riddle; Tier II/III/hidden get a signature
skill `<classId>_sig` in `src/data/skills/signatures.ts` (existing signatures keep their ids).

**Recipes** (`src/data/recipes.ts`): keep all 29 v1 recipes, add ≥ 15 more covering new T2 nodes, echoes and
cross-weapon pairs, plus the 17 resonance recipes (`el:a + el:b → passive:res_a_b`, requires
`tagCount [a] ≥ 2` and `tagCount [b] ≥ 1`).

`dataVersion: 2`.

## 9. Names & IP
Use only original names. Banned: any Ragnarok Online proper noun (towns, monsters, jobs, skills, items,
services, currency, map-id patterns like `prt_fild08`), "MVP", "Kafra", "Zeny", "card" for sigils, "Blue Magic",
"Glimmer". Terms we own: Spark, Echo, Witness, Essence, Resonance, Imprint, Class Rank, Warden, Waystone, Waykeeper,
Prism Gate, Codex. Keep the procedural canvas art pipeline — no external images.
