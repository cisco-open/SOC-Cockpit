// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { t, getLocale, languageReady, setLanguage } from '../src/i18n.ts';
import { formatDate, formatPeriod, formatPercent } from '../src/reportCalc.ts';

const en = JSON.parse(readFileSync(new URL('../src/locales/en.json', import.meta.url)));
const de = JSON.parse(readFileSync(new URL('../src/locales/de.json', import.meta.url)));

test('DE and EN catalogs have matching keys and interpolation variables', () => {
  assert.deepEqual(Object.keys(de).sort(), Object.keys(en).sort());
  const variables = (text) => [...text.matchAll(/{{(\w+)}}/g)].map((match) => match[1]).sort();
  for (const key of Object.keys(en)) {
    assert.ok(de[key].trim(), `Empty translation: ${key}`);
    assert.deepEqual(variables(de[key]), variables(en[key]), `Interpolation mismatch: ${key}`);
  }
});

test('language switches translate login, status and handover without changing canonical values', async () => {
  await languageReady;
  const status = 'Completed';
  await setLanguage('de');
  assert.equal(t('Sign in'), 'Anmelden');
  assert.equal(t('Shift Handover Report'), 'Schichtübergabebericht');
  assert.equal(t(status), 'Erledigt');
  assert.equal(status, 'Completed');
  assert.equal(t('Edit {{value0}}', { value0: 'SOC Alpha' }), 'SOC Alpha bearbeiten');
  assert.equal(t('customerCount', { count: 1 }), '1 Kunde');
  assert.equal(t('customerCount', { count: 3 }), '3 Kunden');
  assert.equal(getLocale([]), 'de-DE');
  await setLanguage('en');
  assert.equal(t('Sign in'), 'Sign in');
  assert.equal(t(status), 'Completed');
  assert.equal(getLocale([]), 'en-GB');
});

test('regional languages resolve to supported languages, unknown text stays readable', async () => {
  await setLanguage('de-AT');
  assert.equal(t('Reports'), 'Berichte');
  assert.equal(t('Unknown server message'), 'Unknown server message');
  const diagnostic = 'Unrecognised imported value: $t(Open)';
  assert.equal(t(diagnostic), diagnostic);
  assert.equal(t('{{customer}} – customer-specific SLA', { customer: '$t(Open)' }), '$t(Open) – kundenspezifisches SLA');
  await setLanguage('fr');
  assert.equal(t('Reports'), 'Reports');
  assert.equal(getLocale([]), 'en-GB');
});

test('report dates and numbers use the chosen locale', () => {
  assert.match(formatDate('2026-03-05', 'de-DE'), /März/);
  assert.match(formatPeriod({ from: '2026-03-01', to: '2026-03-31' }, 'de-DE'), /März/);
  assert.equal(formatPercent(97.5, 'de-DE'), '97,5%');
  assert.equal(formatPercent(97.5, 'en-GB'), '97.5%');
});
