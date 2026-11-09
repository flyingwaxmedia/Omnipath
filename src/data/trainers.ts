import type { Requirement, TrainerDef } from '../core/types';

// Trainers (SPEC-v2 §4.4 / §8). Trainer ids equal their NPC ids (src/data/npcs.ts).
// Lesson ids are `<trainer>_<grant>`; every id is unique across all trainers.
// Every lesson is the reward of exactly one quest (src/data/quests.ts, docs/QUESTS.md). Until the client's quest
// UI ships, lessons can also still be taken at the trainer: costs are paid from the game inventory
// (SkillBook.inv), and taking one credits the quest that teaches it. Once the quest UI ships, every lesson gets
// `questOnly: true` and is taught only as a quest reward. Blurbs describe what a lesson teaches, never its price.
// Passive lessons are repeatable: each one raises the passive by one rank, up to its maxRank (3).

/** Any authored skill at rank >= minRank (an empty tag list matches every skill). */
const anySkill = (minRank: number): Requirement => ({ type: 'tagCount', tags: [], count: 1, minRank });

/** Any skill carrying `tag` at rank >= minRank. */
const anyTagged = (tag: string, minRank: number): Requirement => ({
  type: 'tagCount',
  tags: [tag],
  count: 1,
  minRank,
});

/**
 * Wearing any class. SkillBook sets flag `class_worn` the first time a class is worn
 * (the first discovered class is worn automatically, and wearing can only change, never be removed).
 */
const WEARING_A_CLASS: Requirement = { type: 'flag', id: 'class_worn', min: 1, label: 'Wear a class' };

/** First mastery of any skill (SkillBook sets flag `mastered_any` on the first max rank). */
const MASTERED_ANY: Requirement = { type: 'flag', id: 'mastered_any', min: 1, label: 'Master any skill' };

export const TRAINERS: TrainerDef[] = [
  // ---------------------------------------------------------------- greenmeadow
  {
    id: 'hale',
    npc: 'hale',
    title: "Hale's Drill Yard",
    lessons: [
      {
        id: 'hale_rising_kick',
        name: 'Rising Kick',
        blurb: 'Lesson one, recruit: lift your foe off its feet. A quick kick that knocks enemies back.',
        grants: { skill: 'rising_kick' },
        requires: [],
        cost: { coins: 20 },
      },
      {
        id: 'hale_shoulder_charge',
        name: 'Shoulder Charge',
        blurb: 'Hit with your whole body, not just your arm. A short, heavy charge that bowls foes over.',
        grants: { skill: 'shoulder_charge' },
        requires: [anySkill(3)],
        cost: { coins: 60, items: { herb: 3 } },
      },
      {
        id: 'hale_sure_footing',
        name: 'Sure Footing',
        blurb: 'Footwork drills until your legs ache. Each session makes you a little faster on your feet.',
        grants: { passive: 'sure_footing' },
        requires: [{ type: 'lesson', id: 'hale_rising_kick' }],
        cost: { coins: 80, items: { herb: 4 } },
        repeatable: true,
      },
    ],
  },

  // ---------------------------------------------------------------- hearthvale
  {
    id: 'brann',
    npc: 'brann',
    title: "Brann's Forge",
    lessons: [
      {
        id: 'brann_crack_armor',
        name: 'Crack Armor',
        blurb: 'A blade that has seen real use can learn where armor is weakest: a strike that finds the gap and stuns.',
        grants: { skill: 'crack_armor' },
        requires: [anyTagged('blade', 5)],
        cost: { coins: 80, items: { ore: 20 } },
      },
      {
        id: 'brann_hammer_toss',
        name: 'Hammer Toss',
        blurb: 'You have worked the forge with me. Now learn what a smith does when the anvil is too far away.',
        grants: { skill: 'hammer_toss' },
        requires: [{ type: 'flag', id: 'forge_success', min: 3, label: 'Forge 3 fine pieces' }],
        cost: { coins: 60, items: { ore: 4 } },
      },
      {
        id: 'brann_forgehand',
        name: 'Forgehand',
        blurb: 'Swing the big hammer for an afternoon. Your arms will thank you later: a lasting boost to attack.',
        grants: { passive: 'forgehand' },
        requires: [{ type: 'flag', id: 'forge_success', min: 5, label: 'Forge 5 fine pieces' }],
        cost: { coins: 120, items: { ore: 6 } },
        repeatable: true,
      },
      {
        id: 'brann_essence_heavy',
        name: 'Essence of Weight',
        blurb: 'Swept from under the anvil: dust that makes any blow land heavier.',
        grants: { essence: 'heavy', count: 1 },
        requires: [],
        cost: { coins: 150 },
        repeatable: true,
      },
    ],
  },
  {
    id: 'alba',
    npc: 'alba',
    title: 'Chapel of the Vale',
    lessons: [
      {
        id: 'alba_mending_light',
        name: 'Mending Light',
        blurb: 'The light in you can close wounds as well as open them. A short prayer of healing.',
        grants: { skill: 'mending_light' },
        requires: [{ type: 'element', id: 'holy' }],
        cost: { coins: 60, items: { herb: 4 } },
      },
      {
        id: 'alba_radiant_burst',
        name: 'Radiant Burst',
        blurb: 'Let the light out all at once. Only a practised hand can hold it long enough to aim.',
        grants: { skill: 'radiant_burst' },
        requires: [{ type: 'element', id: 'holy' }, anySkill(5)],
        cost: { coins: 150, items: { sun_water: 2 } },
      },
      {
        id: 'alba_devotion',
        name: 'Devotion',
        blurb: 'Quiet hours of prayer deepen the well your techniques draw from: more SP.',
        grants: { passive: 'devotion' },
        requires: [{ type: 'elementsKnown', count: 2 }],
        cost: { coins: 100, items: { herb: 5 } },
        repeatable: true,
      },
    ],
  },

  // ---------------------------------------------------------------- mirror_lake
  {
    id: 'pell',
    npc: 'pell',
    title: "Pell's Pier",
    lessons: [
      {
        id: 'pell_net_throw',
        name: 'Net Throw',
        blurb: 'A good net catches more than fish: a cast that slows whatever it lands on.',
        grants: { skill: 'net_throw' },
        requires: [],
        cost: { items: { fish: 5 } },
      },
      {
        id: 'pell_hook_pull',
        name: 'Hook Pull',
        blurb: 'Set the hook, then reel. Works on wisps as well as trout, if you are quick about it.',
        grants: { skill: 'hook_pull' },
        requires: [],
        cost: { items: { fish: 10 } },
      },
      {
        id: 'pell_patience',
        name: 'Patience',
        blurb: 'Sit on the pier and let the world come to you. Standing still restores you faster.',
        grants: { passive: 'patience' },
        requires: [{ type: 'flag', id: 'fish_caught', min: 3, label: 'Catch 3 fish' }],
        cost: { coins: 60, items: { fish: 6 } },
        repeatable: true,
      },
      {
        id: 'pell_essence_return',
        name: 'Essence of Returning',
        blurb: 'Wisp-water in a stoppered jar. Makes a thrown thing come home.',
        grants: { essence: 'return', count: 1 },
        requires: [],
        cost: { items: { fish: 6 } },
        repeatable: true,
      },
    ],
  },

  // ---------------------------------------------------------------- windcrest_hill
  {
    id: 'oru',
    npc: 'oru',
    title: 'Windcrest Hermitage',
    lessons: [
      {
        id: 'oru_meditation',
        name: 'Meditation',
        blurb: 'You have learned to repeat. Now learn to be still: sit, breathe, and mend.',
        grants: { skill: 'meditation' },
        requires: [MASTERED_ANY],
      },
      {
        id: 'oru_palm_strike',
        name: 'Palm Strike',
        blurb: 'Stillness, released all at once. The palm need not touch for the blow to land.',
        grants: { skill: 'palm_strike' },
        requires: [{ type: 'skill', id: 'meditation', rank: 3 }],
        cost: { coins: 60, items: { chime_feather: 3 } },
      },
      {
        id: 'oru_still_mind',
        name: 'Still Mind',
        blurb: 'A quiet mind notices more. Every lesson your skills learn in battle sinks in a little deeper.',
        grants: { passive: 'still_mind' },
        requires: [{ type: 'skill', id: 'meditation', rank: 5 }],
        cost: { coins: 150, items: { chime_feather: 5 } },
        repeatable: true,
      },
    ],
  },

  // ---------------------------------------------------------------- emberwatch
  {
    id: 'vey',
    npc: 'vey',
    title: 'Emberwatch Drills',
    lessons: [
      {
        id: 'vey_flare_dash',
        name: 'Flare Dash',
        blurb: 'How the watch crosses open ground under fire: fast, low, and burning. Callings only.',
        grants: { skill: 'flare_dash' },
        requires: [WEARING_A_CLASS],
        cost: { coins: 120, items: { ember_shard: 4 } },
      },
      {
        id: 'vey_rally_cry',
        name: 'Rally Cry',
        blurb: 'One shout and the line holds. Learn to put steel in your own arm when the fight turns.',
        grants: { skill: 'rally_cry' },
        requires: [WEARING_A_CLASS],
        cost: { coins: 100, items: { ember_shard: 2 } },
      },
      {
        id: 'vey_field_drill',
        name: 'Field Drill',
        blurb: 'Laps of the outpost in full kit. You will hate me, then you will survive things: more max HP.',
        grants: { passive: 'field_drill' },
        requires: [WEARING_A_CLASS],
        cost: { coins: 150, items: { ember_shard: 3 } },
        repeatable: true,
      },
      {
        id: 'vey_essence_haste',
        name: 'Essence of Haste',
        blurb: 'Quartermaster stock. Makes any technique come round faster.',
        grants: { essence: 'haste', count: 1 },
        requires: [],
        cost: { items: { ember_shard: 5 } },
        repeatable: true,
      },
    ],
  },

  // ---------------------------------------------------------------- riftgate_road
  {
    id: 'korrin',
    npc: 'korrin',
    title: "Wayfinder's Trade",
    lessons: [
      {
        id: 'korrin_essence_split',
        name: 'Essence of Splitting',
        blurb: 'Stormwood splits along the grain, and so does what lives in it: one shot becomes a fan.',
        grants: { essence: 'split', count: 1 },
        requires: [],
        cost: { items: { storm_wood: 4 } },
        repeatable: true,
      },
      {
        id: 'korrin_essence_arc',
        name: 'Essence of Arcing',
        blurb: 'Charge drawn out of ridge-struck wood. Lets a hit leap to the next foe.',
        grants: { essence: 'arc', count: 1 },
        requires: [],
        cost: { items: { storm_wood: 5 } },
        repeatable: true,
      },
      {
        id: 'korrin_essence_pierce',
        name: 'Essence of Piercing',
        blurb: 'Frost crystal ground to a needle point: projectiles pass through foes and keep going.',
        grants: { essence: 'pierce', count: 1 },
        requires: [],
        cost: { items: { frost_crystal: 4 } },
        repeatable: true,
      },
      {
        id: 'korrin_essence_expanse',
        name: 'Essence of Expanse',
        blurb: 'Rare stock from far roads: spins, novas and strikes reach wider.',
        grants: { essence: 'expanse', count: 1 },
        requires: [],
        cost: { coins: 300 },
        repeatable: true,
      },
      {
        id: 'korrin_pathfinder',
        name: 'Pathfinder',
        blurb: 'Walk the rift roads with me and learn where the ground will be before you step: more speed.',
        grants: { passive: 'pathfinder' },
        requires: [],
        cost: { coins: 250, items: { storm_wood: 4 } },
        repeatable: true,
      },
    ],
  },
];
