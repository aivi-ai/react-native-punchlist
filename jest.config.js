/**
 * Two jest projects:
 *  - `logic`: pure TypeScript (no react-native import chain) in a plain node env,
 *             transformed with the repo's plain babel config.
 *  - `ui`:    react-native + @testing-library/react-native component tests,
 *             transformed with the React Native babel preset.
 */
module.exports = {
  projects: [
    {
      displayName: 'logic',
      testEnvironment: 'node',
      testMatch: ['<rootDir>/tests/logic/**/*.test.ts'],
      transform: { '^.+\\.(t|j)sx?$': 'babel-jest' },
    },
    {
      displayName: 'ui',
      preset: '@react-native/jest-preset',
      testMatch: ['<rootDir>/tests/ui/**/*.test.tsx'],
      setupFilesAfterEnv: ['<rootDir>/tests/ui/setup.ts'],
      transform: {
        '^.+\\.(js|jsx|ts|tsx)$': ['babel-jest', { configFile: false, presets: ['module:@react-native/babel-preset'] }],
      },
      transformIgnorePatterns: [
        'node_modules/(?!((jest-)?react-native|@react-native(-community)?|@testing-library/react-native)/)',
      ],
    },
  ],
};
