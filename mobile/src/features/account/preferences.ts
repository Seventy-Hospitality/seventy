/**
 * The notification matrix Clutch stores: six categories x (push, email, sms),
 * plus smsPhone. PUT /me/preferences is a full replace, so every write sends
 * the whole matrix, keeping the categories and channels the app does not
 * show exactly as Clutch has them.
 *
 * Club 70 shows the categories that happen at the club (bookings,
 * announcements, messages, promotions) on push and email. Tournaments and
 * leagues are not part of the app; SMS is not offered (no phone capture).
 * Hidden categories still count wherever the app asks "does this member want
 * push at all" (their defaults are Clutch's, not ours).
 */
import { NotificationPreferencesSchema, type NotificationPreferences } from '../../lib/clutch';

export type NotificationCategory = Exclude<keyof NotificationPreferences, 'smsPhone'>;
export type NotificationChannel = 'push' | 'email' | 'sms';

/**
 * Every category in the contract, read off the generated schema so a category
 * Clutch adds is counted without an app change.
 */
export const NOTIFICATION_CATEGORIES = Object.keys(NotificationPreferencesSchema.shape).filter(
  (key): key is NotificationCategory => key !== 'smsPhone',
);

export const SHOWN_CATEGORIES: readonly { category: NotificationCategory; label: string; hint: string }[] = [
  { category: 'bookings', label: 'Bookings', hint: 'Confirmations, reminders and invitations' },
  { category: 'clubAnnouncements', label: 'Club announcements', hint: 'News from Club70' },
  { category: 'messages', label: 'Messages', hint: 'From your groups and other members' },
  { category: 'promotions', label: 'Promotions', hint: 'Offers and events' },
];

export const SHOWN_CHANNELS: readonly { channel: Exclude<NotificationChannel, 'sms'>; label: string }[] = [
  { channel: 'push', label: 'Push' },
  { channel: 'email', label: 'Email' },
];

/** True when the member wants push for any category, shown or hidden. */
export function anyPushOn(prefs: NotificationPreferences): boolean {
  return NOTIFICATION_CATEGORIES.some((category) => prefs[category].push);
}

/** The full matrix with one cell changed; everything else is carried over. */
export function withToggle(
  prefs: NotificationPreferences,
  category: NotificationCategory,
  channel: NotificationChannel,
  value: boolean,
): NotificationPreferences {
  return { ...prefs, [category]: { ...prefs[category], [channel]: value } };
}
