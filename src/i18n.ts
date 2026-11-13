// SPDX-License-Identifier: Apache-2.0
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import en from './locales/en.json' with { type: 'json' };
import de from './locales/de.json' with { type: 'json' };

export const LANGUAGE_STORAGE_KEY = 'soc-cockpit-language';

void i18n.use(LanguageDetector).use(initReactI18next).init({
  resources: { en: { translation: en }, de: { translation: de } },
  supportedLngs: ['en', 'de'],
  fallbackLng: 'en',
  load: 'languageOnly',
  keySeparator: false,
  nsSeparator: false,
  interpolation: { escapeValue: false },
  detection: {
    order: ['localStorage', 'navigator'],
    lookupLocalStorage: LANGUAGE_STORAGE_KEY,
    caches: ['localStorage'],
  },
});

function updateDocumentLanguage() {
  if (typeof document !== 'undefined') {
    document.documentElement.lang = i18n.resolvedLanguage || 'en';
  }
}
i18n.on('languageChanged', updateDocumentLanguage);
updateDocumentLanguage();

/** Translate presentation strings only; persisted enum values stay canonical. */
export function t(text: string | undefined | null, values?: Record<string, unknown>): string {
  return text ? String(i18n.t(text, { defaultValue: text, ...values })) : '';
}

export function getLocale(): string {
  return i18n.resolvedLanguage === 'de' ? 'de-DE' : 'en-GB';
}

export default i18n;
