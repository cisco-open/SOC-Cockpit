// SPDX-FileCopyrightText: 2026 Cisco Systems, Inc.
// SPDX-License-Identifier: Apache-2.0

import React from 'react';
import { useTranslation } from 'react-i18next';
import './i18n';
import ReactDOM from 'react-dom/client';
import { AuthGate } from './Auth';
import './styles.css';
import './styles.restored.css';

function LocalizedApp() {
  // Subscribe at the root so switching languages updates every module without
  // remounting it or discarding an in-progress form.
  useTranslation();
  return <AuthGate />;
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <LocalizedApp />
  </React.StrictMode>,
);
