import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

let mockSegments: string[] = ['(tabs)', 'orders'];
let mockTheme: unknown = undefined;
let mockThrow = false;

jest.mock(
  'expo-router',
  () => ({
    useSegments: () => mockSegments,
    useTheme: () => {
      if (mockThrow) throw new Error("Couldn't find a theme.");
      return mockTheme;
    },
  }),
  { virtual: true },
);
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 59, right: 0, bottom: 34, left: 0 }) }), {
  virtual: true,
});

import * as adapter from '../../src/adapters/expo-router';

const { PunchlistForExpoRouter, screenNameForSegments } = adapter;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const inert = require('../../entry/expo-router.noop.js') as typeof adapter;

const LAYOUT = { nativeEvent: { layout: { x: 0, y: 0, width: 390, height: 844 } } };
const SCREENS = {
  index: 'HomeScreen',
  '(tabs)/orders': 'OrdersListScreen',
  'orders/[id]': 'OrderDetailScreen',
};

describe('screenNameForSegments', () => {
  it('prefers the full route, then prefixes, then group-less routes, then the leaf', () => {
    expect(screenNameForSegments(['(tabs)', 'orders'], SCREENS)).toBe('OrdersListScreen');
    expect(screenNameForSegments(['orders', '[id]'], SCREENS)).toBe('OrderDetailScreen');
    expect(screenNameForSegments(['orders', '[id]', 'tracking'], SCREENS)).toBe('OrderDetailScreen');
    expect(screenNameForSegments(['(app)', 'orders', '[id]'], SCREENS)).toBe('OrderDetailScreen');
    expect(screenNameForSegments(['settings'], SCREENS)).toBe('Settings');
    expect(screenNameForSegments([], SCREENS)).toBe('HomeScreen');
    expect(screenNameForSegments([])).toBe('UnknownScreen');
  });
});

describe('<PunchlistForExpoRouter />', () => {
  beforeEach(() => {
    mockSegments = ['(tabs)', 'orders'];
    mockTheme = undefined;
    mockThrow = false;
  });

  async function openSheet() {
    fireEvent(screen.getByTestId('punchlist-root'), 'layout', LAYOUT);
    fireEvent.press(await screen.findByLabelText(/^Open punch list/));
    return screen.findByLabelText('Punch list notes');
  }

  it('prefills the screen from the router segments with no host glue', async () => {
    await render(<PunchlistForExpoRouter enabled appId="expo-router-a" screens={SCREENS} />);
    await openSheet();
    await waitFor(() => expect(String(screen.getByLabelText('Punch list notes').props.value)).toBe('- [ ] OrdersListScreen: '));
  });

  it('merges host context over the route label', async () => {
    await render(<PunchlistForExpoRouter enabled appId="expo-router-b" screens={SCREENS} getContext={() => ({ component: 'OrderRow' })} />);
    await openSheet();
    await waitFor(() => expect(String(screen.getByLabelText('Punch list notes').props.value)).toBe('- [ ] OrderRow: '));
  });

  it('adopts the router theme unless the host passes one', async () => {
    mockTheme = {
      dark: true,
      colors: { primary: 'rgb(10, 132, 255)', background: 'rgb(1, 1, 1)', card: 'rgb(18, 18, 18)', text: 'rgb(229, 229, 231)', border: 'rgb(39, 39, 41)' },
    };
    const view = await render(<PunchlistForExpoRouter enabled appId="expo-router-c" />);
    let editor = await openSheet();
    expect(StyleSheet.flatten(editor.props.style).color).toBe('rgb(229, 229, 231)');

    await view.rerender(<PunchlistForExpoRouter enabled appId="expo-router-c" theme="light" />);
    editor = await screen.findByLabelText('Punch list notes');
    expect(StyleSheet.flatten(editor.props.style).color).toBe('#111114');
  });

  it('falls back to its own scheme when there is no theme provider', async () => {
    mockThrow = true;
    await render(<PunchlistForExpoRouter enabled appId="expo-router-d" />);
    const editor = await openSheet();
    expect(StyleSheet.flatten(editor.props.style).color).toBe('#111114');
  });

  it('renders nothing while disabled', async () => {
    await render(<PunchlistForExpoRouter enabled={false} appId="expo-router-e" />);
    expect(screen.queryByTestId('punchlist-root')).toBeNull();
  });
});

describe('inert Expo Router twin', () => {
  it('exports the same names and renders nothing', async () => {
    expect(Object.keys(inert).sort()).toEqual(Object.keys(adapter).sort());
    const Inert = inert.PunchlistForExpoRouter;
    await render(<Inert enabled />);
    expect(screen.queryByTestId('punchlist-root')).toBeNull();
  });
});
