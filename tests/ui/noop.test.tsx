import { render, screen } from '@testing-library/react-native';
import * as full from '../../src/full';
import { IDLE_SNAPSHOT } from '../../src/snapshot';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const noop = require('../../entry/noop.js') as typeof full;

describe('inert build parity with the real build', () => {
  it('exports exactly the same names', () => {
    expect(Object.keys(noop).sort()).toEqual(Object.keys(full).sort());
  });

  it('exports identical constants', () => {
    for (const name of Object.keys(full) as Array<keyof typeof full>) {
      const value = full[name];
      if (typeof value === 'function' || typeof value === 'object') continue;
      expect([name, noop[name]]).toEqual([name, value]);
    }
  });

  it('answers actions like an inactive punchlist', async () => {
    for (const name of ['open', 'close', 'toggle', 'show', 'hide', 'undo'] as const) {
      expect([name, noop.punchlist[name]()]).toEqual([name, full.punchlist[name]()]);
    }
    expect(noop.punchlist.append('x')).toBe(full.punchlist.append('x'));
    expect(noop.punchlist.addTask('x')).toBe(full.punchlist.addTask('x'));
    expect(noop.punchlist.setContent('x')).toBe(full.punchlist.setContent('x'));
    expect(await noop.punchlist.clear()).toBe(await full.punchlist.clear());
    for (const name of ['flush', 'send'] as const) {
      const real = await full.punchlist[name]().catch((error: unknown) => error);
      const inert = await noop.punchlist[name]().catch((error: unknown) => error);
      expect(full.isPunchlistError(inert)).toBe(true);
      expect(noop.isPunchlistError(inert)).toBe(true);
      expect(full.isPunchlistError(real)).toBe(true);
      expect((inert as { code: string }).code).toBe((real as { code: string }).code);
    }
  });

  it('reports the idle snapshot and the same hook shape', async () => {
    let inertHook: ReturnType<typeof noop.usePunchlist> | undefined;
    let realHook: ReturnType<typeof full.usePunchlist> | undefined;
    function Probe() {
      inertHook = noop.usePunchlist();
      realHook = full.usePunchlist();
      return null;
    }
    await render(<Probe />);
    expect(Object.keys(inertHook as object).sort()).toEqual(Object.keys(realHook as object).sort());
    expect({ ...inertHook, subscribe: undefined, getSnapshot: undefined }).toMatchObject({ ...IDLE_SNAPSHOT });
    expect(inertHook?.getSnapshot()).toMatchObject({ ...IDLE_SNAPSHOT });
    expect(typeof inertHook?.subscribe(() => undefined)).toBe('function');
  });

  it('PunchlistError carries code and status', () => {
    const error = new noop.PunchlistError('http', 'boom', 502);
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('PunchlistError');
    expect([error.code, error.status]).toEqual(['http', 502]);
  });

  it('renders nothing', async () => {
    const Inert = noop.Punchlist;
    await render(<Inert enabled />);
    expect(screen.queryByTestId('punchlist-root')).toBeNull();
  });
});
