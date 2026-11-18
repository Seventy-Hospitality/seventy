import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';
import { colors, radius } from '../../theme/tokens';

/** court_type -> Ionicons glyph; a calendar for a sport the app does not know. */
const ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  tennis: 'tennisball-outline',
  pickleball: 'tennisball-outline',
  padel: 'tennisball-outline',
  badminton: 'tennisball-outline',
  squash: 'tennisball-outline',
  basketball: 'basketball-outline',
  volleyball: 'basketball-outline',
};

export function sportGlyph(courtType: string): keyof typeof Ionicons.glyphMap {
  return ICONS[courtType.toLowerCase()] ?? 'calendar-outline';
}

/** The bare glyph, for composing inside a caller-provided tile. */
export function SportIcon({ sport, size = 22 }: { sport: string; size?: number }) {
  return <Ionicons name={sportGlyph(sport)} size={size} color={colors.accent} />;
}

/** Tinted square tile wrapping the sport glyph (Reserve rows and cards). */
export function SportTile({ sport, size = 46 }: { sport: string; size?: number }) {
  return (
    <View style={[styles.tile, { width: size, height: size }]}>
      <SportIcon sport={sport} size={Math.round(size * 0.48)} />
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceOverlay,
  },
});
