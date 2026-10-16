import type { ReactNode } from 'react';
import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { asCourtId, clutch, type AvailabilitySlot, type SlotStatus } from '../../../lib/clutch';
import type { MockClutch } from '../../../lib/clutch/testing';
import { makeClub, makeCourtAvailability, makeSlot } from '../../../lib/clutch/fixtures';
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

function Harness({ onContinue }: { onContinue: (pick: TimePick) => void }) {
  const [selected, setSelected] = useState<string[]>([]);
  return (
    <SelectTimeStep
      sport="badminton"
      timezone="America/New_York"
      rules={makeClub().booking_rules!}
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

function renderStep(onContinue = jest.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  render(<Harness onContinue={onContinue} />, { wrapper });
  return onContinue;
}

beforeEach(() => jest.clearAllMocks());

describe('SelectTimeStep', () => {
  it('offers times with a free court, picks one court for the range, and shows Clutch quote', async () => {
    mockClutch.club.availability.mockResolvedValue([
      makeCourtAvailability(C1, { court_name: 'Court 1' }, slots(C1, ['available', 'booked', 'available'])),
      makeCourtAvailability(C2, { court_name: 'Court 2' }, slots(C2, ['available', 'available', 'booked'])),
      makeCourtAvailability(asCourtId('t1'), { court_type: 'tennis' }, slots(asCourtId('t1'), ['available'])),
    ]);
    mockClutch.bookings.quote.mockResolvedValue({ subtotal_cents: 3000, total_cents: 2700, currency: 'USD' });
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

  it('shows the empty state when every court of the sport is taken', async () => {
    mockClutch.club.availability.mockResolvedValue([
      makeCourtAvailability(C1, {}, slots(C1, ['booked', 'past', 'maintenance'])),
    ]);
    renderStep();
    expect(await screen.findByText('No available times')).toBeTruthy();
  });
});
