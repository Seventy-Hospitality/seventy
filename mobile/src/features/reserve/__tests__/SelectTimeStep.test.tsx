import type { ReactNode } from 'react';
import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { asCourtId, CAPABILITIES, clutch, type AvailabilitySlot, type SlotStatus } from '../../../lib/clutch';
import type { MockClutch } from '../../../lib/clutch/testing';
import { makeClub, makeCourtAvailability, makeQuote, makeSlot } from '../../../lib/clutch/fixtures';
import { bookingRulesOf, type SportRules } from '../club-rules';
import { SelectTimeStep, type TimePick } from '../SelectTimeStep';

jest.mock('../../../lib/clutch', () => {
  const actual = jest.requireActual('../../../lib/clutch');
  const { createMockClutch } = jest.requireActual('../../../lib/clutch/testing');
  return { ...actual, clutch: createMockClutch() };
});

const mockClutch = clutch as unknown as MockClutch;
const C1 = asCourtId('c1');
const C2 = asCourtId('c2');

function slots(courtId: typeof C1, statuses: SlotStatus[], cents = 1500): AvailabilitySlot[] {
  return statuses.map((status, i) => {
    const at = 18 * 60 + i * 30;
    const hh = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    return makeSlot({ court_id: courtId, start_time: hh(at), end_time: hh(at + 30), status, price_cents: cents });
  });
}

function Harness({ onContinue, rules }: { onContinue: (pick: TimePick) => void; rules: SportRules }) {
  const [selected, setSelected] = useState<string[]>([]);
  return (
    <SelectTimeStep
      sport="badminton"
      timezone="America/New_York"
      rules={rules}
      date="2099-06-01"
      onDateChange={() => undefined}
      slots={selected}
      onSlotsChange={setSelected}
      notice={null}
      onDismissNotice={() => undefined}
      onContinue={onContinue}
    />
  );
}

function renderStep(onContinue = jest.fn(), rules: SportRules = bookingRulesOf(makeClub())) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  render(<Harness onContinue={onContinue} rules={rules} />, { wrapper });
  return onContinue;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockClutch.capabilities = { ...CAPABILITIES, bookingParity: true };
});

describe('SelectTimeStep', () => {
  it('offers times with a free court, picks one court for the range, and shows Clutch quote', async () => {
    mockClutch.club.availability.mockResolvedValue([
      makeCourtAvailability(C1, { court_name: 'Court 1' }, slots(C1, ['available', 'booked', 'available'])),
      makeCourtAvailability(C2, { court_name: 'Court 2' }, slots(C2, ['available', 'available', 'booked'])),
      makeCourtAvailability(asCourtId('t1'), { court_type: 'tennis' }, slots(asCourtId('t1'), ['available'])),
    ]);
    mockClutch.bookings.quote.mockResolvedValue(makeQuote({ total_cents: 2700 }));
    const onContinue = renderStep();

    const first = await screen.findByLabelText(/^6:00PM - 6:30PM, \$15, 2 courts free/);
    fireEvent.press(first);
    fireEvent.press(screen.getByLabelText(/^6:30PM - 7:00PM, \$15, 1 court free/));

    expect(await screen.findByText('Total $27.00')).toBeTruthy();
    expect(mockClutch.bookings.quote).toHaveBeenCalledWith({
      court_id: C2,
      date: '2099-06-01',
      start_time: '18:00',
      end_time: '19:00',
    });
    fireEvent.press(screen.getByText('Continue'));
    expect(onContinue).toHaveBeenCalledWith(
      expect.objectContaining({ date: '2099-06-01', range: { start: '18:00', end: '19:00', minutes: 60 } }),
    );
    expect(onContinue.mock.calls[0][0].court.court_id).toBe(C2);
  });

  it('says when no single court holds the whole range', async () => {
    mockClutch.club.availability.mockResolvedValue([
      makeCourtAvailability(C1, {}, slots(C1, ['available', 'booked'])),
      makeCourtAvailability(C2, {}, slots(C2, ['booked', 'available'])),
    ]);
    const onContinue = renderStep();

    fireEvent.press(await screen.findByLabelText(/^6:00PM - 6:30PM/));
    fireEvent.press(screen.getByLabelText(/^6:30PM - 7:00PM/));
    expect(await screen.findByText(/No single court is free/)).toBeTruthy();
    fireEvent.press(screen.getByText('Continue'));
    expect(onContinue).not.toHaveBeenCalled();
    // The single first slot was quotable; the impossible hour never is.
    expect(mockClutch.bookings.quote).not.toHaveBeenCalledWith(expect.objectContaining({ end_time: '19:00' }));
  });

  it('without P4 asks for no quote and says the total is shown at payment', async () => {
    mockClutch.capabilities = { ...CAPABILITIES, bookingParity: false };
    mockClutch.club.availability.mockResolvedValue([
      makeCourtAvailability(C1, {}, slots(C1, ['available', 'available'])),
    ]);
    renderStep();
    fireEvent.press(await screen.findByLabelText(/^6:00PM - 6:30PM/));
    fireEvent.press(screen.getByLabelText(/^6:30PM - 7:00PM/));
    expect(await screen.findByText('Total shown at payment')).toBeTruthy();
    expect(mockClutch.bookings.quote).not.toHaveBeenCalled();
  });

  it("drops starts outside the sport's opening hours (P4)", async () => {
    mockClutch.club.availability.mockResolvedValue([
      makeCourtAvailability(C1, {}, slots(C1, ['available', 'available', 'available'])),
    ]);
    // 2099-06-01 is a Monday: open until 18:30.
    const rules: SportRules = {
      ...bookingRulesOf(makeClub()),
      hours: [{ day_of_week: 1, open_time: '08:00:00', close_time: '18:30:00', is_closed: false }],
    };
    renderStep(jest.fn(), rules);
    expect(await screen.findByLabelText(/^6:00PM - 6:30PM/)).toBeTruthy();
    expect(screen.queryByLabelText(/^6:30PM - 7:00PM/)).toBeNull();
  });

  it('shows the empty state when every court of the sport is taken', async () => {
    mockClutch.club.availability.mockResolvedValue([
      makeCourtAvailability(C1, {}, slots(C1, ['booked', 'past', 'maintenance'])),
    ]);
    renderStep();
    expect(await screen.findByText('No available times')).toBeTruthy();
  });
});
