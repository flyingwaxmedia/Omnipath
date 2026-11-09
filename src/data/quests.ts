import type { QuestDef, QuestObjective, Requirement } from '../core/types';

// Quests (docs/QUESTS.md). Every NPC in src/data/npcs.ts gives at least one; trainer techniques, passives and
// essences are taught ONLY as quest rewards (`rewards.lesson`, one quest per LessonDef in src/data/trainers.ts):
// a lesson's old requirements became the quest's `requires` / objectives, its old cost became deliver and
// effort objectives. Repeatable lessons (passive ranks, essence trades) became repeatable bounties.
//
// Pacing: the first quest of every Hearth Vale NPC is offered from a fresh save; later ones follow `after`
// chains. Riftmarch quests require having reached the rift. Ids are `<giver npc>_<slug>`.
// Targets only use ids that exist in the maps (spawned monsters, present node kinds, real maps) and flags from
// the client flag contract (docs/CLIENT-v2.md §5). Checked by tests/quests.test.ts and Registry.validate().
//
// Dialog (docs/UX-SIMPLE.md rules 2, 8, 9): at most two short sentences per beat (hard limit: 3 sentences, 160
// characters), each teaching something the player can use, in player words only (Class Level, Keepsake, Fuse, never
// Class Rank / Imprint / calling / tier). Flavour that does not fit goes in QUEST_LORE, behind the dialog's "More"
// toggle. Checked by tests/plain-text.test.ts.

const MINUTE = 60_000;

/** Repeatable bounty: offered again `minutes` of game time after each turn-in. */
const bounty = (minutes: number): { cooldownMs: number } => ({ cooldownMs: minutes * MINUTE });

/** A live-condition objective. */
const state = (requires: Requirement, label: string): QuestObjective => ({ kind: 'state', requires, label });

/** Any authored skill at rank >= minRank (empty tags match every skill). */
const anySkill = (minRank: number, count = 1): Requirement => ({ type: 'tagCount', tags: [], count, minRank });

/** The weapon's basic attack (slash / stab / bolt all carry 'basic') at rank >= minRank. */
const basicRank = (minRank: number): Requirement => ({ type: 'tagCount', tags: ['basic'], count: 1, minRank });

/** Set by the core SkillBook the first time a class is worn (the first class discovered is worn at once). */
const CLASS_WORN: Requirement = { type: 'flag', id: 'class_worn', min: 1, label: 'Become a class' };

const ARRIVED_RIFT_ROAD: Requirement = { type: 'mapVisited', id: 'rift.riftgate_road' };
const ARRIVED_RIFTMARCH: Requirement = { type: 'mapVisited', id: 'rift.riftmarch' };

export const QUESTS: QuestDef[] = [
  // ================================================================ greenmeadow · Drillmaster Hale
  {
    id: 'hale_first_drill',
    name: 'First Drill',
    giver: 'hale',
    chain: 'Drill Yard',
    summary: 'Fight Jellops with your attack until it reaches rank 3.',
    dialog: {
      offer: 'Feet planted, recruit! Hit those Jellops with your attack until it reaches rank three.',
      progress: 'Keep swinging. Only hits that land teach a skill, and every kill teaches it more.',
      complete: 'Rank three, good arms on you. Lesson one is Rising Kick, a kick that lifts a foe off its feet.',
    },
    objectives: [
      { kind: 'use', tag: 'basic', count: 12 },
      { kind: 'kill', monster: 'jellop', count: 6 },
      state(basicRank(3), 'Raise your attack to rank 3'),
    ],
    rewards: { lesson: 'hale_rising_kick', coins: 10, exp: 30 },
  },
  {
    id: 'hale_whole_body',
    name: 'Whole Body',
    giver: 'hale',
    chain: 'Drill Yard',
    summary: 'Drill Rising Kick on Pipsprouts and bring Hale 3 herbs for the liniment.',
    dialog: {
      offer: 'Now learn to hit with your whole body. Use Rising Kick on the Pipsprouts in the flowers, and pick me three herbs.',
      progress: 'Rising Kick on a Pipsprout, recruit. Herbs grow in the meadow grass; tap a clump to pick it.',
      complete: 'That is the stance. Go through them, not at them: Shoulder Charge.',
    },
    after: ['hale_first_drill'],
    objectives: [
      { kind: 'use', skill: 'rising_kick', count: 8 },
      { kind: 'kill', monster: 'pipsprout', count: 6 },
      { kind: 'deliver', item: 'herb', count: 3 },
    ],
    rewards: { lesson: 'hale_shoulder_charge', coins: 10, exp: 40 },
  },
  {
    id: 'hale_footwork',
    name: 'Footwork Drills',
    giver: 'hale',
    chain: 'Drill Yard',
    summary: "Run Hale's footwork drill: clear 10 Jellops and bring 4 herbs.",
    dialog: {
      offer: 'Footwork drills, until your legs ache. Clear ten Jellops off my yard, then bring four herbs for the ache.',
      progress: 'Keep moving between targets. Fighters who plant their feet get flattened.',
      complete: 'Lighter already; your feet will remember this. Come back in a while and we go again.',
    },
    after: ['hale_first_drill'],
    objectives: [
      { kind: 'kill', monster: 'jellop', count: 10 },
      { kind: 'deliver', item: 'herb', count: 4 },
    ],
    rewards: { lesson: 'hale_sure_footing', exp: 40 },
    repeatable: bounty(20),
  },
  {
    id: 'hale_crack_it_open',
    name: 'Crack It Open',
    giver: 'hale',
    chain: 'Drill Yard',
    summary: "Raise your attack to rank 5, then fight Mirror Lake's wisps for a sudden insight.",
    dialog: {
      offer:
        'Fight something a little scary and a skill can change mid-swing: a sudden insight. Get your attack to rank five, then fight the Mirror Lake wisps.',
      progress: 'A gold pulse on the slot means the skill is learning well. Insights are rare, so keep at it.',
      complete: 'Insight or not, now you know where to look. Tougher foes teach deeper forms.',
    },
    after: ['hale_first_drill'],
    objectives: [
      state(basicRank(5), 'Raise your attack to rank 5'),
      { kind: 'use', tag: 'basic', count: 30 },
      { kind: 'kill', monster: 'puddlewisp', count: 10 },
    ],
    rewards: { coins: 60, exp: 80, items: { healing_draught: 2 } },
  },

  // ================================================================ hearthvale · Brann the Smith
  {
    id: 'brann_heat_in_hands',
    name: 'Heat in the Hands',
    giver: 'brann',
    chain: 'The Forge',
    summary: "Forge three fine pieces at Brann's anvil.",
    dialog: {
      offer: 'Two ore on the anvil, then strike when the metal glows brightest. Forge three fine pieces and the fire stays in you.',
      progress: 'Wait for the glow, then strike. Short of ore? Greystone Quarry, east of town, has plenty.',
      complete: "Three true pieces, and fire in your hands. Here is a smith's trick for when the anvil is far: the Hammer Toss.",
    },
    objectives: [state({ type: 'flag', id: 'forge_success', min: 3 }, 'Forge 3 fine pieces at the anvil')],
    rewards: { lesson: 'brann_hammer_toss', coins: 10, exp: 40 },
  },
  {
    id: 'brann_big_hammer',
    name: 'The Big Hammer',
    giver: 'brann',
    chain: 'The Forge',
    summary: 'Fight with heavy techniques and bring Brann 6 ore for the bellows.',
    dialog: {
      offer: 'Your arms are ready for the big hammer. Fight with heavy skills, Hammer Toss counts, and bring me six ore for the forge.',
      progress: 'Heavy swings only; quick jabs build nothing. Ore sits in the rock at Greystone Quarry.',
      complete: 'Feel that in your shoulders? That strength stays. Come back after a rest for another round.',
    },
    after: ['brann_heat_in_hands'],
    requires: [{ type: 'flag', id: 'forge_success', min: 5, label: 'Forge 5 fine pieces' }],
    objectives: [
      { kind: 'use', tag: 'heavy', count: 20 },
      { kind: 'deliver', item: 'ore', count: 6 },
    ],
    rewards: { lesson: 'brann_forgehand', exp: 80 },
    repeatable: bounty(20),
  },
  {
    id: 'brann_find_the_seam',
    name: 'Find the Seam',
    giver: 'brann',
    chain: 'The Forge',
    summary: 'Raise a blade skill to rank 5, mine 20 ore and break 8 Craglings to learn where armor gives.',
    dialog: {
      offer: 'A well-used blade can learn where armor is weak. Raise a blade skill to rank five, mine twenty ore and break eight Craglings.',
      progress: 'Hit the Craglings along their cracks; fire bites stone deepest. The quarry rock faces grow back while you work.',
      complete: 'You know where the rock gives now, and so does your blade. Here is Crack Armor: it stuns what it does not break.',
    },
    after: ['brann_heat_in_hands'],
    objectives: [
      state({ type: 'tagCount', tags: ['blade'], count: 1, minRank: 5 }, 'Raise a blade skill to rank 5'),
      { kind: 'gather', node: 'ore', count: 20 },
      { kind: 'kill', monster: 'cragling', count: 8 },
    ],
    rewards: { lesson: 'brann_crack_armor', coins: 10, exp: 80 },
  },
  {
    id: 'brann_anvil_dust',
    name: 'Anvil Dust',
    giver: 'brann',
    chain: 'The Forge',
    summary: 'Break 10 Craglings at Greystone Quarry and bring Brann 4 ore.',
    dialog: {
      offer: 'Cragling dust smells just like my anvil. Break ten Craglings and bring four ore, and I will sweep you some of the good stuff.',
      progress: 'Craglings roam the quarry floor, east of town. Bring the ore too.',
      complete: 'Essence of Weight, fresh from under the anvil. Lay it on a strike, spin or dash at the altar and feel it land.',
    },
    objectives: [
      { kind: 'kill', monster: 'cragling', count: 10 },
      { kind: 'deliver', item: 'ore', count: 4 },
    ],
    rewards: { lesson: 'brann_essence_heavy', exp: 60 },
    repeatable: bounty(15),
  },

  // ================================================================ hearthvale · Sister Alba
  {
    id: 'alba_three_lights',
    name: 'Three Lights in Balance',
    giver: 'alba',
    chain: 'The Chapel',
    summary: 'Find three elements, then return to Sister Alba.',
    dialog: {
      offer: 'Carry three elements in balance and the light can find a home in you. Fire, water, earth or wind: gather any three and come back.',
      progress: "Fire at the forge, water at Pell's pier, earth in the quarry, wind at the Windcrest shrine. Each comes from doing, not reading.",
      complete: 'Three lights, and they sit well together. Kneel, and take the fourth: holy light, strong against shadow and the restless dead.',
    },
    objectives: [state({ type: 'elementsKnown', count: 3, primalOnly: true }, 'Find 3 elements')],
    rewards: { element: 'holy', whisper: 'paladin', coins: 40, exp: 60 },
  },
  {
    id: 'alba_quiet_hours',
    name: 'Quiet Hours',
    giver: 'alba',
    chain: 'The Chapel',
    summary: 'Calm 8 Pipsprouts in the meadow herb beds and bring Alba 5 herbs for the incense.',
    dialog: {
      offer: 'The well your skills draw from can be deepened. Calm the Pipsprouts in the meadow herb beds and bring me five herbs for incense.',
      progress: 'The Pipsprouts giggle in the flowers of Greenmeadow, west of town. Herbs grow there and around Mirror Lake.',
      complete: 'Sit with me a while. There: your skills have more SP to draw on now.',
    },
    requires: [{ type: 'elementsKnown', count: 2 }],
    objectives: [
      { kind: 'kill', monster: 'pipsprout', count: 8 },
      { kind: 'deliver', item: 'herb', count: 5 },
    ],
    rewards: { lesson: 'alba_devotion', exp: 50 },
    repeatable: bounty(20),
  },
  {
    id: 'alba_rest_the_restless',
    name: 'Rest for the Restless',
    giver: 'alba',
    chain: 'The Chapel',
    summary: 'Lay 6 revenants in Gloomwood to rest and bring Alba 4 herbs.',
    dialog: {
      offer: 'The restless dead drift through Gloomwood, south of town. Lay six to rest and bring me four herbs for dressings.',
      progress: 'Hollowshades drift between the Gloomwood trees. Holy light bites deep into shadow.',
      complete: 'You came back lighter than you left. Here is Mending Light: it closes your wounds as you fight.',
    },
    after: ['alba_three_lights'],
    requires: [{ type: 'element', id: 'holy' }],
    objectives: [
      { kind: 'kill', family: 'revenant', count: 6 },
      { kind: 'deliver', item: 'herb', count: 4 },
    ],
    rewards: { lesson: 'alba_mending_light', whisper: 'moonwarden', coins: 10, exp: 80 },
  },
  {
    id: 'alba_pale_glade',
    name: 'The Pale Glade',
    giver: 'alba',
    chain: 'The Chapel',
    summary: 'Raise a skill to rank 5, find the pale glade past Gloomwood and bring back 2 sun water.',
    dialog: {
      offer: 'A glyph stone in Gloomwood wakes for a skill with light or shadow. Walk the pale glade beyond it and bring me two sun water.',
      progress: 'Fuse a rank-five skill with holy light at the altar in town. Cast it beside the Gloomwood glyph and the way will show.',
      complete: 'You walked the pale glade and came back changed. Now let the light out all at once: Radiant Burst.',
    },
    after: ['alba_rest_the_restless'],
    objectives: [
      state(anySkill(5), 'Raise any skill to rank 5'),
      { kind: 'visit', map: 'vale.moonlit_glade' },
      { kind: 'deliver', item: 'sun_water', count: 2 },
    ],
    rewards: { lesson: 'alba_radiant_burst', coins: 10, exp: 130 },
  },

  // ================================================================ mirror_lake · Fisher Pell
  {
    id: 'pell_mend_the_net',
    name: 'Mend the Net',
    giver: 'pell',
    chain: "Pell's Pier",
    summary: 'Catch 5 fish at Mirror Lake and give them to Pell.',
    dialog: {
      offer: 'My net has a hole in it. Catch me five fish off the pier: wait for the bite, then reel in quick.',
      progress: 'The end of the pier is the best spot. Tap the ripples, wait for the tug, and do not reel early.',
      complete: 'Five beauties, and the lake is in you already. Watch the cast: a net that slows whatever it lands on.',
    },
    objectives: [
      { kind: 'gather', node: 'fishing', count: 5 },
      { kind: 'deliver', item: 'fish', count: 5 },
    ],
    rewards: { lesson: 'pell_net_throw', coins: 10, exp: 20 },
  },
  {
    id: 'pell_set_the_hook',
    name: 'Set the Hook',
    giver: 'pell',
    chain: "Pell's Pier",
    summary: 'Net and fight Puddlewisps, then bring Pell 10 fish.',
    dialog: {
      offer: 'Set the hook, then reel; it works on wisps as well as trout. Use Net Throw on the Puddlewisps and bring me ten fish.',
      progress: 'Net them first, then strike while they are slowed. The fishing spots refill while you work.',
      complete: 'That is a proper haul. Hook Pull: throw, catch, and drag them right to your feet.',
    },
    after: ['pell_mend_the_net'],
    objectives: [
      { kind: 'use', skill: 'net_throw', count: 5 },
      { kind: 'kill', monster: 'puddlewisp', count: 6 },
      { kind: 'deliver', item: 'fish', count: 10 },
    ],
    rewards: { lesson: 'pell_hook_pull', coins: 10, exp: 50 },
  },
  {
    id: 'pell_pier_patience',
    name: 'Pier Patience',
    giver: 'pell',
    chain: "Pell's Pier",
    summary: 'Sit the pier with Pell: catch 4 fish and share 6.',
    dialog: {
      offer: 'Sit on the pier with me and let the world come to you. Catch four fish and share six with me.',
      progress: 'No hurry. The fish are not going anywhere, and neither am I.',
      complete: 'You breathe slower than when you came. Stand still in a quiet moment and you will mend faster now.',
    },
    requires: [{ type: 'flag', id: 'fish_caught', min: 3, label: 'Catch 3 fish' }],
    objectives: [
      { kind: 'gather', node: 'fishing', count: 4 },
      { kind: 'deliver', item: 'fish', count: 6 },
    ],
    rewards: { lesson: 'pell_patience', exp: 40 },
    repeatable: bounty(20),
  },
  {
    id: 'pell_wisp_water',
    name: 'Wisp-Water',
    giver: 'pell',
    chain: "Pell's Pier",
    summary: 'Best the Brinewisp and bring Pell 6 fish for a jar of wisp-water.',
    dialog: {
      offer: 'The big Brinewisp past the reeds throws a bubble like a spear. Best it and bring six fish, and I will stopper you some wisp-water.',
      progress: 'The Brinewisp drifts near the reeds and comes back a few minutes after you best it. Step aside from its bubble.',
      complete: 'Essence of Returning: lay it on a projectile at an altar and it flies home a second time. Come back once the lake settles.',
    },
    objectives: [
      { kind: 'kill', monster: 'brinewisp', count: 1 },
      { kind: 'deliver', item: 'fish', count: 6 },
    ],
    rewards: { lesson: 'pell_essence_return', exp: 60 },
    repeatable: bounty(15),
  },

  // ================================================================ windcrest_hill · Old Hermit Oru
  {
    id: 'oru_sit_still',
    name: 'Sit, and Be Still',
    giver: 'oru',
    chain: 'Windcrest Hermitage',
    summary: 'Meditate at the wind shrine on Windcrest Hill and gather 3 chime feathers.',
    dialog: {
      offer: 'The shrine on this hill asks for stillness: sit before it and do not be struck. Pick three chime feathers while you are up here.',
      progress: 'Clear the Gustlings and Sparkbugs away first; any blow breaks the stillness.',
      complete: 'The wind has noticed you; you carry it now. Wind may yet move the fog by the falls that no torch can lift.',
    },
    objectives: [
      state({ type: 'flag', id: 'meditations', min: 1 }, 'Meditate at the wind shrine'),
      { kind: 'gather', node: 'wind_chime', count: 3 },
    ],
    rewards: { coins: 50, exp: 50, items: { mana_draught: 1 } },
  },
  {
    id: 'oru_past_the_limit',
    name: 'Past the Limit',
    giver: 'oru',
    chain: 'Windcrest Hermitage',
    summary: 'Master any skill: raise it to its highest rank.',
    dialog: {
      offer: 'Use one skill until it can rank no higher, until it is mastered. A mastered skill keeps growing and earns charges to transform.',
      progress: 'Mastery comes from fights that teach, not easy ones. Each full bar past the limit gives a charge to transform a skill.',
      complete: 'Mastered. Now sit, and breathe: Meditation mends you while your hands rest.',
    },
    after: ['oru_sit_still'],
    objectives: [state({ type: 'flag', id: 'mastered_any', min: 1 }, 'Master any skill')],
    rewards: { lesson: 'oru_meditation', coins: 10, exp: 100 },
  },
  {
    id: 'oru_open_palm',
    name: 'The Open Palm',
    giver: 'oru',
    chain: 'Windcrest Hermitage',
    summary: 'Raise Meditation to rank 3, settle 8 Gustlings and bring Oru 3 chime feathers.',
    dialog: {
      offer: 'Raise Meditation to rank three, settle eight Gustlings and bring me three chime feathers. Then I will show you the open palm.',
      progress: 'Meditation only grows with a fight around you. Feathers hang from the chime posts or drift off Gustlings.',
      complete: 'Feel the push in your palm? That is Palm Strike, for whatever comes too close.',
    },
    after: ['oru_past_the_limit'],
    objectives: [
      state({ type: 'skill', id: 'meditation', rank: 3 }, 'Raise Meditation to rank 3'),
      { kind: 'kill', monster: 'gustling', count: 8 },
      { kind: 'deliver', item: 'chime_feather', count: 3 },
    ],
    rewards: { lesson: 'oru_palm_strike', coins: 10, exp: 80 },
  },
  {
    id: 'oru_quiet_mind',
    name: 'A Quiet Mind',
    giver: 'oru',
    chain: 'Windcrest Hermitage',
    summary: 'Calm 10 Sparkbugs with a still mind and bring Oru 5 chime feathers.',
    dialog: {
      offer: 'A quiet mind learns more from every fight. Calm ten Sparkbugs on the hill and bring me five chime feathers to hang.',
      progress: 'The Sparkbugs buzz near the chime posts. Their zaps are loud, not deep.',
      complete: 'Quieter, yes: your skills learn a little faster now. Return when the wind turns, and we will sit again.',
    },
    after: ['oru_past_the_limit'],
    requires: [{ type: 'skill', id: 'meditation', rank: 5 }],
    objectives: [
      { kind: 'kill', monster: 'sparkbug', count: 10 },
      { kind: 'deliver', item: 'chime_feather', count: 5 },
    ],
    rewards: { lesson: 'oru_still_mind', exp: 90 },
    repeatable: bounty(20),
  },

  // ================================================================ emberwatch · Quartermaster Vey
  {
    id: 'vey_hold_the_line',
    name: 'Hold the Line',
    giver: 'vey',
    chain: 'Emberwatch Drills',
    summary: 'Become a class, thin 8 Emberkits and bring Vey 2 ember shards.',
    dialog: {
      offer: 'I train soldiers, not sightseers. Come back as a class, thin eight Emberkits off my field and bring two ember shards from the vents.',
      progress: 'A class finds you when you know enough skills of one kind; Tamsin in Hearthvale can explain. Shards come from the Cinder Fields vents.',
      complete: 'You held. Now learn the shout that holds it for everyone: Rally Cry.',
    },
    objectives: [
      state(CLASS_WORN, 'Wear a class'),
      { kind: 'kill', monster: 'emberkit', count: 8 },
      { kind: 'deliver', item: 'ember_shard', count: 2 },
    ],
    rewards: { lesson: 'vey_rally_cry', coins: 10, exp: 80 },
  },
  {
    id: 'vey_under_fire',
    name: 'Under Fire',
    giver: 'vey',
    chain: 'Emberwatch Drills',
    summary: 'Cross the Cinder Fields under fire: down 10 Ashflies and bring Vey 4 ember shards.',
    dialog: {
      offer: 'This is how the watch crosses open ground: fast, low and burning. Down ten Ashflies and bring four ember shards for the kit.',
      progress: 'Ashflies punish anyone who stands still, so close the gap fast. The vents give shards to those who work them.',
      complete: 'Not bad for a sightseer. Flare Dash: through the fire, leaving it burning behind you.',
    },
    after: ['vey_hold_the_line'],
    objectives: [
      { kind: 'kill', monster: 'ashfly', count: 10 },
      { kind: 'deliver', item: 'ember_shard', count: 4 },
    ],
    rewards: { lesson: 'vey_flare_dash', coins: 10, exp: 100 },
  },
  {
    id: 'vey_laps',
    name: 'Laps in Full Kit',
    giver: 'vey',
    chain: 'Emberwatch Drills',
    summary: "Run Vey's laps through the Cinder Fields, Gloomwood and Greystone Quarry, then bring 3 ember shards.",
    dialog: {
      offer: 'Laps in full kit: the Cinder Fields, Gloomwood and Greystone Quarry, then three ember shards. You will hate me, then survive things.',
      progress: 'All three grounds, recruit, and the shards on top. Hate me on the move.',
      complete: 'Still standing? There is more of you than this morning. Back in a while for another lap.',
    },
    after: ['vey_hold_the_line'],
    requires: [CLASS_WORN],
    objectives: [
      { kind: 'visit', map: 'vale.cinder_fields' },
      { kind: 'visit', map: 'vale.gloomwood' },
      { kind: 'visit', map: 'vale.greystone_quarry' },
      { kind: 'deliver', item: 'ember_shard', count: 3 },
    ],
    rewards: { lesson: 'vey_field_drill', exp: 100 },
    repeatable: bounty(20),
  },
  {
    id: 'vey_supply_order',
    name: 'Supply Order',
    giver: 'vey',
    chain: 'Emberwatch Drills',
    summary: 'Clear 8 Voltcalves off Stormbreak Approach and bring Vey 5 ember shards.',
    dialog: {
      offer: 'The road east to Stormbreak Approach is crawling with Voltcalves. Clear eight and bring five ember shards for some Essence of Haste.',
      progress: 'The approach lies east of the Cinder Fields. Earth strikes bite deep into lightning.',
      complete: 'Order filled. Lay the essence on a skill at the altar and it comes round quicker.',
    },
    objectives: [
      { kind: 'kill', monster: 'voltcalf', count: 8 },
      { kind: 'deliver', item: 'ember_shard', count: 5 },
    ],
    rewards: { lesson: 'vey_essence_haste', exp: 120 },
    repeatable: bounty(15),
  },

  // ================================================================ riftgate_road · Korrin the Wayfinder
  {
    id: 'korrin_split_grain',
    name: 'Split Along the Grain',
    giver: 'korrin',
    chain: "Wayfinder's Trade",
    summary: 'Thin 8 Riftlings and bring Korrin 4 stormwood.',
    dialog: {
      offer: 'Stormwood splits along the grain, and so does what lives in it. Bring four lengths from the storm trees and thin eight Riftlings.',
      progress: 'The storm trees crackle; you will hear them first. Riftlings crowd the road itself.',
      complete: 'Good grain. Essence of Splitting: lay it on a projectile at an altar and one shot becomes a fan.',
    },
    requires: [ARRIVED_RIFT_ROAD],
    objectives: [
      { kind: 'kill', monster: 'riftling', count: 8 },
      { kind: 'deliver', item: 'storm_wood', count: 4 },
    ],
    rewards: { lesson: 'korrin_essence_split', exp: 180 },
    repeatable: bounty(15),
  },
  {
    id: 'korrin_ridge_charge',
    name: 'Ridge-Struck',
    giver: 'korrin',
    chain: "Wayfinder's Trade",
    summary: 'Put down 6 Rift Stalkers and bring Korrin 5 stormwood.',
    dialog: {
      offer: 'Charge from struck wood lets a hit leap to the next foe. Bring five stormwood and put down six Rift Stalkers; they steal my cuttings.',
      progress: "Stalkers lunge from the shadows at the road's edge. Keep your back to the trees.",
      complete: 'Essence of Arcing: lay it on a strike, a projectile or a chain and the hit jumps. Watch your fingers.',
    },
    after: ['korrin_split_grain'],
    requires: [ARRIVED_RIFT_ROAD],
    objectives: [
      { kind: 'kill', monster: 'rift_stalker', count: 6 },
      { kind: 'deliver', item: 'storm_wood', count: 5 },
    ],
    rewards: { lesson: 'korrin_essence_arc', exp: 190 },
    repeatable: bounty(15),
  },
  {
    id: 'korrin_needle_point',
    name: 'Needle Point',
    giver: 'korrin',
    chain: "Wayfinder's Trade",
    summary: 'Drive off 6 Frostlings on the Frost Shelf and bring Korrin 4 frost crystals.',
    dialog: {
      offer: 'Frost crystal ground to a needle goes through anything. Chip four from the Frost Shelf, north of Riftmarch, and drive off six Frostlings.',
      progress: 'Frostlings throw ice, and fire cuts through them best. The crystals sit in the shelf walls.',
      complete: 'Needle-fine. Essence of Piercing: your projectiles pass through foes and keep going.',
    },
    after: ['korrin_ridge_charge'],
    requires: [ARRIVED_RIFT_ROAD],
    objectives: [
      { kind: 'kill', monster: 'frostling', count: 6 },
      { kind: 'deliver', item: 'frost_crystal', count: 4 },
    ],
    rewards: { lesson: 'korrin_essence_pierce', exp: 200 },
    repeatable: bounty(15),
  },
  {
    id: 'korrin_far_roads',
    name: 'Stock from Far Roads',
    giver: 'korrin',
    chain: "Wayfinder's Trade",
    summary: 'Topple the Glacier Matron and 8 Hoarhounds on the Frost Shelf.',
    dialog: {
      offer: 'The Glacier Matron leads the Hoarhound pack on the Frost Shelf. Topple her and eight of her pack, and my rare stock is yours.',
      progress: 'She breathes rime in a wide cone, so step around it, not back. Thin her pack first.',
      complete: 'You came back from the Matron. Essence of Expanse: spins, novas and strikes reach wider.',
    },
    after: ['korrin_needle_point'],
    requires: [ARRIVED_RIFT_ROAD, { type: 'level', min: 14 }],
    objectives: [
      { kind: 'kill', monster: 'glacier_matron', count: 1 },
      { kind: 'kill', monster: 'rimefang', count: 8 },
    ],
    rewards: { lesson: 'korrin_essence_expanse', exp: 360 },
    repeatable: bounty(20),
  },
  {
    id: 'korrin_walk_the_roads',
    name: 'Walk the Rift Roads',
    giver: 'korrin',
    chain: "Wayfinder's Trade",
    summary: 'Set foot on the Frost Shelf, the Basalt Steps and Thunderhead Ridge, then bring Korrin 4 stormwood.',
    dialog: {
      offer: 'The rift roads shift faster than any map. Set foot on the Frost Shelf, the Basalt Steps and Thunderhead Ridge, and bring four stormwood.',
      progress: 'Just set foot on each and come back. Stormwood grows by this road and on Thunderhead Ridge.',
      complete: 'You step where the ground is going to be now, and that speed stays with you. Same walk, any time.',
    },
    after: ['korrin_needle_point'],
    requires: [ARRIVED_RIFT_ROAD, { type: 'level', min: 15 }],
    objectives: [
      { kind: 'visit', map: 'rift.frost_shelf' },
      { kind: 'visit', map: 'rift.basalt_steps' },
      { kind: 'visit', map: 'rift.thunderhead_ridge' },
      { kind: 'deliver', item: 'storm_wood', count: 4 },
    ],
    rewards: { lesson: 'korrin_pathfinder', exp: 220 },
    repeatable: bounty(20),
  },

  // ================================================================ hearthvale · Mirelle (waykeeper)
  {
    id: 'mirelle_stones_remember',
    name: 'Stones That Remember',
    giver: 'mirelle',
    chain: 'Waystones',
    summary: 'Walk to the waystones on Windcrest Hill and in Quarry Depths I.',
    dialog: {
      offer: 'Touch a waystone once and it remembers you, so I can send you to it. Wake the stones on Windcrest Hill and in the Quarry Depths.',
      progress: 'Windcrest Hill is north-east past Mirror Lake; the Depths open off Greystone Quarry. Touch a stone and it glows.',
      complete: 'Any stone you touch remembers you now; if you fall, you wake at your resting stone. Here is a shard for a quick trip home.',
    },
    objectives: [
      { kind: 'visit', map: 'vale.windcrest_hill' },
      { kind: 'visit', map: 'vale.quarry_depths.1' },
    ],
    rewards: { coins: 40, exp: 40, items: { waystone_shard: 1 } },
  },
  {
    id: 'mirelle_same_purse',
    name: 'The Same Mirelle',
    giver: 'mirelle',
    turnIn: 'mirelle_2',
    chain: 'Waystones',
    summary: 'Find the waykeeper at Emberwatch, past the Cinder Fields.',
    dialog: {
      offer: 'There is a stone at Emberwatch, the outpost past the Cinder Fields, and someone there to keep it. Go and say hello; mind the ash.',
      progress: 'The Cinder Fields lie south of the quarry and east of Gloomwood. Emberwatch is the walled camp off the fields.',
      complete: 'Yes, I am Mirelle, and yes, I was just in Hearthvale; waykeepers do not walk. Rest by this stone and you start here.',
    },
    after: ['mirelle_stones_remember'],
    objectives: [{ kind: 'visit', map: 'vale.emberwatch' }],
    rewards: { coins: 70, exp: 60 },
  },
  {
    id: 'mirelle_altar_hums',
    name: 'The Altar Hums',
    giver: 'mirelle',
    chain: 'Waystones',
    summary: 'Fuse a rank-5 skill with an element at an altar.',
    dialog: {
      offer: 'Fusion only takes at an altar, and there is one right here in the square. Lay a rank-five skill beside an element you carry.',
      progress: 'The skill must be rank five first. Any element you carry will do, and even a failed pairing teaches you something.',
      complete: 'Listen to it hum: the element changes how the skill hits and what it is strong against. Here is something to try.',
    },
    objectives: [state({ type: 'tagCount', tags: ['infused'], count: 1 }, 'Fuse a skill with an element at an altar')],
    rewards: { essences: { reprise: 1 }, coins: 60, exp: 80 },
  },

  // ================================================================ emberwatch · Mirelle (waykeeper)
  {
    id: 'mirelle_2_barrow_camp',
    name: 'A Fire Underground',
    giver: 'mirelle_2',
    chain: 'Waystones',
    summary: 'Reach the camp on the third floor of Hollow Barrow.',
    dialog: {
      offer: 'Hollow Barrow, off Gloomwood, has a camp with a fire and a stone on its third floor. Rest there and a fall in the dark ends at the camp.',
      progress: 'Two floors of restless dead stand between you and the fire. Wake the first-floor stone too.',
      complete: 'You found the fire; I can smell the smoke on you. Here is something for the walk back up.',
    },
    objectives: [{ kind: 'visit', map: 'vale.hollow_barrow.3' }],
    rewards: { coins: 90, exp: 100, items: { waystone_shard: 1 } },
  },
  {
    id: 'mirelle_2_sealed_door',
    name: 'Night and Dawn',
    giver: 'mirelle_2',
    chain: 'Waystones',
    summary: 'Open the barrow vault door that wants both shadow and holy light.',
    dialog: {
      offer: 'Past the camp sleeps a door that wants both shadow and holy light. Carry both elements and it will open for you.',
      progress: "Shadow comes from the Gloomwood obelisk once you have felled five Gloomcaps. Holy light is Sister Alba's to give.",
      complete: 'The door opened for you, then. Keep what you found; I only wanted to know the notes on the stones were true.',
    },
    after: ['mirelle_2_barrow_camp'],
    objectives: [{ kind: 'visit', map: 'vale.barrow_vault' }],
    rewards: { coins: 120, exp: 130, items: { sun_water: 1 } },
  },

  // ================================================================ hearthvale · Tamsin (loremaster)
  {
    id: 'tamsin_first_calling',
    name: 'A Class Finds You',
    giver: 'tamsin',
    chain: 'The Codex',
    summary: 'Learn skills of one kind until a class finds you.',
    dialog: {
      offer: 'No one picks a class here; it finds you. Learn enough skills of one kind, like blades, spins, shadows or fire, then come back.',
      progress: 'Each class looks for a different kind of skill. The Codex shows the classes you are close to.',
      complete: 'There it is, and it suits you. Your class grows with every skill that fits it; here is a riddle for another.',
    },
    objectives: [state(CLASS_WORN, 'Find your first class')],
    rewards: { whisper: 'wayfarer', coins: 40, exp: 50 },
  },
  {
    id: 'tamsin_blademaster_imprint',
    name: "The Blademaster's Mark",
    giver: 'tamsin',
    chain: 'The Codex',
    summary: 'Reach Class Level 5 as Blademaster.',
    dialog: {
      offer: 'Blademaster suits you, so fight with blades. At Class Level 5 you earn a Keepsake: a bonus you keep in any class.',
      progress: 'Only blade skills raise Blademaster. Fight foes worth your time; easy kills teach a class nothing.',
      complete: 'Class Level 5, and the Keepsake is yours. A deeper blade waits at Class Level 10, with five blade skills at rank 5; here is its riddle.',
    },
    after: ['tamsin_first_calling'],
    requires: [{ type: 'class', id: 'blademaster' }],
    objectives: [state({ type: 'class', id: 'blademaster', rank: 5 }, 'Reach Class Level 5 as Blademaster')],
    rewards: { whisper: 'sword_saint', coins: 100, exp: 100 },
  },
  {
    id: 'tamsin_arcanist_imprint',
    name: "The Arcanist's Mark",
    giver: 'tamsin',
    chain: 'The Codex',
    summary: 'Reach Class Level 5 as Arcanist.',
    dialog: {
      offer: 'Arcanist suits you, so cast. At Class Level 5 you earn a Keepsake: a bonus you keep in any class.',
      progress: 'Only arcane skills raise Arcanist. Fight foes worth your time; easy kills teach a class nothing.',
      complete: 'Class Level 5, and the Keepsake is yours. A deeper study waits at Class Level 10, with five arcane skills at rank 5; here is its riddle.',
    },
    after: ['tamsin_first_calling'],
    requires: [{ type: 'class', id: 'arcanist' }],
    objectives: [state({ type: 'class', id: 'arcanist', rank: 5 }, 'Reach Class Level 5 as Arcanist')],
    rewards: { whisper: 'archmage', coins: 100, exp: 100 },
  },
  {
    id: 'tamsin_shadowstalker_imprint',
    name: "The Shadowstalker's Mark",
    giver: 'tamsin',
    chain: 'The Codex',
    summary: 'Reach Class Level 5 as Shadowstalker.',
    dialog: {
      offer: 'Shadowstalker suits you, so fight unseen. At Class Level 5 you earn a Keepsake: a bonus you keep in any class.',
      progress: 'Only stealth skills raise Shadowstalker. Fight foes worth your time; easy kills teach a class nothing.',
      complete: 'Class Level 5, and the Keepsake is yours. Deeper shadows wait at Class Level 10, with four stealth skills at rank 5; here is its riddle.',
    },
    after: ['tamsin_first_calling'],
    requires: [{ type: 'class', id: 'shadowstalker' }],
    objectives: [state({ type: 'class', id: 'shadowstalker', rank: 5 }, 'Reach Class Level 5 as Shadowstalker')],
    rewards: { whisper: 'phantom', coins: 100, exp: 100 },
  },
  {
    id: 'tamsin_pyroblade_imprint',
    name: "The Pyroblade's Mark",
    giver: 'tamsin',
    chain: 'The Codex',
    summary: 'Reach Class Level 5 as Pyroblade.',
    dialog: {
      offer: 'Pyroblade suits you, so fight with burning edges. At Class Level 5 you earn a Keepsake: a bonus you keep in any class.',
      progress: 'Only fiery blade skills raise Pyroblade. Fight foes worth your time; easy kills teach a class nothing.',
      complete: 'Class Level 5, and the Keepsake is yours. A heavier burning blade waits at Class Level 10; here is its riddle.',
    },
    after: ['tamsin_first_calling'],
    requires: [{ type: 'class', id: 'pyroblade' }],
    objectives: [state({ type: 'class', id: 'pyroblade', rank: 5 }, 'Reach Class Level 5 as Pyroblade')],
    rewards: { whisper: 'magma_knight', coins: 100, exp: 100 },
  },
  {
    id: 'tamsin_tempest_dancer_imprint',
    name: "The Tempest Dancer's Mark",
    giver: 'tamsin',
    chain: 'The Codex',
    summary: 'Reach Class Level 5 as Tempest Dancer.',
    dialog: {
      offer: 'Tempest Dancer suits you, so keep turning. At Class Level 5 you earn a Keepsake: a bonus you keep in any class.',
      progress: 'Only spinning skills raise Tempest Dancer. Fight foes worth your time; easy kills teach a class nothing.',
      complete: 'Class Level 5, and the Keepsake is yours. A wilder dance waits at Class Level 10, with four spin skills at rank 5; here is its riddle.',
    },
    after: ['tamsin_first_calling'],
    requires: [{ type: 'class', id: 'tempest_dancer' }],
    objectives: [state({ type: 'class', id: 'tempest_dancer', rank: 5 }, 'Reach Class Level 5 as Tempest Dancer')],
    rewards: { whisper: 'vortex_dancer', coins: 100, exp: 100 },
  },
  {
    id: 'tamsin_elementalist_imprint',
    name: "The Elementalist's Mark",
    giver: 'tamsin',
    chain: 'The Codex',
    summary: 'Reach Class Level 5 as Elementalist.',
    dialog: {
      offer: 'Elementalist suits you, so fight in every colour you carry. At Class Level 5 you earn a Keepsake: a bonus you keep in any class.',
      progress: 'Skills fused with an element raise Elementalist. Fight foes worth your time; easy kills teach a class nothing.',
      complete: 'Class Level 5, and the Keepsake is yours. A deeper study waits at Class Level 10, with more than three elements; here is its riddle.',
    },
    after: ['tamsin_first_calling'],
    requires: [{ type: 'class', id: 'elementalist' }],
    objectives: [state({ type: 'class', id: 'elementalist', rank: 5 }, 'Reach Class Level 5 as Elementalist')],
    rewards: { whisper: 'prism_sage', coins: 100, exp: 100 },
  },

  // ================================================================ greenmeadow · Lio
  {
    id: 'child_lio_really_fast',
    name: 'Really, Really Fast',
    giver: 'child_lio',
    chain: "Lio's Adventures",
    summary: 'Show Lio a dash in Greenmeadow, three times.',
    dialog: {
      offer: 'Can you go really, really fast? Like, zoom? Show me three times!',
      progress: 'Drillmaster Hale knows a zoomy charge. Or maybe a monster can teach you one!',
      complete: 'Whoa! A sparkly bit of air on Mirror Lake went all wobbly when I ran at it; bet if you zoom at it, something happens!',
    },
    objectives: [{ kind: 'cast', shape: 'dash', map: 'vale.greenmeadow', count: 3 }],
    rewards: { coins: 25, exp: 30, items: { blink_seed: 1 } },
  },
  {
    id: 'child_lio_wobbly_king',
    name: 'The Wobbly King',
    giver: 'child_lio',
    chain: "Lio's Adventures",
    summary: 'Defeat the Jellop Monarch in Greenmeadow.',
    dialog: {
      offer: 'Gran says lots of Jellops make a king, a big wobbly king with a crown! He is by the old standing stones; can you bonk him?',
      progress: 'He is bigger than the others and he does a big squishy SLAM. Watch out for the slam!',
      complete: 'You bonked the king! See him slam enough times and maybe you can learn it too.',
    },
    objectives: [{ kind: 'kill', monster: 'jellop_monarch', count: 1 }],
    rewards: { coins: 30, exp: 60, items: { healing_draught: 1 } },
  },
  {
    id: 'child_lio_frozen_lake',
    name: 'Make the Lake Go Hard',
    giver: 'child_lio',
    chain: "Lio's Adventures",
    summary: 'Cast an ice skill at Mirror Lake three times for Lio.',
    dialog: {
      offer: 'If the lake got hard, I could walk on it and not fall in! Can you make ice at Mirror Lake, three times?',
      progress: 'Gran says the lake goes hard when it gets a really, really cold breath. Maybe the altar in town knows how!',
      complete: 'It went all crunchy, I am never falling in again! You can have my best coins.',
    },
    after: ['child_lio_really_fast'],
    objectives: [{ kind: 'cast', element: 'ice', map: 'vale.mirror_lake', count: 3 }],
    rewards: { coins: 60, exp: 80, items: { mana_draught: 1 } },
  },

  // ================================================================ greystone_quarry · Gus
  {
    id: 'miner_gus_good_haul',
    name: 'A Good Haul',
    giver: 'miner_gus',
    chain: 'Greystone Quarry',
    summary: 'Mine 10 ore and clear 6 Craglings off the quarry floor.',
    dialog: {
      offer: 'Mine ten ore from the rock face and knock six Craglings off my floor. They keep sitting on the good seams.',
      progress: 'Tap a rock face and hold still while you chip. Craglings crack under fire; wind and lightning scatter off them.',
      complete: 'Hear that? The earth answers you now, and here is a chip off the deep seam to make a blow land heavier.',
    },
    objectives: [
      { kind: 'gather', node: 'ore', count: 10 },
      { kind: 'kill', monster: 'cragling', count: 6 },
    ],
    rewards: { essences: { heavy: 1 }, coins: 60, exp: 70 },
  },
  {
    id: 'miner_gus_stand_in_its_way',
    name: 'Stand in Its Way',
    giver: 'miner_gus',
    chain: 'Greystone Quarry',
    summary: "Live through Boulderback's roll, then defeat it, three times.",
    dialog: {
      offer: 'That Boulderback rolls down the slope every morning. Let it roll at you, live through it, then put it down, three times.',
      progress: 'Each time it rolls at you and you finish it, that counts as seen. Learning the roll needs a dash of your own at rank three.',
      complete: 'Three times! A trick you copy off a creature is called an Echo; here, for the bruises.',
    },
    after: ['miner_gus_good_haul'],
    objectives: [{ kind: 'witness', skill: 'boulder_roll', count: 3 }],
    rewards: { whisper: 'mimic', coins: 80, exp: 130, items: { healing_draught: 1 } },
  },
  {
    id: 'miner_gus_rootbound',
    name: 'Something Big and Rooty',
    giver: 'miner_gus',
    chain: 'Greystone Quarry',
    summary: 'Descend the Quarry Depths and defeat the Ironroot Colossus.',
    dialog: {
      offer: 'Something big and rooty lives at the bottom of the deep tunnels, so we stopped mining there. Go down and put it to rest.',
      progress: 'Wake the stones in the Depths on the way down. It stamps before it strikes, so step out of the ring.',
      complete: 'You felled the Colossus? Its stone relic is yours, and the deepest sword arts with it.',
    },
    after: ['miner_gus_good_haul'],
    objectives: [{ kind: 'kill', monster: 'ironroot_colossus', count: 1 }],
    rewards: { coins: 250, exp: 260, items: { ore: 8 } },
  },

  // ================================================================ cinder_fields · Rhea
  {
    id: 'scout_rhea_eyes_on_ash',
    name: 'Eyes on the Ash',
    giver: 'scout_rhea',
    turnIn: 'vey',
    chain: 'Cinder Scouting',
    summary: 'Scout the Cinder Fields: collect 3 ember shards, drive off 6 Ashflies, then report to Vey at Emberwatch.',
    dialog: {
      offer: 'Collect three shards from the ember vents and drive off six Ashflies. Then take my report to Quartermaster Vey at Emberwatch.',
      progress: 'Vents cough up shards when you work them, and Ashflies spit from range. Vey is the one with the voice.',
      complete: "Rhea's report, in one piece. Come back to me as a class and I will make a soldier of you.",
    },
    objectives: [
      { kind: 'gather', node: 'ember_vent', count: 3 },
      { kind: 'kill', monster: 'ashfly', count: 6 },
      { kind: 'visit', map: 'vale.emberwatch' },
    ],
    rewards: { coins: 90, exp: 100 },
  },
  {
    id: 'scout_rhea_thin_the_pack',
    name: 'Thin the Pack',
    giver: 'scout_rhea',
    chain: 'Cinder Scouting',
    summary: 'Thin the Emberkit packs: 10 Emberkits and their Alpha.',
    dialog: {
      offer: 'Emberkit packs are getting bold. Thin ten of them, and when the field goes quiet the Alpha comes out; take it too.',
      progress: 'The packs keep to the middle of the fields. The Alpha is bigger and redder.',
      complete: 'The field is quieter already. Here is something I took off an Alpha; it makes a strike come in a flurry.',
    },
    after: ['scout_rhea_eyes_on_ash'],
    objectives: [
      { kind: 'kill', monster: 'emberkit', rank: 'common', count: 10 },
      { kind: 'kill', monster: 'emberkit_alpha', count: 1 },
    ],
    rewards: { essences: { flurry: 1 }, coins: 120, exp: 140 },
  },
  {
    id: 'scout_rhea_prism_gate',
    name: 'Past the Prism Gate',
    giver: 'scout_rhea',
    chain: 'Cinder Scouting',
    summary: 'Open the Prism Gate on Stormbreak Approach and defeat Thunderhoof.',
    dialog: {
      offer: 'The gate on the plateau counts the elements you carry, and it wants three. Thunderhoof waits past it; open the gate and end it.',
      progress: 'Stormbreak Approach lies east of the fields; wake its waystone first. Earth strikes bite deep into lightning.',
      complete: 'Thunderhoof is down? The road past its arena runs on to the rift and Riftmarch; if you go, go rested.',
    },
    after: ['scout_rhea_thin_the_pack'],
    objectives: [
      { kind: 'visit', map: 'vale.stormbreak' },
      { kind: 'kill', monster: 'thunderhoof', count: 1 },
    ],
    rewards: { coins: 300, exp: 320, items: { healing_draught: 2 } },
  },

  // ================================================================ riftmarch · Ione (archivist)
  {
    id: 'ione_honed_not_collected',
    name: 'Practised, Not Collected',
    giver: 'ione',
    chain: 'The Archive',
    summary: 'Raise 4 different skills to rank 5.',
    dialog: {
      offer: 'Advanced classes are earned, not collected. Bring four different skills to rank five, then we can talk.',
      progress: 'Four different skills at rank five. Fusing a skill does not make it a new one, so train wide as well as deep.',
      complete: 'Four skills at rank five; the Archive will take you seriously now. Here is the riddle of a class with two parents.',
    },
    requires: [ARRIVED_RIFTMARCH],
    objectives: [state(anySkill(5, 4), 'Raise 4 skills to rank 5')],
    rewards: { whisper: 'stormreaver', coins: 200, exp: 300 },
  },
  {
    id: 'ione_hour_between',
    name: 'The Hour Between',
    giver: 'ione',
    chain: 'The Archive',
    summary: 'Gain Twilight, the element of the hour between.',
    dialog: {
      offer: 'Twilight is made at an altar, never found in the wild. The painted lid in the Barrow Vault, beneath Hollow Barrow, tells how.',
      progress: 'Two lights that cannot abide each other, held together on one altar. The Vale holds both.',
      complete: 'Twilight is yours now, and the Dusk Orchard to the south will feel familiar. Here is the riddle of a class of that hour.',
    },
    after: ['ione_honed_not_collected'],
    objectives: [state({ type: 'element', id: 'twilight' }, 'Gain the Twilight element')],
    rewards: { whisper: 'twilight_sage', essences: { reprise: 1 }, coins: 150, exp: 250 },
  },
  {
    id: 'ione_warden_relics',
    name: 'Relics of the Wardens',
    giver: 'ione',
    chain: 'The Archive',
    summary: 'Hold the relics of the Ironroot Colossus and the Hollow Regent.',
    dialog: {
      offer: 'The greatest classes need a relic that only a Warden gives up. You hold the storm relic; bring me word of the stone and dusk relics too.',
      progress: 'The Ironroot Colossus sleeps at the bottom of the Quarry Depths, the Hollow Regent beneath Hollow Barrow.',
      complete: 'Three relics in one pair of hands; each opens the deepest form of a weapon tree. Here is the riddle the storm relic opens.',
    },
    after: ['ione_honed_not_collected'],
    objectives: [
      state({ type: 'flag', id: 'relic_stone', min: 1 }, 'Hold the stone relic (Ironroot Colossus)'),
      state({ type: 'flag', id: 'relic_dusk', min: 1 }, 'Hold the dusk relic (Hollow Regent)'),
    ],
    rewards: { whisper: 'ascendant', essences: { expanse: 1 }, coins: 250, exp: 400 },
  },

  // ================================================================ riftmarch · Dask (waykeeper)
  {
    id: 'dask_lovely_handwriting',
    name: 'Lovely Handwriting',
    giver: 'dask',
    chain: 'Waystones',
    summary: 'Travel back to Hearthvale and speak with Mirelle for Dask.',
    dialog: {
      offer: 'Mirelle leaves notes on my stones in lovely handwriting, but we have never met. Wake my stone, travel to Hearthvale and ask her who she is.',
      progress: 'Touch the waystone in the square, then pick Hearthvale from the travel list. Crossing regions costs a few coins.',
      complete: 'Waykeepers do not walk, she says? I suppose we do not; take these shards for the trouble.',
    },
    requires: [ARRIVED_RIFTMARCH],
    objectives: [{ kind: 'talk', npc: 'mirelle' }],
    rewards: { coins: 150, exp: 150, items: { waystone_shard: 2 } },
  },
  {
    id: 'dask_dusk_bloom',
    name: 'What Blooms at Dusk',
    giver: 'dask',
    chain: 'Waystones',
    summary: 'Walk the Dusk Orchard and defeat 8 Duskhounds.',
    dialog: {
      offer: 'The orchard to the south blooms only at dusk, and its Duskhounds follow travellers to my stone. Put down eight of them.',
      progress: 'Duskhounds hunt at the edge of the orchard. Holy light cuts through twilight, if you carry it.',
      complete: 'Eight fewer at my stone tonight. The orchard keeps stranger things deeper in; here, for the road.',
    },
    after: ['dask_lovely_handwriting'],
    requires: [ARRIVED_RIFTMARCH, { type: 'level', min: 18 }],
    objectives: [
      { kind: 'visit', map: 'rift.dusk_orchard' },
      { kind: 'kill', monster: 'duskhound', count: 8 },
    ],
    rewards: { essences: { flurry: 1 }, coins: 400, exp: 500 },
  },
];

/**
 * Flavour lines behind the small "More" toggle of the NPC dialog (UX-SIMPLE rule 9: the dialog itself says at most
 * two short sentences). Keyed by quest id; optional. Same plain words as the dialog (tests/plain-text.test.ts).
 */
export const QUEST_LORE: Readonly<Record<string, string>> = {
  hale_first_drill: 'Every hit that lands teaches a skill a little. Swinging at air teaches nothing.',
  hale_whole_body: 'A kick is a start. You will want the liniment after this, trust me.',
  hale_crack_it_open: 'Watch the star on its slot: a dim star means the odds are poor, a gold pulse means you are in the right fight.',
  brann_heat_in_hands: 'That is how fire is learned in this town. Fire and a well-worked skill belong together on the altar.',
  brann_find_the_seam: 'Stone plate has seams just like steel.',
  alba_three_lights: 'Those who carry holy light on a blade are called the Oathsworn.',
  alba_rest_the_restless: 'The light can close wounds as well as open them. It whispered me a riddle while you were gone; it is yours too.',
  alba_pale_glade: 'Moths drink moonlight in the pale glade. It remembers its guests, so go back whenever you need its quiet.',
  pell_mend_the_net: 'A good net catches more than fish. Wisps hate this one.',
  oru_past_the_limit: 'You have learned to repeat; now learn to be still. Stillness, too, can be mastered.',
  oru_open_palm: 'Stillness, released all at once, is a palm that need not touch to land.',
  vey_hold_the_line: 'One breath, and steel goes into your arm.',
  vey_supply_order: 'I will have another order for you soon.',
  korrin_split_grain: 'I pay in essence, never in coin.',
  mirelle_stones_remember: 'Travel between stones in the Vale is free. Crossing to another region costs a few coins.',
  mirelle_altar_hums: 'Essences or a second skill can be laid on the altar too.',
  mirelle_2_barrow_camp: 'Same Mirelle, same purse. Every stone you wake is a place to start again.',
  tamsin_first_calling: 'Four blades, three spins, three stealth skills, two fiery blades: each class counts something different.',
  tamsin_blademaster_imprint: 'The class you wear learns fastest, but every class that fits a skill learns a little.',
  tamsin_arcanist_imprint: 'The class you wear learns fastest, but every class that fits a skill learns a little.',
  tamsin_shadowstalker_imprint: 'The class you wear learns fastest, but every class that fits a skill learns a little.',
  tamsin_pyroblade_imprint: 'The class you wear learns fastest, but every class that fits a skill learns a little.',
  tamsin_tempest_dancer_imprint: 'The class you wear learns fastest, but every class that fits a skill learns a little.',
  tamsin_elementalist_imprint: 'The class you wear learns fastest, but every class that fits a skill learns a little.',
  child_lio_wobbly_king: 'Here, I found this in the grass. It is shiny.',
  miner_gus_good_haul: 'Ten good hauls of ore and the stone starts talking back to you; funny how that works.',
  miner_gus_stand_in_its_way: 'Some folk build a whole class out of Echoes. It helps to know a dash already.',
  miner_gus_rootbound: 'The deep tunnels go down further than anyone has mapped. The seams will pay me back.',
  scout_rhea_eyes_on_ash: 'You picked a hot day to scout. The outpost gate is at the far side of the fields.',
  scout_rhea_prism_gate: "It has thrown back three of Vey's patrols. The whole outpost will drink to you tonight.",
  ione_honed_not_collected: 'An advanced class also asks for its parent class at a high Class Level. A transformed skill counts as the skill it came from.',
  ione_hour_between: 'Some classes sleep in that hour and nowhere else.',
  ione_warden_relics: 'Master classes ask for two advanced classes and a relic. Both Wardens are back in the Vale; the waystones will take you.',
  dask_dusk_bloom: 'Whatever lives there is neither light nor shadow. Rest by my stone first; it is the closest one to that trouble.',
};
