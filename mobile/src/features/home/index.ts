/**
 * Public surface of the home feature. The Home tab route renders HomeScreen;
 * its reads are the shared queries in lib/queries.ts.
 */
export { HomeScreen } from './HomeScreen';
export { orderAnnouncements, orderInvitations, respondFailure, tierDetail } from './home-data';
export {
  firstNameOf,
  greetingEyebrow,
  homeLayout,
  timeOfDay,
  type HomeLayout,
  type TimeOfDay,
} from './home-sections';
