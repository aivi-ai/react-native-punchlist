'use strict';

/**
 * Build-time switch for bundlers (Metro, webpack, Vite, …). Dead-code
 * elimination of `process.env.NODE_ENV` removes the branch that is not taken
 * *before* dependencies are collected, so production bundles only contain the
 * inert `noop` build. Apps opt back in with `react-native-punchlist/metro`.
 */
/* eslint-disable @typescript-eslint/no-require-imports -- the switch must be a literal require() so bundlers fold it */
module.exports =
  process.env.NODE_ENV === 'production' ? require('./noop') : require('../lib/module/full');
