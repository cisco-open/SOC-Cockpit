// SPDX-FileCopyrightText: 2026 Cisco Systems, Inc.
// SPDX-License-Identifier: Apache-2.0
import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';

// Render the repo-root docs directly so the site never drifts from them.
const docs = defineCollection({
  loader: glob({ pattern: ['FAQ.md'], base: '..' }),
});

export const collections = { docs };
