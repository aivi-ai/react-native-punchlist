'use strict';

/** Build-time switch for the Expo Router adapter; see ./index.js. */
/* eslint-disable @typescript-eslint/no-require-imports -- the switch must be a literal require() so bundlers fold it */
module.exports =
  process.env.NODE_ENV === 'production'
    ? require('./expo-router.noop')
    : require('../lib/module/adapters/expo-router');
