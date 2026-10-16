import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import type { MockClutch } from '../../../lib/clutch/testing';
import { makeClubPlayer, ME_ID } from '../../../lib/clutch/fixtures';
import { asUserId } from '../../../lib/clutch';
import { MemberPicker } from '../MemberPicker';
import { EMPTY_SELECTION, type InviteeSelection } from '../groups-lib';
import { renderWithProviders } from './render';

jest.mock('../../../lib/clutch', () => {
  const { createMockClutch } = jest.requireActual('../../../lib/clutch/testing');
  return { ...jest.requireActual('../../../lib/clutch'), clutch: createMockClutch() };
});
const mockClutch: MockClutch = jest.requireMock('../../../lib/clutch').clutch;
const REAL_CAPABILITIES = { ...mockClutch.capabilities };
jest.mock('expo-linking', () => ({ createURL: () => 'seventy://groups/join?token=t' }));

const alex = makeClubPlayer({ user_id: ME_ID, full_name: 'Alex Morgan', username: null });
const sam = makeClubPlayer();
const kim = makeClubPlayer({
  user_id: '00000000-0000-4000-8000-000000000003',
  full_name: 'Kim Park',
  username: null,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockClutch.capabilities = { ...REAL_CAPABILITIES, bookingParity: true };
  mockClutch.club.searchPlayers.mockResolvedValue([alex, sam, kim]);
});

describe('MemberPicker', () => {
  it('is honest that member search is not live without P4, and never calls it', () => {
    mockClutch.capabilities = { ...REAL_CAPABILITIES, bookingParity: false };
    renderWithProviders(<MemberPicker selection={EMPTY_SELECTION} onSelectionChange={jest.fn()} />);
    expect(screen.getByTestId('unavailable-bookingParity')).toBeTruthy();
    expect(screen.getByText('Member search is not available in the app yet')).toBeTruthy();
    expect(screen.queryByLabelText('Search members by name')).toBeNull();
    expect(mockClutch.club.searchPlayers).not.toHaveBeenCalled();
  });

  it('searches fellow club members and hides excluded people', async () => {
    renderWithProviders(
      <MemberPicker selection={EMPTY_SELECTION} onSelectionChange={jest.fn()} excludeUserIds={[asUserId(ME_ID), kim.user_id]} />,
    );
    expect(await screen.findByText('Sam Lee')).toBeTruthy();
    expect(screen.queryByText('Alex Morgan')).toBeNull();
    expect(screen.queryByText('Kim Park')).toBeNull();
    expect(mockClutch.club.searchPlayers).toHaveBeenCalledWith('', 25);
  });

  it('toggles a pick and passes the query to the search', async () => {
    const onChange = jest.fn<void, [InviteeSelection]>();
    renderWithProviders(<MemberPicker selection={EMPTY_SELECTION} onSelectionChange={onChange} />);
    fireEvent.press(await screen.findByRole('checkbox', { name: 'Invite Sam Lee' }));
    expect(onChange).toHaveBeenCalledWith([sam]);

    fireEvent.changeText(screen.getByLabelText('Search members by name'), 'sa');
    await waitFor(() => expect(mockClutch.club.searchPlayers).toHaveBeenCalledWith('sa', 25));
  });
});
