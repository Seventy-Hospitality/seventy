/**
 * Public surface of the account feature. The Account tab renders
 * AccountScreen; the routes under app/account/** render the sub-screens. The
 * auth screens (sign in/up, callback, forgot/set password) also live in this
 * directory and are imported directly by their routes.
 *
 * PushRegistrationSync belongs once inside the signed-in shell (the tabs
 * layout) so this install is registered for push on every launch.
 */
export { AccountScreen } from './AccountScreen';
export { BillingScreen } from './BillingScreen';
export { PreferencesScreen } from './PreferencesScreen';
export { PaymentMethodScreen } from './PaymentMethodScreen';
export { ChangeMembershipScreen } from './ChangeMembershipScreen';
export { DeleteAccountScreen } from './DeleteAccountScreen';
export { SignInMethodsScreen } from './SignInMethodsScreen';

export {
  PushRegistrationSync,
  requestPushResync,
  unregisterPushForSignOut,
  usePushRegistration,
} from './usePushRegistration';
export { useSignOut } from './useSignOut';
export { refreshMembershipState } from './account-data';

export * from './account-lib';
