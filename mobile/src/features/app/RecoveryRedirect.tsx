import { useEffect } from 'react';
import { usePathname, useRouter } from 'expo-router';
import { useSession } from '../../lib/session';

/**
 * After a password-recovery link or code the user is signed in in recovery
 * mode; hold them on /auth/set-password until a new password is saved.
 */
export function RecoveryRedirect() {
  const { passwordRecovery, status } = useSession();
  const pathname = usePathname();
  const router = useRouter();
  useEffect(() => {
    if (status === 'authenticated' && passwordRecovery && pathname !== '/auth/set-password') {
      router.replace('/auth/set-password');
    }
  }, [passwordRecovery, pathname, router, status]);
  return null;
}
