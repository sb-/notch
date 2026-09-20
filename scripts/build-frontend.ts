import { cp, mkdir, rm } from 'node:fs/promises';
import { basename, resolve } from 'node:path';

// Build the JS entry explicitly. Bun 1.3's HTML splitting can point index.html
// at a provider's index.js chunk instead of the application entry.
const outdir = resolve(process.env.NOTCH_BUILD_DIR || 'dist');
// Avoid shipping stale hashed chunks from earlier builds. Only clean the known
// generated directory; a custom output path may contain unrelated files.
if (outdir === resolve('dist')) await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });
const result = await Bun.build({
  entrypoints: ['./src/main.tsx'],
  outdir,
  target: 'browser',
  minify: true,
  splitting: true,
  naming: { entry: '[name]-[hash].[ext]', chunk: 'chunk-[hash].[ext]', asset: '[name]-[hash].[ext]' },
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
});
if (!result.success) throw new AggregateError(result.logs, 'Frontend build failed');
const entries = result.outputs.filter(file => file.kind === 'entry-point' && file.path.endsWith('.js'));
if (entries.length !== 1) throw new Error(`Expected one app entry, got ${entries.length}`);
const styles = result.outputs.filter(file => file.path.endsWith('.css'));
const template = await Bun.file('./src/index.html').text();
const html = template.replace('src="./main.tsx"', `src="./${basename(entries[0]!.path)}"`)
  .replace('</head>', `${styles.map(file => `    <link rel="stylesheet" href="./${basename(file.path)}">`).join('\n')}\n  </head>`);
await Bun.write(`${outdir}/index.html`, html);
await cp('node_modules/monaco-editor/min/vs', `${outdir}/monaco/vs`, { recursive: true });
if (!html.includes(basename(entries[0]!.path)) || !await Bun.file(entries[0]!.path).exists()) {
  throw new Error('App entry missing from generated HTML');
}
console.log(`Built ${result.outputs.length} assets; index.html loads ${basename(entries[0]!.path)}. Monaco is bundled locally.`);
