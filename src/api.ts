// SPDX-FileCopyrightText: 2026 Cisco Systems, Inc.
// SPDX-License-Identifier: Apache-2.0

import type { AppSnapshot, AuthStatus, AuthUser, DirectoryLookupResult, DirectorySettingsDraft, DirectorySettingsResponse, DirectoryTestResult, ManagedUserList, RecordKind, RosterLabel, UserRole, UserStatus } from './types';

export const AUTH_EXPIRED_EVENT = 'soc-auth-expired';

async function request<T>(input: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers ?? {});
  if (!(init?.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  // Required by the server on every state-changing request (CSRF protection).
  headers.set('X-Requested-With', 'soc-cockpit');

  let response: Response;
  try {
    response = await fetch(input, {
      ...init,
      headers,
      credentials: 'same-origin',
    });
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error('Cannot reach the SOC Cockpit API. Start the API server with npm.cmd run dev:api, or run npm.cmd run dev for the full stack.');
    }
    throw error;
  }

  if (!response.ok) {
    if (response.status === 401 && !input.startsWith('/api/auth/')) {
      window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
    }
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error ?? `Request failed with status ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export const api = {
  authStatus: () => request<AuthStatus>('/api/auth/status'),
  login: (username: string, password: string) => request<{ user: AuthUser }>('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) }),
  setup: (payload: { setupCode: string; username: string; email: string; password: string }) => request<{ user: AuthUser }>('/api/auth/setup', { method: 'POST', body: JSON.stringify(payload) }),
  logout: () => request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),
  listUsers: () => request<ManagedUserList>('/api/admin/users'),
  createUser: (payload: { username: string; email: string; password: string; role: UserRole }) => request<ManagedUserList>('/api/admin/users', { method: 'POST', body: JSON.stringify(payload) }),
  updateUser: (id: number, payload: { role?: UserRole; status?: UserStatus }) => request<ManagedUserList>(`/api/admin/users/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  getDirectorySettings: () => request<DirectorySettingsResponse>('/api/admin/directory'),
  saveDirectorySettings: (draft: DirectorySettingsDraft) => request<DirectorySettingsResponse>('/api/admin/directory', { method: 'PUT', body: JSON.stringify(draft) }),
  testDirectory: (draft: DirectorySettingsDraft) => request<DirectoryTestResult>('/api/admin/directory/test', { method: 'POST', body: JSON.stringify(draft) }),
  lookupDirectoryUser: (draft: DirectorySettingsDraft, username: string) => request<DirectoryLookupResult>('/api/admin/directory/lookup', { method: 'POST', body: JSON.stringify({ settings: draft, username }) }),
  getSnapshot: () => request<AppSnapshot>('/api/snapshot'),
  createRecord: (kind: RecordKind, payload: Record<string, unknown>) => request<AppSnapshot>(`/api/${kind}`, { method: 'POST', body: JSON.stringify(payload) }),
  deleteRecord: (kind: RecordKind, id: number) => request<AppSnapshot>(`/api/${kind}/${id}`, { method: 'DELETE' }),
  updateRecord: (kind: RecordKind, id: number, payload: Record<string, unknown>) => request<AppSnapshot>(`/api/${kind}/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  updateClockZones: (zones: string[]) => request<AppSnapshot>('/api/settings/clocks', { method: 'POST', body: JSON.stringify({ zones }) }),
  updateRosterPlannerSettings: (payload: { staff: string[]; labels: RosterLabel[]; channelOrder?: string[] }) => request<AppSnapshot>('/api/settings/roster-planner', { method: 'POST', body: JSON.stringify(payload) }),
  renameRosterStaff: (name: string, nextName: string) => request<AppSnapshot>(`/api/roster/staff/${encodeURIComponent(name)}`, { method: 'PATCH', body: JSON.stringify({ nextName }) }),
  updateRosterLabelDefinition: (code: string, payload: RosterLabel) => request<AppSnapshot>(`/api/roster/label/${encodeURIComponent(code)}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  upsertRosterPlan: (changes: Array<Record<string, unknown>>) => request<AppSnapshot>('/api/roster/planner', { method: 'POST', body: JSON.stringify({ changes }) }),
  updateMatrixTask: (id: number, payload: Record<string, unknown>) => request<AppSnapshot>(`/api/matrixTask/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  carryOverMatrixTasks: (toDate: string, fromDate?: string) => request<AppSnapshot>('/api/matrix/carry-over', { method: 'POST', body: JSON.stringify({ toDate, fromDate }) }),
  downloadStandupTemplate: async () => {
    const response = await fetch('/api/standup/template');
    if (!response.ok) {
      throw new Error(`Could not download the template (status ${response.status}).`);
    }
    return response.blob();
  },
  importStandupWorkbook: (file: File) => {
    const formData = new FormData();
    formData.append('workbook', file);
    return request<{ snapshot: AppSnapshot; added: number; updated: number; skipped: number; objectivesCreated: number; tasksLinked: number; createdObjectives: string[]; ambiguousObjectives: string[]; errors: string[] }>('/api/standup/import', { method: 'POST', body: formData });
  },
  uploadObjectiveDocument: (id: number, file: File) => {
    const formData = new FormData();
    formData.append('document', file);
    return request<AppSnapshot>(`/api/objective/${id}/document`, { method: 'POST', body: formData });
  },
  uploadProcessDocument: (id: number, file: File) => {
    const formData = new FormData();
    formData.append('document', file);
    return request<AppSnapshot>(`/api/process/${id}/document`, { method: 'POST', body: formData });
  },
  generateAdvisorBrief: (date?: string) => request<AppSnapshot>('/api/advisor/generate', { method: 'POST', body: JSON.stringify({ date }) }),
  answerQuestion: (messages: Array<{ role: 'user' | 'assistant'; content: string }>) =>
    request<{ answer: string }>('/api/assistant/chat', { method: 'POST', body: JSON.stringify({ messages }) }),
};
