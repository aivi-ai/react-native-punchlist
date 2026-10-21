'use strict';

/**
 * Metro helper for react-native-punchlist (runs in Node at config time, never
 * bundled into an app).
 *
 * The package root is a build-time switch: dev bundles get the real tool,
 * production bundles get an inert stub. `includeInProduction` turns the stub
 * into the real tool for internal/preview builds by resolving the package
 * specifiers to their `/full` twins, so the app's own code never changes.
 */

const ENTRIES = {
  'react-native-punchlist': 'react-native-punchlist/full',
  'react-native-punchlist/expo-router': 'react-native-punchlist/expo-router/full',
};

/**
 * @param {import('metro-config').ConfigT | Record<string, any>} config
 * @param {{ includeInProduction?: boolean }} [options]
 */
function withPunchlist(config, options = {}) {
  if (options.includeInProduction !== true) return config;

  const previous = config.resolver && config.resolver.resolveRequest;
  const resolveRequest = (context, moduleName, platform) => {
    const target = Object.prototype.hasOwnProperty.call(ENTRIES, moduleName) ? ENTRIES[moduleName] : moduleName;
    return previous ? previous(context, target, platform) : context.resolveRequest(context, target, platform);
  };

  return { ...config, resolver: { ...config.resolver, resolveRequest } };
}

module.exports = { withPunchlist };
