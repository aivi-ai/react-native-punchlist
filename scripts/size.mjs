/**
 * Measures the published client bundle.
 *
 * Command: `npm run size` (after `npm run build`)
 * Tool: esbuild (dev-only) bundling `lib/module/index.js` with `react` and
 * `react-native` marked external, minified, uncompressed + gzip.
 */
import { gzipSync } from 'node:zlib';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { build } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const entry = resolve(root, 'lib/module/index.js');

if (!existsSync(entry)) {
  console.error('lib/module/index.js is missing — run `npm run build` first.');
  process.exit(1);
}

const result = await build({
  entryPoints: [entry],
  bundle: true,
  minify: true,
  write: false,
  format: 'esm',
  platform: 'neutral',
  target: 'es2020',
  conditions: ['import', 'module', 'default'],
  mainFields: ['module', 'main'],
  external: ['react', 'react-native', 'react/jsx-runtime'],
  legalComments: 'none',
});

const [output] = result.outputFiles;
const minified = output.contents;
const gzipped = gzipSync(minified, { level: 9 });
const limit = 40 * 1024;

const kib = (bytes) => `${(bytes / 1024).toFixed(2)} KiB`;

console.log('react-native-punchlist — core bundle size');
console.log(`entry            : lib/module/index.js (external: react, react-native)`);
console.log(`minified         : ${minified.length} bytes (${kib(minified.length)})`);
console.log(`minified + gzip  : ${gzipped.length} bytes (${kib(gzipped.length)})`);
console.log(`target           : ≤40 KiB (${limit} bytes)`);
console.log(`result           : ${minified.length <= limit ? 'PASS' : 'FAIL — over budget'}`);
console.log(`esbuild version  : ${JSON.stringify(JSON.parse(readFileSync(resolve(root, 'node_modules/esbuild/package.json'), 'utf8')).version)}`);

if (minified.length > limit) process.exitCode = 1;
