import { readFileSync } from 'node:fs';

const FULL = 'Punch list notes';
const INERT = 'Not in this build.';
const read = (name) => readFileSync(new URL(`./dist/${name}/main.js`, import.meta.url), 'utf8');
const failures = [];
const expect = (ok, message) => ok || failures.push(message);

const dev = read('dev');
const prod = read('prod');
const included = read('included');
expect(dev.includes(FULL), 'development build is missing the real implementation');
// `#platform` picks the web layer through the `browser` condition (no Metro file extensions here).
expect(dev.includes('visibilitychange'), 'development build did not pick the web platform layer');
expect(!dev.includes('Clear punch list'), 'development build bundled the native platform layer');
expect(!prod.includes(FULL), 'production build contains the real implementation');
expect(prod.includes(INERT), 'production build is missing the inert stub');
expect(included.includes(FULL), 'aliasing to /full did not bring the implementation back');
expect(!included.includes(INERT), 'aliasing to /full still bundled the stub');

if (failures.length > 0) {
  for (const message of failures) console.error(`FAIL: ${message}`);
  process.exit(1);
}
console.log('OK: webpack 5 + react-native-web resolves the package; production excludes it; /full opts in.');
