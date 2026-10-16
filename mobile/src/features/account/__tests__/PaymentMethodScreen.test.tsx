import { Alert } from 'react-native';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import type { MockClutch } from '../../../lib/clutch/testing';
import { clutchError } from '../../../lib/clutch/testing';
import { asCardId, type SavedPaymentMethod, type SheetBundle } from '../../../lib/clutch';
import type { SheetResult } from '../../../lib/stripe';
import { PaymentMethodScreen } from '../PaymentMethodScreen';
import { renderWithProviders } from './render-account';

jest.mock('../../../lib/clutch', () => {
  const actual = jest.requireActual('../../../lib/clutch');
  const { createMockClutch } = jest.requireActual('../../../lib/clutch/testing');
  return { ...actual, clutch: createMockClutch() };
});
const mockClutch = (jest.requireMock('../../../lib/clutch') as { clutch: MockClutch }).clutch;

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => true }),
}));

const mockPresent = jest.fn<Promise<SheetResult>, unknown[]>();
jest.mock('../../../lib/stripe', () => ({
  usePresentConnectedSheet: () => mockPresent,
  usePaymentsConfigured: () => true,
}));

const CARD: SavedPaymentMethod = {
  id: asCardId('card-1'),
  stripe_payment_method_id: 'pm_1',
  type: 'card',
  card_brand: 'visa',
  card_last4: '4242',
  card_exp_month: 9,
  card_exp_year: 2027,
  is_default: true,
};

const SETUP: SheetBundle = {
  clientSecret: 'seti_9_secret_x',
  intentType: 'setup',
  customerId: 'cus_1',
  ephemeralKeySecret: 'ek_1',
  stripeAccount: 'acct_club',
  simulated: false,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockClutch.paymentMethods.list.mockResolvedValue([CARD]);
  mockClutch.paymentMethods.save.mockResolvedValue(null);
});

describe('PaymentMethodScreen', () => {
  it('adds a card: setup sheet on the club account, then Clutch saves the SetupIntent', async () => {
    mockClutch.paymentMethods.setupIntent.mockResolvedValue(SETUP);
    mockPresent.mockResolvedValue({ status: 'completed', intentId: 'seti_9' });

    renderWithProviders(<PaymentMethodScreen />);
    fireEvent.press(await screen.findByLabelText('Add card'));

    await waitFor(() =>
      expect(mockClutch.paymentMethods.save).toHaveBeenCalledWith(
        'seti_9',
        expect.objectContaining({ idempotencyKey: expect.any(String) }),
      ),
    );
    expect(mockPresent).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'stripe', intentType: 'setup', stripeAccount: 'acct_club' }),
      expect.anything(),
    );
    await waitFor(() => expect(mockClutch.paymentMethods.list).toHaveBeenCalledTimes(2));
  });

  it('never saves a card the sheet did not complete', async () => {
    mockClutch.paymentMethods.setupIntent.mockResolvedValue(SETUP);
    mockPresent.mockResolvedValue({ status: 'canceled' });

    renderWithProviders(<PaymentMethodScreen />);
    fireEvent.press(await screen.findByLabelText('Add card'));

    await waitFor(() => expect(mockPresent).toHaveBeenCalled());
    expect(mockClutch.paymentMethods.save).not.toHaveBeenCalled();
  });

  it('shows no sheet when Clutch runs simulated', async () => {
    mockClutch.paymentMethods.setupIntent.mockResolvedValue({ ...SETUP, clientSecret: null, simulated: true });

    renderWithProviders(<PaymentMethodScreen />);
    fireEvent.press(await screen.findByLabelText('Add card'));

    expect(await screen.findByText(/Cards are simulated/)).toBeTruthy();
    expect(mockPresent).not.toHaveBeenCalled();
  });

  it("shows Clutch's refusal when the card cannot be removed", async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => {
      buttons?.find((b) => b.style === 'destructive')?.onPress?.();
    });
    mockClutch.paymentMethods.remove.mockRejectedValue(
      clutchError('cannot_cancel', 409, undefined, 'This card pays your membership. Add another card first.'),
    );

    renderWithProviders(<PaymentMethodScreen />);
    fireEvent.press(await screen.findByLabelText('Remove Visa •••• 4242 · exp 09/27'));

    expect(await screen.findByText('This card pays your membership. Add another card first.')).toBeTruthy();
    alert.mockRestore();
  });
});
