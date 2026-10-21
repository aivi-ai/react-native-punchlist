/**
 * Builds a tiny React Native app against the *packed* tarball with Metro, so we
 * measure exactly what a host bundles (dev, production, production with
 * `includeInProduction`).
 *
 * Exports `bundleApp(mode)`; run directly for a one-line report.
 *   modes: 'dev' | 'prod' | 'prod-included'
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, rmSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

let workspace = null;

/** Pack the package and extract it into <workspace>/node_modules (once per process). */
function prepare() {
  if (workspace) return workspace;
  // Inside the repo (gitignored `build/`) so Metro can watch the root node_modules.
  mkdirSync(join(root, 'build'), { recursive: true });
  const dir = realpathSync(mkdtempSync(join(root, 'build', 'metro-')));
  const packOut = join(dir, 'pack');
  mkdirSync(packOut);
  execFileSync('npm', ['pack', '--pack-destination', packOut, '--silent'], { cwd: root, stdio: 'pipe' });
  const tarball = join(packOut, readdirSync(packOut).find((name) => name.endsWith('.tgz')));
  const modules = join(dir, 'node_modules', 'react-native-punchlist');
  mkdirSync(modules, { recursive: true });
  execFileSync('tar', ['-xzf', tarball, '-C', modules, '--strip-components=1']);
  // react-native's bundled images need a registry module; a stub is enough for measuring.
  writeFileSync(join(dir, 'asset-registry.js'), 'module.exports = { registerAsset: () => 1, getAssetByID: () => null };\n');
  writeFileSync(
    join(dir, 'babel.config.js'),
    "module.exports = { presets: [require.resolve('@react-native/babel-preset', { paths: [" +
      JSON.stringify(root) +
      '] })] };\n',
  );
  // Stand-ins for the optional peers of `react-native-punchlist/expo-router`; the marker
  // string shows up in a bundle only when the real adapter (which imports them) is in it.
  const stubs = {
    'expo-router': "module.exports = { useSegments: () => [], useTheme: undefined, MARKER: 'STUB-EXPO-ROUTER' };\n",
    'react-native-safe-area-context':
      "module.exports = { useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }), MARKER: 'STUB-SAFE-AREA' };\n",
  };
  for (const [name, source] of Object.entries(stubs)) {
    mkdirSync(join(dir, 'node_modules', name), { recursive: true });
    writeFileSync(join(dir, 'node_modules', name, 'package.json'), JSON.stringify({ name, version: '0.0.0', main: 'index.js' }));
    writeFileSync(join(dir, 'node_modules', name, 'index.js'), source);
  }
  workspace = dir;
  return dir;
}

export function cleanup() {
  if (workspace) rmSync(workspace, { recursive: true, force: true });
  workspace = null;
}

const APP_WITH = `
import { AppRegistry, View } from 'react-native';
import { Punchlist, usePunchlist, punchlist } from 'react-native-punchlist';
function App() {
  const snapshot = usePunchlist();
  return <View testID={String(snapshot.revision)}><Punchlist enabled={__DEV__} /></View>;
}
punchlist.addTask('boot');
AppRegistry.registerComponent('app', () => App);
`;

const APP_WITHOUT = `
import { AppRegistry, View } from 'react-native';
function App() {
  return <View testID="0" />;
}
AppRegistry.registerComponent('app', () => App);
`;

/** Optional extra source appended to the entry (e.g. a second import path). */
export async function bundleApp(mode, options = {}) {
  return (await bundleDetailed(mode, options)).code;
}

/** Like `bundleApp`, plus the bytes of every module that lives inside this package. */
export async function bundleDetailed(mode, { extraSource = '', withPackage = true, platform = 'ios' } = {}) {
  const dir = prepare();
  const entryFile = join(dir, 'index.js');
  writeFileSync(entryFile, (withPackage ? APP_WITH : APP_WITHOUT) + extraSource);
  const Metro = require('metro');
  const { withPunchlist } = require(join(dir, 'node_modules', 'react-native-punchlist', 'metro'));
  const dev = mode === 'dev';

  const defaults = await Metro.loadConfig({ cwd: dir }, {});
  const ids = new Map();
  const base = {
    ...defaults,
    projectRoot: dir,
    watchFolders: [dir, join(root, 'node_modules')],
    resetCache: true,
    resolver: {
      ...defaults.resolver,
      nodeModulesPaths: [join(dir, 'node_modules'), join(root, 'node_modules')],
    },
    transformer: {
      ...defaults.transformer,
      babelTransformerPath: require.resolve('metro-babel-transformer'),
      unstable_transformProfile: 'hermes-stable',
      assetRegistryPath: join(dir, 'asset-registry.js'),
    },
    serializer: {
      ...defaults.serializer,
      createModuleIdFactory: () => (path) => {
        if (!ids.has(path)) ids.set(path, ids.size);
        return ids.get(path);
      },
    },
    reporter: { update() {} },
    cacheStores: [],
    maxWorkers: 1,
    watcher: { ...defaults.watcher, watchman: { deferStates: [] }, unstable_workerThreads: false },
  };
  const config = withPunchlist(base, { includeInProduction: mode === 'prod-included' });
  const result = await Metro.runBuild(config, {
    entry: entryFile,
    platform,
    dev,
    minify: !dev,
    sourceMap: false,
  });
  const packageIds = new Set(
    [...ids].filter(([path]) => path.startsWith(join(dir, 'node_modules', 'react-native-punchlist'))).map(([, id]) => id),
  );
  const packageModules = result.code
    .split(/\n(?=__d\()/)
    .filter((segment) => {
      const match = /\},(\d+)(?:,\s*\[[\d,\s]*\])?(?:,\s*"[^"]*")?\);?\s*$/.exec(segment.replace(/__r\(\d+\);\s*$/, ''));
      return match !== null && packageIds.has(Number(match[1]));
    });
  const packageBytes = packageModules.reduce((sum, segment) => sum + segment.length, 0);
  return { code: result.code, packageBytes, packageModules: packageModules.length };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const base = (await bundleApp('prod', { withPackage: false })).length;
    console.log(`${'baseline'.padEnd(14)} ${String(base).padStart(9)} B   (same app, package not imported)`);
    for (const mode of ['dev', 'prod', 'prod-included']) {
      const { code, packageBytes, packageModules } = await bundleDetailed(mode);
      console.log(`${mode.padEnd(14)} ${String(code.length).padStart(9)} B   package: ${packageBytes} B in ${packageModules} modules`);
    }
  } finally {
    cleanup();
  }
}
