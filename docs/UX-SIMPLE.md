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
9. **Teach in the moment, not in walls of text**: a single toast or a 1-line hint the first time something happens
   ("Hold the ⚔ button to keep swinging"). Dialogs are ≤ 3 short sentences.
10. **Consistency**: the same icon/colour always means the same thing (✨ transform ready, ★ rank, 🔒 locked,
    ? unknown, gold = new).

## 2. Before / after
| before | after |
|---|---|
| "Requires: Whirlwind rank 5, Attune Wind, Ironroot relic, 2 skills tagged blade + fire (rank 5)" | "Reach Whirlwind rank 5" (+ small "?" for the rest) |
| "+3% blade damage per rank (rank 2/5) · tag total 31" | "Blade Mastery ★★☆☆☆ — blade skills hit harder" |
| "Power 130% · 6 SP · 2.2 s · Projectile · pierce 1 · tier 1" | "Throw your sword through the first foe." · 6 SP · 2.2 s |
| "Tier II hybrid: parents spellblade CR6 + earthshaper CR6; clause 2×blade 2×arcane hardened" | "Glyphwarden — reach Class Level 6 as Spellblade and Earthshaper." |
| A list of 8 classes with clause bars | Unlocked classes as big cards with outfit preview + "Become"; locked ones as silhouettes with ONE hint line |

## 3. Skills & equipping (the part that confused the owner)
- The bottom bar shows **5 class slots + 3 of your slots**. Class slots carry the class emblem; when you become a
  class they fill themselves. Your slots: tap → pick a skill from a simple icon grid → done.
- A skill card has: big icon, name, ★ rank, one line, cooldown/SP, and ONE action: **Equip** (or "Equipped ✓"),
  **Transform** when ready, or the one next step. Everything else is behind "Details".
- The Star Chart is for wonder and discovery, not for equipping chores: tapping a star opens the same simple card.
- Class screen: your current class at the top (outfit, Class Level bar, "Change class"), unlocked classes as cards
  with **Become**, locked classes as silhouettes with one hint. No pattern math.
