# Omnipath — Free Quality Plan (adopted)

From the zero-cost quality research (Phaser built-ins, procedural code, OFL fonts, CC0 audio) plus its critique.
Everything here is free; nothing third-party enters the *visual* style (all art stays procedural and original).

## Phase A — foundations (with the v3 integration)
1. **Pixel-perfect rendering** (huge). Phaser only rounds pixels when the camera zoom is an integer
   (`renderRoundPixels = roundPixels && Number.isInteger(zoom)`), so every fractional zoom blurs the 1 px outlines.
   Render to a **low-resolution backbuffer** in ART pixels (`Scale.NONE`, canvas = ceil(device px / k)) at camera
   zoom 1, then upscale by an **integer CSS factor k** (crisp `image-rendering: pixelated`), with k chosen so the
   short side shows ≈ 360–560 art px (phones k = 3 at DPR 3, iPad k = 3–4 device px per art px). Camera follows the
   logical player position (no bob), scroll rounded to whole art pixels; no fractional scale tweens on pixel sprites
   (1–3 frame squash only), elites drawn at native size or exactly 2×; replace multiply-tint states with baked
   variants or 1-frame flashes. Playtest asserts `cameras.main.renderRoundPixels === true`.
   *Replaces ART-DIRECTION §7 / CLIENT-v3 §1 zoom formula.*
2. **Named depth layers** (`src/game/render/depths.ts`) used by every `setDepth`.
3. **Game event bus** (`src/game/events.ts`): hit, kill, cast, castFire, playerHurt, levelUp, gather, warp, questEvent,
   uiOpen, discovery… so audio, quests, juice and VFX subscribe without editing Combat.
4. **Pixel fonts**: Pixelify Sans (UI) + Tiny5 (small labels/numbers), SIL OFL-1.1 via `@fontsource`, LICENSE files
   shipped; **in-world text as a boot-baked bitmap font** with a 1 px #24180f outline; emoji never drawn in-world (use
   `icon_*` textures).
5. **Boot splash + chunked texture generation** (hundreds of canvases); **texture atlasing** where cheap; stop
   rendering under full-screen panels (`game.loop.sleep()`).

## Phase B — feel & sound
6. **Audio core + ZzFX SFX bank** (MIT, vendored with its notice): unlock inside touchend/click/keydown, suspend when
   hidden/muted/idle, master/SFX/music/ambience volumes + mute; recipes per event (swings, hits per element, crits,
   spells by shape × element, UI taps, level-up, discovery fanfares, quest, gather, footsteps by surface).
7. **Hit feel**: coalescing hit-stop (≤ 150 ms budget per second, scaled by damage), impact frame (white → element
   flash 1–2 frames), 1-frame squash, recoil, pixel-chunk death pop, spawn pop.
8. **Camera rig**: world-unit trauma shake (never rotation), directional kicks, flash alpha ≤ 0.35 and ≤ 3/s, warden
   intro pan, pixelate warp transition; lead only toward wardens/elites in manual mode; reduce-motion respected.
9. **DOM tactile feedback** as HUD v3 acceptance criteria: press states, HP ghost bar, cast-pop/ready-ping/nope,
   count-ups, reduced-motion guards.

## Phase C — mood & life
10. **OmniGrade**: one custom PostFX pass (per-biome 16³ LUT generated in code, vignette, low-HP desaturation,
    soft flash, anti-banding dither) on the world camera; in-world UI on an ungraded camera.
11. **Pixel-banded light map** (RenderTexture × MULTIPLY) replacing `fx_darkness` for dungeons/night: hard-banded
    light stamps for lanterns, lava, crystals, portals and live spells; ADD halos for glow (no PointLight).
12. **Living world**: biome weather/ambient particles (leaves, fireflies, embers, snow, spores, dust), drifting
    cloud shadows (1 px noise, whole-pixel steps), prop idle life (banners, lanterns, chimney smoke), later wind
    sway frames and animated water.
13. **Ambient soundscape**: procedural biome beds, positional emitters, surface footsteps, per-map echo.
14. **Music**: one composer's CC0 JRPG loops (Juhani Junkala / SubspaceAudio — verify CC0 per page, archive the
    licence), mono-downmixed, ≤ 2 decoded, hosted build only (not inlined in the single-file preview); a tiny
    procedural sequencer later.

## Phase D — QA & delivery
15. Texture contact sheet + art-rule linter (palette, 0/255 alpha, outline), screenshot matrix (phone portrait,
    phone landscape, iPad), `?perf` overlay (fps, draw calls, textures, renderer type), WebGL context-loss re-bake,
    Eruda only with `?debug`, generated THIRD-PARTY-LICENSES + Credits screen, quality tiers (Low/Med/High;
    Canvas = Low), battery-saver 30 fps, `navigator.storage.persist()`.

## Do not
- No third-party visual packs (style clash, licence traps), no LPC/CC-BY-SA, no AI-generated shipped art.
- No Phaser built-in Bloom on the camera; no per-sprite postFX; ≤ 3–4 preFX objects on screen.
- No Light2D/PointLight for general lighting; no Phaser 4 migration now.
- No default cam.flash alpha 1; no camera rotation for shake; no vibration on ordinary AUTO hits.
- No Pixabay/YouTube/NC-licensed audio; no inlining music into the single-file build.
