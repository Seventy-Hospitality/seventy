import 'react-native-gesture-handler';
import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { useFonts } from 'expo-font';
import { QueryClientProvider } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ToastProvider } from '../src/components/Toast';
import { queryClient } from '../src/lib/query-client';
import { SessionProvider } from '../src/lib/session';
import { StripeAppProvider } from '../src/lib/stripe';
import { ClubCheck } from '../src/features/app/ClubCheck';
import { RecoveryRedirect } from '../src/features/app/RecoveryRedirect';
import { PushRegistrationSync } from '../src/features/account/usePushRegistration';
import { NotificationTapRouter } from '../src/features/notifications/NotificationTapRouter';
import { colors, fontAssets, fonts } from '../src/theme/tokens';

// Baseline family for any Text without an explicit fontFamily, so stray copy
// still renders Inter rather than the system font.
(Text as unknown as { defaultProps?: { style?: unknown } }).defaultProps = {
  ...(Text as unknown as { defaultProps?: object }).defaultProps,
  style: { fontFamily: fonts.body, color: colors.text },
};

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts(fontAssets);

  useEffect(() => {
    if (fontError) {
      // Non-fatal: fall back to the baseline font rather than blocking boot.
      console.warn('Font loading failed', fontError);
    }
  }, [fontError]);

  if (!fontsLoaded && !fontError) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg }}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <StripeAppProvider>
            <SessionProvider>
              <ToastProvider>
                <StatusBar style="light" backgroundColor={colors.bg} />
                <ClubCheck>
                  <RecoveryRedirect />
                  {/* Signed-in anywhere (onboarding included), not only in the tabs. */}
                  <PushRegistrationSync />
                  <NotificationTapRouter />
                  <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }} />
                </ClubCheck>
              </ToastProvider>
            </SessionProvider>
          </StripeAppProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
