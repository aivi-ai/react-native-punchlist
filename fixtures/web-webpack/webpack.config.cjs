/**
 * Plain webpack 5 (strict ESM resolution, no Babel) + react-native-web.
 * `--env include` opts the production build back in the documented way: alias the
 * package to its `/full` build.
 */
module.exports = (env) => ({
  entry: './src/index.js',
  target: 'web',
  devtool: false,
  resolve: {
    // Platform split: the package ships `platform/index.js` and `platform/index.web.js`.
    extensions: ['.web.js', '.js'],
    alias: {
      'react-native$': 'react-native-web',
      ...(env && env.include ? { 'react-native-punchlist$': 'react-native-punchlist/full' } : {}),
    },
  },
  performance: { hints: false },
});
