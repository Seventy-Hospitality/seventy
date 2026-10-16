import type { ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { asGroupId, asUserId, clutch } from '../../../lib/clutch';
import type { MockClutch } from '../../../lib/clutch/testing';
import { clutchError, networkError } from '../../../lib/clutch/testing';
import { makeBooking, makeClubPlayer, makeGroupSummary } from '../../../lib/clutch/fixtures';
import { useSendInvites, type SendInvitesProgress } from '../useSendInvites';
import type { InviteSelection } from '../invites';

jest.mock('../../../lib/clutch', () => {
  const actual = jest.requireActual('../../../lib/clutch');
  const { createMockClutch } = jest.requireActual('../../../lib/clutch/testing');
  return { ...actual, clutch: createMockClutch() };
});

const mockClutch = clutch as unknown as MockClutch;
const BOOKING = makeBooking({ status: 'confirmed' });
const SAM = makeClubPlayer({ user_id: asUserId('u-sam'), full_name: 'Sam Lee' });
const G1 = makeGroupSummary({ id: asGroupId('g1'), name: 'Tuesday' });
const G2 = makeGroupSummary({ id: asGroupId('g2'), name: 'Weekend' });
const SELECTION: InviteSelection = { players: [SAM], groups: [G1, G2] };

function setup() {
  const progress: SendInvitesProgress[] = [];
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const hook = renderHook(() => useSendInvites(BOOKING.id, (p) => progress.push(p)), { wrapper });
  return { hook, progress };
}

beforeEach(() => jest.clearAllMocks());

describe('useSendInvites', () => {
  it('invites the players, then each group, each under its own key', async () => {
    mockClutch.bookings.invitePlayers.mockResolvedValue(null);
    mockClutch.bookings.inviteGroup.mockResolvedValue({ invited: [] });
    const { hook, progress } = setup();

    await act(async () => {
      await hook.result.current.mutateAsync(SELECTION);
    });

    expect(mockClutch.bookings.invitePlayers).toHaveBeenCalledWith(BOOKING.id, [SAM.user_id], {
      idempotencyKey: expect.any(String),
    });
    const groupCalls = mockClutch.bookings.inviteGroup.mock.calls;
    expect(groupCalls.map((call) => call[1])).toEqual([G1.id, G2.id]);
    expect(groupCalls[0][2]?.idempotencyKey).not.toBe(groupCalls[1][2]?.idempotencyKey);
    expect(progress).toEqual([{ playersSent: true }, { groupSent: G1.id }, { groupSent: G2.id }]);
  });

  it('reports what was sent before a failure so a retry sends only the rest', async () => {
    mockClutch.bookings.invitePlayers.mockResolvedValue(null);
    mockClutch.bookings.inviteGroup
      .mockResolvedValueOnce({ invited: [] })
      .mockRejectedValueOnce(networkError())
      .mockResolvedValueOnce({ invited: [] });
    const { hook, progress } = setup();

    await act(async () => {
      await hook.result.current.mutateAsync(SELECTION).catch(() => undefined);
    });
    expect(progress).toEqual([{ playersSent: true }, { groupSent: G1.id }]);
    const failedKey = mockClutch.bookings.inviteGroup.mock.calls[1][2]?.idempotencyKey;

    // The screen drops what was sent; the retry sends G2 alone, with the same
    // key (a network failure decided nothing).
    await act(async () => {
      await hook.result.current.mutateAsync({ players: [], groups: [G2] });
    });
    expect(mockClutch.bookings.invitePlayers).toHaveBeenCalledTimes(1);
    expect(mockClutch.bookings.inviteGroup.mock.calls[2][1]).toBe(G2.id);
    expect(mockClutch.bookings.inviteGroup.mock.calls[2][2]?.idempotencyKey).toBe(failedKey);
  });

  it('a refusal ends that item key', async () => {
    mockClutch.bookings.inviteGroup
      .mockRejectedValueOnce(clutchError('group_exceeds_capacity', 409))
      .mockResolvedValueOnce({ invited: [] });
    const { hook } = setup();

    await act(async () => {
      await hook.result.current.mutateAsync({ players: [], groups: [G1] }).catch(() => undefined);
    });
    await waitFor(() => expect(hook.result.current.isError).toBe(true));
    await act(async () => {
      await hook.result.current.mutateAsync({ players: [], groups: [G1] });
    });
    const [first, second] = mockClutch.bookings.inviteGroup.mock.calls;
    expect(second[2]?.idempotencyKey).not.toBe(first[2]?.idempotencyKey);
  });
});
