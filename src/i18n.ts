// SPDX-License-Identifier: Apache-2.0
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

export const LANGUAGE_STORAGE_KEY = 'soc-cockpit-language';

const loadCatalog = {
  en: () => import('./locales/en.json', { with: { type: 'json' } }).then(({ default: catalog }) => catalog),
  de: () => import('./locales/de.json', { with: { type: 'json' } }).then(({ default: catalog }) => catalog),
};

const detected = i18n.use(LanguageDetector).use(initReactI18next).init({
  resources: {},
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

export async function setLanguage(requested: string): Promise<void> {
  const language = /^de(?:-|$)/i.test(requested) ? 'de' : 'en';
  if (!i18n.hasResourceBundle(language, 'translation')) {
    i18n.addResourceBundle(language, 'translation', await loadCatalog[language]());
  }
  await i18n.changeLanguage(language);
}

function updateDocumentLanguage() {
  if (typeof document !== 'undefined') {
    document.documentElement.lang = i18n.resolvedLanguage || 'en';
  }
}
i18n.on('languageChanged', updateDocumentLanguage);

export const languageReady = detected.then(async () => {
  try {
    await setLanguage(i18n.language);
  } catch (error) {
    console.error('Could not load the selected language.', error);
    try {
      await setLanguage('en');
    } catch {
      // English source strings are available even when the catalog cannot load.
      await i18n.changeLanguage('en');
    }
  }
});

/** Translate presentation strings only; persisted enum values stay canonical. */
export function t(text: string | undefined | null, values?: Record<string, unknown>): string {
  if (!text || !i18n.exists(text, values)) return text ?? '';
  return String(i18n.t(text, { defaultValue: text, ...values }));
}

export function getLocale(browserLanguages: readonly string[] = globalThis.navigator?.languages ?? []): string {
  const language = i18n.resolvedLanguage === 'de' ? 'de' : 'en';
  for (const preference of browserLanguages) {
    const locale = new Intl.Locale(preference);
    if (locale.language === language && locale.region) {
      return `${language}-${locale.region}`;
    }
  }
  return language === 'de' ? 'de-DE' : 'en-GB';
}

export default i18n;
