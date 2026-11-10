// NPCs (SPEC-v2 §8). Placement lives in the map files (SPEC §7.4); trainer NPCs point at their TrainerDef
// (src/data/trainers.ts), whose lessons are taught as quest rewards. Every NPC gives quests (src/data/quests.ts).
// Lines hint at discoveries and quests without spelling them out — loremasters (Tamsin, Ione) are the exception:
// they explain the class tiers, read in order.
export type NpcRole = 'smith' | 'priestess' | 'hermit' | 'fisher' | 'trainer' | 'waykeeper' | 'loremaster' | 'villager';

export interface NpcDef {
  id: string;
  name: string;
  title: string;
  /** Emoji shown in dialogs. */
  portrait: string;
  /** Texture key (npc_*). */
  texture: string;
  role: NpcRole;
  /** TrainerDef id when this NPC teaches lessons. */
  trainer?: string;
  /** Flavour lines; one is shown at random (or in order for loremasters). */
  lines: string[];
}

export const NPCS: NpcDef[] = [
  // ---------------------------------------------------------------- vale.hearthvale
  {
    id: 'brann',
    name: 'Brann the Smith',
    title: 'Blacksmith',
    portrait: '🔨',
    texture: 'npc_blacksmith',
    role: 'smith',
    trainer: 'brann',
    lines: [
      'Forge true three times and the heat stays in you. That is how fire is learned in this town, not from books.',
      'Ore comes out of Greystone, east of here. Bring me some and we will make the anvil sing.',
      'A blade learns weight the way iron does: by being struck against something harder than itself.',
      'Cragling dust gets into everything down at the quarry. Smells just like my anvil. Makes a blow land heavier, too.',
      'Work one technique until your arms know it cold, then take it to the altar with something new. Iron and fire were never meant to stay apart.',
    ],
  },
  {
    id: 'alba',
    name: 'Sister Alba',
    title: 'Priestess',
    portrait: '🕊️',
    texture: 'npc_priestess',
    role: 'priestess',
    trainer: 'alba',
    lines: [
      'Be at peace, traveler. Rest here whenever the road wears you thin.',
      'When three elements dwell in you, in balance, come back to me. The light waits for those who are ready.',
      'In Gloomwood an old mark sleeps on the stones. Some say it stirs for shadow. I say it stirs for light. Perhaps we are both right.',
      'Light and shadow are not enemies. Joined, they open doors that neither can open alone.',
      'Stillness and light together make a deeper rest than either one alone.',
      'Somewhere past the gloom lies a pale glade where moths drink moonlight. Those who walk there come back changed.',
    ],
  },
  {
    id: 'mirelle',
    name: 'Mirelle',
    title: 'Waykeeper',
    portrait: '🧭',
    texture: 'npc_waykeeper',
    role: 'waykeeper',
    lines: [
      'Touch a waystone once and it remembers you. After that I can send you to any stone you have woken.',
      'Fall in the field and you wake beside the last stone you rested by. Choose it well.',
      'I buy what you gather: ore, herbs, fish, the odd glittering thing. And I can tell you where the sleeping stones are.',
      'Watch the creatures closely when they do something new. Live through it often enough and you might find you can do it too.',
      'Fusion only takes at an altar, where the old stones still hum. There is one here, and more along the road.',
    ],
  },
  {
    id: 'tamsin',
    name: 'Tamsin',
    title: 'Loremaster',
    portrait: '📜',
    texture: 'npc_loremaster',
    role: 'loremaster',
    lines: [
      'No one picks a class here. You become one: the weapon in your hand and how you fight decide it.',
      'Fight with one weapon long enough and its first class finds you. Bring an element to it and rarer ones follow.',
      'A class grows only while you wear it. New class skills come at Class Levels 2, 4 and 6.',
      'At Class Level 5 a class leaves you a Keepsake: a bonus you keep in any class.',
      'Deeper classes ask you to master an earlier one first. Ione, in Riftmarch, keeps those records.',
      'Each time you visit I will read you one riddle from the Codex. Some classes hide even from me until the world gives them away.',
    ],
  },

  // ---------------------------------------------------------------- vale.greenmeadow
  {
    id: 'hale',
    name: 'Drillmaster Hale',
    title: 'Combat Trainer',
    portrait: '🥋',
    texture: 'npc_drillmaster',
    role: 'trainer',
    trainer: 'hale',
    lines: [
      'Feet first, recruit! A kick that lifts a Jellop off the ground is lesson one at every drill yard.',
      'Use a technique until you know it in your sleep. Three ranks in, come back and I will teach you to hit with your whole body.',
      'Fight things that frighten you a little. That is when a technique cracks open and shows you its next shape.',
      'Beating on things far beneath you teaches nothing. Your skills can tell when a fight is too easy.',
      'Watch what monsters do to you. The ones that live long enough to do it twice are teachers, not pests.',
    ],
  },
  {
    id: 'child_lio',
    name: 'Lio',
    title: 'Meadow Kid',
    portrait: '🧒',
    texture: 'npc_child',
    role: 'villager',
    lines: [
      'There is a sparkly bit of air out on Mirror Lake! When I ran at it really fast it went all wobbly. Then I fell in.',
      'Pipsprouts hide in the flowers. If you are quiet you can hear them giggle.',
      'Drillmaster Hale says I kick like a goat. That is good, right? Can you go really fast? Show me!',
      'Gran says when there are enough Jellops they get a king. A big wobbly king with a big wobbly crown!',
    ],
  },

  // ---------------------------------------------------------------- vale.mirror_lake
  {
    id: 'pell',
    name: 'Fisher Pell',
    title: 'Angler',
    portrait: '🎣',
    texture: 'npc_fisher',
    role: 'fisher',
    trainer: 'pell',
    lines: [
      'The end of the pier is the best spot. Wait for the bite, then reel in quick.',
      'Land enough fish and the lake sort of... gets into you. Ask anyone who has fished here long.',
      'See that shimmer out past the reeds? Swimmers never reach it. Something quick might. Something that does not hesitate.',
      'The big brinewisp out there throws a bubble like a spear. I have watched it so long I could near do it myself.',
      'Things that come back to you are worth more than things that do not. The wisps understand that.',
    ],
  },

  // ---------------------------------------------------------------- vale.windcrest_hill
  {
    id: 'oru',
    name: 'Old Hermit Oru',
    title: 'Hermit',
    portrait: '🧙',
    texture: 'npc_hermit',
    role: 'hermit',
    trainer: 'oru',
    lines: [
      'A mastered skill keeps growing. Use it past its limit and it earns a charge to transform.',
      'Fog sits in the hollow by the falls, and no torch will lift it. Only the wind decides what it shows.',
      'The shrine on this hill asks for stillness. Sit, and do not be struck. The wind notices patience.',
      'You have learned to repeat. When you have mastered any one thing, come and learn to be still.',
      'Push a skill far past mastery and it makes room inside itself for a second essence.',
      'Your class is not something you choose. It is something you become.',
    ],
  },

  // ---------------------------------------------------------------- vale.greystone_quarry
  {
    id: 'miner_gus',
    name: 'Gus',
    title: 'Quarry Miner',
    portrait: '⛏️',
    texture: 'npc_miner',
    role: 'villager',
    lines: [
      'Ten good hauls of ore and the stone starts talking back to you. Funny how that works. I could use the help, too.',
      'There is a crack in the old rock face that has been widening for years. Wants a proper heavy blow, it does. Or one almighty bang.',
      'The deep tunnels go down further than anyone has mapped. Something big and rooty lives at the bottom. We stopped mining there.',
      'That Boulderback rolls down the slope every morning like it owns the place. Stand in its way enough times and you will learn the trick of it.',
    ],
  },

  // ---------------------------------------------------------------- vale.cinder_fields
  {
    id: 'scout_rhea',
    name: 'Rhea',
    title: 'Ember Scout',
    portrait: '🏹',
    texture: 'npc_scout',
    role: 'villager',
    lines: [
      'The gate up on the plateau will not move for steel. It counts the elements you carry. Three, I think. Thunderhoof waits past it.',
      'Gloomwood has a glyph cut into a standing stone. It ignored my torch, but I swear it flickered when a shade drifted by.',
      'Emberkits run in packs. When the alpha is out, the whole field goes quiet.',
      'The ember vents cough up shards worth good coin. Quartermaster Vey down at Emberwatch trades for them.',
      'Vey only drills people who have found their class. Come back as one and the outpost will take you seriously.',
    ],
  },

  // ---------------------------------------------------------------- vale.emberwatch
  {
    id: 'vey',
    name: 'Quartermaster Vey',
    title: 'Field Trainer',
    portrait: '🎖️',
    texture: 'npc_quartermaster',
    role: 'trainer',
    trainer: 'vey',
    lines: [
      'I train soldiers, not sightseers. Come back as a class and I will show you how we move on the line.',
      'Ember shards, recruit. Fill my supply orders and the quartermaster\'s stock is yours to draw on.',
      'The best lessons come in hard fights. Find a foe a step above you and hold your ground. You will feel it when it happens.',
      'Thunderhoof has thrown back three of my patrols. Whatever it keeps in its heart, it has earned it. Unless you take it.',
    ],
  },
  {
    id: 'mirelle_2',
    name: 'Mirelle',
    title: 'Waykeeper',
    portrait: '🧭',
    texture: 'npc_waykeeper',
    role: 'waykeeper',
    lines: [
      'Yes, I am Mirelle. Yes, I was just in Hearthvale. Waykeepers do not walk.',
      'Rest by the fire and touch the stone. If you fall out on the ash, you will wake here instead of all the way home.',
      'I buy shards and spores at the same price as in the vale. Same Mirelle, same purse.',
      'Hollow Barrow has a camp on its third floor. Past it sleeps a door that wants both shadow and light.',
    ],
  },

  // ---------------------------------------------------------------- rift.riftgate_road
  {
    id: 'korrin',
    name: 'Korrin the Wayfinder',
    title: 'Essence Trader',
    portrait: '🗺️',
    texture: 'npc_wayfinder',
    role: 'trainer',
    trainer: 'korrin',
    lines: [
      'Every creature carries a little essence of what it does. Hunt one kind long enough and it will give some up.',
      'Stormwood, frost crystal, a hard day on the road: I pay essences for all of it, never for coin.',
      'Two essences in one skill? Only once you have used it far past mastery, again and again.',
      'The rift roads shift faster than any map. Walk them with me a while and your feet will learn where the ground will be.',
      'Riftmarch is just ahead: altar, waystone, and an archivist who will talk your ear off about classes.',
    ],
  },

  // ---------------------------------------------------------------- rift.riftmarch
  {
    id: 'ione',
    name: 'Ione',
    title: 'Archivist',
    portrait: '📚',
    texture: 'npc_archivist',
    role: 'loremaster',
    lines: [
      'First classes come freely. Advanced classes are earned: only the skills you have truly trained count.',
      'For an advanced class only different skills at rank five or higher count, and a transformed skill counts as its original.',
      'An advanced class asks for a first one grown deep: its parent at a high Class Level, sometimes two parents at once.',
      'Master classes ask for two advanced classes and a relic that only a Warden will give up.',
      'Some classes hide from the Codex until the world whispers them: a trainer, a failed fusion, an echo, a well-kept bestiary.',
      'Each visit I will unseal one riddle for you. Read it twice. They rarely mean what they first seem to.',
    ],
  },
  {
    id: 'dask',
    name: 'Dask',
    title: 'Waykeeper',
    portrait: '🏮',
    texture: 'npc_waykeeper',
    role: 'waykeeper',
    lines: [
      'Welcome to Riftmarch. Wake the stone and I can send you back to the Vale for a few coins.',
      'Mirelle? Never met her. She leaves notes on the stones, though. Lovely handwriting.',
      'I buy rift goods at a fair price. Frost crystal fetches the most. It never quite melts.',
      'The orchard to the south only blooms at dusk. Whatever lives there is neither light nor shadow.',
      'Fall out on the ridges and you will wake at the last stone you rested by. Pick one close to your trouble.',
    ],
  },
];
