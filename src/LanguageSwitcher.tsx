// SPDX-License-Identifier: Apache-2.0
import { Languages } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { setLanguage } from './i18n';

export function LanguageSwitcher() {
  const { t, i18n } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  async function switchLanguage(language: string) {
    setLoading(true);
    setFailed(false);
    try {
      await setLanguage(language);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }

  return (
    <label className="language-switcher">
      <Languages size={16} aria-hidden="true" />
      <span className="sr-only">{t('Language')}</span>
      <select
        aria-label={t('Language')}
        value={i18n.resolvedLanguage || 'en'}
        disabled={loading}
        onChange={(event) => void switchLanguage(event.target.value)}
      >
        <option value="de" lang="de">Deutsch</option>
        <option value="en" lang="en">English</option>
      </select>
      {failed ? <span role="status">{t('Could not load the selected language.')}</span> : null}
    </label>
  );
}
