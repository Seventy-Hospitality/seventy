/**
 * Expo config: app.json plus what depends on build-time env.
 *
 * Google only redirects an installed app to its reversed client id scheme
 * (com.googleusercontent.apps.<id>), so each configured Google client id
 * adds that scheme next to the app's own `seventy` scheme.
 *
 * The app's own `seventy` scheme carries deep links (group invite links,
 * Stripe's return URL); no sign-in comes back through it.
 *
 * CLUB70_LOCAL_E2E=1 builds a release app that may speak plain http, for the
 * end-to-end run against a local Clutch stack (e2e/README.md). Release builds
 * refuse cleartext otherwise; never set it for a build that ships.
 */
const { withAndroidManifest } = require('expo/config-plugins');
const { expo } = require('./app.json');

function reversed(clientId) {
  return clientId.trim().split('.').reverse().join('.');
}

function withLocalCleartext(config) {
  return withAndroidManifest(config, (mod) => {
    mod.modResults.manifest.application[0].$['android:usesCleartextTraffic'] = 'true';
    return mod;
  });
}

module.exports = () => {
  const googleIds = [process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID, process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID]
    .filter((id) => id && id.trim())
    .map(reversed);
  const schemes = [...new Set([expo.scheme, ...googleIds])];
  const config = { ...expo, scheme: schemes.length === 1 ? schemes[0] : schemes };
  return process.env.CLUB70_LOCAL_E2E === '1' ? withLocalCleartext(config) : config;
};
