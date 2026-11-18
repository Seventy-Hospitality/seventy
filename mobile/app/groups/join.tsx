import { Redirect, Stack, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { useSession } from '../../src/lib/session';
import { JoinGroupScreen } from '../../src/features/groups';
import { colors } from '../../src/theme/tokens';

/**
 * Join-via-invite-link route (`/groups/join?token=...`), the target the shared
 * invite URL / QR resolves to. Anonymous callers are redirected to sign-in
 * (joining requires a signed-in member); dead links (invite_link_invalid) are handled
 * inside the screen.
 */
export default function JoinGroupRoute() {
  const { token } = useLocalSearchParams<{ token?: string }>();
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
      <JoinGroupScreen token={typeof token === 'string' ? token : null} />
    </>
  );
}
