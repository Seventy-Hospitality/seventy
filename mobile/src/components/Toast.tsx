import { useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors, fonts, radius, shadows, spacing } from '../theme/tokens';
import {
  ToastContext,
  ToastHostContext,
  type ActiveToast,
  type ToastOptions,
  type ToastVariant,
} from './toast-context';

const ICONS: Record<ToastVariant, keyof typeof Ionicons.glyphMap> = {
  success: 'checkmark-circle',
  error: 'alert-circle',
  info: 'information-circle',
};

const ACCENTS: Record<ToastVariant, string> = {
  success: colors.success,
  error: colors.danger,
  info: colors.accent,
};

/** Mounts once at the app root; exposes useToast() to the whole tree. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<ActiveToast | null>(null);
  /** Hosts mounted inside open modals (sheets); the root host waits while any are. */
  const [overlays, setOverlays] = useState(0);
  const translateY = useRef(new Animated.Value(-120)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nextId = useRef(0);

  const hide = useCallback(() => {
    Animated.parallel([
      Animated.timing(translateY, { toValue: -120, duration: 220, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 0, duration: 220, useNativeDriver: true }),
    ]).start(() => setCurrent(null));
  }, [opacity, translateY]);

  const toast = useCallback(
    ({ message, variant = 'info', duration = 3200 }: ToastOptions) => {
      if (timer.current) clearTimeout(timer.current);
      nextId.current += 1;
      setCurrent({ id: nextId.current, message, variant });
      translateY.setValue(-120);
      opacity.setValue(0);
      Animated.parallel([
        Animated.spring(translateY, { toValue: 0, useNativeDriver: true, bounciness: 6 }),
        Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: true }),
      ]).start();
      timer.current = setTimeout(hide, duration);
    },
    [hide, opacity, translateY],
  );

  // Clear the pending auto-dismiss on unmount so a fired timer never calls
  // setState on a torn-down tree (a leak that also crashes jest post-teardown).
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const registerOverlay = useCallback(() => {
    setOverlays((n) => n + 1);
    return () => setOverlays((n) => n - 1);
  }, []);

  const value = useMemo(() => ({ toast }), [toast]);
  const host = useMemo(
    () => ({ current, translateY, opacity, registerOverlay }),
    [current, translateY, opacity, registerOverlay],
  );

  return (
    <ToastContext.Provider value={value}>
      <ToastHostContext.Provider value={host}>
        {children}
        {overlays === 0 ? <ToastView /> : null}
      </ToastHostContext.Provider>
    </ToastContext.Provider>
  );
}

/**
 * Draws the current toast inside a RN <Modal>, which otherwise covers the
 * root one. Sheet mounts it while open, so callers need nothing extra.
 */
export function ToastHost() {
  const host = useContext(ToastHostContext);
  const register = host?.registerOverlay;
  useEffect(() => register?.(), [register]);
  return host ? <ToastView /> : null;
}

function ToastView() {
  const host = useContext(ToastHostContext);
  const insets = useSafeAreaInsets();
  if (!host?.current) return null;
  const { current, opacity, translateY } = host;
  return (
    <Animated.View
      pointerEvents="none"
      accessibilityLiveRegion="polite"
      style={[styles.container, { top: insets.top + spacing.sm, opacity, transform: [{ translateY }] }]}
    >
      <View style={styles.toast}>
        <Ionicons name={ICONS[current.variant]} size={20} color={ACCENTS[current.variant]} />
        <Text style={styles.message} numberOfLines={3}>
          {current.message}
        </Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    alignItems: 'center',
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    maxWidth: 480,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceOverlay,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadows.soft,
  },
  message: {
    flex: 1,
    color: colors.text,
    fontFamily: fonts.bodyMedium,
    fontSize: 14,
  },
});
