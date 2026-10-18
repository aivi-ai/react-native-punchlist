/**
 * Two jest projects:
 *  - `logic`: pure TypeScript (no react-native import chain) in a plain node env.
 *  - `ui`:    react-native + @testing-library/react-native component tests.
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
      preset: 'react-native',
      testMatch: ['<rootDir>/tests/ui/**/*.test.tsx'],
      setupFilesAfterEnv: ['<rootDir>/tests/ui/setup.ts'],
      transformIgnorePatterns: [
        'node_modules/(?!(?:@react-native|react-native|@testing-library/react-native)/)',
      ],
    },
  ],
};
