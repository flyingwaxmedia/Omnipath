#!/usr/bin/env node
// Omnipath Playwright smoke test (docs/CLIENT-v2.md §8, v3: docs/INTEGRATION-v3.md §8).
//
//   npm run build && npx vite preview --port 4173 --strictPort &
//   node scripts/playtest.mjs http://localhost:4173/ [--device phone|phone-landscape|ipad|ipad-portrait|desktop]
//                             [--shots <dir>] [--quick] [--portals | --only-portals]
//                             [--landscape] [--maps vale.hearthvale,vale.mirror_lake]
//
// --device picks the screen and its real devicePixelRatio (default phone = 390x844 @3; phone-landscape 844x390 @3,
// ipad 1180x820 @2, ipad-portrait 820x1180 @2, desktop 1440x900 @1). Run it once per device.
//
// --portals additionally walks EVERY portal pair by real taps (HUD-aware, phone portrait or --landscape), checking
// arrivals and return portals (~25 min); --only-portals skips the main run; --maps limits the portal walk.
//
// Starts a new game, checks the HUD's pixel size (HUD art px = the world's), opens every panel (and tab), then the v3
// v4 flows (docs/SPEC-v4.md §15.2 lane D): the Class screen shows rarity, the five class skills with their levels and
// the next reward (no Perks); a skill that needs another weapon reads "Needs a sword — Equip" on its slot and card and
// one tap swaps back; Bare Hands is a weapon in the Bag; one mechanic widget above the bar; the HUD diet (no stat strip,
// no explored strip, a one-line tracker); then the v3
// flows: the loop sleeps under the Star Chart (and again after a card over it), a star card shows ONE action, Become a
// class fills the class slots, an empty own slot opens the picker and equips, Equip on a star card with every slot full
// picks a slot and comes back to that card, AUTO on / off, the ☰ menu's Sound and "Reduce shake & flashes" switches;
// walks Hearthvale -> Greenmeadow through a real portal, fights,
// reveals a hidden portal by casting, opens a Prism Gate, warps through every map via window.omnipath.debug, checks
// that warping does not grow listener counts, takes Hale's First Drill quest (accept in the dialog, complete, turn in)
// for Rising Kick, checks the softlock guard (a pause and a resume in one tick, back-to-back cards, dialogs queued behind
// cards, the watchdog, a seeded mini-fuzz: never paused with nothing to close), keeps the centre band clear in portrait
// and short landscapes (1280x720: warden plate, zone plate, toasts), and takes portrait-phone / landscape-phone / iPad
// screenshots.
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
const DEVICES = {
  phone: { width: 390, height: 844, dpr: 3, touch: true },
  'phone-landscape': { width: 844, height: 390, dpr: 3, touch: true },
  ipad: { width: 1180, height: 820, dpr: 2, touch: true },
  'ipad-portrait': { width: 820, height: 1180, dpr: 2, touch: true },
  desktop: { width: 1440, height: 900, dpr: 1, touch: false },
};
const devAt = args.indexOf('--device');
const deviceName = devAt >= 0 ? args[devAt + 1] : 'phone';
const device = DEVICES[deviceName];
if (!device) {
  console.log(`unknown --device ${deviceName} (${Object.keys(DEVICES).join(', ')})`);
  process.exit(2);
}

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
const ctx = await browser.newContext({
  viewport: { width: device.width, height: device.height },
  deviceScaleFactor: device.dpr,
  hasTouch: device.touch,
  isMobile: device.touch,
});
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

const SKIP_MAIN = Symbol('only portals');
try {
  console.log(`Omnipath playtest @ ${base} on ${deviceName} (${device.width}x${device.height} @${device.dpr})`);
  if (args.includes('--only-portals')) throw SKIP_MAIN;
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

  // ------------------------------------------------------------ HUD pixel size: the HUD's art pixels are the world's
  const px = await page.evaluate(() => {
    const r = window.omnipath.render.scale();
    const ui = parseFloat(document.documentElement.style.getPropertyValue('--ui-px'));
    return { k: r.k, dpr: r.dpr, ui, n: ui * r.dpr };
  });
  if (Math.abs(px.n - Math.round(px.n)) > 1e-6) fail(`HUD pixel is ${px.n.toFixed(3)} device px (not whole: blurry)`);
  else if (Math.round(px.n) !== px.k && px.k / px.dpr >= 1) fail(`HUD pixel ${px.n} device px but the world's is ${px.k}`);
  else ok(`HUD pixel = ${Math.round(px.n)} device px (world k = ${px.k}, --ui-px ${+px.ui.toFixed(3)}px)`);

  // ------------------------------------------------------------ every panel and tab
  // Fuse hides until the first element (docs/UX-SIMPLE.md rule 7): grant one first.
  await dbg('element', 'fire');
  await page.waitForTimeout(150);
  await closeModal();
  await waitFor(() => page.evaluate(() => !!document.querySelector('.menu button[data-panel="altar"]:not(.hidden)')), 3000, 'Fuse button after the first element');
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

  // ------------------------------------------------------------ v3 flows (docs/INTEGRATION-v3.md §8.1)
  const asleep = () => page.evaluate(() => window.omnipath.render.asleep());
  const panelNow = async () => (await info()).panel;
  // 1) The loop sleeps under the full-screen Star Chart, wakes for a card over it, and sleeps again after the card.
  await page.click('.menu button[data-panel="skills"]');
  if (await waitFor(asleep, 2000, 'game loop sleeps under the Star Chart')) {
    await page.evaluate(() => window.omnipath.ui.discovery({ icon: '🧪', kicker: 'TEST CARD', title: 'A card over the chart', body: 'Close me.' }));
    await page.waitForTimeout(150);
    const awake = !(await asleep());
    await page.click('.discovery .ok');
    await page.waitForTimeout(150);
    if (!awake) fail('the loop stayed asleep under a discovery card');
    else if ((await panelNow()) !== 'skills') fail('closing a card over the Star Chart did not return to it');
    else if (await waitFor(asleep, 2000, 'loop sleeps again after a card over the Star Chart')) ok('loop sleeps under the Star Chart, wakes for a card, sleeps again after it');
  }
  await closeModal();
  // 2) A star card shows ONE action (Equip / Equipped ✓ / Class skill ✓ / Transform / one next step).
  await dbg('learn', 'venom_edge');
  await closeModal();
  await page.evaluate(() => window.omnipath.ui.open('skills', 'star:venom_edge'));
  await page.waitForTimeout(250);
  const acts = await page.$$eval('.sc-card[data-card="venom_edge"] .sc-act > :is(.sc-primary, .sc-done, .sc-step)', (els) => els.map((e) => e.textContent.trim().split('\n')[0]));
  if (acts.length === 1) ok(`Star Chart star card shows one action (${acts[0]})`);
  else fail(`star card actions: ${JSON.stringify(acts)}`);
  await shot('03b-star-card');
  await closeModal();
  // 3) Become a class (Class screen) → its class slots fill themselves.
  await dbg('learn', 'whirlwind');
  await closeModal();
  await page.evaluate(() => {
    const b = window.omnipath.session.book;
    if (!b.state.classes.blademaster) b.state.classes.blademaster = { rank: 1, xp: 0, spent: {} };
    window.omnipath.ui.open('classes');
  });
  await page.waitForTimeout(200);
  const becomeBtn = await page.$('[data-become="blademaster"]');
  if (!becomeBtn) fail('no Become button for Blademaster on the Class screen');
  else {
    await page.click('[data-become="blademaster"]');
    await page.waitForTimeout(400);
    await closeModal();
    const bar = await dbg('bar');
    const worn = await page.evaluate(() => window.omnipath.session.book.state.worn);
    const filled = bar.filter((v) => v.kind === 'class' && v.skillId);
    if (worn === 'blademaster' && filled.length >= 1 && bar.some((v) => v.kind === 'own'))
      ok(`Become Blademaster: ${filled.length} class slot(s) filled (${filled.map((v) => v.skillId).join(', ')})`);
    else fail(`Become: worn ${worn}, class slots ${JSON.stringify(bar.map((v) => `${v.kind}:${v.skillId ?? '-'}`))}`);
  }
  // 3b) v4 Class screen: rarity (colour + word + pips) on every class, the five class skills with their levels, the
  // next reward as one line, and no Perks anywhere.
  await page.evaluate(() => window.omnipath.ui.open('classes'));
  await page.waitForTimeout(250);
  const cls4 = await page.evaluate(() => {
    const sheet = document.querySelector('.sheet.classes3');
    const cur = sheet?.querySelector('.ccur');
    const cards = [...(sheet?.querySelectorAll('.ccur:not(.none), .ccard3, .lcard') ?? [])];
    return {
      rarity: cur?.querySelector('.rar')?.textContent?.trim() ?? null,
      pips: cur?.querySelectorAll('.rar .rar-p u').length ?? 0,
      allTagged: cards.length > 0 && cards.every((c) => c.querySelector('.rar')),
      kit: cur?.querySelectorAll('.ckit .ckit-s').length ?? 0,
      later: [...(cur?.querySelectorAll('.ckit .ckit-s.later .ck-lv') ?? [])].map((e) => e.textContent.trim()),
      next: cur?.querySelector('.cnext')?.textContent?.trim() ?? null,
      perks: /perk/i.test(sheet?.textContent ?? ''),
      hints: [...(sheet?.querySelectorAll('.lcard .lc-info') ?? [])].filter((e) => e.querySelectorAll('small').length !== 1).length,
    };
  });
  if (!cls4.rarity || cls4.pips < 1 || !cls4.allTagged) fail(`Class screen: rarity missing (${JSON.stringify(cls4)})`);
  else if (cls4.perks) fail('Class screen still mentions perks');
  else if (cls4.kit !== 0 && cls4.kit !== 5) fail(`Class screen: ${cls4.kit} class skills shown (wanted 5)`);
  else if (!cls4.next) fail('Class screen: no next-reward line');
  else if (cls4.hints) fail(`Class screen: ${cls4.hints} locked class(es) without exactly ONE hint line`);
  else ok(`Class screen: ${cls4.rarity} (${cls4.pips} pip${cls4.pips === 1 ? '' : 's'}), ${cls4.kit} class skills (later: ${cls4.later.join(' ') || 'none'}), "${cls4.next}"`);
  await shot('03d-class-v4');
  await closeModal();
  // 3c) v4 weapon lock: with a Rod in hand a sword skill stays on the bar, dimmed, "Needs a sword — Equip"; its card
  // says the same; one tap on the slot swaps back (after the swap cooldown).
  const lockNow = () =>
    page.evaluate(() =>
      [...document.querySelectorAll('.hotbar .slot.wlocked')].map((b) => ({ skill: b.dataset.skill, need: b.dataset.need, label: b.getAttribute('aria-label'), slot: b.dataset.slot })),
    );
  await page.evaluate(() => {
    const o = window.omnipath;
    const pl = o.session.player;
    if (!pl.ownedWeapons.includes('staff')) pl.ownedWeapons.push('staff');
    o.scene.equipWeapon('staff');
  });
  await page.waitForTimeout(500);
  await closeModal();
  const locked = await lockNow();
  const swordLock = locked.find((l) => l.need === 'sword');
  if (!swordLock) fail(`holding a Rod: no bar slot shows "Needs a sword" (${JSON.stringify(locked)})`);
  else if (!/Needs a sword — Equip$/.test(swordLock.label ?? '')) fail(`lock label reads "${swordLock.label}"`);
  else {
    await page.evaluate((id) => window.omnipath.ui.open('skill', id), swordLock.skill);
    await page.waitForTimeout(250);
    const cardLine = await page.evaluate(() => document.querySelector('.sc-card .sc-act .sc-lock')?.textContent?.trim() ?? null);
    await shot('03e-weapon-lock');
    await closeModal();
    await page.waitForTimeout(3200); // the swap cooldown
    await page.click(`.hotbar .slot[data-slot="${swordLock.slot}"]`);
    await page.waitForTimeout(500);
    const after = { weapon: await page.evaluate(() => window.omnipath.session.player.weapon), locked: (await lockNow()).filter((l) => l.need === 'sword').length };
    if (cardLine !== 'Needs a sword — Equip') fail(`the locked skill's card reads "${cardLine}"`);
    else if (after.weapon !== 'sword' || after.locked) fail(`tapping the locked slot: weapon ${after.weapon}, ${after.locked} sword lock(s) left`);
    else ok(`weapon lock: ${swordLock.skill} read "Needs a sword — Equip" on its slot and card; one tap equipped the sword`);
  }
  await closeModal();
  // 3d) Bare Hands is a weapon in the Bag.
  await page.evaluate(() => window.omnipath.ui.open('bag'));
  await page.waitForTimeout(200);
  const bare = await page.evaluate(() => {
    const w = document.querySelector('.wpn.bare');
    return w ? { name: w.querySelector('b')?.textContent, line: w.querySelector('small')?.textContent, btn: !!w.querySelector('[data-equip="fists"]') } : null;
  });
  if (bare?.name === 'Bare Hands' && /weapon/i.test(bare.line ?? '') && bare.btn) ok(`Bag: "${bare.name} — ${bare.line}"`);
  else fail(`Bag: no Bare Hands weapon row (${JSON.stringify(bare)})`);
  if (await page.evaluate(() => /\bstaff\b/i.test(document.querySelector('.sheet .weapons')?.textContent ?? ''))) fail('Bag: a weapon still reads "Staff" (say Rod)');
  await closeModal();
  // 3e) HUD diet + the one mechanic widget.
  const diet = await page.evaluate(() => {
    const view = window.omnipath.scene.mechanicView?.() ?? null;
    const mechs = [...document.querySelectorAll('.hud-layer .mech')];
    return {
      gone: ['.me-stats', '.zone-strip', '.hotbar .grps', '.tip-banner'].filter((s) => document.querySelector(s)),
      view: view ? `${view.kind}:${view.name}` : null,
      mechs: mechs.length,
      label: mechs[0]?.querySelector('.mech-n')?.textContent ?? null,
      inDock: mechs.every((m) => m.closest('.hotbar .mech-dock')),
      listOpen: !!document.querySelector('.pursuits.open'),
      plateFramed: getComputedStyle(document.querySelector('.hud-me .me-plate')).borderImageSource.includes('frame'),
      fonts: [...new Set([...document.querySelectorAll('.hud-layer *')].filter((e) => e.offsetParent !== null && e.childNodes.length && [...e.childNodes].some((n) => n.nodeType === 3 && n.nodeValue.trim())).map((e) => getComputedStyle(e).fontFamily.split(',')[0].replace(/["']/g, '').trim()))],
      sizes: [...new Set([...document.querySelectorAll('.hud-layer *')].filter((e) => e.offsetParent !== null && [...e.childNodes].some((n) => n.nodeType === 3 && n.nodeValue.trim())).map((e) => parseFloat(getComputedStyle(e).fontSize) * devicePixelRatio))],
    };
  });
  if (diet.gone.length) fail(`HUD diet: still on screen: ${diet.gone.join(', ')}`);
  else if (diet.listOpen) fail('HUD diet: the tracker starts open (it must be one collapsed line)');
  else if (diet.plateFramed) fail('HUD diet: the name plate still wears a frame');
  else if (diet.fonts.length !== 1) fail(`HUD diet: ${diet.fonts.length} text faces in the HUD (${diet.fonts.join(', ')})`);
  else if (diet.sizes.length > 2 || diet.sizes.some((v) => Math.abs(v / 8 - Math.round(v / 8)) > 0.01)) fail(`HUD diet: text sizes ${diet.sizes.join(', ')} device px (want whole font pixels, at most 2 text sizes + the display art)`);
  else ok(`HUD diet: no stat / explored strips, tracker collapsed, plain name plate, one text face (${diet.fonts[0]}) at ${diet.sizes.map((v) => `${v / 8} device px per font pixel`).join(' and ')}`);
  if (diet.view && (diet.mechs !== 1 || !diet.inDock || diet.label !== diet.view.split(':')[1])) fail(`mechanic widget: view ${diet.view}, ${diet.mechs} widget(s), label "${diet.label}"`);
  else if (!diet.view && diet.mechs) fail('a mechanic widget shows without a mechanic');
  else ok(diet.view ? `one mechanic widget above the bar, labelled "${diet.label}" (${diet.view})` : 'no mechanic view for this class: the widget stays hidden');
  // 4) Tap an empty slot of yours → the picker → equip.
  await dbg('learn', 'shadowstep');
  await closeModal();
  await page.waitForTimeout(300);
  const emptyAt = await page.evaluate(() => document.querySelector('.hotbar .slot.own.empty')?.getAttribute('data-slot') ?? null);
  if (emptyAt === null) fail('no empty slot of yours on the bar');
  else {
    const slot = Number(emptyAt);
    await page.click(`.hotbar .slot.own.empty[data-slot="${slot}"]`);
    await page.waitForTimeout(200);
    const tile = (await panelNow()) === 'picker' ? await page.$('.picker-sheet .pk-tile[data-skill]:not(.inclass):not(.cur)') : null;
    if (!tile) fail(`tapping an empty slot of yours did not open the picker (panel ${await panelNow()})`);
    else {
      const id = await tile.getAttribute('data-skill');
      await page.click(`.picker-sheet .pk-tile[data-skill="${id}"]`);
      await page.waitForTimeout(200);
      const now = (await dbg('bar')).find((v) => v.index === slot);
      if (now?.skillId === id && !(await info()).open) ok(`empty slot ${slot + 1} → picker → equipped ${id}`);
      else fail(`picker equip: slot ${slot + 1} holds ${now?.skillId}, wanted ${id}`);
    }
  }
  await closeModal();
  // 5) Equip on a star card with every slot of yours full → pick a slot → back on the Star Chart with that card.
  const pool = ['backstab', 'smoke_veil', 'fan_of_knives', 'ricochet_knives', 'quickstep', 'shadowstep', 'venom_edge'];
  for (const id of pool) await dbg('learn', id);
  await closeModal();
  // A skill to equip (its card says Equip), and every slot of yours filled with the others.
  const equipKind = async (id) => (await dbg('card', id))?.action?.kind;
  let target = null;
  for (const id of pool) if ((await equipKind(id)) === 'equip') { target = id; break; }
  const others = pool.filter((id) => id !== target);
  for (const v of (await dbg('bar')).filter((x) => x.kind === 'own' && !x.skillId)) {
    for (const id of others) {
      if ((await dbg('bar')).some((x) => x.skillId === id)) continue;
      await dbg('equip', id, v.index);
      break;
    }
  }
  if (target && (await equipKind(target)) !== 'equip') target = null;
  await page.evaluate((id) => window.omnipath.ui.open('skills', `star:${id}`), target ?? 'backstab');
  await page.waitForTimeout(250);
  const equipBtn = target ? await page.$(`.sc-card[data-card="${target}"] [data-act="equip"]`) : null;
  if (!equipBtn) fail(`no star card with Equip while every slot of yours is full (${target})`);
  else {
    await page.click(`.sc-card[data-card="${target}"] [data-act="equip"]`);
    await page.waitForTimeout(200);
    const pick = (await panelNow()) === 'picker' ? await page.$('.picker-sheet .pk-tile[data-slot]') : null;
    if (!pick) fail(`Equip with every slot full did not open the slot picker (panel ${await panelNow()})`);
    else {
      const slot = Number(await pick.getAttribute('data-slot'));
      await page.click(`.picker-sheet .pk-tile[data-slot="${slot}"]`);
      await page.waitForTimeout(300);
      const back = await page.evaluate(() => ({ panel: window.omnipath.ui.current, card: document.querySelector('.sc-card')?.getAttribute('data-card') ?? null }));
      const held = (await dbg('bar')).find((v) => v.index === slot)?.skillId;
      if (held !== target) fail(`picked slot ${slot + 1} holds ${held}, wanted ${target}`);
      else if (back.panel === 'skills' && back.card === target) ok(`star card Equip (${target}) → slot picker → back on the Star Chart with that card`);
      else fail(`after the slot picker: panel ${back.panel}, card ${back.card}`);
    }
  }
  await shot('03c-picker-back');
  await closeModal();
  // 6) AUTO: one switch for everything (the basic attack included).
  const autoState = () =>
    page.evaluate(() => ({
      on: window.omnipath.session.player.autoOn,
      btn: document.querySelector('.cluster .rb.auto')?.classList.contains('on') ?? null,
      atk: document.querySelector('.cluster .atk')?.classList.contains('auto') ?? null,
    }));
  const a0 = await autoState();
  await page.click('.cluster .rb.auto');
  await page.waitForTimeout(200);
  const a1 = await autoState();
  await page.click('.cluster .rb.auto');
  await page.waitForTimeout(200);
  const a2 = await autoState();
  if (a1.on === !a0.on && a1.btn === a1.on && a1.atk === a1.on && a2.on === a0.on && a2.btn === a0.on) ok('AUTO switches on and off (button, attack ring)');
  else fail(`AUTO: ${JSON.stringify([a0, a1, a2])}`);
  await closeModal();
  // 7) ☰ menu settings: Sound off / on and "Reduce shake & flashes" reach the audio and VFX settings.
  await page.click('.menu button[data-panel="menu"]');
  await page.waitForTimeout(150);
  const menuState = () =>
    page.evaluate(() => ({
      muted: window.omnipath.debug.audio?.settings.muted ?? null,
      calm: document.getElementById('hud-root')?.classList.contains('reduce-flash') ?? null,
      vfx: window.omnipath.scene?.vfx?.reduceFlash ?? null,
    }));
  const m0 = await menuState();
  await page.click('.mn-sw[data-set="sound"]');
  await page.click('.mn-sw[data-set="calm"]');
  await page.waitForTimeout(100);
  const m1 = await menuState();
  await page.click('.mn-sw[data-set="sound"]');
  await page.click('.mn-sw[data-set="calm"]');
  await page.waitForTimeout(100);
  const m2 = await menuState();
  if (m1.muted === !m0.muted && m1.calm === !m0.calm && (m1.vfx === null || m1.vfx === m1.calm) && m2.muted === m0.muted && m2.calm === m0.calm) {
    ok('☰ menu: Sound and "Reduce shake & flashes" switch on and off');
  } else fail(`menu settings: ${JSON.stringify([m0, m1, m2])}`);
  await closeModal();

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
  if (isletTappable) ok(`HUD-safe camera: the north-border islet is visible and tappable (${deviceName})`);
  else fail(`islet portal is hidden under the HUD (${deviceName})`);

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
  // The level-1 hero crosses a level-9 field on the way: keep them alive (a death respawned them in Hearthvale and the
  // walk never arrived), and allow for a slow machine (the walk itself is ~25 s at a low frame rate).
  const crossed = await waitFor(
    async () => {
      await dbg('heal');
      return (await info()).map === 'vale.stormbreak';
    },
    45000,
    'walk through the Prism Gate',
  );
  if (crossed) ok('walked through the Prism Gate');
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
  // A card that waited behind the NPC dialog must show first, then the forge, then the modal closes (the forge used to
  // overwrite the card: the modal could never close).
  await approach("v.kind === 'npc' && v.def.id === 'brann'");
  if (await waitFor(async () => (await info()).panel === 'dialog', 6000, 'Brann dialog (card + forge)')) {
    await page.evaluate(() => window.omnipath.ui.discovery({ icon: '🧪', kicker: 'TEST CARD', title: 'Waits behind Brann', body: 'Shown before the forge.' }));
    await page.click('.dialog [data-opt="0"]');
    const cardFirst = await waitFor(() => page.evaluate(() => !!document.querySelector('.modal .discovery')), 2000, 'waiting card shows before the forge');
    if (cardFirst) await page.click('.modal .discovery .ok');
    if (await waitFor(async () => (await info()).panel === 'minigame', 3000, 'forge after the card')) {
      for (let i = 0; i < 3; i++) {
        await page.click('.minigame .strike');
        await page.waitForTimeout(200);
      }
      if (await waitFor(async () => !(await info()).open, 4000, 'modal closes after card + forge')) ok('a waiting card shows before the forge; the modal closes after');
    }
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

  // Lessons are quest rewards now: Hale's First Drill (accept in his dialog → objectives → turn in) teaches Rising Kick.
  await warp('vale.greenmeadow');
  const questNow = () => page.evaluate(() => window.omnipath.session.book.questStatus('hale_first_drill'));
  const halePanel = async () => {
    await closeModal();
    await dbg('npc', 'hale');
    return waitFor(async () => (await info()).panel === 'dialog', 3000, "Hale's dialog");
  };
  if ((await questNow()) === 'available' && (await halePanel())) {
    const accept = await page.$('.dialog [data-accept="hale_first_drill"]');
    if (accept) await page.click('.dialog [data-accept="hale_first_drill"]');
    else fail("no Accept for First Drill in Hale's dialog");
    await page.waitForTimeout(200);
  }
  await closeModal();
  if ((await questNow()) === 'active') ok("First Drill accepted in Hale's dialog");
  else fail(`First Drill after Accept: ${await questNow()}`);
  // Counters by the debug hook; the basic attack rank (a live 'state' objective) by real mastery.
  await dbg('complete', 'hale_first_drill');
  await page.evaluate(() => {
    const b = window.omnipath.session.book;
    for (let i = 0; i < 40 && b.rank('slash') < 3; i++) b.addMastery('slash', 50);
    b.refreshQuests();
  });
  await closeModal();
  if ((await questNow()) === 'ready' && (await halePanel())) {
    const complete = await page.$('.dialog [data-complete="hale_first_drill"]');
    if (complete) await page.click('.dialog [data-complete="hale_first_drill"]');
    else fail("no Complete for First Drill in Hale's dialog");
    await page.waitForTimeout(300);
    await shot('09b-quest-reward');
    // Every slot of yours is full (the flows above filled them): the reward card offers Equip → the slot picker →
    // back to Hale's dialog.
    const equip = await page.$('.dialog [data-equip-skill="rising_kick"]');
    if (equip) {
      await page.click('.dialog [data-equip-skill="rising_kick"]');
      await page.waitForTimeout(200);
      const pick = (await info()).panel === 'picker' ? await page.$('.picker-sheet .pk-tile[data-slot]') : null;
      if (pick) {
        await page.click(`.picker-sheet .pk-tile[data-slot="${await pick.getAttribute('data-slot')}"]`);
        await page.waitForTimeout(250);
        if ((await info()).panel === 'dialog') ok("reward Equip → slot picker → back in Hale's dialog");
        else fail(`after the reward's slot picker: panel ${(await info()).panel}`);
      }
    }
  } else fail(`First Drill not ready to turn in: ${await questNow()}`);
  await closeModal();
  const kick = await page.evaluate(() => ({
    known: window.omnipath.session.book.has('rising_kick'),
    onBar: window.omnipath.scene.barSlots().some((v) => v.skillId === 'rising_kick'),
    status: window.omnipath.session.book.questStatus('hale_first_drill'),
  }));
  if (kick.known && kick.onBar) ok(`First Drill turned in at Hale: Rising Kick learned and on the bar (${kick.status})`);
  else fail(`First Drill reward: ${JSON.stringify(kick)}`);

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
      const b = document.querySelector('.zone-banner .zone-plate')?.getBoundingClientRect();
      const ts = [...document.querySelectorAll('.toast')].map((t) => t.getBoundingClientRect());
      return !!b && ts.some((t) => t.bottom > b.top && t.top < b.bottom && t.right > b.left && t.left < b.right);
    });
  };
  if (await bannerToast()) fail(`${deviceName}: a toast covers the zone banner`);
  else ok(`zone banner clear of toasts (${deviceName})`);

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

  // ------------------------------------------------------------ softlock guard: never paused without something to close
  // Phaser 3.90 queues ScenePlugin.pause()/resume() to the next update, so a pause and a resume in one tick dropped one
  // of them: a card over a running world, or the world paused with nothing open. MapScene.setPaused now acts at once;
  // ui.ts drains every dialog queued behind a card, and its watchdog repairs (and logs) any broken modal state.
  await warp('vale.hearthvale');
  const modal = () =>
    page.evaluate(() => {
      const { scene, ui, render } = window.omnipath;
      const m = ui.modal;
      return {
        paused: scene.sys.isPaused(),
        asleep: !!render?.asleep?.(),
        open: ui.isOpen,
        shown: !m.classList.contains('hidden') && m.childElementCount > 0,
        card: !!m.querySelector(':scope > .discovery'),
        dialog: m.querySelector('.dialog .who b')?.textContent ?? null,
        watchdog: ui.watchdogLog.length,
      };
    });
  const testCard = (title) => ({ icon: '🧪', kicker: 'TEST CARD', title, body: 'x' });
  // a) Opened and closed by the same handler: the world runs again.
  await page.evaluate(() => {
    window.omnipath.ui.open('bag');
    window.omnipath.ui.close();
  });
  await page.waitForTimeout(300);
  let mst = await modal();
  if (mst.paused || mst.open || mst.shown) fail(`open + close in one tick left ${JSON.stringify(mst)}`);
  // b) One card closes as the next opens (same tick): the world stays paused under the second card.
  await page.evaluate(
    ([a, b]) => {
      window.omnipath.ui.discovery(a);
      window.omnipath.ui.discovery(b);
    },
    [testCard('First'), testCard('Second')],
  );
  await page.waitForTimeout(200);
  await page.evaluate(() => document.querySelector('.discovery .ok')?.click());
  await page.waitForTimeout(400);
  mst = await modal();
  if (!(mst.paused && mst.card)) fail(`the next card showed over a running world: ${JSON.stringify(mst)}`);
  // c) Two dialogs queued behind a card both show, in order, after it (the second used to be dropped).
  await page.evaluate(() => {
    const ui = window.omnipath.ui;
    ui.dialog('Dialog A', '🧪', 'first', [{ label: 'OK' }]);
    ui.dialog('Dialog B', '🧪', 'second', [{ label: 'OK' }]);
  });
  const seen = [];
  for (let i = 0; i < 6; i++) {
    mst = await modal();
    if (!mst.open) break;
    if (mst.dialog) seen.push(mst.dialog);
    const btn = (await page.$('.discovery .ok')) ?? (await page.$('.dialog [data-opt]'));
    if (!btn) break;
    await btn.click();
    await page.waitForTimeout(250);
  }
  mst = await modal();
  if (seen.join(',') !== 'Dialog A,Dialog B') fail(`dialogs queued behind a card: saw ${JSON.stringify(seen)}`);
  else if (mst.paused || mst.open) fail(`after the queued dialogs: ${JSON.stringify(mst)}`);
  else ok('same-tick pause/resume, back-to-back cards and dialogs queued behind cards keep the pause state right');
  // c2) A card's button that opens a panel never replaces the minigame queued behind that card (it never finished:
  //     the forge's ore was spent for nothing). The panel opens once the minigame is done.
  await page.evaluate(() => {
    const ui = window.omnipath.ui;
    ui.discovery({ icon: '🧪', kicker: 'TEST CARD', title: 'See it', body: 'x', cta: { label: 'See it', run: () => ui.open('bag') } });
    window.__forge = null;
    void ui.forgeMinigame().then((g) => (window.__forge = g));
  });
  await page.waitForTimeout(250);
  await page.click('.discovery .cta');
  await page.waitForTimeout(250);
  const mg = await page.evaluate(() => ({ panel: window.omnipath.ui.current, strike: !!document.querySelector('.minigame .strike') }));
  if (!(mg.panel === 'minigame' && mg.strike)) fail(`a card's button replaced the minigame behind it: ${JSON.stringify(mg)}`);
  else {
    for (let i = 0; i < 3; i++) {
      await page.click('.minigame .strike');
      await page.waitForTimeout(150);
    }
    if (await waitFor(() => page.evaluate(() => window.__forge !== null), 5000, 'the forge minigame behind a card finishes')) {
      await page.waitForTimeout(200);
      mst = await modal();
      const now = await info();
      if (now.panel !== 'bag' || !mst.paused) fail(`after the minigame: panel ${now.panel}, ${JSON.stringify(mst)}`);
      else ok("a card's button waits for the minigame behind the card, then opens its panel");
    }
  }
  await closeModal();
  // d) The watchdog: break the state on purpose (paused, nothing open): it resumes the world within ~2 s and logs it.
  await page.evaluate(() => window.omnipath.scene.sys.pause());
  await waitFor(async () => !(await modal()).paused, 4000, 'watchdog resumes a world paused with nothing open');
  mst = await modal();
  if (mst.watchdog !== 1) fail(`watchdog log after one forced softlock: ${mst.watchdog} entries`);
  else ok('the watchdog repairs a world paused with nothing open (and logs it)');
  await page.evaluate(() => (window.omnipath.ui.watchdogLog.length = 0));
  // e) Seeded mini-fuzz: fights, learning (class discovery), quests, NPC dialogs, panels, cards, dialogs and warps,
  //    with the invariant checked in the page every 100 ms. Nothing may stay frozen without a visible panel or card,
  //    nothing may show over a running world, and the watchdog must never have to step in.
  await page.evaluate(() => {
    const { scene, ui, render } = window.omnipath;
    const f = (window.__softlock = { bad: [], since: {} });
    f.timer = setInterval(() => {
      const m = ui.modal;
      const shown = !m.classList.contains('hidden') && m.childElementCount > 0;
      const asleep = !!render?.asleep?.();
      const frozen = scene.sys.isPaused() || asleep;
      const running = scene.sys.isActive() && !scene.warping && !asleep;
      const rules = { 'frozen with nothing shown': frozen && !shown, 'modal over a running world': ui.isOpen && running };
      for (const [name, isBad] of Object.entries(rules)) {
        if (!isBad) delete f.since[name];
        else if ((f.since[name] ??= performance.now()) < performance.now() - 1000 && f.bad.length < 5) {
          f.bad.push(`${name} (panel ${ui.current}, card ${ui.showingDiscovery}, map ${scene.mapId})`);
          delete f.since[name];
        }
      }
    }, 100);
  });
  let seed = 7;
  const rand = () => (seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296;
  const any = (xs) => xs[Math.floor(rand() * xs.length)];
  const lists = await page.evaluate(() => {
    const r = window.omnipath.reg;
    const vals = (m) => (m instanceof Map ? [...m.values()] : Array.isArray(m) ? m : Object.values(m ?? {}));
    return {
      skills: vals(r.skills).filter((x) => x.tier >= 1).map((x) => x.id),
      classes: vals(r.classes).map((c) => c.id),
      quests: vals(r.quests).map((q) => q.id),
    };
  });
  const clickAny = async (sel) => {
    const els = await page.$$(sel);
    if (els.length) await any(els).click({ timeout: 600 }).catch(() => {});
  };
  const moves = [
    () => dbg('fight'),
    () => dbg('learn', any(lists.skills)),
    () => dbg('become', any(lists.classes), true),
    () => dbg('accept', any(lists.quests)),
    () => dbg('complete', any(lists.quests)),
    () => dbg('turnIn', any(lists.quests)),
    () => page.evaluate(() => window.omnipath.scene.npcs[0] && window.omnipath.debug.npc(window.omnipath.scene.npcs[0].def.id)),
    () => page.evaluate((p) => window.omnipath.ui.open(p), any(['skills', 'classes', 'codex', 'bag', 'map'])),
    () => clickAny('.sheet .x'),
    () => clickAny('.discovery .ok, .discovery .cta, .discovery .act'),
    () => clickAny('.dialog [data-opt], .dialog [data-accept], .dialog [data-complete]'),
    () => page.evaluate((c) => window.omnipath.ui.discovery(c), testCard('Fuzz card')),
    () => dbg('warp', any(['vale.hearthvale', 'vale.greenmeadow', 'vale.mirror_lake', 'rift.riftmarch'])),
    () => page.waitForTimeout(600),
  ];
  const fuzzSteps = quick ? 40 : 120;
  for (let i = 0; i < fuzzSteps; i++) {
    await any(moves)().catch(() => {});
    await page.waitForTimeout(60 + Math.floor(rand() * 140));
  }
  for (let i = 0; i < 6 && (await info()).open; i++) await closeModal();
  await page.waitForTimeout(1500);
  const fz = await page.evaluate(() => {
    clearInterval(window.__softlock.timer);
    return { bad: window.__softlock.bad, watchdog: window.omnipath.ui.watchdogLog.map((w) => `${w.problem}: ${w.state}`) };
  });
  if (fz.bad.length) fail(`softlock fuzz: ${fz.bad.join(' | ')}`);
  else if (fz.watchdog.length) fail(`softlock fuzz: the watchdog had to step in: ${fz.watchdog.join(' | ')}`);
  else ok(`softlock fuzz (${fuzzSteps} random steps): never frozen with nothing shown, never a panel over a running world`);

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
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('omnipath.save.v3') ?? 'null'));
  if (saved?.v === 3 && saved.world?.visited?.length >= 10) ok(`save v3 written (${saved.world.visited.length} maps visited)`);
  else fail(`save v3 missing or incomplete (v ${saved?.v}, ${saved?.world?.visited?.length ?? 0} maps)`);

  // ------------------------------------------------------------ long-press (touch): the picker / card opened by a hold
  // stays open when the finger lifts (the click the lift makes must not land on the new backdrop).
  if (device.touch) {
    const idx = await page.evaluate(() => {
      const s = window.omnipath.scene;
      const bar = s.barSlots();
      const own = bar.find((x) => x.kind === 'own' && x.skillId);
      if (own) return own.index;
      // No skill in a slot of yours yet: put a known one there (the last own slot).
      const slot = [...bar].reverse().find((x) => x.kind === 'own');
      const spare = s.book.known().find((k) => !bar.some((x) => x.skillId === k.id) && s.slotPicker(slot.index).choices.some((c) => c.skillId === k.id));
      if (slot && spare) window.omnipath.debug.assign(slot.index, spare.id);
      return slot && spare ? slot.index : null;
    });
    const at = await page.evaluate((i) => {
      if (i === null) return null;
      const r = document.querySelector(`.hotbar .slot[data-slot="${i}"]`)?.getBoundingClientRect();
      return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
    }, idx);
    if (idx !== null && at) {
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [at] });
      await page.waitForTimeout(900);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await page.waitForTimeout(400);
      const st = await info();
      if (st.panel === 'picker') ok('long-press on your slot: the picker stays open after the finger lifts');
      else fail(`long-press on slot ${idx + 1}: picker closed on release (panel ${st.panel})`);
      await closeModal();
    }
  }

  // ------------------------------------------------------------ layouts
  await warp('vale.hearthvale');
  await shot('12-portrait-hearthvale');
  // Portrait screens keep the middle band (40–60 % of the height, where the player stands) free of HUD boxes, with
  // the Pursuits open: tap-to-move must reach the world there. The bar, the attack cluster, the left-edge quick
  // buttons, the fading log and toasts are allowed.
  const ALL_BOXES = ['.hud-me .me-plate', '.hotbar .mech-dock', '.hud-right .menu', '.hud-right .mm-dock', '.hud-right .pursuits', '.hud-centre .zone-banner', '.hud-centre .target', '.hud-centre .navpill'];
  // Landscape: the centre column over the player (zone plate, target plate, nav pill) and the toasts under it.
  const CENTRE_BOXES = ['.hud-centre .zone-banner', '.hud-centre .target', '.hud-centre .navpill', '.toasts .toast'];
  // `target`: put that target plate up and measure at once, in the same task (the scene's combat pushes its own target
  // — none here — to the HUD within a few frames, so a plate set from outside is gone before a later measure).
  const middleBand = (sels = ALL_BOXES, target = null) =>
    page.evaluate(([list, target]) => {
      if (target) {
        window.omnipath.ui.setTarget(target);
        window.omnipath.ui.hud.layout();
        if (!document.querySelector('.hud-centre .target:not(.hidden)')) return ['no target plate to measure'];
      }
      const H = innerHeight;
      const out = [];
      for (const sel of list) {
        const el = document.querySelector(sel);
        if (!el || el.offsetParent === null || el.classList.contains('hidden')) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 1 || r.height < 1 || getComputedStyle(el).visibility === 'hidden') continue;
        if (r.top < H * 0.6 && r.bottom > H * 0.4) out.push(`${sel} ${Math.round(r.top)}-${Math.round(r.bottom)}`);
      }
      return out;
    }, [sels, target]);
  for (const [name, w, h] of [
    ['portrait-phone', 390, 844],
    ['landscape-phone', 844, 390],
    ['ipad-landscape', 1024, 768],
    ['ipad-portrait', 810, 1080],
    ['desktop', 1440, 900],
    ['laptop-1280', 1280, 720],
  ]) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(400);
    await shot(`13-${name}`);
    if (await bannerToast()) fail(`${name}: a toast covers the zone banner`);
    if (h > w) {
      await page.evaluate(() => {
        const p = document.querySelector('.pursuits');
        if (p && !p.classList.contains('open')) p.querySelector('.pz-tab')?.click();
      });
      await page.waitForTimeout(400);
      const mid = await middleBand(ALL_BOXES, { name: 'Jellop', level: 1, hp: 20, maxHp: 30 });
      if (mid.length) fail(`${name}: HUD in the middle of the screen: ${mid.join(', ')}`);
      else ok(`${name}: the middle band is free of HUD (Pursuits open, a target up)`);
    } else {
      // Landscape (short ones especially, 1280×720 at 2 CSS px per art px): a warden's plate and the zone plate must
      // not reach down over the player, nor the toasts.
      await page.evaluate(() => {
        window.omnipath.ui.banner('Stormbreak', 'Lv 12');
        window.omnipath.ui.setTarget({ name: 'Thunderhoof', level: 12, hp: 4000, maxHp: 5000, boss: true });
        window.omnipath.ui.toast('AUTO is on: you fight by yourself.');
        window.omnipath.ui.toast('You awaken at the Windcrest Hill waystone.');
      });
      await page.waitForTimeout(500);
      const mid = await middleBand(CENTRE_BOXES, { name: 'Thunderhoof', level: 12, hp: 4000, maxHp: 5000, boss: true });
      await shot(`13-${name}-warden`);
      if (mid.length) fail(`${name}: the centre column covers the player: ${mid.join(', ')}`);
      else ok(`${name}: the centre band is clear (warden plate, zone plate and toasts)`);
      await page.evaluate(() => window.omnipath.ui.setTarget(null));
    }
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
    // The Star Chart with a star's card docked beside the sky (its constellation chips shrink and wrap there).
    await page.evaluate(() => window.omnipath.ui.open('skills', `star:${window.omnipath.session.book.known()[0].id}`));
    await page.waitForTimeout(300);
    small = small.concat((await smallButtons()).map((t) => `${t} (card docked)`));
    await page.click('.sheet .x');
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
    v3: JSON.parse(localStorage.getItem('omnipath.save.v3') ?? 'null'),
    map: window.omnipath.debug.info().map,
  }));
  const orb = mig.v3?.book?.skills?.arcane_orb ?? mig.v3?.book?.shelved?.arcane_orb;
  if (mig.v1 && mig.v3?.v === 3 && mig.v3.player.bag.ore === 3 && orb && mig.map === 'vale.hearthvale')
    ok('v1 save migrated to v3 (v1 kept, bag + book carried over)');
  else fail(`v1 migration: ${JSON.stringify({ v1: mig.v1, v: mig.v3?.v, map: mig.map, bag: mig.v3?.player?.bag, orb: !!orb })}`);
  await ctx2.close();
} catch (e) {
  if (e !== SKIP_MAIN) fail(`exception: ${e?.stack ?? e}`);
}

// ------------------------------------------------------------ --portals: walk every portal pair by tapping
// Like a player: only taps canvas pixels no HUD element covers (and no monster stands on), following the real path,
// then checks the destination map, the arrival tile and the return portal. Slow (~25 min at phone size).
if (args.includes('--portals') || args.includes('--only-portals')) {
  const mapsAt = args.indexOf('--maps');
  const portalMaps = mapsAt >= 0 ? args[mapsAt + 1].split(',') : ALL_MAPS;
  const size = args.includes('--landscape') ? { width: 844, height: 390 } : { width: 390, height: 844 };
  const ctx3 = await browser.newContext({ viewport: size, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  const p3 = await ctx3.newPage();
  p3.on('pageerror', (e) => fail(`page error (portals): ${e.message}`));
  const inf = () => p3.evaluate(() => window.omnipath.debug.info());
  const settle = async () => {
    for (let i = 0; i < 30 && (await p3.evaluate(() => !!window.omnipath.scene?.warping)); i++) await p3.waitForTimeout(100);
  };
  const close3 = async () => {
    for (let i = 0; i < 12 && (await inf()).open; i++) {
      // Discovery cards only close via their own button (ui.close() leaves them up).
      const btn = await p3.$('.discovery .ok');
      if (btn) await btn.click().catch(() => {});
      else await p3.evaluate(() => window.omnipath.ui.close());
      await p3.waitForTimeout(150);
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
          for (let fy = 0.15; fy < 1; fy += 0.175)
            for (let fx = 0.15; fx < 1; fx += 0.175) {
              const q = free((rc.tx + rc.w * fx) * T, (rc.ty + rc.h * fy) * T);
              if (q) return q;
            }
        const pl = s.player;
        const gx = (rc.tx + rc.w / 2) * T;
        const gy = (rc.ty + rc.h / 2) * T;
        if (!j) {
          // the farthest visible point along the real path
          const path = [{ x: pl.x, y: pl.y }, ...(s.pathTo(gx, gy) ?? [])];
          for (let i = path.length - 1; i >= 1; i--) {
            const a = path[i - 1];
            const b = path[i];
            const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 16));
            for (let k = n; k >= 0; k--) {
              const x = a.x + ((b.x - a.x) * k) / n;
              const y = a.y + ((b.y - a.y) * k) / n;
              if (Math.hypot(x - pl.x, y - pl.y) < 20) continue;
              const q = free(x, y);
              if (q) return q;
            }
          }
        }
        // stuck or nothing visible on the path: the straight line toward the exit, offset sideways by `j`
        const L = Math.hypot(gx - pl.x, gy - pl.y) || 1;
        for (let k = 1; k >= 0.05; k -= 0.05) {
          const q = free(pl.x + (gx - pl.x) * k + (-(gy - pl.y) / L) * j, pl.y + (gy - pl.y) * k + ((gx - pl.x) / L) * j);
          if (q) return q;
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
    for (const mapId of portalMaps) {
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
        const until = Date.now() + 60000;
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
