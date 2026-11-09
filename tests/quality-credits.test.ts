// Credits and third-party notices: scripts/third-party.mjs output is up to date, lists what ships with its real
// licence, and the Credits screen (src/ui/panels/credits.ts) shows it in plain words.
import { describe, expect, it } from 'vitest';
import noticesMd from '../THIRD-PARTY-NOTICES.md?raw';
import { FALLBACK_CREDITS, creditsHtml, licenceName, loadCredits, reflowLicence, type CreditsData } from '../src/ui/panels/credits';

/** Shipped licence files (public/licenses/*), keyed by repo path. */
const FILES: Record<string, string> = Object.fromEntries(
  Object.entries(import.meta.glob<string>('../public/licenses/*', { query: '?raw', import: 'default', eager: true })).map(([k, v]) => [k.slice(3), v]),
);
FILES['THIRD-PARTY-NOTICES.md'] = noticesMd;
const json = (): CreditsData => JSON.parse(FILES['public/licenses/third-party.json']);
/** The generator (plain node ESM: loaded untyped). */
const generator = async () => (await import('../scripts/third-party.mjs' as string)) as { outputs(): Record<string, string> };

describe('third-party notices', () => {
  it('THIRD-PARTY-NOTICES.md, the JSON and the licence files match what the generator makes now', async () => {
    const out = (await generator()).outputs();
    expect(Object.keys(out).length).toBeGreaterThanOrEqual(8);
    // (run `node scripts/third-party.mjs` when this fails)
    for (const [path, content] of Object.entries(out)) expect(FILES[path], path).toBe(content);
  });

  it('lists the shipped engine, fonts and synth with their real licences and full texts', () => {
    const d = json();
    const by = Object.fromEntries(d.components.map((c) => [c.id, c]));
    expect(by.phaser).toMatchObject({ name: 'Phaser', license: 'MIT', version: '3.90.0' });
    expect(by['@fontsource/pixelify-sans']).toMatchObject({ name: 'Pixelify Sans', license: 'OFL-1.1' });
    expect(by['@fontsource/tiny5']).toMatchObject({ name: 'Tiny5', license: 'OFL-1.1' });
    expect(by.zzfx).toMatchObject({ name: 'ZzFX', license: 'MIT', version: '1.4.0' });
    // Phaser bundles eventemitter3; the hosted build carries Vite's preload helper.
    expect(by.eventemitter3?.license).toBe('MIT');
    expect(by.vite?.license).toBe('MIT');
    for (const c of d.components) {
      expect(c.text, c.id).toBeTruthy();
      expect(c.copyright, c.id).toMatch(/copyright/i);
      if (c.license === 'MIT') expect(c.text).toContain('Permission is hereby granted, free of charge');
      if (c.license === 'OFL-1.1') expect(c.text).toContain('SIL OPEN FONT LICENSE Version 1.1');
      expect(FILES[`public/licenses/${c.file}`]).toBe(c.text);
    }
    // Only runtime code: no test or type-checking tools.
    expect(d.components.map((c) => c.id)).not.toContain('vitest');
    expect(d.components.map((c) => c.id)).not.toContain('typescript');
    for (const c of d.components) expect(noticesMd).toContain(`## ${c.name}`);
  });

  it('credits the techniques of docs/VFX.md §12', () => {
    const t = json().techniques.map((x) => x.source).join('\n');
    expect(t).toMatch(/Saint11/);
    expect(t).toMatch(/Sprite Fusion/);
    expect(t).toMatch(/pixelfx/);
    expect(t).toMatch(/Bayer/);
  });

  it('the built-in list (single-file build) matches the generated one', () => {
    const d = json();
    expect(FALLBACK_CREDITS.components.map((c) => [c.id, c.name, c.license, c.copyright])).toEqual(d.components.map((c) => [c.id, c.name, c.license, c.copyright]));
    // every technique source, by its leading words (the built-in lines are shortened)
    expect(FALLBACK_CREDITS.techniques.map((t) => t.source.split(/[,(]/)[0].trim())).toEqual(d.techniques.map((t) => t.source.split(/[,(]/)[0].trim()));
    expect(FALLBACK_CREDITS.techniques.map((t) => t.licence)).toEqual(d.techniques.map((t) => t.licence));
  });
});

describe('Credits screen', () => {
  it('one line per part in plain words, licence texts behind a closed toggle, one Back button', () => {
    const html = creditsHtml(json());
    expect(html).toContain('<b>Phaser</b><span>Game engine</span>');
    expect(html).toContain('SIL Open Font License 1.1');
    expect(html).toContain('MIT licence');
    expect(html.match(/class="cr-box hidden"/g)?.length).toBe(json().components.length);
    expect(html.match(/cr-back/g)).toHaveLength(1);
    expect(html).toContain('Tricks learned from');
    // URLs in brackets are dropped from the trick lines.
    expect(html).not.toMatch(/<li>[^<]*spritefusion\.com/);
    // The built-in list has no texts: no toggles, the copyright on the licence line.
    const fb = creditsHtml(FALLBACK_CREDITS);
    expect(fb).not.toContain('cr-box');
    expect(fb).toContain('Copyright (c) 2019 Frank Force');
  });

  it('licence texts reflow for a phone-width box without changing a word', () => {
    const words = (t: string) => t.replace(/^[-=_*]{3,}$/gm, '').split(/\s+/).filter(Boolean);
    for (const c of json().components) {
      const r = reflowLicence(c.text!);
      expect(words(r)).toEqual(words(c.text!));
      expect(r).not.toMatch(/[^\n]\n[^\n]/); // no hard breaks inside a paragraph
    }
    expect(reflowLicence('a\nb\n\n----\nc')).toBe('a b\n\nc');
  });

  it('plain licence names', () => {
    expect(licenceName('MIT')).toBe('MIT licence');
    expect(licenceName('OFL-1.1')).toBe('SIL Open Font License 1.1');
    expect(licenceName('public algorithm')).toBe('public algorithm');
  });

  it('loads the generated JSON, and falls back (null) when it cannot', async () => {
    const ok = (async () => ({ ok: true, json: async () => json() })) as unknown as typeof fetch;
    const d = await loadCredits(ok);
    expect(d?.components.length).toBe(json().components.length);
    // (cached after a success)
    expect(await loadCredits((async () => ({ ok: false })) as unknown as typeof fetch)).toBe(d);
  });
});
