/**
 * Seventy's public pages and contact address, in one place. The legal pages
 * open in the in-app browser; "Contact us" opens the mail app.
 */
import { Linking } from 'react-native';
import * as WebBrowser from 'expo-web-browser';

export const LEGAL_URLS = {
  privacy: 'https://seventyhospitality.com/privacy.html',
  terms: 'https://seventyhospitality.com/terms.html',
} as const;

export const CONTACT_EMAIL = 'contact@seventyhospitality.com';

export function openLegalPage(page: keyof typeof LEGAL_URLS): Promise<unknown> {
  return WebBrowser.openBrowserAsync(LEGAL_URLS[page]).catch(() => undefined);
}

export function openContactEmail(): Promise<unknown> {
  return Linking.openURL(`mailto:${CONTACT_EMAIL}`).catch(() => undefined);
}
