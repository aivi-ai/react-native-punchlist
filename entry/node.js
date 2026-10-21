'use strict';

/** The `require` twin of ./index.js: CommonJS build output, same switch. */
/* eslint-disable @typescript-eslint/no-require-imports -- the switch must be a literal require() so bundlers fold it */
module.exports =
  process.env.NODE_ENV === 'production' ? require('./noop') : require('../lib/commonjs/full');
