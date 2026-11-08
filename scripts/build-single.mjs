// Builds a single self-contained HTML page: game code and CSS inline,
// Phaser loaded from the jsDelivr CDN. Handy for sharing a test build
// as one file or hosting it anywhere that serves static HTML.
//
//   npm run build:single   ->  dist-single/omnipath.html
//
// Pass --fragment to omit <!doctype>/<html>/<head>/<body> (for hosts that
// wrap the page in their own document skeleton).
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { build } from 'vite';

const PHASER_VERSION = JSON.parse(await readFile('node_modules/phaser/package.json', 'utf8')).version;
const PHASER_CDN = `https://cdn.jsdelivr.net/npm/phaser@${PHASER_VERSION}/dist/phaser.min.js`;
const fragment = process.argv.includes('--fragment');
const tmp = 'dist-single/.tmp';

await build({
  configFile: false,
  logLevel: 'warn',
  build: {
    outDir: tmp,
    emptyOutDir: true,
    cssCodeSplit: false,
    target: 'es2022',
    rollupOptions: {
      input: 'src/main.ts',
      external: ['phaser'],
      output: {
        format: 'iife',
        globals: { phaser: 'Phaser' },
        entryFileNames: 'game.js',
        assetFileNames: 'game[extname]',
        inlineDynamicImports: true,
      },
    },
  },
});

const js = (await readFile(`${tmp}/game.js`, 'utf8')).replace(/<\/script/gi, '<\\/script');
const css = await readFile(`${tmp}/game.css`, 'utf8');
const body = `<title>Omnipath</title>
<style>
:root { color-scheme: dark; }
html, body { height: 100%; }
${css}
</style>
<div id="game"></div>
<div id="ui"></div>
<script src="${PHASER_CDN}"></script>
<script>
${js}
</script>
`;
const html = fragment
  ? body
  : `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover" />
<meta name="theme-color" content="#16203a" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="mobile-web-app-capable" content="yes" />
</head>
<body>
${body}</body>
</html>
`;

await mkdir('dist-single', { recursive: true });
const out = fragment ? 'dist-single/omnipath.fragment.html' : 'dist-single/omnipath.html';
await writeFile(out, html);
await rm(tmp, { recursive: true, force: true });
console.log(`wrote ${out} (${(html.length / 1024).toFixed(0)} KB, Phaser ${PHASER_VERSION} from CDN)`);
