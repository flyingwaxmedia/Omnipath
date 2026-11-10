# Omnipath v4 — Adopted Design Specification

This file is the **contract** for v4. It answers the owner's v4 direction sentence by sentence (table below) and
replaces the parts of `docs/SPEC-v2.md` it names. Where this file and SPEC-v2 disagree, **this file wins**; everything
SPEC-v2 says that is not touched here still holds. `docs/UX-SIMPLE.md` stays binding for every player-facing word.

Reading rules
- **[T]** marks a tunable: a starting number from research that has not been play-tested. Tunables live in one
  constants object per system (named in each section) so balance passes never touch logic.
- "Phase n" on a row says when it is built (§15). **Phase 1 is the smallest slice** that fixes "classes feel the
  same" and "looks AI-made".
- Skill signatures are written `kind·element·delivery·extra` (§6.2). In the class tables the element is the class's
  source, so they are shortened to `kind·delivery·extra`.
- Facts about today's game come from the v4 audit (file:line references are in the audit, not repeated here).
- Hard rules of SPEC-v2 still apply: `src/core/**` imports nothing from Phaser, the DOM, `src/game` or `src/ui`; all
  core randomness goes through `src/core/rng.ts`; `npm test` and `npx tsc --noEmit` pass at the end of every phase.

## 0. The brief, sentence by sentence

| # | Owner's sentence | Answered in |
|---|---|---|
| 1 | "The classes need to be more unique, some basically have all the same abilities." | §3 (explicit 5-skill kits, overlap rule, one signature mechanic per class) |
| 2 | "Echoes should be something like skill augments instead of creating a new spell" | §5 |
| 3 | "I want a lot of unlockable spells but they should all feel different from each other." | §6 (13 new skill kinds, distinctness rule, re-authored duplicates), §2.4, §3.6, §8.4 |
| 4 | "The game looks heavily ai made, it needs to be more visually stunning." | §11 |
| 5 | "Monsters should drop resources used for our systems." | §7 |
| 6 | "Class passives should only work for other classes when the class whose perk it is is mastered." | §4 |
| 7 | "The maps and town need to be improved." | §11.3 – §11.6 |
| 8 | "Do more research." | Research files adopted throughout; sources stay in the research files. What was adopted, changed or rejected is in §16.1 |
| 9 | "Classes should be broken into rarity." | §3.2 |
| 10 | "after dying x time you learn shadow skill tree, return stone home x times unlock teleport tree" | §8 |
| 11 | "Synergies, improvements, uniqueness, intuitive." | §10 (synergies), §12 (plain words), §3 (uniqueness), §1 |
| 12 | "Legendary skill lines that change form like dragon, angel, demon." | §9 |
| 13 | "Skills can go back to requiring weapons where it makes sense, like rod doesn't whirlwind." | §2.2 |
| 14 | "There should be a tree for no weapon equipped, fists." | §2.3 – §2.4 |
| 15 | "shadow tree with fists would be like venom … shadow with rod would be shadow priest" | §3.1 grid; Gloamhost and Hollow Cantor in §3.6; originality rules in §3.9 |
| 16 | "Element magic with daggers would be shinobi … Element magic with swords would be like demon slayer" | §3.1 grid: the whole dagger and sword columns; §3.9 |
| 17 | "Research class types outside our original source prompt" | §3 (33 new classes drawn from the class research), §16.1 |

---

## 1. What changes for the player (one page)

1. **Four weapons, each its own way to fight.** Sword, Dagger, Rod and **Bare Hands**. Each has its own basic attack
   and its own skill tree. *If a move swings, throws or channels through a weapon, you need that weapon. Everything
   else works with anything.* A Rod cannot Whirlwind any more; a fire spell still works with a sword in hand.
2. **59 classes that play differently.** A class is a weapon plus a power source (plain skill, or one of the 11
   elements). Every class has **one thing only it does** — a meter, a stance, marks to cash in, a combo, things it
   plants on the ground, or a form — and **5 skills of its own**. No two classes share more than one skill.
3. **Classes have rarity.** Common, Uncommon, Rare, Epic, Legendary, Mythic. Rarer classes are harder to find and
   take more thought to play. They are not stronger.
4. **Echoes change your skills instead of adding new ones.** See a monster's signature move, defeat it, and you
   learn its Echo. Put the Echo on a skill with one tap and the skill behaves differently: it seeks, it bounces, it
   leaves a burning pool. Every skill has one Echo socket next to its Rune sockets.
5. **Many more spells, none alike.** Skills now also place zones and traps, blink, heal, shield, tether, orbit, rain
   down, beam, charge up, counter, summon and build walls. A test in the build refuses any two skills that work the
   same way.
6. **Monsters drop things you use.** Six materials (Fangs, Motes, Cores, Sap, Dust, Sigils) sit in a Pouch as
   numbers, not bag clutter. Each feeds one system. The Bestiary shows what a monster drops and what it is for.
7. **A class's gift follows you only once you master it.** Reach Class Level 10 and the class's passive becomes a
   **Keepsake** you can wear on any other class.
8. **Deeds unlock things.** Fall in battle often enough and the Shade Arts open. Use your Return Stone often enough
   and the Waystep tree opens. 36 deeds in all, most of them things you would do anyway, a few of them jokes.
9. **Six Legendary lines change your shape.** Dragon, Angel, Demon, Swarm, Mountain and Star. Fill the line's meter,
   take the form, play a different bar for a while, then pay its price.
10. **Twelve combos.** One line each: "Soaked + Lightning = Conduct". The word pops up when you do it.
11. **The world looks authored.** Real cast shadows, giant trees and landmarks, cliffs with stairs, forest edges with
    depth, clearings where fights happen, and a rebuilt Hearthvale: a river, a bridge, a market, a terrace and the
    Hearth Tree.

---

## 2. Weapons and weapon gating

### 2.1 Data model (`src/core/types.ts`, `src/data/weapons.ts`)

```ts
export type WeaponType = 'sword' | 'dagger' | 'staff' | 'fists';      // 'staff' is shown as "Rod", 'fists' as "Bare Hands"
export const WEAPON_TYPES: readonly WeaponType[] = ['sword', 'dagger', 'staff', 'fists'];

/** The tag that binds a skill to a weapon. Exactly one grip tag per bound skill. */
export const GRIP_TAG: Readonly<Record<WeaponType, string>> = { sword: 'blade', dagger: 'pierce', staff: 'rod', fists: 'fist' };

export interface SkillDef {
  // ...existing fields...
  /** Weapons that may use this skill. Set if and only if the skill carries a grip tag (or is a tier-0 basic). */
  weapons?: WeaponType[];
}
```

`WEAPONS.fists` (new, always owned, price 0, cannot be sold or unequipped — it IS "nothing equipped"):

| id | shown as | basic | atk | matk | crit | delay ms | range px | size S/M/L | upgrade item |
|---|---|---|---|---|---|---|---|---|---|
| sword | Iron Sword | `slash` | 10 | 4 | 3 | 800 | 50 | 0.85 / 1.0 / 0.9 | the sword |
| dagger | Rogue Dagger | `stab` | 8 | 4 | 12 | 520 | 40 | 1.0 / 0.85 / 0.65 | the dagger |
| staff | Oak Rod | `bolt` | 5 | 13 | 2 | 900 | 260 | 1.0 / 1.0 / 1.0 | the rod |
| fists | Bare Hands | `jab` (new) | 8 **[T]** | 8 **[T]** | 8 **[T]** | 450 **[T]** | 36 | 1.0 / 0.95 / 0.8 **[T]** | Hand Wraps |

Skills tagged `fist` are **hybrid** (they use the higher of ATK and MATK, SPEC-v2 §2), so elemental fist classes need
no second stat line. `HYBRID_TAGS` gains `fist`; it loses `echo` (§5).

### 2.2 The gating rule

**Player sentence (the only wording the UI uses):** *"If a move uses a weapon, you need that weapon."* A locked
skill shows one line and one action: **"Needs a sword — Equip"**.

**Tag rule (one function, `core/requirements.ts: weaponOk(skill, weapon)`):**

| A skill is… | when it carries | examples | usable with |
|---|---|---|---|
| **weapon-bound** | a grip tag: `blade`, `pierce`, `rod` or `fist` | Whirlwind (`blade`), Knife Fan (`pierce`), Arcane Orb (`rod`), Haymaker (`fist`) | only the weapons in `weapons` |
| **free** | no grip tag | Ember Dart, Meteor, Quake (tag `spell`), Focus, Quicken (`buff`), Quickstep (`mobility`), Rising Kick (`body`), every Shade Art | any weapon |

- `weaponOk` returns true when `skill.weapons` is undefined or includes the held weapon. Nothing else is consulted.
- `Registry.validate` errors: a skill with a grip tag and no `weapons`; a skill with `weapons` and no grip tag
  (tier-0 basics excepted); a skill with two different grip tags whose `weapons` does not list both (cross-weapon
  skills such as Twin Fang keep `['sword','dagger']` and carry both tags).
- **Retag pass (Phase 1, content lane):** `blade` ⇒ sword and `pierce` ⇒ dagger already line up for all bound skills
  (audit §6). New tag `rod` goes on the staff tree's unaligned workings that are thrown *through* the rod: `bolt`,
  `arcane_orb`, `arcane_nova`, `singularity`, `prism_orb`, `arcane_barrage`, `resonant_pulse`, `starfall_lattice`,
  `arcane_deluge`, and every Rod class skill. Elemental staff spells (Ember Dart, Meteor, Aqua Lance, Forked Spark,
  Twin Gale, Dawn Dart, Quake, Inferno Ring, Glacial Orb, Squall Cell, Plasma Lance, Tidal Ripple, Dawn Prism,
  Featherstorm, Geode Maw, Thunder Peal, Tangle Orb, Cinder Blink) lose `weapons`, keep `arcane` (so they still use
  MATK and ignore size) and gain `spell`: they are free. Staff buffs lose `weapons`. `shadowstep` gains `pierce`;
  `smoke_veil`, `gloom_shroud`, `moonveil` (thrown pellets) lose `weapons`. The 8 `blade` and 4 `arcane` signatures
  that have no `weapons` today get them when they are re-authored as class skills (§3.6).
- **Why free spells do not erase the Rod:** spells scale on MATK and the Rod has 13 against 4 – 8. A swordsman may
  cast Meteor; it will be weak. That is the intended soft gate, and it is what lets Spellblade and the elemental
  sword and dagger classes exist.
- **Body moves** (`rising_kick`, `palm_strike`, `shoulder_charge`, `soaring_heel`, `rippling_palm`, `static_palm`,
  `crown_slam`, `quakestride`, `pressure_point`) get tag `body`: free with any weapon, and **+20% power bare-handed
  [T]** (`WEAPON.bodyBonus`).
- **Weapon swap:** from the bag or the "Needs a … — Equip" line. 3 s cooldown **[T]**, not during a wind-up. Becoming
  a class equips its weapon in the same tap. Swapping away from a worn class's weapon greys its bound class slots
  (they stay on the bar, showing the one-line prompt).
- `usable()` in `MapScene.ts` calls `weaponOk`; the SPEC-v2 §5.1 line "Weapons never gate learned skills" is repealed.

### 2.3 Weapon trees

Each weapon keeps the SPEC-v2 §4.1 shape: **13 nodes** = root, 3 × T1, 6 × T2, 3 × T3, reached by Transforms.
The sword, dagger and rod trees keep their ids; their near-duplicate nodes are re-authored in §6.4.

### 2.4 The Bare Hands tree (new, Phase 1; `src/data/skills/fists.ts`, morphs in `src/data/morphs/fists.ts`)

All carry `fist`, `weapons: ['fists']`, element none.

| Tier | Skill (id) | One line shown to the player | Signature | From | Extra requirement |
|---|---|---|---|---|---|
| 0 | **Jab** (`jab`) | A quick punch. Master it and new moves open up. | `strike·none·punch·none` | — | — |
| 1 | **Haymaker** (`haymaker`) | A big swing that stuns. | `strike·none·punch·stun` | Jab | — |
| 1 | **Sweep Kick** (`sweep_kick`) | A low spinning kick that slows everyone near. | `spin·none·kick·slow` | Jab | — |
| 1 | **Guard Up** (`guard_up`) | Raise your arms and soak the next hits. | `shield·none·self·none` | Jab | Deed: be hit 200 times |
| 2 | **One-Two** (`one_two`) | Two fast punches. The second loves to crit. | `strike·none·punch·crit` | Haymaker | Sudden insight possible (threat 6) |
| 2 | **Body Blow** (`body_blow`) | Hit the ribs: the foe takes more damage for a while. | `strike·none·punch·expose` | Haymaker | — |
| 2 | **Windmill** (`windmill`) | Spin with your leg out and send foes flying. | `spin·none·kick·knockback` | Sweep Kick | Sudden insight possible (threat 8) |
| 2 | **Flying Knee** (`flying_knee`) | Leap at a foe and launch it into the air. | `dash·none·target·launch` | Sweep Kick | Deed: 50 bare-handed wins |
| 2 | **Second Wind** (`second_wind`) | Catch your breath: heal and move faster. | `mend·none·self·haste` | Guard Up | — |
| 2 | **Shove** (`shove`) | Push everything away from you. | `nova·none·ring·knockback` | Guard Up | — |
| 3 | **Drumroll** (`drumroll`) | A blur of punches that stops a foe mid-cast. | `strike·none·punch·interrupt` | One-Two | 2 other tree skills ★5, 1 element, deed: defeat a warden bare-handed |
| 3 | **Comet Heel** (`comet_heel`) | Jump high and come down heel first. Stuns. | `dash·none·point·stun` | Flying Knee | same |
| 3 | **Unbroken** (`unbroken`) | A shield that also shakes off what ails you. | `shield·none·self·cleanse` | Second Wind | same |

The fists capstones replace the "weapon's warden relic" rule of the other trees with the flag `warden_bare ≥ 1`.

---

## 3. Classes

### 3.1 The grid

A class = **weapon × power source**. Power sources: `physical` plus the 11 real elements (fire, water, earth, wind,
lightning, shadow, holy, ice, magma, storm, twilight). Each weapon has a *grammar* that its whole row shares, so the
row needs one set of code and art:

| Weapon | Grammar (what the row has in common) |
|---|---|
| Sword | Cuts in rhythm. Class skills are cuts, waves and steps that chain. |
| Dagger | Plants things and cashes them in: marks, fuses, nodes, mist. |
| Rod | Places things that stay: hearths, seeds, chimes, wards. |
| Bare Hands | The body is the weapon: a meter on the body changes what your hits are. |

| Source | Sword | Dagger | Rod | Bare Hands |
|---|---|---|---|---|
| physical (starter) | Blademaster | Knife Juggler | Spellwright | Wayfarer |
| physical (advanced) | Sword Saint | Hushblade | Archmage | Knucklesaint |
| fire | Pyroblade | Fusewright | Pyromancer | Feverfist |
| water | Tidefencer | Mistknife | Tidereader | Riverbone |
| earth | Glyphwarden | Burrowfang | Earthshaper | Menhir |
| wind | Windblade | Tempest Dancer | Chimewright | Kitefist |
| lightning | Stormwhirl | Voltscribe | Stormcaller | Nervefire |
| shadow | Wakeblade | Shadowstalker | Hollow Cantor | Gloamhost |
| holy | Oathsworn | Candlethief | Moonwarden | Palmlight |
| ice | Rimecutter | Frostneedle | Stillwater Seer | Frostmarrow |
| magma | Magma Knight | Glassfang | Calderamancer | Slagheart |
| storm | Ascendant | — | — | Thunderhide |
| twilight | — | Eclipse Walker | Twilight Sage | Twinsoul (Mythic) |

Off the grid: **Spellblade** (sword + Rod spells), **Prismcaller** (Rod, every element), **Mimic** and **Manyroads**
(any weapon), and the six **Legendary lines** (any weapon, §9). Empty cells stay empty in v4.
Total: **59 classes** = 26 that keep their id + 33 new.

### 3.2 Rarity

| Rarity | Count | What it means | How it is found | Class XP × |
|---|---|---|---|---|
| Common | 4 | The weapon's starter. One rule, readable in 30 seconds. | Use the weapon: land 60 hits **[T]**. | 1.0 |
| Uncommon | 16 | Weapon + one element. | Know the element and defeat 20 foes **[T]** with it while holding the weapon. | 1.0 |
| Rare | 24 | A stronger twist, or a fused element. | Uncommon-style counts + one named deed + a **Trial** (2 Sigils). | 1.2 **[T]** |
| Epic | 7 | A second layer to manage. | A mastered parent class + a deed + a Trial (5 Sigils). | 1.4 **[T]** |
| Legendary | 6 | A form that replaces your bar (§9). | A three-deed chain + a **Rite** (10 Sigils). | 1.6 **[T]** |
| Mythic | 2 | Odd on purpose. | One cryptic deed. No Sigils, no Trial. | 1.6 **[T]** |

Rules
1. **Flat power.** Rarity never adds damage. The class budget and the rotation simulation (§3.5) hold every class to
   the same band.
2. **Rarity is shown honestly.** Locked classes are silhouettes with the rarity colour and pips and ONE hint line.
   Rarity colours: Common grey, Uncommon green, Rare blue, Epic violet, Legendary gold, Mythic rose; each also has
   1 – 6 pips so colour is never the only signal.
3. **Nothing sells an unlock.** No class, Echo, deed or material is ever bought with real money or skipped.
4. **Commons stay worth wearing.** Every weapon's Common has an Epic "advanced" class behind its mastery, so a
   veteran's first class leads somewhere.
5. **Mythic gates nothing.** No quest, portal, Trial or other class requires a Mythic.

### 3.3 Data model (`src/core/types.ts`; replaces `ClassClause`, `ClassTier`, `ClassNode`, `ClassDef.clauses/parents/tree/imprint`)

```ts
export type Rarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary' | 'mythic';
export type PowerSource = 'physical' | ElementId;

export type GaugeFill =
  | { on: 'hit'; weapon?: WeaponType; amount: number }            // per landed hit
  | { on: 'hitDistinct'; windowMs: number; amount: number }       // per different foe hit inside the window
  | { on: 'kill'; lowHpBelow?: number; amount: number }
  | { on: 'damageTaken'; perPct: number }                         // per 1% max HP lost
  | { on: 'prevented'; perPct: number }                           // per 1% max HP shielded or healed
  | { on: 'move'; perTile: number } | { on: 'still'; perSec: number } | { on: 'idleAttack'; perSec: number }
  | { on: 'cast'; tag?: string; element?: ElementId; alternate?: [ElementId, ElementId]; amount: number }
  | { on: 'hpSpent'; perPct: number } | { on: 'pickup'; item: 'ember'; amount: number } | { on: 'time'; perSec: number };

export type ClassMechanic =
  | { kind: 'gauge'; name: string; max: number | null; fill: GaugeFill[]; decay?: { afterMs: number; perSec: number };
      /** What the gauge does at thresholds or when spent. Each effect is one of a closed set the engine knows. */
      effects: GaugeEffect[]; autoRule: AutoRule }
  | { kind: 'combo'; name: string; length: 3 | 4; distinct: boolean; filter?: { weapon?: WeaponType; tag?: string };
      finisher: ComboFinisher; autoRule: AutoRule }
  | { kind: 'marks'; name: string; max: number; applyOn: 'weaponHit' | 'skillTag' | 'opening' | 'launch';
      perMark: MarkEffect; spendWith: string /* kit skill id */; autoRule: AutoRule }
  | { kind: 'stance'; names: [string, string]; swap: 'tap' | { everyMs: number } | { hold: true };
      /** kit skill id -> the SkillDef id it becomes in stance B. Unlisted skills are unchanged. */
      remap: Record<string, string>; lockMs?: number; autoRule: AutoRule }
  | { kind: 'zone'; name: string; object: string /* WorldObjectDef id */; max: number; lifeMs: number;
      near: { tiles: number; effects: GaugeEffect[] }; autoRule: AutoRule }
  | { kind: 'form'; gauge: Extract<ClassMechanic, { kind: 'gauge' }>; formKit: [string, string, string, string, string];
      stages: FormStage[]; aftermath: { name: string; ms: number; effects: GaugeEffect[] } };

/** One declarative line the AUTO battler follows. Manual play may always do better. */
export type AutoRule =
  | { spend: 'atMax' } | { spend: 'atPct'; pct: number } | { swap: 'never' } | { swap: 'hpBelow'; pct: number }
  | { place: 'atFeet' | 'onTarget'; keep: number } | { form: 'atMax' | 'never' };

export interface ClassDiscovery {
  /** Every requirement must hold. Reuses Requirement, including the new `deed` kind (§8). */
  requires: Requirement[];
  /** Rare and above: a QuestDef id with `trialOf` set; the Sigil cost is paid when it is accepted. */
  trial?: string;
  sigils?: number;
}

export interface ClassDef {
  id: string; name: string; icon: string;
  desc: string;                 // one line, under 60 characters
  hint: string;                 // one riddle line for the silhouette
  rarity: Rarity;
  weapon: WeaponType | 'any';
  source: PowerSource | 'prism' | 'none';
  mechanic: ClassMechanic;
  /** Exactly 5 SkillDef ids. kit[i] unlocks at CLASS.kitAt[i]. */
  kit: [string, string, string, string, string];
  /** PassiveDef id: on while worn; wearable on other classes as a Keepsake once this class is mastered (§4). */
  passive: string;
  discover: ClassDiscovery;
  bonus: StatBonus;
  look: string;                 // classLooks key
  hidden?: boolean;             // Mythic and the Moonwarden: no silhouette until whispered
}
```

`SkillDef` gains `classOf?: string` (set on kit and form skills; such a skill can only be equipped in a class slot of
that class, never in "your" slots, and is never a fusion ingredient).

### 3.4 Class rules (`src/core/classes.ts`, constants in `CLASS`)

```
CLASS = { maxLevel: 10, kitAt: [1, 1, 2, 4, 6], mechanicUpgradeAt: 8, wornShare: 0.5,
          xpMul: { common: 1, uncommon: 1, rare: 1.2, epic: 1.4, legendary: 1.6, mythic: 1.6 } }     // [T]
classXpToNext(level, rarity) = round(60 * 1.22^(level-1) * CLASS.xpMul[rarity])
mastered(cls, progress)     = progress.rank >= CLASS.maxLevel
```

- **One max level for every class: 10.** "Mastered" means Class Level 10. Nothing else.
- **Class XP** comes only from wearing the class: whenever a skill earns mastery XP, the worn class gains
  `wornShare ×` that XP if the skill is in its kit or is usable with its weapon. The 15% "bleed" to unworn classes is
  removed: mastery must mean you played it.
- **Class slots:** slots 1 – 5 hold the kit, in kit order. A kit skill not yet unlocked leaves its slot to the old
  "best related skill" pick (SPEC-v2 §5.1 step 3, now limited to skills usable with the class weapon), so a new
  class never shows empty slots. `classSkills()` no longer scores by tier; it returns the kit, then related fills.
- **The class tree is removed.** No points, no nodes, no template passives. What a Class Level gives:

| Class Level | You get |
|---|---|
| 1 | The mechanic, kit skills 1 and 2, the passive (while worn), 40% of the class bonus |
| 2 | Kit skill 3 |
| 4 | Kit skill 4 |
| 6 | Kit skill 5 |
| 8 | Mechanic upgrade (one authored line per class, e.g. Heat max 10 → 12) |
| 10 | **Mastered**: the passive becomes a Keepsake (§4); a gold border on the class card; 100% of the bonus |

  The bonus grows linearly from 40% at Level 1 to 100% at Level 10.
- **The 5 class skills are the class's own.** Rule, enforced by `tests/class-kits.test.ts`:
  1. every class has exactly 5 kit skills;
  2. **no two classes share more than 1 kit skill** (form kits count as part of their class);
  3. at least 4 of a class's 5 kit skills carry `classOf` = that class;
  4. no skill sits in more than 2 kits;
  5. every kit skill is usable with the class weapon (a bound skill's `weapons` includes it; `any` classes hold only
     free skills; Manyroads, whose mechanic swaps the weapon per skill, is the one listed exception);
  6. a class's own kit never repeats a `kind·delivery·extra` signature.
  The kits below go further than the rule asks: all 5 skills are own in all 59 classes.
- **Discovery** is a `ClassDiscovery`. When its requirements hold the player sees one card: *"New class: Pyroblade —
  Become a Pyroblade?"*. For Rare and above the card reads *"Trial ready: Glyphwarden"* and the one action is
  **Begin Trial**; finishing the Trial quest unlocks the class.
- **Trials** are ordinary quests (`QuestDef.trialOf?: string`, giver Tamsin in Hearthvale or Ione in Riftmarch):
  3 objectives built from existing objective kinds (use the class weapon and element N times, defeat a named elite
  with it, reach a place). They are authored per class in the phase that builds the class.
- **The signature mechanic never exports.** A Keepsake carries the passive only.

### 3.5 Flat power budget

- `balance.CLASS_BONUS_BUDGET = 10`: a worn class `bonus` adds at most 10 damage points to any one skill (ATK or MATK
  %, plus `tagPower` entries the skill can carry together). Non-damage stats keep the SPEC-v2 limits.
- `balance.KEEPSAKE_BUDGET = 5`: each passive declares `budget` (its worst-case damage points on one skill) ≤ 5. Three
  Keepsakes ⇒ at most 15. Total passive + class power per skill stays ≤ 45% (`PASSIVE_CAPS`).
- **Rotation simulation** (`tests/class-sim.test.ts`, core-only, deterministic): for every class, a level-10
  character with the class's weapon at upgrade 0 runs its AUTO rule for 60 s against a standard dummy pack (1 elite +
  4 commons, level 10, neutral element). Sustained damage must land within **±10% [T]** of the median of the four
  Commons; a perfect manual script may reach **+25% [T]** at most. Legendary classes are simulated across a full
  build → form → aftermath cycle. This is how "rarity = more involved, not stronger" is enforced.

### 3.6 The class list

`*` after a skill name = an existing skill id re-authored in place (§3.7), so saves keep its rank.
Kit order is unlock order. Outfits are notes for `classLooks.ts` (palette, headgear, one moving part).

#### Sword

| Class (id) | Source | Rarity | Fantasy | Signature mechanic | Outfit | Phase |
|---|---|---|---|---|---|---|
| **Blademaster** (`blademaster`) | physical | Common | Wins by never wasting a swing. | *combo* — Cadence: 3 different sword skills in a row make the 3rd a Finisher (always crits, +30% size). | Steel-blue tabard, short half-cape, bare head, sword worn on the hip. | 1 |
| **Sword Saint** (`sword_saint`) | physical | Epic | The sword is no longer held. It is part of the arm. | *stance* — Sheathed / Drawn: sheathed skills are slow single cuts that always crit; Draw swaps the kit to fast flurries for 8 s. | White gi under a slate long-coat, straw hat, sheathed blade carried in the off hand. | 4 |
| **Pyroblade** (`pyroblade`) | fire | Uncommon | Sword forms that breathe like a bellows. | *gauge* — Heat: +1 per sword hit (max 10), fades after 3 s idle. At 10 the next class skill costs HP instead of SP and is twice the size. | Soot-black leathers, ember-orange scarf, one smith's glove; the blade edge glows brighter with Heat. | 1 |
| **Tidefencer** (`tidefencer`, new) | water | Uncommon | A blade that never stops moving. | *gauge* — Flow: +1 per tile walked (max 8), drains while you stand. Class skills spend all Flow for +8% damage each. | Sea-green sash coat, bare feet, hair tied back; a ribbon of water trails the blade. | 3 |
| **Glyphwarden** (`runeknight`) | earth | Rare | Carves runes into steel, and the steel into the ground. | *zone* — Runestones: class skills plant up to 3 stones (12 s). Within 2 tiles of one you gain +15% DEF and your sword skills repeat from it at 30%. | Grey plate with chiselled blue runes, squared helm, heavy cloak; the runes light up near a stone. | 3 |
| **Windblade** (`windblade`) | wind | Uncommon | Lets the wind do half the cutting. | *marks* — Gale marks: sword hits mark a foe (max 3). Squall Stride cashes every mark in as a delayed cut. | Pale green wrap, long white scarf that always streams sideways, light bracers. | 2 |
| **Stormwhirl** (`stormreaver`) | lightning | Rare | Catches lightning mid-air and spins it into a wheel. | *gauge* — Charge: +1 per different foe hit (max 6). At 6 your next spin throws a bolt at every foe it touches. | Indigo coat with brass coil pauldrons, goggles; hair stands on end at full Charge. | 3 |
| **Wakeblade** (`wakeblade`, new) | shadow | Rare | Fights beside the swordsman he was two seconds ago. | *combo* — Wake: your shade repeats your last sword skill 2 s later at 50%. Cast the same skill as the shade lands and both fuse for ×2.5. | Charcoal long-coat and half-mask; a darker double of the hero lags one step behind. | 2 |
| **Oathsworn** (`paladin`) | holy | Uncommon | Names a vow before the fight and keeps it. | *gauge* — Vow: fills while you stay within 3 tiles of a foe and when you are hit (max 100); drains when you back away. At 100, Dawn Verdict unlocks. | Cream surcoat over mail, sun-gold trim, open helm, short blue cape. | 2 |
| **Rimecutter** (`rimecutter`, new) | ice | Rare | Cuts that do not bleed until she says so. | *marks* — Frostbite: sword hits bank 40% of their damage on the foe. Sheathe shatters everything banked at once, ×1.25. | White fur collar, pale blue lacquered plates, frosted blade in a dark sheath. | 4 |
| **Magma Knight** (`magma_knight`) | magma | Rare | A blade half molten that keeps getting heavier. | *gauge* — Slag: +1 per second in combat (max 10). Each point: +4% damage and size, −2% attack speed. Quench resets it into a shield. | Black basalt plate veined with orange cracks, horned helm, scorched cape (current look kept). | 4 |
| **Ascendant** (`ascendant`) | storm | Epic | Stands in the eye and waits. | *zone* — The Eye: a 3-tile storm circle follows you and strikes a random foe inside every 1.5 s. Skyrend Verdict aims every pending strike at one target. | Storm-grey and gold plate, circlet, long cape, a faint cloud ring overhead (current aura kept). | 4 |
| **Spellblade** (`spellblade`) | arcane (off-grid) | Rare | Steel and sorcery in one hand. | *stance* — Steel / Spell: one tap swaps. In Spell stance your sword skills fly as ranged arcs and use MATK. May cast Rod spells with a sword. | Half plate, half robe, split down the middle; glowing script runs along the blade. | 3 |

| Class | 5 class skills | Mastery passive | Discovered by |
|---|---|---|---|
| **Blademaster** | Measured Guard* `shield·self·crit` · Three-Beat Cut `strike·cut·bleed` · Turning Edge `spin·ring·knockback` · Closing Step `dash·target·slow` · Last Word `strike·cut·execute` | **Clean Edge** — Your 3rd hit in a row on the same foe always crits. | Land 60 hits with a sword. |
| **Sword Saint** | Petalfall Edge* `strike·cut·crit` · Stillwater Draw `charge·cut·none` · Scabbard Answer `counter·self·stun` · Hairline `projectile·wave·bleed` · Empty Scabbard `blink·target·expose` | **One Breath** — After 2 s without attacking, your next hit deals +40%. | Master Blademaster. End 10 fights with a single cut each. Trial. |
| **Pyroblade** | Searing Edge* `buff·self·haste` · Bellows Cut `strike·cut·none` · Cinder Line `zone·line·none` · Slag Arc `projectile·wave·knockback` · White Heat `strike·cut·execute` | **Banked Coals** — When a burn you caused ends, it pops for a small burst. | Know Fire. Defeat 20 foes with fire while holding a sword. |
| **Tidefencer** | Running Cut `dash·path·none` · Undertow Parry `counter·self·pull` · Eddy Turn `spin·ring·slow` · Breaker `projectile·wave·knockback` · Slack Tide `blink·point·haste` | **Never Still** — After walking 4 tiles your next skill costs no SP (10 s lock). | Know Water. Defeat 20 foes with water while holding a sword. |
| **Glyphwarden** | Runestone Slam* `nova·point·none` · Plant Glyph `zone·ground·shield` · Stonewrit Cut `strike·cut·root` · Bulwark Rune `shield·self·lure` · Shatter Script `nova·ground·launch` | **Carved Ground** — Standing still for 2 s grants a shield worth 8% of your HP. | Know Earth. Defeat 20 foes with earth sword skills. Break 10 ore rocks with a sword skill. Trial. |
| **Windblade** | Squall Stride* `dash·line·none` · Drawn Breeze `strike·cut·mark` · Lifting Cut `strike·cut·launch` · Slipstream `blink·target·haste` · Scatter Gust `projectile·wave·pull` | **Tailwind** — After any dash or blink you move 20% faster for 3 s. | Know Wind. Defeat 20 foes with wind while holding a sword. |
| **Stormwhirl** | Thunderwheel* `spin·ring·none` · Arc Lunge `blink·target·none` · Ground Wire `trap·ground·root` · Whip Crack `chain·cut·stun` · Stormspoke `orbit·self·none` | **Live Wire** — Every 5th hit you land arcs to one more foe. | Know Lightning. Hit 5 different foes within 3 s, 10 times. Trial. |
| **Wakeblade** | Second Cut `strike·cut·none` · Trade Places `blink·target·reposition` · Long Shadow `projectile·wave·slow` · Shade Feint `summon·ground·lure` · Twin Verdict `strike·cut·execute` | **Afterimage** — The first skill of each fight repeats once at 30%. | Learn 3 Shade Arts. Defeat 30 foes with shadow sword skills. Trial. |
| **Oathsworn** | Dawn Verdict `nova·point·stun` · Shield of Oath `shield·self·heal` · Hallowed Cut `strike·cut·none` · Stand Fast `zone·self·shield` · Oathbrand `buff·self·lure` | **Kept Word** — The first time you drop below 30% HP in a fight, heal 15%. | Know Holy. Defeat 20 foes with holy while holding a sword. |
| **Rimecutter** | Cold Draw `strike·cut·none` · Sheathe `chain·nearest·execute` · Glass Step `dash·path·none` · Icicle Row `trap·line·slow` · Hoar Fan `projectile·wave·slow` | **Cold Patience** — You deal +10% damage to slowed or frozen foes. | Know Ice. Shatter 25 frozen foes. Trial. |
| **Magma Knight** | Caldera Cleave* `strike·cut·stun` · Quench `shield·self·cleanse` · Slag Toss `projectile·throw·slow` · Crust Walk `dash·path·stun` · Vent `nova·ring·slow` | **Cooling Crust** — After a skill with a wind-up you take 15% less damage for 3 s. | Master Pyroblade. Know Magma. Trial. |
| **Ascendant** | Skyrend Verdict* `nova·point·none` · Hold the Eye `zone·self·slow` · Lightning Rod `summon·ground·lure` · Updraft Cut `strike·cut·launch` · Stormgate `blink·point·knockback` | **Charged Air** — Foes that hit you in melee are shocked (4 s lock per foe). | Master Stormwhirl. Hold Thunderhoof's storm relic. Trial. |
| **Spellblade** | Runic Blade* `strike·cut·interrupt` · Flying Edge `projectile·wave·none` · Spell Parry `counter·self·shield` · Inscribe `buff·self·haste` · Sentence `beam·line·none` | **Twin Schooling** — Sword skills and spells each use ATK or MATK, whichever is higher. | Know 2 sword skills and 2 Rod spells at ★3. Cast 30 spells while holding a sword. Trial. |

#### Dagger

| Class (id) | Source | Rarity | Fantasy | Signature mechanic | Outfit | Phase |
|---|---|---|---|---|---|---|
| **Knife Juggler** (`knife_juggler`) | physical | Common | There is always another knife. | *gauge* — Juggle: +1 per thrown knife that hits (max 5), lost after 4 s without a throw. Each point: +6% throw speed; at 5, knives pierce. | Patchwork vest in red and teal, bandolier of knives, soft cap with a feather. | 1 |
| **Hushblade** (`assassin`) | physical | Rare | One perfect strike ends the fight. | *marks* — Openings: a foe shows an Opening for 1.2 s after its own attack. Hitting it marks the foe (max 3). Quietus spends marks: +35% each; at 3 its cooldown resets. | Slate hood and half-cape, grey wraps, a single dark blade held reversed. | 3 |
| **Fusewright** (`fusewright`, new) | fire | Uncommon | Plants sparks and walks away. | *marks* — Fuses: dagger hits plant a Fuse (up to 5 foes). Snap lights them all: fire runs from foe to foe along the shortest line and burns everything on it. | Brown oilskin coat, coiled match-cord at the belt, tinted goggles, sooty fingers. | 3 |
| **Mistknife** (`mistknife`, new) | water | Uncommon | Only ever where the fog is thin. | *zone* — Mist: class skills leave Mist patches (5 s). Inside Mist you are unseen: foes drop their target and your first hit from Mist crits. | Grey-blue layered shawl, wide rain hat, blades hidden in the sleeves. | 3 |
| **Burrowfang** (`burrowfang`, new) | earth | Rare | Hunts from under the floor. | *stance* — Above / Below: Dive underground for up to 3 s (cannot be hit, −30% speed). Surfacing under a foe staggers it. Skills differ above and below. | Dusty brown wraps, a mole-claw gauntlet on the off hand, miner's lamp at the belt. | 3 |
| **Tempest Dancer** (`tempest_dancer`) | wind | Uncommon | Never still. Always spinning. | *gauge* — Lift: +1 per spin or dash chained within 1.5 s (max 5), lost if you stand still. Each point: +6% speed; spins gain a pulse at 3 and at 5. | Flowing teal sashes, bare arms with bangles, twin short blades; the sashes orbit when Lift is high. | 2 |
| **Voltscribe** (`voltscribe`, new) | lightning | Rare | Writes circuits between knives. | *zone* — Nodes: thrown knives stick in the ground as Nodes (max 4, 10 s). Any lightning skill arcs through every Node in the order you placed them. | Ink-blue coat with copper stitching in circuit lines, quill-shaped knives, copper circlet. | 3 |
| **Shadowstalker** (`shadowstalker`) | shadow | Uncommon | Sews an enemy's shadow to the floor. | *marks* — Pinned Shadow: pin a foe's shadow to root it for 2 s. Half the damage dealt meanwhile is stored and lands at once when the pin ends. | Deep violet hooded cloak, grey wraps, black needle-knives; the hero's own shadow is drawn longer. | 1 |
| **Candlethief** (`candlethief`, new) | holy | Rare | A lamplighter who steals the dark out of things. | *gauge* — Wicks: your dagger crits snuff one buff or status off the foe and store it as a Wick (max 3). Light a Wick to gain that effect yourself for 6 s. | Lamplighter's long coat in cream and brass, a pole-hook lantern on the back, snuffer on the belt. | 3 |
| **Frostneedle** (`frostneedle`, new) | ice | Rare | Leaves splinters that grow. | *marks* — Icicles: each dagger hit leaves an Icicle that grows for 6 s (up to ×3). Break harvests them all. Fire melts them. | White quilted jacket, ice-blue needles in a sash, frosted lashes and breath mist. | 4 |
| **Glassfang** (`glassfang`, new) | magma | Rare | Forges blades mid-fight and breaks them. | *combo* — Obsidian: Forge Fang makes a glass blade with 3 uses. The 3rd use shatters in an area bleed, so the order of your skills decides where it lands. | Ash-grey apron coat, black glass blades with orange cores, cracked-glass mask. | 4 |
| **Eclipse Walker** (`eclipse_walker`) | twilight | Epic | Works in the minute between sunset and night. | *combo* — Gloaming: alternate holy and shadow skills. 4 in a row opens the Gloaming for 5 s: cooldowns freeze and every hit counts as both elements. | Black and silver split cloak, eclipse brooch, a thin ring of light behind the head (current aura kept). | 4 |

| Class | 5 class skills | Mastery passive | Discovered by |
|---|---|---|---|
| **Knife Juggler** | Cascade `projectile·throw·none` · Behind the Back `projectile·throw·crit` · Caltrop Scatter `zone·ground·slow` · Encore `projectile·nearest·bleed` · High Toss `nova·point·stun` | **Spare Knife** — Every 4th basic attack also throws a knife at a second foe. | Land 60 hits with a dagger. |
| **Hushblade** | Read the Gap `counter·self·mark` · Quietus `strike·thrust·execute` · Nerve Tap `strike·thrust·expose` · Vanishing Line `blink·target·crit` · Borrowed Second `zone·self·slow` | **Patient Knife** — Your first hit on a foe that has not attacked you yet always crits. | Defeat 40 foes with a hit from behind. Trial. |
| **Fusewright** | Plant Fuse `strike·thrust·mark` · Snap `chain·nearest·none` · Spark Toss `projectile·throw·mark` · Powder Step `blink·point·none` · Slow Match `trap·ground·none` | **Short Fuse** — Foes that die while burning burst in a small ring. | Know Fire. Defeat 20 foes with fire while holding a dagger. |
| **Mistknife** | Fogbank `zone·ground·slow` · Drizzle Feint `summon·ground·lure` · Wet Edge `strike·thrust·none` · Rain Step `blink·point·none` · Downpour Pins `rain·point·none` | **Thin Fog** — Standing still for 2 s out of combat hides you; your next hit crits. | Know Water. Defeat 20 foes with water while holding a dagger. |
| **Burrowfang** | Dive `buff·self·reposition` · Surface Fang `strike·thrust·none` · Tunnel Line `dash·line·knockback` · Pit Snare `trap·ground·root` · Grit Spray `projectile·throw·slow` | **Loose Soil** — Dashing through a foe roots it for 0.8 s (6 s lock per foe). | Know Earth. Mine 40 ore. Defeat 20 foes with earth dagger skills. Trial. |
| **Tempest Dancer** | Eye of the Storm* `spin·ring·pull` · Pirouette `spin·path·none` · Feather Step `dash·path·haste` · Updraft `nova·ring·launch` · Curtain Call `projectile·ring·none` | **Light Feet** — Each dash or spin gives +6% move speed for 4 s (stacks 3 times). | Know Wind. Defeat 20 foes with spinning skills while holding a dagger. |
| **Voltscribe** | Set Node `projectile·throw·mark` · Close Circuit `chain·ground·none` · Live Step `blink·ground·none` · Short Out `nova·ground·stun` · Overwrite `tether·target·none` | **Residual Charge** — Your thrown skills leave a spark that shocks the next foe to cross it. | Know Lightning. Defeat 20 foes with lightning dagger skills. Hit one cast through 4 foes. Trial. |
| **Shadowstalker** | Shade Cloak* `buff·self·crit` · Shadow Pin `projectile·throw·root` · Second Shadow `blink·target·none` · Stitch `strike·thrust·mark` · Lights Out `zone·ground·slow` | **From Nowhere** — Hits from behind deal +15%. | Know Shadow or learn 2 Shade Arts. Defeat 20 foes with shadow while holding a dagger. |
| **Candlethief** | Snuff `strike·thrust·cleanse` · Light the Wick `buff·self·heal` · Lantern Toss `projectile·throw·none` · Borrowed Glow `shield·self·none` · Douse `nova·ring·interrupt` | **Pocketed Flame** — Defeating an elite or a buffed foe heals you 6%. | Know Holy. Defeat 15 elites with a dagger. Trial. |
| **Frostneedle** | Splinter `strike·thrust·mark` · Break `nova·ring·none` · Needle Drift `projectile·throw·none` · Thin Ice `trap·ground·none` · Cold Snap Step `blink·target·slow` | **Slow Thaw** — Your slows and freezes last 25% longer. | Know Ice. Freeze 40 foes. Trial. |
| **Glassfang** | Forge Fang `buff·self·bleed` · Glass Jab `strike·thrust·none` · Obsidian Fan `projectile·throw·bleed` · Shatterpoint `nova·target·stun` · Molten Slip `dash·path·none` | **Brittle Edge** — Every 3rd skill you use makes what it hits bleed. | Know Magma. Forge 10 times at a smithy. Trial. |
| **Eclipse Walker** | Totality* `dash·line·crit` · Sun Fang `strike·thrust·smite` · Moon Fang `strike·thrust·none` · Penumbra `zone·ground·slow` · Corona Step `blink·target·expose` | **Between Hours** — Using two different elements within 3 s gives +10% damage for 4 s. | Master Shadowstalker. Know Twilight. Hold the Hollow Regent's relic. Trial. |

#### Rod

| Class (id) | Source | Rarity | Fantasy | Signature mechanic | Outfit | Phase |
|---|---|---|---|---|---|---|
| **Spellwright** (`arcanist`) | physical (arcane) | Common | A scholar who weaves plain magic well. | *combo* — Weave: cast 3 different Rod spells in a row and the 4th is a Weave: free and 50% bigger. | Plum scholar's robe with silver thread, satchel of scrolls, round spectacles. | 1 |
| **Archmage** (`archmage`) | physical (arcane) | Epic | Has read every book on magic and written the rest. | *gauge* — Reservoir: fills 10 per second while you are not casting (max 100). Spells drink it to grow, up to twice the size at 100. | Midnight robe with star embroidery, tall soft hat, an open book floating at the shoulder. | 4 |
| **Pyromancer** (`pyromancer`) | fire | Uncommon | Tends a fire that must not go out. | *zone* — Hearth: place one Hearth. Kills near it feed it (5 levels); near it you gain +3% MATK per level. Hurl Hearth throws it as a meteor sized by its level. | Rust-red robe with a scorched hem, brazier-headed rod, ash-smudged face. | 1 |
| **Tidereader** (`tidecaller`) | water | Uncommon | The tide turns whether you are ready or not. | *stance* — Tide: turns by itself every 6 s. High Tide: spells are wide and push. Low Tide: spells are narrow, pull and hit 25% harder. | Sea-blue robe with a white foam hem, shell-capped rod, tide chart inked on the forearm. | 1 |
| **Earthshaper** (`earthshaper`) | earth | Uncommon | Gardens the battlefield in stone. | *zone* — Seeds: plant up to 3. Each grows over 6 s into a pillar that blocks shots. Shatter breaks them into shrapnel sized by growth. | Moss-green and clay robe, stone-ringed rod, gardener's gloves and a seed pouch. | 2 |
| **Chimewright** (`chimewright`, new) | wind | Rare | Hangs bells in the air and plays them. | *zone* — Chimes: hang up to 3 in the air. A foe knocked through a Chime rings it: a pulse that hits and knocks back again. | Sky-grey robe hung with small brass bells, a hooked rod like a bell-stand. | 3 |
| **Stormcaller** (`stormcaller`) | lightning | Uncommon | Carries a lantern that bottles strikes. | *gauge* — Bottles: Bottle Ward catches one enemy shot or spell (max 3 Bottles). Uncork hurls each one back as lightning of the same size. | Slate robe with yellow lining, a glass-lantern rod that flickers, bottle bandolier. | 2 |
| **Hollow Cantor** (`hollow_cantor`, new) | shadow | Rare | Sings silence into crowded heads. | *marks* — Doubt: spells stack Doubt on foes (max 5). At 5 the foe turns on its neighbours for 4 s. Your SP is replaced by Hush, which refills only while you are not being hit. | Ash-white cassock with a black stole, tall narrow hat, a rod topped with a cracked silver bell. | 2 |
| **Moonwarden** (`moonwarden`) | holy | Rare | Keeps watch so others may rest. | *gauge* — Moonlight: fills from damage you prevent or heal (max 100), shown as a waxing moon. At full, Moonfall is ready. | Silver-white robe with a deep blue hood, crescent-topped rod, moth-wing mantle. | 3 |
| **Stillwater Seer** (`stillwater_seer`, new) | ice | Epic | Freezes moments, not people. | *zone* — Still Point: place one for 3 s. Everything inside is paused (foes, their shots, your own spells), then all of it resumes at once. | Pale grey robe stiff with frost, mirror-disc rod, eyes closed. | 4 |
| **Calderamancer** (`calderamancer`, new) | magma | Rare | Wakes the mountain under the room. | *combo* — Cracks: each class cast widens the cracks in the floor (3 stages). The 4th cast erupts the whole network. | Charcoal robe with glowing orange seams, basalt-headed rod, heat shimmer at the feet. | 4 |
| **Twilight Sage** (`twilight_sage`) | twilight | Rare | Holds a scale between day and night. | *gauge* — Scale: holy spells tip it to Day, shadow spells to Night. Kept level (within 20) your spells hit as both. Tipped fully, that side locks for 5 s. | Robe dyed dawn-rose on one side and dusk-violet on the other, twin-bell rod. | 4 |
| **Prismcaller** (`elementalist`) | every element (off-grid) | Rare | One voice, every colour. | *stance* — Attune: tap to cycle the elements you know. All 5 class skills take that element. Swapping within 2 s of a hit sets off the old element's combo. | White robe whose hems take the attuned element's colour, crystal-headed rod. | 3 |

| Class | 5 class skills | Mastery passive | Discovered by |
|---|---|---|---|
| **Spellwright** | Mana Surge* `buff·self·shield` · Thread Bolt `projectile·bolt·mark` · Loom `zone·point·slow` · Knot `nova·point·root` · Unravel `chain·bolt·expose` | **Tidy Weave** — Every 4th spell you cast costs no SP. | Land 60 hits with a Rod. |
| **Archmage** | Sigilstorm* `nova·point·expose` · Grand Draft `charge·bolt·none` · Fold Space `blink·point·pull` · Counterspell `counter·self·interrupt` · Library of Stars `orbit·self·none` | **Deep Reserves** — While above 80% SP your spells are 15% larger. | Master Spellwright. Discover 25 different fusions. Trial. |
| **Pyromancer** | Kindle Hearth `zone·ground·none` · Hurl Hearth `nova·point·knockback` · Stoke `buff·ground·haste` · Ember Flock `projectile·nearest·none` · Backdraft `nova·ring·pull` | **Warm Hands** — Standing near any fire (campfire, Hearth, burning ground) restores SP. | Know Fire. Defeat 20 foes with fire while holding a Rod. |
| **Tidereader** | Tidal Hand `projectile·bolt·pull` · Breakwater `shield·self·knockback` · Tide Pool `zone·ground·heal` · Undertow `nova·point·pull` · Moon Pull `buff·self·haste` | **Ebb and Flow** — Every 6 s your next skill alternates between +15% size and +15% damage. | Know Water. Defeat 20 foes with water while holding a Rod. |
| **Earthshaper** | Plant Stone `zone·ground·none` · Shatter `nova·ground·knockback` · Rampart `shield·self·none` · Rolling Stone `projectile·bolt·knockback` · Sinkhole `zone·point·slow` | **Deep Roots** — You cannot be knocked back or pulled while casting. | Know Earth. Defeat 20 foes with earth while holding a Rod. |
| **Chimewright** | Hang Chime `summon·point·none` · Gust Hand `nova·line·launch` · Carillon `nova·ground·slow` · Windlass `tether·target·slow` · Still Air `zone·self·interrupt` | **Ringing** — Foes you knock into a wall or another foe take a small extra hit. | Know Wind. Knock 60 foes back. Ring every wind chime on Windcrest in one visit. Trial. |
| **Stormcaller** | Bottle Ward `shield·self·none` · Uncork `projectile·nearest·stun` · Ground Strike `nova·point·slow` · Jar of Wind `nova·ring·knockback` · Static Leash `chain·target·pull` | **Lightning Rod** — The first enemy shot to hit you in each fight is caught and thrown back. | Know Lightning. Defeat 20 foes with lightning while holding a Rod. |
| **Hollow Cantor** | Low Note `projectile·bolt·mark` · Dirge `zone·point·slow` · Silence `nova·point·interrupt` · Unsay `tether·target·leech` · Empty Pew `summon·point·lure` | **Quiet Mind** — After 4 s without being hit, your next skill costs no SP. | Learn 3 Shade Arts. Defeat 30 foes with shadow Rod spells. Trial. |
| **Moonwarden** | Moonwake Ring* `spin·ring·slow` · Silver Ward `shield·self·cleanse` · Moonfall `rain·point·none` · Glade Circle `zone·ground·heal` · Tidewatch `mend·self·haste` | **Night Watch** — Healing you receive is 20% stronger. | Stand in the Moonlit Glade knowing Holy. Trial. |
| **Stillwater Seer** | Still Point `zone·point·none` · Held Breath `charge·bolt·none` · Rime Mirror `counter·self·reposition` · Snowblind `nova·ring·slow` · Thaw `mend·self·haste` | **Unhurried** — Damage cannot interrupt your wind-ups. | Master Tidereader. Know Ice. Stand still through a warden's wind-up 5 times. Trial. |
| **Calderamancer** | First Crack `zone·line·none` · Widen `nova·ground·slow` · Vent Gas `zone·ground·poison` · Eruption `nova·ground·launch` · Obsidian Wall `wall·line·none` | **Pressure** — Each skill you cast makes your next different skill 5% stronger (max 4). | Know Magma. Master Earthshaper or Pyromancer. Trial. |
| **Twilight Sage** | Dusk Bell `nova·point·slow` · Dawn Bell `nova·point·heal` · Sun and Moon `orbit·self·none` · Half-Light `zone·ground·expose` · Level the Scale `mend·self·cleanse` | **Even Hand** — Your holy and shadow skills each make the other 8% stronger for 4 s. | Know Twilight. Cast 40 holy and 40 shadow Rod spells. Trial. |
| **Prismcaller** | Prism Burst* `nova·ring·none` · Refraction* `projectile·bolt·none` · Attune `buff·self·cleanse` · Colour Wheel `orbit·self·none` · White Light `beam·line·none` | **Many Colours** — Each different element you used in the last 6 s gives +4% damage (max 3). | Know 3 elements. Set off 30 element combos. Trial. |

#### Bare Hands

| Class (id) | Source | Rarity | Fantasy | Signature mechanic | Outfit | Phase |
|---|---|---|---|---|---|---|
| **Wayfarer** (`wayfarer`) | physical | Common | A traveller who settles things by hand. | *combo* — Road Rhythm: Jab, Jab, then any class skill makes that skill a Roadhouse hit (bigger, knocks down). | Travel-worn poncho, hand wraps, bedroll on the back, walking boots. | 1 |
| **Knucklesaint** (`knucklesaint`, new) | physical | Epic | A pilgrim who trained by being hit. | *gauge* — Bruise: fills from damage you take, not deal (max 100). Counters spend it: the more Bruise, the harder they land. | Bare-chested with prayer beads, bandaged fists and shins, shaved head, old bruises drawn on. | 4 |
| **Feverfist** (`feverfist`, new) | fire | Uncommon | Fever-hot, burning from the inside. | *gauge* — Fever: rises as you attack (max 100). Hotter = faster and stronger, but above 70 you burn yourself. Exhale vents it all as a cone. | Sleeveless red gi, steam rising off the shoulders, skin flushed brighter as Fever climbs. | 2 |
| **Riverbone** (`riverbone`, new) | water | Uncommon | Redirects force like a current. | *stance* — Deflect: hold it to catch the next hit (you take none). Your next strike returns that hit on top of its own. | Loose river-blue trousers, wave tattoos across a bare torso, wet hair, open-palm stance. | 2 |
| **Menhir** (`menhir`, new) | earth | Uncommon | Slowly becomes a standing stone. | *gauge* — Stone Skin: standing still stacks it (max 5): each stack −8% damage taken, −6% speed. Shrug throws the skin off as shrapnel. | Grey stone-dust body paint, rope belt, heavy bare feet; plates of rock appear with each stack. | 2 |
| **Kitefist** (`kitefist`, new) | wind | Uncommon | Lighter than he should be. | *marks* — Aloft: your launchers put a foe Aloft for 1.2 s. Hits keep it up (max 3 juggles) and it takes a landing hit when it comes down. | Yellow and white wraps with trailing ribbons, kite-tail sash, always on tiptoe. | 2 |
| **Nervefire** (`nervefire`, new) | lightning | Rare | Overclocks her own body. | *gauge* — Overclock: no cap, +1% speed per hit. Above 100, each second risks a 1 s self-stun (5%, +1% per 10 over). Ground Out cashes it in. | Sleeveless yellow-and-black jacket, copper nerve-lines down the arms that light up, twitchy idle. | 3 |
| **Gloamhost** (`gloamhost`, new) | shadow | Rare | A brawler who shares a body with a living shadow. | *gauge* — Hunger: the Lodger (your shadow) is fed by kills (max 5). Each level grows a shadow arm: +1 hit on punches. Starve it for 20 s and it bites you. | Plain dark tunic; the hero's shadow climbs the arms as inky sleeves and grows extra shadow hands with Hunger. Matte shadow, small pale eye-dots on the hands only. | 2 |
| **Palmlight** (`palmlight`, new) | holy | Rare | Hands that mend and break with the same touch. | *gauge* — Mercy: the same palm heals you and hurts foes. Healing above full HP fills Mercy (max 100). At full, Smiting Palm spends it all. | White wraps with gold thread, palms that glow, a pilgrim's short cloak. | 3 |
| **Frostmarrow** (`frostmarrow`, new) | ice | Rare | Calm slows the world. | *gauge* — Calm: fills while you do NOT attack (20 per second). At full, nearby foes are slowed 40% and your next 3 skills are free. | Blue-white wrap coat, bare frost-rimed fists, slow visible breath. | 4 |
| **Slagheart** (`slagheart`, new) | magma | Rare | A body like a furnace door. | *gauge* — Core: fire and earth hits you take hurt 30% less and fill the Core (max 100). Open the Core for a short eruption, then 3 s fragile. | Iron chest-plate like a furnace door with a glowing grille, soot-black arms, ember eyes. | 4 |
| **Thunderhide** (`thunderhide`, new) | storm | Rare | Skin that hums before the strike. | *gauge* — Hum: being hit builds it. Every 4th hit you take discharges at the attacker by itself. Taking hits is your damage. | Storm-grey hide vest, drum-like bracers, hair and fur trim standing with static. | 4 |
| **Twinsoul** (`twinsoul`, new) | twilight | Mythic | Two souls taking turns in one body. | *stance* — Day-self / Night-self: Day is fast and fragile, Night is slow and armoured. Each has its own HP bar; the resting one heals 3% per second. Swap any time (2 s lock). | One side of the outfit pale gold, the other deep indigo; the lit side swaps with the active self. | 5 |

| Class | 5 class skills | Mastery passive | Discovered by |
|---|---|---|---|
| **Wayfarer** | Roadhouse `strike·punch·knockback` · Dust Kick `strike·kick·slow` · Walk It Off `mend·path·none` · Long Stride `dash·path·haste` · Shoulder Roll `dash·target·stun` | **Road Legs** — You move 10% faster out of combat and 5% faster in it. | Land 60 hits with bare hands. |
| **Knucklesaint** | Turn the Cheek `counter·self·none` · Receipt `strike·punch·execute` · Iron Shirt `shield·self·lure` · Pilgrim's Knee `strike·kick·launch` · Count to Ten `mend·self·cleanse` | **Thick Skin** — 10% of the damage you take is stored and added to your next skill. | Master Wayfarer. Take 20,000 damage in total. Defeat a warden bare-handed. Trial. |
| **Feverfist** | Exhale `strike·wave·none` · Stoke the Blood `buff·self·crit` · Brand Palm `strike·punch·mark` · Coalwalk `zone·path·none` · Fever Break `mend·self·cleanse` | **Warm Blood** — Below 50% HP you attack 15% faster. | Know Fire. Defeat 20 foes with fire while bare-handed. |
| **Riverbone** | Deflect `counter·self·none` · Return Current `strike·punch·knockback` · Whirlpool Throw `nova·target·pull` · Flow Step `blink·target·none` · Still Pool `mend·self·none` | **Yielding** — The first hit you take every 10 s is halved. | Know Water. Defeat 20 foes with water while bare-handed. |
| **Menhir** | Shrug `nova·ring·none` · Standing Stone `buff·self·lure` · Lintel Drop `strike·punch·expose` · Root Stomp `nova·ring·root` · Capstone `shield·self·knockback` | **Set in Stone** — Standing still for 2 s cuts damage you take by 10% until you move. | Know Earth. Defeat 20 foes with earth while bare-handed. |
| **Kitefist** | Lift Kick `strike·kick·launch` · Air Jab `strike·punch·crit` · Spike `strike·punch·stun` · Kite String `tether·target·pull` · Tumble `blink·point·none` | **Light Touch** — Foes you knock back or launch take +10% damage for 2 s. | Know Wind. Defeat 20 foes with wind while bare-handed. |
| **Nervefire** | Ground Out `nova·ring·stun` · Twitch `strike·punch·haste` · Synapse `blink·nearest·none` · Flicker Combo `strike·punch·none` · Deadman Switch `shield·self·stun` | **Quick Nerves** — Cooldowns run 8% faster while you are above 80% HP. | Know Lightning. Be shocked 30 times. Trial. |
| **Gloamhost** | Lodger's Reach `strike·punch·pull` · Many Hands `strike·punch·none` · Feed `strike·punch·leech` · Dark Coat `shield·self·lure` · Let It Out `summon·self·none` | **Second Mouth** — Each kill heals you 3% of your max HP. | Learn 3 Shade Arts. Defeat 30 foes bare-handed with shadow. Trial. |
| **Palmlight** | Open Palm `strike·punch·heal` · Smiting Palm `strike·punch·execute` · Laying On `mend·self·cleanse` · Halo Step `blink·target·none` · Blessed Ground `zone·ring·heal` | **Gentle Hands** — Your heals also remove one status from you. | Know Holy. Spare 30 foes. Heal 2,000 HP in total. Trial. |
| **Frostmarrow** | Breathe `buff·self·cleanse` · Glacier Palm `strike·punch·knockback` · Numb `strike·kick·slow` · Stillness `zone·self·slow` · Winter Coat `shield·self·none` | **Cool Head** — After 3 s without attacking, your next skill has +25% crit chance. | Know Ice. Win 10 fights using 3 skills or fewer. Trial. |
| **Slagheart** | Open the Core `nova·ring·knockback` · Furnace Door `shield·self·none` · Clinker Punch `strike·punch·stun` · Pour `zone·line·slow` · Bank the Fire `buff·self·haste` | **Furnace Lining** — Burn and poison on you last half as long. | Know Magma. Take 200 fire or earth hits. Trial. |
| **Thunderhide** | Hum `buff·self·lure` · Thunder Slap `strike·punch·knockback` · Rolling Peal `nova·ring·slow` · Cloudburst Stance `shield·self·slow` · Come Here `tether·target·pull` | **Charged Hide** — Every 6th hit you take shocks the attacker. | Know Storm. Be hit 500 times. Trial. |
| **Twinsoul** | Changing of the Guard `buff·self·reposition` · Noon Jab `strike·punch·haste` · Midnight Hook `strike·punch·stun` · Shared Breath `mend·self·shield` · Both at Once `summon·self·none` | **Other Half** — When you would be defeated, you stand back up at 20% HP instead (once every 5 minutes). | Secret deed. Hint: "Two hands, two hours, one very bad minute." |

#### Any weapon (off-grid, Legendary lines)

| Class (id) | Source | Rarity | Fantasy | Signature mechanic | Outfit | Phase |
|---|---|---|---|---|---|---|
| **Mimic** (`mimic`) | none (off-grid) | Epic | Answers every monster in its own voice. | *combo* — Mirror: Borrowed Roar repeats the last skill a foe used on you. Every class skill has a second Echo socket. | Motley coat patched from monster hides, a blank white mask pushed up on the forehead. | 4 |
| **Manyroads** (`manyroads`, new) | none (off-grid) | Mythic | Walked every road and kept walking. | *stance* — Crossroads: each class slot remembers a weapon. Casting a class skill swaps to its weapon instantly, with no swap cooldown. | Layered traveller's coat stitched from four colours, all four weapons carried at once. | 5 |
| **Wyrmsoul** (`wyrmsoul`, new) | Dragon line | Legendary | Something old sleeps under the skin. | *form* — Embers: foes you defeat with an element drop Embers (max 100). At full, become the Wyrm: slow, huge, breathing the last element you gathered. After: Molt (−25% DEF, +15% speed, 10 s). | Base: scaled bracers and a horned circlet. Form: a 64 px four-legged drake in the absorbed element's colours, original head with back-swept horn plates. | 5 |
| **Dawnwing** (`dawnwing`, new) | Angel line | Legendary | Keeps a light on for everyone else. | *form* — Grace: fills from damage you prevent or heal (max 100). At full, rise as the Dawnwing: hovering, ranged, warding. Mercy: foes under 15% HP surrender. After: Grounded (no dashes or blinks, 10 s). | Base: white half-cape with one feathered pauldron. Form: four narrow light-wings, ring halo of separate motes, face hidden by a plain visor. | 5 |
| **Hollowhorn** (`hollowhorn`, new) | Demon line | Legendary | Signed for power and reads the small print daily. | *form* — Debt: fills when you spend HP and when you finish foes while under 35% HP (max 100). At full, become the Hollowhorn: fast melee, every skill costs HP and steals it back. Healing is halved in form. After: Owed (max HP −20%, 30 s). | Base: one cracked horn and an ink-black forearm. Form: lean horned figure, hollow chest with an ember inside, hooved, no wings. | 5 |
| **Thousandwing** (`thousandwing`, new) | Swarm line (original) | Legendary | Not one thing. A great many small ones. | *form* — Scatter: fills when you hit different foes in a short window (max 100). At full, dissolve into a moth swarm: single-target hits pass through you, area hits count double. After: Scattered (skills fire 0.3 s late, 8 s). | Base: moth-wing collar and dusted sleeves. Form: 40-60 moth sprites holding a loose hero silhouette, tinted by the last element used. | 5 |
| **Mountainborn** (`mountainborn`, new) | Mountain line (original) | Legendary | The mountain got up and walked. | *form* — Weight: fills while you stand still and from hits you soak (max 100). At full, become the Mountain: giant, cannot be moved or dodge, each step a quake; skills raise walls and open pits. After: Rubble (rooted 2 s; Weight fills half as fast, 20 s). | Base: slate shoulder slabs and gravel-grey skin on the arms. Form: 96 px stone giant with a hollow lantern-lit chest and moss on one shoulder. | 5 |
| **Starwrit** (`starwrit`, new) | Star line (original) | Legendary | Draws on the sky and the sky answers. | *form* — Starlight: fills when you alternate holy and shadow skills (max 100). At full, become the Starwrit: tap foes to link them as stars; closing a line, triangle or square sets off that shape. After: Daybreak (Starlight cannot fill, 20 s). | Base: a dark mantle pricked with small lights. Form: a body of deep blue night with bright star points at the joints, joined by thin lines. | 5 |

| Class | 5 class skills | Mastery passive | Discovered by |
|---|---|---|---|
| **Mimic** | Borrowed Roar* `nova·point·interrupt` · Bestial Chorus* `spin·ring·lure` · Parrot `counter·self·reposition` · Understudy `summon·target·none` · Mask Swap `buff·self·cleanse` | **Good Ear** — Signature moves need 1 fewer sighting to learn (never less than 1). | Learn 8 echoes. Trial. |
| **Manyroads** | First Road `strike·cut·haste` · Second Road `projectile·throw·expose` · Third Road `nova·point·mark` · Fourth Road `strike·kick·stun` · Crossroads `buff·self·crit` | **Well Travelled** — Changing weapon has no cooldown. | Secret deed. Hint: "Four roads meet where a traveller needs no stone." |
| **Wyrmsoul** | Tail Feint `strike·kick·knockback` · Scale Skin `shield·self·expose` · Wing Buffet `nova·ring·launch` · Hoard Sense `buff·self·leech` · Kindle Breath `strike·wave·none`<br>**Form bar:** Wyrm Breath `beam·line·none` · Tail Sweep `spin·ring·knockback` · Wingbeat Leap `blink·point·stun` · Hoard Roar `nova·ring·interrupt` · Skyfall `charge·point·launch` | **Old Blood** — Element pickups (Embers, Motes) heal you 2%. | Deed chain "Old Blood" (§9.4), then the Rite. 10 Sigils. |
| **Dawnwing** | Wardhand `shield·self·haste` · Feather Mark `projectile·bolt·mark` · Lift Up `mend·self·shield` · Hush of Wings `nova·ring·slow` · Bright Step `blink·point·heal`<br>**Form bar:** Judging Ray `beam·target·none` · Pinion Storm `rain·point·none` · Aegis Halo `orbit·self·shield` · Absolve `nova·ring·cleanse` · Ascend `blink·point·launch` | **Open Door** — Shields on you last 30% longer. | Deed chain "Kept Light" (§9.4), then the Rite. 10 Sigils. |
| **Hollowhorn** | Blood Price `buff·self·leech` · Horn Rush `dash·line·stun` · Sign Here `trap·ground·mark` · Collect `chain·nearest·leech` · Overdraw `nova·ring·execute`<br>**Form bar:** Rake `strike·claw·leech` · Hellstep `blink·target·slow` · Tithe `spin·ring·leech` · Brimstone Hoof `nova·ring·launch` · Foreclose `strike·claw·execute` | **Small Print** — Skills can be cast with HP when you lack the SP. | Deed chain "Three Bargains" (§9.4), then the Rite. 10 Sigils. |
| **Thousandwing** | Dust Wing `nova·ring·slow` · Flutter `blink·point·slow` · Lamp Lure `summon·ground·lure` · Mothbite `projectile·nearest·leech` · Cocoon `shield·self·heal`<br>**Form bar:** Pour Through `dash·line·none` · Split Swarm `summon·self·none` · Engulf `zone·target·slow` · Regather `nova·point·pull` · Eclipse of Wings `rain·ring·none` | **Many Small Lives** — Damage over 25% of your HP in one hit is cut by a fifth. | Deed chain "A Great Many" (§9.4), then the Rite. 10 Sigils. |
| **Mountainborn** | Brace `shield·self·slow` · Boulder Put `projectile·throw·knockback` · Fault Line `zone·line·slow` · Heavy Step `nova·ring·slow` · Keystone `buff·self·cleanse`<br>**Form bar:** Quake Step `nova·ring·launch` · Raise Ridge `wall·line·none` · Open Pit `trap·point·root` · Landslide Arm `strike·punch·knockback` · Summit `charge·point·none` | **Bedrock** — You cannot be knocked back. | Deed chain "Standing Stone" (§9.4), then the Rite. 10 Sigils. |
| **Starwrit** | First Star `projectile·bolt·mark` · Night Ink `zone·point·expose` · Wish `mend·self·haste` · Falling Star `nova·point·stun` · Sky Chart `buff·self·crit`<br>**Form bar:** Draw Line `tether·target·none` · Close Triangle `wall·target·root` · Close Square `rain·target·none` · Polestar `summon·point·lure` · Name the Sky `nova·ring·execute` | **Wishing Star** — Once per fight, the first killing blow against you leaves you at 1 HP. | Deed chain "Night Sky" (§9.4), then the Rite. 10 Sigils. |

**AUTO and each mechanic kind** (one line each; manual play keeps an edge):

| Mechanic | AUTO does | Manual edge |
|---|---|---|
| gauge | Spends at the class's `autoRule` threshold (default: at max). | Hold for elites; spend early to dodge a drawback. |
| combo | Plays the shortest legal sequence, never the best finisher. | Choose which skill lands as the finisher. |
| marks | Cashes in at max marks. | Cash in on the right target at the right time. |
| stance | Never swaps (auto-turning stances turn by themselves). | Swap mid-fight. |
| zone | Places at its feet or on the target, keeps `keep` objects up. | Place for geometry (walls, lines, pinball). |
| form | Takes the form at full meter unless the player set "Hold". | Save the form for wardens. |

**HUD:** one small widget above the class slots, the same place for every class: a bar (gauge), pips (combo, marks),
a two-sided icon (stance), a counter (zone objects) or the form meter. Its only label is the mechanic's name.

### 3.7 Classes kept, merged and retired

| Today | v4 | Notes |
|---|---|---|
| blademaster, pyroblade, windblade, magma_knight, ascendant, sword_saint, spellblade | same id | re-authored kit and mechanic |
| paladin ("Oathsworn"), runeknight ("Glyphwarden"), stormreaver ("Stormwhirl") | same id and name | sword × holy / earth / lightning |
| knife_juggler, shadowstalker, eclipse_walker | same id | |
| tempest_dancer | same id | now dagger × wind (was any-weapon spin) |
| assassin ("Nightblade") | same id, shown as **Hushblade** | renamed: "Nightblade" is another game's class name |
| arcanist | same id, shown as **Spellwright** | renamed: collides with well-known class names |
| archmage, pyromancer, stormcaller, earthshaper, twilight_sage, moonwarden | same id | |
| tidecaller | same id, shown as **Tidereader** | renamed: "Tidecaller" is a well-known character title |
| elementalist | same id, shown as **Prismcaller** | renamed: collides with a well-known profession name |
| wayfarer | same id | now the Bare Hands starter |
| mimic | same id | now Epic, any weapon |
| **phantom** | merged into `shadowstalker` | same clause as its parent today |
| **vortex_dancer** | merged into `tempest_dancer` | same |
| **prism_sage** | merged into `elementalist` | same |
| **echo_sovereign** | merged into `mimic` | echoes are no longer skills |

Existing skill ids reused as class skills (id and saved rank kept, behaviour re-authored): Measured Guard = `blade_aura`, Petalfall Edge = `sword_saint_sig`, Searing Edge = `searing_edge`, Runestone Slam = `runeknight_sig`, Squall Stride = `windblade_sig`, Thunderwheel = `stormreaver_sig`, Caldera Cleave = `magma_knight_sig`, Skyrend Verdict = `ascendant_sig`, Runic Blade = `runic_blade`, Eye of the Storm = `eye_of_the_storm`, Shade Cloak = `shade_cloak`, Totality = `eclipse_walker_sig`, Mana Surge = `mana_surge`, Sigilstorm = `archmage_sig`, Moonwake Ring = `moonwarden_sig`, Prism Burst = `prism_burst`, Refraction = `prism_sage_sig`, Borrowed Roar = `mimic_sig`, Bestial Chorus = `echo_sovereign_sig`.
`phantom_sig` (Wraithpass) and `vortex_dancer_sig` (Coiling Vortex) stay as ordinary learnable dagger skills: players
who know them keep them, and they become fusion results (`phantom_rush` + shadow, `blade_storm` + wind). Save migration for all of this is in §13.

**Until its phase arrives**, a surviving class that is not yet rebuilt runs on a **legacy kit**: 5 explicit ids
chosen from today's skills (its own signature first, then its narrowest matches), a `mechanic` of
`{ kind: 'combo', length: 3, distinct: true, finisher: +20% }`, its current bonus and no Gift yet
(`ClassDef.passive` is optional until Phase 4 ends, when no legacy kit may remain). Legacy kits obey the overlap
rule from Phase 1, so the 13 identical bars of today are gone in Phase 1 even for classes rebuilt later.
Classes that do not exist yet simply are not in the data until their phase.

### 3.8 Outfits

Each class keeps one `classLooks` entry (`docs/CLIENT-v3.md` §5) keyed by `ClassDef.look`, now drawn for **4 weapons** and
**3 facings** (§11.8). The outfit column above is the brief. Rules: the silhouette test (§11.8) must tell every class
of one weapon apart in solid black; rarity adds trim only (Rare: cape or mantle; Epic: aura motes; Legendary: a
separate form sprite; Mythic: one animated oddity), never bulk; one "moving part" per class reflects its mechanic
(Pyroblade's edge glow, Menhir's rock plates, Gloamhost's shadow arms) so the meter is readable on the body.

### 3.9 Originality rules for classes and skills

The owner's four flavour seeds are **inspiration for a feeling only**. Binding rules for names, looks and mechanics:

| Seed | We take | We never take |
|---|---|---|
| shadow + fists | a brawler sharing a body with something hungry | the word "symbiote", a toothed grinning face, a tongue, white eye-patches or chest emblem, tendril-web swinging, any character name |
| shadow + Rod | a quiet priest of an emptiness that gets into heads | "void", "insanity", "mind"-prefixed spell names, a form that drains faster the longer it is held, purple tentacle motifs |
| elements + daggers | planting things and setting them off with skill order | "jutsu", "mudra", hand-sign naming, headbands with plates, scroll summons, village or clan names |
| elements + swords | sword rhythm that releases an element | numbered "forms" or "breathing" styles, checkered or patterned haori, named sword styles, corps or rank names |

Name check done for this spec (class and skill names against well-known games and shows): renamed Nightblade →
Hushblade, Arcanist → Spellwright, Tidecaller → Tidereader, Elementalist → Prismcaller, Echo Blade → Wakeblade,
Mistveil → Mistknife, Emberheart → Feverfist, Umbral Host → Gloamhost, Crucible → Slagheart, Hundred Hands →
Drumroll; rejected skill names Flash Cut, Hearthstone, Homestone, Shadow Step, Voidform, Chidori-style names.
Generic RPG words kept on purpose (Blademaster, Archmage, Pyromancer, Sword Saint, Spellblade, Mimic). A
`tests/names.test.ts` banned-word list (the SPEC-v2 §9 list plus the "never take" column above) guards new data.
A human trademark search before release is still required; this pass was done from knowledge, not a search.

---

## 4. Mastery passives and Keepsakes

**Rule (player sentence):** *"A class's gift works while you are that class. Master the class and you can keep its
gift on any class."*

| Question | Decision |
|---|---|
| What is "the class passive"? | `ClassDef.passive`: one authored `PassiveDef` per class (the "Mastery passive" column of §3.6). It changes a rule, not just a number. |
| When does it work on its own class? | Always while worn, from Class Level 1, at full strength. It takes no slot. |
| When does it work on another class? | Only when the owning class is **mastered** (Class Level 10) **and** the passive is slotted as a Keepsake. |
| What is "mastered"? | `progress.rank >= CLASS.maxLevel` (10), for every rarity. |
| Keepsake slots | **1** at the first mastered class, **2** at 3 mastered, **3** at 6 mastered **[T]** (`CLASS.keepsakeSlotsAt = [1, 3, 6]`). |
| Limits | One Keepsake per source class. The worn class's own passive cannot also be slotted. At most one Keepsake per `trigger.when` (no two "on kill" gifts). A Keepsake that names a weapon works only with that weapon. |
| Changing them | In safe maps only, one tap per slot. |
| What never exports | The signature mechanic, the kit, the bonus. |
| Legendary and Mythic passives | Export like any other, cost the same one slot. |

### 4.1 Data model

```ts
export type TriggerWhen =
  | 'kill' | 'crit' | 'hitTaken' | 'firstHitOfFight' | 'nthHit' | 'afterDash' | 'afterStill' | 'afterIdleAttack'
  | 'lowHp' | 'statusEnds' | 'skillCast' | 'wouldDie' | 'always';
export type TriggerDo =
  | { heal: number } | { shield: number } | { freeCast: true } | { guaranteeCrit: true } | { repeat: number }
  | { burst: number } | { arc: number } | { status: StatusKind; ms: number } | { stat: PassiveStat; pct: number; ms: number }
  | { power: number; ms?: number } | { reflect: true } | { rule: string /* closed list of engine rules, e.g. 'noKnockback' */ };

export type PassiveEffect =
  | /* ...the 8 existing numeric kinds... */
  | { kind: 'trigger'; when: TriggerWhen; n?: number; ms?: number; hpBelow?: number; weapon?: WeaponType; do: TriggerDo; icdMs?: number };

export type PassiveSource = 'tag' | 'trainer' | 'class' | 'resonance' | 'keepsake' | 'bestiary' | 'deed';   // 'imprint' removed
export interface PassiveDef { /* ...existing... */ budget?: number; }      // worst-case damage points, <= 5 for class passives

// state.ts
interface SkillBookState { /* imprints: string[] is renamed */ keepsakes: string[]; }   // class ids
```

`passives.activePassives` reads: the worn class's passive (strength 1) + each slotted Keepsake whose class is mastered
(strength 1). `IMPRINT_STRENGTH`, `CLASS.imprintAt`, `imprintSlots()` and the templated `imprint_<class>` and
`cls_<class>_<n>` PassiveDefs are deleted. Passive totals are invalidated when a class reaches Level 10.

### 4.2 What replaces today's Keepsakes

Today a Keepsake is a templated "+2% tag damage" unlocked at Class Level 5 / 4 / 3. In v4 the word **Keepsake** stays
(same friendly name, same panel) but now means "a mastered class's passive". Migration (§13): Keepsakes slotted from
classes that are not at Level 10 are unslotted; each such class pays the player **2 Sigils** once, with one toast:
*"Keepsakes now come from mastered classes. You received 4 Sigils."* The Tamsin "imprint" quests are re-texted
(*"Reach Class Level 10 to master Blademaster and keep its gift."*) and their `state` objective moves from Class
Level 5 to 10; a save that already completed them keeps the completion.

---

## 5. Echoes become augments

**Rule (player sentence):** *"See a monster's signature move, defeat it, and its Echo is yours. Put an Echo on a
skill to change what the skill does."*

### 5.1 Decisions

| Question | Decision |
|---|---|
| What is an Echo now? | An `EchoDef`: a behaviour change socketed onto a skill. It is never a skill. |
| How is it learned? | Unchanged trigger, simpler finish: a monster starts its signature technique within 6 tiles → that monster is tagged; defeat it → **"Seen 1/3"**. At the last sighting the Echo is learned at once. The "anchor skill" rule and the `blocked` result are deleted. Never a random roll. |
| Sightings needed | Elites 3, the rare Moonmoth 5, common-monster techniques 5, wardens 1 (unchanged where they existed). |
| Sockets | **Every skill has 1 Echo socket**, separate from its Rune sockets (today's essence sockets: 1, or 2 after 3 Mastery bars). Buff-like skills (buff, mend, shield, blink without an arrival hit, wall) have 0 Rune sockets and 1 Echo socket that takes only Echoes listing their kind. Mimic class skills have 2 Echo sockets. Maximum on one skill: 2 Runes + 1 Echo. |
| Reuse | Learned once, kept forever, never consumed. **One Echo sits on one skill at a time**; tapping it on another skill moves it. |
| One tap | Skill card → Echo socket → a sheet of your Echoes (fitting ones first, others greyed with one reason: "Needs a throw") → tap. It is on. No confirm. Out of combat only. |
| Before / after line | Every Echo card shows exactly three lines from `EchoDef`: **Before**, **After**, **Cost**. Example: "Before: flies straight. After: curves toward the nearest foe. Cost: flies 30% slower." |
| Visible change | Each Echo adds its own VFX motif (§5.4) and a small monster pip on the skill icon. The skill keeps its name. |
| Growth | Echoes have ★ to ★★★. Raising one costs Dust (§7): ★★ 10, ★★★ 25 **[T]**. Stars change magnitude only, never behaviour. |
| Skill identity | An Echo does **not** create a variant id. Rank, Mastery bars and Runes belong to the skill; the Echo is an overlay (`state.echoOn`). This is what makes swapping free. |
| Runes vs Echoes | Runes change **how much** (more, wider, faster). Echoes change **what it does**. `tests/echo.test.ts` fails an Echo whose mod only changes numbers. |

### 5.2 Data model

```ts
export type EchoHook = 'cast' | 'path' | 'hit' | 'kill' | 'after';
export type EchoBehaviour =
  | { do: 'seek'; turnDeg: number } | { do: 'bounce'; times: number; mult: number } | { do: 'split'; copies: number; mult: number }
  | { do: 'lob' } | { do: 'phase' } | { do: 'rollOn'; stunMs: number } | { do: 'leapTo' } | { do: 'snapBack' } | { do: 'skyDive'; ring: number }
  | { do: 'leave'; object: string; lifeMs: number }                 // pool, cloud, spikes, trail (a placed zone object)
  | { do: 'brand'; delayMs: number; share: number } | { do: 'stackStatus'; status: StatusKind; stacks: number; lockMs: number }
  | { do: 'quills'; at: number } | { do: 'root'; ms: number; lockMs: number } | { do: 'bubble'; ms: number } | { do: 'lure'; ms: number }
  | { do: 'tetherPair'; ms: number; share: number } | { do: 'aftershock'; delayMs: number; radiusMul: number; mult: number }
  | { do: 'mirrorSide'; delayMs: number; mult: number } | { do: 'interrupt' }
  | { do: 'onKillBurst'; shards: number; mult: number } | { do: 'onKillSwarm'; count: number; mult: number }
  | { do: 'hatch'; lifeMs: number; max: number } | { do: 'thorns'; ms: number; mult: number };

export interface EchoDef {
  id: string;                    // the old echo skill id where one existed
  name: string; icon: string;
  teacher: string;               // MonsterDef id
  technique: string;             // the monster-only SkillDef the teacher casts
  marks: number;
  hook: EchoHook;                // two Echoes never share a skill, so the hook is informational + for tests
  appliesTo: ShapeKind[];
  behaviour: EchoBehaviour;      // values are the ★ numbers; `scale` gives ★★ / ★★★
  scale: [number, number];       // multiplier on the behaviour's magnitude at ★★ and ★★★ (default [1.25, 1.5])
  cost: { powerMul?: number; spMul?: number; cdMul?: number; note?: string };   // the drawback, always present
  before: string; after: string; costLine: string;                               // card lines, each <= 60 characters
  warden?: boolean;              // "signature Echo": gold pip
}

export interface MonsterTechnique { /* ... */ echo?: { id: string; marks: number }; }   // was { marks }
export type IngredientRef = string;   // adds `echo:<id>`: must be known, never consumed, no rank needed
export type Requirement = /* ... */ | { type: 'witness'; echo: string; count: number };   // `skill` renamed `echo`

// state.ts (v3)
interface SkillBookState {
  echoes: Record<string, { stars: 1 | 2 | 3; learnedAt: number }>;
  echoOn: Record<string /* skill id on which it sits */, string /* echo id */>;
  witness: Record<string /* echo id */, number>;
}
```

`compose.applyEcho(skill, echo, stars)` returns the effective SkillDef for the runtime (cached by `id^echo^stars`;
that key is never saved and never a skill id). It applies `cost`, sets `skill.echo = { id, behaviour }` and runs the
SPEC-v2 hit clamp and the ±35% damage-per-SP band (the budget test adds "every skill × every Echo that fits it").
`SkillBook` API: `echoes()`, `echoFor(skillId)`, `canSetEcho(skillId, echoId) → { ok, reason }`,
`setEcho(skillId, echoId | null)`, `raiseEcho(echoId)`; events `echo` (learned), `echoSet`, `echoRaised`.

### 5.3 The Echo list (27)

Kinds are §6 kinds. "All attacks" = every damaging kind. Phase 2 ships all 27. An Echo may list a kind that
only exists from Phase 3 (orbit, rain, beam, charge); it simply fits more skills once that kind ships.

| Echo (id) | Teacher | Seen | Fits | Before → After | Cost |
|---|---|---|---|---|---|
| **Bounce** (`jelly_slam`) | Jellop Monarch | 3 | nova, strike, dash, rain | Lands once. → Bounces on 2 tiles and lands again at 50%. | Cooldown +20% |
| **Bubble** (`bubble_lance`) | Brinewisp | 3 | projectile, chain, beam | Hits and passes. → First foe is lifted in a bubble for 1.5 s, then it pops and soaks its neighbours. | No pierce |
| **Quills** (`gale_feather`) | Galeplume | 3 | projectile, strike, spin, orbit | Just hits. → Each hit sticks a quill; the 3rd quill bursts and knocks the foe back. | Damage −10% |
| **Rolling** (`boulder_roll`) | Boulderback | 3 | dash, projectile | Stops at its range. → Keeps rolling to the wall, pushing foes along; they are stunned on the wall. | 0.3 s wind-up; you cannot steer |
| **Geode** (`geode_spikes`) | Geode Sentinel | 3 | nova, zone, trap, rain | Blast and gone. → Leaves crystal spikes for 4 s that block and cut foes. | Damage −20% |
| **Spore Cloud** (`spore_burst`) | Gloomcap Matriarch | 3 | spin, nova, strike, zone | No trace. → Leaves a poison cloud for 4 s. | Damage −15% |
| **Grave Grip** (`grave_chill`) | Crypt Keeper | 3 | projectile, strike, chain, trap | Hits. → Hands hold the first foe in place for 2 s. | Damage −10%; a foe is held once per 6 s |
| **Pounce** (`ember_pounce`) | Emberkit Alpha | 3 | strike, projectile, chain, tether | You stay put. → You leap to the first foe hit. | 0.3 s landing |
| **Static Brand** (`static_charge`) | Voltmane | 3 | all attacks | All damage now. → 40% of it waits, then strikes every branded foe as a bolt 2 s later. | That 40% is late |
| **Moondust** (`lunar_dust`) | Moonmoth | 5 | nova, spin, zone, buff, shield | Foes act as they like. → Foes touched drift toward you for 3 s like moths. | They arrive able to hit you |
| **Aftershock** (`tremor_stomp`, signature) | Ironroot Colossus | 1 | nova, strike, dash, charge | One ring. → A second ring twice as wide follows 0.8 s later at 50%. | SP +30% |
| **Other Side** (`umbral_rend`, signature) | Hollow Regent | 1 | strike, dash, spin, blink | You hit from the front. → Your shadow repeats it from behind the target 0.5 s later at 50%. | SP +30% |
| **Thunderclap** (`thunder_stomp`, signature) | Thunderhoof | 1 | nova, spin, strike, counter | Damage only. → Stops enemy wind-ups in reach. | Damage −20% |
| **Rime** (`rime_breath`) | Glacier Matron | 3 | all attacks | No chill. → Each hit chills; 4 chills freeze for 1.5 s. | A foe freezes once per 8 s |
| **Magma Pool** (`magma_spit`) | Magma Brute | 3 | projectile, nova, dash, rain | No trace. → Leaves a burning pool for 4 s. | The pool burns you too, at 25% |
| **Skydive** (`storm_dive`) | Tempest Drake | 3 | dash, blink | You run the line. → You rise out of reach and land at the end with a shock ring. | Nothing on the path is hit |
| **Dusk Leash** (`dusk_lash`) | Dusk Sovereign | 3 | strike, projectile, chain, tether | Foes are separate. → The first two foes hit are leashed for 4 s and share half their damage. | Nothing against a lone foe |
| **Splash** (`mon_water_spit`) | Puddlewisp | 5 | projectile, chain, strike | One target. → On hit it splits into 2 small copies that fly to nearby foes at 40%. | No split against a lone foe |
| **Seeking** (`mon_gust`) | Gustling | 5 | projectile, chain, orbit | Flies straight. → Curves toward the nearest foe. | Flies 30% slower; no pierce |
| **Spark Swarm** (`mon_zap`) | Sparkbug | 5 | all attacks | Nothing on a kill. → A foe it defeats bursts into 3 seeking sparks. | Nothing against wardens |
| **Sporeling** (`mon_spore_puff`) | Gloomcap | 5 | projectile, strike, chain | Just hits. → Plants a spore that hatches in 3 s into a biter clinging to that foe for 6 s (max 3). | The spore dies if the foe dies first |
| **Phase** (`mon_wail`) | Cairn Wraith | 5 | projectile, dash, beam | Stops at walls. → Passes through walls and foes and hits again on the way back. | Cannot crit |
| **Ember Trail** (`mon_ember_spit`) | Ashfly | 5 | dash, projectile, spin, blink | No trace. → Leaves a burning trail along its path. | Standing in it burns you |
| **Snapback** (`mon_rift_lunge`) | Rift Stalker | 5 | dash, strike, blink | You end where it ends. → After the skill you snap back to where you cast it. | Cooldown +15% |
| **Shatterburst** (`mon_frost_shard`) | Frostling | 5 | all attacks | Nothing on a kill. → A foe it defeats bursts into 5 ice shards. | Shards only on a kill |
| **Lob** (`mon_magma_glob`) | Cinder Toad | 5 | projectile, summon, trap | Flies flat. → Arcs over foes and obstacles and lands on the spot you chose. | 0.5 s in the air |
| **Thorns** (`mon_thorn_volley`) | Gloamthorn | 5 | buff, shield, spin, dash, mend, counter | Nothing after. → For 3 s after casting, foes that hit you take a spike burst. | Cooldown +20% |

`mon_zap` is cast by three species; only Sparkbug teaches it. Guard rails (`Registry.validate`): every Echo has a
teacher that is spawned on some map, a non-empty cost, at least 3 kinds in `appliesTo`, and card lines ≤ 60
characters; buff-like kinds have at least 2 Echoes that fit them.

### 5.4 What happens to everything that referenced echo skills

| Today | v4 |
|---|---|
| 17 echo SkillDefs (`skills/echoes.ts`, tag `echo`) | Moved to `skills/monster.ts`, tag `monster`, `echo` tag removed. Monsters still cast them. Players can no longer learn or own them. |
| 18 fusion recipes with an echo skill ingredient | The ingredient becomes `echo:<id>` (must be known, not consumed). Results unchanged, so `rockslide_charge`, `undertow_orb`, `quakestride` and the rest stay obtainable. Their own rank requirement on the echo is dropped. |
| Morph `jelly_slam → crown_slam` | Becomes recipe `skill:rising_kick + echo:jelly_slam → skill:crown_slam`. |
| Classes `mimic`, `echo_sovereign` | §3.7: Mimic is rebuilt around Echo sockets; Echo Sovereign merges into it. Mimic's discovery counts Echoes known. |
| Tag passive `tag_echo`, `HYBRID_TAGS` entry `echo` | Deleted. `TAG_PASSIVE_TAGS` swaps `echo` for `fist`. |
| Quest `miner_gus_stand_in_its_way` (witness Boulder Roll ×3) | Unchanged in text and data: the objective counts sightings of Echo `boulder_roll` and is met once the Echo is known. |
| Reachability test "an echo technique of a spawned monster" | Now checks Echo reachability instead. |
| VFX "echo overlays" (VFX.md §6.3) | Become per-Echo motifs keyed by `EchoBehaviour.do` (§15, VFX lane). |
| Saves | §13: each known echo skill becomes a learned Echo; its stars come from its rank; bar slots are cleared and refilled; variants and merges built on echo skills are removed and their Runes and Motes refunded. |

---

## 6. Many more spells, all different

### 6.1 New skill kinds (cheapest first)

Today: 7 shape kinds. v4: 20. All new kinds reuse the existing hit test with a timer, an attached entity or a placed
object. Placed things (zones, traps, summons, walls, class objects) share one entity, `WorldObject`, capped at
**12 player objects [T]** at once (oldest expires first).

```ts
export type SkillShape =
  | /* strike, spin, projectile, dash, nova, chain, buff: unchanged */
  | { kind: 'zone';   radius: number; range: number; durationMs: number; tickMs: number; line?: { length: number }; follow?: boolean }
  | { kind: 'blink';  distance: number; to: 'point' | 'target' | 'self' | 'object'; arrive?: { radius: number } }
  | { kind: 'mend';   pct: number; overMs?: number; radius?: number }                 // pct of max HP
  | { kind: 'shield'; pct: number; durationMs: number; burst?: { radius: number } }
  | { kind: 'trap';   radius: number; range: number; armMs: number; lifeMs: number; count?: number; line?: { length: number } }
  | { kind: 'tether'; range: number; durationMs: number; tickMs: number; breakAt: number }
  | { kind: 'summon'; object: string; count?: number; lifeMs: number; range: number }  // static: decoy, totem, node, chime
  | { kind: 'counter'; windowMs: number; reply: 'strike' | 'nova' | 'none'; range?: number }
  | { kind: 'orbit';  count: number; radius: number; durationMs: number; hitEveryMs: number }
  | { kind: 'rain';   radius: number; range: number; drops: number; overMs: number }
  | { kind: 'beam';   length: number; width: number; channelMs: number; tickMs: number }
  | { kind: 'charge'; stages: 2 | 3; stageMs: number; release: 'strike' | 'projectile' | 'nova'; grow: number }
  | { kind: 'wall';   length: number; range: number; lifeMs: number };
```

| # | Kind | What the player sees | AUTO uses it when | Rune fits | Hits for the clamp | Phase |
|---|---|---|---|---|---|---|
| 1 | zone | A field that stays and ticks | 2+ foes would stand in it; never two of the same up | expanse, haste, leech | duration ÷ tick, max 8 | 1 |
| 2 | blink | You vanish and appear | Target is out of reach, or you are surrounded | — (Echo only) | arrival 1 | 1 |
| 3 | mend | You heal | Below 60% HP | — | 0 | 1 |
| 4 | shield | A shell soaks hits, may burst | A wind-up is aimed at you, or before a pack | — | burst 1 | 1 |
| 5 | trap | A thing on the ground waits | Between you and the nearest foe, max `count` | expanse, reprise, leech | 1 | 2 |
| 6 | tether | A line links you to a foe | Target is an elite or warden | haste, leech | duration ÷ tick, max 8 | 2 |
| 7 | summon | A decoy, totem or node stands there | None of its kind is up | — | 0 | 2 |
| 8 | counter | A short guard, then an answer | A wind-up will land within the window (AUTO: 70% of the time **[T]**) | heavy | reply 1 | 2 |
| 9 | orbit | Things circle you | It is not up and foes are within 3 tiles | expanse, haste | count × duration ÷ hitEvery, max 12 | 3 |
| 10 | rain | Many small hits fall on an area | 3+ foes in the area, or a held target | expanse, reprise, leech | drops, max 12 | 3 |
| 11 | beam | A held line that ticks | Target in line and nothing in melee | haste, leech | channel ÷ tick, max 10 | 3 |
| 12 | charge | Hold to grow, release | AUTO releases at stage 2 | heavy, expanse | 1 | 3 |
| 13 | wall | A barrier | Ranged foes outnumber melee, or below 40% HP | — | 0 | 4 |

Roaming allies (pets with their own pathing) are **out of v4**; every `summon` is static or follows a fixed rule
(the Lodger stands and swings; the Understudy copies its target's basic attack).

New statuses (`StatusKind` gains `'root' | 'launch' | 'expose' | 'lure'`): **root** (cannot move, can act),
**launch** (airborne 1.2 s, helpless, takes a landing hit), **expose** (takes +15% for 4 s **[T]**), **lure**
(walks toward the source). Wardens: root and launch become a 40% slow; lure is ignored.
`SkillDef` also gains `hpCost?: number` (percent of max HP; Hollowhorn and a few sacrifice skills).

### 6.2 The four fields every skill declares

```ts
export type Delivery = 'cut' | 'thrust' | 'punch' | 'kick' | 'claw' | 'wave' | 'throw' | 'bolt'
                     | 'point' | 'ring' | 'line' | 'path' | 'self' | 'target' | 'nearest' | 'ground';
export type SkillExtra = StatusKind /* incl. the 4 new */ | 'mark' | 'heal' | 'shield' | 'haste' | 'leech' | 'reposition'
                       | 'interrupt' | 'execute' | 'crit' | 'cleanse' | 'none';
export interface SkillDef { /* ... */ delivery: Delivery; extra?: SkillExtra; }   // `extra` supersedes `status` for the test; `status` stays for statuses
```

| Field | Values | Notes |
|---|---|---|
| kind | the 20 shape kinds | |
| element | none + the 11 elements | A skill that takes any element (Prismcaller, Wyrm form) counts as its own pseudo-element. |
| delivery | 16 values above | How it reaches the foe. `cut` sword arc, `thrust` dagger point, `punch` / `kick` / `claw` body, `wave` a travelling arc, `throw` a thrown object, `bolt` a magic missile, `point` a chosen spot, `ring` around you, `line` a straight lane from you, `path` along your own movement, `self`, `target` a chosen foe, `nearest` picks its own target, `ground` an existing placed object or spot under you. |
| extra | 26 values above | The one effect **beyond the element's own status** (fire already burns; `extra: 'burn'` on a fire skill counts as `none`). |

### 6.3 The distinctness rule and its test

**Rule:** no two player skills share `kind + element + delivery + extra`.

`tests/distinct.test.ts` (content lane, no waivers) builds the signature of every authored player skill (everything
except tag `monster`) and fails on:
1. two skills with the same four-field signature (tier-0 basics included; they differ by delivery);
2. two skills **in the same weapon tree or the same class kit** with the same `kind + delivery + extra`, whatever
   their element;
3. a Transform whose result has the same signature as its parent;
4. two skills of the same kind and element whose every numeric shape parameter and power are within ±20% (the audit's
   "tight pair" check, kept as a second net);
5. a buff whose only effect is "+X% of one stat" when another buff already raises that stat (at most one plain buff
   per stat: Focus MATK, Rally Cry ATK, Quicken speed, Meditation regen; every other buff must do something else).

The 325 class skills of §3.6, the Bare Hands tree, the deed trees of §8.4 and the examples of §6.5 were checked
against rule 1 while this spec was written (script, 0 collisions). Today's 133 remaining player skills are **not**
yet clean: §6.4 fixes the known offenders and the test finds the rest in Phase 1.

### 6.4 Re-authoring today's near-duplicates (ids kept, so saves keep ranks)

| Cluster in the audit | Skill | Becomes | New signature |
|---|---|---|---|
| 3-pulse spins ×6 | `flame_spin` | unchanged, the reference spin | `spin·fire·ring·none` |
| | `arcane_cyclone` | Blades of force circle you for 6 s and tug foes inward | `orbit·none·self·pull` |
| | `static_field` | A crackling field that stays around you for 5 s | `zone·lightning·self·none` |
| | `tidal_ripple` | One wide ring that rolls out, then drags foes back | `nova·water·ring·pull` |
| | `thunder_peal` | Three claps that stop wind-ups | `nova·lightning·ring·interrupt` |
| | `stormreaver_sig` | Stormwhirl class skill Thunderwheel (§3.6) | class |
| 5-pulse pull spins | `firestorm` | A fire vortex that travels forward on its own | `zone·fire·path·pull` |
| | `eye_of_the_storm` | Tempest Dancer class skill (stays the pull spin) | class |
| slow novas | `smoke_veil` | unchanged | `nova·none·point·slow` |
| | `gloom_shroud` | A shadow snare that waits, then slows and bleeds | `trap·shadow·ground·slow` |
| | `moonveil` | Moon-smoke around you; you are unseen inside | `zone·holy·self·none` |
| mid/long dashes ×8 | `shadowstep` | unchanged, the reference step | `dash·none·path·none` |
| | `phantom_rush` | Leaves an afterimage that draws foes | `dash·none·path·lure` |
| | `cinder_blink` | A true blink: embers burst where you left and where you land | `blink·fire·point·knockback` |
| | `ashen_pounce` | Leap at one foe; loves to crit | `dash·fire·target·crit` |
| | `flare_dash` | unchanged (leaves a fire trail) | `dash·fire·path·none` |
| | `windblade_sig` | Windblade class skill Squall Stride | class |
| single-shot bolts | `firebolt` | unchanged | `projectile·fire·bolt·none` |
| | `holy_light` | Heals you on hit (already does); bolt is slower and larger | `projectile·holy·bolt·heal` |
| pierce-all orbs | `arcane_orb` | unchanged | `projectile·none·bolt·none` |
| | `glacial_orb` | Drifts to a spot, stops and pulses cold | `summon·ice·point·slow` |
| | `spirit_crescent` | A wave of force that shoves foes back | `projectile·none·wave·knockback` |
| 3-beam prisms | `prism_orb` | Three beams that love to crit | `projectile·none·bolt·crit` |
| | `dawn_prism` | One held beam of dawnlight that heals you | `beam·holy·line·heal` |
| | `prism_sage_sig` | Prismcaller class skill Refraction | class |
| targeted novas ×11 | `arcane_nova`, `meteor`, `quake` | unchanged (none / fire / earth) | `nova·…·point·none` |
| | `thunderstorm` (Squall Cell) | A cell that rains strikes for 3 s | `rain·storm·point·none` |
| | `crystal_mallet` | Thrown hammer; spikes hold what it hits | `projectile·earth·throw·root` |
| | `earthsplitter` | A fissure runs in a line from your blade | `nova·earth·line·none` |
| | `runeknight_sig`, `ascendant_sig` | class skills | class |
| narrow strikes ×6 | `backstab` | Bonus from behind stays | `strike·none·thrust·crit` |
| | `umbral_strike` | Step out of the target's shadow and strike | `blink·shadow·target·crit` |
| | `guillotine` | Hold the blade overhead, then release; hits harder the lower the foe's HP | `charge·none·cut·execute` |
| | `assassinate` | Hold to aim, release | `charge·none·thrust·execute` |
| | `palm_strike` | A short line of force that lands a step beyond your hand | `strike·none·line·none` |
| wide sweeps | `tidal_crescent` | A wave that drags foes back toward you | `strike·water·wave·pull` |
| 3-pulse slows | `resonant_pulse` | unchanged | `spin·none·ring·slow` |
| | `moonwarden_sig` | Moonwarden class skill (holy) | class |
| plain buffs ×13 | `focus`, `rally_cry`, `quicken`, `meditation` | unchanged: the one plain buff per stat (rule 5) | differ by stat; exempt from rule 1 among themselves |
| | `arcane_ward` | A real shield; foes that strike it are slowed | `shield·none·self·slow` |
| | `halo_ward` | A ward circle on the ground that shields you while you stand in it | `zone·holy·ground·shield` |
| | `astral_form` | You float: ground effects miss you and your spells pierce | `buff·none·self·reposition` |
| | `sanctuary` | A resting circle: a strong heal where you stand | `mend·holy·ground·none` |
| | `mending_light` | A direct heal over 6 s | `mend·holy·self·none` |
| | `blade_aura`, `searing_edge`, `shade_cloak`, `mana_surge` | class skills (§3.6) | class |

Working method: the test names a clash and the newer or less central skill moves. Several rows above already moved
this way while the spec was checked (`arcane_ward`, `halo_ward`, `sanctuary`, `guillotine`, `palm_strike`). Phase 1
content lane finishes this table for all 133 skills; the test is the acceptance check, not this list.

### 6.5 New kinds: example skills per weapon

These are new **tree and fusion** skills (not class skills). Each weapon gets one per kind, so every player meets
every kind. Bound skills name their weapon's grip; elemental ones are fusion results.

| Kind | Sword | Dagger | Rod | Bare Hands |
|---|---|---|---|---|
| zone | **Scored Ground** `zone·none·line·bleed` | **Tar Flask** `zone·none·point·expose` | **Frost Garden** `zone·ice·ground·slow` | **Dust Cloud** `zone·earth·ring·slow` |
| blink | **Crossing Cut** `blink·none·target·bleed` | **Backtrack** `blink·none·self·crit` | **Rift Stride** `blink·none·point·knockback` | **Step Inside** `blink·none·target·knockback` |
| mend | **Whetstone Rest** `mend·none·self·crit` | **Field Stitch** `mend·none·self·leech` | **Healing Spring** `mend·water·ground·none` | **Deep Breath** `mend·wind·self·haste` |
| shield | **Parrying Wall** `shield·none·self·knockback` | **Smoke Cloak** `shield·none·self·reposition` | **Glass Ward** `shield·none·self·interrupt` | **Flinch** `shield·none·self·stun` |
| trap | **Planted Blade** `trap·none·ground·bleed` | **Needle Snare** `trap·none·ground·poison` | **Rune Mine** `trap·none·ground·knockback` | **Trip Line** `trap·none·line·stun` |
| tether | **Chain Leash** `tether·none·target·pull` | **Garrote Wire** `tether·none·target·bleed` | **Soul Thread** `tether·shadow·target·slow` | **Clinch** `tether·none·target·stun` |
| summon | **Standing Blade** `summon·none·ground·none` | **Straw Double** `summon·none·point·lure` | **Watching Eye** `summon·none·point·mark` | **Training Post** `summon·none·ground·knockback` |
| counter | **Turned Edge** `counter·none·self·bleed` | **Slip** `counter·none·self·crit` | **Mirror Word** `counter·none·self·knockback` | **Catch** `counter·none·self·pull` |
| orbit | **Circling Blades** `orbit·none·self·bleed` | **Knife Halo** `orbit·none·self·crit` | **Moon Motes** `orbit·holy·self·none` | **Dervish Stones** `orbit·earth·self·none` |
| rain | **Falling Steel** `rain·none·point·none` | **Needle Rain** `rain·none·point·poison` | **Hail Cell** `rain·ice·point·slow` | **Gravel Toss** `rain·earth·ring·none` |
| beam | **Long Edge** `beam·none·line·bleed` | **Thread the Needle** `beam·none·line·crit` | **Sun Lance** `beam·holy·line·none` | **Breath of Coals** `beam·fire·line·none` |
| charge | **Rising Draw** `charge·none·cut·launch` | **Coiled Spring** `charge·none·thrust·crit` | **Gathering Storm** `charge·storm·point·none` | **Wound-Up Fist** `charge·none·punch·knockback` |
| wall | **Blade Fence** `wall·none·line·bleed` | **Smoke Curtain** `wall·none·line·slow` | **Ice Wall** `wall·ice·line·none` | **Stone Kick** `wall·earth·line·none` |

How they are learned: the 13-node weapon trees keep their shape, so these are **fusion results** (weapon skill +
weapon skill, or weapon skill + element) and **deed or quest rewards**. Each is authored with its recipe in the
phase that ships its kind (§6.1) and costs Motes like any first-time fusion (§7.4).

### 6.6 Spell count

| Group | Today | v4 |
|---|---|---|
| Weapon trees (4 × 13) | 39 | 52 |
| Fusion, cross-weapon, universal, techniques | 90 (incl. 17 echoes) | 75 kept (73 + 2 old signatures) + 52 new-kind examples = 127 |
| Class skills (kits + form bars) | 21 signatures | 325 (19 reuse an existing id) |
| Deed trees (§8.4) + deed skills | 0 | 17 |
| **Player skills** | **150** | **≈ 520**, every one with a unique signature |

---

## 7. Monster materials

**Rule (player sentence):** *"Every monster drops one kind of material, and every material feeds one thing."*

### 7.1 Data model

```ts
export type MaterialId = 'fang' | 'mote' | 'core' | 'sap' | 'dust' | 'sigil';
export const FAMILY_MATERIAL: Readonly<Record<Family, MaterialId>> = {
  beast: 'fang', wyrm: 'fang', sprite: 'mote', swarm: 'mote', construct: 'core', sylvan: 'sap', revenant: 'dust', fiend: 'dust' };
export interface MonsterDef { /* ... */ material?: MaterialId; }      // override; default FAMILY_MATERIAL[family]

// state.ts (v3)
interface SkillBookState {
  pouch: Record<MaterialId, number>;                 // counters, cap 9,999 each
  matPity: Record<string, number>;                   // misses in a row, keyed by material ('fang') or 'sigil:<species>'
  weaponLevel: Record<WeaponType, number>;           // 0..5
}
export type Requirement = /* ... */ | { type: 'material'; id: MaterialId; count: number };
```
Materials are **not** `ItemDef`s and never enter the bag. Costs are spent through one function,
`SkillBook.spendMaterials(cost)`, used by fusion, Transforms, sockets, Echo stars, Trials and upgrades. Rolls use the
book's seeded RNG stream (`rng:materials`), never `Math.random`.

### 7.2 The six materials

| Material | Dropped by (families) | First source | Feeds (one named system) | Where it is spent |
|---|---|---|---|---|
| **Fangs** | beast, wyrm | Emberkit (Cinder Fields) | **Weapon upgrades** | Brann, Vey |
| **Motes** | sprite, swarm | Jellop (Greenmeadow) | **Fusion** | Fusion Altars |
| **Cores** | construct | Cragling (Quarry) | **Runes and Rune sockets** | Brann, Korrin |
| **Sap** | sylvan | Pipsprout (Greenmeadow) | **Transforms** | the skill card |
| **Dust** | revenant, fiend | Hollowshade (Gloomwood) | **Echo stars** | the Echo card |
| **Sigils** | every elite and warden | Jellop Monarch | **Class Trials and Legendary Rites** | Tamsin, Ione |

### 7.3 Drops and pity (`MATERIALS` constants, all **[T]**)

| Source | Chance | Amount | Pity |
|---|---|---|---|
| Common monster | 40% | 1 | Each miss adds the base chance again: 40%, 80%, 100%. Never more than 2 dry kills. |
| Elite | 100% | 3 of its family material | — |
| Warden | 100% | 8 of its family material | — |
| Elite — Sigil | 100% on the first kill of that species, then 20% | 1 | Same adding rule: certain by the 5th repeat kill. |
| Warden — Sigil | 100% | 3 on the first kill, 1 on every later kill | — |
| A monster "too weak to learn from" | half the chance above | | pity still counts |
| Bestiary 10 / 25 / 100 kills of a species | — | +5 / +10 / +25 of its material | fixed, guaranteed |

- **Swap:** Waykeepers trade 4 of any material for 1 of another. Sigils cannot be bought or swapped.
- Drops fly to the player (no pickup tap) and stack into one toast: "Fangs ×3".
- Existing drops are untouched: coins, EXP, the species' Rune (3%, certain by the 25th kill), tomes, shards,
  relics, and the gather-item drops quests already use.
- Small fixes carried with this system: Waykeepers **sell** Healing Draught, Mana Draught (25 coins) and Waystone
  Shard (40 coins) — today nothing sells them; `umbral_spore` gets its first sink (§8.4: Shade Arts Transforms).

### 7.4 Sinks (exact costs, all **[T]**)

| System | Action | Cost |
|---|---|---|
| Weapon upgrades | Level +1 … +5 of one weapon (Bare Hands: Hand Wraps). Each level: +6% of that weapon's ATK and MATK. | Fangs 8 / 16 / 30 / 50 / 80 + coins 80 / 160 / 320 / 600 / 1,000 |
| Fusion | First time you make an authored result of tier 1 / 2 / 3 | Motes 3 / 6 / 12 |
| | First time you infuse a given skill with a given element | Motes 2 |
| | First time you make a given shape merge | Motes 5 |
| | Anything you have made before; any failed attempt | free |
| Runes | Craft a Rune you have held at least once | Cores 8 + 50 coins |
| | Open a skill's 2nd Rune socket early (otherwise free at 3 Mastery bars) | Cores 20 |
| | Take a Rune back out of a skill | Cores 4 |
| Transforms | Tier 1 / 2 / 3 Transform (on top of today's requirements) | Sap 0 / 5 / 15 |
| Echoes | Raise an Echo to ★★ / ★★★ | Dust 10 / 25 |
| Class Trials | Begin a Rare / Epic Trial | Sigils 2 / 5 |
| Legendary Rites | Begin a Rite | Sigils 10 |

Pacing targets **[T]**: first weapon upgrade about 15 minutes after reaching Cinder Fields; a tier-2 Transform about
10 minutes of hunting sylvans; an Echo at ★★★ about an hour of ordinary play. Every button that spends a material
shows "have / need" on itself; the player never opens the Pouch to find out.

### 7.5 Bestiary card (one screen per monster)

```
[sprite]  Cragling          Construct · Earth        Kills 37   ★★☆
ECHO      —                                           (elites: "Rolling — Seen 2/3")
DROPS     Cores (about 1 in 2)      →  Runes and Rune sockets      [Brann]
          Heavy Rune (rare)         →  Rune socket
          Iron Ore (sometimes)      →  Quests
FOUND IN  Greystone Quarry · Quarry Depths
WEAK TO   Fire          RESISTS  Earth
```
- Reveal with kills: 1 kill name and family; 5 kills drops; 10 kills "what it is for"; 25 kills chances in words
  ("about 1 in 2", "rare"), never percentages.
- Every "what it is for" is a link to the screen that spends it.
- Reverse lookup: on any cost, tapping a material you lack lists the nearest monsters that drop it.

---

## 8. Deeds

**Rule (player sentence):** *"Do something often enough and the world teaches you something for it."*

### 8.1 Data model (`src/core/types.ts`, engine `src/core/deeds.ts`, data `src/data/deeds.ts`)

```ts
export type DeedGrant =
  | { tree: string; node: number }          // unlocks a node of a deed tree (§8.4)
  | { skill: string } | { passive: string } | { echo: string }
  | { whisper: string }                     // reveals a class silhouette and hint
  | { materials: Partial<Record<MaterialId, number>> } | { title: string } | { flag: string } | { keepsakeSlot: true };

export interface DeedDef {
  id: string;
  name: string;                             // shown once earned
  counter: string;                          // a flag id the game increments with book.incFlag
  distinct?: boolean;                       // the counter is a count of different things (maps, elites, NPCs)
  tiers: { at: number; grant: DeedGrant[] }[];        // 1 to 3 tiers
  hint: [string, string];                   // [riddle, sharper line shown from 50% of the next tier]
  secret?: boolean;                         // no row in the Codex until the first count
  manualOnly?: boolean;                     // counts only when AUTO is off
}
export type Requirement = /* ... */ | { type: 'deed'; id: string; tier?: number };

// state.ts (v3)
interface SkillBookState { deeds: Record<string, number /* tiers reached */>; titles: string[]; title: string | null; }
```

**Engine.** Counters stay plain flags (`state.flags`), so every existing counter works unchanged. `incFlag(id, n)`
looks the flag up in a registry index `counter → deeds`; for each deed whose next tier is now met it applies the
grants, records `state.deeds[id]`, emits `deed`, and re-runs class discovery when a class reads that deed. Nothing
runs per frame. Grants are idempotent (a skill already known pays 5 Motes instead **[T]**).
All counting rules (caps, filters, anti-farm) live at the **call site that increments the flag**, listed in §8.3, so
the core stays a pure "counter → grant" table.

### 8.2 Hints that do not spoil

| Layer | What the player sees | When |
|---|---|---|
| 1. A tell | One toast, in-world, never a number: "The dark is starting to recognise you." | At 50% of the next tier, once |
| 2. Codex → Deeds | A row with a silhouette icon and the riddle; the sharper line replaces it at 50%; a progress bar (no number) appears at 75%; the name and grant appear when earned | Row exists from the first count (secret deeds) or from the start (others) |
| 3. Tamsin | "Rumour — 50 coins": one plain sentence about the deed closest to done. One per day. | Always |

"A day" anywhere in this spec is **20 minutes of play on the game clock [T]** (`book.now`), never the real calendar.

### 8.3 Anti-farm rules (binding on the counting code)

1. **Deaths** count only when the killer is not "too weak to learn from", outside safe maps, at most 2 per 10
   minutes, and never twice in a row from the same monster instance. Dying still costs 5% EXP.
2. **Return trips** count only when the Return Stone carries you at least one map, and you have earned EXP since the
   last counted trip.
3. **Volume deeds** (kills, hits taken, gathering) count on AUTO. **Skill deeds** are `manualOnly`.
4. **Count different things** where the deed allows (`distinct`): maps, waters, elites, NPCs, vistas.
5. Every tier-1 threshold is reachable in ordinary play within the first three hours **[T]**.
6. No deed asks the player to destroy items, lose progress or wait on a real-time clock.
7. Self-inflicted damage, damage in safe maps and damage from "too weak" monsters never count toward "taken" deeds.

**The Return Stone** (new key item `return_stone`, given by Mirelle on first talk; migrated saves receive it):
reusable, 2 s channel, out of combat, returns you to the last Waystone you touched, 8-minute cooldown **[T]**.
Waystone Shards remain as consumables that skip the cooldown. Counter: `returns`.

### 8.4 Deed trees

A deed tree is 5 free skills (no weapon needed, hybrid stat). Node 1 arrives with tier 1; nodes 2 and 3 are ordinary
Transforms from node 1 (max rank + a ready Transform); nodes 4 and 5 arrive with tiers 2 and 3.

| Tree | Deed | Node | Skill | One line | Signature |
|---|---|---|---|---|---|
| **Shade Arts** | Familiar Dark: fall in battle 10 / 30 / 75 **[T]** | 1 | **Dim the Lights** | The light sinks around you. Foes inside slow. | `zone·shadow·self·slow` |
| | (Transforms here also cost 3 Umbral Spores) | 2 | **Borrowed Breath** | Take a breath that is not yours. Heals, and your next hits heal too. | `mend·shadow·self·leech` |
| | | 3 | **Cold Hand** | A hand of shadow holds a foe where it stands. | `projectile·shadow·bolt·root` |
| | | 4 | **Last Laugh** | If you would fall in the next 4 s, you answer instead and stand at 1 HP. | `counter·shadow·self·heal` |
| | | 5 | **Old Friend** | Your own ghost fights beside you for 8 s. | `summon·shadow·self·lure` |
| **Waystep** | Homing: use the Return Stone 5 / 15 / 40 **[T]** | 1 | **Short Hop** | Blink a few steps. | `blink·none·point·none` |
| | | 2 | **There and Back** | Mark a spot. Cast again to return to it. | `blink·none·self·reposition` |
| | | 3 | **Doorstep** | Appear behind a foe. It is stunned for a moment. | `blink·none·target·stun` |
| | | 4 | **Swap** | Trade places with a foe. | `blink·none·target·reposition` |
| | | 5 | **Homeward** | Step to your last Waystone from anywhere. Out of combat; 10-minute cooldown. | `blink·none·ground·heal` |
| **Hearthcraft** | By the Fire: rest at campfires 5 / 15 / 30 **[T]** | 1 | **Catch Breath** | A quick heal. | `mend·none·self·none` |
| | | 2 | **Camp Circle** | A circle on the ground that mends whoever stands in it. | `zone·none·ground·heal` |
| | | 3 | **Warm Cloak** | A shield that quickens you while it holds. | `shield·none·self·haste` |
| | | 4 | **Kettle On** | A warm air around you: you act faster inside it. | `zone·none·self·haste` |
| | | 5 | **Banked Fire** | Heal now and keep a shield for later. | `mend·none·self·shield` |

Shade Arts are the **shadow power source** the owner asked for: a class reads them through its weapon. Three Shade
Arts plus bare-handed shadow wins is the road to Gloamhost; three Shade Arts plus Rod spells is the road to Hollow
Cantor; plus a sword, Wakeblade; two plus a dagger, Shadowstalker (§3.6). Waystep and Hearthcraft are also the first
place every player meets `blink`, `mend`, `shield` and `zone`.

### 8.5 The deed list (36)

| # | Deed | Counter (flag) | At | Grants | Riddle (layer 2) | Fun because |
|---|---|---|---|---|---|---|
| 1 | Familiar Dark | `deaths` | 10 / 30 / 75 | Shade Arts nodes 1 / 4 / 5 | "The dark is starting to recognise you." | Failing pays |
| 2 | Homing | `returns` | 5 / 15 / 40 | Waystep nodes 1 / 4 / 5 | "Your Return Stone is warm to the touch." | Happens anyway |
| 3 | By the Fire | `rests` (sit 10 s at a campfire; one count per fire per 5 min) | 5 / 15 / 30 | Hearthcraft nodes 1 / 4 / 5 | "The fire remembers who sat here." | Calm |
| 4 | Punching Bag | `hits_taken` | 200 / 2,000 | Unlocks Guard Up / title "Sturdy" | "You are getting used to this." | Failing pays |
| 5 | Bare Knuckles | `kills_bare` | 50 / 200 | Unlocks Flying Knee / whisper Knucklesaint | "Who needs steel?" | Self-set challenge |
| 6 | Hands Only | `warden_bare` | 1 | Bare Hands capstones open; 3 Sigils | "It has never been beaten by hands alone." | A story to tell |
| 7 | Still Standing | `lowhp_wins` (win a fight after 10 s under 15% HP) | 15 | Passive **Steady Hands**: +10% damage under 30% HP | "Your heartbeat found a second rhythm." | Close calls |
| 8 | Grudge | `deaths_to:<warden>` | 3 (per warden) | Passive **Grudge**: +10% damage to that warden | "It laughed. You heard it." | Revenge |
| 9 | Stubborn | `deaths_hoarding` (fall while holding 3+ Healing Draughts) | 3 | Passive **Stubborn**: draughts heal 25% more | "You were saving those for something." | A joke on the player |
| 10 | On Foot | `walk_vale` (Hearthvale to Emberwatch with no travel) | 3 | Passive **Seasoned Boots**: +10% speed out of combat | "You came on foot? Again?" | Explorers |
| 11 | Every Road | `maps_seen` (distinct) | 22 / 28 | Passive **Keen Eye**: hidden doors shimmer from 6 tiles / title "Wayfinder" | "The map has an unfinished border." | Collection |
| 12 | High Places | `vistas` (distinct; stand on a landmark's vista spot) | 8 | Skill **Overlook** `blink·wind·point·launch` | "Birds circle where the view is best." | Sightseeing |
| 13 | Three Waters | `waters_fished` (distinct maps) | 3 | Skill **Skipping Stone** `projectile·water·throw·slow` | "The fishing log has blank pages." | Collection |
| 14 | Pick and Shovel | `ore_mined` | 60 | Passive **Miner's Arms**: +15% damage to constructs | "Your hands have changed." | Happens anyway |
| 15 | Tempered | `forge_success` | 20 | Weapon upgrades cost 20% fewer Fangs | "The anvil knows your swing." | Happens anyway |
| 16 | Singed | `burned` (times set on fire) | 50 | Burn on you lasts half as long; whisper Feverfist | "You smell faintly of smoke." | Failing pays |
| 17 | Thick Blood | `frozen` | 15 | Freeze on you lasts half as long; whisper Frostmarrow | "You can see your breath indoors." | Failing pays |
| 18 | Hair on End | `shocked_soaked` | 5 | Reveals the Storm fusion hint; 5 Motes | "Your hair will not lie flat." | A discovery |
| 19 | Iron Stomach | `poison_sat_out` (poison ends without a draught) | 10 | Poison deals half damage to you | "It tastes almost familiar." | Failing pays |
| 20 | Untouched | `flawless_runs` (10 wins in a row unhit), manual only | 10 | Passive **Untouched**: +5% speed at full HP | "A counter appears at five." | Skill |
| 21 | Mercy | `spared` (walk 8 tiles away from a foe under 15% HP) | 30 | Spared foes leave a Mote; whisper Palmlight | "The ones you spared bow." | Role-play |
| 22 | Swift of Heel | `fled` (leave a fight by distance) | 25 | Passive: +15% speed for 3 s after a fight ends; title "Swift of Heel" | "Running is also a skill." | A joke |
| 23 | In Rhythm | `combo_wins` (final blow with the 3rd different skill in a row), manual only | 40 | Passive **Cadence Charm**: that 3rd skill costs 20% less SP | "One, two… and?" | Skill |
| 24 | Signature Move | `top_skill_uses` (uses of your most-used skill) | 500 | Gold frame on that skill; +1 Transform charge | "The icon is wearing thin." | Identity |
| 25 | Familiar Face | `npcs_met` (distinct) | 15 | Waystone travel costs half | "The notice board lists fewer strangers." | Explorers |
| 26 | Acquired Taste | `draughts` | 60 | Draught cooldown −20% | "You have opinions about potions now." | Happens anyway |
| 27 | Good Customer | `coins_spent` | 5,000 | Waykeepers stock 1 Sigil a day (300 coins) | "They keep something under the counter." | Happens anyway |
| 28 | Trophy Wall | `elites_beaten` (distinct) | 16 | Title "Hunter"; elites show on the map | "Sixteen empty hooks." | Collection |
| 29 | Good Listener | `echoes_known` | 4 / 8 | 10 Dust / opens Mimic's Trial | "You hum what they roar." | Collection |
| 30 | Chain Reaction | `combos` (§10 combos set off) | 30 / 100 | Opens Prismcaller's Trial / passive **Catalyst**: combos deal +10% | "Two things at once." | Play style |
| 31 | Three Masters | `classes_mastered` | 1 / 3 / 6 | Keepsake slot 1 / 2 / 3 | "A gift, once you have finished the lesson." | Long goal |
| 32 | Bell Ringer | `chimes_one_visit` (all 5 Windcrest chimes in one visit) | 1 | Opens Chimewright's Trial | "The hill wants to be played." | A puzzle |
| 33 | Cat Person | `cat_pets` | 10 | The Hearthvale cat follows you in town | "Someone has decided you are furniture." | Charm |
| 34 | Dozer | `idle_naps` (stand idle 5 min in a safe map; once a day) | 1 / 10 | +5% EXP for 10 min each nap / title "Dozer" | "You look like you needed that." | A joke |
| 35 | Lucky Fingers | `chests_opened` (distinct) | 5 | +10% coins from monsters | "Five lids." | Collection |
| 36 | Humbled (secret) | `jellop_loss` (fall to a Jellop at level 10+) | 1 | 1 Sigil; title "Humbled" | (none until earned) | A joke |

Counters that also feed class discovery and Legendary chains (no deed row of their own): `hits:<weapon>`,
`kills:<weapon>:<element>`, `kills_el:<element>`, `kills_family:<family>`, `kills_behind`, `kills_lowhp`,
`healed_total`, `prevented_total`, `damage_taken`, `multi6` (one cast hits 6 foes), `alt_holy_shadow`,
`deaths_family:<family>`, `still_through_windup`, `spins_dagger_kills`. New counter call sites are listed per lane in
§15; all are one `incFlag` line at an event that already exists.

---

## 9. Legendary transforming lines

A Legendary line is a **Legendary-rarity class that works with any weapon** and whose signature mechanic is a
**form** (§3.3 `kind: 'form'`). Its kit and form bars are in §3.6. This reuses the whole class framework: Class
Level is the line's mastery, its passive is a Keepsake once mastered, and no second progression system exists.

### 9.1 The cycle

| Phase | Rule (constants in `FORM`, all **[T]**) |
|---|---|
| **Build** | The line's meter fills from the line's own behaviour (table below), never from plain damage. No decay. |
| **Take the form** | Tap the meter at 100. 0.6 s transformation, during which you cannot be hurt. AUTO takes it at 100 unless the player set **Hold**. |
| **In form** | Class slots 1 – 5 show the **form bar**; your 3 slots stay. The sprite is replaced by the form sprite. Weapon skills in your slots still obey the weapon rule. You cannot change class or weapon. |
| **Time** | The meter drains at a flat rate: the form lasts 8 / 14 / 20 s by stage. Each line has one rule that adds time (at most +50% in total). The drain never speeds up. |
| **End** | The meter empties, or you tap it to leave early. |
| **Aftermath** | A named drawback for a fixed time, then the meter can fill again. |

### 9.2 The form grows with Class Level

| Class Level | Stage | Form bar | Length | Sprite |
|---|---|---|---|---|
| 1 – 3 | **Sign** | form skills 1 – 2 (slots 3 – 5 keep the base kit) | 8 s | Hero with one changed limb, wing or horn |
| 4 – 6 | **Aspect** | form skills 1 – 4 | 14 s | Half form |
| 7 – 9 | **Avatar** | all 5 | 20 s | Full form sprite, larger |
| 10 | **Apotheosis** | all 5; form skill 5 gains its finisher: it ends the form at once for a screen-wide effect | 20 s | Full form + aura |

### 9.3 The six lines

| Line (class) | Meter fills from | In form you are | Rule that adds time | Drawback in form | Aftermath |
|---|---|---|---|---|---|
| **Dragon** (Wyrmsoul) | Embers: dropped by foes you defeat with an element; walk over them | Slow and huge; a breath cone and a tail sweep. The breath takes the last element you gathered. | +1 s per Ember gathered in form | Cannot use items | **Molt** 10 s: −25% DEF, +15% speed |
| **Angel** (Dawnwing) | Grace: damage you prevent or heal | Hovering and ranged; wards, and a ray that widens per active ward | +1 s per 5% max HP prevented | Mercy: foes under 15% HP surrender (they count as defeated, half coins) | **Grounded** 10 s: no dashes or blinks |
| **Demon** (Hollowhorn) | Debt: HP you spend, and foes finished while you are under 35% HP | Fast melee; every skill costs HP and steals it back | +2 s per kill | Healing you receive is halved | **Owed** 30 s: max HP −20% |
| **Swarm** (Thousandwing) | Scatter: different foes hit within a short window | A moth swarm in your shape; single-target hits pass through you | +1 s each time one cast hits 4+ foes | Area damage against you is doubled | **Scattered** 8 s: your skills fire 0.3 s late |
| **Mountain** (Mountainborn) | Weight: standing still, and hits you soak | A stone giant; cannot be moved, each step quakes; skills raise ridges and open pits | +1 s per 10% max HP soaked | Cannot dash, blink or dodge; half speed | **Rubble** 20 s: rooted 2 s, then Weight fills half as fast |
| **Star** (Starwrit) | Starlight: alternating holy and shadow skills | A body of night; tap foes to link them as stars, then close a shape | +2 s per shape closed | Your hits only hurt linked foes | **Daybreak** 20 s: Starlight cannot fill |

Dragon, Angel and Demon are the owner's three. Swarm, Mountain and Star are originals. All six looks are original
(§3.6 outfit column): no existing character's dragon, angel or demon design is referenced.

### 9.4 How a line is found

A chain of three deeds whispers the class; then a **Rite** (a Trial quest from Ione in Riftmarch, 10 Sigils).

| Line | Deed chain (all three) | Rite |
|---|---|---|
| Dragon — "Old Blood" | Defeat 25 foes with each of the 7 primal elements · Singed (deed 16) · defeat the Tempest Drake 5 times | Defeat the Tempest Drake and Thunderhoof without returning to town between them |
| Angel — "Kept Light" | Heal 5,000 HP in total · prevent 5,000 damage with shields · Mercy (deed 21) | Defeat the Hollow Regent without dropping under 50% HP |
| Demon — "Three Bargains" | Familiar Dark tier 2 (deed 1) · Still Standing (deed 7) · defeat 50 foes while under 25% HP | Accept three bargains at the twin-faced statue in the Barrow Vault: three fights, each with a heavier handicap |
| Swarm — "A Great Many" | Defeat 300 swarm monsters · hit 6 foes with one cast, 20 times · fall to a swarm monster 3 times | Defeat 40 foes in Quarry Depths 2 within 4 minutes |
| Mountain — "Standing Stone" | Take 50,000 damage in total · Pick and Shovel (deed 14) · defeat the Ironroot Colossus 5 times | Defeat the Ironroot Colossus without moving more than 3 tiles from where you start |
| Star — "Night Sky" | High Places (deed 12) · alternate holy and shadow skills 100 times · stand in the Moonlit Glade, the Barrow Vault and on Stormbreak | Visit those three places in one outing: no Return Stone, no Waystone, no fall |

### 9.5 Keeping normal classes worth playing

1. **Equal average, higher peaks.** The rotation simulation (§3.5) runs a full build → form → aftermath cycle and
   must land in the same ±10% band.
2. **A line is a class.** Wearing it means not wearing another class, and the form never uses another class's kit.
3. **The base kit builds the meter.** Each line's 5 base skills are what fill it, so the base matters.
4. **Content alternates** long fights (favour steady classes) and burst windows (favour forms).
5. **AUTO is not optimal**: it takes the form the moment the meter fills.

---

## 10. Synergies (12 rules, one line each)

Statuses already exist; three combos already exist in `combat.comboFor` (marked ●) and are kept exactly. Each combo
uses up the status unless noted, pops its one word on screen, and has its own sound. Constants in `COMBOS` (**[T]**
except the three existing ones).

| # | Line shown to the player | Rule |
|---|---|---|
| 1 ● | **Soaked + Lightning = Conduct.** | Lightning or storm hit on a soaked foe: ×1.5, +1 jump on chains. |
| 2 ● | **Frozen + Earth = Shatter.** | Earth or magma hit on a frozen foe: ×1.75. |
| 3 ● | **Burning + Wind = Fan the Flames.** | Wind or storm hit on a burning foe: ×1.25 and the burn spreads 1.5 tiles. |
| 4 | **Soaked + Ice = Flash Freeze.** | Ice hit on a soaked foe: frozen 2 s (wardens: slowed). |
| 5 | **Burning + Water = Steam.** | Water hit on a burning foe: a 2-tile steam burst that slows; the burn ends. |
| 6 | **Poisoned + Fire = Combust.** | Fire or magma hit on a poisoned foe: all the poison left lands at once. |
| 7 | **Bleeding + Holy = Eclipse.** (and Smitten + Shadow) | Extra damage of 8% of the foe's missing HP (wardens 2%). |
| 8 | **Held + a delayed hit = Sure Hit.** | Nova, rain and trap hits on a rooted, stunned or frozen foe always crit. Status is kept. |
| 9 | **Pulled + an area hit = Crush.** | A foe pulled in the last 2 s takes +25% from nova, spin, zone and rain. |
| 10 | **Launched + a strike = Juggle.** | Strikes on an airborne foe deal +20% and keep it up 0.4 s longer (max 3). |
| 11 | **Marked + different skills = Exploit.** | Each *different* skill that hits a marked foe adds +5% to the cash-in (max 5). Marks are kept until spent. |
| 12 | **Lightning + a water zone = Charged Water.** | A lightning or storm hit on any foe standing in a water zone shocks every foe in that zone. The zone stays. |

Rules for the table itself: one status per group on a foe at a time (soaked / frozen; burning; poisoned; bleeding /
smitten; rooted / stunned / launched), so the table is never ambiguous. The Codex gets a **Combos** page: 12 tiles,
undiscovered ones shown as "? + Lightning". Skill cards show small icons for the statuses a skill applies and the
combos it can set off. AUTO prefers a skill that would set off a combo on its current target. Echoes plug in for
free (Bubble soaks, Rime freezes, Grave Grip roots). Combos are counted by `combos` for deed 30.

---

## 11. Visuals, maps and town

### 11.1 Diagnosis (adopted from the visual report)

The sprites are competent. The game reads as generated because of **composition, scale, value and repetition**:

| # | Cause | Fixed by |
|---|---|---|
| 1 | Props are scattered to a density target, so every screen is the same oatmeal | §11.2 D (rules and clearings), C (stamps) |
| 2 | Everything is about one hero tall | §11.2 B (size tiers) |
| 3 | The landmark is a sentence, not a thing on screen | §11.3 (`landmark` as data), §11.5 |
| 4 | No height: `#` is a wall, not a cliff | §11.2 F (elevation) |
| 5 | Flat values, flat light, blob shadows | §11.2 A (cast shadows), H (ramps), J (day light) |
| 6 | One boulder, one tree, one cottage, one slime | §11.2 B, G, §11.8 |
| 7 | Forest borders are one tree on a grid | §11.2 E |
| 8 | Towns are empty and identical | §11.4, §11.2 G |
| 9 | Paths are blobs | §11.2 I |
| 10 | Mirror symmetry and round shapes | §11.6 |
| 11 | A label and a gold frame on everything | §11.7 (HUD diet) |
| 12 | A wobbly font at many sizes | §11.7 |

`docs/ART-DIRECTION.md` §2 (palette) and the "≈ 1 dressing per 6 – 10 tiles" line of §3 are **replaced** by this
section; its §0 (never copy the reference) and pixel rules stay.

### 11.2 Art and renderer changes (exact)

**A. Directional cast shadows** (Phase 1; `art/common.ts`, `art/world.ts`, `render/stage.ts`, `depths.ts`)
- The sun is top-left. Every prop, structure, actor and monster throws a shadow **down-right**: the sprite's own
  silhouette, flattened to 50% height and sheared so its top lands `0.6 × sprite height` px to the right, capped at
  48 px long.
- Colour `#3a3560`, multiply, 40% outdoors, 30% in dungeons. Never black alpha.
- A 1 – 2 px contact line in the darkest step of the sprite's own ramp sits under every grounded sprite.
- Baked once per texture frame as `<key>__sh` (lazily, cached), drawn on `DEPTH.SHADOW`. The ellipse `shadow()`
  helper is deleted except under flying monsters (a small offset ellipse, same colour).
- Golden hour and dusk maps use a longer shear (0.9) through one constant.

**B. Prop size tiers** (Phase 1; `art/world.ts`, `core/world/compile.ts` footprints). The hero is 40 px tall.

| Tier | Footprint (tiles) | Height (px) | Trees | Rocks | Other |
|---|---|---|---|---|---|
| S | under 1 | 8 – 24 | sapling, bush | pebble group, small stone | tufts, flowers, mushrooms |
| M | 1 | 32 – 56 | young tree | boulder | stump, crate stack, signpost |
| L | 2 × 2 | 64 – 96 | grown tree (3 species per biome) | boulder group 2 × 2 | cart, well, shrine, tent |
| XL | 3 × 2 and up | 104 – 160 | hero tree 128, ancient 160 | outcrop 3 × 2, fallen giant log 6 × 2 | landmark stamps |

- Each tier of each family has **at least 3 drawn variants**; the same variant never repeats within 6 tiles.
- Trees and rocks are placed as **groups of big + medium + small in odd counts**, never a lone medium.
- **Tallness rule:** in outdoor maps at least 95% of walkable tiles have an L or XL prop, stamp or structure within 12
  tiles, so every screen shows something three heroes tall (`validateWorld`, §11.3 V8).
- Structures are drawn ×1.4 their current size; footprints grow to match.

**C. Authored set-piece stamps** (Phase 2; `src/data/stamps/*.ts`): hand-placed multi-tile compositions with their
own terrain patch, props, blockers, lights, particle emitters and anchor points (§11.3). Every landmark, every
secondary point of interest and every NPC's "place" is a stamp. Stamps are blitted after terrain and before rule
dressing, and reserve their footprint plus an apron of calm ground.

**D. Rule-based dressing with clearings** (Phase 1; `render/dressing.ts planDressing`). The density target is
deleted. The planner places by rules:

| Rule | Value |
|---|---|
| Area mix per outdoor map | about 60% calm, 30% medium, 10% dense (±10 points, tested) |
| Spacing (Poisson radius) | calm 5 tiles · medium 2.5 · dense 1.2, scaled by a low-frequency mask seeded per map |
| Where dense | within 3 tiles of borders, cliffs, water, stamps and structures |
| Where calm | paths (+1 tile), plazas, portal arrivals (+2), **clearings** |
| Clearings | every spawn entry sits in a named clearing; ground inside is clean (at most 20% of medium dressing) with a dressed rim 2 tiles wide. Until maps carry `zones` (Phase 2), the planner derives a clearing from each spawn square. |
| Ecology | mushrooms under trees and beside logs · reeds only at water · flowers in drifts of 8 – 20 on sunlit forest edges · tall grass along fences and cliff feet · pebbles on paths and at cliff feet · bones and rubble only in dungeons |
| Size families | every tree or rock placement is a group (B) |
| Road lining | fences, milestones and lanterns follow the path in runs with a rhythm (every 4 tiles, with gaps), never a ring round a plaza |

**E. Layered forest edge** (Phase 1; `compile.ts` for `T`, `art/world.ts`, `render/stage.ts`). `T` no longer means
"a tree on every tile". From the walkable side inward:
1. undergrowth row: ferns, bushes, mushrooms, staggered;
2. front row: full trees of 3 species and 3 heights, offset by half tiles, canopies overhanging the walkable ground
   on `DEPTH.CANOPY`;
3. second row: trunks half hidden, canopies 1 step darker;
4. beyond: one solid dark canopy mass with no trunks, fading to the darkest foliage step.
Every border run gets a notch (a 2-tile bay, a peek-through or a fallen log) at least every 12 tiles.

**F. Elevation with cliffs and stairs** (Phase 2; `core/world/types.ts`, `compile.ts`, `pathfinding.ts`,
`art/tiles.ts`, `render/autotile.ts`). Maps gain tiers 0 – 3 (§11.3). A tier edge draws a **lit top lip** (1 px
highlight, 3 px top band), a **cliff face 2 tiles tall** on south-facing edges (1 tile on east and west edges, a
dark rim on north edges), and a **foot shadow** 1 tile deep. Movement between tiers happens only on **stairs** (at
least 2 tiles wide) or ramps. Projectiles and ground effects ignore tiers in v4 (no line-of-sight rules).

**G. Modular building kit** (Phase 2; `art/world.ts`, `StructureDef`). One generator, parts chosen by data:

| Part | Options |
|---|---|
| Footprint | rectangle 3 × 3 to 7 × 5, L-shape, 1 or 2 storeys |
| Wall | timber frame, plaster, fieldstone |
| Roof | thatch, terracotta, slate, verdigris, wood shingle (ramps in H) |
| Front | closed door, open front (smithy, stalls), porch with steps |
| Extras | chimney with smoke, awning in 4 colours, hanging sign with a pixel icon (anvil, potion, bed, fish, book, coin, bread), banner, window boxes, lit windows from dusk |
| Layers | body (y-sorted) + roof (on `DEPTH.CANOPY`; fades to 35% when the hero is behind it) |

Each town owns a roof and wall identity: Hearthvale thatch on timber; Emberwatch dead-wood stockade; Riftmarch slate
on fieldstone. No building silhouette is a recolour of another.

**H. Palette ramps** (Phase 1; `art/common.ts`, `art/pixel.ts`). Every ramp is hue-shifted: shadows lean cool and
violet, lights lean warm and yellow. Six steps, shared darks.

| Material | shadow → highlight |
|---|---|
| Grass | `#1f3b33` `#2f5435` `#47702f` `#6a8f36` `#93ab45` `#c4c765` |
| Foliage | `#17302f` `#23483a` `#32663a` `#4f8a3c` `#86ad45` `#c9cf6a` |
| Dirt / path | `#4a3340` `#6e4f48` `#94714f` `#b8955f` `#d9bd7c` `#efdc9e` |
| Stone | `#2b2a40` `#454660` `#69708a` `#959aa6` `#c2c2b4` `#e8e2c6` |
| Wood | `#2e1a26` `#4d2a2a` `#74432d` `#9c6534` `#c48e48` `#e3bb6c` |
| Water | `#1b2f5a` `#23508a` `#2f7fa8` `#4fb0b8` `#9adcc8` `#e4f6e0` |
| Roof terracotta | `#4a1f33` `#7a2f33` `#a8472f` `#cf6b38` `#e89a52` |
| Roof slate | `#232a4a` `#34466e` `#4d6c8f` `#7a9cab` |
| Roof thatch | `#5a4326` `#86682f` `#b3923f` `#d9bd5e` |
| Roof verdigris | `#173b40` `#23605a` `#3a8a72` `#74b890` |

- **Value plan:** ground dark-mid, paths and plazas light, tree masses and cliffs dark, actors and accents the
  brightest and most saturated pixels on screen. `tests/render-ground.test.ts` checks, per biome, that path
  luminance is at least 25% above ground and tree-mass luminance at least 20% below it.
- **Outlines:** `#24180f` only on characters and monsters. Props and buildings are outlined in the darkest step of
  their own ramp, so the world sits back.
- **Accent:** one accent hue per map (`MapDef.accent`), on at most 5% of pixels.
- **Dither:** only in light falloff and water depth bands. Removed from sprites and ground. No per-pixel noise, no
  soft alpha blobs: grass variation is hard-edged 2-tone pixel clusters.
- Biome palettes (frost, basalt, storm, dusk, crypt, cave) are re-derived with the same value steps and hue shift.

**I. Ground and paths** (Phase 2; `art/tiles.ts`, `render/ground.ts`, `compile.ts` path brush). Paths are smoothed
(Catmull-Rom), vary in width, carry a darker edge band and wheel ruts, and tufts creep in from the sides. Cobble
becomes irregular flagstones with moss in the joints, a worn centre and a raised curb. Plazas are never discs.

**J. Daylight** (Phase 3; `render/lighting.ts` new `day` profile, `ambient.ts`). Sun tint `#fff0c0`; dappled
2-frame canopy light under tree masses; drifting cloud shadows at 12 – 18%; 3 – 5 banded light shafts in groves
only; warm pools under lanterns and windows; bloom on emissive pixels only. No full-frame blur or bloom, no normal
maps, integer scaling kept.

**K. Water** (Phase 3). Depth bands from the shore, an animated foam line, flipped and darkened reflections of
sprites with row wobble, reeds in clumps, lily pads.

### 11.3 Map-format additions (`src/core/world/types.ts`, `compile.ts`, `validate.ts`)

```ts
export interface StampDef {
  id: string; w: number; h: number;                               // tiles
  rows?: string[];                                                // macro rows (same legend) that replace terrain under it
  props: { key: string; tx: number; ty: number; tier: 'S' | 'M' | 'L' | 'XL'; blocks?: boolean; layer?: 'flat' | 'sorted' | 'canopy' }[];
  blockers?: [tx: number, ty: number, w: number, h: number][];
  lights?: { tx: number; ty: number; radius: number; color: number }[];
  emitters?: { tx: number; ty: number; kind: 'smoke' | 'motes' | 'leaves' | 'sparks' | 'mist' | 'drips' }[];
  anchors?: Record<string, [tx: number, ty: number]>;             // 'npc', 'object', 'vista', 'door', ...
  apron: number;                                                  // calm tiles kept around it
  hero?: boolean;                                                 // may serve as a map's landmark
  heightPx: number;                                               // tallest prop, for the tallness and landmark rules
}

export interface MapDef {
  // ...existing fields; `landmark?: string` is replaced:
  landmark: { text: string; stamp: string /* placement id */ };
  /** Macro grid parallel to `layout`: '0'..'3' = tier; '^' 'v' '<' '>' = stairs climbing toward N / S / W / E. */
  elev?: string[];
  stamps?: { id: string; stamp: string; tx: number; ty: number; flip?: boolean }[];
  zones?: { kind: 'clearing' | 'clear' | 'flowerfield' | 'orchard' | 'farm' | 'graveyard' | 'market' | 'yard';
            rect: [tx: number, ty: number, w: number, h: number]; name?: string }[];
  paths?: ([number, number][] | { pts: [number, number][]; w: number; style: 'dirt' | 'cobble' | 'flag' | 'board'; curb?: boolean })[];
  rivers?: { pts: [number, number][]; w: number }[];
  bridges?: { from: [number, number]; to: [number, number]; kind: 'stone' | 'plank'; w: number }[];
  fences?: { kind: 'picket' | 'rail' | 'stone' | 'hedge'; pts: [number, number][]; gates?: number[] }[];
  ambient?: { kind: 'townsfolk' | 'cat' | 'chickens' | 'ducks' | 'birds'; look?: string; loop: [number, number][]; pettable?: boolean }[];
  accent?: number;
}

export type StructureKind = /* existing 9 */ | 'cottage' | 'inn' | 'shop' | 'stall' | 'mill' | 'stable' | 'gatehouse' | 'watchtower' | 'barn' | 'dock';
export interface StructureDef {
  kind: StructureKind; tx: number; ty: number;
  variant?: number; storeys?: 1 | 2; footprint?: 'rect' | 'L';
  roof?: 'thatch' | 'terracotta' | 'slate' | 'verdigris' | 'shingle'; wall?: 'timber' | 'plaster' | 'stone';
  door?: Facing; openFront?: boolean; sign?: 'anvil' | 'potion' | 'bed' | 'fish' | 'book' | 'coin' | 'bread';
}
export interface SpawnDef { /* ... */ clearing?: string; formation?: 'loose' | 'pack' | 'line' | 'ring'; }
export interface NpcPlacement { npc: string; tx: number; ty: number; at?: string /* '<stamp placement id>.<anchor>' */ }
// MAP_SIZES.town becomes { w: [40, 64], h: [32, 48] }
```

**Validation rules** (`validateWorld`; errors unless marked warning):

| # | Rule |
|---|---|
| V1 | Every map has `landmark.stamp` naming a placed stamp whose `StampDef.hero` is true. Size: at least 5 × 5 tiles and 120 px tall in towns, fields and outposts; at least 4 × 4 and 80 px in dungeons, arenas and secrets. |
| V2 | In fields the landmark's centre is not inside the middle 20% of the map (off-centre), and its `vista` anchor is at most 40 walking tiles from the main arrival. |
| V3 | Stamps lie inside the map, never overlap each other's footprint + apron, never cover a portal rect or arrival tile, and every anchor is walkable. An NPC or object with `at` stands exactly on that anchor. |
| V4 | `elev` has the size of `layout`. A step between neighbouring macro cells is at most 1 tier. Flood fill honours tiers: every NPC, node, object, portal and spawn is reachable using stairs only. Stairs are at least 2 tiles wide. |
| V5 | Every town, field and outpost has at least one tier change crossed by at least one stair or ramp. |
| V6 | Every spawn entry lies inside a `clearing` zone; a spawn square never straddles two tiers; a field has 3 – 5 clearings. |
| V7 | An outdoor map's border uses at least 3 kinds (tree line, cliff, water, hedge or wall, fog-into-dark), and no single kind runs more than 12 macro cells without a notch. |
| V8 | Tallness: at least 95% of walkable tiles of an outdoor map have an L or XL prop, hero stamp or structure within 12 tiles. |
| V9 | No mirror symmetry: fewer than 80% of macro cells match their horizontal or vertical mirror. Arenas included. |
| V10 | Every path that crosses a river crosses it on a bridge; bridges are walkable; rivers never cut reachability. |
| V11 | A town has at least 8 different structure silhouettes (kind + variant + footprint + storeys), and no two identical structures within 6 tiles. |
| V12 | At most 16 `ambient` entries per map; loops stay on walkable tiles and at least 3 tiles from portals. |
| V13 (warning) | Planned dressing lands within the 60 / 30 / 10 area mix ±10 points. |
| V14 (script) | `npm run shots` also writes a 256 px thumbnail of each full map; the landmark, the main path and the clearings must be legible in it. Human review, per phase. |

Maps not yet converted keep working: `landmark` strings are wrapped by the compiler as
`{ text, stamp: '' }`, and V1 – V2, V5 – V8 apply only to maps on the phase's converted list (§15), which grows until
all 28 are on it in Phase 4.

### 11.4 Hearthvale rebuild (Phase 2)

**Concept:** a river-crossing market town on two levels. Identity: warm thatch and timber, one river, one bridge,
one giant tree. Size **64 × 48 tiles** (32 × 24 macro cells; was 40 × 32). Portal ids and destinations are
unchanged; only their tiles move.

```
                    N gate → Mirror Lake
        ┌───────────────┴────────────────────────┐
        │  Chapel + graveyard      HALL (porch)  │   UPPER TERRACE (tier 1)
        ╞════ stairs ═══════════════ stairs ═════╡   cliff face, ivy wall
        │  SMITH ROW        HEARTH TREE    INN   │
W gate ─┤  forge yard    fountain · PLAZA  stable├─ E gate → Quarry
→ Green │  Waystone nook          Altar nook     │   watchtower
meadow  │  COTTAGES        MARKET STREET         │   LOWER TOWN (tier 0)
        │  gardens         stalls, shops         │
        ≈≈≈≈≈ river ≈≈ stepping stones ≈ [BRIDGE] ≈≈≈ weir · MILL ≈≈
        │  farm plots · orchard · barn · dock    │   RIVERSIDE
        └──────────────────┬─────────────────────┘
                    S gate → Gloomwood
```

| Element | Specification |
|---|---|
| **Landmark** | The **Hearth Tree**: a 5 × 6-tile ancient tree, 160 px tall, hung with lanterns, canopy on the canopy layer, north-east of the plaza centre. Visible from all four gates. Secondary: the chapel spire on the terrace, the mill wheel on the river. |
| **Elevation** | The north third is tier 1. One cliff face runs east–west with an ivy-covered retaining wall and **two stairways** (west by the chapel, east by the hall). The river sits visibly lower, with bank tiles. |
| **River and bridge** | The river runs west to east across the south third, 4 tiles wide with one bend. A **3-wide arched stone bridge** carries the south road. A weir and the mill at the east end, stepping stones as a western shortcut, a dock on the south bank, 3 ducks. |
| **Plaza** | An irregular trapezoid about 12 × 9 tiles, flagstones with a worn centre and a ring pattern round the fountain. The fountain stands off-centre in front of the tree. |
| **Districts** (each its own ground, props and roof) | **Market** (cobble, awnings, crates, hanging signs) · **Smith Row** (soot-dark ground, anvil yard, coal heap, forge glow) · **Terrace** (flagstone, clipped hedges, a statue) · **Cottages** (dirt lanes, picket fences, vegetable beds, a washing line) · **Riverside** (boardwalk, dock, nets, barrels, farm plots, orchard) |
| **Buildings (16, 11 silhouettes)** | Hall (wide, 2 storeys, slate, banner, porch) · Chapel (spire, verdigris) · Smithy (open front, big chimney, stone) · Inn (L-shaped, bed sign, lit windows) · Stable · Mill (animated wheel) · 3 shops (potion, bread, book signs; three awning colours) · Watchtower at the east gate · Barn · 5 cottages in 3 variants |
| **Also** | 4 market stalls · 4 gatehouse arches, each flying the destination's colour · the dock |
| **NPC placement** | **Brann** at the anvil inside the open smithy · **Sister Alba** on the chapel steps · **Mirelle** in the Waystone nook (low wall, two banners, two braziers) at the plaza's north-west corner · **Tamsin** on the hall porch. The **Fusion Altar** gets its own arched nook on the plaza's east side. The signpost stands where the market street meets the plaza. |
| **Services** | Brann: weapon upgrades, Runes. Mirelle: travel, material swaps, draughts, the Return Stone. Tamsin: class hints, Trials, Rumours. Altar: fusion, Echo sockets. No new NPC ids. |
| **Townsfolk (14 ambient, not NPCs)** | 2 stall sellers · 3 shoppers looping the market · a child at the fountain · the miller carrying sacks between mill and barn · a farmer in the plots · a fisher on the dock · a guard walking watchtower ↔ east gate · a gravekeeper sweeping · a stablehand · a washer at the river steps · an old man on the bench under the tree |
| **Animals** | 1 cat (pettable, deed 33) · 4 chickens in a pen · 3 ducks · plaza birds that scatter when you run through |
| **Told details (5)** | a cart with a broken wheel at the west gate · a notice board (opens Rumours) · flowers on one grave · a half-built wall with scaffolding by the east gate · coins in the fountain |
| **Roofs** | Buildings you walk behind fade their roof to 35%. Open-front buildings show their inside. No interiors in v4. |
| **Labels** | No permanent floating labels. A name appears within 3 tiles or when targeted. Shops are read from their hanging signs. |
| **Accent** | Lantern orange `#e89a52`, at most 5% of pixels. |

**Riftmarch** (Phase 4) gets its own identity instead of a recolour: slate on fieldstone, built along both lips of
the rift, the Rift Altar on a cantilevered stone tongue over the crack, rope bridges, cold blue accent. It grows to
56 × 40 tiles. **Emberwatch** (Phase 3) keeps its size and becomes a real stockade: palisade stamp, twin
watchtowers, the campfire yard.

### 11.5 Landmark requirements for all 28 maps

Each row is the brief for that map's hero stamp. "Tier" = the elevation the map must show. Borders: T tree line,
C cliff, W water, H hedge or wall, F fog-into-dark, L lava, V void.

| Map | Hero landmark (stamp) | Min size, height | Elevation | Borders | Accent | Phase |
|---|---|---|---|---|---|---|
| vale.hearthvale | The Hearth Tree | 5 × 6, 160 px | terrace tier 1 + 2 stairs | T, C, W, H | lantern orange | 2 |
| vale.greenmeadow | The Old Ring: 8 mossy standing stones on a low rise with steps; a windmill as a far second landmark | 7 × 7, 120 px | the rise (tier 1) | T, C, W | poppy red | 2 |
| vale.mirror_lake | Pell's pier with a boathouse and one giant reflected willow; the lake fills the arrival view | 8 × 6, 128 px | lake shelf below the south meadow | W, T, C | aqua | 3 |
| vale.lake_islet | The sun spring under a lone stand of three tall trees | 5 × 5, 128 px | spring knoll | W, T | sun gold | 3 |
| vale.windcrest_hill | The Wind Shrine on the summit, ringed by humming stones, banners streaming | 7 × 7, 140 px | 3 tiers to the summit | C, T, F | sky white | 3 |
| vale.falls_hollow | The hidden cascade: a 2-tier waterfall into a mossy pool, chime willows | 6 × 8, 160 px | fall cliff | C, W, T | chime silver | 3 |
| vale.greystone_quarry | The quarry pit: three cut terraces with a timber crane and a hanging block | 9 × 8, 140 px | 3 terraces | C, T, H | ore teal | 3 |
| vale.collapsed_shaft | The cave-in: split pit-props over a rubble slope, ore glinting | 4 × 5, 96 px | rubble slope | C, V | ore teal | 4 |
| vale.quarry_depths.1 | The Old Workings: plank haulage way and a bridge over an underground stream | 6 × 4, 80 px | stream channel below | C, W, V | lamp yellow | 4 |
| vale.quarry_depths.2 | The Glittering Deep: a black lake ringed by crystal moss, the geode den beyond | 7 × 6, 96 px | lake shelf | C, W, V | crystal violet | 4 |
| vale.quarry_depths.3 | The Rootbound Hall: iron roots splitting a round chamber; one side collapsed, one open | 6 × 6, 128 px | root dais | C, V | root amber | 4 |
| vale.gloomwood | The Umbral Obelisk in a **sunken** hollow, 9 menhirs at 2 – 3× today's height, one light shaft | 7 × 7, 160 px | sunken hollow (tier −1 drawn as 0 under a tier-1 wood) | T, F, C | violet | 2 |
| vale.moonlit_glade | The silver pool that holds a full moon; the kneeling stone warden on its west shore | 6 × 6, 120 px | pool bank | T, W, F | moon white | 3 |
| vale.hollow_barrow.1 | The Hall of Tombs: three ranks of graves under hanging roots; the stair Waystone glowing | 6 × 5, 96 px | stair landing | C, V, H | grave green | 4 |
| vale.hollow_barrow.2 | The flooded ossuary in the Wailing Galleries | 6 × 5, 80 px | flooded lower floor | C, W, V | bone white | 4 |
| vale.hollow_barrow.3 | The Still Hall: the campfire under the sealed vault door (black sun, white moon) | 5 × 6, 128 px | door dais | C, V | fire orange | 4 |
| vale.barrow_vault | The twin-faced statue of sun and moon with dusk-moss at its foot | 4 × 4, 128 px | statue plinth | C, V | dusk violet | 4 |
| vale.hollow_barrow.4 | The Regent's Hall: cracked flagstone ring, four sarcophagi (one toppled), the open tomb | 6 × 6, 96 px | tomb dais | C, V | regent crimson | 4 |
| vale.cinder_fields | The Smoulder Scar: a lava fissure from bluff to bluff with one natural stone crossing | 12 × 4, 80 px + 120 px bluff | two bluffs | L, C, T | ember orange | 3 |
| vale.emberwatch | The stockade gate between twin watchtowers; the campfire yard | 8 × 6, 150 px | tower mounds | H, C, L | signal red | 3 |
| vale.stormbreak_approach | The Prism Gate: two crystal pillars on a paved terrace at the top of the climb | 5 × 5, 112 px (existing sprite kept) | 3-tier climb | C, F, T | prism white | 3 |
| vale.stormbreak | Thunderhoof's mesa: a broken ring of lightning stones; the rift churning past the east lip | 7 × 7, 128 px | mesa lip, one side open to sky | C, V, F | lightning yellow | 4 |
| rift.riftgate_road | The Sundered Ring: nine storm-black stones around a sliver of the Rift | 7 × 7, 140 px | ring knoll | C, T, V | rift blue | 4 |
| rift.riftmarch | The Rift Altar on a stone tongue over the starry crack that splits the plaza | 6 × 8, 120 px + the crack with depth and rim light | both lips + bridges | V, C, H | rift blue | 4 |
| rift.frost_shelf | The Glass Lake and the Eye: a pool of black water that never freezes | 8 × 8, flat + 128 px ice spires | ice shelf | C, W, F | ice cyan | 4 |
| rift.basalt_steps | The Caldera: a molten fall over three basalt steps, the Anvil island at its heart | 10 × 8, 140 px | 3 steps | L, C, V | magma orange | 4 |
| rift.thunderhead_ridge | The Eyrie: a cliff-ringed summit circle of storm-split boulders | 7 × 7, 150 px | summit + 2 tiers | C, F, V | storm violet | 4 |
| rift.dusk_orchard | The Gloaming Bower: a hedged garden behind a broken manor, at eternal sunset | 9 × 7, 140 px | manor terrace | H, T, F | sunset rose | 4 |

Every field also needs **2 – 3 secondary stamps** (2 × 2 to 4 × 4) that each tell one line: a ruined cart, a
wayside shrine, a hunter's camp, a fallen giant log, a lone dead tree, a well. Every landmark stamp has a `vista`
anchor (deed 12).

### 11.6 Composition rules for every map

1. One hero landmark, off-centre, seen early (V1, V2).
2. One readable spine: the main path is wider and lighter than the ground and is lined in rhythm; side trails are
   narrower and half overgrown.
3. Fights happen in 3 – 5 clean clearings with dressed rims (V6).
4. Dense at the edges, calm in the middle (V13).
5. Three kinds of border, broken by notches (V7).
6. No mirror symmetry; arenas are rotated, not mirrored: one side cliff, one side open, one broken thing (V9).
7. At least one tier change outdoors (V5).
8. One or two things per screen the hero walks **behind** (canopy, arch, roof).
9. Monsters stand in formations (`SpawnDef.formation`), not in a radius scatter.
10. Judge by full screenshots and the 256 px thumbnail, never by zoomed sprites (V14).

### 11.7 HUD diet (Phase 1; `src/ui/hud/**`, `art/ui.ts`, `render/fonts.ts`)

| Item | Now | v4 |
|---|---|---|
| Fonts | Pixelify Sans at many sizes | Two faces: a drawn bitmap display face (zone names, headers) and one plain even-stroke pixel face (numbers, body). Three sizes in total. |
| Frames | one gold bevel on everything | Three weights: heavy (portrait, attack button), light (slots), none (tracker text on a soft dark strip). Gold only on things you can tap. |
| Tip banner | always on | hidden; tips arrive as single toasts |
| Tracker | two cards open | one line, collapsed; tap to open |
| Stat strip, "Explored %" strip | always on | moved into the character and map panels |
| Combat log | always on | fades 4 s after the last line |
| World labels | on every object | only within 3 tiles or when targeted; NPC role is an icon |
| Zone plate | permanent | animates in on arrival, then shrinks to a small tag |
| Skill slots | one brown-orange strip | icon grounds tinted by element; class slots framed in the class colour; one mechanic widget above them (§3.6) |
| New v4 chrome budget | — | The mechanic widget and the Pouch toast are the only additions. No new permanent HUD element may be added without removing one. |

### 11.8 Characters and monsters

| Item | Now | v4 | Phase |
|---|---|---|---|
| Player facings | side only (flipX) | **front, back and side** for every weapon and class look | 3 |
| Bare Hands look | none | new base look: wrapped hands, guard stance, per-weapon idle | 1 (side), 3 (all facings) |
| Walk | 4 frames | 6 frames, 1 px head bob, cape and hair one frame late | 3 |
| Attack | 2 frames | 4 – 5: anticipation held 2 frames → smear (weapon as a 2 – 3 px arc) → impact → recovery; plus cast and hit-flinch poses | 3 |
| Idle | 2 frames | sub-pixel breathing (shading rows move, outline does not), blink every 3 – 5 s | 3 |
| Silhouette test | — | each class look filled black must be told apart by weapon, headgear and cape (`tests/class-looks.test.ts`) | 2 |
| Monsters | 2 frames, identical | 4-frame idles with squash and stretch; a wind-up pose matching each telegraph; per instance: scale ±10%, 2 – 3 palette nudges, mirrored accessory, desynced phase | 1 (instance variation), 3 (frames) |
| Elites and wardens | scaled, tinted base sprite | their own silhouette: one exaggerated feature each (crown, extra limb, banner, broken horn) | 4 |
| Form sprites | — | 6 Legendary forms, 3 facings, 3 stages (§9.2) | 5 |

### 11.9 What not to do

No higher scatter density and no new random prop types. No per-pixel noise, extra dithering or soft alpha blobs. No
normal maps or full dynamic lighting on procedural sprites. No full-frame blur, tilt-shift or bloom. No mirrored
layouts or disc plazas. No recolours passed off as variety. No pillow shading, no pure-black shading, no
character-colour outlines on props. No interiors, weather or day-night gameplay in v4. Nothing traced or named from
the reference screenshot or any other game.

---

## 12. Plain words (additions to `docs/UX-SIMPLE.md` §1 rule 8)

Everything above obeys UX-SIMPLE: one line per thing, one primary action per screen, no internals. These rows are
added to its friendly-name table in Phase 1 (UI lane), and `tests/plain-text.test.ts` bans the left column from
player-facing strings.

| Internal | Shown as |
|---|---|
| `fists` weapon | Bare Hands |
| `staff` weapon | Rod |
| grip tag, `weapons`, `weaponOk` | never shown; the lock line reads "Needs a sword — Equip" |
| free / weapon-bound | never shown |
| class `rarity` | the word (Common … Mythic) + its colour + 1 – 6 pips |
| power source, grid | never shown; cards say "Sword · Fire" |
| signature mechanic | its own name only ("Heat", "Pinned Shadow"); the widget has no other label |
| kit / `classOf` | "Class skills" |
| class passive (worn) | "Gift" |
| class passive on another class | Keepsake |
| mastered (`rank ≥ 10`) | "Mastered" + gold border |
| Trial / Rite quest | Trial / Rite ("Begin Trial") |
| `EchoDef` | Echo |
| echo socket | Echo socket |
| witness marks | "Seen 2/3" (unchanged) |
| echo stars | ★ ★★ ★★★ |
| echo `before` / `after` / `costLine` | "Before", "After", "Cost" |
| `MaterialId`, pouch | Fangs, Motes, Cores, Sap, Dust, Sigils; "Pouch" |
| pity counter | never shown |
| drop chance | words only: "often", "about 1 in 2", "rare" |
| weapon level | "Sharpened ★★☆☆☆" (Bare Hands: "Hand Wraps ★★☆☆☆") |
| `DeedDef` | Deed |
| deed counter, tier | never shown as numbers; a riddle, then a bar from 75% |
| deed tree | by its name: "Shade Arts", "Waystep", "Hearthcraft" |
| `return_stone` | Return Stone |
| `form` mechanic, stage | "Form"; stage names Sign, Aspect, Avatar, Apotheosis |
| aftermath | its own name ("Molt") with a timer |
| combo (`comboFor`) | Combo; each by its one word ("Conduct") |
| skill kind, delivery, extra, signature | never shown |
| new statuses | Held (root), Airborne (launch), Exposed (expose), Lured (lure) |
| `hpCost` | "Costs HP" with a red heart instead of the SP drop |
| `autoRule` | never shown; one toggle on form classes: "Hold form" |
| stamp, zone, clearing, tier (elevation), apron | never shown |
| ambient townsfolk | no name tag at all |

One-line requirement examples (rule 4): "Land 12 more hits with a sword." · "Know Fire." · "Master Blademaster." ·
"Begin Trial (2 Sigils)" · "Seen 2/3 — defeat a Boulderback." · "Needs 5 Sap — Pipsprouts drop it."

---

## 13. Save migration (book state v2 → v3)

`src/core/save.ts migrateBookState` gains a v3 step; `SkillBookState.version` becomes `3`. Session save key becomes
`omnipath.save.v3`: read v3; else read v2 and migrate; else v1 → v2 → v3. An older key is never deleted before a v3
write has succeeded. The migration is pure, deterministic and idempotent; it takes the registry.

| # | Area | Rule |
|---|---|---|
| 1 | Weapons | `fists` is added to owned weapons. The held weapon is unchanged. `weaponLevel` = 0 for all four. |
| 2 | Class levels | Old max 10 / 8 / 5 (Tier I / II / III) → new max 10: `level = max(1, round(old × 10 / oldMax))`; XP inside the level is scaled by the ratio of the two curves and clamped. `spent` (tree points) is dropped. |
| 3 | Merged classes | `phantom → shadowstalker`, `vortex_dancer → tempest_dancer`, `prism_sage → elementalist`, `echo_sovereign → mimic`: the target takes the higher level of the two after rule 2, +1 level (max 10) if both were discovered. `worn` and whispers follow the target. |
| 4 | Discovered classes | Stay discovered, whatever their new requirements, Trials included (grandfathered). No Sigils are charged. |
| 5 | Keepsakes | `imprints` → `keepsakes`; entries whose class is not at Level 10 are removed and pay 2 Sigils each (one toast, §4.2). |
| 6 | Echo skills | For each known echo skill: `echoes[id] = { stars: rank ≤ 2 ? 1 : rank ≤ 4 ? 2 : 3 }`; the SkillProgress is removed. `witness` keys are already echo ids. |
| 7 | Variants on echo skills | Every generated skill whose base or merge parent is an echo skill is removed; each Rune on it returns to `essences`; each removed merge pays 5 Motes. |
| 8 | Class-only skills | A known skill that now has `classOf` and whose class the player has not discovered moves to `shelved` (rank kept) and returns when that class is discovered. Pays 3 Motes each. |
| 9 | Skill bar | Slots holding removed or shelved skills are cleared. Class slots are rebuilt from the worn class's kit; "your" slots are refilled by the existing auto-equip rule. Weapon-bound skills for another weapon stay on the bar, greyed. |
| 10 | Pouch | Starts at 0, then pays retroactively: every Bestiary milestone already reached (10 / 25 / 100 kills) pays its fixed materials; every elite and warden already beaten pays its first-kill Sigils. |
| 11 | Counters | Seeded from data the save already has: `maps_seen` from `visited:*`, `npcs_met` from `talk:*`, `elites_beaten` from the Bestiary, `echoes_known`, `classes_mastered`, `chests_opened`; existing gather and forge flags are reused as they are. Counters that were never tracked (`deaths`, `returns`, `hits_taken`, …) start at 0. |
| 12 | Deeds | The deed engine runs once over the seeded counters, silently applying grants, then one toast: "Your past adventures earned 4 deeds." |
| 13 | Return Stone | Granted. |
| 14 | Quests | Tamsin's Keepsake quests already completed stay completed; active ones are re-fitted by the existing objective migration. The Boulder Roll quest needs no change. |
| 15 | Passives | Derived passives are recomputed; nothing saved refers to `imprint_*`, `cls_*` or `tag_echo` (if an old save lists them in `passives`, they are dropped). |
| 16 | New fields | `echoOn {}`, `matPity {}`, `deeds {}`, `titles []`, `title null`, `shelved {}` are filled with empties. |

Nothing a player earned is lost without a stated payment: levels are scaled up, Keepsakes and shelved skills pay
materials, echo ranks become stars.

---

## 14. Tests that must exist

| File | Lane | Asserts |
|---|---|---|
| `tests/weapons.test.ts` (new) | core | `weaponOk` table; every grip-tagged skill has `weapons` and vice versa; Bare Hands basic and stats exist; body moves are free and get the bare-handed bonus |
| `tests/class-kits.test.ts` (new) | content | §3.4 kit rules 1 – 6 for every class, legacy kits included; **no two classes share more than 1 kit skill** |
| `tests/class-sim.test.ts` (new) | core | §3.5 rotation simulation: every class within ±10% of the Common median on AUTO; scripted manual ≤ +25%; Legendary cycle included |
| `tests/class-budget.test.ts` (rewritten) | core | bonus ≤ 10 points per skill; every class passive `budget` ≤ 5; total ≤ 45% |
| `tests/classes.test.ts` (rewritten) | core | discovery by `ClassDiscovery`; Trials unlock; level table of §3.4; mastery at 10; XP only when worn |
| `tests/mechanics.test.ts` (new) | core | each mechanic kind as a pure state machine: fills, decay, thresholds, spend, stance remap, mark cash-in, combo buffer, form cycle and aftermath; AUTO rules |
| `tests/passives.test.ts` (extended) | core | worn passive on; Keepsake only when mastered and slotted; slot counts 1 / 3 / 6; one per trigger; weapon-named Keepsakes need the weapon |
| `tests/echo.test.ts` (rewritten) | core + content | learn by sightings; no anchor; one Echo on one skill; move is one call; every Echo has a teacher that spawns, a cost, 3+ kinds, card lines ≤ 60 chars; an Echo never only changes numbers; buff-like kinds have 2+ Echoes |
| `tests/distinct.test.ts` (new) | content | §6.3 rules 1 – 5 over every player skill |
| `tests/budget.test.ts` (extended) | core | hit clamp and ±35% band for the new kinds and for every skill × fitting Echo |
| `tests/materials.test.ts` (new) | core | family → material; pity guarantees (common by the 3rd kill, elite Sigil by the 5th repeat); caps; every sink spends through `spendMaterials`; every material has a source reachable in Hearth Vale and at least one sink |
| `tests/deeds.test.ts` (new) | core + content | counter → grant; tiers; idempotent grants; every counter in data is in the client flag contract; hints present; anti-farm filters at the call sites (game-lane test `tests/game-deeds.test.ts`) |
| `tests/combat.test.ts` (extended) | core | the 12 combos of §10; the three old ones unchanged to the digit; one status per group |
| `tests/content.test.ts` (extended) | content | reachability now includes deed grants, Echo recipes, class kits; the Bare Hands tree is 1 / 3 / 6 / 3; every `classOf` skill is in exactly its class's kit or form bar |
| `tests/names.test.ts` (new) | content | banned-word list of §3.9 and SPEC-v2 §9 over all names and descriptions |
| `tests/plain-text.test.ts` (extended) | ui | §12 left column never appears in player strings; descriptions ≤ 60 characters where rule 1 asks |
| `tests/save.test.ts` (extended) | core | §13 rules 1 – 16 on three fixtures (v1, early v2, late v2 with all classes, echoes and echo variants); idempotence; v2 key kept until a v3 write |
| `tests/world.test.ts` (extended) | art+maps | V1 – V13 on the converted-map list; Hearthvale portals still pair; reachability with elevation |
| `tests/render-props.test.ts` (extended) | art+maps | cast shadow baked for every world and actor texture; no `shadow()` ellipse left; size tiers have 3+ variants; no variant repeat within 6 tiles |
| `tests/render-ground.test.ts` (extended) | art+maps | value plan per biome; ramp tables match §11.2 H |
| `tests/class-looks.test.ts` (extended) | art+maps | a look for every class × 4 weapons; silhouette test |
| `tests/vfx-recipes.test.ts` (extended) | vfx | a recipe for every new kind, every `EchoBehaviour.do`, every mechanic event and all six form transitions; no fallback effect |
| `tests/hud.test.ts` (extended) | ui | HUD diet defaults; one mechanic widget; lock line on bound skills |

---

## 15. Build plan

### 15.1 Lanes (exclusive file ownership; a lane never edits another lane's files)

| Lane | Owns |
|---|---|
| **A. Core rules** | `src/core/**` except `src/core/world/**`; the core tests |
| **B. Content data** | `src/data/**` except `src/data/maps/**` and `src/data/stamps/**`; `tests/content`, `distinct`, `class-kits`, `names` |
| **C. Game systems** | `src/game/systems/**`, `src/game/scenes/**`, `src/game/entities/**`, `src/game/session.ts`, `loadout.ts`, `steps.ts`, `quests.ts`, `events.ts`, `views.ts`, `world/runtime.ts` |
| **D. UI** | `src/ui/**`, `docs/UX-SIMPLE.md` |
| **E. Art + maps** | `src/game/art/**`, `src/game/render/**`, `src/core/world/**`, `src/data/maps/**`, `src/data/stamps/**`, `docs/ART-DIRECTION.md` |
| **F. VFX + audio** | `src/game/vfx/**`, `src/game/audio/**`, `docs/VFX.md` |
| Lead (contract commits only) | `src/core/types.ts`, `src/core/state.ts`, `src/core/world/types.ts` shapes, `docs/SPEC-v4.md`, `package.json` |

Unlisted files follow their folder: `src/game/textures.ts` → E, `src/main.ts` → C, each test file → the lane named in §14.

**Every phase starts with a contract commit** by lane A (and lane E for world types): the phase's type changes in
`src/core/types.ts`, `state.ts` and `world/types.ts`, with stubs, so the other lanes build in parallel against fixed
types. Every phase ends with `npm test`, `npx tsc --noEmit`, a save loaded from the previous phase, and the
screenshot script. **The game is playable and shippable after each phase.**

### 15.2 Phase 1 — "Classes differ, the world is grounded" (the smallest slice)

Fixes sentence 1 ("classes … same abilities"), 13, 14 and the first half of 4 ("looks AI-made").

| Lane | Work | Files |
|---|---|---|
| A | `WeaponType` + `fists`, `weaponOk`; `ClassDef` v4, `CLASS` constants, kit-based `classSkills`, class levels, XP only when worn; mechanic engine for gauge, combo, marks, stance, zone (pure state machines + AUTO rules); shapes zone, blink, mend, shield; statuses root, launch, expose, lure; `delivery` / `extra` fields; save v3 skeleton (rules 1 – 4, 8, 9, 15, 16); class-sim harness. Today's Keepsakes (`imprint_*`, unlocked at Class Level 5) keep working unchanged until Phase 2; only the tree nodes go | `types.ts`, `state.ts`, `classes.ts`, `mechanics.ts` (new), `requirements.ts`, `combat.ts`, `compose.ts`, `balance.ts`, `passives.ts`, `save.ts`, `skillbook.ts`, `registry.ts` |
| B | Bare Hands weapon and tree; grip retag pass; `delivery` / `extra` on all skills; §6.4 re-authoring until `distinct.test` passes; **8 rebuilt classes** (Blademaster, Knife Juggler, Spellwright, Wayfarer, Pyroblade, Shadowstalker, Pyromancer, Tidereader) with kits, mechanics and passives; **legacy kits** for the other 18 surviving classes; 4 class merges; discovery data for all 26 | `weapons.ts`, `skills/fists.ts` (new), `skills/classes/*.ts` (new), `skills/*.ts`, `morphs/*`, `classes.ts`, `passives.ts`, `recipes/*` |
| C | `usable()` → `weaponOk`; Bare Hands equip, swap cooldown, auto-equip on Become; runtime for the 4 new kinds and the shared `WorldObject`; mechanic runtime (events in, effects out); new statuses; counters `hits:<weapon>`, `kills:<weapon>:<element>`; monster instance variation hooks | `MapScene.ts`, `SkillSystem.ts`, `Combat.ts`, `MonsterSkills.ts`, `entities/*`, `session.ts`, `loadout.ts` |
| D | Class screen: rarity, silhouettes, "Become" equips the weapon; lock line "Needs a sword — Equip"; the mechanic widget; HUD diet (§11.7); friendly names of §12 | `panels/classes.ts`, `panels/skills.ts`, `panels/bag.ts`, `hud/**`, `words.ts`, `UX-SIMPLE.md` |
| E | Cast shadows (A); size tiers with 3 variants (B); rule dressing with derived clearings (D); layered forest edge (E); ramps and value plan (H); HUD frames in three weights and the two faces; Bare Hands look and 8 class looks; monster instance variation | `art/ui.ts`, `render/fonts.ts`, `render/glyphs.ts`, `art/common.ts`, `art/world.ts`, `art/pixel.ts`, `art/tiles.ts`, `art/characters.ts`, `art/classLooks.ts`, `art/monsters.ts`, `render/dressing.ts`, `render/stage.ts`, `render/depths.ts`, `core/world/compile.ts` |
| F | Recipes for zone, blink, mend, shield; mechanic feedback (meter full, finisher, cash-in, stance swap) in VFX and sound; fist impact set | `vfx/recipe.ts`, `vfx/signatures.ts`, `vfx/components/*`, `audio/bank.ts`, `audio/bridge.ts` |

**Acceptance**
1. `class-kits.test`: no two of the 26 classes share more than 1 kit skill (today: 13 identical pairs).
2. Holding a Rod, Whirlwind shows "Needs a sword — Equip" and cannot be cast; Ember Dart casts with a sword.
3. A fresh save can play Bare Hands from the first minute to Wayfarer and through the fists tree's T1.
4. Each of the 8 rebuilt classes shows its widget and its mechanic changes what the bar does (scripted in
   `mechanics.test`); `class-sim.test` passes for them.
5. `distinct.test` passes over all player skills.
6. A late-v2 save loads; its merged classes, levels and bar are as §13 says.
7. Screenshots of Greenmeadow, Gloomwood and Hearthvale show: sheared violet cast shadows, at least one prop three
   heroes tall, clean clearings round monsters, a layered forest edge, the slimmer HUD. Side-by-side with the audit's
   shots in the review.

### 15.3 Phase 2 — "Echoes, drops, deeds and a real town"

Fixes sentences 2, 5, 6, 10 and the town half of 7.

| Lane | Work |
|---|---|
| A | `EchoDef`, `applyEcho`, echo state and API, `echo:` ingredients, witness rename; materials (pouch, pity, `spendMaterials`, sinks in fusion, Transforms, sockets); weapon levels; deed engine and `deed` requirement; Keepsakes (§4); Trials (`trialOf`); shapes trap, tether, summon, counter; save rules 5 – 7, 10 – 14 |
| B | 27 Echoes; recipe and morph conversion (§5.4); material overrides, sink costs; 36 deeds; Shade Arts, Waystep, Hearthcraft; Return Stone; **12 classes** (Oathsworn, Windblade, Tempest Dancer, Earthshaper, Stormcaller, Feverfist, Riverbone, Menhir, Kitefist, Gloamhost, Hollow Cantor, Wakeblade); class passives for all classes built so far; Trial quests; Tamsin quest re-text; new-kind example skills for the 8 kinds built so far |
| C | Echo runtime hooks (cast, path, hit, kill, after); drops, pity and toasts; all deed counters with their anti-farm filters; Return Stone; weapon upgrade and draught shop paths; Trial flow; runtime for 4 kinds; ambient townsfolk and the cat; roof fade; elevation in movement |
| D | Echo socket sheet with Before / After / Cost; Pouch; Bestiary card (§7.5); Deeds page and Rumours; Keepsake picker on the new rule; Trial card; cost buttons with have / need and reverse lookup |
| E | Map format additions and V1 – V13; stamps; elevation tiles and autotile; building kit; ground and paths (I); **Hearthvale rebuild**; Greenmeadow and Gloomwood converted (landmarks, clearings, tiers); 12 class looks; silhouette test |
| F | 27 Echo motifs; trap, tether, summon, counter recipes; material pickup, deed and Trial stingers; town ambience bed for the river, mill and market |

**Files touched** — A: `types.ts`, `state.ts`, `echo.ts`, `compose.ts`, `fusion.ts`, `materials.ts` (new), `deeds.ts` (new),
`classes.ts`, `passives.ts`, `quests.ts`, `skillbook.ts`, `save.ts` · B: `echoes.ts` (new), `skills/echoes.ts` (removed),
`skills/monster.ts`, `skills/deeds.ts` (new), `skills/classes/*`, `recipes/*`, `morphs/*`, `monsters.ts`, `deeds.ts` (new),
`classes.ts`, `passives.ts`, `items.ts`, `quests.ts`, `npcs.ts` · C: `Combat.ts`, `SkillSystem.ts`, `MonsterSkills.ts`,
`Interactions.ts`, `MapScene.ts`, `entities/*`, `session.ts`, `world/runtime.ts` · D: `panels/{skills,altar,codex,classes,bag,npc,quests}.ts`,
`announce.ts`, `hud/**`, `words.ts` · E: `core/world/{types,compile,validate,pathfinding,tiles}.ts`, `data/stamps/*` (new),
`data/maps/vale/{hearthvale,greenmeadow,gloomwood}.ts`, `art/{world,tiles,classLooks,characters}.ts`,
`render/{autotile,ground,stage,dressing}.ts` · F: `vfx/{recipe,signatures,pieces}.ts`, `vfx/components/*`, `vfx/runtime/*`,
`audio/{bank,bridge,ambience}.ts`.

**Acceptance:** learn Rolling from a Boulderback in "Seen 3/3", put it on Sword Throw in one tap, see the card's
Before / After / Cost and the throw roll to the wall. Every monster drops its material; the Bestiary shows what for;
each of the six sinks spends through the UI. Fall 10 times (legitimately) and Dim the Lights arrives; five Return
Stone trips bring Short Hop. A class at Level 10 offers its Keepsake; one at Level 9 does not. Hearthvale passes
V1 – V13, shows the tree from every gate, and all four NPCs stand at their places. An early-v2 and a Phase-1 save
both load.

### 15.4 Phase 3 — "The grid fills in, the Vale is composed"

| Lane | Work |
|---|---|
| A | Shapes orbit, rain, beam, charge; combos 4 – 12 (§10); remaining passive triggers |
| B | **15 classes** (Tidefencer, Glyphwarden, Stormwhirl, Spellblade, Hushblade, Fusewright, Mistknife, Burrowfang, Voltscribe, Candlethief, Chimewright, Moonwarden, Prismcaller, Nervefire, Palmlight) with Trials; example skills for the 4 new kinds; legacy kits retired for these ids |
| C | Runtime for the 4 kinds; combo popups and counters; player facings in movement and targeting; monster wind-up poses |
| D | Combos page; status and combo icons on skill cards |
| E | All remaining outdoor Vale maps converted (§11.5 Phase-3 rows) incl. Emberwatch; daylight (J); water (K); player front and back facings, 6-frame walk, attack frames; monster 4-frame idles; 15 class looks |
| F | Recipes for orbit, rain, beam, charge; 9 combo words and sounds |

**Files touched** — A: `types.ts`, `combat.ts`, `compose.ts`, `mechanics.ts`, `passives.ts` · B: `skills/classes/*`,
`skills/*.ts`, `classes.ts`, `passives.ts`, `recipes/*`, `quests.ts` · C: `SkillSystem.ts`, `Combat.ts`, `MapScene.ts`,
`entities/*` · D: `panels/codex.ts`, `panels/skills.ts`, `starchart/card.ts` · E: the Phase-3 rows of §11.5 under
`data/maps/vale/*`, `data/stamps/*`, `render/{lighting,ambient,grade,stage}.ts`, `art/{characters,classLooks,monsters,tiles}.ts`
· F: `vfx/recipe.ts`, `vfx/components/*`, `audio/bank.ts`.

**Acceptance:** 35 classes pass kits, sim and looks tests; all 12 combos fire in `combat.test` and on screen; every
outdoor Vale map passes V1 – V13 and its thumbnail review; the hero turns to face up and down.

### 15.5 Phase 4 — "Fused elements, Epics, the Rift"

| Lane | Work |
|---|---|
| A | Shape wall; any rule gaps from the Epic mechanics (two-sided gauge, pause zone) |
| B | **16 classes** (Rimecutter, Magma Knight, Ascendant, Sword Saint, Frostneedle, Glassfang, Eclipse Walker, Archmage, Stillwater Seer, Calderamancer, Twilight Sage, Knucklesaint, Frostmarrow, Slagheart, Thunderhide, Mimic); wall examples; all legacy kits gone |
| C | Wall runtime and pathing; Mimic's second Echo socket and Mirror |
| D | Polish pass on every v4 screen against UX-SIMPLE |
| E | Dungeons, arenas, secrets and all six Rift maps converted; **Riftmarch rebuild**; elite and warden silhouettes; 16 looks |
| F | Wall recipes; warden-specific Echo motifs; Riftmarch ambience |

**Files touched** — A: `types.ts`, `mechanics.ts`, `compose.ts` · B: `skills/classes/*`, `classes.ts`, `passives.ts`,
`recipes/*`, `quests.ts` · C: `SkillSystem.ts`, `world/runtime.ts`, `entities/*` · D: `panels/*`, `hud/**` · E: the Phase-4
rows of §11.5 under `data/maps/vale/*` and `data/maps/rift/*`, `data/stamps/*`, `art/{monsters,world,classLooks}.ts` · F:
`vfx/recipe.ts`, `vfx/components/*`, `audio/{bank,ambience}.ts`.

**Acceptance:** 51 classes; all 28 maps on the converted list and passing; no legacy kit left in data.

### 15.6 Phase 5 — "Legendary and Mythic"

| Lane | Work |
|---|---|
| A | Form mechanic: stages, flat drain, time rule, aftermath, AUTO "Hold"; `hpCost`; Legendary sim cycle |
| B | 6 Legendary classes (base kits, form bars, chains, Rites), 2 Mythic classes and their secret deeds |
| C | Form swap runtime (bar, sprite, hitbox), Embers pickups, Mercy surrender, link-and-close for Starwrit |
| D | Form meter and "Hold form" toggle; stage names; aftermath timer |
| E | 6 form sprites × 3 stages × 3 facings; Mythic looks; Rite set dressing in existing arenas |
| F | Six transformation sequences, form loops, aftermath cues |

**Files touched** — A: `types.ts`, `mechanics.ts`, `classes.ts`, `balance.ts` · B: `skills/classes/legendary/*` (new),
`classes.ts`, `deeds.ts`, `quests.ts`, `passives.ts` · C: `SkillSystem.ts`, `Combat.ts`, `MapScene.ts`, `entities/Player.ts`,
`entities/looks.ts` · D: `hud/**`, `panels/classes.ts` · E: `art/forms.ts` (new), `art/{characters,classLooks}.ts`,
`data/stamps/*` · F: `vfx/signatures.ts`, `vfx/runtime/*`, `audio/bank.ts`.

**Acceptance:** all 59 classes pass kits and sim; a full Dragon cycle (build, Sign at Level 1, Avatar at Level 7,
Molt) plays on screen; a line's average damage over a cycle is inside the band.

### 15.7 What is Phase 1 and what is later, at a glance

| Owner complaint | Phase 1 delivers | Later |
|---|---|---|
| Classes feel the same | Explicit kits and the overlap test for all 26 classes; 8 rebuilt with mechanics; weapon gating; Bare Hands | 51 more class builds (Phases 2 – 5) |
| Looks AI-made | Cast shadows, size tiers, rule dressing with clearings, forest edges, ramps, HUD diet, monster variation | Stamps, elevation, Hearthvale, building kit (2); light, water, animation (3); Rift and dungeons (4) |
| Echoes, drops, passives, deeds, legendary, synergies | types only | Phases 2 – 5 |

---

## 16. Research use, tunables and decisions

### 16.1 What the research changed

| Research said | This spec |
|---|---|
| One bespoke system per class; one visible gauge is what players remember | Adopted: one signature mechanic per class from 6 reusable kinds |
| 48-cell weapon × source matrix with sword "forms", dagger "seals", rod "rites", fist "embodiment" | Adopted as row grammars, remapped to the real 30 ids; "forms" and "seals" wording dropped for originality (§3.9) |
| Rarity = discovery cost on a flat budget; never sell unlocks | Adopted; enforced by the rotation simulation |
| Mastery exports one passive; 3 slots at 1 / 3 / 7 mastered; home bonus +50% | Adopted with 1 / 3 / 6 and **no** home bonus (one number per passive) |
| Legendary line as an overlay on top of a class, with a suppress fork | **Changed:** a line is a Legendary class (one framework). The fork is dropped. |
| Accelerating drain is hated | Adopted: flat drain only |
| Echo = behaviour socket; essences = numbers; unlock once, swap free | Adopted. Research assumed Bow and Poison and a Wet status; remapped to the real weapons, elements and `soak`. |
| An Echo usable on 2 skills at once | **Changed:** 1 skill at a time (simpler to read) |
| 30 delivery verbs, four-field signature | Adopted as 13 new kinds + `delivery` + `extra`; transform, rewind and roaming pets rejected for v4 |
| Six material families with grades and a wildcard | Adopted as six plain counters, **no grades, no wildcard** (a 4 → 1 swap instead) |
| 50 deed ideas; hint layers; anti-grind rules | 36 adopted or rewritten; ideas needing systems the game lacks (weather, day/night, parties, cooking, inns) rejected |
| Twelve synergies incl. surfaces and Kinship set bonus | 12 adopted on the real statuses; the 3 existing combos kept exactly; Kinship rejected |
| Visual report: 12 causes, 15 changes, Hearthvale brief, format additions | Adopted in full; Hearthvale sized 64 × 48 (not 68 × 52) to reuse the field size limit |

### 16.2 Tunables index (every **[T]**)

`WEAPONS.fists` stats · `WEAPON.bodyBonus`, swap cooldown · `CLASS.kitAt`, `xpMul`, `keepsakeSlotsAt` · discovery
counts (60 hits, 20 wins) · every number in a mechanic or passive line of §3.6 · sim bands (±10%, +25%) · Echo
sightings, star costs, `scale`, every Echo cost · `expose` strength, AUTO counter rate, object cap · every drop
chance, amount, pity step and sink cost of §7 · every deed threshold and cap of §8 · Return Stone cooldown · `FORM`
lengths and time rules · `COMBOS` 4 – 12 · dressing spacings, area mix, tallness radius, shadow shear and opacity.

### 16.3 Decisions the owner may want to overrule

Each of these is one constant or one table row in this file.

1. **A Legendary line is a class**, not an overlay on top of your class (§9). Dragon form cannot be worn with Pyroblade.
2. **59 classes** in five phases; 33 are new. Cutting to the 26 surviving ids plus the Bare Hands row is possible.
3. **Four classes are merged away** (Phantom, Vortex Dancer, Prism Sage, Echo Sovereign) and **four are renamed** on
   screen (Hushblade, Spellwright, Tidereader, Prismcaller).
4. **The class tree and its points are removed**; Class Levels give fixed rewards (§3.4).
5. **Every class tops out at Level 10**, and class XP comes only from the worn class.
6. **Elemental spells are free of the Rod** (weak without MATK); only the Rod's own unaligned workings are bound (§2.2).
7. **Bare Hands numbers** (8 / 8 / 8, fast) and "body moves hit 20% harder bare-handed".
8. **One Echo socket per skill, an Echo sits on one skill at a time**, and Echoes are overlays, not new skill ids.
9. **Echo skills are converted, not refunded** as skills; old echo ranks become stars.
10. **Six materials with no grades**; monsters keep their current item drops as well.
11. **Fusion, Transforms and sockets now cost materials** (first time only for fusion).
12. **Weapon upgrades** are a new system (+6% per level, 5 levels) to give Fangs a sink.
13. **Keepsakes are slotted (1 / 3 / 6 mastered), not always on**, with no home bonus; old Keepsakes pay 2 Sigils.
14. **Deaths count at most 2 per 10 minutes**; the **Return Stone** is a new reusable item with an 8-minute cooldown.
15. **Trials and Rites** (Sigil-cost quests) gate Rare and above; saves keep classes they already have.
16. **Hearthvale grows to 64 × 48 tiles**, gets no interiors, and its four NPCs gain the new services (no new NPCs).
17. **No roaming pets, weather, day/night or interiors in v4.**
18. **The rotation simulation**, not hand tuning, decides whether a class is inside the power band.

### 16.4 Documents to update as phases land (not changed by this spec)

`docs/SPEC-v2.md` §4.3, §4.5, §5, §5.1, §7.2 sizes, §8 class and echo manifests (mark "superseded by SPEC-v4") ·
`docs/UX-SIMPLE.md` rule 8 table (§12) and rule 7 (Keepsakes appear at the first mastered class) ·
`docs/ART-DIRECTION.md` §2, §3, §4 · `docs/VFX.md` §6.2 – §6.3 (new kinds, Echo motifs) · `docs/QUESTS.md`
(`trialOf`, Tamsin re-text) · `docs/CLIENT-v3.md` §5 – §6.
