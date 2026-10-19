/**
 * Shared setup for the `ui` jest project (react-native + RNTL).
 * RNTL v14 ships the jest matchers under `dist/matchers/extend-expect`.
 */
import '@testing-library/react-native/dist/matchers/extend-expect';

jest.setTimeout(20_000);
