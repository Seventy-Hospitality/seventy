import { AppState, type AppStateStatus } from 'react-native';
import { focusManager } from '@tanstack/react-query';

describe('queryClient focus', () => {
  it('treats the app coming to the foreground as focus, so stale queries refetch', () => {
    let onChange: ((status: AppStateStatus) => void) | undefined;
    const remove = jest.fn();
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, handler) => {
      onChange = handler as (status: AppStateStatus) => void;
      return { remove } as unknown as ReturnType<typeof AppState.addEventListener>;
    });

    // Loaded after the spy: the module wires the listener when it loads.
    const { queryClient } = jest.requireActual('../query-client') as typeof import('../query-client');
    expect(queryClient.getDefaultOptions().queries?.refetchOnWindowFocus).toBe(true);
    expect(onChange).toBeDefined();

    onChange?.('background');
    expect(focusManager.isFocused()).toBe(false);
    onChange?.('active');
    expect(focusManager.isFocused()).toBe(true);
  });
});
