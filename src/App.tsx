// SPDX-FileCopyrightText: 2026 Cisco Systems, Inc.
// SPDX-License-Identifier: Apache-2.0

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  ArrowDownRight,
  ArrowUpRight,
  Building2,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Database,
  Download,
  Gauge,
  Globe,
  LogOut,
  Maximize2,
  MessageCircle,
  Minus,
  LayoutGrid,
  List,
  Minimize2,
  Palette,
  Paperclip,
  Pencil,
  Pin,
  Plus,
  Printer,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  Users,
} from 'lucide-react';
import ciscoLogo from './assets/Cisco_Logo_no_TM_White-RGB.svg';
import { api } from './api';
import {
  ReadinessGauge,
  SlaHeatmap,
  RiskDecisions,
  StandupDailyTrend,
  CoverageTreemap,
  CoverageHeatStrip,
  LeaveWorkload,
  EisenhowerSnapshot,
  ObjectivesProjects,
  MaturityRadar,
} from './CommandWidgets';
import {
  contactScopeOptions,
  healthOptions,
  isoDate,
  issueStatusOptions,
  matrixQuadrants,
  matrixStatusOptions,
  navItems,
  nextPlanningDates,
  objectiveScopeOptions,
  quadrantDescriptions,
  rosterStatusOptions,
  timeZoneOptions,
  toLocalDateKey,
  trendOptions,
} from './data';
import { UserManagementTab } from './UserAdmin';
import { DirectorySettingsPanel } from './DirectorySettings';
import type { AppSnapshot, AuthUser, FeedItem, Health, IssueRow, IssueStatus, MatrixQuadrant, MatrixStatus, ProjectRow, RecordKind, RosterAssignment, RosterLabel, Trend } from './types';

type ActiveView = 'overview' | 'workforce' | 'standups' | 'service' | 'issues' | 'objectives' | 'projects' | 'processes' | 'contacts' | 'notes' | 'advisor' | 'settings';

type SettingsTab = 'appearance' | 'clocks' | 'readiness' | 'system' | 'users' | 'directory';

const settingsTabs: Array<{ key: SettingsTab; label: string; icon: typeof Palette; adminOnly?: boolean }> = [
  { key: 'appearance', label: 'Appearance', icon: Palette },
  { key: 'clocks', label: 'World clocks', icon: Clock3, adminOnly: true },
  { key: 'readiness', label: 'Readiness levers', icon: Gauge, adminOnly: true },
  { key: 'system', label: 'System status', icon: Database, adminOnly: true },
  { key: 'users', label: 'User Management', icon: Users, adminOnly: true },
  { key: 'directory', label: 'Company Directory (LDAP / AD)', icon: Building2, adminOnly: true },
];

type WorkforcePlannerRow = {
  id: number;
  name: string;
  role: string;
  channel: string;
  isLead: boolean;
};

type WorkforcePlannerGroup = {
  channel: string;
  staff: WorkforcePlannerRow[];
};

type EditState = {
  kpi: number | null;
  matrixTask: number | null;
  objective: number | null;
  issue: number | null;
  followUp: number | null;
  project: number | null;
  process: number | null;
  contact: number | null;
  note: number | null;
  staff: string | null;
  rosterLabel: string | null;
};

const defaultEditState: EditState = {
  kpi: null,
  matrixTask: null,
  objective: null,
  issue: null,
  followUp: null,
  project: null,
  process: null,
  contact: null,
  note: null,
  staff: null,
  rosterLabel: null,
};

const defaultRosterForm = { rosterDate: isoDate(0), shiftName: 'Day', role: '', analyst: '', status: 'Planned', health: 'healthy' as Health, notes: '' };
const defaultMatrixForm = { taskDate: isoDate(0), title: '', lead: '', assignee: '', durationMinutes: 0, urgency: true, importance: true, dueTime: '', status: 'Not Completed' as MatrixStatus, notes: '', objectiveId: 0 };
const defaultObjectiveForm = { scope: 'D', title: '', summary: '', owner: '', assignedTo: '', due: '', progress: 0, health: 'watch' as Health };
const defaultIssueForm = { scope: 'D', status: 'Open' as IssueStatus, title: '', summary: '', owner: '', assignedTo: '', linkedType: '' as '' | 'objective' | 'project', linkedId: 0, due: '', progress: 0, health: 'watch' as Health };
const defaultFollowUpForm = { ref: '', title: '', owner: '', age: '', health: 'watch' as Health };
const defaultProjectForm = { code: '', name: '', owner: '', phase: '', due: '', progress: 0, health: 'watch' as Health };
const defaultProcessForm = { code: '', name: '', owner: '', cadence: '', maturity: 0, health: 'watch' as Health, notes: '' };
const defaultContactForm = { name: '', role: '', channel: '', email: '', phone: '', scope: 'Staff', isLead: false };
const defaultNoteForm = { noteDate: isoDate(0), text: '', pinned: false };
const defaultKpiForm = { code: '', name: '', actual: '', target: '', delta: '', trend: 'flat' as Trend, health: 'watch' as Health };
const defaultRosterLabelForm: RosterLabel = { code: '', label: '', hours: '07:00-19:00', status: 'Confirmed', health: 'healthy', fill: '#32b7c6', textColor: '#ffffff' };
const DOCUMENT_UPLOAD_MAX_MB = 20;

function plannerKey(analyst: string, rosterDate: string) {
  return `${analyst}__${rosterDate}`;
}

function monthDates(anchorDate: string) {
  const value = new Date(`${anchorDate}T00:00:00`);
  value.setDate(1);
  const month = value.getMonth();
  const dates: string[] = [];
  while (value.getMonth() === month) {
    dates.push(toLocalDateKey(value));
    value.setDate(value.getDate() + 1);
  }
  return dates;
}

function shiftMonth(anchorDate: string, delta: number) {
  const value = new Date(`${anchorDate}T00:00:00`);
  value.setDate(1);
  value.setMonth(value.getMonth() + delta);
  return toLocalDateKey(value);
}

function monthLabel(anchorDate: string) {
  return new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' }).format(new Date(`${anchorDate}T00:00:00`));
}

function dayLabel(anchorDate: string) {
  return new Intl.DateTimeFormat('en-GB', { weekday: 'short' }).format(new Date(`${anchorDate}T00:00:00`));
}

function shiftDay(anchorDate: string, delta: number) {
  const value = new Date(`${anchorDate}T00:00:00`);
  value.setDate(value.getDate() + delta);
  return toLocalDateKey(value);
}

function daysAround(anchorDate: string, before: number, after: number) {
  const dates: string[] = [];
  for (let offset = -before; offset <= after; offset += 1) {
    dates.push(shiftDay(anchorDate, offset));
  }
  return dates;
}

function shortDateLabel(anchorDate: string) {
  return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short' }).format(new Date(`${anchorDate}T00:00:00`));
}

function dayNumberLabel(anchorDate: string) {
  return new Intl.DateTimeFormat('en-GB', { day: '2-digit' }).format(new Date(`${anchorDate}T00:00:00`));
}

function shortMonthLabel(anchorDate: string) {
  return new Intl.DateTimeFormat('en-GB', { month: 'short' }).format(new Date(`${anchorDate}T00:00:00`));
}

function isDateKey(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function objectiveDueLabel(value: string) {
  return isDateKey(value) ? shortDateLabel(value) : value;
}

function isIssueClosed(status: IssueStatus) {
  return status === 'Closed';
}

function fallbackPlannerLabel(assignment: RosterAssignment): RosterLabel {
  const fills: Record<Health, string> = {
    healthy: '#32b7c6',
    watch: '#f1a31d',
    risk: '#e44336',
  };

  return {
    code: assignment.shiftName.slice(0, 8).toUpperCase(),
    label: assignment.role || assignment.shiftName,
    hours: assignment.notes,
    status: assignment.status,
    health: assignment.health,
    fill: fills[assignment.health],
    textColor: '#ffffff',
  };
}

function dot(health: Health) {
  return <span className={`dot ${health}`} aria-hidden="true" />;
}

function TrendGlyph({ trend }: { trend: Trend }) {
  if (trend === 'up') {
    return <ArrowUpRight size={13} aria-hidden="true" />;
  }
  if (trend === 'down') {
    return <ArrowDownRight size={13} aria-hidden="true" />;
  }
  return <Minus size={13} aria-hidden="true" />;
}

function Panel({ title, meta, span = 4, className, children }: { title: string; meta?: ReactNode; span?: number; className?: string; children: ReactNode }) {
  return (
    <section className={className ? `panel ${className}` : 'panel'} style={{ gridColumn: `span ${span}` }}>
      <header className="panel-head">
        <h2>{title}</h2>
        {meta ? <div className="panel-meta">{meta}</div> : null}
      </header>
      <div className="panel-body">{children}</div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function ToggleSwitch({ checked, onChange, ariaLabel }: { checked: boolean; onChange: (next: boolean) => void; ariaLabel: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={ariaLabel} className={checked ? 'switch on' : 'switch'} onClick={() => onChange(!checked)}>
      <span className="switch-knob" />
    </button>
  );
}

function DeleteButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button type="button" className="icon-btn danger" onClick={onClick} title={label} aria-label={label}>
      <Trash2 size={14} />
    </button>
  );
}

function EditButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button type="button" className="icon-btn" onClick={onClick} title={label} aria-label={label}>
      <Pencil size={14} />
    </button>
  );
}

function toWhatsAppLink(phone: string): string {
  const raw = String(phone || '').trim();
  if (!raw) {
    return '';
  }
  const digits = raw.replace(/\D/g, '');
  if (!digits) {
    return '';
  }
  if (raw.startsWith('+')) {
    return `https://wa.me/${digits}`;
  }
  if (raw.startsWith('00')) {
    return `https://wa.me/${digits.slice(2)}`;
  }
  if (/^\d{8,15}$/.test(digits) && !raw.startsWith('0')) {
    return `https://wa.me/${digits}`;
  }
  return '';
}

function AdvisorMarkdown({ content, emptyText, compact = false }: { content?: string | null; emptyText: string; compact?: boolean }) {
  if (!content) {
    return <p>{emptyText}</p>;
  }

  return (
    <div className={compact ? 'brief-markdown compact' : 'brief-markdown'}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  );
}

const KEO_FOCUS_QUESTION = 'As the SOC readiness advisor, analyse the current cockpit data and tell me the top 3 things I (the SOC manager) should focus on TODAY to increase SOC readiness. Return a numbered list of exactly 3 items. For each item give a short bold action followed by one concise sentence explaining how it raises readiness, referencing the specific gap, at-risk item, KPI, or coverage issue in the data. No preamble.';

const KEO_FOLLOWUP_QUESTION = 'Analyse the standup / Eisenhower tasks and daily notes from the last several days in the cockpit data and tell me the top 3 follow-ups I should conduct now. Return a numbered list of exactly 3 items. For each, give a short bold follow-up action followed by one concise sentence citing the standup task or note it stems from. No preamble.';

const KEO_CACHE_TTL = 24 * 60 * 60 * 1000;

function readKeoCache(cacheKey: string): { answer: string; ts: number } | null {
  try {
    const raw = localStorage.getItem(`keo-insight:${cacheKey}`);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.answer === 'string' && typeof parsed.ts === 'number') {
      return parsed;
    }
  } catch {
    // ignore malformed cache
  }
  return null;
}

function writeKeoCache(cacheKey: string, answer: string) {
  try {
    localStorage.setItem(`keo-insight:${cacheKey}`, JSON.stringify({ answer, ts: Date.now() }));
  } catch {
    // storage unavailable; skip caching
  }
}

function KeoInsight({ question, enabled, cacheKey }: { question: string; enabled: boolean; cacheKey: string }) {
  const [loading, setLoading] = useState(false);
  const [answer, setAnswer] = useState<string | null>(() => readKeoCache(cacheKey)?.answer ?? null);
  const [error, setError] = useState<string | null>(null);
  const [stamp, setStamp] = useState<number | null>(() => readKeoCache(cacheKey)?.ts ?? null);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    const cached = readKeoCache(cacheKey);
    if (cached) {
      setAnswer(cached.answer);
      setStamp(cached.ts);
      if (Date.now() - cached.ts < KEO_CACHE_TTL) {
        return;
      }
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    api.answerQuestion([{ role: 'user', content: question }])
      .then(({ answer: reply }) => {
        if (cancelled) {
          return;
        }
        setAnswer(reply);
        setStamp(Date.now());
        writeKeoCache(cacheKey, reply);
      })
      .catch((caught) => {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : 'Keo request failed.');
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [cacheKey, enabled, question]);

  async function refresh() {
    if (loading) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { answer: reply } = await api.answerQuestion([{ role: 'user', content: question }]);
      setAnswer(reply);
      setStamp(Date.now());
      writeKeoCache(cacheKey, reply);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Keo request failed.');
    } finally {
      setLoading(false);
    }
  }

  if (!enabled) {
    return <div className="widget-empty">Keo is unavailable — configure the LLM to enable analysis.</div>;
  }

  return (
    <div className="keo-insight">
      {answer ? (
        <div className="keo-insight-body"><AdvisorMarkdown content={answer} emptyText="" compact /></div>
      ) : (
        <p className="keo-insight-hint">{loading ? 'Keo is analysing the cockpit…' : 'Keo will analyse the cockpit shortly.'}</p>
      )}
      {error ? <div className="assistant-error">{error}</div> : null}
      <div className="keo-insight-foot">
        <span className="keo-insight-stamp">{stamp ? `Updated ${formatStamp(new Date(stamp).toISOString())}` : ''}</span>
        <button type="button" className="ghost-btn keo-insight-btn" onClick={() => void refresh()} disabled={loading} title="Refresh now">
          <RefreshCw size={12} /> {loading ? 'Analysing…' : 'Refresh'}
        </button>
      </div>
    </div>
  );
}

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

function formatClock(now: Date, timeZone?: string) {
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    ...(timeZone ? { timeZone } : {}),
  }).format(now);
}

function formatDate(now: Date, timeZone?: string) {
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    ...(timeZone ? { timeZone } : {}),
  }).format(now);
}

function formatStamp(value: string) {
  return new Date(value).toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function monthInputValue(anchorDate: string) {
  return anchorDate.slice(0, 7);
}

function monthKeyLabel(anchorDate: string) {
  return new Intl.DateTimeFormat('en-GB', { month: 'short', year: 'numeric' }).format(new Date(`${anchorDate}T00:00:00`));
}

function formatMinutes(value: number) {
  return value > 0 ? String(value) : '';
}

function zoneLabel(zone: string) {
  return timeZoneOptions.find((item) => item.value === zone)?.label ?? zone;
}

function resolveQuadrant(urgency: boolean, importance: boolean): MatrixQuadrant {
  if (urgency && importance) return 'Do';
  if (urgency && !importance) return 'Delegate';
  if (!urgency && importance) return 'Delay';
  return 'Discard';
}

function buildFeed(snapshot: AppSnapshot): FeedItem[] {
  const feed: Array<FeedItem & { order: number }> = [];
  snapshot.matrixTasks.slice(0, 6).forEach((item) => {
    feed.push({
      time: item.dueTime || 'All day',
      text: `${item.quadrant}: ${item.title}`,
      health: item.quadrant === 'Do' ? 'risk' : item.quadrant === 'Delegate' ? 'watch' : 'healthy',
      order: new Date(`${item.taskDate}T00:00:00`).getTime(),
    });
  });
  snapshot.notes.slice(0, 3).forEach((item) => {
    feed.push({
      time: formatStamp(item.createdAt),
      text: item.text,
      health: item.pinned ? 'watch' : 'healthy',
      order: new Date(item.createdAt).getTime(),
    });
  });
  snapshot.advisorBriefs.slice(0, 1).forEach((item) => {
    feed.push({
      time: formatStamp(item.createdAt),
      text: `${item.source === 'llm' ? 'LLM' : 'Fallback'} executive update created`,
      health: 'healthy',
      order: new Date(item.createdAt).getTime(),
    });
  });
  return feed.sort((left, right) => right.order - left.order).slice(0, 8);
}

type ReadinessLevers = {
  floor: number;
  gapPenalty: number;
  atRiskPenalty: number;
  atRiskCap: number;
  openIssuePenalty: number;
  openIssueCap: number;
};

const defaultReadinessLevers: ReadinessLevers = { floor: 54, gapPenalty: 14, atRiskPenalty: 4, atRiskCap: 16, openIssuePenalty: 3, openIssueCap: 12 };

const readinessLeverDefs: Array<{ key: keyof ReadinessLevers; label: string; min: number; max: number; hint: string }> = [
  { key: 'floor', label: 'Minimum score', min: 0, max: 90, hint: 'The readiness score never drops below this value.' },
  { key: 'gapPenalty', label: 'Staffing gap penalty', min: 0, max: 30, hint: 'Points removed for each open staffing gap on the planning date.' },
  { key: 'atRiskPenalty', label: 'At-risk item penalty', min: 0, max: 15, hint: 'Points removed for each at-risk objective, project or issue.' },
  { key: 'atRiskCap', label: 'At-risk penalty cap', min: 0, max: 40, hint: 'Maximum total points that at-risk items can remove.' },
  { key: 'openIssuePenalty', label: 'Open issue penalty', min: 0, max: 15, hint: 'Points removed for each open issue.' },
  { key: 'openIssueCap', label: 'Open issue penalty cap', min: 0, max: 40, hint: 'Maximum total points that open issues can remove.' },
];

function computeSummary(snapshot: AppSnapshot, planningDate: string, levers: ReadinessLevers = defaultReadinessLevers) {
  const rosterForDate = snapshot.rosterAssignments.filter((item) => item.rosterDate === planningDate);
  const gaps = rosterForDate.filter((item) => item.status === 'Gap').length;
  const confirmed = rosterForDate.filter((item) => item.status === 'Confirmed').length;
  const planned = rosterForDate.filter((item) => item.status === 'Planned').length;
  const leave = rosterForDate.filter((item) => item.status === 'Leave').length;
  const todayTasks = snapshot.matrixTasks.filter((item) => item.taskDate === planningDate);
  const doCount = todayTasks.filter((item) => item.quadrant === 'Do' && item.status !== 'Completed').length;
  const issues = snapshot.issues ?? [];
  const openIssues = issues.filter((item) => !isIssueClosed(item.status)).length;
  const atRisk = snapshot.objectives.filter((item) => item.health === 'risk').length + snapshot.projects.filter((item) => item.health === 'risk').length + issues.filter((item) => item.health === 'risk').length;
  const score = Math.max(levers.floor, 100 - gaps * levers.gapPenalty - Math.min(atRisk * levers.atRiskPenalty, levers.atRiskCap) - Math.min(openIssues * levers.openIssuePenalty, levers.openIssueCap));
  return { gaps, confirmed, planned, leave, doCount, atRisk, openIssues, score, rosterForDate };
}

export function App({ user, onSignOut }: { user: AuthUser; onSignOut: () => void }) {
  const now = useClock();
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('appearance');
  const isAdmin = user.role === 'Admin';
  const [snapshot, setSnapshot] = useState<AppSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState<ActiveView>('overview');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [planningDate, setPlanningDate] = useState(isoDate(0));
  const [clockZones, setClockZones] = useState(['UTC', 'America/New_York']);
  const [rosterForm, setRosterForm] = useState(defaultRosterForm);
  const [matrixForm, setMatrixForm] = useState(defaultMatrixForm);
  const [objectiveForm, setObjectiveForm] = useState(defaultObjectiveForm);
  const [issueForm, setIssueForm] = useState(defaultIssueForm);
  const [followUpForm, setFollowUpForm] = useState(defaultFollowUpForm);
  const [projectForm, setProjectForm] = useState(defaultProjectForm);
  const [processForm, setProcessForm] = useState(defaultProcessForm);
  const [processFile, setProcessFile] = useState<File | null>(null);
  const [objectiveFile, setObjectiveFile] = useState<File | null>(null);
  const [contactForm, setContactForm] = useState(defaultContactForm);
  const [noteForm, setNoteForm] = useState(defaultNoteForm);
  const [kpiForm, setKpiForm] = useState(defaultKpiForm);
  const [plannerEditMode, setPlannerEditMode] = useState(false);
  const panelsDefaultCollapsedInitial = typeof window !== 'undefined' && localStorage.getItem('soc-panels-collapsed-default') === 'true';
  const [controlsCollapsed, setControlsCollapsed] = useState(panelsDefaultCollapsedInitial);
  const [panelsCollapsedByDefault, setPanelsCollapsedByDefault] = useState<boolean>(panelsDefaultCollapsedInitial);
  const [issueIntakeCollapsed, setIssueIntakeCollapsed] = useState(panelsDefaultCollapsedInitial);
  const [objectiveIntakeCollapsed, setObjectiveIntakeCollapsed] = useState(panelsDefaultCollapsedInitial);
  const [projectIntakeCollapsed, setProjectIntakeCollapsed] = useState(panelsDefaultCollapsedInitial);
  const [contactIntakeCollapsed, setContactIntakeCollapsed] = useState(panelsDefaultCollapsedInitial);
  const [kpiIntakeCollapsed, setKpiIntakeCollapsed] = useState(panelsDefaultCollapsedInitial);
  const [processIntakeCollapsed, setProcessIntakeCollapsed] = useState(panelsDefaultCollapsedInitial);
  const [selectedRosterCode, setSelectedRosterCode] = useState('__clear__');
  const [rosterLabelForm, setRosterLabelForm] = useState(defaultRosterLabelForm);
  const [plannerDraft, setPlannerDraft] = useState<Record<string, RosterLabel | null>>({});
  const [draggingAnalyst, setDraggingAnalyst] = useState<string | null>(null);
  const [editing, setEditing] = useState<EditState>(defaultEditState);
  const [notesDraft, setNotesDraft] = useState<{ id: number; text: string } | null>(null);
  const [expandedObjectives, setExpandedObjectives] = useState<Set<number>>(() => new Set());
  const [expandedIssues, setExpandedIssues] = useState<Set<number>>(() => new Set());
  const [advisorDate, setAdvisorDate] = useState(isoDate(0));
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [assistantMessages, setAssistantMessages] = useState<Array<{ role: 'user' | 'assistant'; content: string }>>([]);
  const [assistantInput, setAssistantInput] = useState('');
  const [assistantBusy, setAssistantBusy] = useState(false);
  const [assistantError, setAssistantError] = useState<string | null>(null);
  const [assistantExpanded, setAssistantExpanded] = useState(false);
  const [theme, setTheme] = useState<'day' | 'night'>(() => (typeof window === 'undefined' ? 'day' : ((localStorage.getItem('soc-theme') as 'day' | 'night') ?? 'day')));
  const [registerView, setRegisterView] = useState<'list' | 'tiles'>(() => (typeof window === 'undefined' ? 'list' : ((localStorage.getItem('soc-register-view') as 'list' | 'tiles') ?? 'list')));
  const [readinessLevers, setReadinessLevers] = useState<ReadinessLevers>(() => {
    if (typeof window === 'undefined') return defaultReadinessLevers;
    try {
      const raw = localStorage.getItem('soc-readiness-levers');
      if (raw) return { ...defaultReadinessLevers, ...JSON.parse(raw) };
    } catch { /* ignore malformed storage */ }
    return defaultReadinessLevers;
  });
  const assistantLogRef = useRef<HTMLDivElement>(null);
  const matrixTitleRef = useRef<HTMLTextAreaElement>(null);
  const standupFileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (assistantLogRef.current) {
      assistantLogRef.current.scrollTop = assistantLogRef.current.scrollHeight;
    }
  }, [assistantMessages, assistantBusy, assistantOpen]);

  function resetNoteForm() {
    setNoteForm((current) => ({ ...defaultNoteForm, noteDate: current.noteDate }));
  }

  function resetMatrixForm(taskDate = planningDate) {
    setMatrixForm({ ...defaultMatrixForm, taskDate });
  }

  function setEditor<K extends keyof EditState>(key: K, value: EditState[K]) {
    setEditing((current) => ({ ...current, [key]: value }));
  }

  function applyPanelDefaultCollapsed(next: boolean) {
    setPanelsCollapsedByDefault(next);
    setControlsCollapsed(next);
    setIssueIntakeCollapsed(next);
    setObjectiveIntakeCollapsed(next);
    setProjectIntakeCollapsed(next);
    setContactIntakeCollapsed(next);
    setKpiIntakeCollapsed(next);
    setProcessIntakeCollapsed(next);
  }

  function toggleObjective(id: number) {
    setExpandedObjectives((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function toggleIssue(id: number) {
    setExpandedIssues((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function openLinkedTarget(type: 'objective' | 'project', id: number) {
    if (type === 'objective') {
      setExpandedObjectives((current) => new Set(current).add(id));
      setActive('objectives');
    } else {
      setActive('projects');
    }
  }

  function openReferencingIssues(ids: number[]) {
    setExpandedIssues(new Set(ids));
    setActive('issues');
  }

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const next = await api.getSnapshot();
      const nextRosterLabels = next.settings.rosterLabels ?? [];
      setSnapshot(next);
      setClockZones(next.settings.extraClockZones);
      setSelectedRosterCode((current) => nextRosterLabels.some((item) => item.code === current) ? current : (nextRosterLabels[0]?.code ?? '__clear__'));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Failed to load SOC Cockpit data.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('soc-theme', theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem('soc-register-view', registerView);
  }, [registerView]);

  useEffect(() => {
    localStorage.setItem('soc-panels-collapsed-default', String(panelsCollapsedByDefault));
  }, [panelsCollapsedByDefault]);

  useEffect(() => {
    localStorage.setItem('soc-readiness-levers', JSON.stringify(readinessLevers));
  }, [readinessLevers]);

  async function mutate(action: string, work: () => Promise<AppSnapshot>) {
    setBusy(action);
    setError(null);
    try {
      const next = await work();
      const nextRosterLabels = next.settings.rosterLabels ?? [];
      setSnapshot(next);
      setClockZones(next.settings.extraClockZones);
      setSelectedRosterCode((current) => nextRosterLabels.some((item) => item.code === current) ? current : (nextRosterLabels[0]?.code ?? '__clear__'));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Action failed.');
    } finally {
      setBusy(null);
    }
  }

  async function createRecord(kind: RecordKind, payload: Record<string, unknown>, reset: () => void) {
    await mutate(`create-${kind}`, () => api.createRecord(kind, payload));
    reset();
  }

  async function deleteRecord(kind: RecordKind, id: number) {
    await mutate(`delete-${kind}-${id}`, () => api.deleteRecord(kind, id));
  }

  async function saveRecord(kind: RecordKind, id: number, payload: Record<string, unknown>, afterSave?: () => void) {
    await mutate(`update-${kind}-${id}`, () => api.updateRecord(kind, id, payload));
    afterSave?.();
  }

  async function updateMatrixTask(id: number, payload: Record<string, unknown>) {
    await mutate(`matrix-${id}`, () => api.updateMatrixTask(id, payload));
  }

  async function carryOverIncompleteTasks() {
    const target = planningDate;
    const sourceDate = Array.from(new Set(
      snapshot?.matrixTasks
        .filter((item) => item.taskDate < target && item.status !== 'Completed')
        .map((item) => item.taskDate) ?? [],
    )).sort((left, right) => right.localeCompare(left))[0];

    if (!sourceDate) {
      window.alert('No incomplete standup tasks were found on any previous day to carry over.');
      return;
    }

    const pending = snapshot?.matrixTasks.filter((item) => item.taskDate === sourceDate && item.status !== 'Completed') ?? [];
    const confirmed = window.confirm(
      `Carry over ${pending.length} incomplete task(s) from ${shortDateLabel(sourceDate)} into ${shortDateLabel(target)}?\n\n`
      + 'The incomplete tasks will be copied into the selected day as "Not Completed". The original tasks stay unchanged, and duplicates already on the target day are skipped.',
    );
    if (!confirmed) {
      return;
    }

    await mutate('carry-over-tasks', () => api.carryOverMatrixTasks(target, sourceDate));
  }

  async function downloadStandupTemplate() {
    setError(null);
    try {
      const blob = await api.downloadStandupTemplate();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'soc-standup-template.xlsx';
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not download the standup template.');
    }
  }

  async function importStandupWorkbook(file: File) {
    setBusy('import-standup');
    setError(null);
    try {
      const result = await api.importStandupWorkbook(file);
      setSnapshot(result.snapshot);
      const lines = [
        `Imported ${result.added} new standup task(s).`,
        `Updated ${result.updated} existing task(s) from the sheet.`,
        `Skipped ${result.skipped} invalid row(s).`,
      ];
      if (result.objectivesCreated || result.tasksLinked) {
        lines.push(`Created ${result.objectivesCreated} new objective(s); linked ${result.tasksLinked} task(s) to objectives.`);
      }
      if (result.createdObjectives?.length) {
        lines.push('', 'New objectives:', ...result.createdObjectives.slice(0, 10));
        if (result.createdObjectives.length > 10) {
          lines.push(`…and ${result.createdObjectives.length - 10} more.`);
        }
      }
      if (result.ambiguousObjectives?.length) {
        lines.push('', 'Objectives skipped (multiple existing matches — link manually):', ...result.ambiguousObjectives.slice(0, 10));
      }
      if (result.errors.length) {
        lines.push('', 'Notes:', ...result.errors.slice(0, 15));
        if (result.errors.length > 15) {
          lines.push(`…and ${result.errors.length - 15} more.`);
        }
      }
      window.alert(lines.join('\n'));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Standup import failed.');
    } finally {
      setBusy(null);
    }
  }

  async function saveClockZones() {
    await mutate('clock-zones', () => api.updateClockZones(clockZones));
  }

  async function generateAdvisorBrief(date?: string) {
    await mutate('advisor-brief', () => api.generateAdvisorBrief(date));
  }

  async function sendAssistant() {
    const question = assistantInput.trim();
    if (!question || assistantBusy) {
      return;
    }
    const nextMessages = [...assistantMessages, { role: 'user' as const, content: question }];
    setAssistantMessages(nextMessages);
    setAssistantInput('');
    setAssistantBusy(true);
    setAssistantError(null);
    try {
      const { answer } = await api.answerQuestion(nextMessages.slice(-12));
      setAssistantMessages((current) => [...current, { role: 'assistant', content: answer }]);
    } catch (caught) {
      setAssistantError(caught instanceof Error ? caught.message : 'Assistant request failed.');
    } finally {
      setAssistantBusy(false);
    }
  }

  async function uploadProcessDocument(id: number, file: File, afterUpload?: () => void) {
    await mutate(`process-document-${id}`, () => api.uploadProcessDocument(id, file));
    afterUpload?.();
  }

  async function uploadObjectiveDocument(id: number, file: File, afterUpload?: () => void) {
    await mutate(`objective-document-${id}`, () => api.uploadObjectiveDocument(id, file));
    afterUpload?.();
  }

  async function saveRosterPlannerSettings(nextStaff: string[], nextLabels: RosterLabel[], nextChannelOrder = snapshot?.settings.workforceChannelOrder ?? []) {
    await mutate('roster-planner-settings', () => api.updateRosterPlannerSettings({ staff: nextStaff, labels: nextLabels, channelOrder: nextChannelOrder }));
  }

  async function renamePlannerStaff(previousName: string, nextName: string, afterSave?: () => void) {
    await mutate(`rename-staff-${previousName}`, () => api.renameRosterStaff(previousName, nextName));
    afterSave?.();
  }

  async function updatePlannerLabel(previousCode: string, payload: RosterLabel, afterSave?: () => void) {
    await mutate(`update-label-${previousCode}`, () => api.updateRosterLabelDefinition(previousCode, payload));
    afterSave?.();
  }

  async function flushPlannerDraft() {
    const entries = Object.entries(plannerDraft);
    setDraggingAnalyst(null);
    if (entries.length === 0) {
      return;
    }
    const changes = entries.map(([key, label]) => {
      const [analyst, rosterDate] = key.split('__');
      return label
        ? { analyst, rosterDate, code: label.code, label: label.label, hours: label.hours, status: label.status, health: label.health }
        : { analyst, rosterDate, clear: true };
    });
    setPlannerDraft({});
    await mutate('roster-planner', () => api.upsertRosterPlan(changes));
  }

  useEffect(() => {
    if (!draggingAnalyst) {
      return;
    }

    function handleMouseUp() {
      void flushPlannerDraft();
    }

    window.addEventListener('mouseup', handleMouseUp);
    return () => window.removeEventListener('mouseup', handleMouseUp);
  }, [draggingAnalyst, plannerDraft]);

  const planningDates = useMemo(() => nextPlanningDates(10), []);
  const standupDates = useMemo(() => daysAround(planningDate, 3, 6), [planningDate]);
  const summary = useMemo(() => (snapshot ? computeSummary(snapshot, planningDate, readinessLevers) : null), [snapshot, planningDate, readinessLevers]);
  const feed = useMemo(() => (snapshot ? buildFeed(snapshot) : []), [snapshot]);
  const plannerMonthDates = useMemo(() => monthDates(planningDate), [planningDate]);
  const todayIso = isoDate(0);
  const noteMonthDates = useMemo(() => monthDates(noteForm.noteDate), [noteForm.noteDate]);
  const notesForSelectedDate = useMemo(() => snapshot?.notes.filter((item) => item.noteDate === noteForm.noteDate) ?? [], [snapshot, noteForm.noteDate]);
  const pinnedNotesForSelectedDate = useMemo(() => notesForSelectedDate.filter((item) => item.pinned), [notesForSelectedDate]);
  const rosterLabels = snapshot?.settings.rosterLabels ?? [];
  const staffContacts = useMemo(() => {
    if (!snapshot) {
      return [];
    }
    return snapshot.contacts.filter((item) => item.scope === 'Staff' && item.name);
  }, [snapshot]);
  const rosterStaff = useMemo(() => {
    if (!snapshot) {
      return [];
    }
    const merged = new Set(staffContacts.map((item) => item.name));
    snapshot.rosterAssignments.forEach((item) => {
      if (item.analyst && item.analyst !== 'Unassigned') {
        merged.add(item.analyst);
      }
    });
    return Array.from(merged);
  }, [snapshot, staffContacts]);
  const workforceGroups = useMemo<WorkforcePlannerGroup[]>(() => {
    if (!snapshot) {
      return [];
    }

    const contactsByName = new Map(staffContacts.map((item) => [item.name, item]));
    const grouped = new Map<string, WorkforcePlannerRow[]>();
    rosterStaff.forEach((name, index) => {
      const contact = contactsByName.get(name);
      const channel = contact?.channel?.trim() || 'Unassigned sub team';
      const row: WorkforcePlannerRow = {
        id: contact?.id ?? -index - 1,
        name,
        role: contact?.role ?? '',
        channel,
        isLead: Boolean(contact?.isLead),
      };
      grouped.set(channel, [...(grouped.get(channel) ?? []), row]);
    });

    const configuredOrder = snapshot.settings.workforceChannelOrder.filter((channel) => grouped.has(channel));
    const unorderedChannels = Array.from(grouped.keys()).filter((channel) => !configuredOrder.includes(channel)).sort((left, right) => left.localeCompare(right, 'en-GB'));
    return [...configuredOrder, ...unorderedChannels].map((channel) => ({
      channel,
      staff: (grouped.get(channel) ?? []).sort((left, right) => Number(right.isLead) - Number(left.isLead) || left.name.localeCompare(right.name, 'en-GB')),
    }));
  }, [snapshot, rosterStaff, staffContacts]);
  const leadNames = useMemo(() => Array.from(new Set(staffContacts.filter((item) => item.isLead).map((item) => item.name))).sort((left, right) => left.localeCompare(right, 'en-GB')), [staffContacts]);
  const assigneeNames = useMemo(() => Array.from(new Set(staffContacts.map((item) => item.name))).sort((left, right) => left.localeCompare(right, 'en-GB')), [staffContacts]);
  const rosterCellMap = useMemo(() => {
    const map = new Map<string, RosterAssignment>();
    snapshot?.rosterAssignments.forEach((item) => {
      const key = plannerKey(item.analyst, item.rosterDate);
      if (!map.has(key)) {
        map.set(key, item);
      }
    });
    return map;
  }, [snapshot]);

  if (loading || !snapshot || !summary) {
    return (
      <div className="loading-screen">
        <RefreshCw className="spin" size={18} />
        <span>Loading SOC Cockpit...</span>
      </div>
    );
  }

  const app = snapshot;
  const currentSummary = summary;
  const latestBrief = app.advisorBriefs[0] ?? null;
  const matrixForDate = app.matrixTasks.filter((item) => item.taskDate === planningDate);
  const standupGroups = Array.from(matrixForDate.reduce((groups, item) => {
    const key = item.lead || 'Unassigned lead';
    const existing = groups.get(key) ?? [];
    existing.push(item);
    groups.set(key, existing);
    return groups;
  }, new Map<string, typeof matrixForDate>()).entries()).sort((left, right) => left[0].localeCompare(right[0], 'en-GB'));
  const noteDatesInMonth = new Set(app.notes.filter((item) => item.noteDate.startsWith(`${monthInputValue(noteForm.noteDate)}-`)).map((item) => item.noteDate));
  const dbConnected = app.settings.dataSource === 'server-db';
  const llmConnected = app.settings.llmConfigured;
  const topClocks = [
    { label: 'Local', zone: undefined },
    { label: zoneLabel(app.settings.extraClockZones[0]), zone: app.settings.extraClockZones[0] },
    { label: zoneLabel(app.settings.extraClockZones[1]), zone: app.settings.extraClockZones[1] },
  ];

  function renderAdvisorMeta(actionLabel: 'Refresh' | 'Generate', withDate = false) {
    const loading = busy === 'advisor-brief';
    return (
      <div className="advisor-meta">
        {loading ? (
          <div className="advisor-progress" aria-live="polite" aria-label="Advisor refresh in progress">
            <span className="advisor-progress-label">Processing</span>
            <span className="advisor-progress-bar" aria-hidden="true"><span className="advisor-progress-fill" /></span>
          </div>
        ) : null}
        {withDate ? <input type="date" className="advisor-date" value={advisorDate} max={isoDate(0)} onChange={(event) => setAdvisorDate(event.target.value)} disabled={loading} title="Executive update date" /> : null}
        <button className="ghost-btn" type="button" onClick={() => void generateAdvisorBrief(withDate ? advisorDate : isoDate(0))} disabled={loading}><Sparkles size={12} /> {actionLabel}</button>
      </div>
    );
  }

  function renderOverview() {
    const cards: { title: string; tag: string; body: ReactNode; className?: string }[] = [
      { title: "Keo · Today's Focus", tag: 'Keo · Readiness', body: <KeoInsight enabled={llmConnected} cacheKey="focus" question={KEO_FOCUS_QUESTION} /> },
      { title: 'Keo · Follow-ups', tag: 'Keo · Standups', body: <KeoInsight enabled={llmConnected} cacheKey="followups" question={KEO_FOLLOWUP_QUESTION} /> },
      { title: 'Standup Task Trend', tag: 'Process · 30 Days', body: <StandupDailyTrend app={app} /> },
      { title: 'SOC Readiness', tag: 'Service · Business', body: <ReadinessGauge score={currentSummary.score} gaps={currentSummary.gaps} atRisk={currentSummary.atRisk} openIssues={currentSummary.openIssues} /> },
      { title: 'SLA / KPI Health', tag: 'Technology · Service', body: <SlaHeatmap app={app} /> },
      { title: 'Risk & Decisions', tag: 'Business', body: <RiskDecisions app={app} /> },
      { title: 'Sub Team Coverage', tag: 'People', body: <CoverageTreemap app={app} planningDate={planningDate} /> },
      { title: 'TM Shift Coverage', tag: 'People · TM 24/7', body: <CoverageHeatStrip app={app} planningDate={planningDate} /> },
      { title: 'Leave & Workload', tag: 'People', body: <LeaveWorkload app={app} planningDate={planningDate} /> },
      { title: 'Eisenhower Focus', tag: 'Process', body: <EisenhowerSnapshot app={app} planningDate={planningDate} /> },
      { title: 'Objectives & Projects', tag: 'Business', body: <ObjectivesProjects app={app} /> },
      { title: 'Process Maturity', tag: 'Process', body: <MaturityRadar app={app} /> },
    ];

    return (
      <div className="command-grid">
        {cards.map((card) => (
          <section className={card.className ? `command-card ${card.className}` : 'command-card'} key={card.title}>
            <header>
              <h3>{card.title}</h3>
              <span className="cmm-tag">{card.tag}</span>
            </header>
            <div className="command-body">{card.body}</div>
          </section>
        ))}
      </div>
    );
  }

  function renderWorkforce() {
    const filledCells = plannerMonthDates.reduce((count, rosterDate) => count + rosterStaff.filter((analyst) => rosterCellMap.has(plannerKey(analyst, rosterDate))).length, 0);

    function resolveCellLabel(analyst: string, rosterDate: string) {
      const key = plannerKey(analyst, rosterDate);
      if (Object.prototype.hasOwnProperty.call(plannerDraft, key)) {
        return plannerDraft[key];
      }
      const assignment = rosterCellMap.get(key);
      if (!assignment) {
        return null;
      }
      return rosterLabels.find((item) => item.code === assignment.shiftName) ?? fallbackPlannerLabel(assignment);
    }

    function stagePlannerCell(analyst: string, rosterDate: string) {
      const nextLabel = selectedRosterCode === '__clear__' ? null : rosterLabels.find((item) => item.code === selectedRosterCode) ?? null;
      const key = plannerKey(analyst, rosterDate);
      setPlannerDraft((current) => {
        const staged = current[key];
        const existing = rosterCellMap.get(key);
        const currentCode = staged === undefined
          ? (existing ? (rosterLabels.find((item) => item.code === existing.shiftName) ?? fallbackPlannerLabel(existing)).code : null)
          : (staged?.code ?? null);

        if (currentCode === (nextLabel?.code ?? null)) {
          return current;
        }
        return { ...current, [key]: nextLabel };
      });
    }

    async function moveChannel(channel: string, direction: -1 | 1) {
      const currentOrder = workforceGroups.map((group) => group.channel);
      const currentIndex = currentOrder.indexOf(channel);
      const nextIndex = currentIndex + direction;
      if (currentIndex < 0 || nextIndex < 0 || nextIndex >= currentOrder.length) {
        return;
      }
      const nextOrder = [...currentOrder];
      [nextOrder[currentIndex], nextOrder[nextIndex]] = [nextOrder[nextIndex], nextOrder[currentIndex]];
      await saveRosterPlannerSettings(rosterStaff, rosterLabels, nextOrder);
    }

    function printPlannerExport() {
      const cleanup = () => {
        document.body.classList.remove('print-workforce');
      };
      document.body.classList.add('print-workforce');
      window.addEventListener('afterprint', cleanup, { once: true });
      window.print();
      setTimeout(cleanup, 1500);
    }

    async function addRosterLabel() {
      const nextCode = rosterLabelForm.code.trim().toUpperCase();
      const nextLabel = rosterLabelForm.label.trim();
      if (!nextCode || !nextLabel || rosterLabels.some((item) => item.code === nextCode)) {
        return;
      }
      await saveRosterPlannerSettings(rosterStaff, [...rosterLabels, { ...rosterLabelForm, code: nextCode, label: nextLabel }]);
      setRosterLabelForm(defaultRosterLabelForm);
      setSelectedRosterCode(nextCode);
    }

    async function saveRosterLabel() {
      if (!editing.rosterLabel) {
        return;
      }
      await updatePlannerLabel(editing.rosterLabel, { ...rosterLabelForm, code: rosterLabelForm.code.trim().toUpperCase(), label: rosterLabelForm.label.trim() }, () => {
        setRosterLabelForm(defaultRosterLabelForm);
        setEditor('rosterLabel', null);
      });
    }

    return (
      <div className={controlsCollapsed ? 'workforce-layout collapsed' : 'workforce-layout'}>
        <Panel title="Rotation planner" span={10} className="workforce-planner" meta={<span className="muted">drag across a staff row to fill the month</span>}>
          <div className="planner-toolbar">
            <div className="planner-toolbar-group">
              <button type="button" className="ghost-btn" onClick={() => setPlanningDate(shiftMonth(planningDate, -1))}>Prev month</button>
              <strong className="planner-month">{monthLabel(planningDate)}</strong>
              <button type="button" className="ghost-btn" onClick={() => setPlanningDate(shiftMonth(planningDate, 1))}>Next month</button>
            </div>
            <div className="planner-toolbar-group right">
              <span className="muted">{rosterStaff.length} staff · {filledCells} assigned cells</span>
              <button type="button" className="ghost-btn" onClick={printPlannerExport}>Export PDF</button>
              <button type="button" className={plannerEditMode ? 'primary-btn' : 'ghost-btn'} onClick={() => setPlannerEditMode((current) => !current)}>
                {plannerEditMode ? 'Exit edit mode' : 'Enter edit mode'}
              </button>
            </div>
          </div>

          <div className="planner-print-key" aria-label="Planner legend">
            {rosterLabels.map((item) => (
              <div className="planner-print-key-item" key={item.code}>
                <span className="planner-print-key-swatch" style={{ backgroundColor: item.fill, color: item.textColor }}>{item.code}</span>
                <span className="planner-print-key-text">{item.label}{item.hours ? ` · ${item.hours}` : ''}</span>
              </div>
            ))}
          </div>

          <div className="planner-grid-shell">
            <table className="planner-grid">
              <thead>
                <tr>
                  <th className="planner-staff-head">Staff</th>
                  {plannerMonthDates.map((rosterDate) => (
                    <th key={rosterDate} className={`planner-day-head${rosterDate === planningDate ? ' active' : ''}${rosterDate === todayIso ? ' today' : ''}`}>
                      <span>{dayLabel(rosterDate)}</span>
                      <strong>{dayNumberLabel(rosterDate)}</strong>
                      <small>{shortMonthLabel(rosterDate)}</small>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {workforceGroups.map((group) => (
                  <Fragment key={group.channel}>
                    <tr className="planner-channel-row">
                      <th className="planner-channel-name">{group.channel}</th>
                      <td className="planner-channel-fill" colSpan={plannerMonthDates.length}>{group.staff.length} staff</td>
                    </tr>
                    {group.staff.map((member) => (
                      <tr key={member.name}>
                        <th className="planner-staff-name" title={`${member.name}${member.role ? ` · ${member.role}` : ''}`}>
                          <span>{member.name}</span>
                          {member.isLead ? <small>Lead</small> : null}
                        </th>
                        {plannerMonthDates.map((rosterDate) => {
                          const label = resolveCellLabel(member.name, rosterDate);
                          const isEditingRow = draggingAnalyst === member.name;
                          return (
                            <td
                              key={rosterDate}
                              className={`${plannerEditMode ? `planner-cell editable${isEditingRow ? ' dragging' : ''}` : 'planner-cell'}${rosterDate === todayIso ? ' today' : ''}`}
                              style={label ? { backgroundColor: label.fill, color: label.textColor } : undefined}
                              onMouseDown={(event) => {
                                if (!plannerEditMode) {
                                  setPlanningDate(rosterDate);
                                  return;
                                }
                                event.preventDefault();
                                setDraggingAnalyst(member.name);
                                stagePlannerCell(member.name, rosterDate);
                              }}
                              onMouseEnter={() => {
                                if (plannerEditMode && draggingAnalyst === member.name) {
                                  stagePlannerCell(member.name, rosterDate);
                                }
                              }}
                              title={label ? `${member.name} · ${rosterDate} · ${label.label} ${label.hours ? `(${label.hours})` : ''}` : `${member.name} · ${rosterDate} · Unassigned`}
                            >
                              <span className="planner-cell-code">{label?.code ?? ''}</span>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
          <div className="planner-footnote">Edit mode applies the currently selected label by click-dragging across one staff row at a time. Choose Clear in the palette to wipe cells.</div>
        </Panel>
        {controlsCollapsed ? (
          <aside className="workforce-controls-rail">
            <button type="button" className="controls-rail-btn" onClick={() => setControlsCollapsed(false)} title="Expand planner controls" aria-label="Expand planner controls">
              <ChevronLeft size={16} />
              <span className="controls-rail-label">Planner controls</span>
            </button>
          </aside>
        ) : (
        <Panel title="Planner controls" span={2} className="workforce-controls" meta={<button type="button" className="icon-btn" onClick={() => setControlsCollapsed(true)} title="Collapse controls" aria-label="Collapse controls"><ChevronRight size={14} /></button>}>
          <div className="planner-side">
            <section className="planner-side-section">
              <div className="planner-side-title">Fill palette</div>
              <div className="planner-palette">
                <button type="button" className={selectedRosterCode === '__clear__' ? 'palette-btn active clear' : 'palette-btn clear'} onClick={() => setSelectedRosterCode('__clear__')}>
                  <span className="palette-swatch empty" />
                  <span>Clear</span>
                </button>
                {rosterLabels.map((item) => (
                  <button key={item.code} type="button" className={selectedRosterCode === item.code ? 'palette-btn active' : 'palette-btn'} onClick={() => setSelectedRosterCode(item.code)}>
                    <span className="palette-swatch" style={{ backgroundColor: item.fill, color: item.textColor }}>{item.code}</span>
                    <span>{item.label}</span>
                    <small>{item.hours || item.status}</small>
                  </button>
                ))}
              </div>
            </section>

            <section className="planner-side-section">
              <div className="planner-side-title">Create shift label</div>
              <div className="form-stack compact">
                <div className="form-grid two">
                  <Field label="Code"><input value={rosterLabelForm.code} onChange={(event) => setRosterLabelForm({ ...rosterLabelForm, code: event.target.value.toUpperCase() })} placeholder="D12" maxLength={8} /></Field>
                  <Field label="Label"><input value={rosterLabelForm.label} onChange={(event) => setRosterLabelForm({ ...rosterLabelForm, label: event.target.value })} placeholder="Day" /></Field>
                </div>
                <Field label="Hours or note"><input value={rosterLabelForm.hours} onChange={(event) => setRosterLabelForm({ ...rosterLabelForm, hours: event.target.value })} placeholder="07:00-19:00" /></Field>
                <div className="form-grid two">
                  <Field label="Status"><select value={rosterLabelForm.status} onChange={(event) => setRosterLabelForm({ ...rosterLabelForm, status: event.target.value as typeof rosterLabelForm.status })}>{rosterStatusOptions.map((item) => <option key={item} value={item}>{item}</option>)}</select></Field>
                  <Field label="Health"><select value={rosterLabelForm.health} onChange={(event) => setRosterLabelForm({ ...rosterLabelForm, health: event.target.value as Health })}>{healthOptions.map((item) => <option key={item} value={item}>{item}</option>)}</select></Field>
                </div>
                <div className="form-grid two">
                  <Field label="Fill"><input type="color" value={rosterLabelForm.fill} onChange={(event) => setRosterLabelForm({ ...rosterLabelForm, fill: event.target.value })} /></Field>
                  <Field label="Text"><input type="color" value={rosterLabelForm.textColor} onChange={(event) => setRosterLabelForm({ ...rosterLabelForm, textColor: event.target.value })} /></Field>
                </div>
                <button type="button" className="primary-btn" onClick={() => void (editing.rosterLabel ? saveRosterLabel() : addRosterLabel())} disabled={Boolean(busy)}><Plus size={14} /> {editing.rosterLabel ? 'Save label' : 'Add label'}</button>
                {editing.rosterLabel ? <button type="button" className="ghost-btn" onClick={() => { setRosterLabelForm(defaultRosterLabelForm); setEditor('rosterLabel', null); }}>Cancel label edit</button> : null}
              </div>
              <div className="mini-list">
                {rosterLabels.map((item) => (
                  <div className="mini-list-row" key={item.code}>
                    <span className="palette-swatch" style={{ backgroundColor: item.fill, color: item.textColor }}>{item.code}</span>
                    <span>{item.label}</span>
                    <EditButton onClick={() => { setRosterLabelForm(item); setEditor('rosterLabel', item.code); }} label={`Edit ${item.code}`} />
                  </div>
                ))}
              </div>
            </section>

            <section className="planner-side-section">
              <div className="planner-side-title">Team order</div>
              <div className="field-hint">Staff rows come from Directory records where scope is Staff. Use these controls to set the sub team order.</div>
              <div className="mini-list">
                {workforceGroups.map((group, index) => (
                  <div className="mini-list-row channel-order-row" key={group.channel}>
                    <span>{group.channel}</span>
                    <small>{group.staff.length} staff</small>
                    <div className="action-row">
                      <button type="button" className="icon-btn" onClick={() => void moveChannel(group.channel, -1)} disabled={index === 0 || Boolean(busy)} aria-label={`Move ${group.channel} up`}>Up</button>
                      <button type="button" className="icon-btn" onClick={() => void moveChannel(group.channel, 1)} disabled={index === workforceGroups.length - 1 || Boolean(busy)} aria-label={`Move ${group.channel} down`}>Down</button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </Panel>
        )}
      </div>
    );
  }

  function renderStandups() {
    const objectiveById = new Map(app.objectives.map((item) => [item.id, item]));
    function beginEditTask(item: AppSnapshot['matrixTasks'][number]) {
      setMatrixForm({ taskDate: item.taskDate, title: item.title, lead: item.lead, assignee: item.assignee, durationMinutes: item.durationMinutes, urgency: Boolean(item.urgency), importance: Boolean(item.importance), dueTime: item.dueTime, status: item.status, notes: item.notes, objectiveId: item.objectiveId ?? 0 });
      setEditor('matrixTask', item.id);
      requestAnimationFrame(() => matrixTitleRef.current?.focus());
    }

    async function saveInlineNotes() {
      if (!notesDraft) {
        return;
      }
      await updateMatrixTask(notesDraft.id, { notes: notesDraft.text });
      setNotesDraft(null);
    }

    return (
      <div className="grid">
        <Panel title="Eisenhower task intake" span={4} className="standup-intake" meta={<span className="muted">capture standup tasks for the selected day</span>}>
          <form className="form-stack" onSubmit={(event) => {
            event.preventDefault();
            if (editing.matrixTask) {
              void saveRecord('matrixTask', editing.matrixTask, matrixForm, () => { resetMatrixForm(planningDate); setEditor('matrixTask', null); });
              return;
            }
            void createRecord('matrixTask', matrixForm, () => resetMatrixForm(planningDate));
          }}>
            <Field label="Standup date"><input type="date" value={matrixForm.taskDate} onChange={(event) => setMatrixForm({ ...matrixForm, taskDate: event.target.value })} required /></Field>
            <Field label="Task description"><textarea ref={matrixTitleRef} rows={3} value={matrixForm.title} onChange={(event) => setMatrixForm({ ...matrixForm, title: event.target.value })} required /></Field>
            <div className="form-grid two">
              <Field label="Lead">
                <select value={matrixForm.lead} onChange={(event) => setMatrixForm({ ...matrixForm, lead: event.target.value })} required>
                  <option value="" disabled>Select lead</option>
                  {leadNames.map((name) => <option key={name} value={name}>{name}</option>)}
                  {matrixForm.lead && !leadNames.includes(matrixForm.lead) ? <option value={matrixForm.lead}>{matrixForm.lead}</option> : null}
                </select>
              </Field>
              <Field label="Assignee">
                <select value={matrixForm.assignee} onChange={(event) => setMatrixForm({ ...matrixForm, assignee: event.target.value })}>
                  <option value="">Unassigned</option>
                  {assigneeNames.map((name) => <option key={name} value={name}>{name}</option>)}
                  {matrixForm.assignee && !assigneeNames.includes(matrixForm.assignee) ? <option value={matrixForm.assignee}>{matrixForm.assignee}</option> : null}
                </select>
              </Field>
            </div>
            <Field label="Objective (optional)">
              <select value={matrixForm.objectiveId} onChange={(event) => setMatrixForm({ ...matrixForm, objectiveId: Number(event.target.value) })}>
                <option value={0}>No objective</option>
                {app.objectives.map((obj) => <option key={obj.id} value={obj.id}>{`OBJ-${obj.id} · ${obj.title}`}</option>)}
              </select>
            </Field>
            <div className="form-grid two">
              <Field label="Minutes"><input type="number" min={0} step={5} placeholder="0" value={matrixForm.durationMinutes || ''} onChange={(event) => setMatrixForm({ ...matrixForm, durationMinutes: Number(event.target.value) || 0 })} /></Field>
              <Field label="Status"><select value={matrixForm.status} onChange={(event) => setMatrixForm({ ...matrixForm, status: event.target.value as MatrixStatus })}>{matrixStatusOptions.map((item) => <option key={item} value={item}>{item}</option>)}</select></Field>
            </div>
            <div className="toggle-grid">
              <label className="toggle-card"><input type="checkbox" checked={matrixForm.urgency} onChange={(event) => setMatrixForm({ ...matrixForm, urgency: event.target.checked })} />Urgent</label>
              <label className="toggle-card"><input type="checkbox" checked={matrixForm.importance} onChange={(event) => setMatrixForm({ ...matrixForm, importance: event.target.checked })} />Important</label>
            </div>
            <div className="decision-preview">
              <strong>{resolveQuadrant(matrixForm.urgency, matrixForm.importance)}</strong>
              <span>{quadrantDescriptions[resolveQuadrant(matrixForm.urgency, matrixForm.importance)]}</span>
            </div>
            <Field label="Notes"><textarea rows={3} value={matrixForm.notes} onChange={(event) => setMatrixForm({ ...matrixForm, notes: event.target.value })} placeholder="Context, dependencies, blockers, or stand-down follow-up" /></Field>
            <Field label="Due time (optional)"><input value={matrixForm.dueTime} onChange={(event) => setMatrixForm({ ...matrixForm, dueTime: event.target.value })} placeholder="17:00" /></Field>
            <button className="primary-btn" type="submit" disabled={Boolean(busy)}><Plus size={14} /> {editing.matrixTask ? 'Save standup item' : 'Add standup item'}</button>
            {editing.matrixTask ? <button className="ghost-btn" type="button" onClick={() => { resetMatrixForm(planningDate); setEditor('matrixTask', null); }}>Cancel edit</button> : null}
          </form>
        </Panel>

        <Panel title="Daily standup overview" span={8} className="standup-print-panel" meta={<span className="muted">{shortDateLabel(planningDate)}</span>}>
          <header className="standup-print-header">
            <h1>SOC Daily Standup Tasks</h1>
            <p>{shortDateLabel(planningDate)} · {matrixForDate.length} task(s) · {standupGroups.length} lead(s)</p>
            <div className="standup-print-signoff"><span>Standup lead: ____________________</span><span>Completed at: ____________________</span></div>
          </header>
          <div className="standup-date-nav pad">
            <button type="button" className="ghost-btn" onClick={() => { const prev = shiftDay(planningDate, -1); setPlanningDate(prev); setMatrixForm((current) => ({ ...current, taskDate: prev })); }}>Prev day</button>
            <input type="date" value={planningDate} onChange={(event) => { const next = event.target.value; if (!next) { return; } setPlanningDate(next); setMatrixForm((current) => ({ ...current, taskDate: next })); }} />
            <button type="button" className="ghost-btn" onClick={() => { const next = shiftDay(planningDate, 1); setPlanningDate(next); setMatrixForm((current) => ({ ...current, taskDate: next })); }}>Next day</button>
            <button type="button" className="ghost-btn" onClick={() => { const today = isoDate(0); setPlanningDate(today); setMatrixForm((current) => ({ ...current, taskDate: today })); }}>Today</button>
            <button type="button" className="ghost-btn" onClick={() => void carryOverIncompleteTasks()} disabled={Boolean(busy)} title="Copy incomplete tasks from the previous day into this day"><RefreshCw size={14} /> Carry over incomplete</button>
            <button type="button" className="ghost-btn" onClick={() => window.print()} disabled={matrixForDate.length === 0} title="Print the selected day's standup tasks"><Printer size={14} /> Print daily tasks</button>
            <button type="button" className="ghost-btn" onClick={() => void downloadStandupTemplate()} title="Download a blank Excel template to run standups offline"><Download size={14} /> Offline template</button>
            <button type="button" className="ghost-btn" onClick={() => standupFileRef.current?.click()} disabled={busy === 'import-standup'} title="Upload a filled offline standup workbook to import tasks"><Upload size={14} /> {busy === 'import-standup' ? 'Importing…' : 'Import filled file'}</button>
            <input
              ref={standupFileRef}
              type="file"
              accept=".xlsx"
              className="visually-hidden-input"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (file) {
                  void importStandupWorkbook(file);
                }
              }}
            />
          </div>
          <div className="day-strip pad compact">
            {standupDates.map((date) => (
              <button key={date} type="button" className={date === planningDate ? 'day-btn active' : 'day-btn'} onClick={() => { setPlanningDate(date); setMatrixForm((current) => ({ ...current, taskDate: date })); }}>
                <strong>{shortDateLabel(date)}</strong>
                <span>{app.matrixTasks.filter((item) => item.taskDate === date).length} items</span>
              </button>
            ))}
          </div>
          <div className="standup-overview">
            {standupGroups.length === 0 ? <div className="empty-state">No standup tasks captured for this date yet.</div> : null}
            {standupGroups.map(([lead, tasks]) => (
              <section className="standup-group" key={lead}>
                <header className="standup-group-head">
                  <div>
                    <strong>{lead} - Daily Stand up - Overview</strong>
                    <span>{tasks.length} task(s) captured for {shortDateLabel(planningDate)}</span>
                  </div>
                </header>
                <table className="grid-table standup-table">
                  <colgroup>
                    <col className="standup-col-id" />
                    <col className="standup-col-task" />
                    <col className="standup-col-minutes" />
                    <col className="standup-col-status" />
                    <col className="standup-col-actions" />
                  </colgroup>
                  <thead>
                    <tr><th>Task id</th><th>Task Description</th><th>Minutes</th><th>Status</th><th className="ta-r"><span className="standup-screen-action">Action</span><span className="standup-print-notes">Follow-up notes</span></th></tr>
                  </thead>
                  <tbody>
                    {tasks.map((item, index) => (
                      <tr key={item.id}>
                        <td>#{index + 1}</td>
                        <td className="wrap-cell">
                          <strong className="standup-task-title">{item.title}</strong>
                          <div className="standup-task-meta">
                            <span className={`scope quad-${item.quadrant.toLowerCase()}`}>{item.quadrant}</span>
                            {item.objectiveId ? (() => { const obj = objectiveById.get(item.objectiveId); return obj ? <button type="button" className="link-chip" title={obj.title} onClick={() => openLinkedTarget('objective', item.objectiveId)}>{`OBJ-${obj.id}`}</button> : null; })() : null}
                            <span className={item.assignee ? 'standup-assignee' : 'standup-assignee empty'}>{item.assignee || 'No assignee set'}</span>
                            {item.dueTime ? <span>Due {item.dueTime}</span> : null}
                          </div>
                          {notesDraft?.id === item.id ? (
                            <div className="standup-notes-edit">
                              <textarea rows={2} autoFocus value={notesDraft.text} onChange={(event) => setNotesDraft({ id: item.id, text: event.target.value })} placeholder="Stand-down comment" />
                              <div className="standup-notes-actions">
                                <button type="button" className="primary-btn" onClick={() => void saveInlineNotes()} disabled={Boolean(busy)}>Save</button>
                                <button type="button" className="ghost-btn" onClick={() => setNotesDraft(null)}>Cancel</button>
                              </div>
                            </div>
                          ) : item.notes ? (
                            <button type="button" className="standup-task-notes editable" onClick={() => setNotesDraft({ id: item.id, text: item.notes })} title="Click to edit stand-down comment">{item.notes}</button>
                          ) : (
                            <button type="button" className="standup-notes-add" onClick={() => setNotesDraft({ id: item.id, text: '' })}>+ Add stand-down comment</button>
                          )}
                        </td>
                        <td>{formatMinutes(item.durationMinutes)}</td>
                        <td>
                          <button
                            type="button"
                            className={item.status === 'Completed' ? 'standup-status-toggle completed' : 'standup-status-toggle'}
                            aria-pressed={item.status === 'Completed'}
                            onClick={() => void updateMatrixTask(item.id, { status: item.status === 'Completed' ? 'Not Completed' : 'Completed' })}
                            disabled={Boolean(busy)}
                          >
                            <CheckCircle2 size={15} aria-hidden="true" />
                            <span>{item.status}</span>
                          </button>
                          <span className="standup-print-status">☐ Complete</span>
                        </td>
                        <td className="ta-r">
                          <div className="action-row">
                            <EditButton onClick={() => beginEditTask(item)} label="Edit task" />
                            <DeleteButton onClick={() => void deleteRecord('matrixTask', item.id)} label="Delete task" />
                          </div>
                          <span className="standup-print-notes">________________________________________________</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            ))}
          </div>
        </Panel>
      </div>
    );
  }

  function renderService() {
    return (
      <>
      <div className={kpiIntakeCollapsed ? 'workforce-layout collapsed' : 'workforce-layout'}>
        <Panel title="KPI and SLA register" className="workforce-planner" meta={<span className="muted">{app.kpis.length} metrics</span>}>
          <table className="grid-table">
            <thead>
              <tr><th>Code</th><th>Name</th><th>Actual</th><th>Target</th><th>Trend</th><th className="ta-r">Action</th></tr>
            </thead>
            <tbody>
              {app.kpis.map((item) => (
                <tr key={item.id}>
                  <td className="ref">{item.code}</td>
                  <td>{item.name}</td>
                  <td><span className="status">{dot(item.health)}{item.actual}</span></td>
                  <td className="muted">{item.target}</td>
                  <td className="kpi-trend-cell"><span className={`kpi-trend ${item.trend}`}><TrendGlyph trend={item.trend} />{item.delta}</span></td>
                  <td className="ta-r"><div className="action-row"><EditButton onClick={() => { setKpiForm({ code: item.code, name: item.name, actual: item.actual, target: item.target, delta: item.delta, trend: item.trend, health: item.health }); setEditor('kpi', item.id); }} label="Edit KPI" /><DeleteButton onClick={() => void deleteRecord('kpi', item.id)} label="Delete KPI" /></div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
        {kpiIntakeCollapsed ? (
          <aside className="workforce-controls-rail">
            <button type="button" className="controls-rail-btn" onClick={() => setKpiIntakeCollapsed(false)} title="Expand add KPI" aria-label="Expand add KPI">
              <ChevronLeft size={16} />
              <span className="controls-rail-label">{editing.kpi ? 'Edit KPI' : 'Add KPI'}</span>
            </button>
          </aside>
        ) : (
        <Panel title={editing.kpi ? 'Edit KPI' : 'Add KPI'} className="workforce-controls objective-intake" meta={<button type="button" className="icon-btn" onClick={() => setKpiIntakeCollapsed(true)} title="Collapse add KPI" aria-label="Collapse add KPI"><ChevronRight size={14} /></button>}>
          <form className="form-stack" onSubmit={(event) => { event.preventDefault(); if (editing.kpi) { void saveRecord('kpi', editing.kpi, kpiForm, () => { setKpiForm(defaultKpiForm); setEditor('kpi', null); }); return; } void createRecord('kpi', kpiForm, () => setKpiForm(defaultKpiForm)); }}>
            <div className="form-grid two">
              <Field label="Code"><input value={kpiForm.code} onChange={(event) => setKpiForm({ ...kpiForm, code: event.target.value })} required /></Field>
              <Field label="Trend"><select value={kpiForm.trend} onChange={(event) => setKpiForm({ ...kpiForm, trend: event.target.value as Trend })}>{trendOptions.map((item) => <option key={item} value={item}>{item}</option>)}</select></Field>
            </div>
            <Field label="Name"><input value={kpiForm.name} onChange={(event) => setKpiForm({ ...kpiForm, name: event.target.value })} required /></Field>
            <div className="form-grid two">
              <Field label="Actual"><input value={kpiForm.actual} onChange={(event) => setKpiForm({ ...kpiForm, actual: event.target.value })} required /></Field>
              <Field label="Target"><input value={kpiForm.target} onChange={(event) => setKpiForm({ ...kpiForm, target: event.target.value })} required /></Field>
            </div>
            <div className="form-grid two">
              <Field label="Delta"><input value={kpiForm.delta} onChange={(event) => setKpiForm({ ...kpiForm, delta: event.target.value })} required /></Field>
              <Field label="Health"><select value={kpiForm.health} onChange={(event) => setKpiForm({ ...kpiForm, health: event.target.value as Health })}>{healthOptions.map((item) => <option key={item} value={item}>{item}</option>)}</select></Field>
            </div>
            <button className="primary-btn" type="submit" disabled={Boolean(busy)}><Plus size={14} /> {editing.kpi ? 'Save KPI' : 'Add KPI'}</button>
            {editing.kpi ? <button className="ghost-btn" type="button" onClick={() => { setKpiForm(defaultKpiForm); setEditor('kpi', null); }}>Cancel edit</button> : null}
          </form>
        </Panel>
        )}
      </div>
      <div className="grid">

        <Panel title="Follow-up tracker" span={8} meta={<span className="muted">{app.followUps.length} open</span>}>
          <table className="grid-table">
            <thead>
              <tr><th>Ref</th><th>Title</th><th>Owner</th><th>Age</th><th className="ta-r">Action</th></tr>
            </thead>
            <tbody>
              {app.followUps.map((item) => (
                <tr key={item.id}>
                  <td className="ref">{item.ref}</td>
                  <td>{item.title}</td>
                  <td className="muted">{item.owner}</td>
                  <td><span className="status">{dot(item.health)}{item.age}</span></td>
                  <td className="ta-r"><div className="action-row"><EditButton onClick={() => { setFollowUpForm({ ref: item.ref, title: item.title, owner: item.owner, age: item.age, health: item.health }); setEditor('followUp', item.id); }} label="Edit follow-up" /><DeleteButton onClick={() => void deleteRecord('followUp', item.id)} label="Delete follow-up" /></div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
        <Panel title={editing.followUp ? 'Edit follow-up' : 'Add follow-up'} span={4} meta={<span className="muted">operations backlog</span>}>
          <form className="form-stack" onSubmit={(event) => { event.preventDefault(); if (editing.followUp) { void saveRecord('followUp', editing.followUp, followUpForm, () => { setFollowUpForm(defaultFollowUpForm); setEditor('followUp', null); }); return; } void createRecord('followUp', followUpForm, () => setFollowUpForm(defaultFollowUpForm)); }}>
            <Field label="Reference"><input value={followUpForm.ref} onChange={(event) => setFollowUpForm({ ...followUpForm, ref: event.target.value })} required /></Field>
            <Field label="Title"><input value={followUpForm.title} onChange={(event) => setFollowUpForm({ ...followUpForm, title: event.target.value })} required /></Field>
            <Field label="Owner"><input value={followUpForm.owner} onChange={(event) => setFollowUpForm({ ...followUpForm, owner: event.target.value })} required /></Field>
            <div className="form-grid two">
              <Field label="Age"><input value={followUpForm.age} onChange={(event) => setFollowUpForm({ ...followUpForm, age: event.target.value })} placeholder="4h" required /></Field>
              <Field label="Health"><select value={followUpForm.health} onChange={(event) => setFollowUpForm({ ...followUpForm, health: event.target.value as Health })}>{healthOptions.map((item) => <option key={item} value={item}>{item}</option>)}</select></Field>
            </div>
            <button className="primary-btn" type="submit" disabled={Boolean(busy)}><Plus size={14} /> {editing.followUp ? 'Save follow-up' : 'Add follow-up'}</button>
            {editing.followUp ? <button className="ghost-btn" type="button" onClick={() => { setFollowUpForm(defaultFollowUpForm); setEditor('followUp', null); }}>Cancel edit</button> : null}
          </form>
        </Panel>
      </div>
      </>
    );
  }

  function renderIssues() {
    const objectiveById = new Map(app.objectives.map((item) => [item.id, item]));
    const projectById = new Map(app.projects.map((item) => [item.id, item]));
    const projectUid = (project: ProjectRow) => project.code || `PRJ-${project.id}`;
    const issueLink = (item: IssueRow): { uid: string; name: string } | null => {
      if (item.linkedType === 'objective') {
        const objective = objectiveById.get(item.linkedId);
        return objective ? { uid: `OBJ-${objective.id}`, name: objective.title } : null;
      }
      if (item.linkedType === 'project') {
        const project = projectById.get(item.linkedId);
        return project ? { uid: projectUid(project), name: project.name } : null;
      }
      return null;
    };
    return (
      <div className={issueIntakeCollapsed ? 'workforce-layout collapsed' : 'workforce-layout'}>
        {issueIntakeCollapsed ? (
          <aside className="workforce-controls-rail">
            <button type="button" className="controls-rail-btn" onClick={() => setIssueIntakeCollapsed(false)} title="Expand add issue" aria-label="Expand add issue">
              <ChevronLeft size={16} />
              <span className="controls-rail-label">{editing.issue ? 'Edit issue' : 'Add issue'}</span>
            </button>
          </aside>
        ) : (
        <Panel title={editing.issue ? 'Edit issue' : 'Add issue'} className="workforce-controls objective-intake" meta={<button type="button" className="icon-btn" onClick={() => setIssueIntakeCollapsed(true)} title="Collapse add issue" aria-label="Collapse add issue"><ChevronRight size={14} /></button>}>
          <form className="form-stack" onSubmit={(event) => { event.preventDefault(); if (editing.issue) { void saveRecord('issue', editing.issue, issueForm, () => { setIssueForm(defaultIssueForm); setEditor('issue', null); }); return; } void createRecord('issue', issueForm, () => setIssueForm(defaultIssueForm)); }}>
            <Field label="Scope"><select value={issueForm.scope} onChange={(event) => setIssueForm({ ...issueForm, scope: event.target.value })}>{objectiveScopeOptions.map((item) => <option key={item} value={item}>{item}</option>)}</select></Field>
            <Field label="Status"><select value={issueForm.status} onChange={(event) => setIssueForm({ ...issueForm, status: event.target.value as IssueStatus })}>{issueStatusOptions.map((item) => <option key={item} value={item}>{item}</option>)}</select></Field>
            <Field label="Issue title"><input value={issueForm.title} onChange={(event) => setIssueForm({ ...issueForm, title: event.target.value })} required /></Field>
            <Field label="Issue summary"><textarea rows={6} value={issueForm.summary} onChange={(event) => setIssueForm({ ...issueForm, summary: event.target.value })} placeholder="Capture the impact, current blocker, decision needed, and next action." /></Field>
            <Field label="Lead">
              <select value={issueForm.owner} onChange={(event) => setIssueForm({ ...issueForm, owner: event.target.value })} required>
                <option value="" disabled>Select lead</option>
                {leadNames.map((name) => <option key={name} value={name}>{name}</option>)}
                {issueForm.owner && !leadNames.includes(issueForm.owner) ? <option value={issueForm.owner}>{issueForm.owner}</option> : null}
              </select>
            </Field>
            <Field label="Assigned to"><input value={issueForm.assignedTo} onChange={(event) => setIssueForm({ ...issueForm, assignedTo: event.target.value })} placeholder="Name or team responsible" /></Field>
            <Field label="Linked to">
              <select
                value={issueForm.linkedType && issueForm.linkedId ? `${issueForm.linkedType}:${issueForm.linkedId}` : ''}
                onChange={(event) => {
                  const value = event.target.value;
                  if (!value) { setIssueForm({ ...issueForm, linkedType: '', linkedId: 0 }); return; }
                  const [type, id] = value.split(':');
                  setIssueForm({ ...issueForm, linkedType: type as 'objective' | 'project', linkedId: Number(id) });
                }}
              >
                <option value="">None</option>
                <optgroup label="Objectives">
                  {app.objectives.map((item) => <option key={`objective-${item.id}`} value={`objective:${item.id}`}>{`OBJ-${item.id} · ${item.title}`}</option>)}
                </optgroup>
                <optgroup label="Projects">
                  {app.projects.map((item) => <option key={`project-${item.id}`} value={`project:${item.id}`}>{`${item.code || `PRJ-${item.id}`} · ${item.name}`}</option>)}
                </optgroup>
              </select>
            </Field>
            <div className="form-grid two">
              <Field label="Due"><input type="date" value={issueForm.due} onChange={(event) => setIssueForm({ ...issueForm, due: event.target.value })} required /></Field>
              <Field label="Progress"><input type="number" min="0" max="100" value={issueForm.progress} onChange={(event) => setIssueForm({ ...issueForm, progress: Number(event.target.value) })} /></Field>
            </div>
            <Field label="Health"><select value={issueForm.health} onChange={(event) => setIssueForm({ ...issueForm, health: event.target.value as Health })}>{healthOptions.map((item) => <option key={item} value={item}>{item}</option>)}</select></Field>
            <button className="primary-btn" type="submit" disabled={Boolean(busy)}><Plus size={14} /> {editing.issue ? 'Save issue' : 'Add issue'}</button>
            {editing.issue ? <button className="ghost-btn" type="button" onClick={() => { setIssueForm(defaultIssueForm); setEditor('issue', null); }}>Cancel edit</button> : null}
          </form>
        </Panel>
        )}
        <Panel title="Issue register" className="workforce-planner" meta={<span className="muted">daily, weekly, monthly</span>}>
          {registerView === 'tiles' ? (
            <div className="register-tiles">
              {(app.issues ?? []).map((item) => {
                const link = issueLink(item);
                return (
                  <article key={item.id} className={`register-tile issue-health-${String(item.health).toLowerCase()}`}>
                    <header className="register-tile-head">
                      <span className="scope">{item.scope}</span>
                      <span className="register-tile-title" title={item.title}>{item.title}</span>
                      {dot(item.health)}
                    </header>
                    <div className="register-tile-status muted">{item.status}</div>
                    <dl className="register-tile-meta">
                      <div><dt>Lead</dt><dd>{item.owner || '—'}</dd></div>
                      <div><dt>Assigned</dt><dd>{item.assignedTo || '—'}</dd></div>
                      <div><dt>Linked</dt><dd>{link ? <button type="button" className="link-chip" onClick={() => openLinkedTarget(item.linkedType as 'objective' | 'project', item.linkedId)}>{link.uid}</button> : '—'}</dd></div>
                      <div><dt>Due</dt><dd>{objectiveDueLabel(item.due)}</dd></div>
                    </dl>
                    <div className="register-tile-progress"><div className="mini-bar"><span className={item.health} style={{ width: `${item.progress}%` }} /></div><span className="muted">{item.progress}%</span></div>
                    {item.summary ? <p className="register-tile-summary">{item.summary}</p> : null}
                    <div className="register-tile-actions">
                      <EditButton onClick={() => { setIssueForm({ scope: item.scope, status: item.status, title: item.title, summary: item.summary, owner: item.owner, assignedTo: item.assignedTo ?? '', linkedType: item.linkedType ?? '', linkedId: item.linkedId ?? 0, due: isDateKey(item.due) ? item.due : '', progress: item.progress, health: item.health }); setEditor('issue', item.id); }} label="Edit issue" />
                      <DeleteButton onClick={() => void deleteRecord('issue', item.id)} label="Delete issue" />
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
          <table className="grid-table objective-table">
            <colgroup>
              <col className="objective-col-expand" />
              <col className="objective-col-scope" />
              <col className="objective-col-title" />
              <col className="objective-col-lead" />
              <col className="objective-col-lead" />
              <col className="objective-col-lead" />
              <col className="objective-col-due" />
              <col className="objective-col-progress" />
              <col className="objective-col-action" />
            </colgroup>
            <thead>
              <tr><th></th><th>S</th><th>Issue title</th><th>Lead</th><th>Assigned to</th><th>Linked to</th><th>Due</th><th>Prog</th><th className="ta-r">Action</th></tr>
            </thead>
            <tbody>
              {(app.issues ?? []).map((item) => {
                const expanded = expandedIssues.has(item.id);
                return (
                  <Fragment key={item.id}>
                    <tr className={expanded ? `objective-row issue-row issue-health-${String(item.health).toLowerCase()} expanded` : `objective-row issue-row issue-health-${String(item.health).toLowerCase()}`}>
                      <td>
                        <button className="icon-btn objective-expand" type="button" onClick={() => toggleIssue(item.id)} aria-label={expanded ? 'Collapse issue summary' : 'Expand issue summary'}>
                          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        </button>
                      </td>
                      <td><span className="scope">{item.scope}</span></td>
                      <td className="objective-title-cell"><span>{item.title}</span><div className="muted">{item.status}</div></td>
                      <td className="muted">{item.owner}</td>
                      <td className="muted">{item.assignedTo || '—'}</td>
                      <td className="muted">{(() => { const link = issueLink(item); return link ? <button type="button" className="link-chip" title={`${link.name} — open`} onClick={() => openLinkedTarget(item.linkedType as 'objective' | 'project', item.linkedId)}>{link.uid}</button> : '—'; })()}</td>
                      <td className="muted">{objectiveDueLabel(item.due)}</td>
                      <td><div className="mini-bar"><span className={item.health} style={{ width: `${item.progress}%` }} /></div></td>
                      <td className="ta-r"><div className="action-row"><EditButton onClick={() => { setIssueForm({ scope: item.scope, status: item.status, title: item.title, summary: item.summary, owner: item.owner, assignedTo: item.assignedTo ?? '', linkedType: item.linkedType ?? '', linkedId: item.linkedId ?? 0, due: isDateKey(item.due) ? item.due : '', progress: item.progress, health: item.health }); setEditor('issue', item.id); }} label="Edit issue" /><DeleteButton onClick={() => void deleteRecord('issue', item.id)} label="Delete issue" /></div></td>
                    </tr>
                    {expanded ? (
                      <tr className="objective-summary-row">
                        <td></td>
                        <td colSpan={8}>
                          <div className="objective-summary-text">{item.summary || 'No summary recorded.'}</div>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
          )}
        </Panel>
      </div>
    );
  }

  function renderObjectives() {
    const issuesForObjective = (id: number) => app.issues.filter((issue) => issue.linkedType === 'objective' && issue.linkedId === id);
    const tasksForObjective = (id: number) => app.matrixTasks.filter((task) => task.objectiveId === id);

    async function submitObjectiveForm() {
      const selectedFile = objectiveFile;

      if (editing.objective) {
        const objectiveId = editing.objective;
        await mutate(`update-objective-${objectiveId}`, async () => {
          const next = await api.updateRecord('objective', objectiveId, objectiveForm);
          if (selectedFile) {
            return api.uploadObjectiveDocument(objectiveId, selectedFile);
          }
          return next;
        });
        setObjectiveForm(defaultObjectiveForm);
        setObjectiveFile(null);
        setEditor('objective', null);
        return;
      }

      let createdId: number | null = null;
      await mutate('create-objective', async () => {
        const next = await api.createRecord('objective', objectiveForm);
        const created = [...(next.objectives ?? [])].reverse().find((item) => item.title === objectiveForm.title && item.owner === objectiveForm.owner && item.due === objectiveForm.due);
        createdId = created?.id ?? null;
        return next;
      });

      if (selectedFile && createdId) {
        await uploadObjectiveDocument(createdId, selectedFile);
      }

      if (selectedFile && !createdId) {
        setError('Objective saved, but the document could not be attached automatically. Open the objective in edit mode and upload it again.');
      }

      setObjectiveForm(defaultObjectiveForm);
      setObjectiveFile(null);
    }

    return (
      <div className={objectiveIntakeCollapsed ? 'workforce-layout collapsed' : 'workforce-layout'}>
        {objectiveIntakeCollapsed ? (
          <aside className="workforce-controls-rail">
            <button type="button" className="controls-rail-btn" onClick={() => setObjectiveIntakeCollapsed(false)} title="Expand add objective" aria-label="Expand add objective">
              <ChevronLeft size={16} />
              <span className="controls-rail-label">{editing.objective ? 'Edit objective' : 'Add objective'}</span>
            </button>
          </aside>
        ) : (
        <Panel title={editing.objective ? 'Edit objective' : 'Add objective'} className="workforce-controls objective-intake" meta={<button type="button" className="icon-btn" onClick={() => setObjectiveIntakeCollapsed(true)} title="Collapse add objective" aria-label="Collapse add objective"><ChevronRight size={14} /></button>}>
          <form className="form-stack" onSubmit={(event) => { event.preventDefault(); void submitObjectiveForm(); }}>
            <Field label="Scope"><select value={objectiveForm.scope} onChange={(event) => setObjectiveForm({ ...objectiveForm, scope: event.target.value })}>{objectiveScopeOptions.map((item) => <option key={item} value={item}>{item}</option>)}</select></Field>
            <Field label="Objective title"><input value={objectiveForm.title} onChange={(event) => setObjectiveForm({ ...objectiveForm, title: event.target.value })} required /></Field>
            <Field label="Objective summary"><textarea rows={6} value={objectiveForm.summary} onChange={(event) => setObjectiveForm({ ...objectiveForm, summary: event.target.value })} placeholder="Capture the full objective context, scope, decisions, and expected outcome." /></Field>
            <Field label="Lead">
              <select value={objectiveForm.owner} onChange={(event) => setObjectiveForm({ ...objectiveForm, owner: event.target.value })} required>
                <option value="" disabled>Select lead</option>
                {leadNames.map((name) => <option key={name} value={name}>{name}</option>)}
                {objectiveForm.owner && !leadNames.includes(objectiveForm.owner) ? <option value={objectiveForm.owner}>{objectiveForm.owner}</option> : null}
              </select>
            </Field>
            <Field label="Assigned to"><input value={objectiveForm.assignedTo} onChange={(event) => setObjectiveForm({ ...objectiveForm, assignedTo: event.target.value })} placeholder="Name or team responsible" /></Field>
            <div className="form-grid two">
              <Field label="Due"><input type="date" value={objectiveForm.due} onChange={(event) => setObjectiveForm({ ...objectiveForm, due: event.target.value })} required /></Field>
              <Field label="Progress"><input type="number" min="0" max="100" value={objectiveForm.progress} onChange={(event) => setObjectiveForm({ ...objectiveForm, progress: Number(event.target.value) })} /></Field>
            </div>
            <Field label="Health"><select value={objectiveForm.health} onChange={(event) => setObjectiveForm({ ...objectiveForm, health: event.target.value as Health })}>{healthOptions.map((item) => <option key={item} value={item}>{item}</option>)}</select></Field>
            <Field label="Objective document"><input key={`objective-file-${editing.objective ?? 'new'}`} type="file" accept=".pdf,.doc,.docx,.txt,.md,.rtf" onChange={(event) => setObjectiveFile(event.target.files?.[0] ?? null)} /></Field>
            <div className="field-hint">Attach the objective brief, evidence pack, or related working document. Max file size: {DOCUMENT_UPLOAD_MAX_MB} MB. Upload replaces any existing document.</div>
            <button className="primary-btn" type="submit" disabled={Boolean(busy)}><Plus size={14} /> {editing.objective ? 'Save objective' : 'Add objective'}</button>
            {editing.objective ? <button className="ghost-btn" type="button" onClick={() => { setObjectiveForm(defaultObjectiveForm); setObjectiveFile(null); setEditor('objective', null); }}>Cancel edit</button> : null}
          </form>
        </Panel>
        )}
        <Panel title="Objective register" className="workforce-planner" meta={<span className="muted">daily, weekly, monthly</span>}>
          {registerView === 'tiles' ? (
            <div className="register-tiles">
              {app.objectives.map((item) => {
                const refs = issuesForObjective(item.id);
                return (
                  <article key={item.id} className={`register-tile issue-health-${String(item.health).toLowerCase()}`}>
                    <header className="register-tile-head">
                      <span className="scope">{item.scope}</span>
                      <span className="register-tile-title" title={item.title}>{item.title}</span>
                      {dot(item.health)}
                    </header>
                    <dl className="register-tile-meta">
                      <div><dt>Lead</dt><dd>{item.owner || '—'}</dd></div>
                      <div><dt>Assigned</dt><dd>{item.assignedTo || '—'}</dd></div>
                      <div><dt>Issues</dt><dd>{refs.length ? <button type="button" className="link-chip" onClick={() => openReferencingIssues(refs.map((issue) => issue.id))}>{refs.length} issue{refs.length > 1 ? 's' : ''}</button> : '—'}</dd></div>
                      <div><dt>Standups</dt><dd>{(() => { const linked = tasksForObjective(item.id); return linked.length ? <span title={`${linked.reduce((sum, task) => sum + task.durationMinutes, 0)} min across ${linked.length} task(s)`}>{linked.length} task{linked.length > 1 ? 's' : ''}</span> : '—'; })()}</dd></div>
                      <div><dt>Due</dt><dd>{objectiveDueLabel(item.due)}</dd></div>
                    </dl>
                    <div className="register-tile-progress"><div className="mini-bar"><span className={item.health} style={{ width: `${item.progress}%` }} /></div><span className="muted">{item.progress}%</span></div>
                    {item.attachmentPath ? <a className="doc-link register-tile-doc" href={item.attachmentPath} target="_blank" rel="noreferrer" title={item.attachmentName || 'Open'}><Paperclip size={12} /> <span className="doc-link-name">{item.attachmentName || 'Open'}</span></a> : null}
                    {item.summary ? <p className="register-tile-summary">{item.summary}</p> : null}
                    <div className="register-tile-actions">
                      <EditButton onClick={() => { setObjectiveForm({ scope: item.scope, title: item.title, summary: item.summary, owner: item.owner, assignedTo: item.assignedTo ?? '', due: isDateKey(item.due) ? item.due : '', progress: item.progress, health: item.health }); setObjectiveFile(null); setEditor('objective', item.id); }} label="Edit objective" />
                      <DeleteButton onClick={() => void deleteRecord('objective', item.id)} label="Delete objective" />
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
          <table className="grid-table objective-table">
            <colgroup>
              <col className="objective-col-expand" />
              <col className="objective-col-scope" />
              <col className="objective-col-title" />
              <col className="objective-col-lead" />
              <col className="objective-col-lead" />
              <col className="objective-col-lead" />
              <col className="objective-col-lead" />
              <col className="objective-col-due" />
              <col className="objective-col-progress" />
              <col className="objective-col-action" />
            </colgroup>
            <thead>
              <tr><th></th><th>S</th><th>Objective title</th><th>Lead</th><th>Assigned to</th><th>Issues</th><th>Document</th><th>Due</th><th>Prog</th><th className="ta-r">Action</th></tr>
            </thead>
            <tbody>
              {app.objectives.map((item) => {
                const expanded = expandedObjectives.has(item.id);
                return (
                  <Fragment key={item.id}>
                    <tr className={expanded ? 'objective-row expanded' : 'objective-row'}>
                      <td>
                        <button className="icon-btn objective-expand" type="button" onClick={() => toggleObjective(item.id)} aria-label={expanded ? 'Collapse objective summary' : 'Expand objective summary'}>
                          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        </button>
                      </td>
                      <td><span className="scope">{item.scope}</span></td>
                      <td className="objective-title-cell"><span>{item.title}</span></td>
                      <td className="muted">{item.owner}</td>
                      <td className="muted">{item.assignedTo || '—'}</td>
                      <td className="muted">{(() => { const refs = issuesForObjective(item.id); return refs.length ? <button type="button" className="link-chip" title={refs.map((issue) => issue.title).join('\n')} onClick={() => openReferencingIssues(refs.map((issue) => issue.id))}>{refs.length} issue{refs.length > 1 ? 's' : ''}</button> : '—'; })()}</td>
                      <td className="doc-cell">{item.attachmentPath ? <a className="doc-link" href={item.attachmentPath} target="_blank" rel="noreferrer" title={item.attachmentName || 'Open'}><Paperclip size={12} /> <span className="doc-link-name">{item.attachmentName || 'Open'}</span></a> : <span className="muted">No file</span>}</td>
                      <td className="muted">{objectiveDueLabel(item.due)}</td>
                      <td><div className="mini-bar"><span className={item.health} style={{ width: `${item.progress}%` }} /></div></td>
                      <td className="ta-r"><div className="action-row"><EditButton onClick={() => { setObjectiveForm({ scope: item.scope, title: item.title, summary: item.summary, owner: item.owner, assignedTo: item.assignedTo ?? '', due: isDateKey(item.due) ? item.due : '', progress: item.progress, health: item.health }); setObjectiveFile(null); setEditor('objective', item.id); }} label="Edit objective" /><DeleteButton onClick={() => void deleteRecord('objective', item.id)} label="Delete objective" /></div></td>
                    </tr>
                    {expanded ? (
                      <tr className="objective-summary-row">
                        <td></td>
                        <td colSpan={9}>
                          <div className="objective-summary-text">{item.summary || 'No summary recorded.'}</div>
                          {item.attachmentPath ? <div className="linked-issues"><span className="linked-issues-label">Document:</span><a className="doc-link" href={item.attachmentPath} target="_blank" rel="noreferrer"><Paperclip size={12} /> {item.attachmentName || 'Open document'}</a></div> : null}
                          {(() => { const refs = issuesForObjective(item.id); return refs.length ? (
                            <div className="linked-issues">
                              <span className="linked-issues-label">Linked issues:</span>
                              {refs.map((issue) => <button key={issue.id} type="button" className="link-chip" title={issue.title} onClick={() => openReferencingIssues([issue.id])}>{`ISS-${issue.id} · ${issue.title}`}</button>)}
                            </div>
                          ) : null; })()}
                          {(() => { const linked = tasksForObjective(item.id); return linked.length ? (
                            <div className="linked-issues">
                              <span className="linked-issues-label">Linked standups ({linked.reduce((sum, task) => sum + task.durationMinutes, 0)} min):</span>
                              {linked.map((task) => <span key={task.id} className="link-chip" title={`${task.lead} · ${task.status}`}>{`${task.taskDate} · ${task.title}`}</span>)}
                            </div>
                          ) : null; })()}
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
          )}
        </Panel>
      </div>
    );
  }

  function renderProjects() {
    const issuesForProject = (id: number) => app.issues.filter((issue) => issue.linkedType === 'project' && issue.linkedId === id);
    return (
      <div className={projectIntakeCollapsed ? 'workforce-layout collapsed' : 'workforce-layout'}>
        <Panel title="Project tracker" className="workforce-planner" meta={<span className="muted">{app.projects.length} active projects</span>}>
          {registerView === 'tiles' ? (
            <div className="register-tiles">
              {app.projects.map((item) => {
                const refs = issuesForProject(item.id);
                return (
                  <article key={item.id} className={`register-tile issue-health-${String(item.health).toLowerCase()}`}>
                    <header className="register-tile-head">
                      <span className="ref">{item.code}</span>
                      <span className="register-tile-title" title={item.name}>{item.name}</span>
                      {dot(item.health)}
                    </header>
                    <dl className="register-tile-meta">
                      <div><dt>Owner</dt><dd>{item.owner || '—'}</dd></div>
                      <div><dt>Phase</dt><dd>{item.phase || '—'}</dd></div>
                      <div><dt>Issues</dt><dd>{refs.length ? <button type="button" className="link-chip" onClick={() => openReferencingIssues(refs.map((issue) => issue.id))}>{refs.length} issue{refs.length > 1 ? 's' : ''}</button> : '—'}</dd></div>
                      <div><dt>Due</dt><dd>{item.due || '—'}</dd></div>
                    </dl>
                    <div className="register-tile-progress"><div className="mini-bar"><span className={item.health} style={{ width: `${item.progress}%` }} /></div><span className="muted">{item.progress}%</span></div>
                    <div className="register-tile-actions">
                      <EditButton onClick={() => { setProjectForm({ code: item.code, name: item.name, owner: item.owner, phase: item.phase, due: item.due, progress: item.progress, health: item.health }); setEditor('project', item.id); }} label="Edit project" />
                      <DeleteButton onClick={() => void deleteRecord('project', item.id)} label="Delete project" />
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
          <table className="grid-table">
            <thead>
              <tr><th>Code</th><th>Name</th><th>Owner</th><th>Phase</th><th>Due</th><th>Prog</th><th>Issues</th><th className="ta-r">Action</th></tr>
            </thead>
            <tbody>
              {app.projects.map((item) => (
                <tr key={item.id}>
                  <td className="ref">{item.code}</td>
                  <td><span className="status">{dot(item.health)}{item.name}</span></td>
                  <td className="muted">{item.owner}</td>
                  <td className="muted">{item.phase}</td>
                  <td className="muted">{item.due}</td>
                  <td><div className="mini-bar"><span className={item.health} style={{ width: `${item.progress}%` }} /></div></td>
                  <td className="muted">{(() => { const refs = issuesForProject(item.id); return refs.length ? <button type="button" className="link-chip" title={refs.map((issue) => issue.title).join('\n')} onClick={() => openReferencingIssues(refs.map((issue) => issue.id))}>{refs.length} issue{refs.length > 1 ? 's' : ''}</button> : '—'; })()}</td>
                  <td className="ta-r"><div className="action-row"><EditButton onClick={() => { setProjectForm({ code: item.code, name: item.name, owner: item.owner, phase: item.phase, due: item.due, progress: item.progress, health: item.health }); setEditor('project', item.id); }} label="Edit project" /><DeleteButton onClick={() => void deleteRecord('project', item.id)} label="Delete project" /></div></td>
                </tr>
              ))}
            </tbody>
          </table>
          )}
        </Panel>
        {projectIntakeCollapsed ? (
          <aside className="workforce-controls-rail">
            <button type="button" className="controls-rail-btn" onClick={() => setProjectIntakeCollapsed(false)} title="Expand add project" aria-label="Expand add project">
              <ChevronLeft size={16} />
              <span className="controls-rail-label">{editing.project ? 'Edit project' : 'Add project'}</span>
            </button>
          </aside>
        ) : (
        <Panel title={editing.project ? 'Edit project' : 'Add project'} className="workforce-controls objective-intake" meta={<button type="button" className="icon-btn" onClick={() => setProjectIntakeCollapsed(true)} title="Collapse add project" aria-label="Collapse add project"><ChevronRight size={14} /></button>}>
          <form className="form-stack" onSubmit={(event) => { event.preventDefault(); if (editing.project) { void saveRecord('project', editing.project, projectForm, () => { setProjectForm(defaultProjectForm); setEditor('project', null); }); return; } void createRecord('project', projectForm, () => setProjectForm(defaultProjectForm)); }}>
            <div className="form-grid two">
              <Field label="Code"><input value={projectForm.code} onChange={(event) => setProjectForm({ ...projectForm, code: event.target.value })} required /></Field>
              <Field label="Phase"><input value={projectForm.phase} onChange={(event) => setProjectForm({ ...projectForm, phase: event.target.value })} required /></Field>
            </div>
            <Field label="Name"><input value={projectForm.name} onChange={(event) => setProjectForm({ ...projectForm, name: event.target.value })} required /></Field>
            <Field label="Owner"><input value={projectForm.owner} onChange={(event) => setProjectForm({ ...projectForm, owner: event.target.value })} required /></Field>
            <div className="form-grid two">
              <Field label="Due"><input value={projectForm.due} onChange={(event) => setProjectForm({ ...projectForm, due: event.target.value })} required /></Field>
              <Field label="Progress"><input type="number" min="0" max="100" value={projectForm.progress} onChange={(event) => setProjectForm({ ...projectForm, progress: Number(event.target.value) })} /></Field>
            </div>
            <Field label="Health"><select value={projectForm.health} onChange={(event) => setProjectForm({ ...projectForm, health: event.target.value as Health })}>{healthOptions.map((item) => <option key={item} value={item}>{item}</option>)}</select></Field>
            <button className="primary-btn" type="submit" disabled={Boolean(busy)}><Plus size={14} /> {editing.project ? 'Save project' : 'Add project'}</button>
            {editing.project ? <button className="ghost-btn" type="button" onClick={() => { setProjectForm(defaultProjectForm); setEditor('project', null); }}>Cancel edit</button> : null}
          </form>
        </Panel>
        )}
      </div>
    );
  }

  function renderProcesses() {
    const processRows = app.processes ?? [];

    async function submitProcessForm() {
      const selectedFile = processFile;

      if (editing.process) {
        const processId = editing.process;
        await mutate(`update-process-${editing.process}`, async () => {
          const next = await api.updateRecord('process', processId, processForm);
          if (selectedFile) {
            return api.uploadProcessDocument(processId, selectedFile);
          }
          return next;
        });
        setProcessForm(defaultProcessForm);
        setProcessFile(null);
        setEditor('process', null);
        return;
      }

      let createdId: number | null = null;
      await mutate('create-process', async () => {
        const next = await api.createRecord('process', processForm);
        const created = [...(next.processes ?? [])].reverse().find((item) => item.code === processForm.code && item.name === processForm.name && item.owner === processForm.owner);
        createdId = created?.id ?? null;
        return next;
      });

      if (selectedFile && createdId) {
        await uploadProcessDocument(createdId, selectedFile);
      }

      if (selectedFile && !createdId) {
        setError('Process saved, but the document could not be attached automatically. Open the process in edit mode and upload it again.');
      }

      setProcessForm(defaultProcessForm);
      setProcessFile(null);
    }

    return (
      <div className={processIntakeCollapsed ? 'workforce-layout collapsed' : 'workforce-layout'}>
        <Panel title="SOC process inventory" className="workforce-planner" meta={<span className="muted">{processRows.length} tracked processes</span>}>
          <table className="grid-table">
            <thead>
              <tr><th>Code</th><th>Process</th><th>Owner</th><th>Cadence</th><th>Maturity</th><th>Document</th><th>Notes</th><th className="ta-r">Action</th></tr>
            </thead>
            <tbody>
              {processRows.map((item) => (
                <tr key={item.id}>
                  <td className="ref">{item.code}</td>
                  <td><span className="status">{dot(item.health)}{item.name}</span></td>
                  <td className="muted">{item.owner}</td>
                  <td className="muted">{item.cadence}</td>
                  <td>
                    <div className="maturity-cell">
                      <strong>{item.maturity}/5</strong>
                      <div className="mini-bar"><span className={item.health} style={{ width: `${(item.maturity / 5) * 100}%` }} /></div>
                    </div>
                  </td>
                  <td className="doc-cell">{item.attachmentPath ? <a className="doc-link" href={item.attachmentPath} target="_blank" rel="noreferrer" title={item.attachmentName || 'Open'}><Paperclip size={12} /> <span className="doc-link-name">{item.attachmentName || 'Open'}</span></a> : <span className="muted">No file</span>}</td>
                  <td className="wrap-cell">{item.notes}</td>
                  <td className="ta-r"><div className="action-row"><EditButton onClick={() => { setProcessForm({ code: item.code, name: item.name, owner: item.owner, cadence: item.cadence, maturity: item.maturity, health: item.health, notes: item.notes }); setProcessFile(null); setEditor('process', item.id); }} label="Edit process" /><DeleteButton onClick={() => void deleteRecord('process', item.id)} label="Delete process" /></div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
        {processIntakeCollapsed ? (
          <aside className="workforce-controls-rail">
            <button type="button" className="controls-rail-btn" onClick={() => setProcessIntakeCollapsed(false)} title="Expand add process" aria-label="Expand add process">
              <ChevronLeft size={16} />
              <span className="controls-rail-label">{editing.process ? 'Edit process' : 'Add process'}</span>
            </button>
          </aside>
        ) : (
        <Panel title={editing.process ? 'Edit process' : 'Add process'} className="workforce-controls objective-intake" meta={<button type="button" className="icon-btn" onClick={() => setProcessIntakeCollapsed(true)} title="Collapse add process" aria-label="Collapse add process"><ChevronRight size={14} /></button>}>
          <form className="form-stack" onSubmit={(event) => { event.preventDefault(); void submitProcessForm(); }}>
            <div className="form-grid two">
              <Field label="Code"><input value={processForm.code} onChange={(event) => setProcessForm({ ...processForm, code: event.target.value })} required /></Field>
              <Field label="Maturity"><input type="number" min="0" max="5" value={processForm.maturity} onChange={(event) => setProcessForm({ ...processForm, maturity: Number(event.target.value) })} required /></Field>
            </div>
            <Field label="Process name"><input value={processForm.name} onChange={(event) => setProcessForm({ ...processForm, name: event.target.value })} required /></Field>
            <Field label="Owner"><input value={processForm.owner} onChange={(event) => setProcessForm({ ...processForm, owner: event.target.value })} required /></Field>
            <Field label="Cadence"><input value={processForm.cadence} onChange={(event) => setProcessForm({ ...processForm, cadence: event.target.value })} placeholder="Daily, weekly, monthly" required /></Field>
            <Field label="Health"><select value={processForm.health} onChange={(event) => setProcessForm({ ...processForm, health: event.target.value as Health })}>{healthOptions.map((item) => <option key={item} value={item}>{item}</option>)}</select></Field>
            <Field label="Process document"><input key={`process-file-${editing.process ?? 'new'}`} type="file" accept=".pdf,.doc,.docx,.txt,.md,.rtf" onChange={(event) => setProcessFile(event.target.files?.[0] ?? null)} /></Field>
            <div className="field-hint">Attach the current SOP, runbook, or work instruction. Max file size: {DOCUMENT_UPLOAD_MAX_MB} MB. Upload replaces any existing document.</div>
            <Field label="Notes"><textarea rows={5} value={processForm.notes} onChange={(event) => setProcessForm({ ...processForm, notes: event.target.value })} /></Field>
            <button className="primary-btn" type="submit" disabled={Boolean(busy)}><Plus size={14} /> {editing.process ? 'Save process' : 'Add process'}</button>
            {editing.process ? <button className="ghost-btn" type="button" onClick={() => { setProcessForm(defaultProcessForm); setProcessFile(null); setEditor('process', null); }}>Cancel edit</button> : null}
          </form>
        </Panel>
        )}
      </div>
    );
  }

  function renderContacts() {
    return (
      <div className={contactIntakeCollapsed ? 'workforce-layout collapsed' : 'workforce-layout'}>
        <Panel title="Staff, vendor, and key contacts" className="workforce-planner" meta={<span className="muted">{app.contacts.length} records</span>}>
          <table className="grid-table">
            <thead>
              <tr><th>Scope</th><th>Name</th><th>Role</th><th>Sub Team</th><th>Lead</th><th>Email</th><th>Phone</th><th className="ta-r">Action</th></tr>
            </thead>
            <tbody>
              {app.contacts.map((item) => {
                const whatsappLink = toWhatsAppLink(item.phone);
                return (
                  <tr key={item.id}>
                    <td><span className={`scope sc-${item.scope.toLowerCase()}`}>{item.scope[0]}</span></td>
                    <td>{item.name}</td>
                    <td className="muted">{item.role}</td>
                    <td className="ref">{item.channel}</td>
                    <td>{item.isLead ? <span className="status-pill up">Lead</span> : <span className="muted">No</span>}</td>
                    <td className="wrap-cell">{item.email ? <a className="doc-link" href={`mailto:${item.email}`}>{item.email}</a> : 'N/A'}</td>
                    <td className="wrap-cell">
                      <span className="contact-phone-cell">
                        <span>{item.phone || 'N/A'}</span>
                        {whatsappLink ? <a className="icon-btn whatsapp-link" href={whatsappLink} target="_blank" rel="noreferrer" title={`Open WhatsApp chat for ${item.name}`} aria-label={`Open WhatsApp chat for ${item.name}`}><MessageCircle size={14} /></a> : null}
                      </span>
                    </td>
                    <td className="ta-r"><div className="action-row"><EditButton onClick={() => { setContactForm({ name: item.name, role: item.role, channel: item.channel, email: item.email, phone: item.phone, scope: item.scope, isLead: item.isLead }); setEditor('contact', item.id); }} label="Edit contact" /><DeleteButton onClick={() => void deleteRecord('contact', item.id)} label="Delete contact" /></div></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Panel>
        {contactIntakeCollapsed ? (
          <aside className="workforce-controls-rail">
            <button type="button" className="controls-rail-btn" onClick={() => setContactIntakeCollapsed(false)} title="Expand add contact" aria-label="Expand add contact">
              <ChevronLeft size={16} />
              <span className="controls-rail-label">{editing.contact ? 'Edit contact' : 'Add contact'}</span>
            </button>
          </aside>
        ) : (
        <Panel title={editing.contact ? 'Edit contact' : 'Add contact'} className="workforce-controls objective-intake" meta={<button type="button" className="icon-btn" onClick={() => setContactIntakeCollapsed(true)} title="Collapse add contact" aria-label="Collapse add contact"><ChevronRight size={14} /></button>}>
          <form className="form-stack" onSubmit={(event) => { event.preventDefault(); if (editing.contact) { void saveRecord('contact', editing.contact, contactForm, () => { setContactForm(defaultContactForm); setEditor('contact', null); }); return; } void createRecord('contact', contactForm, () => setContactForm(defaultContactForm)); }}>
            <Field label="Name"><input value={contactForm.name} onChange={(event) => setContactForm({ ...contactForm, name: event.target.value })} required /></Field>
            <Field label="Role"><input value={contactForm.role} onChange={(event) => setContactForm({ ...contactForm, role: event.target.value })} required /></Field>
            <Field label="Sub Team"><input value={contactForm.channel} onChange={(event) => setContactForm({ ...contactForm, channel: event.target.value })} required /></Field>
            <Field label="Email"><input type="email" value={contactForm.email} onChange={(event) => setContactForm({ ...contactForm, email: event.target.value })} /></Field>
            <Field label="Phone"><input value={contactForm.phone} onChange={(event) => setContactForm({ ...contactForm, phone: event.target.value })} /></Field>
            <Field label="Scope"><select value={contactForm.scope} onChange={(event) => setContactForm({ ...contactForm, scope: event.target.value })}>{contactScopeOptions.map((item) => <option key={item} value={item}>{item}</option>)}</select></Field>
            <label className="check-row"><input type="checkbox" checked={contactForm.isLead} onChange={(event) => setContactForm({ ...contactForm, isLead: event.target.checked })} /> Team lead</label>
            <button className="primary-btn" type="submit" disabled={Boolean(busy)}><Plus size={14} /> {editing.contact ? 'Save contact' : 'Add contact'}</button>
            {editing.contact ? <button className="ghost-btn" type="button" onClick={() => { setContactForm(defaultContactForm); setEditor('contact', null); }}>Cancel edit</button> : null}
          </form>
        </Panel>
        )}
      </div>
    );
  }

  function renderNotes() {
    return (
      <div className="grid">
        <Panel title="Daily notes" span={8} meta={<span className="muted">{notesForSelectedDate.length} notes on {shortDateLabel(noteForm.noteDate)}</span>}>
          <div className="day-strip pad note-strip">
            <button type="button" className="ghost-btn" onClick={() => setNoteForm((current) => ({ ...current, noteDate: shiftMonth(current.noteDate, -1) }))}>Prev month</button>
            <Field label="Month"><input type="month" value={monthInputValue(noteForm.noteDate)} onChange={(event) => {
              const nextMonth = event.target.value;
              if (!nextMonth) {
                return;
              }
              const [year, month] = nextMonth.split('-');
              setNoteForm((current) => ({ ...current, noteDate: `${year}-${month}-01` }));
            }} /></Field>
            <strong className="month-label">{monthKeyLabel(noteForm.noteDate)}</strong>
            <button type="button" className="ghost-btn" onClick={() => setNoteForm((current) => ({ ...current, noteDate: shiftMonth(current.noteDate, 1) }))}>Next month</button>
          </div>
          <div className="day-strip pad">
            {noteMonthDates.map((date) => (
              <button key={date} type="button" className={date === noteForm.noteDate ? 'day-btn active' : 'day-btn'} onClick={() => setNoteForm((current) => ({ ...current, noteDate: date }))}>
                <strong>{shortDateLabel(date)}</strong>
                <span>{dayLabel(date)}</span>
                <small>{app.notes.filter((item) => item.noteDate === date).length} note</small>
              </button>
            ))}
          </div>
          <div className="summary-grid note-summary-grid">
            <article className="summary-card"><span>Selected date</span><strong>{shortDateLabel(noteForm.noteDate)}</strong><small>{notesForSelectedDate.length} entries</small></article>
            <article className="summary-card"><span>Month</span><strong>{monthKeyLabel(noteForm.noteDate)}</strong><small>{noteDatesInMonth.size} active days</small></article>
            <article className="summary-card"><span>Pinned</span><strong>{pinnedNotesForSelectedDate.length}</strong><small>flagged for follow-up</small></article>
          </div>
          <table className="grid-table">
            <thead>
              <tr><th>Date</th><th>Logged</th><th>Text</th><th>Pinned</th><th className="ta-r">Action</th></tr>
            </thead>
            <tbody>
              {notesForSelectedDate.map((item) => (
                <tr key={item.id}>
                  <td className="muted">{shortDateLabel(item.noteDate)}</td>
                  <td className="muted">{formatStamp(item.createdAt)}</td>
                  <td className="wrap-cell">{item.text}</td>
                  <td>{item.pinned ? <CheckCircle2 size={14} /> : 'No'}</td>
                  <td className="ta-r"><div className="action-row"><EditButton onClick={() => { setNoteForm({ noteDate: item.noteDate, text: item.text, pinned: item.pinned }); setEditor('note', item.id); }} label="Edit note" /><DeleteButton onClick={() => void deleteRecord('note', item.id)} label="Delete note" /></div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
        <Panel title={editing.note ? 'Edit daily note' : 'Add daily note'} span={4} meta={<span className="muted">date, month, year, pinned</span>}>
          <form className="form-stack" onSubmit={(event) => { event.preventDefault(); if (editing.note) { void saveRecord('note', editing.note, noteForm, () => { resetNoteForm(); setEditor('note', null); }); return; } void createRecord('note', noteForm, () => resetNoteForm()); }}>
            <Field label="Entry date"><input type="date" value={noteForm.noteDate} onChange={(event) => setNoteForm({ ...noteForm, noteDate: event.target.value })} required /></Field>
            <Field label="Note"><textarea value={noteForm.text} onChange={(event) => setNoteForm({ ...noteForm, text: event.target.value })} rows={6} required /></Field>
            <label className="check-row"><input type="checkbox" checked={noteForm.pinned} onChange={(event) => setNoteForm({ ...noteForm, pinned: event.target.checked })} /> Pin note</label>
            <button className="primary-btn" type="submit" disabled={Boolean(busy)}><Plus size={14} /> {editing.note ? 'Save note' : 'Add note'}</button>
            {editing.note ? <button className="ghost-btn" type="button" onClick={() => { resetNoteForm(); setEditor('note', null); }}>Cancel edit</button> : null}
          </form>
        </Panel>
      </div>
    );
  }

  function renderAdvisor() {
    return (
      <div className="grid">
        <Panel title="Latest executive update" span={7} meta={renderAdvisorMeta('Generate', true)}>
          <div className="brief-card large">
            <div className="brief-meta">
              <span className={`source-badge ${latestBrief?.source ?? 'fallback'}`}>{latestBrief?.source === 'llm' ? 'Cisco LLM' : 'Local fallback'}</span>
              <span className="muted">{latestBrief ? `${latestBrief.briefDate ? `for ${shortDateLabel(latestBrief.briefDate)} · ` : ''}${formatStamp(latestBrief.createdAt)}` : 'No update generated yet'}</span>
            </div>
            <AdvisorMarkdown content={latestBrief?.content} emptyText="No update available." />
          </div>
        </Panel>
        <Panel title="Update history" span={7} meta={<span className="muted">{app.advisorBriefs.length} stored updates</span>}>
          <table className="grid-table">
            <thead>
              <tr><th>For</th><th>Created</th><th>Source</th><th>Content</th></tr>
            </thead>
            <tbody>
              {app.advisorBriefs.map((item) => (
                <tr key={item.id}>
                  <td className="muted">{item.briefDate ? shortDateLabel(item.briefDate) : '—'}</td>
                  <td className="muted">{formatStamp(item.createdAt)}</td>
                  <td><span className={`source-badge ${item.source}`}>{item.source}</span></td>
                  <td className="wrap-cell"><AdvisorMarkdown content={item.content} emptyText="No update available." compact /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </div>
    );
  }

  function renderSettings() {
    const tabs = settingsTabs.filter((tab) => isAdmin || !tab.adminOnly);
    const currentTab = tabs.some((tab) => tab.key === settingsTab) ? settingsTab : 'appearance';
    const panes: Record<SettingsTab, () => ReactNode> = {
      system: () => (
        <Panel title="System status" meta={<span className="muted">server configuration</span>}>
          <div className="status-card-grid">
            <div className="status-card"><Database size={16} /><div><strong>Data source</strong><span>Shared SQLite server database</span></div></div>
            <div className="status-card"><Globe size={16} /><div><strong>LLM route</strong><span>{app.settings.llmConfigured ? 'Cisco Bridge configured' : 'Missing credentials'}</span></div></div>
            <div className="status-card"><ShieldCheck size={16} /><div><strong>Mode</strong><span>Read-only chief of staff advisor</span></div></div>
          </div>
        </Panel>
      ),
      clocks: () => (
        <Panel title="World clocks" meta={<span className="muted">shown in the top bar</span>}>
          <div className="clock-config">
            <Field label="Clock A">
              <select value={clockZones[0]} onChange={(event) => setClockZones([event.target.value, clockZones[1]])}>{timeZoneOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select>
            </Field>
            <Field label="Clock B">
              <select value={clockZones[1]} onChange={(event) => setClockZones([clockZones[0], event.target.value])}>{timeZoneOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select>
            </Field>
            <button className="primary-btn" type="button" onClick={() => void saveClockZones()} disabled={busy === 'clock-zones'}><Clock3 size={14} /> Save clocks</button>
          </div>
        </Panel>
      ),
      appearance: () => (
        <Panel title="Appearance" meta={<span className="muted">display preferences</span>}>
          <div className="appearance-config">
            <div className="appearance-row">
              <div className="appearance-label">
                <strong>Night mode</strong>
                <span className="muted">On for the dark colour scheme, off for day</span>
              </div>
              <ToggleSwitch checked={theme === 'night'} onChange={(next) => setTheme(next ? 'night' : 'day')} ariaLabel="Night mode" />
            </div>
            <div className="appearance-row">
              <div className="appearance-label">
                <strong>Tile view</strong>
                <span className="muted">On shows Issues, Objectives and Projects as tiles, off as a list</span>
              </div>
              <ToggleSwitch checked={registerView === 'tiles'} onChange={(next) => setRegisterView(next ? 'tiles' : 'list')} ariaLabel="Tile view" />
            </div>
            <div className="appearance-row">
              <div className="appearance-label">
                <strong>Expand panels by default</strong>
                <span className="muted">On starts the "Add" panels expanded, off starts them collapsed</span>
              </div>
              <ToggleSwitch checked={!panelsCollapsedByDefault} onChange={(next) => applyPanelDefaultCollapsed(!next)} ariaLabel="Expand panels by default" />
            </div>
          </div>
        </Panel>
      ),
      readiness: () => (
        <Panel title="SOC Readiness levers" meta={<span className="muted">tune the score model</span>}>
          <div className="lever-config">
            <div className="lever-preview">
              <span className="muted">Current readiness score with these settings</span>
              <strong className="lever-score">{summary ? summary.score : '—'}</strong>
            </div>
            {readinessLeverDefs.map((lever) => (
              <div className="lever-row" key={lever.key}>
                <div className="lever-head">
                  <strong>{lever.label}</strong>
                  <span className="lever-value">{readinessLevers[lever.key]}</span>
                </div>
                <input type="range" min={lever.min} max={lever.max} step={1} value={readinessLevers[lever.key]} onChange={(event) => setReadinessLevers({ ...readinessLevers, [lever.key]: Number(event.target.value) })} aria-label={lever.label} />
                <span className="muted lever-hint">{lever.hint}</span>
              </div>
            ))}
            <button className="ghost-btn" type="button" onClick={() => setReadinessLevers(defaultReadinessLevers)}>Reset to defaults</button>
          </div>
        </Panel>
      ),
      users: () => <UserManagementTab currentUserId={user.id} />,
      directory: () => <DirectorySettingsPanel />,
    };

    return (
      <div className="admin-console">
        <div className="ac-tabs" role="tablist" aria-label="Settings sections">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button key={tab.key} type="button" role="tab" id={`settings-tab-${tab.key}`} aria-selected={currentTab === tab.key} aria-controls="settings-panel" className={currentTab === tab.key ? 'ac-tab active' : 'ac-tab'} onClick={() => setSettingsTab(tab.key)}>
                <Icon size={16} /> {tab.label}
              </button>
            );
          })}
        </div>
        <div id="settings-panel" role="tabpanel" aria-labelledby={`settings-tab-${currentTab}`} className="settings-pane">
          {panes[currentTab]()}
        </div>
      </div>
    );
  }

  const moduleContent: Record<ActiveView, ReactNode> = {
    overview: renderOverview(),
    workforce: renderWorkforce(),
    standups: renderStandups(),
    service: renderService(),
    issues: renderIssues(),
    objectives: renderObjectives(),
    projects: renderProjects(),
    processes: renderProcesses(),
    contacts: renderContacts(),
    notes: renderNotes(),
    advisor: renderAdvisor(),
    settings: renderSettings(),
  };

  return (
    <div className="cockpit">
      <header className="topbar">
        <div className="brand">
          <img src={ciscoLogo} alt="Cisco" className="brand-logo" />
          <span className="brand-name">SOC COCKPIT</span>
        </div>

        <div className="topbar-right">
          <div className="clock-strip">
            {topClocks.map((item) => (
              <div className="clock-box" key={item.label}>
                <span className="clock-time">{formatClock(now, item.zone)}</span>
                <span className="clock-date">{item.label} · {formatDate(now, item.zone)}</span>
              </div>
            ))}
          </div>
          <div className="user-chip" title={`${user.username} (${user.role})`}>
            <span className="user-chip-name">{user.displayName || user.username}</span>
            <span className="user-chip-role">{user.role}</span>
            <button type="button" className="user-chip-btn" onClick={onSignOut} title="Sign out" aria-label="Sign out"><LogOut size={14} /></button>
          </div>
        </div>
      </header>

      <div className="shell">
        <nav className="rail" aria-label="Modules">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <button key={item.key} type="button" className={active === item.key ? 'rail-btn active' : 'rail-btn'} onClick={() => setActive(item.key as ActiveView)} title={item.label}>
                <Icon size={18} aria-hidden="true" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <main className="board">
          <div className="page-head">
            <div>
              <h1>{navItems.find((item) => item.key === active)?.label ?? 'Command'}</h1>
              <p>{active === 'overview' ? 'One-page operational command view backed by the shared web database.' : 'Live module backed by the web API and shared planning database.'}</p>
            </div>
            <div className="page-actions">
              <button className="ghost-btn" type="button" onClick={() => void refresh()} disabled={Boolean(busy)}><RefreshCw size={12} /> Reload</button>
            </div>
          </div>

          {error ? <div className="error-banner">{error}</div> : null}
          {moduleContent[active]}
        </main>
      </div>

      <footer className="statusbar" aria-label="Runtime connectivity status">
        <div className="statusbar-group">
          <span className="statusbar-label">Runtime</span>
          <span className={dbConnected ? 'status-pill up' : 'status-pill down'}>
            <Database size={12} aria-hidden="true" />
            SQLite {dbConnected ? 'Connected' : 'Disconnected'}
          </span>
          <span className={llmConnected ? 'status-pill up' : 'status-pill warn'}>
            <Sparkles size={12} aria-hidden="true" />
            LLM {llmConnected ? 'Configured' : 'Unavailable'}
          </span>
        </div>
        <div className="statusbar-group end">
          <span className="statusbar-label">Source</span>
          <span className="statusbar-text">{app.settings.dataSource}</span>
          <span className="statusbar-sep" aria-hidden="true">|</span>
          <span className="statusbar-text">{busy ? `Busy: ${busy}` : 'Idle'}</span>
        </div>
      </footer>

      <div className="assistant-widget">
        {assistantOpen ? (
          <div className={assistantExpanded ? 'assistant-dock expanded' : 'assistant-dock'}>
            <header className="assistant-head">
              <div className="assistant-title"><Sparkles size={14} /> Keo · AI SOC Assistant</div>
              <div className="assistant-head-actions">
                {assistantMessages.length ? <button type="button" className="icon-btn" onClick={() => setAssistantMessages([])} title="Clear chat" aria-label="Clear chat"><Trash2 size={14} /></button> : null}
                <button type="button" className="icon-btn" onClick={() => setAssistantExpanded((current) => !current)} title={assistantExpanded ? 'Compact Keo' : 'Expand Keo'} aria-label={assistantExpanded ? 'Compact Keo' : 'Expand Keo'}>{assistantExpanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}</button>
                <button type="button" className="icon-btn" onClick={() => setAssistantOpen(false)} title="Close Keo" aria-label="Close Keo"><ChevronDown size={14} /></button>
              </div>
            </header>
            <div className="assistant-log" ref={assistantLogRef}>
              {assistantMessages.length === 0 ? (
                <div className="assistant-hint">Hi, I'm Keo. Ask me about roster coverage, open issues, objectives, KPIs, standup tasks, or notes — I only spill the tea that's actually in the cockpit data.</div>
              ) : assistantMessages.map((message, index) => (
                <div key={index} className={`assistant-msg ${message.role}`}>
                  {message.role === 'assistant' ? <AdvisorMarkdown content={message.content} emptyText="" compact /> : <span>{message.content}</span>}
                </div>
              ))}
              {assistantBusy ? <div className="assistant-msg assistant"><span className="muted">Thinking…</span></div> : null}
              {assistantError ? <div className="assistant-error">{assistantError}</div> : null}
            </div>
            <form className="assistant-input" onSubmit={(event) => { event.preventDefault(); void sendAssistant(); }}>
              <input value={assistantInput} onChange={(event) => setAssistantInput(event.target.value)} placeholder={llmConnected ? 'Ask Keo about the cockpit…' : 'LLM not configured'} disabled={assistantBusy || !llmConnected} />
              <button type="submit" className="primary-btn" disabled={assistantBusy || !assistantInput.trim() || !llmConnected}>Send</button>
            </form>
          </div>
        ) : (
          <button type="button" className="assistant-fab" onClick={() => setAssistantOpen(true)} title="Ask Keo" aria-label="Open Keo the cockpit assistant">
            <Sparkles size={18} />
          </button>
        )}
      </div>
    </div>
  );
}
