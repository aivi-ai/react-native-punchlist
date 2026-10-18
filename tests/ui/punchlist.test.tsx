import { StrictMode, useEffect, useRef } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Punchlist } from '../../src/index';
import { usePunchlist } from '../../src/usePunchlist';
import type { PunchlistHandle, PunchlistStorage } from '../../src/types';

interface TestStorage extends PunchlistStorage {
  reads: number;
  writes: number;
  values: string[];
}

function memoryStorage(): TestStorage {
  const map = new Map<string, string>();
  const adapter: TestStorage = {
    reads: 0,
    writes: 0,
    values: [],
    async getItem(key: string) {
      adapter.reads += 1;
      return map.has(key) ? (map.get(key) as string) : null;
    },
    async setItem(key: string, value: string) {
      adapter.writes += 1;
      adapter.values.push(value);
      map.set(key, value);
    },
    async removeItem(key: string) {
      map.delete(key);
    },
  };
  return adapter;
}

const LAYOUT = { nativeEvent: { layout: { x: 0, y: 0, width: 390, height: 844 } } };

/** Resolve the root view's layout so the FAB becomes measurable. */
function layout(): void {
  fireEvent(screen.getByTestId('punchlist-root'), 'layout', LAYOUT);
}

const editorValue = (): string => String(screen.getByLabelText('Punch list notes').props.value);

describe('<Punchlist />', () => {
  it('renders nothing and touches no storage while disabled', async () => {
    const storage = memoryStorage();
    await render(<Punchlist enabled={false} appId="disabled-case" storage={storage} />);
    expect(screen.queryByTestId('punchlist-root')).toBeNull();
    expect(screen.queryByLabelText(/^Open punch list/)).toBeNull();
    expect(storage.reads).toBe(0);
    expect(storage.writes).toBe(0);
  });

  it('opens the sheet from the FAB with the screen prefilled, persists and reopens', async () => {
    const storage = memoryStorage();
    await render(
      <Punchlist enabled appId="round-trip" storage={storage} getContext={() => ({ screen: 'Checkout' })} />,
    );
    layout();
    fireEvent.press(await screen.findByLabelText(/^Open punch list/));

    await screen.findByLabelText('Punch list notes');
    await waitFor(() => expect(editorValue()).toBe('- [ ] Checkout: '));

    fireEvent.changeText(screen.getByLabelText('Punch list notes'), '- [ ] Checkout: fix the copy');
    await waitFor(() => expect(editorValue()).toBe('- [ ] Checkout: fix the copy'));
    // Debounced durable write (400ms) lands without any explicit flush.
    await waitFor(() => expect(storage.values.join('|')).toContain('fix the copy'));

    fireEvent.press(screen.getByLabelText('Close punch list'));
    await waitFor(() => expect(screen.queryByLabelText('Punch list notes')).toBeNull());
    await screen.unmount();

    await render(
      <Punchlist enabled appId="round-trip" storage={storage} getContext={() => ({ screen: 'Checkout' })} />,
    );
    layout();
    await waitFor(() => expect(storage.reads).toBeGreaterThan(1));
    fireEvent.press(await screen.findByLabelText(/^Open punch list/));
    await waitFor(() => expect(editorValue()).toContain('fix the copy'));
  });

  it('survives StrictMode double-mounting with a single owner', async () => {
    const storage = memoryStorage();
    await render(
      <StrictMode>
        <Punchlist enabled appId="strict-mode" storage={storage} />
      </StrictMode>,
    );
    layout();
    const fabs = await screen.findAllByLabelText(/^Open punch list/);
    expect(fabs).toHaveLength(1);
    fireEvent.press(fabs[0]);
    expect(await screen.findByLabelText('Punch list notes')).toBeTruthy();
  });

  it('renders nothing for a second enabled mount and warns once', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const storage = memoryStorage();
    await render(
      <>
        <Punchlist enabled appId="primary" storage={storage} />
        <Punchlist enabled appId="secondary" storage={memoryStorage()} />
      </>,
    );
    expect(screen.getAllByTestId('punchlist-root')).toHaveLength(1);
    layout();
    await waitFor(() => expect(screen.findAllByLabelText(/^Open punch list/)).resolves.toHaveLength(1));
    expect(warn.mock.calls.filter((call) => String(call[0]).includes('second enabled'))).toHaveLength(1);
    warn.mockRestore();
  });

  it('observing the hook does not activate anything', async () => {
    const storage = memoryStorage();

    function Observer() {
      usePunchlist();
      return null;
    }

    await render(
      <>
        <Observer />
        <Punchlist enabled={false} appId="observer" storage={storage} />
      </>,
    );
    expect(storage.reads).toBe(0);
  });

  it('hides the FAB on long-press and restores it through the imperative handle', async () => {
    const storage = memoryStorage();
    const handle: { current: PunchlistHandle | null } = { current: null };

    function Harness() {
      const ref = useRef<PunchlistHandle>(null);
      useEffect(() => {
        handle.current = ref.current;
      });
      return <Punchlist ref={ref} enabled appId="hide-case" storage={storage} />;
    }

    await render(<Harness />);
    layout();
    fireEvent(await screen.findByLabelText(/^Open punch list/), 'longPress');
    await waitFor(() => expect(screen.queryByLabelText(/^Open punch list/)).toBeNull());
    expect(screen.getByText(/hidden for this launch/)).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Restore punch list'));
    expect(await screen.findByLabelText(/^Open punch list/)).toBeTruthy();
  });
});
