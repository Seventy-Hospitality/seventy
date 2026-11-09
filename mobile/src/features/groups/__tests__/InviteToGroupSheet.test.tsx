import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import type { MockClutch } from '../../../lib/clutch/testing';
import { clutchError } from '../../../lib/clutch/testing';
import { makeClubPlayer, makeGroup, makeGroupMember } from '../../../lib/clutch/fixtures';
import { InviteToGroupSheet } from '../InviteToGroupSheet';
import { renderWithProviders } from './render';

jest.mock('../../../lib/clutch', () => {
  const { createMockClutch } = jest.requireActual('../../../lib/clutch/testing');
  return { ...jest.requireActual('../../../lib/clutch'), clutch: createMockClutch() };
});
const mockClutch: MockClutch = jest.requireMock('../../../lib/clutch').clutch;
const REAL_CAPABILITIES = { ...mockClutch.capabilities };

jest.mock('../../../lib/session', () => ({
  useSession: () => ({ userId: jest.requireActual('../../../lib/clutch/fixtures').ME_ID }),
}));
jest.mock('expo-linking', () => ({
  createURL: (path: string, opts?: { queryParams?: Record<string, string> }) =>
    `seventy://${path.replace(/^\//, '')}?token=${opts?.queryParams?.token ?? ''}`,
}));
const mockSetString = jest.fn<Promise<boolean>, [string]>();
jest.mock('expo-clipboard', () => ({ setStringAsync: (text: string) => mockSetString(text) }));

const group = makeGroup({ name: 'Baddies', members: [makeGroupMember()] });

beforeEach(() => {
  jest.clearAllMocks();
  mockSetString.mockResolvedValue(true);
  mockClutch.groups.inviteLink.mockResolvedValue({ token: 'tok-abc', expires_at: null, max_uses: null });
  mockClutch.club.searchPlayers.mockResolvedValue([makeClubPlayer()]);
});

describe('InviteToGroupSheet without member search (P4 off, today)', () => {
  beforeEach(() => {
    mockClutch.capabilities = { ...REAL_CAPABILITIES, bookingParity: false };
  });

  it('offers no Add, says search is coming, and never searches', () => {
    renderWithProviders(<InviteToGroupSheet group={group} open onClose={jest.fn()} />);
    expect(screen.getByTestId('unavailable-bookingParity')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add players' })).toBeNull();
    expect(mockClutch.club.searchPlayers).not.toHaveBeenCalled();
  });

  it('still copies the invite link (minting it needs no P4)', async () => {
    renderWithProviders(<InviteToGroupSheet group={group} open onClose={jest.fn()} />);
    fireEvent.press(screen.getByRole('button', { name: 'Copy Link' }));
    await waitFor(() => expect(mockSetString).toHaveBeenCalledWith('seventy://groups/join?token=tok-abc'));
    expect(mockClutch.groups.inviteLink).toHaveBeenCalledWith(group.id, {}, { idempotencyKey: expect.any(String) });
    expect(await screen.findByText('Invite link copied.')).toBeTruthy();
  });

  it('shows the QR for the link', async () => {
    renderWithProviders(<InviteToGroupSheet group={group} open onClose={jest.fn()} />);
    fireEvent.press(screen.getByRole('button', { name: 'QR Code' }));
    expect(await screen.findByText('seventy://groups/join?token=tok-abc')).toBeTruthy();
  });

  it('a link refusal says what happened', async () => {
    mockClutch.groups.inviteLink.mockRejectedValue(clutchError('not_authorized', 403));
    renderWithProviders(<InviteToGroupSheet group={group} open onClose={jest.fn()} />);
    fireEvent.press(screen.getByRole('button', { name: 'Copy Link' }));
    expect(await screen.findByText('Only members of this group can share its invite link.')).toBeTruthy();
  });
});

describe('InviteToGroupSheet with member search (P4 on)', () => {
  beforeEach(() => {
    mockClutch.capabilities = { ...REAL_CAPABILITIES, bookingParity: true };
  });

  it('sends the picked invitations', async () => {
    mockClutch.groups.invite.mockResolvedValue({ invited: [makeClubPlayer().user_id] });
    const onClose = jest.fn();
    renderWithProviders(<InviteToGroupSheet group={group} open onClose={onClose} />);
    fireEvent.press(await screen.findByRole('checkbox', { name: 'Invite Sam Lee' }));
    fireEvent.press(screen.getByRole('button', { name: 'Add 1 player' }));
    await waitFor(() =>
      expect(mockClutch.groups.invite).toHaveBeenCalledWith(group.id, [makeClubPlayer().user_id], {
        idempotencyKey: expect.any(String),
      }),
    );
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});
