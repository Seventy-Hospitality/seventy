import { createSessionStore, MIN_REFRESH_INTERVAL_S, REFRESH_MARGIN_S, SESSION_STORAGE_KEY } from '../auth-session';
import { makeAuthSession, ME_ID } from '../clutch/fixtures';
import { clutchError, networkError } from '../clutch/testing';

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    map,
    getItem: jest.fn(async (k: string) => map.get(k) ?? null),
    setItem: jest.fn(async (k: string, v: string) => {
      map.set(k, v);
    }),
    removeItem: jest.fn(async (k: string) => {
      map.delete(k);
    }),
  };
}

const NOW = 1_000_000;

function setup(stored?: object) {
  const storage = memoryStorage();
  if (stored) storage.map.set(SESSION_STORAGE_KEY, JSON.stringify(stored));
  let now = NOW;
  const store = createSessionStore({ storage, now: () => now });
  const events: string[] = [];
  store.subscribe((event) => events.push(event));
  return { store, storage, events, advance: (s: number) => (now += s) };
}

const fresh = { access_token: 'a1', refresh_token: 'r1', expires_at: NOW + 3600, user: { id: ME_ID, email: 'alex@example.com' } };

describe('session store', () => {
  it('restores the stored session and hands out its token while it is fresh', async () => {
    const { store } = setup(fresh);
    expect(await store.getAccessToken()).toBe('a1');
  });

  it('reads a missing or corrupt value as signed out', async () => {
    const { store, storage } = setup();
    storage.map.set(SESSION_STORAGE_KEY, '{nope');
    expect(await store.getAccessToken()).toBeNull();
  });

  it('adopts a session Clutch issued, with an absolute expiry, and persists it', async () => {
    const { store, storage, events } = setup();
    await store.set(makeAuthSession({ expires_at: undefined, expires_in: 3600 }));
    expect(store.current()).toMatchObject({ access_token: 'access-1', expires_at: NOW + 3600, user: { id: ME_ID } });
    expect(JSON.parse(storage.map.get(SESSION_STORAGE_KEY)!)).toMatchObject({ refresh_token: 'refresh-1' });
    expect(events).toEqual(['SIGNED_IN']);
  });

  it('names the user from the token when Clutch answers no user', async () => {
    const payload = Buffer.from(JSON.stringify({ sub: 'u-jwt', email: 'j@x.com' })).toString('base64url');
    const { store } = setup();
    await store.set(makeAuthSession({ user: null, access_token: `h.${payload}.s` }));
    expect(store.current()?.user).toEqual({ id: 'u-jwt', email: 'j@x.com' });
  });

  it('refreshes first when the token is about to expire, and rotates the refresh token', async () => {
    const { store, advance, events } = setup(fresh);
    const refresher = jest.fn(async () => makeAuthSession({ access_token: 'a2', refresh_token: 'r2', expires_at: NOW + 7200 }));
    store.setRefresher(refresher);
    advance(3600 - REFRESH_MARGIN_S + 1);
    expect(await store.getAccessToken()).toBe('a2');
    expect(refresher).toHaveBeenCalledWith('r1');
    expect(store.current()?.refresh_token).toBe('r2');
    expect(events).toEqual(['REFRESHED']);
  });

  it('runs one refresh for concurrent callers (refresh tokens are single use)', async () => {
    const { store } = setup(fresh);
    let resolve!: (v: ReturnType<typeof makeAuthSession>) => void;
    const refresher = jest.fn(() => new Promise<ReturnType<typeof makeAuthSession>>((r) => (resolve = r)));
    store.setRefresher(refresher);
    await store.load();
    const both = Promise.all([store.refresh(), store.refresh()]);
    await new Promise((r) => setTimeout(r, 0));
    resolve(makeAuthSession({ access_token: 'a2', refresh_token: 'r2' }));
    expect(await both).toEqual(['a2', 'a2']);
    expect(refresher).toHaveBeenCalledTimes(1);
  });

  it('ends the session when Clutch refuses the refresh token', async () => {
    const { store, storage, events } = setup(fresh);
    store.setRefresher(async () => {
      throw clutchError('invalid_credentials', 401);
    });
    expect(await store.refresh()).toBeNull();
    expect(store.current()).toBeNull();
    expect(storage.map.has(SESSION_STORAGE_KEY)).toBe(false);
    expect(events).toEqual(['SIGNED_OUT']);
  });

  it('ends the session on any refusal of the refresh, without refreshing again', async () => {
    const { store, events } = setup(fresh);
    const refresher = jest.fn(async () => {
      throw clutchError('session_expired', 401);
    });
    store.setRefresher(refresher);
    expect(await store.refresh()).toBeNull();
    expect(refresher).toHaveBeenCalledTimes(1);
    expect(store.current()).toBeNull();
    expect(events).toEqual(['SIGNED_OUT']);
  });

  it('keeps the session when Clutch could not answer the refresh (502) or limits it (429)', async () => {
    for (const err of [clutchError('upstream_error', 502), clutchError('rate_limit_exceeded', 429)]) {
      const { store, events } = setup(fresh);
      store.setRefresher(async () => {
        throw err;
      });
      await expect(store.refresh()).rejects.toBe(err);
      expect(store.current()?.refresh_token).toBe('r1');
      expect(events).toEqual([]);
    }
  });

  it('keeps the session when the refresh could not reach Clutch', async () => {
    const { store, events } = setup(fresh);
    store.setRefresher(async () => {
      throw networkError();
    });
    await expect(store.refresh()).rejects.toBeDefined();
    expect(store.current()?.refresh_token).toBe('r1');
    expect(events).toEqual([]);
  });

  it('sends the old token rather than fail when an early refresh cannot run', async () => {
    const { store, advance } = setup(fresh);
    store.setRefresher(async () => {
      throw networkError();
    });
    advance(3600 - 10);
    expect(await store.getAccessToken()).toBe('a1');
  });

  it('never lets a stale refresh replace or clear a session signed in meanwhile', async () => {
    const { store } = setup(fresh);
    let reject!: (e: unknown) => void;
    store.setRefresher(() => new Promise((_r, j) => (reject = j)));
    await store.load();
    const refreshing = store.refresh();
    await store.set(makeAuthSession({ access_token: 'other', refresh_token: 'r-other' }));
    reject(clutchError('invalid_credentials', 401));
    expect(await refreshing).toBe('other');
    expect(store.current()?.refresh_token).toBe('r-other');
  });

  it("never answers another member's token for a request sent as the first", async () => {
    // A signs out while a refresh for their 401 is in flight; B signs in.
    const { store } = setup(fresh);
    let resolve!: (s: ReturnType<typeof makeAuthSession>) => void;
    store.setRefresher(() => new Promise((r) => (resolve = r)));
    await store.load();
    const forA = store.refresh('a1');
    await store.clear();
    await store.set(makeAuthSession({ access_token: 'b1', refresh_token: 'rb1', user: { id: 'user-b', email: 'b@x.com' } }));
    resolve(makeAuthSession({ access_token: 'a2', refresh_token: 'r2' }));
    expect(await forA).toBeNull();
    expect(store.current()?.access_token).toBe('b1');
    // A token refused after B signed in that was A's still answers nothing.
    expect(await store.refresh('a1')).toBeNull();
  });

  it("answers the same member's newer token without refreshing again", async () => {
    const { store } = setup(fresh);
    const refresher = jest.fn(async () => makeAuthSession({ access_token: 'a2', refresh_token: 'r2' }));
    store.setRefresher(refresher);
    expect(await store.refresh('a1')).toBe('a2');
    expect(await store.refresh('a1')).toBe('a2');
    expect(refresher).toHaveBeenCalledTimes(1);
  });

  it('does not hand a token to a waiter whose member was replaced mid-refresh', async () => {
    const { store, advance } = setup(fresh);
    let resolve!: (s: ReturnType<typeof makeAuthSession>) => void;
    store.setRefresher(() => new Promise((r) => (resolve = r)));
    advance(3600 - 10);
    const waiting = store.getAccessToken();
    await new Promise((r) => setTimeout(r, 0));
    await store.set(makeAuthSession({ access_token: 'b1', refresh_token: 'rb1', user: { id: 'user-b', email: 'b@x.com' } }));
    resolve(makeAuthSession({ access_token: 'a2', refresh_token: 'r2' }));
    expect(await waiting).toBeNull();
  });

  it("refreshes a new member's session on its own token, not by joining the last one's refresh", async () => {
    // A's refresh is still running when A signs out and B signs in; B's 401 needs B's refresh.
    const { store } = setup(fresh);
    const pending: Array<(s: ReturnType<typeof makeAuthSession>) => void> = [];
    const refresher = jest.fn((_refreshToken: string) => new Promise<ReturnType<typeof makeAuthSession>>((r) => pending.push(r)));
    store.setRefresher(refresher);
    await store.load();
    const forA = store.refresh('a1');
    await store.clear();
    await store.set(makeAuthSession({ access_token: 'b1', refresh_token: 'rb1', user: { id: 'user-b', email: 'b@x.com' } }));
    const forB = store.refresh('b1');
    pending[0](makeAuthSession({ access_token: 'a2', refresh_token: 'r2' }));
    await new Promise((r) => setTimeout(r, 0));
    pending[1](makeAuthSession({ access_token: 'b2', refresh_token: 'rb2', user: { id: 'user-b', email: 'b@x.com' } }));
    expect(await forA).toBeNull();
    expect(await forB).toBe('b2');
    expect(refresher.mock.calls.map((c) => c[0])).toEqual(['r1', 'rb1']);
  });

  it('answers the replacing session rather than fail when a refresh for the old one could not run', async () => {
    // A step-up replaced the member's session while a refresh for the old one was in flight.
    const { store } = setup(fresh);
    let reject!: (e: unknown) => void;
    store.setRefresher(() => new Promise((_r, j) => (reject = j)));
    await store.load();
    const refreshing = store.refresh('a1');
    await store.set(makeAuthSession({ access_token: 'a3', refresh_token: 'r3' }));
    reject(networkError());
    expect(await refreshing).toBe('a3');
    expect(store.current()?.refresh_token).toBe('r3');
  });

  it("keeps expiry on this device's clock, so a wrong phone clock cannot loop refreshes", async () => {
    // Clutch's expires_at is an hour behind this (fast) clock; expires_in is what counts.
    const { store } = setup();
    await store.set(makeAuthSession({ expires_at: NOW - 3600, expires_in: 3600 }));
    expect(store.current()?.expires_at).toBe(NOW + 3600);
    expect(store.secondsUntilRefresh()).toBe(3600 - REFRESH_MARGIN_S);
  });

  it('never schedules or runs another refresh right after one', async () => {
    const { store, advance } = setup(fresh);
    // A server that answers sessions already due for refresh.
    const refresher = jest.fn(async () => makeAuthSession({ access_token: 'a2', refresh_token: 'r2', expires_in: 30 }));
    store.setRefresher(refresher);
    await store.refresh();
    expect(store.secondsUntilRefresh()).toBe(MIN_REFRESH_INTERVAL_S);
    expect(await store.getAccessToken()).toBe('a2');
    expect(refresher).toHaveBeenCalledTimes(1);
    // A 401 still forces a refresh inside the floor.
    expect(await store.refresh('a2')).toBe('a2');
    expect(refresher).toHaveBeenCalledTimes(2);
    advance(MIN_REFRESH_INTERVAL_S);
    expect(store.secondsUntilRefresh()).toBe(0);
  });

  it('reads storage again after a failed read, and announces the session it finds', async () => {
    const { store, storage, events } = setup(fresh);
    storage.getItem.mockRejectedValueOnce(new Error('Keychain locked'));
    expect(await store.load()).toBeNull();
    expect(await store.load()).toMatchObject({ access_token: 'a1' });
    expect(storage.getItem).toHaveBeenCalledTimes(2);
    expect(events).toEqual(['INITIAL']);
  });

  it('clears locally and says so once', async () => {
    const { store, events } = setup(fresh);
    await store.clear();
    await store.clear();
    expect(store.current()).toBeNull();
    expect(events).toEqual(['SIGNED_OUT']);
  });
});
