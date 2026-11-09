/**
 * Where a tapped push notice opens. Clutch's notice push carries
 * `data: {notificationId, type, clubId, link}` (feat/expo-push PushData),
 * and `link` is the web path that shows it: today always the inbox
 * ("/notifications"). The app has its own inbox screen, so every notice opens
 * it with the tapped notice in focus; a link the app does not know also lands
 * there rather than nowhere. The verification push is data-only and never
 * shown, so it is never tapped.
 */
import { PushNoticeDataSchema, type PushNoticeData } from '../../lib/clutch';

export const INBOX_ROUTE = '/account/notifications';

/** The Clutch notice in a tapped notification's data, or null for anything else. */
export function noticeFromData(data: unknown): PushNoticeData | null {
  const parsed = PushNoticeDataSchema.safeParse(data);
  return parsed.success ? parsed.data : null;
}

/** The app route for a notice. */
export function routeForNotice(notice: PushNoticeData): { pathname: string; params: { focus: string } } {
  return { pathname: INBOX_ROUTE, params: { focus: notice.notificationId } };
}
