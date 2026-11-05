// SPDX-FileCopyrightText: 2026 Cisco Systems, Inc.
// SPDX-License-Identifier: Apache-2.0

import type { LucideIcon } from 'lucide-react';

export type Health = 'healthy' | 'watch' | 'risk';
export type Trend = 'up' | 'down' | 'flat';
export type RosterStatus = 'Planned' | 'Confirmed' | 'Gap' | 'Leave';
export type IssueStatus = 'Open' | 'In Progress' | 'Closed';
export type ObjectiveScope = 'D' | 'W' | 'M';
export type ContactScope = 'Staff' | 'Vendor' | 'Key';
export type MatrixQuadrant = 'Do' | 'Delegate' | 'Delay' | 'Discard';
export type MatrixStatus = 'Not Completed' | 'Completed';
export type RecordKind = 'kpi' | 'rosterAssignment' | 'matrixTask' | 'objective' | 'issue' | 'followUp' | 'project' | 'process' | 'contact' | 'note' | 'incident';
export type IncidentPriority = 'P1' | 'P2' | 'P3' | 'P4';
export type IncidentStatus = 'Open' | 'Acknowledged' | 'Resolved' | 'Closed';

export type UserRole = 'Admin' | 'Operator' | 'Viewer';
export type UserStatus = 'active' | 'inactive';
export type AccountType = 'local' | 'ldap';

export interface AuthUser {
  id: number;
  username: string;
  email: string;
  displayName: string;
  accountType: AccountType;
  role: UserRole;
}

export interface AuthStatus {
  setupRequired: boolean;
  ldapEnabled: boolean;
  user: AuthUser | null;
}

export interface ManagedUser {
  id: number;
  username: string;
  email: string;
  displayName: string;
  accountType: AccountType;
  status: UserStatus;
  role: UserRole;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface ManagedUserList {
  users: ManagedUser[];
  roles: UserRole[];
}

export type DirectorySecurity = 'ldaps' | 'starttls' | 'none';
export type DirectoryLoginAttribute = 'sAMAccountName' | 'userPrincipalName' | 'custom';

export interface DirectorySettings {
  enabled: boolean;
  host: string;
  port: number;
  security: DirectorySecurity;
  caCert: string;
  timeoutSeconds: number;
  bindDN: string;
  baseDN: string;
  loginAttribute: DirectoryLoginAttribute;
  customFilter: string;
  requiredGroup: string;
  newUserMode: 'approval' | 'auto';
  defaultRole: UserRole;
  groupRoles: Array<{ group: string; role: UserRole }>;
}

export type DirectorySettingsDraft = DirectorySettings & { bindPassword?: string; clearBindPassword?: boolean };

export interface DirectorySettingsResponse {
  settings: DirectorySettings;
  hasBindPassword: boolean;
  locked: string[];
  updatedAt: string | null;
  updatedBy: string | null;
}

export interface DirectoryTestResult {
  ok: boolean;
  steps: Array<{ label: string; ok: boolean; detail: string }>;
}

export interface DirectoryLookupResult {
  found: boolean;
  message?: string;
  dn?: string;
  displayName?: string;
  email?: string;
  groups?: string[];
  allowed?: boolean;
  roleOnSignIn?: UserRole;
  needsApproval?: boolean;
}

export interface NavItem {
  key: string;
  label: string;
  icon: LucideIcon;
}

export interface Kpi {
  id: number;
  code: string;
  name: string;
  actual: string;
  target: string;
  health: Health;
  trend: Trend;
  delta: string;
  /** '' = health set by hand; otherwise health is calculated from actual vs target. */
  direction?: KpiDirection;
  /** Amber band, as a percentage of the target. */
  tolerance?: number;
}

export type KpiDirection = '' | 'higher' | 'lower';

export interface RosterAssignment {
  id: number;
  rosterDate: string;
  shiftName: string;
  role: string;
  analyst: string;
  status: RosterStatus;
  health: Health;
  notes: string;
}

export interface RosterLabel {
  code: string;
  label: string;
  hours: string;
  status: RosterStatus;
  health: Health;
  fill: string;
  textColor: string;
}

export interface MatrixTask {
  id: number;
  taskDate: string;
  title: string;
  lead: string;
  assignee: string;
  durationMinutes: number;
  urgency: number;
  importance: number;
  quadrant: MatrixQuadrant;
  disposition: MatrixQuadrant;
  dueTime: string;
  status: MatrixStatus;
  notes: string;
  objectiveId: number;
}

export interface ObjectiveRow {
  id: number;
  scope: ObjectiveScope;
  title: string;
  summary: string;
  owner: string;
  assignedTo: string;
  due: string;
  progress: number;
  health: Health;
  attachmentName: string;
  attachmentPath: string;
}

export interface IssueRow {
  id: number;
  scope: ObjectiveScope;
  status: IssueStatus;
  title: string;
  summary: string;
  owner: string;
  assignedTo: string;
  linkedType: '' | 'objective' | 'project';
  linkedId: number;
  due: string;
  progress: number;
  health: Health;
  createdAt?: string;
  closedAt?: string;
}

export interface FollowUp {
  id: number;
  ref: string;
  title: string;
  owner: string;
  age: string;
  health: Health;
}

export interface ProjectRow {
  id: number;
  code: string;
  name: string;
  owner: string;
  phase: string;
  due: string;
  progress: number;
  health: Health;
}

export interface ProcessRow {
  id: number;
  code: string;
  name: string;
  owner: string;
  cadence: string;
  maturity: number;
  health: Health;
  notes: string;
  attachmentName: string;
  attachmentPath: string;
}

export interface ContactRow {
  id: number;
  name: string;
  role: string;
  channel: string;
  email: string;
  phone: string;
  scope: ContactScope;
  isLead: boolean;
}

export interface NoteRow {
  id: number;
  createdAt: string;
  noteDate: string;
  text: string;
  pinned: boolean;
}

export interface FeedItem {
  time: string;
  text: string;
  health: Health;
}

export interface AdvisorBrief {
  id: number;
  createdAt: string;
  content: string;
  source: 'llm' | 'fallback';
  briefDate: string;
}

export interface IncidentRow {
  id: number;
  ref: string;
  customer: string;
  title: string;
  priority: IncidentPriority;
  category: string;
  source: string;
  status: IncidentStatus;
  analyst: string;
  occurredAt: string;
  detectedAt: string;
  acknowledgedAt: string;
  resolvedAt: string;
  notes: string;
  createdAt: string;
}

export interface SlaTarget {
  detect: number;
  ack: number;
  resolve: number;
}

export type SlaTargets = Record<IncidentPriority, SlaTarget>;

export interface ComplianceThresholds {
  /** Contracted compliance target (%): at or above is green. */
  target: number;
  /** At or above this (but below target) is amber; below is red. */
  amber: number;
}

export interface ReportSettings {
  orgName: string;
  weekendDays: number[];
  slaTargets: SlaTargets;
  compliance: ComplianceThresholds;
  /** Per-customer SLA overrides keyed by customer name. */
  customerSla: Record<string, SlaTargets>;
}

export interface AppSettings {
  extraClockZones: string[];
  llmConfigured: boolean;
  dataSource: 'server-db' | 'browser-fallback';
  rosterStaff: string[];
  rosterLabels: RosterLabel[];
  workforceChannelOrder: string[];
  reports?: ReportSettings;
}

export interface AppSnapshot {
  settings: AppSettings;
  kpis: Kpi[];
  rosterAssignments: RosterAssignment[];
  matrixTasks: MatrixTask[];
  objectives: ObjectiveRow[];
  issues: IssueRow[];
  followUps: FollowUp[];
  projects: ProjectRow[];
  processes: ProcessRow[];
  contacts: ContactRow[];
  notes: NoteRow[];
  advisorBriefs: AdvisorBrief[];
  incidents?: IncidentRow[];
}
