// Core, engine-agnostic types for the Omnipath skill system (v4 contract, Phase 1).
// Nothing in /core may import Phaser or touch the DOM so it can run
// on a future authoritative game server unchanged.
// See docs/SPEC-v4.md (which wins) and docs/SPEC-v2.md for the rules these types encode.

/** 'staff' is shown as "Rod", 'fists' as "Bare Hands" (it IS "nothing equipped": always owned). */
export type WeaponType = 'sword' | 'dagger' | 'staff' | 'fists';
export const WEAPON_TYPES: readonly WeaponType[] = ['sword', 'dagger', 'staff', 'fists'];

/** The tag that binds a skill to a weapon (SPEC-v4 §2.1). Exactly one grip tag per bound skill. */
export const GRIP_TAG: Readonly<Record<WeaponType, string>> = { sword: 'blade', dagger: 'pierce', staff: 'rod', fists: 'fist' };

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
  | 'pull'
  /** Held: cannot move, can act (v4 §6.1). Wardens take a 40% slow instead. */
  | 'root'
  /** Airborne for 1.2 s: helpless, then takes a landing hit. Wardens take a 40% slow instead. */
  | 'launch'
  /** Exposed: takes +15% damage for 4 s. */
  | 'expose'
  /** Lured: walks toward the source. Wardens ignore it. */
  | 'lure';

/** The four statuses added in v4 Phase 1. */
export const NEW_STATUSES: readonly StatusKind[] = ['root', 'launch', 'expose', 'lure'];

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
  | { kind: 'buff'; stat: BuffStat; amount: number; duration: number }
  // ---- v4 Phase 1 kinds (SPEC-v4 §6.1). The other nine arrive with their phases.
  /** A field that stays and ticks. `line`: a lane of that length instead of a disc; `follow`: it moves with the caster. */
  | { kind: 'zone'; radius: number; range: number; durationMs: number; tickMs: number; line?: { length: number }; follow?: boolean }
  /** You vanish and appear. `arrive`: a hit of that radius where you land (power > 0). */
  | { kind: 'blink'; distance: number; to: 'point' | 'target' | 'self' | 'object'; arrive?: { radius: number } }
  /** A heal: `pct` of max HP, at once or spread over `overMs`; `radius`: a resting circle you must stand in. */
  | { kind: 'mend'; pct: number; overMs?: number; radius?: number }
  /** A shell worth `pct` of max HP for `durationMs`; `burst`: it hits around you when it breaks or ends (power > 0). */
  | { kind: 'shield'; pct: number; durationMs: number; burst?: { radius: number } };

export type ShapeKind = SkillShape['kind'];
/** The seven v2 kinds. */
export const LEGACY_SHAPE_KINDS: readonly ShapeKind[] = ['strike', 'spin', 'projectile', 'dash', 'nova', 'chain', 'buff'];
/** The kinds added in v4 Phase 1. */
export const NEW_SHAPE_KINDS: readonly ShapeKind[] = ['zone', 'blink', 'mend', 'shield'];
export const SHAPE_KINDS: readonly ShapeKind[] = [...LEGACY_SHAPE_KINDS, ...NEW_SHAPE_KINDS];

/** How a skill reaches the foe (SPEC-v4 §6.2). */
export type Delivery =
  | 'cut'
  | 'thrust'
  | 'punch'
  | 'kick'
  | 'claw'
  | 'wave'
  | 'throw'
  | 'bolt'
  | 'point'
  | 'ring'
  | 'line'
  | 'path'
  | 'self'
  | 'target'
  | 'nearest'
  | 'ground';
export const DELIVERIES: readonly Delivery[] = [
  'cut', 'thrust', 'punch', 'kick', 'claw', 'wave', 'throw', 'bolt',
  'point', 'ring', 'line', 'path', 'self', 'target', 'nearest', 'ground',
];

/** The one effect a skill has beyond its element's own status (SPEC-v4 §6.2). */
export type SkillExtra =
  | StatusKind
  | 'mark'
  | 'heal'
  | 'shield'
  | 'haste'
  | 'leech'
  | 'reposition'
  | 'interrupt'
  | 'execute'
  | 'crit'
  | 'cleanse'
  | 'none';

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
  /**
   * Weapons that may use this skill (requirements.weaponOk). Undefined = free: any weapon. Set if and only if the
   * skill carries a grip tag (GRIP_TAG) or is a tier-0 basic.
   */
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
  /**
   * How the skill reaches the foe (v4 §6.2). Optional in the type until the content lane has tagged every skill;
   * compose.skillSignature() derives a default from the shape meanwhile.
   */
  delivery?: Delivery;
  /** The one effect beyond the element's own status; supersedes `status` for the distinctness test. Default: `status`, else 'none'. */
  extra?: SkillExtra;
  /**
   * Class id: a kit (or form) skill of that class. It can only sit in a class slot of that class, never in "your"
   * slots, and is never a fusion ingredient.
   */
  classOf?: string;
  /** Cost in percent of max HP (sacrifice skills), paid on top of `spCost`. */
  hpCost?: number;
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
  | { type: 'witness'; skill: string; count: number }
  /** A deed at `tier` or above (default 1). The deed engine is Phase 2; until then this reads `state.deeds`. */
  | { type: 'deed'; id: string; tier?: number }
  /** A quest completed at least once (Trials: `ClassDiscovery.trial`). */
  | { type: 'quest'; id: string };

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
  | { kind: 'masteryXp'; tag?: string; pct: number }
  /**
   * A rule, not a number (v4 §4.1): when `when` happens (every `n`-th time, within `ms`, below `hpBelow`% HP, only
   * holding `weapon`), do `do`, at most once per `icdMs`. Core lists active triggers (PassiveTotals.triggers); the
   * game layer fires them.
   */
  | { kind: 'trigger'; when: TriggerWhen; n?: number; ms?: number; hpBelow?: number; weapon?: WeaponType; do: TriggerDo; icdMs?: number };

/** The numeric passive effects (everything except 'trigger'): each has a per-rank `pct`. */
export type NumericPassiveEffect = Exclude<PassiveEffect, { kind: 'trigger' }>;

export type TriggerWhen =
  | 'kill'
  | 'crit'
  | 'hitTaken'
  | 'firstHitOfFight'
  | 'nthHit'
  | 'afterDash'
  | 'afterStill'
  | 'afterIdleAttack'
  | 'lowHp'
  | 'statusEnds'
  | 'skillCast'
  | 'wouldDie'
  | 'always';

export type TriggerDo =
  | { heal: number }
  | { shield: number }
  | { freeCast: true }
  | { guaranteeCrit: true }
  | { repeat: number }
  | { burst: number }
  | { arc: number }
  | { status: StatusKind; ms: number }
  | { stat: PassiveStat; pct: number; ms: number }
  | { power: number; ms?: number }
  | { reflect: true }
  /** One of a closed list of engine rules, e.g. 'noKnockback'. */
  | { rule: string };

/** 'imprint' stays until Phase 2 turns Keepsakes into mastered class passives ('keepsake'). */
export type PassiveSource = 'tag' | 'trainer' | 'class' | 'resonance' | 'imprint' | 'keepsake' | 'bestiary' | 'deed';

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
  /** Worst-case damage points this passive adds to one skill; ≤ balance.KEEPSAKE_BUDGET (5) for class passives. */
  budget?: number;
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

// ------------------------------------------------------------------ classes (SPEC-v4 §3.3)

export type Rarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary' | 'mythic';
export const RARITIES: readonly Rarity[] = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'];
export type PowerSource = 'physical' | ElementId;

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

/** What fills a gauge. A hit/cast filter that is set must match (weapon held, tag on the skill, ...). */
export type GaugeFill =
  /** Per landed hit. `tag`: only hits of skills carrying it (e.g. 'throw'); `basic`: only (or never) basic attacks. */
  | { on: 'hit'; weapon?: WeaponType; tag?: string; basic?: boolean; amount: number }
  /** Per different foe hit inside the window. */
  | { on: 'hitDistinct'; windowMs: number; amount: number }
  | { on: 'kill'; lowHpBelow?: number; amount: number }
  /** Per 1% of max HP lost. */
  | { on: 'damageTaken'; perPct: number }
  /** Per 1% of max HP shielded or healed. */
  | { on: 'prevented'; perPct: number }
  | { on: 'move'; perTile: number }
  | { on: 'still'; perSec: number }
  | { on: 'idleAttack'; perSec: number }
  | { on: 'cast'; tag?: string; element?: ElementId; alternate?: [ElementId, ElementId]; amount: number }
  | { on: 'hpSpent'; perPct: number }
  | { on: 'pickup'; item: 'ember'; amount: number }
  | { on: 'time'; perSec: number };

/**
 * What a skill use gains from a mechanic (finisher, gauge spend, stance, zone). The game layer applies it to the
 * cast: percentages are additive bonuses (30 = +30%).
 */
export interface CastBoost {
  /** Damage. */
  powerPct?: number;
  /** Radius, range, arc and projectile size. */
  sizePct?: number;
  /** Projectile and dash speed. */
  speedPct?: number;
  /** Always crits. */
  crit?: boolean;
  /** Costs no SP. */
  free?: boolean;
  /** Costs this much HP (percent of max HP) instead of SP. */
  hpCostPct?: number;
  /** Extra projectile pierce. */
  pierce?: number;
  /** Extra pulses (spins) or hits (strikes). */
  pulses?: number;
  /** Status every hit also applies. */
  status?: StatusKind;
  /** The skill repeats once at this multiplier. */
  repeat?: number;
}

/** Stat changes a mechanic gives while a condition holds (percent; crit in points). */
export type MechanicStat = PassiveStat | 'attackSpeed' | 'damage' | 'size';

/**
 * One line of what a gauge (or a zone's `near`) does. A closed set the engine knows:
 * - `perPoint`: while the gauge holds points, each gives `pct`% of `stat` (speedPct etc. scale by the points);
 * - `threshold`: while the gauge is at `at` or above ('max' = its max), `boost` applies to matching skills and
 *   `stat` holds — nothing is spent;
 * - `nextSkill`: once the gauge reaches `at`, the next matching skill takes `boost` and spends `spend` points
 *   ('all' = everything; default 'all');
 * - `spendAll`: a matching skill spends the whole gauge whatever it holds, for `perPoint` each;
 * - `unlock`: a kit skill that is only usable at `at` or above (it spends `spend`, default 'all');
 * - `stat`: flat, while the condition of the owner holds (used by zone `near`).
 */
export type GaugeEffect =
  | { do: 'perPoint'; stat?: MechanicStat; pct?: number; boost?: CastBoost; filter?: SkillFilter }
  | { do: 'threshold'; at: number | 'max'; boost?: CastBoost; stat?: { stat: MechanicStat; pct: number }; filter?: SkillFilter }
  | { do: 'nextSkill'; at: number | 'max'; boost: CastBoost; spend?: number | 'all'; filter?: SkillFilter }
  | { do: 'spendAll'; perPoint: CastBoost; filter?: SkillFilter }
  | { do: 'unlock'; at: number | 'max'; skill: string; spend?: number | 'all' }
  | { do: 'stat'; stat: MechanicStat; pct: number };

/** Which skill uses a mechanic line cares about. Every field that is set must match. */
export interface SkillFilter {
  /** Only kit skills of the class ('kit'), or only basic attacks ('basic'). */
  of?: 'kit' | 'basic';
  /** The skill must be usable only with this weapon's grip (it lists the weapon in `weapons`). */
  weapon?: WeaponType;
  tag?: string;
  kind?: ShapeKind;
}

/** What the last step of a combo becomes. */
export interface ComboFinisher {
  /** Shown on the finisher ("Finisher", "Weave", "Roadhouse"). */
  name: string;
  boost: CastBoost;
}

/** What each mark does when the marks are cashed in with `spendWith`. */
export interface MarkEffect {
  /** Damage bonus of the cash-in per mark on the target. */
  powerPct?: number;
  /** Share (0..1) of the damage dealt to a marked foe that is stored and lands on cash-in or expiry. */
  store?: number;
  /** Status applied when the mark lands. */
  status?: StatusKind;
  statusMs?: number;
  /** Marks fall off after this long without a new one (default: never). */
  lifeMs?: number;
  /** At max marks the cash-in skill's cooldown resets. */
  resetAtMax?: boolean;
}

/** One stage of a Legendary form (Phase 5; the engine ignores forms until then). */
export interface FormStage {
  name: string;
  fromLevel: number;
  /** How many form skills replace kit slots. */
  skills: number;
  ms: number;
}

export type ClassMechanic =
  | {
      kind: 'gauge';
      name: string;
      max: number | null;
      fill: GaugeFill[];
      decay?: { afterMs: number; perSec: number };
      /** What the gauge does at thresholds or when spent. Each effect is one of a closed set the engine knows. */
      effects: GaugeEffect[];
      autoRule: AutoRule;
    }
  | {
      kind: 'combo';
      name: string;
      length: 3 | 4;
      distinct: boolean;
      /** Which skill uses count as steps (default: any bar skill). */
      filter?: { weapon?: WeaponType; tag?: string };
      /**
       * Addition to the spec sketch. `lead`: the steps before the last must be basic attacks (Road Rhythm: Jab, Jab,
       * then a class skill) and the last a kit skill. Default: every step is a filtered skill use.
       */
      lead?: 'basic';
      /** Steps must follow each other within this long (default COMBO.windowMs). */
      windowMs?: number;
      finisher: ComboFinisher;
      autoRule: AutoRule;
    }
  | {
      kind: 'marks';
      name: string;
      max: number;
      applyOn: 'weaponHit' | 'skillTag' | 'opening' | 'launch';
      /** With `applyOn: 'skillTag'`: the tag a skill must carry to mark (default 'mark'). */
      tag?: string;
      perMark: MarkEffect;
      /** Kit skill id that cashes the marks in. */
      spendWith: string;
      autoRule: AutoRule;
    }
  | {
      kind: 'stance';
      names: [string, string];
      swap: 'tap' | { everyMs: number } | { hold: true };
      /** kit skill id -> the SkillDef id it becomes in stance B. Unlisted skills are unchanged. */
      remap: Record<string, string>;
      /** Addition to the spec sketch: what every kit skill gains in each stance ([A, B]). */
      boosts?: [CastBoost, CastBoost];
      lockMs?: number;
      autoRule: AutoRule;
    }
  | {
      kind: 'zone';
      name: string;
      /** WorldObjectDef id (game lane). */
      object: string;
      max: number;
      lifeMs: number;
      /** Addition to the spec sketch: kills within `near.tiles` level the object up to this (the Hearth: 5). */
      levels?: number;
      /** Addition: kit skill ids that plant the object (default: the kit's `zone` skills). */
      placeWith?: string[];
      /** Addition: the kit skill that uses every object up (Hurl Hearth, Shatter), gaining `perLevel` × the highest level. */
      consumeWith?: string;
      perLevel?: CastBoost;
      near: { tiles: number; effects: GaugeEffect[] };
      autoRule: AutoRule;
    }
  | {
      kind: 'form';
      gauge: Extract<ClassMechanic, { kind: 'gauge' }>;
      formKit: [string, string, string, string, string];
      stages: FormStage[];
      aftermath: { name: string; ms: number; effects: GaugeEffect[] };
    };

export type MechanicKind = ClassMechanic['kind'];

/** One declarative line the AUTO battler follows. Manual play may always do better. */
export type AutoRule =
  | { spend: 'atMax' }
  | { spend: 'atPct'; pct: number }
  | { swap: 'never' }
  | { swap: 'hpBelow'; pct: number }
  | { place: 'atFeet' | 'onTarget'; keep: number }
  | { form: 'atMax' | 'never' };

export interface ClassDiscovery {
  /** Every requirement must hold. Reuses Requirement, including the `deed` and `quest` kinds. */
  requires: Requirement[];
  /** Rare and above: a QuestDef id with `trialOf` set; finishing it unlocks the class. */
  trial?: string;
  /** Sigil cost of the Trial, paid when it is accepted (Phase 2: materials). */
  sigils?: number;
}

/** @deprecated v2 discovery pattern. Kept so classes without `discover` keep working until the content lane lands. */
export interface ClassClause {
  /** A skill counts if it has every tag listed (element ids and weapons count as tags). */
  tags: string[];
  count: number;
}

/** @deprecated The class tree is removed in v4 (§3.4). The type stays so old data and old screens compile. */
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

/** @deprecated v2 tiers. v4 classes have a `rarity`; classes.classTier() maps one to the other. */
export type ClassTier = 1 | 2 | 3;

/**
 * A class (SPEC-v4 §3.3). The v4 fields (`rarity`, `weapon`, `source`, `mechanic`, `kit`, `discover`, `look`) are
 * optional in this type only so that today's v2 data keeps compiling: author new classes as {@link ClassDefV4},
 * where they are required. A class without a `kit` is a v2 class and behaves as before (pattern discovery, relevance
 * slots); Registry.validate reports a class that has neither `discover` nor a v2 pattern.
 */
export interface ClassDef {
  id: string;
  name: string;
  icon: string;
  /** One line, under 60 characters. */
  desc: string;
  /** One riddle line for the silhouette. */
  hint: string;
  rarity?: Rarity;
  weapon?: WeaponType | 'any';
  source?: PowerSource | 'prism' | 'none';
  mechanic?: ClassMechanic;
  /**
   * Addition to the spec sketch: the mechanic from Class Level CLASS.mechanicUpgradeAt (8) on — the whole mechanic,
   * usually `{ ...mechanic, max: 12 }` — and the one line that says what changed.
   */
  mechanicUpgrade?: { line: string; mechanic: ClassMechanic };
  /** Exactly 5 SkillDef ids. kit[i] unlocks at CLASS.kitAt[i]. */
  kit?: [string, string, string, string, string];
  /**
   * PassiveDef id: on while worn (the "Gift"). From Phase 2 also wearable on other classes as a Keepsake once this
   * class is mastered. Optional until Phase 4 ends (legacy kits have none).
   */
  passive?: string;
  discover?: ClassDiscovery;
  bonus: StatBonus;
  /** classLooks key (default: the class id). */
  look?: string;
  /** Mythic and the Moonwarden: no silhouette until whispered. */
  hidden?: boolean;

  // ---- v2 fields, read only for classes without `discover` / `kit` (and `imprint` until Phase 2).
  /** @deprecated */
  tier?: ClassTier;
  /** @deprecated */
  clauses?: ClassClause[];
  /** @deprecated */
  distinctElements?: number;
  /** @deprecated Tier II/III: classes (and Class Levels) required. */
  parents?: { id: string; rank: number }[];
  /** @deprecated Extra v2 requirements. v4: `discover.requires`. */
  requires?: Requirement[];
  /** @deprecated Signature skills granted on discovery. v4: the kit. */
  grants?: string[];
  /** PassiveDef id of today's Keepsake, unlocked at CLASS.imprintAt (Class Level 5). Unchanged until Phase 2. */
  imprint?: string;
  /** @deprecated Ignored by the rules since v4 Phase 1 (no points, no nodes). */
  tree?: ClassNode[];
}

/** A class authored for v4: every v4 field present. */
export type ClassDefV4 = ClassDef &
  Required<Pick<ClassDef, 'rarity' | 'weapon' | 'source' | 'mechanic' | 'kit' | 'discover'>>;

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
  /** Class id: this quest is that class's Trial (ClassDiscovery.trial); finishing it unlocks the class. */
  trialOf?: string;
}

// ------------------------------------------------------------------ materials (SPEC-v4 §7.1; the Pouch fills from Phase 2)

export type MaterialId = 'fang' | 'mote' | 'core' | 'sap' | 'dust' | 'sigil';
export const MATERIAL_IDS: readonly MaterialId[] = ['fang', 'mote', 'core', 'sap', 'dust', 'sigil'];
