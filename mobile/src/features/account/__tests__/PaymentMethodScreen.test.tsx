import { Alert } from 'react-native';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import type { MockClutch } from '../../../lib/clutch/testing';
import { clutchError, networkError } from '../../../lib/clutch/testing';
import { makeSavedCard, makeSetupIntent } from '../../../lib/clutch/fixtures';
import type { SheetResult } from '../../../lib/stripe';
import { PaymentMethodScreen } from '../PaymentMethodScreen';
import { renderWithProviders } from './render-account';
import type { Capabilities } from '../../../lib/clutch/capabilities';

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

const CARD = makeSavedCard({ card_exp_month: 9, card_exp_year: 2027 });
const SETUP = makeSetupIntent({ clientSecret: 'seti_9_secret_x', setupIntentId: 'seti_9' });

beforeEach(() => {
  jest.clearAllMocks();
  mockClutch.paymentMethods.list.mockResolvedValue([CARD]);
  mockClutch.paymentMethods.save.mockResolvedValue(CARD);
  (mockClutch.capabilities as Capabilities).nativePayments = true;
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

  it('shows no sheet when Clutch runs simulated, and still lets Clutch save by the intent id', async () => {
    mockClutch.paymentMethods.setupIntent.mockResolvedValue(makeSetupIntent({ clientSecret: null, simulated: true }));

    renderWithProviders(<PaymentMethodScreen />);
    fireEvent.press(await screen.findByLabelText('Add card'));

    await waitFor(() =>
      expect(mockClutch.paymentMethods.save).toHaveBeenCalledWith('seti_123', expect.anything()),
    );
    expect(mockPresent).not.toHaveBeenCalled();
  });

  it("shows Clutch's refusal when the card cannot be removed", async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => {
      buttons?.find((b) => b.style === 'destructive')?.onPress?.();
    });
    mockClutch.paymentMethods.remove.mockRejectedValue(
      clutchError('card_in_use_by_subscription', 409),
    );

    renderWithProviders(<PaymentMethodScreen />);
    fireEvent.press(await screen.findByLabelText('Remove Visa •••• 4242 · exp 09/27'));

    expect(
      await screen.findByText('This card pays your membership. Add another card and make it the default first.'),
    ).toBeTruthy();
    alert.mockRestore();
  });

  it('lists the cards but offers no changes without native payments', async () => {
    (mockClutch.capabilities as Capabilities).nativePayments = false;
    renderWithProviders(<PaymentMethodScreen />);

    expect(await screen.findByText('Visa •••• 4242 · exp 09/27')).toBeTruthy();
    expect(screen.queryByLabelText('Add card')).toBeNull();
    expect(screen.queryByLabelText('Remove Visa •••• 4242 · exp 09/27')).toBeNull();
    expect(screen.getByText(/not available in the app yet/)).toBeTruthy();
  });

  it('shows an error with retry when the cards cannot be read', async () => {
    mockClutch.paymentMethods.list.mockRejectedValueOnce(networkError()).mockResolvedValue([CARD]);
    renderWithProviders(<PaymentMethodScreen />);

    expect(await screen.findByText('We could not load your payment methods.')).toBeTruthy();
    expect(screen.queryByText('No payment methods')).toBeNull();
    fireEvent.press(screen.getByLabelText('Try again'));
    expect(await screen.findByText('Visa •••• 4242 · exp 09/27')).toBeTruthy();
  });
});
