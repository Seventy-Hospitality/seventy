import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { Modal, Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { PrimaryButton } from '../PrimaryButton';
import { Sheet } from '../Sheet';
import { ToastProvider } from '../Toast';
import { useToast } from '../toast-context';

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

function SaveButton() {
  const { toast } = useToast();
  return <PrimaryButton label="Save" onPress={() => toast({ message: 'Saved' })} />;
}

function Harness({ open }: { open: boolean }) {
  return (
    <SafeAreaProvider initialMetrics={METRICS}>
      <ToastProvider>
        <Sheet open={open} onClose={() => undefined} title="Edit">
          <SaveButton />
        </Sheet>
      </ToastProvider>
    </SafeAreaProvider>
  );
}

afterEach(() => {
  jest.useRealTimers();
});

describe('Sheet', () => {
  it('shows its title and content, scrolling when asked', () => {
    render(
      <SafeAreaProvider initialMetrics={METRICS}>
        <Sheet open onClose={() => undefined} title="Edit" scroll>
          <Text>Body</Text>
        </Sheet>
      </SafeAreaProvider>,
    );
    expect(screen.getByText('Edit')).toBeTruthy();
    expect(screen.getByText('Body')).toBeTruthy();
  });

  it('draws a toast raised while it is open over the sheet, once', () => {
    jest.useFakeTimers();
    const view = render(<Harness open />);
    fireEvent.press(screen.getByLabelText('Save'));
    // One toast, from the host the open sheet mounted (the root host stands down).
    expect(screen.getAllByText('Saved')).toHaveLength(1);
    expect(within(screen.UNSAFE_getByType(Modal)).getByText('Saved')).toBeTruthy();

    // Closed again: the root host shows it instead.
    view.rerender(<Harness open={false} />);
    expect(screen.getAllByText('Saved')).toHaveLength(1);
    act(() => {
      jest.runOnlyPendingTimers();
    });
  });
});
