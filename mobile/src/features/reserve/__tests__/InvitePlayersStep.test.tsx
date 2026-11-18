import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { asBookingId, CAPABILITIES, clutch } from '../../../lib/clutch';
import type { MockClutch } from '../../../lib/clutch/testing';
import { makeClubPlayer, makeGroupSummary } from '../../../lib/clutch/fixtures';
import { renderWithProviders } from '../../groups/__tests__/render';
import { InvitePlayersStep } from '../InvitePlayersStep';

jest.mock('../../../lib/clutch', () => {
  const actual = jest.requireActual('../../../lib/clutch');
  const { createMockClutch } = jest.requireActual('../../../lib/clutch/testing');
  return { ...actual, clutch: createMockClutch() };
});
jest.mock('../../../lib/session', () => ({
  useSession: () => ({ userId: jest.requireActual('../../../lib/clutch/fixtures').ME_ID }),
}));

const mockClutch = clutch as unknown as MockClutch;
const BOOKING = asBookingId('b0000000-0000-4000-8000-000000000001');

beforeEach(() => {
  jest.clearAllMocks();
  mockClutch.capabilities = { ...CAPABILITIES, bookingParity: true };
  mockClutch.groups.list.mockResolvedValue([makeGroupSummary({ name: 'Night Owls' })]);
  mockClutch.club.searchPlayers.mockResolvedValue([makeClubPlayer()]);
});

/** Section labels in render order. */
function sectionOrder() {
  return screen.getAllByText(/^(Your groups|Players)$/).map((node) => node.props.children);
}

describe('InvitePlayersStep', () => {
  it('lists groups first, and search results first while a search is on', async () => {
    renderWithProviders(<InvitePlayersStep bookingId={BOOKING} subtitle="Mon, Jul 6" onSent={jest.fn()} />);
    await screen.findByText('Night Owls');
    expect(sectionOrder()).toEqual(['Your groups', 'Players']);

    fireEvent.changeText(screen.getByLabelText('Search club members by name'), 'sam');
    // Once the debounce lands the search, results move above the groups.
    await waitFor(() => expect(sectionOrder()).toEqual(['Players', 'Your groups']));
    expect(mockClutch.club.searchPlayers).toHaveBeenCalledWith('sam');
  });
});
