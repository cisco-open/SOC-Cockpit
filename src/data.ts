// SPDX-FileCopyrightText: 2026 Cisco Systems, Inc.
// SPDX-License-Identifier: Apache-2.0

import {
  AlertTriangle,
  BriefcaseBusiness,
  ClipboardCheck,
  FileBarChart,
  Contact,
  Gauge,
  LayoutDashboard,
  NotebookPen,
  Radio,
  ScrollText,
  Settings,
  Users,
  Workflow,
} from 'lucide-react';
import type {
  ContactScope,
  Health,
  IssueStatus,
  MatrixQuadrant,
  MatrixStatus,
  NavItem,
  ObjectiveScope,
  RosterStatus,
  Trend,
} from './types';

export const navItems: NavItem[] = [
  { key: 'overview', label: 'Command', icon: LayoutDashboard },
  { key: 'contacts', label: 'Directory', icon: Contact },
  { key: 'workforce', label: 'Workforce', icon: Users },
  { key: 'standups', label: 'Standups', icon: ScrollText },
  { key: 'service', label: 'Service', icon: Gauge },
  { key: 'issues', label: 'Issues', icon: AlertTriangle },
  { key: 'objectives', label: 'Objectives', icon: ClipboardCheck },
  { key: 'projects', label: 'Projects', icon: BriefcaseBusiness },
  { key: 'processes', label: 'Process', icon: Workflow },
  { key: 'notes', label: 'Notes', icon: NotebookPen },
  { key: 'reports', label: 'Reports', icon: FileBarChart },
  { key: 'advisor', label: 'Executive Update', icon: Radio },
  { key: 'settings', label: 'Settings', icon: Settings },
];

export const timeZoneOptions = [
  { value: 'UTC', label: 'UTC' },
  { value: 'Europe/London', label: 'London' },
  { value: 'America/New_York', label: 'New York' },
  { value: 'America/Chicago', label: 'Chicago' },
  { value: 'America/Los_Angeles', label: 'Los Angeles' },
  { value: 'Europe/Paris', label: 'Paris' },
  { value: 'Asia/Dubai', label: 'Dubai' },
  { value: 'Asia/Singapore', label: 'Singapore' },
  { value: 'Asia/Tokyo', label: 'Tokyo' },
  { value: 'Australia/Sydney', label: 'Sydney' },
];

export const healthOptions: Health[] = ['healthy', 'watch', 'risk'];
export const issueStatusOptions: IssueStatus[] = ['Open', 'In Progress', 'Closed'];
export const trendOptions: Trend[] = ['up', 'down', 'flat'];
export const rosterStatusOptions: RosterStatus[] = ['Planned', 'Confirmed', 'Gap', 'Leave'];
export const objectiveScopeOptions: ObjectiveScope[] = ['D', 'W', 'M'];
export const contactScopeOptions: ContactScope[] = ['Staff', 'Vendor', 'Key'];
export const matrixQuadrants: MatrixQuadrant[] = ['Do', 'Delegate', 'Delay', 'Discard'];
export const matrixStatusOptions: MatrixStatus[] = ['Not Completed', 'Completed'];

export const quadrantDescriptions: Record<MatrixQuadrant, string> = {
  Do: 'Urgent and important. Manager or lead should drive now.',
  Delegate: 'Urgent but not important. Assign to the best owner.',
  Delay: 'Important but not urgent. Schedule it intentionally.',
  Discard: 'Neither urgent nor important. Drop or close it.',
};

export function toLocalDateKey(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function isoDate(offset = 0) {
  const value = new Date();
  value.setHours(0, 0, 0, 0);
  value.setDate(value.getDate() + offset);
  return toLocalDateKey(value);
}

export function nextPlanningDates(days = 7) {
  return Array.from({ length: days }, (_, index) => isoDate(index));
}
