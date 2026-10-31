// SPDX-FileCopyrightText: 2026 Cisco Systems, Inc.
// SPDX-License-Identifier: Apache-2.0
import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://cisco-open.github.io',
  base: '/SOC-Cockpit',
  trailingSlash: 'ignore',
  devToolbar: { enabled: false },
  vite: {
    // Screenshots and fonts are shared with the app at the repo root.
    server: { fs: { allow: ['..'] } },
  },
});
