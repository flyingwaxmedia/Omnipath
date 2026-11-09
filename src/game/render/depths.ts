// Named depth layers (docs/QUALITY-PLAN.md §2, docs/INTEGRATION-v3.md §4). EVERY setDepth in src/game/** uses
// these — never a bare number — so new systems (VFX, quest markers, canopies, light maps) slot in without
// colliding. One camera draws everything; Phaser sorts by depth, ties by creation order.
//
// Bottom → top:
//   BACKDROP        under the ground (reserved: parallax / void backdrops)
//   GROUND          the ground (v2 tilemap layer, v3 bakeGround chunks)
//   GROUND_DECAL    flat decals painted on the ground: fishing ripples
//   PORTAL_DECAL    portal ground art: edge chevrons, stairs down
//   HIDDEN_DECAL    hidden-portal shimmer / fog / glyph overlays (flat looks)
//   DRESSING_FLAT   flat dressing (pebbles, cracks, bones, cobwebs)
//   MOVE_MARKER     the tap-to-move ring (above flat dressing)
//   AIM_PREVIEW     the player's wind-up ground preview (nova spot, dash lane, spin ring, strike cone)
//   TELEGRAPH       monster technique ground fills (always over the player's own preview: danger reads first)
//   SHADOW          drop shadows under actors
//   AURA            elite / warden auras, the player's buff rings
//   TARGET_RING     the ring under the current target
//   FX_GROUND       ground-hugging spell effects (the player's nova telegraph, impact cracks)
//   [WORLD band]    y-sorted sprites: ySort(footY, bias) — props, structures, objects, nodes, NPCs, the player,
//                   monsters, projectiles, particles and strike arcs (bias lifts effects in front of the body)
//   CANOPY          tree canopies / roofs drawn over actors (reserved for the render lane)
//   RIM             monster telegraph rims, aim lines and arrow heads (never hidden by trees or bodies)
//   FX_FRONT        thin lines over the world (a returning projectile's tether)
//   NAME_TAG        in-world labels: NPC / portal / object names, the player's name, monster name plates
//   HP_BAR          monster HP bars and stun stars
//   MARKER          quest markers over NPC heads (! ? …)
//   FX_GLOW         additive flashes, lightning, arc zaps, knife hops, heal streams
//   CAST_BAR        the player's wind-up bar + charging ring
//   STATUS_ICON     the player's status icons above the head
//   CHEVRON         the target chevron above the current target and chasing monsters
//   DARKNESS        the darkness overlay of dark maps (v3: the light map)
//   LIGHT           what pierces the darkness: spark bursts (LIGHT_TOP: the spark star)
//   TELL_TOP        danger read-outs that must survive darkness and glow (VFX rim duplicates, aim beads, edge
//                   indicators — docs/VFX.md §8.3)
//   WORLD_TEXT      floating combat text (damage, heals, level up) — always readable
//   SCREEN_FX       world-space full-screen overlays (reserved: warp pixelation, flashes drawn as sprites)
//
// The y-sorted band spans [WORLD_MIN, WORLD_MAX]; maps are far smaller than WORLD_MAX px (2500 tiles), and ySort()
// clamps so nothing ever leaks into the layers above or below.

export const WORLD_MIN = 0;
export const WORLD_MAX = 80000;

export const DEPTH = {
  BACKDROP: -110000,
  GROUND: -100000,
  GROUND_DECAL: -60000,
  PORTAL_DECAL: -59995,
  HIDDEN_DECAL: -59990,
  DRESSING_FLAT: -50000,
  MOVE_MARKER: -49000,
  AIM_PREVIEW: -41000,
  TELEGRAPH: -40000,
  SHADOW: -30000,
  AURA: -29000,
  TARGET_RING: -28900,
  FX_GROUND: -20000,
  CANOPY: 90000,
  RIM: 99000,
  FX_FRONT: 99500,
  NAME_TAG: 100000,
  HP_BAR: 100010,
  MARKER: 100020,
  FX_GLOW: 100050,
  CAST_BAR: 100100,
  STATUS_ICON: 100110,
  CHEVRON: 100120,
  DARKNESS: 150000,
  LIGHT: 150001,
  LIGHT_TOP: 150002,
  TELL_TOP: 150010,
  WORLD_TEXT: 200000,
  SCREEN_FX: 210000,
} as const;

export type DepthLayer = keyof typeof DEPTH;

/**
 * Depth inside the y-sorted world band for something whose feet stand at world y `y` (px). `bias` nudges it
 * in front of (+) or behind (-) bodies at the same y: props -4, a gate's gems +1/+2, projectiles +20,
 * particles +30, strike arcs and rings +40, nova pillars +50. Clamped to [WORLD_MIN, WORLD_MAX].
 */
export function ySort(y: number, bias = 0): number {
  const d = WORLD_MIN + y + bias;
  return d < WORLD_MIN ? WORLD_MIN : d > WORLD_MAX ? WORLD_MAX : d;
}

/** Standard ySort biases (so every system lifts the same kind of thing by the same amount). */
export const Y_BIAS = {
  PROP: -4,
  DOOR: -2,
  BEHIND: -1,
  GHOST: 1,
  GEM: 1,
  GEM_GLOW: 2,
  PROJECTILE: 20,
  PARTICLE: 30,
  ARC: 40,
  PILLAR: 50,
} as const;

// VFX additions (docs/VFX.md §8.3; append-only): shared mote emitters cannot y-sort, so their blitters sit over the
// whole y-sorted world band and under canopies and telegraph rims.
export const VFX_DEPTH = {
  FX_MOTES: 89000,
} as const;
