// eslint-disable-next-line @typescript-eslint/no-require-imports
const { withPunchlist } = require('../../metro/index.js') as {
  withPunchlist: (config: Record<string, unknown>, options?: { includeInProduction?: boolean }) => Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
};

const context = (log: string[]) => ({
  resolveRequest: (_ctx: unknown, name: string) => {
    log.push(`default:${name}`);
    return { type: 'sourceFile', filePath: `/${name}` };
  },
});

describe('withPunchlist', () => {
  it('returns the config untouched unless production inclusion is requested', () => {
    const config = { resolver: { sourceExts: ['ts'] } };
    expect(withPunchlist(config)).toBe(config);
    expect(withPunchlist(config, {})).toBe(config);
    expect(withPunchlist(config, { includeInProduction: false })).toBe(config);
  });

  it('resolves only the package specifiers to their /full twins', () => {
    const log: string[] = [];
    const wrapped = withPunchlist({ resolver: { sourceExts: ['ts'] } }, { includeInProduction: true });
    expect(wrapped.resolver.sourceExts).toEqual(['ts']);
    const resolve = wrapped.resolver.resolveRequest;
    resolve(context(log), 'react-native-punchlist', 'ios');
    resolve(context(log), 'react-native-punchlist/expo-router', 'ios');
    resolve(context(log), 'react-native-punchlist/full', 'ios');
    resolve(context(log), 'react-native', 'ios');
    resolve(context(log), 'toString', 'ios');
    expect(log).toEqual([
      'default:react-native-punchlist/full',
      'default:react-native-punchlist/expo-router/full',
      'default:react-native-punchlist/full',
      'default:react-native',
      'default:toString',
    ]);
  });

  it('chains to a resolver that was already configured', () => {
    const seen: string[] = [];
    const previous = (_ctx: unknown, name: string, platform: string) => {
      seen.push(`${name}@${platform}`);
      return { type: 'empty' };
    };
    const wrapped = withPunchlist({ resolver: { resolveRequest: previous } }, { includeInProduction: true });
    const result = wrapped.resolver.resolveRequest({}, 'react-native-punchlist', 'android');
    expect(result).toEqual({ type: 'empty' });
    expect(seen).toEqual(['react-native-punchlist/full@android']);
  });

  it('works when the config has no resolver yet', () => {
    const wrapped = withPunchlist({}, { includeInProduction: true });
    expect(typeof wrapped.resolver.resolveRequest).toBe('function');
  });
});
