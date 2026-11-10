# Omnipath — Simple & Intuitive UI rules (owner direction)

The owner's feedback: *"The skill system, especially equipping, is confusing. Everything needs to be simple and
intuitive, not AI data-driven explanations."* Every screen, card, toast and dialog follows these rules. If a design
needs a paragraph to explain, the design is wrong — simplify the design, not the paragraph.

## 1. Rules
1. **One short line per thing.** Skill, class, quest and item descriptions are one sentence, ideally under 60
   characters, written like a game, not a manual ("Spin and slash everything around you.").
2. **Never show internals.** No tags, tiers, ids, threat, clauses, "CR", "tagPower", "+3%/rank", formulas, slot
   rules, requirement data structures, "essence category", "propagate", "hardened", "variant", "merge".
3. **Show, don't tell.** Use icons, rank stars (★★★☆☆), progress bars, glows and colours. Numbers only where players
   expect them: HP/SP, damage numbers, cooldown seconds, item counts, Class Level, coin prices.
4. **One clear next step instead of a checklist.** "Reach rank 10 to transform." / "Learn 1 more fire skill." /
   "Find the Storm relic." Show only the FIRST unmet requirement, never the whole list (a "?" icon can reveal more).
5. **One primary action per screen**, big and obvious (Equip, Become, Transform, Fuse, Accept, Complete). Secondary
   actions are small. Destructive actions ask a one-line confirm.
6. **Automatic by default.** Classes equip their own skills; new skills drop into empty slots; AUTO battles for you.
   The player only decides what is fun to decide.
7. **Progressive disclosure.** Hide systems until they matter: Fusion appears after the first element; Essences after
   the first essence; Keepsakes (imprints) after the first Class Level 5; the Codex tabs appear as they get content.
   Advanced numbers live behind a small "Details" toggle, closed by default.
8. **Friendly names** (player-facing only; ids unchanged):
   | internal | shown as |
   |---|---|
   | Class Rank / CR | Class Level |
   | morph | Transform |
   | morph charge | Transform ready (✨) |
   | overmastery | Mastery bar (after max rank) |
   | imprint | Keepsake |
   | witness marks | "Seen 2/3" |
   | spark | Sudden insight |
   | essence slot | Rune socket |
   | tag passive | Mastery bonus |
   | resonance | Element bond |
   | threat / grey XP | "Too weak to learn from" (only shown when it happens) |

   **v4 additions** (docs/SPEC-v4.md §12; `src/ui/words.ts` holds the words, `tests/plain-text.test.ts` bans the
   left column from player-facing strings):
   | internal | shown as |
   |---|---|
   | `fists` weapon | Bare Hands |
   | `staff` weapon | Rod |
   | grip tag, `weapons`, `weaponOk` | never shown; the lock line reads "Needs a sword — Equip" |
   | free / weapon-bound | never shown |
   | class `rarity` | the word (Common … Mythic) + its colour + 1 – 6 pips |
   | power source, grid | never shown; cards say "Sword · Fire" |
   | signature mechanic | its own name only ("Heat", "Pinned Shadow"); the widget has no other label |
   | kit / `classOf` | "Class skills" |
   | class tree, node, point | gone: "Class Level 4 — New skill: Flame Wheel" (one fixed reward per level) |
   | class passive (worn) | "Gift" |
   | class passive on another class | Keepsake |
   | mastered (`rank ≥ 10`) | "Mastered" + gold border |
   | Trial / Rite quest | Trial / Rite ("Begin Trial") |
   | `EchoDef` | Echo |
   | echo socket | Echo socket |
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
9. **Teach in the moment, not in walls of text**: a single toast or a 1-line hint the first time something happens
   ("Hold the ⚔ button to keep swinging"). Dialogs are ≤ 3 short sentences.
10. **Consistency**: the same icon/colour always means the same thing (✨ transform ready, ★ rank, 🔒 locked,
    ? unknown, gold = new). A class's rarity is always the same tag — colour, word and pips — on every card,
    silhouette and announcement: Common grey, Uncommon green, Rare blue, Epic violet, Legendary gold, Mythic rose.
11. **The HUD stays out of the way** (SPEC-v4 §11.7). Three frame weights: heavy (portrait, attack button), light
    (slots, menu buttons), none (text you only read sits on a soft dark strip). Gold only on things you can tap. One
    plain pixel face for text and numbers, the drawn display face for place names; three sizes. Nothing covers the
    middle of the screen. Every touch target is at least 44 px. A new permanent HUD element must replace an old one.

## 2. Before / after
| before | after |
|---|---|
| "Requires: Whirlwind rank 5, Attune Wind, Ironroot relic, 2 skills tagged blade + fire (rank 5)" | "Reach Whirlwind rank 5" (+ small "?" for the rest) |
| "+3% blade damage per rank (rank 2/5) · tag total 31" | "Blade Mastery ★★☆☆☆ — blade skills hit harder" |
| "Power 130% · 6 SP · 2.2 s · Projectile · pierce 1 · tier 1" | "Throw your sword through the first foe." · 6 SP · 2.2 s |
| "Tier II hybrid: parents spellblade CR6 + earthshaper CR6; clause 2×blade 2×arcane hardened" | "Glyphwarden — reach Class Level 6 as Spellblade and Earthshaper." |
| A list of 8 classes with clause bars | Unlocked classes as big cards with outfit preview + "Become"; locked ones as silhouettes with ONE hint line |
| "Requires weapon: sword (tag blade)" | "Needs a sword — Equip" on the card and on the dimmed bar slot; one tap swaps |
| A Perks tab with points to spend | "Next: Class Level 4 — New skill: Flame Wheel" and the five class skills with their levels |
| "Heat gauge 3/10 (threshold 5: +20% power)" | A small bar named "Heat" above the class slots; it turns gold when it is ready |
| Stat strip, "Explored 42%", two quest cards and a 3-line log always on screen | Stats in the Class screen, explored % in the Map, ONE tracker line (tap to open), a log that fades after 4 s |

## 3. Skills & equipping (the part that confused the owner)
- The bottom bar shows **5 class slots + 3 of your slots**. Class slots carry the class emblem; when you become a
  class they fill themselves. Your slots: tap → pick a skill from a simple icon grid → done.
- A skill card has: big icon, name, ★ rank, one line, cooldown/SP, and ONE action: **Equip** (or "Equipped ✓"),
  **Transform** when ready, or the one next step. Everything else is behind "Details".
- The Star Chart is for wonder and discovery, not for equipping chores: tapping a star opens the same simple card.
- Class screen: your current class at the top (outfit, rarity, "Sword · Fire", Class Level bar, the next reward as
  one line, its five class skills with the level that opens each, its Gift, "Change class"), unlocked classes as
  cards with **Become**, locked classes as silhouettes in their rarity colour with one hint. No pattern math, no
  points to spend: Class Levels give fixed rewards.
- **Become also equips the class's weapon.** The card says so in one short line only when your weapon will change
  ("Also equips your Rogue Dagger." / "Also puts your weapon away.").
- **If a move uses a weapon, you need that weapon.** A skill that needs another weapon stays where it is, dimmed,
  wearing that weapon's icon; its card and its slot read "Needs a sword — Equip" and one tap swaps the weapon (when
  you own it). Bare Hands is a weapon in the Bag: "Bare Hands — put your weapon away".
- **The class mechanic** is one small widget above the class slots, labelled only by its own name: a bar (meters),
  round pips (combos), diamonds with a count (marks on your target), a two-sided toggle (stances; tap to switch)
  or small squares (things you place). A one-line hint explains it the first time it appears.
