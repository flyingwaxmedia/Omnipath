#!/usr/bin/env node
// Third-party notices generator (quality lane; docs/QUALITY-PLAN.md Phase D item 15).
//
//   node scripts/third-party.mjs           writes THIRD-PARTY-NOTICES.md, public/licenses/third-party.json (read by
//                                          the ☰ menu's Credits screen) and the licence texts in public/licenses/
//   node scripts/third-party.mjs --check   exits 1 when any of those files is out of date (tests run this)
//
// What ships, and therefore what is listed:
//   - every npm dependency the game's source imports (src/**/*.ts import specifiers), plus the production
//     dependencies those packages pull in (Phaser bundles eventemitter3), each with the licence text from its own
//     package (LICENSE*, package.json `license`; @fontsource packages name the font and its authors in
//     metadata.json);
//   - vendored code: ZzFX (src/game/audio/zzfx.ts, MIT; copyright and licence read from that file's header);
//   - Vite's small module-preload helper, which the hosted build injects into the page (MIT; the core section of
//     node_modules/vite/LICENSE.md);
//   - technique credits: the table in docs/VFX.md §12 (techniques only: no code or pixels were copied).
// The output is deterministic (no dates), so --check is stable.
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const NOTICES = 'THIRD-PARTY-NOTICES.md';
const LICENSES = 'public/licenses';
const JSON_OUT = `${LICENSES}/third-party.json`;

/** Plain words for what each shipped package is (unknown packages say "Library"). */
const ROLES = {
  phaser: 'Game engine',
  eventemitter3: 'Event library inside Phaser',
  '@fontsource/pixelify-sans': 'Pixel font for menus and titles',
  '@fontsource/tiny5': 'Pixel font for small numbers',
};

/** Licence text file names in public/licenses/ (kept stable: the fonts' names predate this script). */
const TEXT_FILES = {
  phaser: 'Phaser-MIT.txt',
  eventemitter3: 'eventemitter3-MIT.txt',
  '@fontsource/pixelify-sans': 'PixelifySans-OFL.txt',
  '@fontsource/tiny5': 'Tiny5-OFL.txt',
  zzfx: 'ZzFX-MIT.txt',
  vite: 'Vite-MIT.txt',
};

const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const readJson = (p) => JSON.parse(read(p));
const norm = (s) => s.replace(/\r\n/g, '\n').replace(/[ \t]+$/gm, '').trim() + '\n';

function walk(dir, out = []) {
  for (const name of readdirSync(join(ROOT, dir))) {
    const p = join(dir, name);
    if (statSync(join(ROOT, p)).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|js|mjs|css)$/.test(name)) out.push(p);
  }
  return out;
}

/**
 * Bare package names whose code the source pulls in (import … from 'x', import 'x', export … from 'x', import('x'),
 * CSS @import). `import type` / `export type` ship nothing and are skipped.
 */
export function importedPackages(files = walk('src')) {
  const found = new Set();
  const re = /\b(?:import|export)\s+(type\s+)?(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)|@import\s+['"]([^'"]+)['"]/g;
  for (const f of files) {
    const src = read(f);
    for (const m of src.matchAll(re)) {
      if (m[1]) continue;
      const spec = m[2] ?? m[3] ?? m[4];
      if (!spec || /^[./]/.test(spec) || /^[a-z]+:/.test(spec)) continue;
      const name = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];
      found.add(name);
    }
  }
  return found;
}

function licenceFile(pkgDir) {
  const names = readdirSync(join(ROOT, pkgDir));
  const hit = names.find((n) => /^(licen[cs]e|copying)(\.(md|txt))?$/i.test(n));
  return hit ? join(pkgDir, hit) : null;
}

/** The first copyright line of a licence text. */
function copyrightOf(text) {
  const line = text.split('\n').find((l) => /copyright/i.test(l) && !/permission|notice shall/i.test(l));
  return line ? line.trim() : '';
}

/** Shipped npm packages: imported by src/ and in package.json dependencies, plus their production dependencies. */
export function shippedPackages() {
  const root = readJson('package.json');
  const deps = Object.keys(root.dependencies ?? {});
  const used = importedPackages();
  const queue = deps.filter((d) => used.has(d)).sort();
  const seen = new Set();
  const out = [];
  while (queue.length) {
    const name = queue.shift();
    if (seen.has(name)) continue;
    seen.add(name);
    const dir = `node_modules/${name}`;
    const pkg = readJson(`${dir}/package.json`);
    const lf = licenceFile(dir);
    if (!lf) throw new Error(`${name}: no licence file in ${dir}`);
    const text = norm(read(lf));
    const meta = existsSync(join(ROOT, dir, 'metadata.json')) ? readJson(`${dir}/metadata.json`) : null;
    const entry = {
      id: name,
      name: meta?.family ?? (name === 'phaser' ? 'Phaser' : name),
      role: ROLES[name] ?? 'Library',
      version: pkg.version,
      license: meta?.license?.type ?? pkg.license,
      copyright: meta?.license?.attribution ? `Copyright ${meta.license.attribution.replace(/^Copyright\s+/i, '')}` : copyrightOf(text),
      url: meta?.license?.attribution?.match(/\((https?:[^)]+)\)/)?.[1] ?? pkg.homepage ?? repoUrl(pkg.repository),
      source: `npm package ${name}`,
      file: TEXT_FILES[name] ?? `${name.replace(/^@/, '').replace(/\//g, '-')}-${pkg.license}.txt`,
      text,
    };
    out.push(entry);
    for (const d of Object.keys(pkg.dependencies ?? {}).sort()) queue.push(d);
  }
  // Engine first, then what it bundles, then the fonts (ROLES order); anything else after them.
  const rank = (id) => {
    const i = Object.keys(ROLES).indexOf(id);
    return i < 0 ? 99 : i;
  };
  return out.sort((a, b) => rank(a.id) - rank(b.id) || a.id.localeCompare(b.id));
}

/** A package.json `repository` as a browsable URL. */
function repoUrl(repo) {
  const u = typeof repo === 'string' ? repo : (repo?.url ?? '');
  return u.replace(/^git\+/, '').replace(/^git:\/\//, 'https://').replace(/\.git$/, '');
}

/** ZzFX, vendored in src/game/audio/zzfx.ts: version, author, copyright and MIT text from the file's header. */
export function vendoredZzfx() {
  const src = read('src/game/audio/zzfx.ts');
  const head = src.slice(src.indexOf('/*') + 2, src.indexOf('*/'));
  const lines = head.split('\n').map((l) => l.replace(/^ {2}/, ''));
  const title = lines.find((l) => /ZzFX - /.test(l))?.trim() ?? 'ZzFX';
  const version = title.match(/v(\d+\.\d+\.\d+)/)?.[1] ?? '';
  const url = lines.find((l) => /https?:\/\//.test(l))?.trim() ?? '';
  const start = lines.findIndex((l) => /MIT License/.test(l));
  const body = lines.slice(start + 1).join('\n').trim();
  const copyright = copyrightOf(body).replace(/\s+-\s+/, ' ');
  const text = norm(`MIT License\n\n${body}`);
  return {
    id: 'zzfx',
    name: 'ZzFX',
    role: 'Sound maker (every sound is built from it in code)',
    version,
    license: 'MIT',
    copyright,
    url,
    source: 'vendored in src/game/audio/zzfx.ts (sample generator only, ported to TypeScript; seeded randomness, no AudioContext at import, sample rate as a parameter)',
    file: TEXT_FILES.zzfx,
    text,
  };
}

/** Vite's core MIT section (its module-preload helper ships in the hosted build). */
export function viteHelper() {
  const pkg = readJson('node_modules/vite/package.json');
  const full = read('node_modules/vite/LICENSE.md');
  const core = full.split(/\n# Licenses of bundled dependencies/)[0];
  const text = norm(core.replace(/^# Vite core license\s*\n/, '').replace(/^Vite is released under the MIT license:\s*\n/m, ''));
  return {
    id: 'vite',
    name: 'Vite',
    role: 'Build tool (its small page-loading helper ships with the game)',
    version: pkg.version,
    license: 'MIT',
    copyright: copyrightOf(text),
    url: 'https://vite.dev',
    source: 'module-preload helper injected into the hosted build',
    file: TEXT_FILES.vite,
    text,
  };
}

/** Technique credits: the source table of docs/VFX.md §12 (plain cells, markdown stripped). */
export function techniqueCredits() {
  const doc = read('docs/VFX.md');
  const at = doc.indexOf('## 12.');
  const end = doc.indexOf('\n## ', at + 5);
  const section = doc.slice(at, end < 0 ? undefined : end);
  const rows = section.split('\n').filter((l) => l.startsWith('|') && !/^\|\s*-/.test(l));
  const plain = (s) => s.replace(/`([^`]*)`/g, '$1').replace(/\*\*([^*]*)\*\*/g, '$1').replace(/\s+/g, ' ').trim();
  return rows.slice(1).map((r) => {
    const cells = r.split('|').slice(1, -1).map(plain);
    return { source: cells[0], licence: cells[1].replace(/\s*\(.*\)$/, ''), use: cells[2] };
  });
}

/** Everything the notices list. */
export function collect() {
  return {
    components: [...shippedPackages(), vendoredZzfx(), viteHelper()],
    techniques: techniqueCredits(),
  };
}

export function renderMarkdown({ components, techniques }) {
  const out = [];
  out.push('# Third-party notices', '');
  out.push('<!-- Generated by scripts/third-party.mjs from the packages and vendored code the game ships. Do not edit by hand:');
  out.push('     run `node scripts/third-party.mjs` after changing dependencies. -->', '');
  out.push("Omnipath's art and sound are generated in code and are original. The third-party code and fonts it ships are");
  out.push('listed here with their licences. The same list is shown in the game (☰ Menu → Credits).', '');
  for (const c of components) {
    out.push(`## ${c.name}${c.version ? ` ${c.version}` : ''} (${c.license})`, '');
    out.push(`- What: ${c.role}`);
    out.push(`- From: ${c.source}${c.url ? ` — ${c.url}` : ''}`);
    if (c.copyright) out.push(`- ${c.copyright}`);
    out.push(`- Licence text: \`${LICENSES}/${c.file}\``, '');
    out.push('```', c.text.trimEnd(), '```', '');
  }
  out.push('## Techniques learned from', '');
  out.push('No code, pixels or sounds were copied from these sources; only written techniques and numbers were used');
  out.push('(docs/VFX.md §12).', '');
  out.push('| source | licence | what we use |', '|---|---|---|');
  for (const t of techniques) out.push(`| ${t.source} | ${t.licence} | ${t.use} |`);
  out.push('');
  return out.join('\n');
}

export function renderJson({ components, techniques }) {
  const data = {
    note: 'Generated by scripts/third-party.mjs. Read by the Credits screen (src/ui/panels/credits.ts).',
    components: components.map(({ id, name, role, version, license, copyright, url, file, text }) => ({ id, name, role, version, license, copyright, url, file, text })),
    techniques,
  };
  return JSON.stringify(data, null, 2) + '\n';
}

export function renderReadme({ components }) {
  const lines = ['Third-party licences shipped with Omnipath', '==========================================', ''];
  lines.push('Generated by scripts/third-party.mjs (see THIRD-PARTY-NOTICES.md for the full list).', '');
  for (const c of components) {
    lines.push(`- ${c.name}${c.version ? ` ${c.version}` : ''} (${c.license}) — ${c.role}.`);
    if (c.copyright) lines.push(`  ${c.copyright}`);
    lines.push(`  Licence: ${c.file}`);
  }
  lines.push('', 'The in-world pixel font (src/game/render/glyphs.ts), all game art and all sound recipes are original and generated in code.', '');
  return lines.join('\n');
}

/** Every output file → its content. */
export function outputs(data = collect()) {
  const files = {
    [NOTICES]: renderMarkdown(data),
    [JSON_OUT]: renderJson(data),
    [`${LICENSES}/README.txt`]: renderReadme(data),
  };
  for (const c of data.components) files[`${LICENSES}/${c.file}`] = c.text;
  return files;
}

function main() {
  const check = process.argv.includes('--check');
  const files = outputs();
  const stale = [];
  for (const [p, content] of Object.entries(files)) {
    const abs = join(ROOT, p);
    const now = existsSync(abs) ? readFileSync(abs, 'utf8') : null;
    if (now === content) continue;
    if (check) stale.push(p);
    else {
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, content);
      console.log(`wrote ${relative(ROOT, abs)}`);
    }
  }
  if (check) {
    if (stale.length) {
      console.log(`out of date (run node scripts/third-party.mjs): ${stale.join(', ')}`);
      process.exit(1);
    }
    console.log('third-party notices are up to date');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
