import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import type { MockClutch } from '../../../lib/clutch/testing';
import { ME_ID, OTHER_ID } from '../../../lib/clutch/fixtures';
import { asUserId } from '../../../lib/clutch';
import { MemberPicker } from '../MemberPicker';
import { EMPTY_SELECTION, type InviteeSelection } from '../groups-lib';
import { renderWithProviders } from './render';

jest.mock('../../../lib/clutch', () => {
  const { createMockClutch } = jest.requireActual('../../../lib/clutch/testing');
  return { ...jest.requireActual('../../../lib/clutch'), clutch: createMockClutch() };
});
const mockClutch: MockClutch = jest.requireMock('../../../lib/clutch').clutch;
jest.mock('expo-linking', () => ({ createURL: () => 'seventy://groups/join?token=t' }));

const sam = { user_id: OTHER_ID, full_name: 'Sam Lee', username: 'sam', avatar_url: null };
const kim = { user_id: asUserId('kim'), full_name: 'Kim Park', username: null, avatar_url: null };

beforeEach(() => {
  jest.clearAllMocks();
  mockClutch.club.searchPlayers.mockResolvedValue([
    { user_id: ME_ID, full_name: 'Alex Morgan', username: null, avatar_url: null },
    sam,
    kim,
  ]);
});

describe('MemberPicker', () => {
  it('searches fellow club members and hides excluded people', async () => {
    renderWithProviders(
      <MemberPicker selection={EMPTY_SELECTION} onSelectionChange={jest.fn()} excludeUserIds={[ME_ID, kim.user_id]} />,
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
