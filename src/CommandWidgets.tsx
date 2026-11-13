// SPDX-FileCopyrightText: 2026 Cisco Systems, Inc.
// SPDX-License-Identifier: Apache-2.0

import { t, getLocale } from './i18n';
import type { AppSnapshot } from './types';

type Health = 'healthy' | 'watch' | 'risk';

const RAG: Record<Health, string> = {
  healthy: 'var(--healthy)',
  watch: 'var(--watch)',
  risk: 'var(--risk)',
};

function healthColor(h?: string): string {
  return RAG[(h as Health) in RAG ? (h as Health) : 'risk'];
}

function healthTextColor(h?: string): string {
  return h === 'watch' ? 'var(--head)' : '#fff';
}

function healthSubtextColor(h?: string): string {
  return h === 'watch' ? 'rgba(13,33,56,0.82)' : 'rgba(255,255,255,0.9)';
}

function ragFromScore(score: number): Health {
  if (score >= 85) return 'healthy';
  if (score >= 70) return 'watch';
  return 'risk';
}

function ragFromWorkingRatio(working: number, total: number): Health {
  const ratio = working / Math.max(total, 1);
  return working === 0 ? 'risk' : ratio < 0.34 ? 'risk' : ratio < 0.75 ? 'watch' : 'healthy';
}

function worstHealth(...values: Health[]): Health {
  return values.includes('risk') ? 'risk' : values.includes('watch') ? 'watch' : 'healthy';
}

function shiftDaysIso(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function dayNum(iso: string): string {
  return iso.slice(8, 10);
}

function weekdayShort(iso: string): string {
  return new Intl.DateTimeFormat(getLocale(), { weekday: 'narrow' }).format(new Date(`${iso}T00:00:00`));
}

function shortDate(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso || '—';
  return new Intl.DateTimeFormat(getLocale(), { day: '2-digit', month: 'short' }).format(new Date(`${iso}T00:00:00`));
}

const OFF_CODES = new Set(['DO']);
const LEAVE_CODES = new Set(['PL', 'SCK']);
const ROTATION_SHIFTS = new Set(['FS', 'SS', 'NS']);

function isWorkingCode(code: string): boolean {
  return Boolean(code) && !OFF_CODES.has(code) && !LEAVE_CODES.has(code);
}

// ── Service model ─────────────────────────────────────────────
// Only the TM (Threat Monitoring) service runs 24/7 shift rotation and must be
// covered at weekends. Every other team works weekdays only, so being off at
// the weekend is expected — not a coverage failure.
// UAE standard weekend = Saturday & Sunday. Change to [5, 6] for a Fri–Sat weekend.
const WEEKEND_DOW = new Set([6, 0]); // 6 = Sat, 0 = Sun
function isWeekend(iso: string): boolean {
  return WEEKEND_DOW.has(new Date(`${iso}T00:00:00`).getDay());
}

// Map every staff member to their channel.
function staffChannelMap(app: AppSnapshot): Map<string, string> {
  return new Map(
    app.contacts
      .filter((c) => c.scope === 'Staff' && c.name)
      .map((c) => [c.name, (c.channel || '').trim() || 'Unassigned']),
  );
}

// Data-driven: a channel is a 24/7 rotation (TM) team if ANY of its members is
// ever assigned a rotation shift (FS/SS/NS). No hard-coded team name required.
function rotationChannels(app: AppSnapshot): Set<string> {
  const chanOf = staffChannelMap(app);
  const set = new Set<string>();
  app.rosterAssignments.forEach((r) => {
    if (ROTATION_SHIFTS.has(r.shiftName)) {
      const ch = chanOf.get(r.analyst);
      if (ch) set.add(ch);
    }
  });
  return set;
}

// Is this channel expected to provide service on this date?
function isServiceDay(channel: string, iso: string, rotation: Set<string>): boolean {
  return rotation.has(channel) || !isWeekend(iso);
}

// Channel → staff names (from Directory staff records).
function channelGroups(app: AppSnapshot): { channel: string; analysts: string[] }[] {
  const map = new Map<string, string[]>();
  app.contacts
    .filter((c) => c.scope === 'Staff' && c.name)
    .forEach((c) => {
      const channel = (c.channel || '').trim() || 'Unassigned';
      map.set(channel, [...(map.get(channel) ?? []), c.name]);
    });
  return [...map.entries()]
    .map(([channel, analysts]) => ({ channel, analysts }))
    .filter((g) => g.analysts.length > 0)
    .sort((a, b) => b.analysts.length - a.analysts.length);
}

function compactChannelName(value: string): string {
  const words = value.split(/\s+/).filter(Boolean);
  if (value.length <= 5 || words.length === 0) return value.slice(0, 5);
  if (words.length === 1) return value.slice(0, 5).toUpperCase();
  return words.map((word) => word[0]).join('').slice(0, 5).toUpperCase();
}

// ---- Binary partition treemap (robust, decent aspect ratios) ----
type Tile<T> = T & { x: number; y: number; w: number; h: number };
function treemap<T extends { value: number }>(items: T[], x: number, y: number, w: number, h: number): Tile<T>[] {
  if (items.length === 0) return [];
  if (items.length === 1) return [{ ...items[0], x, y, w, h }];
  const total = items.reduce((s, i) => s + i.value, 0) || 1;
  let acc = 0;
  let splitIdx = 0;
  let best = Infinity;
  for (let i = 0; i < items.length - 1; i++) {
    acc += items[i].value;
    const diff = Math.abs(acc - total / 2);
    if (diff < best) {
      best = diff;
      splitIdx = i;
    }
  }
  const first = items.slice(0, splitIdx + 1);
  const second = items.slice(splitIdx + 1);
  const firstVal = first.reduce((s, i) => s + i.value, 0);
  const ratio = firstVal / total;
  if (w >= h) {
    const wl = w * ratio;
    return [...treemap(first, x, y, wl, h), ...treemap(second, x + wl, y, w - wl, h)];
  }
  const ht = h * ratio;
  return [...treemap(first, x, y, w, ht), ...treemap(second, x, y + ht, w, h - ht)];
}

function polar(cx: number, cy: number, r: number, deg: number) {
  const rad = ((deg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}
function arcPath(cx: number, cy: number, r: number, startDeg: number, endDeg: number) {
  const start = polar(cx, cy, r, endDeg);
  const end = polar(cx, cy, r, startDeg);
  const largeArc = endDeg - startDeg <= 180 ? '0' : '1';
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 0 ${end.x} ${end.y}`;
}

// ==================================================================
// 1. SOC Readiness gauge
// ==================================================================
export function ReadinessGauge({ score, gaps, atRisk, openIssues }: { score: number; gaps: number; atRisk: number; openIssues: number }) {
  const clamped = Math.max(0, Math.min(100, score));
  const health = ragFromScore(clamped);
  const valueDeg = -90 + (clamped / 100) * 180;
  return (
    <svg viewBox="0 0 320 200" role="img" aria-label={t("SOC readiness {{value0}}", { value0: clamped })}>
      <path d={arcPath(160, 160, 118, -90, 90)} fill="none" stroke="#e4ebf2" strokeWidth={20} strokeLinecap="round" />
      <path d={arcPath(160, 160, 118, -90, valueDeg)} fill="none" stroke={healthColor(health)} strokeWidth={20} strokeLinecap="round" />
      <text x={160} y={150} textAnchor="middle" fontSize={52} fontWeight={700} fill="var(--head)">{clamped}</text>
      <text x={160} y={178} textAnchor="middle" fontSize={13} fill="var(--muted)" letterSpacing="0.5">{t("READINESS")}</text>
      <text x={42} y={192} textAnchor="middle" fontSize={11} fill="var(--muted)">0</text>
      <text x={278} y={192} textAnchor="middle" fontSize={11} fill="var(--muted)">100</text>
      <text x={160} y={198} textAnchor="middle" fontSize={11} fill="var(--muted)">{gaps} {t("gaps ·")} {atRisk} {t("at risk ·")} {openIssues} {t("open")}</text>
    </svg>
  );
}

// ==================================================================
// 2. SLA / KPI health heatmap
// ==================================================================
export function SlaHeatmap({ app }: { app: AppSnapshot }) {
  const rank: Record<string, number> = { risk: 0, watch: 1, healthy: 2 };
  const kpis = app.kpis;
  const reds = kpis.filter((k) => k.health === 'risk').length;
  const watches = kpis.filter((k) => k.health === 'watch').length;
  if (kpis.length === 0) return <div className="widget-empty">{t("No KPIs defined.")}</div>;
  const shown = [...kpis].sort((a, b) => (rank[a.health] ?? 3) - (rank[b.health] ?? 3)).slice(0, 12);
  return (
    <div className="sla-heat-wrap">
      <div className="sla-heat">
        {shown.map((k) => (
          <div key={k.id} className="sla-tile" style={{ background: healthColor(k.health), color: healthTextColor(k.health) }} title={t("{{value0}}: {{value1}} (target {{value2}})", { value0: k.name, value1: k.actual, value2: k.target })}>
            <span className="sla-code">{k.code}</span>
            <span className="sla-val">{k.actual || '—'}</span>
            <span className="sla-trend">{k.trend === 'up' ? '▲' : k.trend === 'down' ? '▼' : '—'} {k.delta}</span>
          </div>
        ))}
      </div>
      <div className="widget-foot">
        {reds + watches > 0
          ? <span className="foot-alert">{reds} {t("off target ·")} {watches} {t("watch ·")} {kpis.length} {t("tracked")}</span>
          : <span className="foot-ok">{t("All")} {kpis.length} {t("KPIs within tolerance")}</span>}
      </div>
    </div>
  );
}

// ==================================================================
// 3. Risk & decisions
// ==================================================================
export function RiskDecisions({ app }: { app: AppSnapshot }) {
  const issues = app.issues ?? [];
  const activeIssues = issues.filter((i) => i.status !== 'Closed');
  const risk = activeIssues.filter((i) => i.health === 'risk').length;
  const watch = activeIssues.filter((i) => i.health === 'watch').length;
  const healthy = activeIssues.filter((i) => i.health === 'healthy').length;
  const total = Math.max(activeIssues.length, 1);
  const topRisk = activeIssues.filter((i) => i.health === 'risk').slice(0, 3);
  const seg = (n: number, color: string) => (n > 0 ? <div style={{ width: `${(n / total) * 100}%`, background: color }} title={t(`${n}`)} /> : null);
  return (
    <div className="risk-wrap">
      <div className="risk-top">
        <div className="risk-big"><strong>{risk + watch}</strong><span>{t("open issues")}</span></div>
        <div className="risk-decisions"><strong>{risk}</strong><span>{t("need a decision")}</span></div>
      </div>
      <div className="risk-bar">
        {seg(risk, 'var(--risk)')}
        {seg(watch, 'var(--watch)')}
        {seg(healthy, 'var(--healthy)')}
      </div>
      <div className="risk-legend"><span><i style={{ background: 'var(--risk)' }} />{t("Risk")} {risk}</span><span><i style={{ background: 'var(--watch)' }} />{t("Watch")} {watch}</span><span><i style={{ background: 'var(--healthy)' }} />{t("OK")} {healthy}</span></div>
      <ul className="risk-list">
        {topRisk.length ? topRisk.map((i) => <li key={i.id} title={t(i.title)}>{i.title}</li>) : <li className="muted">{t("No risk-flagged issues.")}</li>}
      </ul>
    </div>
  );
}

// ==================================================================
// 4. Channel coverage treemap
// ==================================================================
export function CoverageTreemap({ app, planningDate }: { app: AppSnapshot; planningDate: string }) {
  const groups = channelGroups(app);
  const byAnalyst = new Map<string, { code: string; status: string }>();
  app.rosterAssignments
    .filter((r) => r.rosterDate === planningDate)
    .forEach((r) => byAnalyst.set(r.analyst, { code: r.shiftName, status: r.status }));

  const rotation = rotationChannels(app);
  const items = groups.map((g) => {
    const serviceDay = isServiceDay(g.channel, planningDate, rotation);
    let working = 0;
    let leave = 0;
    const shiftsCovered = new Set<string>();
    g.analysts.forEach((name) => {
      const a = byAnalyst.get(name);
      if (!a || a.status === 'Gap') return;
      if (LEAVE_CODES.has(a.code)) leave += 1;
      else if (isWorkingCode(a.code)) {
        working += 1;
        if (ROTATION_SHIFTS.has(a.code)) shiftsCovered.add(a.code);
      }
    });
    const total = g.analysts.length;
    if (!serviceDay) {
      // Weekday team on a weekend: off by design → neutral, excluded from RAG.
      return { key: g.channel, value: total, working, total, offDay: true, isRotation: false, shifts: 0, health: 'healthy' as Health };
    }
    if (rotation.has(g.channel)) {
      // 24/7 rotation: health = how many of the 3 shifts (FS/SS/NS) are staffed.
      const shifts = shiftsCovered.size;
      const shiftHealth: Health = shifts >= 3 ? 'healthy' : shifts === 2 ? 'watch' : 'risk';
      const health = worstHealth(shiftHealth, ragFromWorkingRatio(working, total));
      return { key: g.channel, value: total, working, total, offDay: false, isRotation: true, shifts, health };
    }
    const health = ragFromWorkingRatio(working, total);
    return { key: g.channel, value: total, working, total, offDay: false, isRotation: false, shifts: 0, health };
  });
  if (items.length === 0) return <div className="widget-empty">{t("No staff sub teams.")}</div>;

  const W = 320;
  const H = 196;
  const tiles = treemap(items, 0, 0, W, H);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t("Coverage by channel")}>
      {tiles.map((t, index) => {
        const short = t.key.length > 14 ? `${t.key.slice(0, 13)}…` : t.key;
        const compact = compactChannelName(t.key);
        const fill = t.offDay ? 'var(--muted)' : healthColor(t.health);
        const textFill = t.offDay ? '#fff' : healthTextColor(t.health);
        const subFill = t.offDay ? 'rgba(255,255,255,0.9)' : healthSubtextColor(t.health);
        const sub = t.offDay ? 'rest day' : t.isRotation ? `${t.shifts}/3 shifts · ${t.working}/${t.total} on` : `${t.working}/${t.total} on`;
        const canShowDetail = t.w > 78 && t.h > 38;
        const canShowLabel = t.w > 24 && t.h > 18;
        const inset = t.w > 44 ? 6 : 4;
        const clipId = `coverage-tile-${index}`;
        return (
          <g key={t.key}>
            <rect x={t.x} y={t.y} width={t.w} height={t.h} fill={fill} stroke="#fff" strokeWidth={2} />
            <clipPath id={clipId}>
              <rect x={t.x + 3} y={t.y + 3} width={Math.max(t.w - 6, 0)} height={Math.max(t.h - 6, 0)} />
            </clipPath>
            {canShowLabel ? (
              <>
                <text x={t.x + inset} y={t.y + (canShowDetail ? 16 : Math.max(13, t.h / 2 + 3))} fontSize={canShowDetail ? 11 : 9} fontWeight={700} fill={textFill} clipPath={`url(#${clipId})`}>{canShowDetail ? short : compact}</text>
                {canShowDetail ? <text x={t.x + inset} y={t.y + 31} fontSize={10} fill={subFill} clipPath={`url(#${clipId})`}>{sub}</text> : null}
              </>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}

// ==================================================================
// 5. 14-day coverage heat-strip
// ==================================================================
export function CoverageHeatStrip({ app, planningDate }: { app: AppSnapshot; planningDate: string }) {
  const shifts = ['FS', 'SS', 'NS'];
  const days = Array.from({ length: 14 }, (_, i) => shiftDaysIso(planningDate, i));
  const counts = new Map<string, number>();
  app.rosterAssignments.forEach((r) => {
    const key = `${r.shiftName}__${r.rosterDate}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  });
  const cellColor = (n: number) => (n === 0 ? 'var(--risk)' : n === 1 ? 'var(--watch)' : 'var(--healthy)');

  const W = 320;
  const H = 196;
  const leftPad = 26;
  const topPad = 26;
  const cellW = (W - leftPad) / days.length;
  const cellH = (H - topPad - 8) / shifts.length;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t("14 day coverage")}>
      {days.map((d, ci) => (
        <text key={d} x={leftPad + ci * cellW + cellW / 2} y={16} textAnchor="middle" fontSize={8} fill="var(--muted)">{dayNum(d)}</text>
      ))}
      {days.map((d, ci) => (
        <text key={`w${d}`} x={leftPad + ci * cellW + cellW / 2} y={24} textAnchor="middle" fontSize={7} fill="var(--faint)">{weekdayShort(d)}</text>
      ))}
      {shifts.map((s, ri) => (
        <text key={s} x={4} y={topPad + ri * cellH + cellH / 2 + 4} fontSize={10} fontWeight={700} fill="var(--head)">{s}</text>
      ))}
      {shifts.map((s, ri) =>
        days.map((d, ci) => {
          const n = counts.get(`${s}__${d}`) ?? 0;
          return (
            <rect
              key={`${s}-${d}`}
              x={leftPad + ci * cellW + 1}
              y={topPad + ri * cellH + 1}
              width={cellW - 2}
              height={cellH - 2}
              rx={2}
              fill={cellColor(n)}
              opacity={n === 0 ? 0.85 : 1}
            >
              <title>{s} {d}: {n} {t("on shift")}</title>
            </rect>
          );
        }),
      )}
    </svg>
  );
}

// ==================================================================
// 6. Leave & workload
// ==================================================================
export function LeaveWorkload({ app, planningDate }: { app: AppSnapshot; planningDate: string }) {
  const month = planningDate.slice(0, 7);
  const groups = channelGroups(app);
  const rotation = rotationChannels(app);
  const chanOf = staffChannelMap(app);
  const leaveByAnalyst = new Map<string, number>();
  app.rosterAssignments
    .filter((r) => r.rosterDate.startsWith(`${month}-`) && LEAVE_CODES.has(r.shiftName))
    .forEach((r) => {
      // Only count leave on days the person would otherwise be working.
      const ch = chanOf.get(r.analyst) || 'Unassigned';
      if (!isServiceDay(ch, r.rosterDate, rotation)) return;
      leaveByAnalyst.set(r.analyst, (leaveByAnalyst.get(r.analyst) ?? 0) + 1);
    });

  const rows = groups
    .map((g) => ({ channel: g.channel, leave: g.analysts.reduce((s, n) => s + (leaveByAnalyst.get(n) ?? 0), 0) }))
    .sort((a, b) => b.leave - a.leave);
  const maxLeave = Math.max(1, ...rows.map((r) => r.leave));
  const totalLeave = rows.reduce((s, r) => s + r.leave, 0);

  const W = 320;
  const rowH = 22;
  const labelW = 118;
  const H = Math.max(60, rows.length * rowH + 24);
  return (
    <div className="lw-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t("Leave load per team")}>
        {rows.map((r, i) => {
          const bw = (r.leave / maxLeave) * (W - labelW - 34);
          const color = r.leave >= maxLeave * 0.75 && maxLeave > 3 ? 'var(--risk)' : r.leave >= maxLeave * 0.4 ? 'var(--watch)' : 'var(--medium-blue)';
          const short = r.channel.length > 16 ? `${r.channel.slice(0, 15)}…` : r.channel;
          return (
            <g key={r.channel} transform={`translate(0 ${i * rowH + 6})`}>
              <text x={0} y={12} fontSize={10} fill="var(--ink)">{short}</text>
              <rect x={labelW} y={3} width={W - labelW - 34} height={11} rx={3} fill="#eef2f6" />
              <rect x={labelW} y={3} width={Math.max(bw, r.leave > 0 ? 3 : 0)} height={11} rx={3} fill={color} />
              <text x={W - 4} y={13} textAnchor="end" fontSize={10} fontWeight={700} fill="var(--head)">{r.leave}</text>
            </g>
          );
        })}
      </svg>
      <div className="widget-foot"><span className="muted">{totalLeave} {t("working-day absence(s) in")} {shortDate(`${month}-01`).split(' ')[1]}</span></div>
    </div>
  );
}

// ==================================================================
// 7. Standup daily trend
// ==================================================================
export function StandupDailyTrend({ app }: { app: AppSnapshot }) {
  const todayDate = new Date();
  todayDate.setHours(0, 0, 0, 0);
  const today = `${todayDate.getFullYear()}-${String(todayDate.getMonth() + 1).padStart(2, '0')}-${String(todayDate.getDate()).padStart(2, '0')}`;
  const days = Array.from({ length: 30 }, (_, index) => shiftDaysIso(today, -(29 - index)));
  const byDay = new Map<string, { total: number; completed: number }>();

  app.matrixTasks.forEach((task) => {
    const bucket = byDay.get(task.taskDate) ?? { total: 0, completed: 0 };
    bucket.total += 1;
    if (task.status === 'Completed') {
      bucket.completed += 1;
    }
    byDay.set(task.taskDate, bucket);
  });

  const rows = days.map((iso) => {
    const bucket = byDay.get(iso) ?? { total: 0, completed: 0 };
    return {
      iso,
      total: bucket.total,
      completed: bucket.completed,
      remaining: Math.max(bucket.total - bucket.completed, 0),
    };
  });
  const maxTotal = Math.max(1, ...rows.map((row) => row.total));
  const totalRecorded = rows.reduce((sum, row) => sum + row.total, 0);
  const totalCompleted = rows.reduce((sum, row) => sum + row.completed, 0);
  const completionRate = totalRecorded ? ((totalCompleted / totalRecorded) * 100).toFixed(1) : '0.0';

  const W = 720;
  const H = 210;
  const chartX = 34;
  const chartY = 14;
  const chartW = W - chartX - 12;
  const chartH = 154;
  const gap = 4;
  const barW = (chartW - gap * (rows.length - 1)) / rows.length;
  const axisLevels = [0, Math.ceil(maxTotal / 2), maxTotal].filter((value, index, list) => list.indexOf(value) === index);

  return (
    <div className="task-trend-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t("Recorded versus completed standup tasks per day for the last 30 days")}>
        {axisLevels.map((level) => {
          const y = chartY + chartH - (level / maxTotal) * chartH;
          return (
            <g key={level}>
              <line x1={chartX} y1={y} x2={chartX + chartW} y2={y} stroke="#e4ebf2" strokeWidth={1} />
              <text x={chartX - 8} y={y + 4} textAnchor="end" fontSize={9} fill="var(--muted)">{level}</text>
            </g>
          );
        })}
        {rows.map((row, index) => {
          const x = chartX + index * (barW + gap);
          const totalHeight = (row.total / maxTotal) * chartH;
          const completedHeight = (row.completed / maxTotal) * chartH;
          const remainingHeight = totalHeight - completedHeight;
          const totalY = chartY + chartH - totalHeight;
          const completedY = chartY + chartH - completedHeight;
          const radius = Math.min(3, barW / 2);
          return (
            <g key={row.iso}>
              {row.remaining > 0 ? (
                <rect x={x} y={totalY} width={barW} height={remainingHeight} rx={radius} fill="#cfd9e4">
                  <title>{t("{{value0}}: {{value1}} recorded, {{value2}} completed, {{value3}} not completed", { value0: row.iso, value1: row.total, value2: row.completed, value3: row.remaining })}</title>
                </rect>
              ) : null}
              {row.completed > 0 ? (
                <rect x={x} y={completedY} width={barW} height={completedHeight} rx={radius} fill="var(--healthy)">
                  <title>{t("{{value0}}: {{value1}} recorded, {{value2}} completed", { value0: row.iso, value1: row.total, value2: row.completed })}</title>
                </rect>
              ) : null}
              {row.total === 0 ? <circle cx={x + barW / 2} cy={chartY + chartH - 2} r={1.4} fill="#d5dde6" /> : null}
              {index % 5 === 0 || index === rows.length - 1 ? <text x={x + barW / 2} y={chartY + chartH + 13} textAnchor="middle" fontSize={9} fill="var(--muted)">{dayNum(row.iso)}</text> : null}
              {index % 10 === 0 || index === rows.length - 1 ? <text x={x + barW / 2} y={chartY + chartH + 24} textAnchor="middle" fontSize={8} fill="var(--faint)">{weekdayShort(row.iso)}</text> : null}
            </g>
          );
        })}
      </svg>
      <div className="widget-foot task-trend-foot">
        <span className="muted">{t("Last 30 days:")} {totalRecorded} {t("recorded ·")} {totalCompleted} {t("completed ·")} {completionRate}{t("% completion")}</span>
        <span className="task-trend-legend"><i className="trend-chip completed" />{t("Completed")} <i className="trend-chip remaining" />{t("Recorded, not completed")}</span>
      </div>
    </div>
  );
}

// ==================================================================
// 8. Eisenhower snapshot
// ==================================================================
export function EisenhowerSnapshot({ app, planningDate }: { app: AppSnapshot; planningDate: string }) {
  const tasks = app.matrixTasks.filter((t) => t.taskDate === planningDate);
  const openBy = (q: string) => tasks.filter((t) => t.quadrant === q && t.status !== 'Completed').length;
  const completed = tasks.filter((t) => t.status === 'Completed').length;
  const cells: { q: string; label: string; cls: string }[] = [
    { q: 'Do', label: 'Do', cls: 'do' },
    { q: 'Delegate', label: 'Delegate', cls: 'delegate' },
    { q: 'Delay', label: 'Delay', cls: 'delay' },
    { q: 'Discard', label: 'Discard', cls: 'discard' },
  ];
  return (
    <div className="eh-wrap">
      <div className="eh-grid">
        {cells.map((c) => (
          <div key={c.q} className={`eh-cell quadrant-chip ${c.cls}`}>
            <strong>{openBy(c.q)}</strong>
            <span>{t(c.label)}</span>
          </div>
        ))}
      </div>
      <div className="widget-foot"><span className="muted">{completed}/{tasks.length || 0} {t("done today")}</span></div>
    </div>
  );
}

// ==================================================================
// 9. Objectives & projects progress (bullet bars)
// ==================================================================
export function ObjectivesProjects({ app }: { app: AppSnapshot }) {
  const rank: Record<string, number> = { risk: 0, watch: 1, healthy: 2 };
  const rows = [
    ...app.objectives.map((o) => ({ id: `o${o.id}`, label: o.title, progress: o.progress, health: o.health, due: o.due, kind: 'OBJ' })),
    ...app.projects.map((p) => ({ id: `p${p.id}`, label: p.name, progress: p.progress, health: p.health, due: p.due, kind: 'PRJ' })),
  ]
    .sort((a, b) => (rank[a.health] ?? 3) - (rank[b.health] ?? 3) || String(a.due).localeCompare(String(b.due)))
    .slice(0, 6);
  const atRisk = [...app.objectives, ...app.projects].filter((x) => x.health !== 'healthy').length;
  if (rows.length === 0) return <div className="widget-empty">{t("No objectives or projects.")}</div>;
  return (
    <div className="op-wrap">
      <div className="op-list">
        {rows.map((r) => (
          <div className="op-row" key={r.id} title={t(r.label)}>
            <span className="op-kind">{r.kind}</span>
            <span className="op-label">{r.label}</span>
            <span className="op-track"><span className="op-fill" style={{ width: `${Math.max(3, Math.min(100, r.progress))}%`, background: healthColor(r.health) }} /></span>
            <span className="op-due">{shortDate(r.due)}</span>
          </div>
        ))}
      </div>
      <div className="widget-foot">{atRisk > 0 ? <span className="foot-alert">{atRisk} {t("at risk / watch")}</span> : <span className="foot-ok">{t("All on track")}</span>}</div>
    </div>
  );
}

// ==================================================================
// 10. Process maturity radar
// ==================================================================
export function MaturityRadar({ app }: { app: AppSnapshot }) {
  const procs = (app.processes ?? []).slice(0, 8);
  if (procs.length < 3) return <div className="widget-empty">{t("Need at least 3 processes for a radar.")}</div>;
  const W = 320;
  const H = 196;
  const cx = W / 2;
  const cy = H / 2 + 2;
  const r = 74;
  const n = procs.length;
  const angle = (i: number) => (i / n) * 2 * Math.PI - Math.PI / 2;
  const pt = (i: number, radius: number) => ({ x: cx + radius * Math.cos(angle(i)), y: cy + radius * Math.sin(angle(i)) });
  const rings = [1, 2, 3, 4, 5];
  const avg = procs.reduce((s, p) => s + (p.maturity || 0), 0) / n;
  const poly = procs.map((p, i) => { const q = pt(i, (Math.max(0, Math.min(5, p.maturity)) / 5) * r); return `${q.x},${q.y}`; }).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t("Process maturity radar")}>
      {rings.map((ring) => (
        <polygon
          key={ring}
          points={procs.map((_, i) => { const q = pt(i, (ring / 5) * r); return `${q.x},${q.y}`; }).join(' ')}
          fill={ring === 2 ? 'rgba(213,50,63,0.06)' : 'none'}
          stroke="#dbe3ea"
          strokeWidth={1}
        />
      ))}
      {procs.map((_, i) => { const q = pt(i, r); return <line key={i} x1={cx} y1={cy} x2={q.x} y2={q.y} stroke="#e4ebf2" strokeWidth={1} />; })}
      <polygon points={poly} fill="rgba(10,96,255,0.22)" stroke="var(--medium-blue)" strokeWidth={2} />
      {procs.map((p, i) => {
        const q = pt(i, r + 12);
        return <text key={p.id} x={q.x} y={q.y} textAnchor={q.x < cx - 4 ? 'end' : q.x > cx + 4 ? 'start' : 'middle'} fontSize={8} fill="var(--muted)">{p.code || p.name.slice(0, 6)}</text>;
      })}
      <text x={cx} y={cy + 3} textAnchor="middle" fontSize={12} fontWeight={700} fill="var(--head)">{avg.toFixed(1)}</text>
    </svg>
  );
}
