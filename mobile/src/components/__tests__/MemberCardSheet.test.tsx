import type { ReactNode } from 'react';
import { render, screen, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type { MockClutch } from '../../lib/clutch/testing';
import type { CheckinToken } from '../../lib/clutch';
import { queryKeys } from '../../lib/queries';
import { clutchError } from '../../lib/clutch/testing';
import { checkinErrorMessage, checkinRefreshDelay, MemberCardSheet } from '../MemberCardSheet';

jest.mock('../../lib/clutch', () => {
  const actual = jest.requireActual('../../lib/clutch');
  const { createMockClutch } = jest.requireActual('../../lib/clutch/testing');
  return { ...actual, clutch: createMockClutch() };
});
const mockClutch = (jest.requireMock('../../lib/clutch') as { clutch: MockClutch }).clutch;

function token(ttlSeconds: number): CheckinToken {
  return {
    token: `ck.${ttlSeconds}`,
    expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
    ttlSeconds,
  };
}

function makeClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
}

function wrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <SafeAreaProvider
      initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } }}
    >
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </SafeAreaProvider>
  );
}

beforeEach(() => jest.clearAllMocks());

describe('MemberCardSheet', () => {
  it("renders Clutch's signed check-in token as the QR with the member's name", async () => {
    mockClutch.me.checkinToken.mockResolvedValue(token(60));

    render(<MemberCardSheet open onClose={() => undefined} memberName="Alex Morgan" detail="Member" />, {
      wrapper: wrapper(makeClient()),
    });

    expect(await screen.findByLabelText('Check-in QR code for Alex Morgan')).toBeTruthy();
    expect(screen.getByText('ALEX MORGAN')).toBeTruthy();
    expect(screen.getByText('Member')).toBeTruthy();
    expect(mockClutch.me.checkinToken).toHaveBeenCalledTimes(1);
  });

  it('re-requests the token before its TTL runs out', async () => {
    mockClutch.me.checkinToken.mockResolvedValueOnce(token(11)).mockResolvedValue(token(60));

    render(<MemberCardSheet open onClose={() => undefined} memberName="Alex Morgan" />, {
      wrapper: wrapper(makeClient()),
    });

    await waitFor(() => expect(mockClutch.me.checkinToken).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mockClutch.me.checkinToken).toHaveBeenCalledTimes(2), { timeout: 3000 });
  });

  it('drops the cached token on close so a reopen never shows a stale code', async () => {
    mockClutch.me.checkinToken.mockResolvedValue(token(60));
    const client = makeClient();
    const view = render(<MemberCardSheet open onClose={() => undefined} memberName="Alex Morgan" />, {
      wrapper: wrapper(client),
    });
    await waitFor(() => expect(client.getQueryData(queryKeys.checkinToken)).toBeDefined());

    view.rerender(<MemberCardSheet open={false} onClose={() => undefined} memberName="Alex Morgan" />);

    await waitFor(() => expect(client.getQueryData(queryKeys.checkinToken)).toBeUndefined());
  });
});

describe('checkinRefreshDelay', () => {
  it('refreshes ten seconds before the TTL ends, never sooner than a second', () => {
    expect(checkinRefreshDelay(0, 60, 0)).toBe(50_000);
    expect(checkinRefreshDelay(0, 60, 30_000)).toBe(20_000);
    expect(checkinRefreshDelay(0, 5, 0)).toBe(1_000);
  });
});

describe('checkinErrorMessage', () => {
  it('explains a non-member without offering a pointless retry', () => {
    expect(checkinErrorMessage(clutchError('not_club_member'))).toEqual({
      message: expect.stringMatching(/membership is active/),
      retry: false,
    });
  });

  it('lets the member retry when check-in is unavailable or the read failed', () => {
    expect(checkinErrorMessage(clutchError('checkin_unavailable', 503)).retry).toBe(true);
    expect(checkinErrorMessage(new Error('x')).retry).toBe(true);
  });
});
