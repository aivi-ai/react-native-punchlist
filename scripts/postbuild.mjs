/**
 * Adds the `#platform` import map to the generated `lib/{module,commonjs}/package.json`.
 *
 * Package `imports` are scoped to the *nearest* package.json, and
 * react-native-builder-bob writes a tiny one into each output directory, so the
 * map has to live there. `#platform` picks the web or native platform layer by
 * export condition (`browser` → web) instead of by file extension, which only
 * Metro understands — strict-ESM bundlers (webpack 5) reject the extensionless
 * `./platform` directory import that the extension approach needs.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

for (const target of ['module', 'commonjs']) {
  const file = join(root, 'lib', target, 'package.json');
  const manifest = JSON.parse(readFileSync(file, 'utf8'));
  manifest.imports = {
    '#platform': { browser: './platform/index.web.js', default: './platform/index.js' },
  };
  writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`);
}
console.log('postbuild: wrote #platform import maps');
