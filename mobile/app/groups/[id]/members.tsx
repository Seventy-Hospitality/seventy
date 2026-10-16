import { Redirect, Stack, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { useSession } from '../../../src/lib/session';
import { GroupMembersScreen } from '../../../src/features/groups';
import { colors } from '../../../src/theme/tokens';
import { asGroupId } from '../../../src/lib/clutch';

/**
 * Group members route (Figma members 105:6876). Anonymous callers are redirected
 * to sign-in; the not-a-member state is handled inside the screen.
 */
export default function GroupMembersRoute() {
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
      <GroupMembersScreen groupId={asGroupId(id)} />
    </>
  );
}
