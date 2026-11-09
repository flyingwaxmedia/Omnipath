#!/usr/bin/env node
// Omnipath Playwright smoke test (docs/CLIENT-v2.md §8).
//
//   npm run build && npx vite preview --port 4173 --strictPort &
//   node scripts/playtest.mjs http://localhost:4173/ [--shots <dir>] [--quick] [--portals [--landscape]]
//
// --portals additionally walks EVERY portal pair by real taps (HUD-aware, phone portrait or --landscape), checking
// arrivals and return portals (~25 min).
//
// Starts a new game, opens every panel (and tab), walks Hearthvale -> Greenmeadow through a real portal, fights,
// reveals a hidden portal by casting, opens a Prism Gate, warps through every map via window.omnipath.debug, checks
// that warping does not grow listener counts, and takes portrait-phone / landscape-phone / iPad screenshots.
// Exits non-zero on any console error, page error or failed check.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const args = process.argv.slice(2);
const base = args.find((a) => /^https?:/.test(a)) ?? 'http://localhost:4173/';
const shotsAt = args.indexOf('--shots');
const shots = shotsAt >= 0 ? args[shotsAt + 1] : null;
const quick = args.includes('--quick');
if (shots) mkdirSync(shots, { recursive: true });

const ALL_MAPS = [
  'vale.hearthvale', 'vale.greenmeadow', 'vale.mirror_lake', 'vale.lake_islet', 'vale.windcrest_hill', 'vale.falls_hollow',
  'vale.greystone_quarry', 'vale.collapsed_shaft', 'vale.quarry_depths.1', 'vale.quarry_depths.2', 'vale.quarry_depths.3',
  'vale.gloomwood', 'vale.moonlit_glade', 'vale.hollow_barrow.1', 'vale.hollow_barrow.2', 'vale.hollow_barrow.3',
  'vale.barrow_vault', 'vale.hollow_barrow.4', 'vale.cinder_fields', 'vale.emberwatch', 'vale.stormbreak_approach',
  'vale.stormbreak', 'rift.riftgate_road', 'rift.riftmarch', 'rift.frost_shelf', 'rift.basalt_steps',
  'rift.thunderhead_ridge', 'rift.dusk_orchard',
];

const problems = [];
const fail = (msg) => {
  problems.push(msg);
  console.log(`  ✗ ${msg}`);
};
const ok = (msg) => console.log(`  ✓ ${msg}`);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
await ctx.addInitScript(() => {
  try {
    localStorage.clear();
  } catch {
    /* ignore */
  }
});
const page = await ctx.newPage();
page.on('console', (m) => {
  if (m.type() === 'error') fail(`console error: ${m.text()}`);
});
page.on('pageerror', (e) => fail(`page error: ${e.message}\n${e.stack ?? ''}`));

const info = () => page.evaluate(() => window.omnipath.debug.info());
const dbg = (name, ...a) => page.evaluate(([n, xs]) => window.omnipath.debug[n](...xs), [name, a]);
const shot = async (name) => {
  if (shots) await page.screenshot({ path: `${shots}/${name}.png` });
};
const waitFor = async (pred, ms, label) => {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await pred()) return true;
    await page.waitForTimeout(100);
  }
  fail(`timed out: ${label}`);
  return false;
};
const closeModal = async () => {
  for (let i = 0; i < 8; i++) {
    const st = await info();
    if (!st.open) return;
    const btn = (await page.$('.discovery .ok')) ?? (await page.$('.dialog [data-opt]')) ?? (await page.$('.sheet .x'));
    if (btn) await btn.click();
    else await page.evaluate(() => window.omnipath.ui.close());
    await page.waitForTimeout(150);
  }
};
const warp = async (mapId, portal) => {
  await closeModal();
  await dbg('warp', mapId, portal);
  const done = await waitFor(async () => (await info()).map === mapId, 6000, `warp to ${mapId}`);
  await page.waitForTimeout(350);
  await closeModal();
  return done;
};

try {
  console.log(`Omnipath playtest @ ${base}`);
  await page.goto(base);
  await page.waitForSelector('.title-screen .new', { timeout: 20000 });
  await page.click('.title-screen .new');
  await page.fill('.title-screen input.name', 'Playtest');
  await page.click('.wcard[data-w="sword"]');
  await page.click('.title-screen .go');
  await waitFor(async () => (await page.evaluate(() => !!window.omnipath?.debug)), 10000, 'game start');
  // Mirelle's intro opens ~350 ms after the scene starts: wait for it so closeModal() cannot race it (flaky under load).
  await waitFor(async () => (await info()).panel === 'dialog', 5000, 'intro dialog');
  await page.waitForTimeout(200);
  await shot('01-intro');
  await closeModal();
  const st0 = await info();
  if (st0.map === 'vale.hearthvale') ok('new game starts in Hearthvale');
  else fail(`new game started in ${st0.map}`);

  // ------------------------------------------------------------ every panel and tab
  for (const panel of ['skills', 'altar', 'classes', 'codex', 'bag', 'map']) {
    await page.click(`.menu button[data-panel="${panel}"]`);
    await page.waitForTimeout(150);
    const open = await info();
    if (open.panel !== panel) fail(`${panel} panel did not open`);
    const tabs = await page.$$eval('.tabs .tab', (els) => els.map((e) => e.dataset.tab));
    for (const t of tabs) {
      await page.click(`.tabs .tab[data-tab="${t}"]`);
      await page.waitForTimeout(80);
    }
    if (panel === 'skills') {
      await page.click('.tabs .tab[data-tab="skills"]');
      await page.waitForTimeout(80);
      if (await page.$('.skill-card')) {
        await page.click('.skill-card');
        await page.waitForTimeout(100);
        if (!(await page.$('.skill-head'))) fail('skill detail view did not open');
        await shot('02-skill-detail');
        await page.click('.sheet .back');
      } else fail('no skill cards in the Skills panel');
    }
    await shot(`03-panel-${panel}`);
    await page.click('.sheet .x');
    await page.waitForTimeout(100);
  }
  for (const npc of ['brann', 'hale', 'pell', 'oru', 'alba', 'vey', 'korrin']) {
    await page.evaluate((n) => window.omnipath.ui.open('trainer', n), npc);
    await page.waitForTimeout(60);
  }
  await shot('04-trainer');
  await closeModal();
  await page.evaluate(() => window.omnipath.ui.open('bag', 'sell'));
  await page.evaluate(() => window.omnipath.ui.open('map', 'travel'));
  await closeModal();
  ok('every panel opened');

  // ------------------------------------------------------------ interactions in Hearthvale (Brann gift, waystone)
  await page.evaluate(() => {
    const s = window.omnipath.scene;
    const brann = s.npcs.find((n) => n.def.id === 'brann');
    s.interactions.approach(brann);
  });
  await waitFor(async () => (await info()).panel === 'dialog', 8000, 'walk to Brann');
  const ore = await page.evaluate(() => window.omnipath.session.count('ore'));
  if (ore >= 6) ok(`Brann gift: ${ore} ore`);
  else fail(`Brann gift missing (ore ${ore})`);
  await shot('05-brann');
  await closeModal();
  await page.evaluate(() => {
    const s = window.omnipath.scene;
    s.interactions.approach(s.objects.find((o) => o.def.kind === 'waystone'));
  });
  await waitFor(async () => (await info()).panel === 'dialog', 8000, 'walk to waystone');
  await closeModal();
  const ws = await page.evaluate(() => window.omnipath.session.world.waystones.length);
  if (ws >= 1) ok('waystone attuned');
  else fail('waystone not attuned');

  // ------------------------------------------------------------ walk Hearthvale -> Greenmeadow through the real portal
  await dbg('walkToPortal', 'west');
  if (await waitFor(async () => (await info()).map === 'vale.greenmeadow', 25000, 'walk to Greenmeadow')) ok('walked into Greenmeadow');
  await page.waitForTimeout(400);
  await closeModal();
  await shot('06-greenmeadow');

  // ------------------------------------------------------------ fight
  await dbg('setLevel', 4);
  const k0 = (await info()).kills;
  for (let round = 0; round < 3; round++) {
    await dbg('heal');
    await dbg('fight');
    await waitFor(async () => {
      await closeModal();
      const s = await info();
      if (!s.target) await dbg('fight');
      return s.kills > k0 + round;
    }, 30000, `kill #${round + 1}`);
  }
  const k1 = (await info()).kills;
  if (k1 >= k0 + 3) ok(`fought: ${k1 - k0} kills`);
  await shot('07-fight');
  const xp = await page.evaluate(() => window.omnipath.session.book.progress('slash'));
  if (xp && (xp.rank > 1 || xp.xp > 0)) ok(`mastery XP flows (slash R${xp.rank}, ${xp.xp.toFixed(1)} xp, ${xp.uses} uses)`);
  else fail('no mastery XP on slash');

  // ------------------------------------------------------------ back to Hearthvale, Mirror Lake, hidden portal reveal
  await warp('vale.hearthvale', 'west');
  await warp('vale.mirror_lake', 'south');
  const islet = (await dbg('portals')).find((p) => p.id === 'islet');
  if (islet?.open) fail('islet is open before reveal');
  await dbg('learn', 'quickstep');
  await closeModal();
  await dbg('assign', 0, 'quickstep');
  await dbg('place', islet.x, islet.y + 3 * 32);
  await page.waitForTimeout(200);
  await dbg('cast', 0);
  await page.waitForTimeout(400);
  await closeModal();
  const islet2 = (await dbg('portals')).find((p) => p.id === 'islet');
  if (islet2?.open) ok('dash reveals the hidden islet portal');
  else fail('islet not revealed by a dash cast');
  await shot('08-mirror-lake');
  // Regression: the islet sits on the north border under the vitals panel; the HUD-safe camera bounds must let the
  // player see and TAP it on a portrait phone (it was untappable before).
  await dbg('place', islet.x, islet.y + 2 * 32);
  await page.waitForTimeout(1200);
  const isletTappable = await page.evaluate(([x, y]) => {
    const s = window.omnipath.scene;
    const cam = s.cameras.main;
    const sx = (x - cam.worldView.x) * cam.zoom;
    const sy = (y - cam.worldView.y) * cam.zoom;
    return document.elementFromPoint(sx, sy) === s.game.canvas;
  }, [islet.x, islet.y]);
  if (isletTappable) ok('HUD-safe camera: the north-border islet is visible and tappable on a portrait phone');
  else fail('islet portal is hidden under the HUD on a portrait phone');

  // ------------------------------------------------------------ Prism Gate: closed, then open with 3 elements
  await warp('vale.stormbreak_approach', 'west');
  let gate = (await dbg('portals')).find((p) => p.id === 'gate');
  if (gate?.open) fail('Prism Gate open with no elements');
  for (const e of ['fire', 'water', 'earth']) await dbg('element', e);
  await closeModal();
  gate = (await dbg('portals')).find((p) => p.id === 'gate');
  if (gate?.open) ok('Prism Gate opens at 3 elements');
  else fail('Prism Gate still closed with 3 elements');
  await shot('09-prism-gate');
  await dbg('walkToPortal', 'gate');
  if (await waitFor(async () => (await info()).map === 'vale.stormbreak', 25000, 'walk through the Prism Gate')) ok('walked through the Prism Gate');
  await closeModal();
  await shot('10-stormbreak');

  // ------------------------------------------------------------ systems: gathering, minigames, lessons, NPC roles
  const approach = (pred) =>
    page.evaluate((src) => {
      const s = window.omnipath.scene;
      const f = new Function('v', `return ${src}`);
      const v = [...s.npcs, ...s.objects, ...s.nodes].find((x) => f(x));
      if (!v) return null;
      s.player.x = v.x;
      s.player.y = v.y + 40;
      s.player.path = [];
      s.interactions.approach(v);
      return v.def.id ?? null;
    }, pred);
  const flag = (id) => page.evaluate((f) => window.omnipath.session.book.flag(f), id);
  const count = (id) => page.evaluate((i) => window.omnipath.session.count(i), id);

  await warp('vale.greystone_quarry');
  await approach("v.kind === 'node' && v.def.kind === 'ore' && v.ready");
  await waitFor(async () => (await flag('ore_mined')) >= 1, 6000, 'mine ore');
  if ((await flag('ore_mined')) >= 1) ok('mining channel: ore_mined flag + bag ore');

  await warp('vale.mirror_lake');
  await approach("v.kind === 'node' && v.def.kind === 'fishing' && v.ready");
  if (await waitFor(async () => (await info()).panel === 'minigame', 6000, 'fishing minigame')) {
    // Reel in the moment the bobber dips (the bite window is 900 ms).
    const bit = await page.evaluate(
      () =>
        new Promise((resolve) => {
          const iv = setInterval(() => {
            if (!document.querySelector('.bob.bite')) return;
            clearInterval(iv);
            document.querySelector('.minigame .reel')?.click();
            resolve(true);
          }, 25);
          setTimeout(() => {
            clearInterval(iv);
            resolve(false);
          }, 8000);
        }),
    );
    if (!bit) fail('fish never bit');
    await waitFor(async () => (await flag('fish_caught')) >= 1, 4000, 'catch fish');
    if ((await flag('fish_caught')) >= 1) ok('fishing minigame: fish_caught flag');
  }
  await closeModal();

  await warp('vale.hearthvale');
  await dbg('give', 'coins', 200);
  await approach("v.kind === 'npc' && v.def.id === 'brann'");
  await waitFor(async () => (await info()).panel === 'dialog', 6000, 'Brann dialog');
  await page.click('.dialog [data-opt="0"]');
  if (await waitFor(async () => (await info()).panel === 'minigame', 3000, 'forge minigame')) {
    for (let i = 0; i < 3; i++) {
      await page.click('.minigame .strike');
      await page.waitForTimeout(200);
    }
    await waitFor(async () => !(await info()).open || (await info()).panel !== 'minigame', 4000, 'forge finished');
    ok('forge minigame runs');
  }
  await closeModal();
  await approach("v.kind === 'npc' && v.def.id === 'tamsin'");
  await waitFor(async () => (await info()).panel === 'dialog', 6000, 'Tamsin dialog');
  const whispered = await page.evaluate(() => window.omnipath.session.book.state.whispered.length);
  if (whispered >= 1) ok('Loremaster whispers a class riddle');
  else fail('Tamsin did not whisper a riddle');
  await closeModal();
  await approach("v.kind === 'npc' && v.def.id === 'alba'");
  await waitFor(async () => (await info()).panel === 'dialog', 6000, 'Alba dialog');
  await page.click('.dialog [data-opt="0"]');
  await closeModal();
  if (await page.evaluate(() => window.omnipath.session.book.hasElement('holy'))) ok('Alba grants holy at 3 elements');
  else fail('Alba did not grant holy');

  await warp('vale.greenmeadow');
  await page.evaluate(() => window.omnipath.ui.open('trainer', 'hale'));
  await page.click('[data-lesson="hale_rising_kick"]');
  await page.waitForTimeout(200);
  await closeModal();
  if (await page.evaluate(() => window.omnipath.session.book.has('rising_kick'))) ok('trainer lesson bought (Rising Kick)');
  else fail('could not take the Rising Kick lesson');

  await warp('vale.lake_islet');
  const coins0 = await page.evaluate(() => window.omnipath.session.player.coins);
  await approach("v.kind === 'object' && v.def.kind === 'chest'");
  await waitFor(async () => (await page.evaluate(() => window.omnipath.session.world.chests.length)) > 0, 6000, 'open chest');
  await closeModal();
  if ((await page.evaluate(() => window.omnipath.session.player.coins)) > coins0) ok('chest loot');

  // ------------------------------------------------------------ regressions found in the v2 playtest pass
  const sceneState = () =>
    page.evaluate(() => {
      const s = window.omnipath.scene;
      return { paused: s.scene.isPaused(), open: window.omnipath.ui.isOpen, warping: s.warping, map: s.mapId };
    });
  // 1) A dialog opening during a warp's fade must not freeze the fade, and the next map must start paused under it.
  for (let i = 0; i < 3; i++) {
    await page.evaluate((k) => {
      window.omnipath.debug.warp(k % 2 ? 'vale.hearthvale' : 'vale.greenmeadow');
      setTimeout(() => window.omnipath.ui.dialog('Test', '🧪', 'A dialog opened mid-warp.', [{ label: 'OK' }]), 40 + 40 * k);
    }, i);
    await page.waitForTimeout(900);
    const st = await sceneState();
    if (st.warping) fail(`warp ${i}: stuck mid-fade with a dialog open`);
    if (st.open && !st.paused) fail(`warp ${i}: the new map runs behind an open dialog`);
    await closeModal();
  }
  ok('warps complete when a dialog opens mid-fade; the next map pauses under it');
  // 2) A channel must not complete while a panel pauses the world (scene time jumps across pauses).
  await warp('vale.greystone_quarry');
  const ore0 = await flag('ore_mined');
  const started = await approach("v.kind === 'node' && v.def.kind === 'ore' && v.ready");
  if (started) {
    await waitFor(() => page.evaluate(() => !!window.omnipath.scene.interactions.channel), 4000, 'mining channel starts');
    await page.evaluate(() => window.omnipath.ui.open('codex'));
    await page.waitForTimeout(2000);
    await page.evaluate(() => window.omnipath.ui.close());
    await page.waitForTimeout(100);
    if ((await flag('ore_mined')) > ore0) fail('a mining channel completed while a panel was open');
    else if (await waitFor(async () => (await flag('ore_mined')) > ore0, 4000, 'mining completes after the panel')) ok('channels pause with the world');
  }
  // 3) Discovery cards wait for the fight to end (a Class Rank card popped up mid-warden-fight).
  await page.evaluate(() => {
    const s = window.omnipath.scene;
    s.combat.lastHurt = s.time.now;
    window.omnipath.ui.discovery({ icon: '🧪', kicker: 'TEST CARD', title: 'Held mid-fight', body: 'Shown after the fight.' });
  });
  await page.waitForTimeout(300);
  const heldOpen = (await info()).open;
  await waitFor(async () => (await info()).open, 9000, 'held card shows after the fight');
  if (!heldOpen) ok('discovery cards are held while fighting and shown after');
  else fail('a discovery card interrupted combat');
  await closeModal();
  // 4) Zone banner and map-entry toasts must not overlap (portrait here; landscape in the layout pass).
  const bannerToast = async () => {
    await page.evaluate(() => window.omnipath.ui.toast('You awaken at the Windcrest Hill waystone.'));
    await page.evaluate(() => window.omnipath.ui.banner('Stormbreak Approach', 'Lv 8–10'));
    await page.waitForTimeout(700);
    return page.evaluate(() => {
      const b = document.querySelector('.zone-banner b')?.getBoundingClientRect();
      const ts = [...document.querySelectorAll('.toast')].map((t) => t.getBoundingClientRect());
      return !!b && ts.some((t) => t.bottom > b.top && t.top < b.bottom && t.right > b.left && t.left < b.right);
    });
  };
  if (await bannerToast()) fail('portrait: a toast covers the zone banner');
  else ok('zone banner clear of toasts (portrait)');

  // Death -> respawn at the save point (50% HP).
  await warp('vale.greenmeadow');
  await page.evaluate(() => {
    const s = window.omnipath.scene;
    s.combat.protectUntil = 0;
    s.combat.hurtPlayer(99999, 'the playtest');
  });
  await waitFor(async () => (await info()).map === 'vale.hearthvale', 6000, 'respawn after death');
  await closeModal();
  const afterDeath = await info();
  if (afterDeath.map === 'vale.hearthvale' && afterDeath.hp > 0) ok(`death respawns at the save point (${afterDeath.hp} HP)`);

  // Warden: witness its echo technique, kill it, relic + flags, rift gate opens.
  await warp('vale.stormbreak');
  await dbg('setLevel', 30);
  await waitFor(async () => {
    await dbg('heal');
    await dbg('fight');
    return page.evaluate(() => window.omnipath.scene.combat.monsters.some((m) => m.witnessed.size > 0));
  }, 25000, 'Thunderhoof uses its echo technique');
  await page.evaluate(() => {
    const m = window.omnipath.scene.combat.monsters.find((x) => x.def.id === 'thunderhoof');
    if (m) m.hp = 1;
    window.omnipath.debug.fight();
  });
  await waitFor(async () => (await flag('warden_thunderhoof')) >= 1, 8000, 'Thunderhoof defeated');
  await closeModal();
  const relic = await count('relic_storm');
  const marks = await page.evaluate(() => window.omnipath.session.book.state.witness.thunder_stomp ?? 0);
  if (relic >= 1 && (await flag('relic_storm')) >= 1) ok('warden relic + relic flag');
  else fail('warden relic missing');
  if (marks >= 1) ok('echo witness mark credited on kill');
  else fail('no witness mark for thunder_stomp');
  const rift = (await dbg('portals')).find((p) => p.id === 'rift');
  if (rift?.open) ok('warden flag opens the rift gate');
  else fail('rift gate still closed after Thunderhoof');
  await shot('10b-stormbreak-cleared');

  // ------------------------------------------------------------ warp chain through every map
  const before = await dbg('listeners');
  const chain = quick ? ALL_MAPS.slice(0, 8) : ALL_MAPS;
  for (const id of chain) {
    if (await warp(id)) {
      const s = await info();
      if (s.hp <= 0) fail(`${id}: dead on arrival`);
    }
    if (['vale.greystone_quarry', 'vale.gloomwood', 'vale.quarry_depths.1', 'vale.hollow_barrow.2', 'rift.riftmarch', 'rift.frost_shelf'].includes(id))
      await shot(`11-${id}`);
  }
  ok(`warped through ${chain.length} maps`);
  for (let i = 0; i < (quick ? 6 : 24); i++) await warp(i % 2 ? 'vale.hearthvale' : 'vale.greenmeadow');
  const after = await dbg('listeners');
  if (after.book > before.book || after.resize > before.resize || after.sceneEvents > before.sceneEvents)
    fail(`listener growth after warps: ${JSON.stringify(before)} -> ${JSON.stringify(after)}`);
  else ok(`no listener growth (${JSON.stringify(after)})`);

  // ------------------------------------------------------------ save round-trip
  await page.evaluate(() => window.omnipath.scene.save());
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('omnipath.save.v2') ?? 'null'));
  if (saved?.v === 2 && saved.world?.visited?.length >= 10) ok(`save v2 written (${saved.world.visited.length} maps visited)`);
  else fail('save v2 missing or incomplete');

  // ------------------------------------------------------------ layouts
  await warp('vale.hearthvale');
  await shot('12-portrait-hearthvale');
  for (const [name, w, h] of [
    ['portrait-phone', 390, 844],
    ['landscape-phone', 844, 390],
    ['ipad-landscape', 1024, 768],
    ['ipad-portrait', 810, 1080],
    ['desktop', 1440, 900],
  ]) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(400);
    await shot(`13-${name}`);
    if (await bannerToast()) fail(`${name}: a toast covers the zone banner`);
    // Every visible HUD and panel button must be a >= 44 px touch target.
    const smallButtons = () =>
      page.evaluate(() =>
        [...document.querySelectorAll('#hud-root button')]
          .filter((b) => b.offsetParent !== null)
          .map((b) => ({ r: b.getBoundingClientRect(), t: (b.textContent ?? '').trim().slice(0, 16) || b.className }))
          .filter(({ r }) => r.width > 0 && (r.width < 43.5 || r.height < 43.5))
          .map(({ t }) => t),
      );
    let small = await smallButtons();
    for (const panel of ['skills', 'altar', 'classes', 'codex', 'bag', 'map']) {
      await page.click(`.menu button[data-panel="${panel}"]`);
      await page.waitForTimeout(120);
      if (panel === 'skills') await shot(`14-${name}-skills`);
      small = small.concat(await smallButtons());
      await page.click('.sheet .x');
    }
    if (small.length) fail(`${name}: buttons smaller than 44 px: ${[...new Set(small)].join(', ')}`);
  }
  ok('layouts rendered');

  // ------------------------------------------------------------ v1 save migration (fresh context)
  const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  const p2 = await ctx2.newPage();
  p2.on('console', (m) => {
    if (m.type() === 'error') fail(`console error (v1 migration): ${m.text()}`);
  });
  p2.on('pageerror', (e) => fail(`page error (v1 migration): ${e.message}`));
  await p2.goto(base);
  await p2.evaluate(() => {
    localStorage.clear();
    localStorage.setItem(
      'omnipath.save.v1',
      JSON.stringify({
        v: 1,
        player: { name: 'Oldie', weapon: 'staff', ownedWeapons: ['staff'], level: 7, exp: 12, hp: 80, sp: 20, coins: 99, x: 1200, y: 900, hotbar: ['arcane_orb', null, null, null, null, null], bag: { ore: 3, fish: 2 }, items: [], createdAt: 1 },
        skills: {
          version: 1,
          skills: {
            bolt: { id: 'bolt', rank: 8, xp: 3, charges: 1, uses: 300, source: 'starting weapon', learnedAt: 0 },
            arcane_orb: { id: 'arcane_orb', rank: 4, xp: 1, charges: 0, uses: 40, source: 'morph:bolt', learnedAt: 1 },
          },
          elements: { fire: { source: 'forge', learnedAt: 3 } },
          flags: { kills: 40, forge_success: 3 },
          attempts: [],
          discoveries: [],
          hints: [],
          classes: [],
          activeClass: null,
        },
      }),
    );
  });
  await p2.reload();
  await p2.waitForSelector('.title-screen .cont', { timeout: 15000 });
  await p2.click('.title-screen .cont');
  await p2.waitForFunction(() => !!window.omnipath?.debug, null, { timeout: 15000 });
  await p2.waitForTimeout(500);
  const mig = await p2.evaluate(() => ({
    v1: !!localStorage.getItem('omnipath.save.v1'),
    v2: JSON.parse(localStorage.getItem('omnipath.save.v2') ?? 'null'),
    map: window.omnipath.debug.info().map,
  }));
  if (mig.v1 && mig.v2?.v === 2 && mig.v2.player.bag.ore === 3 && mig.v2.book.skills.arcane_orb && mig.map === 'vale.hearthvale')
    ok('v1 save migrated to v2 (v1 kept, bag + book carried over)');
  else fail(`v1 migration: ${JSON.stringify({ v1: mig.v1, map: mig.map, bag: mig.v2?.player?.bag })}`);
  await ctx2.close();
} catch (e) {
  fail(`exception: ${e?.stack ?? e}`);
}

// ------------------------------------------------------------ --portals: walk every portal pair by tapping
// Like a player: only taps canvas pixels no HUD element covers (and no monster stands on), following the real path,
// then checks the destination map, the arrival tile and the return portal. Slow (~25 min at phone size).
if (args.includes('--portals')) {
  const size = args.includes('--landscape') ? { width: 844, height: 390 } : { width: 390, height: 844 };
  const ctx3 = await browser.newContext({ viewport: size, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  const p3 = await ctx3.newPage();
  p3.on('pageerror', (e) => fail(`page error (portals): ${e.message}`));
  const inf = () => p3.evaluate(() => window.omnipath.debug.info());
  const settle = async () => {
    for (let i = 0; i < 30 && (await p3.evaluate(() => !!window.omnipath.scene?.warping)); i++) await p3.waitForTimeout(100);
  };
  const close3 = async () => {
    for (let i = 0; i < 8 && (await inf()).open; i++) {
      await p3.evaluate(() => window.omnipath.ui.close());
      await p3.waitForTimeout(120);
    }
  };
  /** Page point to tap toward a portal rect: inside it if visible, else the farthest visible point of the path. */
  const tapPoint = (rect, jitter) =>
    p3.evaluate(
      ([rc, j]) => {
        const s = window.omnipath.scene;
        const cam = s.cameras.main;
        const T = 32;
        const conv = (x, y) => ({ x: (x - cam.worldView.x) * cam.zoom, y: (y - cam.worldView.y) * cam.zoom });
        const free = (x, y) => {
          const p = conv(x, y);
          if (p.x < 1 || p.y < 1 || p.x > innerWidth - 1 || p.y > innerHeight - 1) return null;
          if (document.elementFromPoint(p.x, p.y) !== s.game.canvas) return null;
          if (s.combat.monsters.some((m) => m.alive && Math.hypot(m.x - x, m.y - m.radius - y) < m.radius + 24)) return null;
          return { x: Math.round(p.x), y: Math.round(p.y) };
        };
        if (!j)
          for (const fy of [0.5, 0.25, 0.75])
            for (const fx of [0.5, 0.25, 0.75]) {
              const q = free((rc.tx + rc.w * fx) * T, (rc.ty + rc.h * fy) * T);
              if (q) return q;
            }
        const pl = s.player;
        const path = [{ x: pl.x, y: pl.y }, ...(s.pathTo((rc.tx + rc.w / 2) * T, (rc.ty + rc.h / 2) * T) ?? [])];
        for (let i = path.length - 1; i >= 1; i--) {
          const a = path[i - 1];
          const b = path[i];
          const L = Math.hypot(b.x - a.x, b.y - a.y) || 1;
          const n = Math.max(1, Math.ceil(L / 16));
          for (let k = n; k >= 0; k--) {
            const x = a.x + ((b.x - a.x) * k) / n + (-(b.y - a.y) / L) * j;
            const y = a.y + ((b.y - a.y) * k) / n + ((b.x - a.x) / L) * j;
            if (Math.hypot(x - pl.x, y - pl.y) < 20) continue;
            const q = free(x, y);
            if (q) return q;
          }
        }
        return null;
      },
      [rect, jitter],
    );
  try {
    await p3.goto(base);
    await p3.waitForSelector('.title-screen .new', { timeout: 20000 });
    await p3.click('.title-screen .new');
    await p3.click('.title-screen .go');
    await p3.waitForFunction(() => !!window.omnipath?.debug, null, { timeout: 15000 });
    await p3.waitForTimeout(800);
    await close3();
    await p3.evaluate(() => {
      const d = window.omnipath.debug;
      d.setLevel(40);
      for (const e of ['fire', 'water', 'earth', 'wind', 'shadow', 'holy']) d.element(e);
      window.omnipath.session.book.incFlag('warden_thunderhoof');
    });
    await close3();
    let walked = 0;
    for (const mapId of ALL_MAPS) {
      const ports = await p3.evaluate(async (m) => {
        window.omnipath.debug.warp(m);
        await new Promise((r) => setTimeout(r, 900));
        return window.omnipath.scene.portals.map((v) => ({ id: v.def.id, to: v.def.to, rect: { tx: v.def.tx, ty: v.def.ty, w: v.def.w, h: v.def.h } }));
      }, mapId);
      for (const pt of ports) {
        await p3.evaluate(([m, id]) => {
          const w = window.omnipath.session.world;
          if (!w.revealed.includes(`${m}#${id}`)) w.revealed.push(`${m}#${id}`);
          window.omnipath.debug.warp(m);
        }, [mapId, pt.id]);
        await p3.waitForTimeout(900);
        await close3();
        await p3.evaluate(() => window.omnipath.debug.heal());
        let jitter = 0;
        let still = 0;
        let last = null;
        const until = Date.now() + 45000;
        while (Date.now() < until) {
          await settle();
          if ((await inf()).map !== mapId) break;
          if ((await inf()).open) {
            jitter = jitter ? -jitter * 1.5 : 48; // tapped a sign / NPC on the way: aim beside it
            await close3();
            continue;
          }
          const q = await tapPoint(pt.rect, jitter);
          if (!q) break;
          await p3.touchscreen.tap(q.x, q.y);
          await p3.waitForTimeout(500);
          for (let i = 0; i < 40 && (await p3.evaluate(() => window.omnipath.scene.player.path.length)); i++) await p3.waitForTimeout(150);
          const now = await inf();
          still = last && Math.hypot(now.x - last.x, now.y - last.y) < 4 ? still + 1 : 0;
          last = now;
          if (still >= 2) jitter = jitter ? -jitter * 1.5 : 48;
          if (still >= 6) break;
        }
        await settle();
        await p3.waitForTimeout(400);
        const arr = await p3.evaluate((to) => {
          const s = window.omnipath.scene;
          const a = s.cm.arrivals?.[to.portal] ?? null;
          const tx = Math.floor(s.player.x / 32);
          const ty = Math.floor(s.player.y / 32);
          const back = s.portals.find((v) => v.def.id === to.portal)?.def.to;
          return { map: s.mapId, a, px: s.player.x, py: s.player.y, coll: s.cm.coll[ty * s.cm.w + tx], back };
        }, pt.to);
        const label = `${mapId}#${pt.id} -> ${pt.to.map}#${pt.to.portal}`;
        if (arr.map !== pt.to.map) fail(`${label}: could not walk in by tapping (still in ${arr.map})`);
        else if (arr.a && Math.hypot(arr.a.x - arr.px, arr.a.y - arr.py) > 64) fail(`${label}: arrived away from the arrival point`);
        else if (arr.coll & 5) fail(`${label}: arrived on a blocked/portal tile`);
        else if (!arr.back || arr.back.map !== mapId || arr.back.portal !== pt.id) fail(`${label}: return portal mismatch`);
        else walked++;
      }
    }
    ok(`walked ${walked} portals by tapping (${size.width}x${size.height})`);
  } catch (e) {
    fail(`portals: exception ${e?.stack ?? e}`);
  }
  await ctx3.close();
}

await browser.close();
if (problems.length) {
  console.log(`\nFAILED (${problems.length} problem${problems.length > 1 ? 's' : ''})`);
  process.exit(1);
}
console.log('\nPASSED');
