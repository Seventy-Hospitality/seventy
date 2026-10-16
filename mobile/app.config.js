/**
 * Expo config: app.json plus what depends on build-time env.
 *
 * Google only redirects an installed app to its reversed client id scheme
 * (com.googleusercontent.apps.<id>), so each configured Google client id
 * adds that scheme next to the app's own `seventy` scheme.
 */
const { expo } = require('./app.json');

function reversed(clientId) {
  return clientId.trim().split('.').reverse().join('.');
}

module.exports = () => {
  const googleIds = [process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID, process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID]
    .filter((id) => id && id.trim())
    .map(reversed);
  const schemes = [...new Set([expo.scheme, ...googleIds])];
  return { ...expo, scheme: schemes.length === 1 ? schemes[0] : schemes };
};
