// SPDX-License-Identifier: Apache-2.0
import { Languages } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export function LanguageSwitcher() {
  const { t, i18n } = useTranslation();
  return (
    <label className="language-switcher">
      <Languages size={16} aria-hidden="true" />
      <span className="sr-only">{t('Language')}</span>
      <select
        aria-label={t('Language')}
        value={i18n.resolvedLanguage || 'en'}
        onChange={(event) => void i18n.changeLanguage(event.target.value)}
      >
        <option value="de" lang="de">Deutsch</option>
        <option value="en" lang="en">English</option>
      </select>
    </label>
  );
}
