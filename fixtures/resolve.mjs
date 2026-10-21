/**
 * Shared by every consumer fixture. Proves a consumer resolves the PUBLISHED
 * outputs, never unpublished source, and that the production switch behaves:
 *
 *  - every subpath resolves inside the installed package and never into `src/`;
 *  - `NODE_ENV=production` loads the inert build (no react-native needed);
 *  - the dependency list is empty.
 */
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const require = createRequire(`${process.cwd()}/`);
const pkgPath = require.resolve('react-native-punchlist/package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
const root = dirname(pkgPath);
const failures = [];
const fail = (message) => failures.push(message);

const resolved = {};
for (const subpath of ['.', './full', './noop', './testing', './metro']) {
  const specifier = subpath === '.' ? 'react-native-punchlist' : `react-native-punchlist/${subpath.slice(2)}`;
  try {
    resolved[specifier] = require.resolve(specifier);
  } catch (error) {
    fail(`cannot resolve ${specifier}: ${error.message}`);
  }
}
for (const [specifier, file] of Object.entries(resolved)) {
  if (/[/\\]src[/\\]/.test(file)) fail(`${specifier} resolved to unpublished source: ${file}`);
  if (!file.startsWith(root)) fail(`${specifier} resolved outside the package: ${file}`);
}

// Every declared export target must exist in the tarball.
const targets = [];
(function walk(value) {
  if (typeof value === 'string') targets.push(value);
  else if (value && typeof value === 'object') Object.values(value).forEach(walk);
})(pkg.exports);
for (const target of new Set(targets)) {
  if (target.startsWith('./') && !existsSync(resolve(root, target))) fail(`exports points at a missing file: ${target}`);
}

if (pkg.dependencies && Object.keys(pkg.dependencies).length > 0) fail(`runtime dependencies are not empty: ${JSON.stringify(pkg.dependencies)}`);

// The inert build is plain CommonJS with no peers: it must load and behave in bare Node.
const probe = `
  const m = require('react-native-punchlist');
  const ok = m.Punchlist() === null && m.punchlist.open() === false && m.usePunchlist().content === '' && m.DEFAULT_ENDPOINT === false;
  m.punchlist.send().then(() => process.exit(2), (e) => process.exit(ok && m.isPunchlistError(e) && e.code === 'inactive' ? 0 : 3));
`;
try {
  execFileSync(process.execPath, ['-e', probe], { env: { ...process.env, NODE_ENV: 'production' }, stdio: 'pipe' });
} catch (error) {
  fail(`NODE_ENV=production did not load the inert build (exit ${error.status}): ${String(error.stderr).slice(0, 300)}`);
}

console.log(JSON.stringify({ root, resolved }, null, 2));
if (failures.length > 0) {
  for (const message of failures) console.error(`FAIL: ${message}`);
  process.exit(1);
}
console.log('OK: subpaths resolve to published outputs, export targets exist, dependencies are empty, production loads the inert build.');
