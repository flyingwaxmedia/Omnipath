# Omnipath — Design overview (v4, Phase 1 built)

> An original 2D pixel-art action RPG for the iPad and phones, in the spirit of early-2000s MMOs.
> No skill is ever handed to you from a menu: every technique, element and class is **discovered** by mastering,
> transforming and fusing what you already know, and by helping the people of the world.

This page is the short overview. The detailed, binding documents are:

| Document | What it decides |
|---|---|
| [SPEC-v4.md](SPEC-v4.md) | **The design of record.** Weapons and weapon gating, Bare Hands, the class grid (kits, one mechanic each, rarity, Gifts), new skill kinds, the visual rebuild, save migration v2 → v3, and the build plan in five phases. Phase 1 is built (§15.2 has its status); where it and an older document disagree, SPEC-v4 wins. |
| [SPEC-v2.md](SPEC-v2.md) | The rules: mastery, combat, essences and fusion, discovery systems, classes (§5.1: class slots + your slots), saves, world and content manifests. The contract for `src/core` and `src/data`. |
| [CLIENT-v3.md](CLIENT-v3.md) | The v3 client: art integration, HUD v3 (no joystick), Star Chart, quest UI, class looks, the 8-slot bar. Builds on [CLIENT-v2.md](CLIENT-v2.md) (scenes, interactions, AUTO, saves). |
| [UX-SIMPLE.md](UX-SIMPLE.md) | The plain-language rules every screen follows: one short line, show don't tell, one primary action, automatic by default, friendly names. **Binding.** |
| [QUESTS.md](QUESTS.md) | Quests: data model, engine, content rules. Every NPC has quests; trainers teach only through them. |
| [QUALITY-PLAN.md](QUALITY-PLAN.md) | The free quality plan: pixel-perfect rendering, depth layers, event bus, pixel fonts, audio, hit feel, mood, QA. |
| [VFX.md](VFX.md) | Spell and combat effects: 17 families, components, recipes, the runtime and its budgets. |
| [INTEGRATION-v3.md](INTEGRATION-v3.md) | How the v3 client was split into lanes: file ownership, seams, depth layers, the game event bus, controller views, playtest selectors. |
| [ART-DIRECTION.md](ART-DIRECTION.md) | The "Lush Pixel" look: palette, world and character rules, HUD layout, icons, camera. |

---

## 1. Pillars

1. **Every skill is earned by doing.** Using a skill is the only way to grow it.
2. **Discovery over selection.** No class picker, no skill-point menu. Players experiment as in an alchemy game.
3. **Keep what you had.** Transforming and fusing *add* skills; nothing is consumed.
4. **The world is the tutorial.** Elements hide in ordinary activities (forging, fishing, mining, meditating,
   hunting), and every NPC has quests that point the way.
5. **Simple and automatic** (owner direction, [UX-SIMPLE.md](UX-SIMPLE.md)). Classes equip their own skills, new skills
   drop into empty slots, AUTO fights for you. The player only decides what is fun to decide.
6. **Classes play differently** (v4). A class is a weapon plus a power source with five skills of its own and ONE
   mechanic only it has. No two classes share more than one class skill; rarity is how hard a class is to find, never
   how strong it is (one power band, held by tests).

## 2. Core loop

```
 fight / quest ──► skill gains mastery ──► rank up (★) ──► full rank ──► TRANSFORM (original kept)
       ▲                                                                       │
       │                                                                       ▼
 new skills ◄── FUSION ALTAR ◄── elements found by doing (forge, fish, mine, meditate, wardens)
       │
       ▼
 the weapon you HOLD and how you fight ──► CLASS UNLOCKED ──► Become it: its weapon, its five skills, its outfit
                                                              └─► wear it to level it (1..10) ──► Mastered
```

## 3. Systems at a glance

- **Weapons** (v4): Sword, Dagger, Rod and **Bare Hands** (nothing equipped is a weapon, with its own tree from Jab).
  A skill bound to a weapon needs that weapon in hand ("Needs a sword — Equip", one tap swaps; a short cooldown in a
  fight); spells and body moves are free. → SPEC-v4 §2.
- **Skills** (about 200 authored, plus procedural element infusions). Four weapon trees, elemental, technique, echo
  and class skills. Eleven kinds: strike, spin, projectile, nova, chain, dash, buff, and since v4 **zone** (something
  that stays on the ground), **blink**, **mend** and **shield**. Every skill declares how it is delivered and the one
  extra thing it does; `distinct.test` refuses two skills that are the same but for the name, and
  `skill-promises.test` refuses a declared effect the game does not have. → SPEC-v2 §1–§4, SPEC-v4 §6.
- **Mastery and transforms.** Use a skill to rank it; at full rank it can transform into a new skill (some forms are
  hidden behind world deeds). → SPEC-v2 §1, §4.1.
- **Elements and fusion.** 7 primal elements found in the world, 4 fused ones. The altar fuses skill + element,
  skill + skill and element + element; failed tries whisper hints. Class skills are never fusion ingredients.
  → SPEC-v2 §3.
- **Classes** (26). Found by doing: hits with a weapon (the four Commons), kills with an element while holding a
  weapon (Uncommons), mastering an earlier class (Rares and Epics). **Becoming** a class equips its weapon and puts
  its **kit** — five skills only it has, unlocked at Class Levels 1, 1, 2, 4, 6 — in the 5 class slots (a slot whose
  skill is not known yet borrows a fitting skill). A class levels only while worn (1..10, the mechanic upgrades at 8,
  Mastered at 10) and has a **Gift**, a rule that is on while it is worn. Each class has one **mechanic** with one HUD
  widget: a gauge (Heat, Juggle), a combo (Cadence, Weave, Road Rhythm), marks (Pinned Shadow), a stance (the tide)
  or a placed object (the Hearth). Eight classes are rebuilt this way in Phase 1; the other 18 run on a kit of
  existing skills and the plain combo "Rhythm" until their phase. → SPEC-v4 §3.
- **The bar**: 8 slots = 5 class slots + 3 of your own. Tap to cast, hold to edit. With no class all 8 are yours.
  → CLIENT-v3 §6.
- **AUTO**: one on/off switch for everything, the basic attack included. Off is fully manual. → CLIENT-v2 §6.1.
- **Quests**: 55 quests; every NPC has some; markers `!` new, `?` ready, `…` in progress; trainers teach only as
  quest rewards. → QUESTS.md, CLIENT-v3 §4.
- **Star Chart**: the Skills screen is a night sky of constellations (weapon trees, The Heart of elements, The Craft,
  The Wild, The Crown). Tapping a star opens a simple card with one action. → CLIENT-v3 §3.
- **World**: 28 maps in two regions (the Vale and the Rift), with safe towns, hunting grounds, dungeons and warden
  arenas, 41 monster kinds. v4 Phase 1 grounds it: sheared cast shadows baked into the ground, props in four size
  tiers (some three heroes tall, fading while an actor stands behind them), clean clearings round monsters, layered
  forest edges, monsters that vary in size and hue within a pack. → SPEC-v2 §7, SPEC-v4 §11.
- **Saves**: book state v3. A v1 or v2 save is migrated on load (class levels rescaled to 10, four merged classes
  folded into their targets, nothing earned is lost); the old key is kept until a v3 write succeeds. → SPEC-v4 §13.

## 4. The client

- **Tap to move**, no joystick. Tapping NPCs, nodes and portals walks there and uses them.
- **Pixel-perfect**: the world renders to a low-resolution backbuffer and is scaled up by a whole number; the HUD uses
  the same art pixel. → QUALITY-PLAN §1, CLIENT-v3 §2.
- **HUD** (v3 layout on the v4 diet: three frame weights, two type faces, a one-line tracker, the one mechanic
  widget above the bar): player plate, zone plate, labelled buttons (Skills, Fuse, Class, Codex, Bag, Map, ☰), minimap, Pursuits
  tracker, quick buttons, the 8-slot bar and the attack cluster (⚔, AUTO, Target, SP flask). Portrait keeps the
  middle of the screen free for tapping the world. → CLIENT-v3 §2.
- **Class looks**: the player's sprite wears the active class's outfit. → CLIENT-v3 §5.
- **Effects and sound**: every spell has a procedural pixel effect (→ VFX.md); sound is procedural ZzFX with biome
  ambience (→ QUALITY-PLAN §6, §13). The ☰ menu has Sound on/off, volume and "Reduce shake & flashes".

## 5. Architecture

```
src/core   rules engine: no Phaser, no DOM (so an authoritative server can run it)
src/data   content as plain TypeScript data
src/game   Phaser client: art, render, entities, systems, vfx, audio, scenes, views for the UI
src/ui     DOM overlay: HUD, Star Chart, panels, dialogs (reads the game through GameController views)
tests      Vitest: rules, content integrity and reachability, world, quests, UI layout, VFX, audio
```

Tags drive weapon grips, tag bonuses and effects, so content only needs consistent tags to plug in. `npm test` fails
on broken references, duplicate recipes, unreachable skills, kits that overlap, classes outside the power band and
promised effects that do nothing.

## 6. Road ahead

| Phase | Scope |
|---|---|
| **Now** | Single-player game with the full discovery loop, quests, weapon-gated classes with mechanics (v4 Phase 1), local saves, PWA / single-file builds. |
| **v4 Phases 2 – 5** | Echoes as augments, monster materials, deeds and a real town (2); the rest of the class grid and a composed Vale (3); fused elements, Epics, the Rift (4); Legendary and Mythic lines (5). → SPEC-v4 §15. |
| **Online foundation** | An authoritative server running `src/core`; the client sends intents (cast, move, fuse) and the server validates mastery and fusion. Accounts and cloud saves. |
| **Shared world** | Other players visible in zone instances, parties, chat, trading. |
| **Social discovery** | A world codex crediting first discoveries, cooperative fusion, guild hint libraries. |

Anti-cheat follows from the split: mastery XP only from server-confirmed hits, fusion resolved on the server, and
clients receive only the recipes they have discovered.
