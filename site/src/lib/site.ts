// SPDX-FileCopyrightText: 2026 Cisco Systems, Inc.
// SPDX-License-Identifier: Apache-2.0
import type { ImageMetadata } from 'astro';

export const REPO = 'https://github.com/cisco-open/SOC-Cockpit';
export const VERSION = '0.1.0';

export function url(path = ''): string {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  return `${base}/${path.replace(/^\//, '')}`;
}

export const nav = [
  { href: '', label: 'Overview' },
  { href: 'tour/', label: 'Tour' },
  { href: 'get-started/', label: 'Get started' },
  { href: 'faq/', label: 'FAQ' },
  { href: 'community/', label: 'Community' },
];

const images = import.meta.glob<ImageMetadata>('../../../docs/images/*.png', {
  eager: true,
  import: 'default',
});

function shot(file: string): ImageMetadata {
  const image = images[`../../../docs/images/${file}`];
  if (!image) throw new Error(`Missing screenshot: docs/images/${file}`);
  return image;
}

export const screens = [
  {
    id: 'dashboard',
    title: 'Command dashboard',
    image: shot('01-command-dashboard.png'),
    text: 'A one-page operational picture: SOC readiness, SLA/KPI health, live risks and decisions, sub-team and 24/7 shift coverage, and leave/workload.',
  },
  {
    id: 'directory',
    title: 'Directory',
    image: shot('02-directory.png'),
    text: 'The team and contact directory, grouped by channel — analysts, leads, vendors and key stakeholders in one place.',
  },
  {
    id: 'roster',
    title: 'Workforce rotation planner',
    image: shot('03-workforce-roster.png'),
    text: 'Future-dated shift roster across teams, so coverage gaps surface while there is still time to fix them.',
  },
  {
    id: 'standups',
    title: 'Daily stand-ups',
    image: shot('04-standups.png'),
    text: 'Stand-up and stand-down tasks captured against Do / Delegate / Delay / Discard, each with a lead, duration, status and optional link to an objective.',
  },
  {
    id: 'kpis',
    title: 'KPI & SLA service register',
    image: shot('05-service-kpis.png'),
    text: 'KPIs and SLAs tracked continuously against target with trend and health, so reporting becomes an export rather than a rebuild.',
  },
  {
    id: 'issues',
    title: 'Issue register',
    image: shot('06-issues.png'),
    text: 'Operational issues with status, owner, due date and progress, colour-coded by health so the risks stand out.',
  },
  {
    id: 'objectives',
    title: 'Objectives',
    image: shot('07-objectives.png'),
    text: 'Objectives tracked with scope, owner, assignee, due date, progress and health — and linked to the day-to-day tasks that move them forward.',
  },
  {
    id: 'projects',
    title: 'Projects',
    image: shot('08-projects.png'),
    text: 'Longer-running projects with owner, phase, due date and progress at a glance.',
  },
  {
    id: 'process',
    title: 'Process inventory',
    image: shot('09-process.png'),
    text: "The SOC's processes with owner, cadence and a maturity score, so gaps in operational rigour are visible.",
  },
  {
    id: 'executive',
    title: 'Executive update',
    image: shot('10-executive-update.png'),
    text: 'An automatically assembled management brief — bottom line, wins, concerns, decisions — generated from live cockpit data, with a local fallback when no LLM is configured.',
  },
  {
    id: 'settings',
    title: 'Settings',
    image: shot('11-settings.png'),
    text: 'Server and LLM status, world clocks, display preferences, and tunable SOC readiness scoring levers.',
  },
];
