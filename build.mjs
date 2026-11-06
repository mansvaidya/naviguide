// Build Door to Ride.
//
//   node examples/door-to-ride/build.mjs
//
// Writes, from src/page.html:
//   index.html          the dev page: loads src/main.js as an ES module, no
//                       bundling (serve the REPOSITORY ROOT, since it imports
//                       ../../../toolkit and ../../../controller)
//   dist/index.html     one self-contained file: host it anywhere over HTTPS
//                       (location, compass and the microphone need HTTPS)
//   dist/artifact.html  the same page without the document skeleton, for
//                       publishing as a claude.ai artifact
//
// Uses the repository's esbuild dev dependency (`npm ci` at the root).

import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = (f) => path.join(here, 'src', f);

const page = await readFile(src('page.html'), 'utf8');
const css = await readFile(src('styles.css'), 'utf8');

const bundle = await build({
  entryPoints: [src('main.js')],
  bundle: true,
  format: 'esm',
  target: ['es2020', 'safari15'],
  minify: true,
  write: false,
  legalComments: 'none',
});
const js = bundle.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');

// Function replacers: the bundle contains $ sequences String.replace would expand.
const fill = (style, script) => page.replace('{{STYLE}}', () => style).replace('{{SCRIPT}}', () => script);
const skeleton = (body) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#15171a">
</head>
<body>
${body}
</body>
</html>
`;

const inline = fill(`<style>\n${css}</style>`, `<script type="module">\n${js}</script>`);
await mkdir(path.join(here, 'dist'), { recursive: true });
await writeFile(path.join(here, 'dist', 'artifact.html'), inline);
await writeFile(path.join(here, 'dist', 'index.html'), skeleton(inline));
await writeFile(
  path.join(here, 'index.html'),
  skeleton(fill('<link rel="stylesheet" href="src/styles.css">', '<script type="module" src="src/main.js"></script>')),
);
console.log(`built: index.html, dist/index.html (${Math.round(inline.length / 1024)} KB), dist/artifact.html`);
