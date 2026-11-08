# Omnipath

A mobile-first 2D open-world action RPG in the spirit of early-2000s MMOs. Your skills are never picked from a menu. You discover them.

- **Master**: every attack you make trains the skill it came from.
- **Morph**: at max rank, a skill can morph into a new form, and you keep the original. Slash can become Whirlwind or Sword Throw.
- **Discover elements** by doing things in the world: forging, fishing, mining, meditating, hunting a boss.
- **Fuse**: combine elements and skills at the altar. Fire + Whirlwind makes **Flame Spin**, and Flame Spin + Tornado makes **Firestorm**.
- **Become a class**: classes are revealed automatically when your skill collection matches a hidden pattern (Blademaster, Pyroblade, Spellblade, Elementalist, … 16 in total).

The full game design, including the road to multiplayer, is in [`docs/DESIGN.md`](docs/DESIGN.md).

## Play

```bash
npm install
npm run dev          # http://localhost:5173 (also exposed on your LAN, so you can open it on a phone)
```

### On an iPad or phone

- **Same Wi-Fi as your computer:** run `npm run dev`. Vite prints a `Network:` URL like `http://192.168.1.20:5173`; open that in Safari on the iPad. For fullscreen, use Share → **Add to Home Screen**.
- **One-file build:** `npm run build:single` writes `dist-single/omnipath.html`. The game is inlined and Phaser loads from a CDN, so you can put the file on any static host (Netlify Drop, GitHub Pages, …) and open the URL on the device.

- Add `?fast` to the URL (e.g. `http://localhost:5173/?fast`) to speed up mastery for testing.
- Saves go to `localStorage`. To start over, use **Journal → Start a new character**.

### Controls (touch or mouse)

| Action | How |
|---|---|
| Move | Tap the ground |
| Attack | Tap a monster (auto-attacks), or press the big round button |
| Use a skill | Tap a hotbar slot |
| Talk / gather | Tap an NPC, ore vein, shrine, or fishing spot |
| Skills, morphs, hotbar | 📖 Skills |
| Fuse | ⚗️ Fuse |
| Classes | 🏛️ Class |

### Things to discover in the prototype

| Where | What |
|---|---|
| Brann the Smith (Hearthvale) | Forge with ore → 🔥 Fire. Also sells other weapons. |
| Mirror Lake pier | Fish → 💧 Water |
| Greystone Quarry | Mine ore → ⛰️ Earth (and a hidden Slash morph) |
| Shrine of Winds (Windcrest Hill) | Meditate → 🍃 Wind (and a hidden Bolt morph) |
| Gloomwood | Defeat Gloomcaps, then visit the obelisk → 🌑 Shadow |
| Sister Alba (Hearthvale) | Heals you. Grants ✨ Holy once you carry 3 elements. |
| Old Hermit Oru (west) | Teaches Meditation after you master a skill |
| Thunderhoof (Stormbreak Plateau) | Boss. Drops ⚡ Lightning and a skill tome. |
| Gustlings | Sometimes drop the Tome of Quickstep |

## Develop

```bash
npm test             # Vitest: rules, content integrity, world reachability
npm run typecheck
npm run build        # outputs dist/
npm run build:single # one self-contained HTML file in dist-single/
```

```
src/core   rules engine: mastery, morphs, fusion, classes, combat (no Phaser/DOM, so it can run on a server)
src/data   all content: skills, morphs, recipes, elements, classes, monsters, weapons
src/game   Phaser client: procedural world, entities, skill effects
src/ui     DOM overlay: HUD, hotbar, Grimoire, Fusion Altar, dialogs, minigames
tests      unit tests
```

All art is generated in code when the game boots (`src/game/textures.ts`), so the repo has no binary assets. To use real sprites, replace the texture keys.

### Adding a skill

1. Add a `SkillDef` to `src/data/skills.ts`.
2. Connect it with a morph (`src/data/morphs.ts`), a fusion recipe (`src/data/recipes.ts`), a class grant, or an item.
3. Run `npm test`. It fails on broken references, duplicate recipes, or skills that can't be reached.

## Ship to phones

The game is a PWA. You can open it in a mobile browser and "Add to Home Screen". To build native apps, wrap it with [Capacitor](https://capacitorjs.com/):

```bash
npm i @capacitor/core @capacitor/cli @capacitor/android @capacitor/ios
npx cap init Omnipath com.example.omnipath --web-dir dist
npm run build && npx cap add android && npx cap add ios
npx cap sync && npx cap open android   # or: npx cap open ios
```
