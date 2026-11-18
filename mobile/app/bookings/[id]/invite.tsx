import { Redirect, Stack, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { asBookingId } from '../../../src/lib/clutch';
import { useSession } from '../../../src/lib/session';
import { InviteMoreScreen } from '../../../src/features/bookings/InviteMoreScreen';
import { colors } from '../../../src/theme/tokens';

/** Invite more players to a booking (the gate lives in the screen). */
export default function InviteMoreRoute() {
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
      <Stack.Screen options={{ headerShown: false, animation: 'slide_from_bottom' }} />
      <InviteMoreScreen bookingId={asBookingId(id)} />
    </>
  );
}
