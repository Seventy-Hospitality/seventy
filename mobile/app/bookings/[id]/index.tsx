import { Redirect, Stack, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { asBookingId } from '../../../src/lib/clutch';
import { useSession } from '../../../src/lib/session';
import { BookingDetailScreen } from '../../../src/features/bookings/BookingDetailScreen';
import { colors } from '../../../src/theme/tokens';

/** One booking. Anonymous callers (a cold deep link) go to sign-in. */
export default function BookingDetailRoute() {
  const { id = '' } = useLocalSearchParams<{ id: string }>();
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
      <Stack.Screen options={{ headerShown: false }} />
      <BookingDetailScreen bookingId={asBookingId(id)} />
    </>
  );
}
