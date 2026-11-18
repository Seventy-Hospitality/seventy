import { Redirect, Stack, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { useSession } from '../../src/lib/session';
import { BookingWizardScreen } from '../../src/features/reserve/BookingWizardScreen';
import { colors } from '../../src/theme/tokens';

/**
 * The booking wizard for one sport (the court_type in the path). Full screen,
 * outside the tab shell. Anonymous callers (a cold deep link) go to sign-in.
 */
export default function ReserveWizardRoute() {
  const { sport = '' } = useLocalSearchParams<{ sport: string }>();
  const { status } = useSession();

  if (status === 'loading') {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg }}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  if (status === 'anonymous') {
    return <Redirect href="/auth/sign-in" />;
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: false, animation: 'slide_from_bottom' }} />
      <BookingWizardScreen sport={sport} />
    </>
  );
}
