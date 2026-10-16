import { useEffect, useRef } from 'react';
import { useRouter } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { useSession } from '../../lib/session';
import { findVerificationCode } from '../account/push-verification';
import { noticeFromData, routeForNotice } from './notification-routing';

// Foreground notices show as banners; a verification push (data-only) is
// never shown.
Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const silent = findVerificationCode(notification.request.content.data) !== null;
    return {
      shouldShowBanner: !silent,
      shouldShowList: !silent,
      shouldPlaySound: false,
      shouldSetBadge: false,
    };
  },
});

/**
 * Opens the notice a member tapped: while the app runs (response listener)
 * and when the tap launched it (the last response). A tap that arrives while
 * signed out waits for the session. Each tap is handled once.
 */
export function NotificationTapRouter() {
  const router = useRouter();
  const { status } = useSession();
  const handled = useRef(new Set<string>());
  const waiting = useRef<Notifications.NotificationResponse | null>(null);

  useEffect(() => {
    const open = (response: Notifications.NotificationResponse) => {
      const id = response.notification.request.identifier;
      if (handled.current.has(id)) return;
      const notice = noticeFromData(response.notification.request.content.data);
      if (!notice) return;
      if (status !== 'authenticated') {
        waiting.current = response;
        return;
      }
      handled.current.add(id);
      waiting.current = null;
      router.push(routeForNotice(notice) as never);
    };

    if (waiting.current) open(waiting.current);
    let sub: { remove(): void } | null = null;
    try {
      void Notifications.getLastNotificationResponseAsync().then((last) => {
        if (last) open(last);
      });
      sub = Notifications.addNotificationResponseReceivedListener(open);
    } catch {
      sub = null;
    }
    return () => sub?.remove();
  }, [router, status]);

  return null;
}
