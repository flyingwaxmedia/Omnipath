// Core, engine-agnostic types for the Omnipath skill system (v2).
// Nothing in /core may import Phaser or touch the DOM so it can run
// on a future authoritative game server unchanged.
// See docs/SPEC-v2.md for the rules these types encode.

export type WeaponType = 'sword' | 'dagger' | 'staff';
export const WEAPON_TYPES: readonly WeaponType[] = ['sword', 'dagger', 'staff'];

export type ElementId =
  | 'fire'
  | 'water'
  | 'earth'
  | 'wind'
  | 'lightning'
  | 'shadow'
  | 'holy'
  | 'ice'
  | 'magma'
  | 'storm'
  | 'twilight';

export const PRIMAL_ELEMENTS: readonly ElementId[] = ['fire', 'water', 'earth', 'wind', 'lightning', 'shadow', 'holy'];

export type StatusKind =
  | 'burn'
  | 'slow'
  /** Water's status: slows like 'slow' and marks the target as soaked (enables Conduct). */
  | 'soak'
  | 'stun'
  | 'knockback'
  | 'shock'
  | 'bleed'
  | 'smite'
  | 'freeze'
  | 'poison'
  | 'pull';

export interface ElementDef {
  id: ElementId;
  name: string;
  /** Adjective used when procedurally naming infused skills, e.g. "Blazing". */
  prefix: string;
  icon: string;
  /** Glyph shown alongside colour so element state never relies on colour alone. */
  glyph?: string;
  color: number;
  /** 0 = primal element, 1 = element created by fusing two others. */
  tier: 0 | 1;
  desc: string;
  status: StatusKind;
  strongVs: ElementId[];
}

// ------------------------------------------------------------------ monsters

export type Family = 'beast' | 'sprite' | 'construct' | 'revenant' | 'fiend' | 'sylvan' | 'swarm' | 'wyrm';
export type Size = 'S' | 'M' | 'L';
export type MonsterRank = 'common' | 'elite' | 'warden';

export interface DropDef {
  item: string;
  chance: number;
  /** Only drop while the player lacks what the item grants (tomes, shards, relics). */
  once?: boolean;
}

export interface MonsterTechnique {
  /** A SkillDef id. Monsters cast ordinary skills; echo skills can later be learned by the player. */
  skill: string;
  /** Relative pick weight vs the monster's other techniques. */
  weight: number;
  /** Per-technique cooldown in ms (monster side). */
  cooldown: number;
  /** Max distance to the player (px) at which the monster will start this technique. */
  range: number;
  /** Only used while the monster's HP fraction is below this value. */
  hpBelow?: number;
  /** Witness marks needed to learn this technique as an Echo. Omit for non-learnable attacks. */
  echo?: { marks: number };
}

export interface MonsterDef {
  id: string;
  name: string;
  level: number;
  hp: number;
  atk: number;
  def: number;
  element?: ElementId;
  /** Defender element level 1-3 (default 1). */
  elementLevel?: 1 | 2 | 3;
  family: Family;
  size: Size;
  rank: MonsterRank;
  /** Threat for mastery/spark math. Default: level (+2 elite, +3 warden). */
  threat?: number;
  exp: number;
  coins: [number, number];
  speed: number;
  aggressive: boolean;
  radius: number;
  attackRange: number;
  attackDelay: number;
  /** Respawn time in ms for this spawn slot. */
  respawn: number;
  drops?: DropDef[];
  techniques?: MonsterTechnique[];
  /** Essence id this species drops (about 3% per kill, guaranteed by the 25th kill). */
  essence?: string;
  /** Texture key. Default `mon_<id>`; elites usually reuse their base species' texture. */
  texture?: string;
  /** Tint applied to the texture (elites). */
  tint?: number;
  /** Render scale (elites ~1.25, wardens 1.6+). */
  scale?: number;
  /** Species this elite/warden variant derives from (bestiary grouping). */
  base?: string;
  /** Rare monsters appear only under conditions; flavour text for the bestiary. */
  note?: string;
}

// ------------------------------------------------------------------ skills

export type BuffStat = 'atk' | 'matk' | 'speed' | 'crit' | 'regen' | 'def';

export type SkillShape =
  | { kind: 'strike'; range: number; arc: number; hits?: number }
  | { kind: 'spin'; radius: number; pulses?: number }
  | {
      kind: 'projectile';
      speed: number;
      range: number;
      count?: number;
      spread?: number;
      pierce?: number;
      size?: number;
      radial?: boolean;
    }
  | { kind: 'dash'; distance: number; width: number; spin?: boolean }
  | { kind: 'nova'; radius: number; range: number; delay?: number }
  | { kind: 'chain'; range: number; jumps: number }
  | { kind: 'buff'; stat: BuffStat; amount: number; duration: number };

export type ShapeKind = SkillShape['kind'];
export const SHAPE_KINDS: readonly ShapeKind[] = ['strike', 'spin', 'projectile', 'dash', 'nova', 'chain', 'buff'];

/** Runtime riders added by essences (and occasionally authored). The game layer implements them. */
export interface SkillRiders {
  /** Projectiles fly back to the caster and can hit each target a second time. */
  returns?: boolean;
  /** The whole skill recasts once after delayMs at `mult` power. */
  reprise?: { delayMs: number; mult: number };
  /** Each hit arcs to up to `targets` other enemies within 120 px at `mult` power (no further arcs). */
  arc?: { targets: number; mult: number };
  /** Fraction of damage dealt returned as HP (capped at 8% max HP per cast). */
  leech?: number;
  /** Every hit knocks back (in addition to element statuses). */
  knockback?: boolean;
}

export interface SkillDef {
  id: string;
  name: string;
  desc: string;
  icon: string;
  /** 0 = basic weapon attack, 1 = first morph / simple fusion / technique, 2 = deeper, 3 = capstone. */
  tier: number;
  /** Weapons that can use this skill. Undefined = any weapon. */
  weapons?: WeaponType[];
  tags: string[];
  element?: ElementId;
  /** Damage multiplier applied to ATK (or MATK for arcane skills). */
  power: number;
  spCost: number;
  /** Cooldown in ms. 0 = use the weapon's attack delay. */
  cooldown: number;
  shape: SkillShape;
  maxRank: number;
  /** Extra on-hit effect in addition to the element's own status. */
  status?: StatusKind;
  /** Additional crit chance (percentage points). */
  critBonus?: number;
  /** Wind-up before the effect fires (interruptible by moving). Default 0. */
  castMs?: number;
  /** Global skill lockout after the cast (auto-attack and walking still allowed). Default 250. */
  afterCastMs?: number;
  riders?: SkillRiders;
  /** True for skills created procedurally (infusions, essence variants, shape merges). */
  generated?: boolean;
  /** For generated variants: the authored skill it was composed from. */
  baseId?: string;
  /** For generated variants: essence ids applied (sorted). */
  essences?: string[];
  /** For shape merges: the two authored parents. */
  mergedFrom?: [string, string];
  /** Display-only notes (e.g. "Learned from Brann"). */
  origin?: string;
}

// ------------------------------------------------------------------ requirements

export type Requirement =
  | { type: 'element'; id: ElementId }
  | { type: 'elementsKnown'; count: number; primalOnly?: boolean }
  | { type: 'skill'; id: string; rank?: number }
  | { type: 'flag'; id: string; min: number; label?: string }
  | { type: 'level'; min: number }
  | { type: 'class'; id: string; rank?: number; worn?: boolean }
  /** At least `count` distinct authored skills carrying all `tags` at rank >= minRank (default 1). */
  | { type: 'tagCount'; tags: string[]; count: number; minRank?: number }
  /** Bag item count (materials, relics). */
  | { type: 'item'; id: string; count: number }
  | { type: 'lesson'; id: string }
  | { type: 'mapVisited'; id: string }
  /** Witness marks earned toward an echo skill. */
  | { type: 'witness'; skill: string; count: number };

// ------------------------------------------------------------------ morphs & sparks

export interface SparkSpec {
  /** Teacher threat: sparks roll best when monster.threat is near this value. */
  threat: number;
  /** Parent rank needed before this morph can spark (default 3). */
  minParentRank?: number;
  /** Only these monster families can teach it (default any). */
  families?: Family[];
}

export interface MorphDef {
  from: string;
  to: string;
  /** Tree depth of the result: 1, 2 or 3 (capstone). Informational + validation. */
  tier?: 1 | 2 | 3;
  requires?: Requirement[];
  /** Shown while the morph is still locked. */
  hint?: string;
  /** If set, this morph can also be learned mid-combat by a Spark (charge-free). T1/T2 only. */
  spark?: SparkSpec;
}

// ------------------------------------------------------------------ fusion

/** Fusion ingredient reference: `skill:<id>`, `el:<id>` or `mod:<essenceId>`. Results may also be `passive:<id>`. */
export type IngredientRef = string;

export interface FusionRecipe {
  a: IngredientRef;
  b: IngredientRef;
  result: IngredientRef;
  requires?: Requirement[];
  /** Whispered when the player experiments with one half of this recipe. */
  hint?: string;
}

export type EssenceCategory = 'multiply' | 'propagate' | 'repeat' | 'area' | 'tempo' | 'sustain';

/** Declarative change an essence makes to a skill. compose() applies it. */
export interface EssenceMod {
  count?: number;
  spread?: number;
  pierce?: number;
  jumps?: number;
  pulses?: number;
  hits?: number;
  radiusMul?: number;
  rangeMul?: number;
  arcAdd?: number;
  returns?: boolean;
  reprise?: { delayMs: number; mult: number };
  arc?: { targets: number; mult: number };
  leech?: number;
  knockback?: boolean;
}

export interface EssenceDef {
  id: string;
  name: string;
  icon: string;
  desc: string;
  /** Word added to composed skill names. */
  affix: { text: string; pos: 'prefix' | 'suffix' };
  category: EssenceCategory;
  appliesTo: ShapeKind[];
  powerMul: number;
  spMul: number;
  cdMul?: number;
  mod: EssenceMod;
  /** Tag added to composed skills (e.g. 'heavy'). */
  tag?: string;
}

// ------------------------------------------------------------------ passives

export type PassiveStat = 'hp' | 'sp' | 'atk' | 'matk' | 'crit' | 'speed' | 'def';

/** All `pct` values are per passive rank. */
export type PassiveEffect =
  | { kind: 'power'; tag?: string; pct: number }
  | { kind: 'spCost'; tag?: string; pct: number }
  | { kind: 'cooldown'; tag?: string; pct: number }
  | { kind: 'vsFamily'; family: Family; pct: number }
  | { kind: 'vsStatus'; element?: ElementId; status: StatusKind; pct: number }
  | { kind: 'stat'; stat: PassiveStat; pct: number }
  | { kind: 'regenStill'; pct: number }
  | { kind: 'masteryXp'; tag?: string; pct: number };

export type PassiveSource = 'tag' | 'trainer' | 'class' | 'resonance' | 'imprint' | 'bestiary';

export interface PassiveDef {
  id: string;
  name: string;
  icon: string;
  desc: string;
  source: PassiveSource;
  maxRank: number;
  effect: PassiveEffect;
  /** Tag passives: the tag whose mastery total drives this passive's rank. */
  tag?: string;
}

// ------------------------------------------------------------------ trainers

export type LessonGrant =
  | { skill: string }
  | { passive: string }
  | { essence: string; count: number }
  | { element: ElementId };

export interface LessonDef {
  id: string;
  name: string;
  blurb: string;
  grants: LessonGrant;
  requires: Requirement[];
  cost?: { coins?: number; items?: Record<string, number> };
  /** Can be bought again (essence purchases). */
  repeatable?: boolean;
  /** Taught only as a quest reward (docs/QUESTS.md); takeLesson refuses it. */
  questOnly?: boolean;
}

export interface TrainerDef {
  id: string;
  /** NpcDef id this trainer lives on. */
  npc: string;
  title: string;
  lessons: LessonDef[];
}

// ------------------------------------------------------------------ classes

export interface ClassClause {
  /** A skill counts if it has every tag listed (element ids and weapons count as tags). */
  tags: string[];
  count: number;
}

export interface StatBonus {
  atk?: number;
  matk?: number;
  hp?: number;
  sp?: number;
  speed?: number;
  crit?: number;
  cdr?: number;
  /** Percent bonus damage for skills carrying the tag. */
  tagPower?: Record<string, number>;
}

export interface ClassNode {
  id: string;
  kind: 'passive' | 'skill' | 'capstone';
  /** PassiveDef id (passive/capstone) or SkillDef id (skill). */
  ref: string;
  /** Points per rank. */
  cost: number;
  maxRank: number;
  requires?: { node: string; rank: number }[];
  /** Points that must already be spent in this tree. */
  minSpent?: number;
}

export type ClassTier = 1 | 2 | 3;

export interface ClassDef {
  id: string;
  name: string;
  icon: string;
  desc: string;
  /** Riddle shown before the class is discovered. */
  hint: string;
  tier: ClassTier;
  clauses: ClassClause[];
  distinctElements?: number;
  /** Tier II/III: classes (and Class Ranks) required. */
  parents?: { id: string; rank: number }[];
  /** Extra requirements (e.g. a warden relic flag for Tier III, a secret flag for hidden classes). */
  requires?: Requirement[];
  bonus: StatBonus;
  /** Signature skills granted on discovery. */
  grants?: string[];
  /** PassiveDef id unlocked at CR5 (I) / CR4 (II) / CR3 (III) that can be slotted while wearing other classes. */
  imprint?: string;
  tree?: ClassNode[];
  hidden?: boolean;
}

// ------------------------------------------------------------------ items

/** Display fields every item kind may carry. */
export interface ItemDisplay {
  /** Name for a count other than 1 ('Lake Fish', 'Iron Ore'); default: English plural of `name`. */
  plural?: string;
}

export type ItemDef = ItemDisplay &
  (
  | { id: string; name: string; icon: string; kind: 'tome'; skill: string; desc: string }
  | { id: string; name: string; icon: string; kind: 'shard'; element: ElementId; desc: string }
  | { id: string; name: string; icon: string; kind: 'material'; desc: string; price?: number }
  | { id: string; name: string; icon: string; kind: 'relic'; flag: string; desc: string }
  | {
      id: string;
      name: string;
      icon: string;
      kind: 'consumable';
      effect: 'heal' | 'sp' | 'recall' | 'blink';
      amount?: number;
      desc: string;
      price?: number;
    }
  );

// ------------------------------------------------------------------ data bundle

export interface GameData {
  dataVersion: number;
  elements: ElementDef[];
  skills: SkillDef[];
  morphs: MorphDef[];
  recipes: FusionRecipe[];
  classes: ClassDef[];
  essences: EssenceDef[];
  passives: PassiveDef[];
  trainers: TrainerDef[];
  monsters: MonsterDef[];
  items: ItemDef[];
  /** Optional so older fixtures keep compiling; src/data always provides it. */
  quests?: QuestDef[];
}

// ------------------------------------------------------------------ quests (docs/QUESTS.md)

/** Gathering node kinds (mirrors src/core/world/types.ts NodeKind; kept here so core rules stay world-agnostic). */
export type QuestNodeKind =
  | 'ore'
  | 'fishing'
  | 'herb'
  | 'ember_vent'
  | 'wind_chime'
  | 'storm_tree'
  | 'shadow_fungus'
  | 'sun_spring'
  | 'frost_crystal';

export type QuestObjective =
  | { kind: 'kill'; monster?: string; family?: Family; rank?: MonsterRank; count: number }
  | { kind: 'gather'; node: QuestNodeKind; count: number }
  | { kind: 'deliver'; item: string; count: number }
  | { kind: 'visit'; map: string }
  | { kind: 'talk'; npc: string }
  | { kind: 'use'; tag?: string; skill?: string; count: number }
  | { kind: 'cast'; element?: ElementId; shape?: ShapeKind; tag?: string; map: string; count: number }
  | { kind: 'witness'; skill?: string; count: number }
  | { kind: 'state'; requires: Requirement; label: string };

export interface QuestReward {
  /** Grants a trainer LessonDef's grant for free (skill / passive rank / essence / element). */
  lesson?: string;
  skill?: string;
  passive?: string;
  element?: ElementId;
  essences?: Record<string, number>;
  items?: Record<string, number>;
  coins?: number;
  exp?: number;
  /** Class id whose riddle is revealed. */
  whisper?: string;
  /** Sets this flag to >= 1. */
  flag?: string;
}

export interface QuestDef {
  /** '<npc>_<slug>' */
  id: string;
  name: string;
  /** NpcDef id. */
  giver: string;
  /** NpcDef id (default: giver). */
  turnIn?: string;
  chain?: string;
  summary: string;
  dialog: { offer: string; progress: string; complete: string };
  /** Quests that must be completed first. */
  after?: string[];
  /** Conditions for the quest to be OFFERED. */
  requires?: Requirement[];
  objectives: QuestObjective[];
  rewards: QuestReward;
  /** Bounties: can be repeated after a cooldown on the game clock (book.now ms). */
  repeatable?: { cooldownMs: number };
}
