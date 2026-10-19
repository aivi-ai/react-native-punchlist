/**
 * Proves a consumer resolves the PUBLISHED outputs, never unpublished source:
 * prints the CJS and ESM entry resolutions and fails if either points at `src/`.
 */
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

const require = createRequire(import.meta.url);
const cjsEntry = require.resolve('react-native-punchlist');
const pkgPath = require.resolve('react-native-punchlist/package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
const packageRoot = dirname(pkgPath);

const esmEntry = pathToFileURL(resolve(packageRoot, pkg.exports['.'].import.default)).href;
const nativeEntry = resolve(packageRoot, pkg.exports['.']['react-native'].default);
const typesEntry = resolve(packageRoot, pkg.exports['.'].import.types);

const report = { cjsEntry, esmEntry, nativeEntry, typesEntry, packageRoot };
console.log(JSON.stringify(report, null, 2));

const offenders = [cjsEntry, esmEntry, nativeEntry, typesEntry].filter((entry) => /[/\\]src[/\\]/.test(entry));
if (offenders.length > 0) {
  console.error('FAIL: a consumer resolved unpublished source:', offenders);
  process.exit(1);
}
if (!/[/\\]lib[/\\](commonjs|module|typescript)[/\\]/.test(cjsEntry)) {
  console.error('FAIL: the CJS entry is not a published build output:', cjsEntry);
  process.exit(1);
}
if (pkg.dependencies && Object.keys(pkg.dependencies).length > 0) {
  console.error('FAIL: the published package declares runtime dependencies:', pkg.dependencies);
  process.exit(1);
}
console.log('OK: entries resolve to published outputs and dependencies is empty.');
