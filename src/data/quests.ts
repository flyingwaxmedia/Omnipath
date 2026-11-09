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
// Dialog: at most three sentences per beat; each beat teaches something the player can use.

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
const CLASS_WORN: Requirement = { type: 'flag', id: 'class_worn', min: 1, label: 'Wear a class' };

const ARRIVED_RIFT_ROAD: Requirement = { type: 'mapVisited', id: 'rift.riftgate_road' };
const ARRIVED_RIFTMARCH: Requirement = { type: 'mapVisited', id: 'rift.riftmarch' };

export const QUESTS: QuestDef[] = [
  // ================================================================ greenmeadow · Drillmaster Hale
  {
    id: 'hale_first_drill',
    name: 'First Drill',
    giver: 'hale',
    chain: 'Drill Yard',
    summary: 'Fight Jellops with your basic attack until it reaches rank 3.',
    dialog: {
      offer:
        'Feet planted, recruit! Go hit those Jellops with your basic attack until your arm knows it by heart. Every hit that lands teaches the skill a little, and every kill teaches it more.',
      progress: 'Keep swinging. A skill only learns from blows that land on something, so swinging at air will not count.',
      complete:
        'Rank three already, good arms on you. Here is lesson one: a rising kick that lifts a foe off its feet. Put it on your hotbar and use it until it ranks up too.',
    },
    objectives: [
      { kind: 'use', tag: 'basic', count: 12 },
      { kind: 'kill', monster: 'jellop', count: 6 },
      state(basicRank(3), 'Raise your basic attack to rank 3'),
    ],
    rewards: { lesson: 'hale_rising_kick', coins: 20, exp: 40 },
  },
  {
    id: 'hale_whole_body',
    name: 'Whole Body',
    giver: 'hale',
    chain: 'Drill Yard',
    summary: 'Drill Rising Kick on Pipsprouts and bring Hale 3 herbs for the liniment.',
    dialog: {
      offer:
        'A kick is a start; now learn to hit with your whole body. Practise Rising Kick on the Pipsprouts in the flowers, and pick me three herbs on the way. You will want the liniment after this.',
      progress: 'Rising Kick on the hotbar, recruit, then on a Pipsprout. Herbs grow in the meadow grass; tap a clump to pick it.',
      complete:
        'That is the stance. Lower your shoulder and go through them, not at them: Shoulder Charge. A dash like that is good for more than fighting, too.',
    },
    after: ['hale_first_drill'],
    objectives: [
      { kind: 'use', skill: 'rising_kick', count: 8 },
      { kind: 'kill', monster: 'pipsprout', count: 6 },
      { kind: 'deliver', item: 'herb', count: 3 },
    ],
    rewards: { lesson: 'hale_shoulder_charge', coins: 30, exp: 60 },
  },
  {
    id: 'hale_footwork',
    name: 'Footwork Drills',
    giver: 'hale',
    chain: 'Drill Yard',
    summary: "Run Hale's footwork drill: clear 10 Jellops and bring 4 herbs.",
    dialog: {
      offer:
        'Footwork drills, until your legs ache. Clear ten Jellops off my yard without standing still, then bring four herbs for the ache. Each session makes you a little lighter on your feet.',
      progress: 'Keep moving between targets. Fighters who plant their feet get flattened by the big ones.',
      complete: 'Lighter already. Your feet will remember this when your head forgets it. Come back in a while and we will go again.',
    },
    after: ['hale_first_drill'],
    objectives: [
      { kind: 'kill', monster: 'jellop', count: 10 },
      { kind: 'deliver', item: 'herb', count: 4 },
    ],
    rewards: { lesson: 'hale_sure_footing', coins: 10, exp: 40 },
    repeatable: bounty(20),
  },
  {
    id: 'hale_crack_it_open',
    name: 'Crack It Open',
    giver: 'hale',
    chain: 'Drill Yard',
    summary: "Raise your basic attack to rank 5, then use it on Mirror Lake's wisps until it sparks.",
    dialog: {
      offer:
        'Fight something that frightens you a little, and a technique can crack open mid-swing into its next shape: a Spark. Get your basic attack to rank five, then take it to the Puddlewisps on Mirror Lake. Watch the star on its hotbar slot.',
      progress:
        'A dim star means the fight is too easy for that skill; a gold pulse means you are right where it learns. Sparks are rare, so keep at it.',
      complete:
        'You felt it, did you not? Spark or no spark today, now you know where to look. Tougher foes teach deeper forms, so keep finding fights a step above you.',
    },
    after: ['hale_first_drill'],
    objectives: [
      state(basicRank(5), 'Raise your basic attack to rank 5'),
      { kind: 'use', tag: 'basic', count: 30 },
      { kind: 'kill', monster: 'puddlewisp', count: 10 },
    ],
    rewards: { coins: 60, exp: 120, items: { healing_draught: 2 } },
  },

  // ================================================================ hearthvale · Brann the Smith
  {
    id: 'brann_heat_in_hands',
    name: 'Heat in the Hands',
    giver: 'brann',
    chain: 'The Forge',
    summary: "Forge three fine pieces at Brann's anvil.",
    dialog: {
      offer:
        'Two ore on the anvil, then strike when the metal glows brightest. Forge true three times and the heat stays in you: that is how fire is learned in this town. Take the ore I gave you and start swinging.',
      progress:
        'Wait for the glow, then strike; too early or too late and the piece cracks. Run short of ore and Greystone Quarry, east of town, has plenty.',
      complete:
        'Three true pieces, and fire in your hands to show for it. Now a smith\'s trick for when the anvil is too far away: the Hammer Toss. Fire and a well-worked skill belong together on the altar, but that lesson is yours to find.',
    },
    objectives: [state({ type: 'flag', id: 'forge_success', min: 3 }, 'Forge 3 fine pieces at the anvil')],
    rewards: { lesson: 'brann_hammer_toss', coins: 20, exp: 60 },
  },
  {
    id: 'brann_big_hammer',
    name: 'The Big Hammer',
    giver: 'brann',
    chain: 'The Forge',
    summary: 'Fight with heavy techniques and bring Brann 6 ore for the bellows.',
    dialog: {
      offer:
        'Five fine pieces, so your arms are ready for the big hammer. Fight with heavy techniques, Hammer Toss counts, and bring me six ore to keep the forge fed. An afternoon of that and your blows hit harder for good.',
      progress: 'Heavy swings only, mind; quick jabs build nothing. Ore sits in the rock face at Greystone Quarry.',
      complete: 'Feel that in your shoulders? That is strength that stays. Come back after a rest and we will go another round.',
    },
    after: ['brann_heat_in_hands'],
    requires: [{ type: 'flag', id: 'forge_success', min: 5, label: 'Forge 5 fine pieces' }],
    objectives: [
      { kind: 'use', tag: 'heavy', count: 20 },
      { kind: 'deliver', item: 'ore', count: 6 },
    ],
    rewards: { lesson: 'brann_forgehand', coins: 20, exp: 80 },
    repeatable: bounty(20),
  },
  {
    id: 'brann_find_the_seam',
    name: 'Find the Seam',
    giver: 'brann',
    chain: 'The Forge',
    summary: 'Raise a blade skill to rank 5, mine 20 ore and break 8 Craglings to learn where armor gives.',
    dialog: {
      offer:
        'A blade that has seen real use can learn where armor is weakest. Bring a blade technique to rank five, mine me twenty ore, and crack eight Craglings at the quarry while you are there. Stone plate has seams just like steel.',
      progress:
        'Hit the Craglings along their cracks, and fire bites stone deepest. Twenty ore is two passes of the quarry rock faces; they grow back while you work.',
      complete:
        'That ore will make good practice plate. Here is the strike that finds the gap: Crack Armor. It stuns whatever it does not break.',
    },
    after: ['brann_heat_in_hands'],
    objectives: [
      state({ type: 'tagCount', tags: ['blade'], count: 1, minRank: 5 }, 'Raise a blade skill to rank 5'),
      { kind: 'gather', node: 'ore', count: 20 },
      { kind: 'kill', monster: 'cragling', count: 8 },
    ],
    rewards: { lesson: 'brann_crack_armor', coins: 40, exp: 120 },
  },
  {
    id: 'brann_anvil_dust',
    name: 'Anvil Dust',
    giver: 'brann',
    chain: 'The Forge',
    summary: 'Break 10 Craglings at Greystone Quarry and bring Brann 4 ore.',
    dialog: {
      offer:
        'Cragling dust gets into everything down at the quarry, and it smells just like my anvil. Break ten of them and bring four ore, and I will sweep you a pinch of the good stuff from under the anvil. It makes any blow land heavier.',
      progress: 'Craglings roam the quarry floor, east of town. Bring the ore too; the anvil dust does not sweep itself.',
      complete:
        'Essence of Weight, fresh from under the anvil. Lay it on a strike, spin or dash at the altar and feel it land. More next time, once the dust settles.',
    },
    objectives: [
      { kind: 'kill', monster: 'cragling', count: 10 },
      { kind: 'deliver', item: 'ore', count: 4 },
    ],
    rewards: { lesson: 'brann_essence_heavy', coins: 30, exp: 60 },
    repeatable: bounty(15),
  },

  // ================================================================ hearthvale · Sister Alba
  {
    id: 'alba_three_lights',
    name: 'Three Lights in Balance',
    giver: 'alba',
    chain: 'The Chapel',
    summary: 'Attune three primal elements, then return to Sister Alba.',
    dialog: {
      offer:
        "When three elements dwell in you, in balance, the light can find a home there too. Fire waits at Brann's forge, water at Fisher Pell's pier, earth in the quarry stone and wind at the shrine on Windcrest Hill. Gather any three and come back to me.",
      progress: 'Each element comes from doing, not reading: forge, fish, mine, or sit in stillness. I only listen for what you already carry.',
      complete:
        'Three lights, and they sit well together. Kneel, and take the fourth: holy light, strong against shadow and the restless dead. Those who carry it on a blade are called the Oathsworn.',
    },
    objectives: [state({ type: 'elementsKnown', count: 3, primalOnly: true }, 'Attune three primal elements')],
    rewards: { element: 'holy', whisper: 'paladin', coins: 40, exp: 100 },
  },
  {
    id: 'alba_quiet_hours',
    name: 'Quiet Hours',
    giver: 'alba',
    chain: 'The Chapel',
    summary: 'Calm 8 Pipsprouts in the meadow herb beds and bring Alba 5 herbs for the incense.',
    dialog: {
      offer:
        'Two elements dwell in you already, and the well they draw from can be deepened. Bring me five herbs for the incense, and calm the Pipsprouts trampling the meadow herb beds. Quiet hours of prayer will follow.',
      progress: 'The Pipsprouts giggle in the flowers of Greenmeadow, west of town. Herbs grow there and around Mirror Lake.',
      complete: 'Sit with me a while. There: the well runs a little deeper, and your techniques have more SP to draw on. Come back whenever you are ready to sit again.',
    },
    requires: [{ type: 'elementsKnown', count: 2 }],
    objectives: [
      { kind: 'kill', monster: 'pipsprout', count: 8 },
      { kind: 'deliver', item: 'herb', count: 5 },
    ],
    rewards: { lesson: 'alba_devotion', coins: 10, exp: 50 },
    repeatable: bounty(20),
  },
  {
    id: 'alba_rest_the_restless',
    name: 'Rest for the Restless',
    giver: 'alba',
    chain: 'The Chapel',
    summary: 'Lay 6 revenants in Gloomwood to rest and bring Alba 4 herbs.',
    dialog: {
      offer:
        'The light in you can close wounds as well as open them, but first it must learn what it is for. The restless dead drift through Gloomwood, south of town; lay six of them to rest and bring me four herbs for dressings. Holy light bites deep into shadow.',
      progress: 'Hollowshades drift between the Gloomwood trees, and worse sleeps in the barrow beneath. Herbs grow in the meadow if you have none.',
      complete:
        'You came back lighter than you left. Here is Mending Light, a short prayer that closes your wounds as you fight. Use it when the road wears you thin.',
    },
    after: ['alba_three_lights'],
    requires: [{ type: 'element', id: 'holy' }],
    objectives: [
      { kind: 'kill', family: 'revenant', count: 6 },
      { kind: 'deliver', item: 'herb', count: 4 },
    ],
    rewards: { lesson: 'alba_mending_light', coins: 40, exp: 120 },
  },
  {
    id: 'alba_pale_glade',
    name: 'The Pale Glade',
    giver: 'alba',
    chain: 'The Chapel',
    summary: 'Raise a skill to rank 5, find the pale glade past Gloomwood and bring back 2 sun water.',
    dialog: {
      offer:
        'In Gloomwood an old glyph sleeps on a standing stone, and it wakes for a skill that carries light or shadow. Beyond it lies a pale glade where moths drink moonlight. Walk it, and bring me two sun water from its springs.',
      progress:
        'Raise any skill to rank five, then join it with holy light at the altar here in town. Cast it beside the glyph in Gloomwood and the way will show itself.',
      complete:
        'You walked the pale glade and came back changed; I can see it on you. Now let the light out all at once: Radiant Burst. The glade remembers its guests, so listen for what it whispers.',
    },
    after: ['alba_rest_the_restless'],
    objectives: [
      state(anySkill(5), 'Raise any skill to rank 5'),
      { kind: 'visit', map: 'vale.moonlit_glade' },
      { kind: 'deliver', item: 'sun_water', count: 2 },
    ],
    rewards: { lesson: 'alba_radiant_burst', whisper: 'moonwarden', coins: 60, exp: 200 },
  },

  // ================================================================ mirror_lake · Fisher Pell
  {
    id: 'pell_mend_the_net',
    name: 'Mend the Net',
    giver: 'pell',
    chain: "Pell's Pier",
    summary: 'Catch 5 fish at Mirror Lake and give them to Pell.',
    dialog: {
      offer:
        'A good net catches more than fish, but mine has a hole in it. Catch me five fish off the pier: wait for the bite, then reel in quick. Land a few and the lake sort of gets into you.',
      progress: 'The end of the pier is the best spot. Tap the ripples, wait for the tug, and do not reel early.',
      complete: 'Five beauties, and I can see the lake in you already. Watch the cast: a net that slows whatever it lands on. Wisps hate it.',
    },
    objectives: [
      { kind: 'gather', node: 'fishing', count: 5 },
      { kind: 'deliver', item: 'fish', count: 5 },
    ],
    rewards: { lesson: 'pell_net_throw', coins: 15, exp: 30 },
  },
  {
    id: 'pell_set_the_hook',
    name: 'Set the Hook',
    giver: 'pell',
    chain: "Pell's Pier",
    summary: 'Net and fight Puddlewisps, then bring Pell 10 fish.',
    dialog: {
      offer:
        'Set the hook, then reel: it works on wisps as well as trout, if you are quick about it. Show me your Net Throw on the Puddlewisps along the shore, and bring me ten fish while you are at it. A hook needs bait.',
      progress: 'Net them first, then strike while they are slowed. Ten fish is a few rounds of the fishing spots; they refill while you work.',
      complete: 'That is a proper haul. Hook Pull: throw, catch, and drag them right to your feet. Handy for wisps that like to keep their distance.',
    },
    after: ['pell_mend_the_net'],
    objectives: [
      { kind: 'use', skill: 'net_throw', count: 5 },
      { kind: 'kill', monster: 'puddlewisp', count: 6 },
      { kind: 'deliver', item: 'fish', count: 10 },
    ],
    rewards: { lesson: 'pell_hook_pull', coins: 30, exp: 70 },
  },
  {
    id: 'pell_pier_patience',
    name: 'Pier Patience',
    giver: 'pell',
    chain: "Pell's Pier",
    summary: 'Sit the pier with Pell: catch 4 fish and share 6.',
    dialog: {
      offer:
        'Sit on the pier with me and let the world come to you. Catch four fresh fish and share six with me, and do not rush a single one. Patience is a muscle, and standing still is how you feed it.',
      progress: 'No hurry. The fish are not going anywhere, and neither am I.',
      complete: 'You breathe slower than when you came. Stand still in a quiet moment and you will mend faster now. Come and sit again sometime.',
    },
    requires: [{ type: 'flag', id: 'fish_caught', min: 3, label: 'Catch 3 fish' }],
    objectives: [
      { kind: 'gather', node: 'fishing', count: 4 },
      { kind: 'deliver', item: 'fish', count: 6 },
    ],
    rewards: { lesson: 'pell_patience', coins: 10, exp: 40 },
    repeatable: bounty(20),
  },
  {
    id: 'pell_wisp_water',
    name: 'Wisp-Water',
    giver: 'pell',
    chain: "Pell's Pier",
    summary: 'Best the Brinewisp and bring Pell 6 fish for a jar of wisp-water.',
    dialog: {
      offer:
        'The big Brinewisp out past the reeds throws a bubble like a spear, and its water always comes home to the jar. Best it once and bring six fish for the trade, and I will stopper you some. It makes a thrown thing come back.',
      progress: 'The Brinewisp drifts near the reeds and returns a few minutes after you best it. Watch its bubble: step aside, do not back away.',
      complete:
        'Wisp-water, stoppered tight: Essence of Returning. Lay it on a projectile at an altar and it flies home through everything a second time. Come back for more once the lake settles.',
    },
    objectives: [
      { kind: 'kill', monster: 'brinewisp', count: 1 },
      { kind: 'deliver', item: 'fish', count: 6 },
    ],
    rewards: { lesson: 'pell_essence_return', coins: 20, exp: 60 },
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
      offer:
        'The shrine on this hill asks for stillness. Sit before it, and do not be struck; the wind notices patience. Bring me three chime feathers from the singing posts while you are up here.',
      progress: 'Sit at the shrine and let it finish; any blow breaks the stillness. Clear the Gustlings and Sparkbugs away first.',
      complete:
        'The wind has noticed you; you carry it now. Wind scatters things, and fog that no torch can lift may yet step aside for it. There is such a fog by the falls.',
    },
    objectives: [
      state({ type: 'flag', id: 'meditations', min: 1 }, 'Meditate at the wind shrine'),
      { kind: 'gather', node: 'wind_chime', count: 3 },
    ],
    rewards: { coins: 50, exp: 80, items: { mana_draught: 1 } },
  },
  {
    id: 'oru_past_the_limit',
    name: 'Past the Limit',
    giver: 'oru',
    chain: 'Windcrest Hermitage',
    summary: 'Master any skill: raise it to its highest rank.',
    dialog: {
      offer:
        'You have learned to repeat. Use one skill until it can rank no higher, until it is mastered, and then come and learn to be still. A mastered skill keeps growing past its limit and earns charges for new forms.',
      progress: 'Mastery comes from fights that teach, not easy ones. Each full bar past the limit gives a charge you can spend on a morph.',
      complete: 'Mastered. Now sit, and breathe: Meditation mends you while your hands rest. Stillness, too, can be mastered.',
    },
    after: ['oru_sit_still'],
    objectives: [state({ type: 'flag', id: 'mastered_any', min: 1 }, 'Master any skill')],
    rewards: { lesson: 'oru_meditation', coins: 40, exp: 150 },
  },
  {
    id: 'oru_open_palm',
    name: 'The Open Palm',
    giver: 'oru',
    chain: 'Windcrest Hermitage',
    summary: 'Raise Meditation to rank 3, settle 8 Gustlings and bring Oru 3 chime feathers.',
    dialog: {
      offer:
        'Stillness, released all at once, is a palm that need not touch to land. Bring your Meditation to rank three, settle eight Gustlings, and bring me three chime feathers. Meditate in the middle of a fight; that is where it learns.',
      progress: 'Meditation only grows while there is a fight around you. Feathers hang from the chime posts, or drift off Gustlings.',
      complete: 'Feel the push in your palm? That is Palm Strike. Let it out on whatever comes too close.',
    },
    after: ['oru_past_the_limit'],
    objectives: [
      state({ type: 'skill', id: 'meditation', rank: 3 }, 'Raise Meditation to rank 3'),
      { kind: 'kill', monster: 'gustling', count: 8 },
      { kind: 'deliver', item: 'chime_feather', count: 3 },
    ],
    rewards: { lesson: 'oru_palm_strike', coins: 40, exp: 120 },
  },
  {
    id: 'oru_quiet_mind',
    name: 'A Quiet Mind',
    giver: 'oru',
    chain: 'Windcrest Hermitage',
    summary: 'Calm 10 Sparkbugs with a still mind and bring Oru 5 chime feathers.',
    dialog: {
      offer:
        'A quiet mind notices more, and every lesson your skills learn in battle sinks in deeper. Calm ten Sparkbugs on the hill without losing your temper, and bring me five chime feathers to hang. Then we sit.',
      progress: 'The Sparkbugs buzz near the chime posts. Patience; their zaps are loud, not deep.',
      complete: 'Quieter, yes. Your skills will learn a little faster from every fight now. Return when the wind turns, and we will sit again.',
    },
    after: ['oru_past_the_limit'],
    requires: [{ type: 'skill', id: 'meditation', rank: 5 }],
    objectives: [
      { kind: 'kill', monster: 'sparkbug', count: 10 },
      { kind: 'deliver', item: 'chime_feather', count: 5 },
    ],
    rewards: { lesson: 'oru_still_mind', coins: 20, exp: 90 },
    repeatable: bounty(20),
  },

  // ================================================================ emberwatch · Quartermaster Vey
  {
    id: 'vey_hold_the_line',
    name: 'Hold the Line',
    giver: 'vey',
    chain: 'Emberwatch Drills',
    summary: 'Wear a calling, thin 8 Emberkits and bring Vey 2 ember shards.',
    dialog: {
      offer:
        'I train soldiers, not sightseers. Come back wearing a calling, thin eight Emberkits off my field, and bring two ember shards from the vents. Then I will teach you how the line holds.',
      progress:
        'A calling finds you when enough of your techniques share a shape; Tamsin in Hearthvale can explain. Ember shards cough out of the vents in the Cinder Fields.',
      complete: 'You held. Now learn the shout that holds it for everyone: Rally Cry. One breath, and steel goes into your arm.',
    },
    objectives: [
      state(CLASS_WORN, 'Wear a class'),
      { kind: 'kill', monster: 'emberkit', count: 8 },
      { kind: 'deliver', item: 'ember_shard', count: 2 },
    ],
    rewards: { lesson: 'vey_rally_cry', coins: 60, exp: 120 },
  },
  {
    id: 'vey_under_fire',
    name: 'Under Fire',
    giver: 'vey',
    chain: 'Emberwatch Drills',
    summary: 'Cross the Cinder Fields under fire: down 10 Ashflies and bring Vey 4 ember shards.',
    dialog: {
      offer:
        'This is how the watch crosses open ground under fire: fast, low and burning. Down ten Ashflies, the ones that spit embers from range, and bring four ember shards for the kit. Then I will show you.',
      progress: 'Ashflies punish anyone who stands still, so close the gap fast. The vents give shards to those who work them.',
      complete: 'Not bad for a sightseer. Flare Dash: across the ground and through the fire, leaving it burning behind you. Mind your footing.',
    },
    after: ['vey_hold_the_line'],
    objectives: [
      { kind: 'kill', monster: 'ashfly', count: 10 },
      { kind: 'deliver', item: 'ember_shard', count: 4 },
    ],
    rewards: { lesson: 'vey_flare_dash', coins: 80, exp: 160 },
  },
  {
    id: 'vey_laps',
    name: 'Laps in Full Kit',
    giver: 'vey',
    chain: 'Emberwatch Drills',
    summary: "Run Vey's laps through the Cinder Fields, Gloomwood and Greystone Quarry, then bring 3 ember shards.",
    dialog: {
      offer:
        'Laps of the outpost in full kit. Run the circuit through the Cinder Fields, Gloomwood and Greystone Quarry, and come back with three ember shards. You will hate me, then you will survive things.',
      progress: 'All three grounds, recruit, and the shards on top. Hate me on the move.',
      complete: 'Still standing? Then your body took the lesson, and there is more of you than this morning. Back in a while for another lap.',
    },
    after: ['vey_hold_the_line'],
    requires: [CLASS_WORN],
    objectives: [
      { kind: 'visit', map: 'vale.cinder_fields' },
      { kind: 'visit', map: 'vale.gloomwood' },
      { kind: 'visit', map: 'vale.greystone_quarry' },
      { kind: 'deliver', item: 'ember_shard', count: 3 },
    ],
    rewards: { lesson: 'vey_field_drill', coins: 20, exp: 100 },
    repeatable: bounty(20),
  },
  {
    id: 'vey_supply_order',
    name: 'Supply Order',
    giver: 'vey',
    chain: 'Emberwatch Drills',
    summary: 'Clear 8 Voltcalves off Stormbreak Approach and bring Vey 5 ember shards.',
    dialog: {
      offer:
        'Supply order, recruit: the road east to Stormbreak Approach is crawling with Voltcalves. Clear eight, bring me five ember shards, and I will open the quartermaster\'s stock. Essence of Haste makes any technique come round faster.',
      progress: 'The approach lies east of the Cinder Fields. Earth strikes bite deep into lightning, if you carry any.',
      complete: 'Order filled. Lay that essence on a technique at the altar here and feel it come round quicker. I will have another order for you soon.',
    },
    objectives: [
      { kind: 'kill', monster: 'voltcalf', count: 8 },
      { kind: 'deliver', item: 'ember_shard', count: 5 },
    ],
    rewards: { lesson: 'vey_essence_haste', coins: 50, exp: 120 },
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
      offer:
        'Stormwood splits along the grain, and so does what lives in it. Bring me four lengths from the storm trees by the road, and thin eight Riftlings while you are about it. I pay in essence, never in coin.',
      progress: 'The storm trees crackle; you will hear them before you see them. Riftlings blink about, so strike where they land.',
      complete: 'Good grain. Essence of Splitting: lay it on a projectile at an altar and one shot becomes a fan. Come back when the road has grown more.',
    },
    requires: [ARRIVED_RIFT_ROAD],
    objectives: [
      { kind: 'kill', monster: 'riftling', count: 8 },
      { kind: 'deliver', item: 'storm_wood', count: 4 },
    ],
    rewards: { lesson: 'korrin_essence_split', coins: 60, exp: 150 },
    repeatable: bounty(15),
  },
  {
    id: 'korrin_ridge_charge',
    name: 'Ridge-Struck',
    giver: 'korrin',
    chain: "Wayfinder's Trade",
    summary: 'Put down 6 Rift Stalkers and bring Korrin 5 stormwood.',
    dialog: {
      offer:
        'Charge drawn out of struck wood lets a hit leap to the next foe. Five lengths of stormwood, and six Rift Stalkers off the road, since they keep stealing my cuttings. Then we trade.',
      progress: 'Stalkers lunge out of the shadows at the edge of the road. Keep your back to the trees and the wood close.',
      complete: 'Essence of Arcing, crackling in the jar. Lay it on a strike, a projectile or a chain and the hit jumps. Watch your fingers.',
    },
    requires: [ARRIVED_RIFT_ROAD],
    objectives: [
      { kind: 'kill', monster: 'rift_stalker', count: 6 },
      { kind: 'deliver', item: 'storm_wood', count: 5 },
    ],
    rewards: { lesson: 'korrin_essence_arc', coins: 70, exp: 160 },
    repeatable: bounty(15),
  },
  {
    id: 'korrin_needle_point',
    name: 'Needle Point',
    giver: 'korrin',
    chain: "Wayfinder's Trade",
    summary: 'Drive off 6 Frostlings on the Frost Shelf and bring Korrin 4 frost crystals.',
    dialog: {
      offer:
        'Frost crystal ground to a needle point goes through anything. Chip four from the Frost Shelf, north of Riftmarch, and drive off six Frostlings while you are there. They guard the good shelves.',
      progress: 'Frostlings throw shards of ice, and fire cuts through them best. The crystals sit in the shelf walls and never quite melt.',
      complete: 'Needle-fine. Essence of Piercing: your projectiles pass through one foe and keep going. Bring more ice when you have it.',
    },
    requires: [ARRIVED_RIFT_ROAD],
    objectives: [
      { kind: 'kill', monster: 'frostling', count: 6 },
      { kind: 'deliver', item: 'frost_crystal', count: 4 },
    ],
    rewards: { lesson: 'korrin_essence_pierce', coins: 80, exp: 170 },
    repeatable: bounty(15),
  },
  {
    id: 'korrin_far_roads',
    name: 'Stock from Far Roads',
    giver: 'korrin',
    chain: "Wayfinder's Trade",
    summary: 'Topple the Glacier Matron and 8 Rimefangs on the Frost Shelf.',
    dialog: {
      offer:
        'Rare stock from far roads, and I trade it only for hard work. The Glacier Matron leads the Rimefang pack on the Frost Shelf; topple her and eight of her pack. Then the expanse is yours.',
      progress: 'She breathes rime in a wide cone, so step around it, not back. Her pack runs ahead of her; thin it first.',
      complete: 'You came back from the Matron. Essence of Expanse: spins, novas and strikes reach wider with it. Far roads, far reach.',
    },
    requires: [ARRIVED_RIFT_ROAD],
    objectives: [
      { kind: 'kill', monster: 'glacier_matron', count: 1 },
      { kind: 'kill', monster: 'rimefang', count: 8 },
    ],
    rewards: { lesson: 'korrin_essence_expanse', coins: 120, exp: 300 },
    repeatable: bounty(20),
  },
  {
    id: 'korrin_walk_the_roads',
    name: 'Walk the Rift Roads',
    giver: 'korrin',
    chain: "Wayfinder's Trade",
    summary: 'Set foot on the Frost Shelf, the Basalt Steps and Thunderhead Ridge, then bring Korrin 4 stormwood.',
    dialog: {
      offer:
        'The rift roads shift faster than any map. Walk them with me: set foot on the Frost Shelf, the Basalt Steps and Thunderhead Ridge, and bring four stormwood for the fire after. Your feet will learn where the ground will be.',
      progress: 'Just set foot on each and come back; no one asked you to fight the ridge. Stormwood grows by this road and along Thunderhead Ridge.',
      complete: 'Your stride has changed already; you step where the ground is going to be. That speed stays with you. Same walk, any time.',
    },
    requires: [ARRIVED_RIFT_ROAD],
    objectives: [
      { kind: 'visit', map: 'rift.frost_shelf' },
      { kind: 'visit', map: 'rift.basalt_steps' },
      { kind: 'visit', map: 'rift.thunderhead_ridge' },
      { kind: 'deliver', item: 'storm_wood', count: 4 },
    ],
    rewards: { lesson: 'korrin_pathfinder', coins: 40, exp: 200 },
    repeatable: bounty(20),
  },

  // ================================================================ hearthvale · Mirelle (waykeeper)
  {
    id: 'mirelle_stones_remember',
    name: 'Stones That Remember',
    giver: 'mirelle',
    chain: 'Waystones',
    summary: 'Wake the waystones on Windcrest Hill and in Quarry Depths I.',
    dialog: {
      offer:
        'Touch a waystone once and it remembers you; after that I can send you to any stone you have woken. Two sleep nearby, one on Windcrest Hill and one just inside the Quarry Depths. Wake them both, and choose your resting stone with care: you wake beside it if you fall.',
      progress: 'Windcrest Hill is past Mirror Lake to the north-east; the Depths open off Greystone Quarry, east of town. Touch the stone and it glows.',
      complete:
        'Both stones remember you now. Travel between stones in the Vale is free, and crossing to another region costs a few coins. Here is a waystone shard for when you need to come home in a hurry.',
    },
    objectives: [
      { kind: 'visit', map: 'vale.windcrest_hill' },
      { kind: 'visit', map: 'vale.quarry_depths.1' },
    ],
    rewards: { coins: 40, exp: 60, items: { waystone_shard: 1 } },
  },
  {
    id: 'mirelle_same_purse',
    name: 'The Same Mirelle',
    giver: 'mirelle',
    turnIn: 'mirelle_2',
    chain: 'Waystones',
    summary: 'Find the waykeeper at Emberwatch, past the Cinder Fields.',
    dialog: {
      offer:
        'There is a stone at Emberwatch, the outpost past the Cinder Fields, and someone there to keep it. Go and introduce yourself. Mind the ash.',
      progress: 'The Cinder Fields lie south of the quarry and east of Gloomwood. Emberwatch is the walled camp off the fields.',
      complete:
        'Yes, I am Mirelle, and yes, I was just in Hearthvale; waykeepers do not walk. Touch the stone here and you can rest by this fire instead of walking all the way home.',
    },
    after: ['mirelle_stones_remember'],
    objectives: [{ kind: 'visit', map: 'vale.emberwatch' }],
    rewards: { coins: 70, exp: 90 },
  },
  {
    id: 'mirelle_altar_hums',
    name: 'The Altar Hums',
    giver: 'mirelle',
    chain: 'Waystones',
    summary: 'Infuse a rank-5 skill with an element at an altar.',
    dialog: {
      offer:
        'Fusion only takes at an altar, where the old stones still hum; there is one right here in the square. Bring a skill you have raised to rank five and lay it beside an element you carry. Show me what comes out.',
      progress: 'A skill must reach rank five before the altar will take it. Any attuned element will do, and even a failed pairing leaves a whisper worth hearing.',
      complete:
        'Listen to it hum. An element joined to a skill changes how it hits and what it is strong against, and essences or a second skill can be laid on the altar too. Here is something to experiment with.',
    },
    objectives: [state({ type: 'tagCount', tags: ['infused'], count: 1 }, 'Infuse a skill with an element at an altar')],
    rewards: { essences: { reprise: 1 }, coins: 60, exp: 120 },
  },

  // ================================================================ emberwatch · Mirelle (waykeeper)
  {
    id: 'mirelle_2_barrow_camp',
    name: 'A Fire Underground',
    giver: 'mirelle_2',
    chain: 'Waystones',
    summary: 'Reach the camp on the third floor of Hollow Barrow.',
    dialog: {
      offer:
        'Hollow Barrow has a camp on its third floor, with a fire and a stone of its own. Get down there and rest by it, and a fall in the dark will end at the camp instead of the surface. The barrow opens off Gloomwood.',
      progress: 'Two floors of restless dead stand between you and the fire. Wake the stone on the first floor too; every stone you wake is a place to start again.',
      complete: 'You found the fire; I can smell the smoke on you. Same Mirelle, same purse: here is something for the walk back up.',
    },
    objectives: [{ kind: 'visit', map: 'vale.hollow_barrow.3' }],
    rewards: { coins: 90, exp: 160, items: { waystone_shard: 1 } },
  },
  {
    id: 'mirelle_2_sealed_door',
    name: 'Night and Dawn',
    giver: 'mirelle_2',
    chain: 'Waystones',
    summary: 'Open the barrow vault door that wants both shadow and holy light.',
    dialog: {
      offer:
        'Past the camp sleeps a door that wants both shadow and light. Carry both elements and it will open for you. What lies behind it, I only know from the notes on the stones.',
      progress: 'Shadow comes from the obelisk in Gloomwood once you have felled five Gloomcaps. Holy light is Sister Alba\'s to give.',
      complete: 'Twilight, painted on a chest lid? Then the notes were right. Keep what you found; I only wanted to know it was true.',
    },
    after: ['mirelle_2_barrow_camp'],
    objectives: [{ kind: 'visit', map: 'vale.barrow_vault' }],
    rewards: { coins: 120, exp: 200, items: { sun_water: 1 } },
  },

  // ================================================================ hearthvale · Tamsin (loremaster)
  {
    id: 'tamsin_first_calling',
    name: 'A Calling Finds You',
    giver: 'tamsin',
    chain: 'The Codex',
    summary: 'Gather techniques of one kind until a class finds you.',
    dialog: {
      offer:
        'No one picks a calling here; you become one, shaped by what you know. Gather enough techniques of one kind, blades or spins or shadows or fire, and a class will find you. Come back wearing it.',
      progress: 'Four blades, three spins, three stealth skills, two fiery blades: each calling counts something different. The Codex shows the callings you are close to.',
      complete:
        'There it is, worn well. Every skill that suits it now raises its Class Rank, and each rank buys a step along its tree. Here is a riddle for a calling that walks a lighter road.',
    },
    objectives: [state(CLASS_WORN, 'Discover a class (the first is worn at once)')],
    rewards: { whisper: 'wayfarer', coins: 40, exp: 80 },
  },
  {
    id: 'tamsin_blademaster_imprint',
    name: "The Blademaster's Mark",
    giver: 'tamsin',
    chain: 'The Codex',
    summary: 'Raise Blademaster to Class Rank 5.',
    dialog: {
      offer:
        'Blademaster suits you. Wear it and fight with blades until it reaches Class Rank five. At that rank a class leaves an Imprint, a trace you can carry even while wearing another.',
      progress: 'Only skills that fit the calling feed it, and the worn class takes the larger share. Fight foes worth your time; easy kills teach a class nothing.',
      complete:
        'Rank five, and the Imprint is yours to slot. Past the First Tier lies a deeper blade, but it asks for rank ten and five honed blades. Here is its riddle.',
    },
    after: ['tamsin_first_calling'],
    requires: [{ type: 'class', id: 'blademaster' }],
    objectives: [state({ type: 'class', id: 'blademaster', rank: 5 }, 'Raise Blademaster to Class Rank 5')],
    rewards: { whisper: 'sword_saint', coins: 100, exp: 160 },
  },
  {
    id: 'tamsin_arcanist_imprint',
    name: "The Arcanist's Mark",
    giver: 'tamsin',
    chain: 'The Codex',
    summary: 'Raise Arcanist to Class Rank 5.',
    dialog: {
      offer:
        'Arcanist suits you. Wear it and cast until it reaches Class Rank five. At that rank a class leaves an Imprint, a trace you can carry even while wearing another.',
      progress: 'Only arcane skills feed this calling, and the worn class takes the larger share. Fight foes worth your time; easy kills teach a class nothing.',
      complete:
        'Rank five, and the Imprint is yours to slot. Past the First Tier waits a deeper study, for rank ten and five honed arcane skills. Here is its riddle.',
    },
    after: ['tamsin_first_calling'],
    requires: [{ type: 'class', id: 'arcanist' }],
    objectives: [state({ type: 'class', id: 'arcanist', rank: 5 }, 'Raise Arcanist to Class Rank 5')],
    rewards: { whisper: 'archmage', coins: 100, exp: 160 },
  },
  {
    id: 'tamsin_shadowstalker_imprint',
    name: "The Shadowstalker's Mark",
    giver: 'tamsin',
    chain: 'The Codex',
    summary: 'Raise Shadowstalker to Class Rank 5.',
    dialog: {
      offer:
        'Shadowstalker suits you. Wear it and fight unseen until it reaches Class Rank five. At that rank a class leaves an Imprint, a trace you can carry even while wearing another.',
      progress: 'Only stealth skills feed this calling, and the worn class takes the larger share. Fight foes worth your time; easy kills teach a class nothing.',
      complete:
        'Rank five, and the Imprint is yours to slot. Past the First Tier the shadows go deeper still, for rank ten and four honed stealth skills. Here is its riddle.',
    },
    after: ['tamsin_first_calling'],
    requires: [{ type: 'class', id: 'shadowstalker' }],
    objectives: [state({ type: 'class', id: 'shadowstalker', rank: 5 }, 'Raise Shadowstalker to Class Rank 5')],
    rewards: { whisper: 'phantom', coins: 100, exp: 160 },
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
      complete:
        'Whoa! There is a sparkly bit of air out on Mirror Lake that went all wobbly when I ran at it. Bet if you zoom at it, something happens!',
    },
    objectives: [{ kind: 'cast', shape: 'dash', map: 'vale.greenmeadow', count: 3 }],
    rewards: { coins: 25, exp: 40, items: { blink_seed: 1 } },
  },
  {
    id: 'child_lio_wobbly_king',
    name: 'The Wobbly King',
    giver: 'child_lio',
    chain: "Lio's Adventures",
    summary: 'Defeat the Jellop Monarch in Greenmeadow.',
    dialog: {
      offer:
        'Gran says when there are enough Jellops they get a king, a big wobbly king with a big wobbly crown! I saw him by the flowers. Can you bonk him?',
      progress: 'He is bigger than the others and he does a big squishy SLAM. Watch out for the slam!',
      complete: 'You bonked the king! If you see him slam enough times, maybe you can learn it too. Here, I found this in the grass.',
    },
    objectives: [{ kind: 'kill', monster: 'jellop_monarch', count: 1 }],
    rewards: { coins: 30, exp: 90, items: { healing_draught: 1 } },
  },
  {
    id: 'child_lio_frozen_lake',
    name: 'Make the Lake Go Hard',
    giver: 'child_lio',
    chain: "Lio's Adventures",
    summary: 'Cast an ice skill at Mirror Lake three times for Lio.',
    dialog: {
      offer: 'If the lake got hard, I could walk on it and not fall in! Can you make ice? Do it at Mirror Lake, three times!',
      progress: 'Gran says ice is water and wind holding hands. You have to ask the altar in town nicely.',
      complete: 'It went all crunchy! I am never falling in again. You can have my best coins.',
    },
    after: ['child_lio_really_fast'],
    objectives: [{ kind: 'cast', element: 'ice', map: 'vale.mirror_lake', count: 3 }],
    rewards: { coins: 60, exp: 120, items: { mana_draught: 1 } },
  },

  // ================================================================ greystone_quarry · Gus
  {
    id: 'miner_gus_good_haul',
    name: 'A Good Haul',
    giver: 'miner_gus',
    chain: 'Greystone Quarry',
    summary: 'Mine 10 ore and clear 6 Craglings off the quarry floor.',
    dialog: {
      offer:
        'Ten good hauls of ore and the stone starts talking back to you; funny how that works. Mine ten from the rock face, and knock six Craglings off my floor while you are at it. They keep sitting on the good seams.',
      progress: 'Tap a rock face and hold still while you chip. Craglings crack under fire; wind and lightning just scatter off them.',
      complete: 'Hear that? The earth is answering you now. And here is a pinch of Cragling dust I swept up; it makes a blow land heavier.',
    },
    objectives: [
      { kind: 'gather', node: 'ore', count: 10 },
      { kind: 'kill', monster: 'cragling', count: 6 },
    ],
    rewards: { essences: { heavy: 1 }, coins: 60, exp: 110 },
  },
  {
    id: 'miner_gus_stand_in_its_way',
    name: 'Stand in Its Way',
    giver: 'miner_gus',
    chain: 'Greystone Quarry',
    summary: "Survive Boulderback's roll and defeat it until you earn 3 witness marks.",
    dialog: {
      offer:
        'That Boulderback rolls down the slope every morning like it owns the place. Let it roll at you, live through it, then put it down; do that three times and you will have the trick of it. It helps to know a dash already.',
      progress:
        'Each time it rolls at you and you finish that same beast, you earn a mark. Learning the roll needs a dash of your own at rank three to hang it on.',
      complete:
        'Three marks! A trick you copy off a creature like that is called an Echo, and some folk build a whole calling out of them. Here, for the bruises.',
    },
    after: ['miner_gus_good_haul'],
    objectives: [{ kind: 'witness', skill: 'boulder_roll', count: 3 }],
    rewards: { whisper: 'mimic', coins: 80, exp: 200, items: { healing_draught: 1 } },
  },
  {
    id: 'miner_gus_rootbound',
    name: 'Something Big and Rooty',
    giver: 'miner_gus',
    chain: 'Greystone Quarry',
    summary: 'Descend the Quarry Depths and defeat the Ironroot Colossus.',
    dialog: {
      offer:
        'The deep tunnels go down further than anyone has mapped, and something big and rooty lives at the bottom. We stopped mining there. Go down and put it to rest, and the seams are ours again.',
      progress: 'Wake the stones in the Depths on the way down; the bottom is no place to walk back from. It stamps the floor before it strikes, so step out of the ring.',
      complete:
        'You felled the Colossus? Then the stone relic it guarded is yours, and the deepest sword arts with it. Take this; the seams will pay me back.',
    },
    after: ['miner_gus_good_haul'],
    objectives: [{ kind: 'kill', monster: 'ironroot_colossus', count: 1 }],
    rewards: { coins: 250, exp: 400, items: { ore: 8 } },
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
      offer:
        'You picked a hot day to scout. Collect three shards from the ember vents and drive off six Ashflies, then take my report to Quartermaster Vey at Emberwatch. The outpost gate is at the far side of the fields.',
      progress: 'Vents cough up shards when you work them, and Ashflies spit from range, so keep moving. Vey is the one with the voice.',
      complete: "Rhea's report, carried through the ash in one piece. Good. Come back wearing a calling and I will make a soldier of you.",
    },
    objectives: [
      { kind: 'gather', node: 'ember_vent', count: 3 },
      { kind: 'kill', monster: 'ashfly', count: 6 },
      { kind: 'visit', map: 'vale.emberwatch' },
    ],
    rewards: { coins: 90, exp: 150 },
  },
  {
    id: 'scout_rhea_thin_the_pack',
    name: 'Thin the Pack',
    giver: 'scout_rhea',
    chain: 'Cinder Scouting',
    summary: 'Thin the Emberkit packs: 10 Emberkits and their Alpha.',
    dialog: {
      offer:
        'Emberkits run in packs, and the packs are getting bold. Thin ten of them, and when the whole field goes quiet the Alpha is out; take it too. My patrols can breathe after that.',
      progress: 'The packs keep to the middle of the fields. The Alpha is bigger and redder; you will know it when you see it.',
      complete: 'The field is quieter already. Here is something I took off an Alpha last season; it makes a strike come in a flurry.',
    },
    after: ['scout_rhea_eyes_on_ash'],
    objectives: [
      { kind: 'kill', monster: 'emberkit', count: 10 },
      { kind: 'kill', monster: 'emberkit_alpha', count: 1 },
    ],
    rewards: { essences: { flurry: 1 }, coins: 120, exp: 220 },
  },
  {
    id: 'scout_rhea_prism_gate',
    name: 'Past the Prism Gate',
    giver: 'scout_rhea',
    chain: 'Cinder Scouting',
    summary: 'Open the Prism Gate on Stormbreak Approach and defeat Thunderhoof.',
    dialog: {
      offer:
        "The gate up on the plateau will not move for steel; it counts the elements you carry, and it wants three. Thunderhoof waits past it, and it has thrown back three of Vey's patrols. Open the gate and end it.",
      progress: 'Stormbreak Approach lies east of the fields; wake its waystone before you go in. Earth strikes bite deep into lightning.',
      complete:
        'Thunderhoof is down? The whole outpost will drink to you tonight. The road past its arena runs on to the rift and Riftmarch; if you go, go rested.',
    },
    after: ['scout_rhea_thin_the_pack'],
    objectives: [
      { kind: 'visit', map: 'vale.stormbreak' },
      { kind: 'kill', monster: 'thunderhoof', count: 1 },
    ],
    rewards: { coins: 300, exp: 500, items: { healing_draught: 2 } },
  },

  // ================================================================ riftmarch · Ione (archivist)
  {
    id: 'ione_honed_not_collected',
    name: 'Honed, Not Collected',
    giver: 'ione',
    chain: 'The Archive',
    summary: 'Hone four different skills to rank 5.',
    dialog: {
      offer:
        'First callings come freely; second callings are earned, and here only honed skills are counted. Bring four different skills to rank five or higher, and remember that a variant counts as the skill it came from. Then we can talk about deeper callings.',
      progress: 'Four distinct techniques at rank five. Infusing a skill does not make it a new one, so hone wide as well as deep.',
      complete:
        'Four honed skills; the Archive will take you seriously now. A Second Tier calling also asks for its parent at a high Class Rank. Here is the riddle of one that asks for two parents at once.',
    },
    requires: [ARRIVED_RIFTMARCH],
    objectives: [state(anySkill(5, 4), 'Hone 4 different skills to rank 5')],
    rewards: { whisper: 'stormreaver', coins: 200, exp: 300 },
  },
  {
    id: 'ione_hour_between',
    name: 'The Hour Between',
    giver: 'ione',
    chain: 'The Archive',
    summary: 'Attune Twilight by fusing shadow and holy light at an altar.',
    dialog: {
      offer:
        'Neither night nor day, but the hour that holds both: twilight is a fused element, made rather than found. Lay shadow beside holy light on an altar and carry the result back to me. Callings sleep in that hour that sleep nowhere else.',
      progress: "Shadow and holy, element to element, on the same altar. If you lack one, the Vale has both: Gloomwood's obelisk and Sister Alba's chapel.",
      complete:
        'Twilight sits in you now, and the Dusk Orchard to the south will feel familiar. Here is the riddle of a Third Tier walker between light and dark. Read it twice.',
    },
    after: ['ione_honed_not_collected'],
    objectives: [state({ type: 'element', id: 'twilight' }, 'Attune Twilight')],
    rewards: { whisper: 'eclipse_walker', essences: { reprise: 1 }, coins: 150, exp: 250 },
  },
  {
    id: 'ione_warden_relics',
    name: 'Relics of the Wardens',
    giver: 'ione',
    chain: 'The Archive',
    summary: 'Hold the relics of the Ironroot Colossus and the Hollow Regent.',
    dialog: {
      offer:
        "Third Tier callings ask for two Second Tier classes and a relic that only a Warden will give up. You carry Thunderhoof's already, or you would not be standing here. Bring me word that you hold the stone relic and the dusk relic too.",
      progress:
        'The Ironroot Colossus sleeps at the bottom of the Quarry Depths, the Hollow Regent beneath Hollow Barrow. Both are back in the Vale, and the waystones will take you.',
      complete:
        'Three relics, held by one pair of hands; each also opens the deepest form of a weapon tree. Here is the riddle of the calling the storm relic opens. Read it twice.',
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
      offer:
        'Mirelle? Never met her, but she leaves notes on my stones, in lovely handwriting too. Wake the stone here, travel back to Hearthvale and ask her who she is. Crossing between regions costs a few coins at the stones.',
      progress: 'Touch the waystone in the square, then pick Hearthvale from the travel list. She keeps the stone by the town square.',
      complete: 'She says waykeepers do not walk? Well, I suppose we do not. Take these shards for the trouble.',
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
      offer:
        'The orchard to the south only blooms at dusk, and whatever lives there is neither light nor shadow. Walk it, and put down eight Duskhounds; they have started following travellers to my stone. Rest by the stone first, it is the closest one to that trouble.',
      progress: 'Duskhounds hunt at the edge of the orchard. Holy light cuts through twilight, if you carry it.',
      complete: 'Eight fewer at my stone tonight. The orchard keeps stranger things deeper in, but that is a tale for when you are stronger. Here, for the road.',
    },
    requires: [ARRIVED_RIFTMARCH],
    objectives: [
      { kind: 'visit', map: 'rift.dusk_orchard' },
      { kind: 'kill', monster: 'duskhound', count: 8 },
    ],
    rewards: { essences: { flurry: 1 }, coins: 400, exp: 500 },
  },
];
