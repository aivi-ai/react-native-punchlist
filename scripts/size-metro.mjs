/**
 * Measures what a host actually bundles, using Metro on the *packed* tarball:
 *
 *   dev            → real implementation
 *   prod           → inert stub only; hard gate ≤ 1 KiB contributed by the package
 *   prod-included  → real implementation via `withPunchlist({ includeInProduction })`,
 *                    exactly one instance even when `/full` is imported as well
 *
 * Command: `npm run build && npm run size:metro`
 */
import { bundleDetailed, cleanup } from './metro-bundle.mjs';

const PROD_BUDGET = 1024;
const FULL = 'Punch list notes'; // a string only the real sheet contains
const INERT = 'Not in this build.'; // a string only the stub contains
const SINGLETON = 'second enabled <Punchlist />'; // appears once per copy of the real controller

const failures = [];
const check = (ok, message) => {
  if (!ok) failures.push(message);
};
const count = (haystack, needle) => haystack.split(needle).length - 1;

try {
  const base = await bundleDetailed('prod', { withPackage: false });
  const dev = await bundleDetailed('dev');
  const prod = await bundleDetailed('prod');
  const ADAPTER = "\nimport { PunchlistForExpoRouter } from 'react-native-punchlist/expo-router';\nvoid PunchlistForExpoRouter;\n";
  const included = await bundleDetailed('prod-included', {
    extraSource: "\nimport { punchlist as second } from 'react-native-punchlist/full';\nsecond.addTask('twice');\n" + ADAPTER,
  });
  const prodAdapter = await bundleDetailed('prod', { extraSource: ADAPTER });
  const devAdapter = await bundleDetailed('dev', { extraSource: ADAPTER });

  const row = (name, result, note = '') =>
    console.log(`${name.padEnd(15)} ${String(result.code.length).padStart(9)} B  package ${String(result.packageBytes).padStart(7)} B in ${result.packageModules} modules ${note}`);
  console.log(`baseline        ${String(base.code.length).padStart(9)} B  (same app, package not imported)`);
  row('dev', dev);
  row('prod', prod, `(budget ${PROD_BUDGET} B)`);
  row('prod-included', included);

  check(devAdapter.code.includes('STUB-EXPO-ROUTER'), 'dev bundle is missing the Expo Router adapter');
  check(!prodAdapter.code.includes('STUB-EXPO-ROUTER'), 'production bundle contains the Expo Router adapter');
  check(!prodAdapter.code.includes('STUB-SAFE-AREA'), 'production bundle pulls in the adapter peer react-native-safe-area-context');
  check(included.code.includes('STUB-EXPO-ROUTER'), 'includeInProduction did not bring in the Expo Router adapter');
  check(
    prodAdapter.packageBytes <= PROD_BUDGET + 300,
    `production bundle: package + adapter twin contribute ${prodAdapter.packageBytes} B`,
  );
  check(dev.code.includes(FULL), 'dev bundle is missing the real implementation');
  check(!prod.code.includes(FULL), 'production bundle contains the real implementation');
  check(prod.code.includes(INERT), 'production bundle is missing the inert stub');
  check(prod.packageBytes <= PROD_BUDGET, `production bundle: package contributes ${prod.packageBytes} B (> ${PROD_BUDGET} B)`);
  check(included.code.includes(FULL), 'includeInProduction did not bring in the real implementation');
  check(!included.code.includes(INERT), 'includeInProduction still bundled the stub');
  check(count(included.code, SINGLETON) === 1, `expected exactly one controller instance, found ${count(included.code, SINGLETON)}`);
} finally {
  cleanup();
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL: ${failure}`);
  process.exit(1);
}
console.log('OK: production excludes the implementation; includeInProduction yields a single instance.');
