import { fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type { ReactElement } from 'react';
import { LapsedMembershipScreen, SignOutButton } from '../components/GateStates';

const METRICS = {
  frame: { x: 0, y: 0, width: 320, height: 568 },
  insets: { top: 20, left: 0, right: 0, bottom: 0 },
};

function renderInSafeArea(ui: ReactElement) {
  return render(<SafeAreaProvider initialMetrics={METRICS}>{ui}</SafeAreaProvider>);
}

describe('LapsedMembershipScreen', () => {
  it('explains a past-due payment in words, not the status code', () => {
    renderInSafeArea(
      <LapsedMembershipScreen
        reason="past_due"
        renew={() => undefined}
        paymentsAvailable
        onRefresh={async () => undefined}
        onSignOut={async () => undefined}
      />,
    );
    expect(screen.getByText(/Your last membership payment did not go through\./)).toBeTruthy();
    expect(screen.queryByText(/past.due/)).toBeNull();
  });
});

describe('SignOutButton', () => {
  it('says so when signing out fails', async () => {
    renderInSafeArea(<SignOutButton onSignOut={() => Promise.reject(new Error('offline'))} />);
    fireEvent.press(screen.getByLabelText('Sign out'));
    expect(await screen.findByText('Could not sign out, try again.')).toBeTruthy();
  });
});
