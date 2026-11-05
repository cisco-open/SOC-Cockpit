// SPDX-FileCopyrightText: 2026 Cisco Systems, Inc.
// SPDX-License-Identifier: Apache-2.0

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const incidents = require('./incidents.cjs');

const DEFAULT_CLOCK_ZONES = ['UTC', 'America/New_York'];

function createStore({ dbPath, env }) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  const workspaceRoot = path.join(path.dirname(dbPath), '..');

  initSchema(db);
  ensureProcessSchema(db);
  ensureNotesSchema(db);
  ensureMatrixTaskSchema(db);
  ensureContactSchema(db);
  ensureObjectiveSchema(db);
  ensureIssueSchema(db);
  ensureKpiRuleSchema(db);
  ensureAdvisorSchema(db);
  ensureDefaultSettings(db);
  incidents.ensureIncidentSchema(db);

  function getSnapshot() {
    return {
      settings: {
        extraClockZones: readClockZones(db),
        llmConfigured: Boolean(env.OPENAI_API_KEY),
        dataSource: 'server-db',
        rosterStaff: readRosterStaff(db),
        rosterLabels: readRosterLabels(db),
        workforceChannelOrder: readWorkforceChannelOrder(db),
        reports: incidents.readReportSettings(db),
      },
      kpis: db.prepare('SELECT id, code, name, actual, target, health, trend, delta, direction, tolerance FROM kpis ORDER BY id').all(),
      rosterAssignments: db.prepare('SELECT id, roster_date AS rosterDate, shift_name AS shiftName, role, analyst, status, health, notes FROM roster_assignments ORDER BY roster_date, shift_name, role').all(),
      matrixTasks: db.prepare('SELECT id, task_date AS taskDate, title, lead, assignee, duration_minutes AS durationMinutes, urgency, importance, quadrant, disposition, due_time AS dueTime, status, notes, objective_id AS objectiveId FROM matrix_tasks ORDER BY task_date DESC, lead, id').all().map((row) => ({ ...row, status: normalizeMatrixStatus(row.status) })),
      objectives: db.prepare('SELECT id, scope, title, summary, owner, assigned_to AS assignedTo, due, progress, health, attachment_name AS attachmentName, attachment_path AS attachmentPath FROM objectives ORDER BY id').all(),
      issues: db.prepare('SELECT id, scope, status, title, summary, owner, assigned_to AS assignedTo, linked_type AS linkedType, linked_id AS linkedId, due, progress, health, created_at AS createdAt, closed_at AS closedAt FROM issues ORDER BY id').all().map((row) => ({ ...row, status: normalizeIssueStatus(row.status) })),
      followUps: db.prepare('SELECT id, ref, title, owner, age, health FROM follow_ups ORDER BY id').all(),
      projects: db.prepare('SELECT id, code, name, owner, phase, due, progress, health FROM projects ORDER BY id').all(),
      processes: db.prepare('SELECT id, code, name, owner, cadence, maturity, health, notes, attachment_name AS attachmentName, attachment_path AS attachmentPath FROM processes ORDER BY id').all(),
      contacts: db.prepare('SELECT id, name, role, channel, email, phone, scope, is_lead AS isLead FROM contacts ORDER BY name, id').all().map((row) => ({ ...row, isLead: Boolean(row.isLead) })),
      notes: db.prepare('SELECT id, created_at AS createdAt, note_date AS noteDate, text, pinned FROM notes ORDER BY pinned DESC, note_date DESC, datetime(created_at) DESC').all().map((row) => ({ ...row, pinned: Boolean(row.pinned) })),
      advisorBriefs: db.prepare('SELECT id, created_at AS createdAt, content, source, brief_date AS briefDate FROM advisor_briefs ORDER BY datetime(created_at) DESC').all(),
      incidents: incidents.readIncidents(db),
    };
  }

  function createRecord(kind, payload) {
    switch (kind) {
      case 'kpi': {
        const rule = kpiRule(payload);
        db.prepare('INSERT INTO kpis (code, name, actual, target, health, trend, delta, direction, tolerance) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
          .run(text(payload.code), text(payload.name), text(payload.actual), text(payload.target), rule.health, text(payload.trend, 'flat'), text(payload.delta), rule.direction, rule.tolerance);
        break;
      }
      case 'rosterAssignment':
        db.prepare('INSERT INTO roster_assignments (roster_date, shift_name, role, analyst, status, health, notes) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .run(text(payload.rosterDate), text(payload.shiftName), text(payload.role), text(payload.analyst), text(payload.status, 'Planned'), text(payload.health, 'healthy'), text(payload.notes));
        break;
      case 'matrixTask': {
        const urgency = bool(payload.urgency);
        const importance = bool(payload.importance);
        db.prepare('INSERT INTO matrix_tasks (task_date, title, lead, assignee, duration_minutes, urgency, importance, quadrant, disposition, due_time, status, notes, objective_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
          .run(
            text(payload.taskDate),
            text(payload.title),
            text(payload.lead),
            text(payload.assignee),
            integer(payload.durationMinutes),
            urgency,
            importance,
            resolveQuadrant(urgency, importance),
            text(payload.disposition, resolveQuadrant(urgency, importance)),
            text(payload.dueTime),
            normalizeMatrixStatus(payload.status, 'Not Completed'),
            text(payload.notes),
            integer(payload.objectiveId)
          );
        break;
      }
      case 'objective':
        db.prepare('INSERT INTO objectives (scope, title, summary, owner, assigned_to, due, progress, health) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
          .run(text(payload.scope, 'D'), text(payload.title), text(payload.summary), text(payload.owner), text(payload.assignedTo), text(payload.due), integer(payload.progress), text(payload.health, 'watch'));
        break;
      case 'issue': {
        const status = normalizeIssueStatus(payload.status, inferIssueStatus(payload.progress));
        const createdAt = new Date().toISOString();
        db.prepare('INSERT INTO issues (scope, status, title, summary, owner, assigned_to, linked_type, linked_id, due, progress, health, created_at, closed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
          .run(text(payload.scope, 'D'), status, text(payload.title), text(payload.summary), text(payload.owner), text(payload.assignedTo), text(payload.linkedType), integer(payload.linkedId), text(payload.due), integer(payload.progress), text(payload.health, 'watch'), createdAt, status === 'Closed' ? createdAt : '');
        break;
      }
      case 'incident':
        incidents.insertIncident(db, payload);
        break;
      case 'followUp':
        db.prepare('INSERT INTO follow_ups (ref, title, owner, age, health) VALUES (?, ?, ?, ?, ?)')
          .run(text(payload.ref), text(payload.title), text(payload.owner), text(payload.age), text(payload.health, 'watch'));
        break;
      case 'project':
        db.prepare('INSERT INTO projects (code, name, owner, phase, due, progress, health) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .run(text(payload.code), text(payload.name), text(payload.owner), text(payload.phase), text(payload.due), integer(payload.progress), text(payload.health, 'watch'));
        break;
      case 'process':
        db.prepare('INSERT INTO processes (code, name, owner, cadence, maturity, health, notes) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .run(text(payload.code), text(payload.name), text(payload.owner), text(payload.cadence), maturity(payload.maturity), text(payload.health, 'watch'), text(payload.notes));
        break;
      case 'contact':
        db.prepare('INSERT INTO contacts (name, role, channel, email, phone, scope, is_lead) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .run(text(payload.name), text(payload.role), text(payload.channel), text(payload.email), normalizeContactPhone(payload.phone), text(payload.scope, 'Staff'), bool(payload.isLead));
        syncRosterStaffFromContact(db, null, payload);
        break;
      case 'note':
        db.prepare('INSERT INTO notes (created_at, note_date, text, pinned) VALUES (?, ?, ?, ?)')
          .run(new Date().toISOString(), noteDate(payload.noteDate), text(payload.text), bool(payload.pinned));
        break;
      default:
        throw new Error(`Unsupported record kind: ${kind}`);
    }

    return getSnapshot();
  }

  function deleteRecord(kind, id) {
    const tableByKind = {
      kpi: 'kpis',
      rosterAssignment: 'roster_assignments',
      matrixTask: 'matrix_tasks',
      objective: 'objectives',
      issue: 'issues',
      followUp: 'follow_ups',
      project: 'projects',
      process: 'processes',
      contact: 'contacts',
      note: 'notes',
      incident: 'incidents',
    };
    const table = tableByKind[kind];
    if (!table) {
      throw new Error(`Unsupported record kind: ${kind}`);
    }
    if (kind === 'objective' || kind === 'process') {
      const table = kind === 'objective' ? 'objectives' : 'processes';
      const existing = db.prepare(`SELECT attachment_path FROM ${table} WHERE id = ?`).get(integer(id));
      removeStoredFile(existing?.attachment_path);
    }
    if (kind === 'objective') {
      db.prepare('UPDATE matrix_tasks SET objective_id = 0 WHERE objective_id = ?').run(integer(id));
    }
    if (kind === 'contact') {
      const existing = db.prepare('SELECT name, scope FROM contacts WHERE id = ?').get(integer(id));
      syncRosterStaffFromContact(db, existing, null);
    }
    db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(integer(id));
    return getSnapshot();
  }

  function updateRecord(kind, id, payload) {
    switch (kind) {
      case 'kpi': {
        const rule = kpiRule(payload);
        db.prepare('UPDATE kpis SET code = ?, name = ?, actual = ?, target = ?, health = ?, trend = ?, delta = ?, direction = ?, tolerance = ? WHERE id = ?')
          .run(text(payload.code), text(payload.name), text(payload.actual), text(payload.target), rule.health, text(payload.trend, 'flat'), text(payload.delta), rule.direction, rule.tolerance, integer(id));
        break;
      }
      case 'rosterAssignment':
        db.prepare('UPDATE roster_assignments SET roster_date = ?, shift_name = ?, role = ?, analyst = ?, status = ?, health = ?, notes = ? WHERE id = ?')
          .run(text(payload.rosterDate), text(payload.shiftName), text(payload.role), text(payload.analyst), text(payload.status, 'Planned'), text(payload.health, 'healthy'), text(payload.notes), integer(id));
        break;
      case 'matrixTask': {
        const urgency = bool(payload.urgency);
        const importance = bool(payload.importance);
        const quadrant = resolveQuadrant(urgency, importance);
        db.prepare('UPDATE matrix_tasks SET task_date = ?, title = ?, lead = ?, assignee = ?, duration_minutes = ?, urgency = ?, importance = ?, quadrant = ?, disposition = ?, due_time = ?, status = ?, notes = ?, objective_id = ? WHERE id = ?')
          .run(text(payload.taskDate), text(payload.title), text(payload.lead), text(payload.assignee), integer(payload.durationMinutes), urgency, importance, quadrant, text(payload.disposition, quadrant), text(payload.dueTime), normalizeMatrixStatus(payload.status, 'Not Completed'), text(payload.notes), integer(payload.objectiveId), integer(id));
        break;
      }
      case 'objective':
        db.prepare('UPDATE objectives SET scope = ?, title = ?, summary = ?, owner = ?, assigned_to = ?, due = ?, progress = ?, health = ? WHERE id = ?')
          .run(text(payload.scope, 'D'), text(payload.title), text(payload.summary), text(payload.owner), text(payload.assignedTo), text(payload.due), integer(payload.progress), text(payload.health, 'watch'), integer(id));
        break;
      case 'issue': {
        const status = normalizeIssueStatus(payload.status, inferIssueStatus(payload.progress));
        const previous = db.prepare('SELECT status, closed_at FROM issues WHERE id = ?').get(integer(id));
        // Record when an issue is closed (and clear it if reopened) so reports can count closures per period.
        const closedAt = status === 'Closed' ? (previous?.status === 'Closed' && previous.closed_at ? previous.closed_at : new Date().toISOString()) : '';
        db.prepare('UPDATE issues SET scope = ?, status = ?, title = ?, summary = ?, owner = ?, assigned_to = ?, linked_type = ?, linked_id = ?, due = ?, progress = ?, health = ?, closed_at = ? WHERE id = ?')
          .run(text(payload.scope, 'D'), status, text(payload.title), text(payload.summary), text(payload.owner), text(payload.assignedTo), text(payload.linkedType), integer(payload.linkedId), text(payload.due), integer(payload.progress), text(payload.health, 'watch'), closedAt, integer(id));
        break;
      }
      case 'incident':
        incidents.updateIncident(db, id, payload);
        break;
      case 'followUp':
        db.prepare('UPDATE follow_ups SET ref = ?, title = ?, owner = ?, age = ?, health = ? WHERE id = ?')
          .run(text(payload.ref), text(payload.title), text(payload.owner), text(payload.age), text(payload.health, 'watch'), integer(id));
        break;
      case 'project':
        db.prepare('UPDATE projects SET code = ?, name = ?, owner = ?, phase = ?, due = ?, progress = ?, health = ? WHERE id = ?')
          .run(text(payload.code), text(payload.name), text(payload.owner), text(payload.phase), text(payload.due), integer(payload.progress), text(payload.health, 'watch'), integer(id));
        break;
      case 'process':
        db.prepare('UPDATE processes SET code = ?, name = ?, owner = ?, cadence = ?, maturity = ?, health = ?, notes = ? WHERE id = ?')
          .run(text(payload.code), text(payload.name), text(payload.owner), text(payload.cadence), maturity(payload.maturity), text(payload.health, 'watch'), text(payload.notes), integer(id));
        break;
      case 'contact':
        {
          const existing = db.prepare('SELECT name, scope FROM contacts WHERE id = ?').get(integer(id));
          db.prepare('UPDATE contacts SET name = ?, role = ?, channel = ?, email = ?, phone = ?, scope = ?, is_lead = ? WHERE id = ?')
            .run(text(payload.name), text(payload.role), text(payload.channel), text(payload.email), normalizeContactPhone(payload.phone), text(payload.scope, 'Staff'), bool(payload.isLead), integer(id));
          syncRosterStaffFromContact(db, existing, payload);
        }
        break;
      case 'note':
        db.prepare('UPDATE notes SET note_date = ?, text = ?, pinned = ? WHERE id = ?')
          .run(noteDate(payload.noteDate), text(payload.text), bool(payload.pinned), integer(id));
        break;
      default:
        throw new Error(`Unsupported record kind: ${kind}`);
    }

    return getSnapshot();
  }

  function updateClockZones(zones) {
    const nextZones = Array.isArray(zones) ? zones.filter(Boolean).slice(0, 2) : DEFAULT_CLOCK_ZONES;
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run('extraClockZones', JSON.stringify(nextZones.length === 2 ? nextZones : DEFAULT_CLOCK_ZONES));
    return getSnapshot();
  }

  function updateRosterPlannerSettings(payload) {
    const nextStaff = normalizeRosterStaff(payload?.staff);
    const nextLabels = normalizeRosterLabels(payload?.labels);
    const nextChannelOrder = normalizeWorkforceChannelOrder(payload?.channelOrder);
    upsertSetting(db, 'rosterStaff', JSON.stringify(nextStaff));
    upsertSetting(db, 'rosterLabels', JSON.stringify(nextLabels));
    upsertSetting(db, 'workforceChannelOrder', JSON.stringify(nextChannelOrder));
    return getSnapshot();
  }

  function renameRosterStaff(previousName, nextName) {
    const from = text(previousName);
    const to = text(nextName);
    if (!from || !to) {
      throw new Error('Both previousName and nextName are required.');
    }
    const currentStaff = readRosterStaff(db);
    const updatedStaff = currentStaff.map((item) => item === from ? to : item);
    upsertSetting(db, 'rosterStaff', JSON.stringify(normalizeRosterStaff(updatedStaff)));
    db.prepare('UPDATE roster_assignments SET analyst = ? WHERE analyst = ?').run(to, from);
    return getSnapshot();
  }

  function updateRosterLabelDefinition(previousCode, payload) {
    const from = text(previousCode);
    const currentLabels = readRosterLabels(db);
    const currentLabel = currentLabels.find((item) => item.code === from);
    if (!currentLabel) {
      throw new Error('Roster label not found.');
    }

    const nextCode = text(payload?.code, currentLabel.code).slice(0, 8);
    const nextLabel = {
      code: nextCode,
      label: text(payload?.label, currentLabel.label),
      hours: text(payload?.hours, currentLabel.hours),
      status: text(payload?.status, currentLabel.status),
      health: text(payload?.health, currentLabel.health),
      fill: text(payload?.fill, currentLabel.fill),
      textColor: text(payload?.textColor, currentLabel.textColor),
    };

    const updatedLabels = currentLabels.map((item) => item.code === from ? nextLabel : item);
    upsertSetting(db, 'rosterLabels', JSON.stringify(normalizeRosterLabels(updatedLabels)));
    db.prepare('UPDATE roster_assignments SET shift_name = ?, role = ?, status = ?, health = ?, notes = ? WHERE shift_name = ?')
      .run(nextLabel.code, nextLabel.label, nextLabel.status, nextLabel.health, nextLabel.hours, from);
    return getSnapshot();
  }

  function upsertRosterPlan(changes) {
    const items = Array.isArray(changes) ? changes : [];
    const selectExisting = db.prepare('SELECT id FROM roster_assignments WHERE roster_date = ? AND analyst = ? ORDER BY id');
    const updateExisting = db.prepare('UPDATE roster_assignments SET shift_name = ?, role = ?, status = ?, health = ?, notes = ? WHERE id = ?');
    const insertNew = db.prepare('INSERT INTO roster_assignments (roster_date, shift_name, role, analyst, status, health, notes) VALUES (?, ?, ?, ?, ?, ?, ?)');
    const deleteById = db.prepare('DELETE FROM roster_assignments WHERE id = ?');

    items.forEach((item) => {
      const rosterDate = text(item.rosterDate);
      const analyst = text(item.analyst);
      const existing = selectExisting.all(rosterDate, analyst);

      if (!rosterDate || !analyst) {
        return;
      }

      if (item.clear || !item.code) {
        existing.forEach((row) => deleteById.run(row.id));
        return;
      }

      const shiftCode = text(item.code);
      const label = text(item.label, shiftCode);
      const hours = text(item.hours);
      const status = text(item.status, 'Planned');
      const health = text(item.health, 'healthy');

      if (existing.length > 0) {
        updateExisting.run(shiftCode, label, status, health, hours, existing[0].id);
        existing.slice(1).forEach((row) => deleteById.run(row.id));
        return;
      }

      insertNew.run(rosterDate, shiftCode, label, analyst, status, health, hours);
    });

    return getSnapshot();
  }

  function updateMatrixTask(id, payload) {
    const existing = db.prepare('SELECT id, task_date, title, lead, urgency, importance, status, assignee, duration_minutes, due_time, notes, objective_id FROM matrix_tasks WHERE id = ?').get(integer(id));
    if (!existing) {
      throw new Error('Task not found');
    }
    const urgency = payload.urgency == null ? existing.urgency : bool(payload.urgency);
    const importance = payload.importance == null ? existing.importance : bool(payload.importance);
    const quadrant = resolveQuadrant(urgency, importance);
    db.prepare('UPDATE matrix_tasks SET task_date = ?, title = ?, lead = ?, assignee = ?, duration_minutes = ?, due_time = ?, notes = ?, status = ?, urgency = ?, importance = ?, quadrant = ?, disposition = ?, objective_id = ? WHERE id = ?')
      .run(
        text(payload.taskDate, existing.task_date),
        text(payload.title, existing.title),
        text(payload.lead, existing.lead),
        text(payload.assignee, existing.assignee),
        payload.durationMinutes == null ? integer(existing.duration_minutes) : integer(payload.durationMinutes),
        text(payload.dueTime, existing.due_time),
        text(payload.notes, existing.notes),
        normalizeMatrixStatus(payload.status, existing.status),
        urgency,
        importance,
        quadrant,
        quadrant,
        payload.objectiveId == null ? integer(existing.objective_id) : integer(payload.objectiveId),
        integer(id)
      );
    return getSnapshot();
  }

  function carryOverMatrixTasks(toDate, fromDate) {
    const target = noteDate(toDate);
    let source = text(fromDate);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(source)) {
      const prior = db.prepare("SELECT task_date FROM matrix_tasks WHERE task_date < ? AND status <> 'Completed' ORDER BY task_date DESC LIMIT 1").get(target);
      source = prior?.task_date ?? '';
    }
    if (!source || source >= target) {
      return getSnapshot();
    }

    const incomplete = db.prepare("SELECT title, lead, assignee, duration_minutes, urgency, importance, quadrant, disposition, due_time, notes, objective_id FROM matrix_tasks WHERE task_date = ? AND status <> 'Completed'").all(source);
    const existing = db.prepare('SELECT title, lead FROM matrix_tasks WHERE task_date = ?').all(target);
    const existingKeys = new Set(existing.map((row) => `${text(row.title).toLowerCase()}__${text(row.lead).toLowerCase()}`));
    const insert = db.prepare('INSERT INTO matrix_tasks (task_date, title, lead, assignee, duration_minutes, urgency, importance, quadrant, disposition, due_time, status, notes, objective_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');

    for (const task of incomplete) {
      const key = `${text(task.title).toLowerCase()}__${text(task.lead).toLowerCase()}`;
      if (existingKeys.has(key)) {
        continue;
      }
      existingKeys.add(key);
      insert.run(
        target,
        text(task.title),
        text(task.lead),
        text(task.assignee),
        integer(task.duration_minutes),
        bool(task.urgency),
        bool(task.importance),
        text(task.quadrant),
        text(task.disposition),
        text(task.due_time),
        'Not Completed',
        '',
        integer(task.objective_id)
      );
    }

    return getSnapshot();
  }

  function importStandupTasks(inputRows) {
    const rows = Array.isArray(inputRows) ? inputRows : [];
    // Keyed on Date + Task Description + Lead so re-imported sheets enrich the existing task instead of duplicating it.
    const existing = db.prepare('SELECT id, task_date, title, lead, assignee, duration_minutes, urgency, importance, due_time, status, notes, objective_id FROM matrix_tasks').all();
    const byKey = new Map(
      existing.map((row) => [`${text(row.task_date)}__${text(row.title).toLowerCase()}__${text(row.lead).toLowerCase()}`, row]),
    );
    const insert = db.prepare('INSERT INTO matrix_tasks (task_date, title, lead, assignee, duration_minutes, urgency, importance, quadrant, disposition, due_time, status, notes, objective_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    const update = db.prepare('UPDATE matrix_tasks SET assignee = ?, duration_minutes = ?, urgency = ?, importance = ?, quadrant = ?, disposition = ?, due_time = ?, status = ?, notes = ?, objective_id = ? WHERE id = ?');

    // Objective lookup is case-insensitive on trimmed title; a title stays the durable link key while ids persist across renames.
    const objectiveByTitle = new Map();
    for (const objective of db.prepare('SELECT id, title FROM objectives').all()) {
      const nameKey = text(objective.title).toLowerCase();
      if (!objectiveByTitle.has(nameKey)) {
        objectiveByTitle.set(nameKey, []);
      }
      objectiveByTitle.get(nameKey).push(objective.id);
    }
    const insertObjective = db.prepare('INSERT INTO objectives (scope, title, summary, owner, assigned_to, due, progress, health) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    const createdObjectives = [];
    const ambiguousObjectives = new Set();

    let added = 0;
    let updated = 0;
    let skipped = 0;
    let objectivesCreated = 0;
    let tasksLinked = 0;

    const resolveObjectiveId = (rawTitle, lead, taskDate) => {
      const objectiveTitle = text(rawTitle);
      if (!objectiveTitle) {
        return 0;
      }
      const nameKey = objectiveTitle.toLowerCase();
      const matches = objectiveByTitle.get(nameKey);
      if (matches && matches.length === 1) {
        return matches[0];
      }
      if (matches && matches.length > 1) {
        ambiguousObjectives.add(objectiveTitle);
        return 0;
      }
      const info = insertObjective.run('D', objectiveTitle, 'Created from offline standup import', text(lead), '', text(taskDate), 0, 'watch');
      const objectiveId = Number(info.lastInsertRowid);
      objectiveByTitle.set(nameKey, [objectiveId]);
      objectivesCreated += 1;
      createdObjectives.push(objectiveTitle);
      return objectiveId;
    };

    for (const row of rows) {
      const taskDate = text(row.taskDate);
      const title = text(row.title);
      const lead = text(row.lead);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(taskDate) || !title || !lead) {
        skipped += 1;
        continue;
      }
      const key = `${taskDate}__${title.toLowerCase()}__${lead.toLowerCase()}`;

      const urgency = bool(row.urgency);
      const importance = bool(row.importance);
      const quadrant = resolveQuadrant(urgency, importance);
      const incomingMinutes = integer(row.durationMinutes);
      const incomingAssignee = text(row.assignee);
      const incomingDueTime = text(row.dueTime);
      const incomingNotes = text(row.notes);
      const resolvedObjectiveId = resolveObjectiveId(row.objective, lead, taskDate);

      const match = byKey.get(key);
      if (match) {
        // Enrich the existing task; keep prior values when the incoming cell is blank.
        const objectiveId = resolvedObjectiveId || integer(match.objective_id);
        update.run(
          incomingAssignee || text(match.assignee),
          incomingMinutes > 0 ? incomingMinutes : integer(match.duration_minutes),
          urgency,
          importance,
          quadrant,
          quadrant,
          incomingDueTime || text(match.due_time),
          normalizeMatrixStatus(row.status, normalizeMatrixStatus(match.status, 'Not Completed')),
          incomingNotes || text(match.notes),
          objectiveId,
          match.id,
        );
        match.objective_id = objectiveId;
        if (resolvedObjectiveId) {
          tasksLinked += 1;
        }
        updated += 1;
        continue;
      }

      const info = insert.run(
        taskDate,
        title,
        lead,
        incomingAssignee,
        incomingMinutes,
        urgency,
        importance,
        quadrant,
        quadrant,
        incomingDueTime,
        normalizeMatrixStatus(row.status, 'Not Completed'),
        incomingNotes,
        resolvedObjectiveId,
      );
      byKey.set(key, {
        id: Number(info.lastInsertRowid),
        task_date: taskDate,
        title,
        lead,
        assignee: incomingAssignee,
        duration_minutes: incomingMinutes,
        urgency,
        importance,
        due_time: incomingDueTime,
        status: normalizeMatrixStatus(row.status, 'Not Completed'),
        notes: incomingNotes,
        objective_id: resolvedObjectiveId,
      });
      if (resolvedObjectiveId) {
        tasksLinked += 1;
      }
      added += 1;
    }

    return {
      snapshot: getSnapshot(),
      added,
      updated,
      skipped,
      objectivesCreated,
      tasksLinked,
      createdObjectives,
      ambiguousObjectives: [...ambiguousObjectives],
    };
  }

  function attachProcessDocument(id, document) {
    const existing = db.prepare('SELECT id, attachment_path FROM processes WHERE id = ?').get(integer(id));
    if (!existing) {
      throw new Error('Process not found');
    }

    db.prepare('UPDATE processes SET attachment_name = ?, attachment_path = ? WHERE id = ?')
      .run(text(document?.name), text(document?.path), integer(id));

    if (existing.attachment_path && existing.attachment_path !== document?.path) {
      removeStoredFile(existing.attachment_path);
    }

    return getSnapshot();
  }

  function attachObjectiveDocument(id, document) {
    const existing = db.prepare('SELECT id, attachment_path FROM objectives WHERE id = ?').get(integer(id));
    if (!existing) {
      throw new Error('Objective not found');
    }

    db.prepare('UPDATE objectives SET attachment_name = ?, attachment_path = ? WHERE id = ?')
      .run(text(document?.name), text(document?.path), integer(id));

    if (existing.attachment_path && existing.attachment_path !== document?.path) {
      removeStoredFile(existing.attachment_path);
    }

    return getSnapshot();
  }

  function removeStoredFile(relativePath) {
    const normalized = text(relativePath);
    if (!normalized.startsWith('/uploads/')) {
      return;
    }

    const absolutePath = path.join(workspaceRoot, normalized.slice(1).replaceAll('/', path.sep));
    if (fs.existsSync(absolutePath)) {
      fs.unlinkSync(absolutePath);
    }
  }

  async function generateAdvisorBrief(targetDate) {
    const snapshot = getSnapshot();
    const briefDate = noteDate(targetDate);
    let content;
    let source = 'fallback';
    try {
      content = await generateAdvisorWithLlm(snapshot, env, briefDate);
      source = 'llm';
    } catch (error) {
      console.error('[advisor] LLM generation failed, using fallback:', error);
      content = buildFallbackBrief(snapshot, briefDate);
    }
    db.prepare('INSERT INTO advisor_briefs (created_at, content, source, brief_date) VALUES (?, ?, ?, ?)').run(new Date().toISOString(), content, source, briefDate);
    return getSnapshot();
  }

  async function answerQuestion(messages) {
    const snapshot = getSnapshot();
    const directAnswer = tryAnswerStandupTaskQuestion(snapshot, messages);
    if (directAnswer) {
      return { answer: directAnswer };
    }
    const answer = await answerQuestionWithLlm(snapshot, messages, env);
    return { answer };
  }

  return {
    getSnapshot,
    createRecord,
    deleteRecord,
    updateRecord,
    updateReportSettings(payload) {
      incidents.writeReportSettings(db, payload);
      return getSnapshot();
    },
    importIncidentsCsv(csvText) {
      const result = incidents.importIncidentsCsv(db, csvText);
      return { ...result, snapshot: getSnapshot() };
    },
    async importIncidentsXlsx(buffer) {
      const result = await incidents.importIncidentsXlsx(db, buffer);
      return { ...result, snapshot: getSnapshot() };
    },
    updateClockZones,
    updateRosterPlannerSettings,
    renameRosterStaff,
    updateRosterLabelDefinition,
    upsertRosterPlan,
    updateMatrixTask,
    carryOverMatrixTasks,
    importStandupTasks,
    attachObjectiveDocument,
    attachProcessDocument,
    generateAdvisorBrief,
    answerQuestion,
  };
}

function initSchema(db) {
  db.exec(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS kpis (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      actual TEXT NOT NULL,
      target TEXT NOT NULL,
      health TEXT NOT NULL,
      trend TEXT NOT NULL,
      delta TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS roster_assignments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      roster_date TEXT NOT NULL,
      shift_name TEXT NOT NULL,
      role TEXT NOT NULL,
      analyst TEXT NOT NULL,
      status TEXT NOT NULL,
      health TEXT NOT NULL,
      notes TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS matrix_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_date TEXT NOT NULL,
      title TEXT NOT NULL,
      lead TEXT NOT NULL,
      assignee TEXT NOT NULL,
      duration_minutes INTEGER NOT NULL DEFAULT 0,
      urgency INTEGER NOT NULL,
      importance INTEGER NOT NULL,
      quadrant TEXT NOT NULL,
      disposition TEXT NOT NULL,
      due_time TEXT NOT NULL,
      status TEXT NOT NULL,
      notes TEXT NOT NULL DEFAULT '',
      objective_id INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS objectives (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scope TEXT NOT NULL,
      title TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      owner TEXT NOT NULL,
      assigned_to TEXT NOT NULL DEFAULT '',
      due TEXT NOT NULL,
      progress INTEGER NOT NULL,
      health TEXT NOT NULL,
      attachment_name TEXT NOT NULL DEFAULT '',
      attachment_path TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS issues (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scope TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'Open',
      title TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      owner TEXT NOT NULL,
      assigned_to TEXT NOT NULL DEFAULT '',
      linked_type TEXT NOT NULL DEFAULT '',
      linked_id INTEGER NOT NULL DEFAULT 0,
      due TEXT NOT NULL,
      progress INTEGER NOT NULL,
      health TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS follow_ups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ref TEXT NOT NULL,
      title TEXT NOT NULL,
      owner TEXT NOT NULL,
      age TEXT NOT NULL,
      health TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS assets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      domain TEXT NOT NULL,
      onboarded INTEGER NOT NULL,
      pending INTEGER NOT NULL,
      health TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      owner TEXT NOT NULL,
      phase TEXT NOT NULL,
      due TEXT NOT NULL,
      progress INTEGER NOT NULL,
      health TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS processes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      owner TEXT NOT NULL,
      cadence TEXT NOT NULL,
      maturity INTEGER NOT NULL,
      health TEXT NOT NULL,
      notes TEXT NOT NULL DEFAULT '',
      attachment_name TEXT NOT NULL DEFAULT '',
      attachment_path TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS contacts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      channel TEXT NOT NULL,
      email TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      scope TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL,
      note_date TEXT NOT NULL DEFAULT '',
      text TEXT NOT NULL,
      pinned INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS advisor_briefs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL,
      content TEXT NOT NULL,
      source TEXT NOT NULL,
      brief_date TEXT NOT NULL DEFAULT ''
    );
  `);
}

function ensureDefaultSettings(db) {
  ensureSetting(db, 'extraClockZones', JSON.stringify(DEFAULT_CLOCK_ZONES));
  ensureSetting(db, 'rosterStaff', JSON.stringify([]));
  ensureSetting(db, 'rosterLabels', JSON.stringify([]));
  ensureSetting(db, 'workforceChannelOrder', JSON.stringify([]));
}

function ensureProcessSchema(db) {
  ensureColumn(db, 'processes', 'attachment_name', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'processes', 'attachment_path', "TEXT NOT NULL DEFAULT ''");
}

function ensureNotesSchema(db) {
  ensureColumn(db, 'notes', 'note_date', "TEXT NOT NULL DEFAULT ''");
  db.prepare("UPDATE notes SET note_date = substr(created_at, 1, 10) WHERE note_date = '' OR note_date IS NULL").run();
}

function ensureMatrixTaskSchema(db) {
  ensureColumn(db, 'matrix_tasks', 'duration_minutes', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'matrix_tasks', 'objective_id', 'INTEGER NOT NULL DEFAULT 0');
}

function ensureContactSchema(db) {
  ensureColumn(db, 'contacts', 'email', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'contacts', 'phone', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'contacts', 'is_lead', 'INTEGER NOT NULL DEFAULT 0');
  const rows = db.prepare("SELECT id, phone FROM contacts WHERE trim(phone) <> ''").all();
  const update = db.prepare('UPDATE contacts SET phone = ? WHERE id = ?');
  rows.forEach((row) => {
    const normalized = normalizeContactPhone(row.phone);
    if (normalized !== row.phone) {
      update.run(normalized, row.id);
    }
  });
}

function ensureObjectiveSchema(db) {
  ensureColumn(db, 'objectives', 'summary', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'objectives', 'assigned_to', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'objectives', 'attachment_name', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'objectives', 'attachment_path', "TEXT NOT NULL DEFAULT ''");
  const rows = db.prepare("SELECT id, title, summary FROM objectives WHERE summary = '' AND instr(title, ':') > 0").all();
  const update = db.prepare('UPDATE objectives SET title = ?, summary = ? WHERE id = ?');
  rows.forEach((row) => {
    const split = splitObjectiveText(row.title);
    if (split.summary) {
      update.run(split.title, split.summary, row.id);
    }
  });
}

function ensureIssueSchema(db) {
  const issueColumns = db.prepare('PRAGMA table_info(issues)').all();
  const hadStatusColumn = issueColumns.some((column) => column.name === 'status');
  ensureColumn(db, 'issues', 'status', "TEXT NOT NULL DEFAULT 'Open'");
  ensureColumn(db, 'issues', 'summary', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'issues', 'assigned_to', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'issues', 'linked_type', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'issues', 'created_at', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'issues', 'closed_at', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'issues', 'linked_id', 'INTEGER NOT NULL DEFAULT 0');
  const migrationRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('issueStatusMigrationV1');
  if (!hadStatusColumn || migrationRow?.value !== 'done') {
    const rows = db.prepare('SELECT id, progress FROM issues').all();
    const update = db.prepare('UPDATE issues SET status = ? WHERE id = ?');
    rows.forEach((row) => {
      update.run(inferIssueStatus(row.progress), row.id);
    });
    upsertSetting(db, 'issueStatusMigrationV1', 'done');
  }
  const invalidRows = db.prepare("SELECT id, progress, status FROM issues WHERE status IS NULL OR trim(status) = '' OR status = 'healthy' OR status = 'watch' OR status = 'risk'").all();
  const normalize = db.prepare('UPDATE issues SET status = ? WHERE id = ?');
  invalidRows.forEach((row) => {
    normalize.run(inferIssueStatus(row.progress), row.id);
  });
}

function ensureKpiRuleSchema(db) {
  // direction: '' (health set by hand), 'higher' or 'lower' is better. tolerance: amber band in % of target.
  ensureColumn(db, 'kpis', 'direction', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'kpis', 'tolerance', 'REAL NOT NULL DEFAULT 5');
}

// When a KPI has a health rule, its health is calculated from actual vs target instead of picked by hand.
function kpiRule(payload) {
  const direction = ['higher', 'lower'].includes(text(payload.direction)) ? text(payload.direction) : '';
  const parsedTolerance = Number(payload.tolerance);
  const tolerance = Number.isFinite(parsedTolerance) ? Math.min(100, Math.max(0, parsedTolerance)) : 5;
  const computed = incidents.computeKpiHealth(payload.actual, payload.target, direction, tolerance);
  return { direction, tolerance, health: computed ?? text(payload.health, 'watch') };
}

function ensureAdvisorSchema(db) {
  ensureColumn(db, 'advisor_briefs', 'brief_date', "TEXT NOT NULL DEFAULT ''");
  db.prepare("UPDATE advisor_briefs SET brief_date = substr(created_at, 1, 10) WHERE brief_date = '' OR brief_date IS NULL").run();
}

function addDaysIso(baseIso, delta) {
  const d = new Date(`${baseIso}T00:00:00`);
  d.setDate(d.getDate() + delta);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function readClockZones(db) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('extraClockZones');
  if (!row) {
    return DEFAULT_CLOCK_ZONES;
  }
  try {
    const parsed = JSON.parse(row.value);
    return Array.isArray(parsed) && parsed.length === 2 ? parsed : DEFAULT_CLOCK_ZONES;
  } catch {
    return DEFAULT_CLOCK_ZONES;
  }
}

function readRosterStaff(db) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('rosterStaff');
  if (!row) {
    return [];
  }
  try {
    return normalizeRosterStaff(JSON.parse(row.value));
  } catch {
    return [];
  }
}

function readRosterLabels(db) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('rosterLabels');
  if (!row) {
    return [];
  }
  try {
    return normalizeRosterLabels(JSON.parse(row.value));
  } catch {
    return [];
  }
}

function readWorkforceChannelOrder(db) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('workforceChannelOrder');
  if (!row) {
    return [];
  }
  try {
    return normalizeWorkforceChannelOrder(JSON.parse(row.value));
  } catch {
    return [];
  }
}

function syncRosterStaffFromContact(db, previousContact, nextContact) {
  const previousName = previousContact?.scope === 'Staff' ? text(previousContact?.name) : '';
  const nextName = nextContact?.scope === 'Staff' ? text(nextContact?.name) : '';
  const currentStaff = readRosterStaff(db);
  const updatedStaff = currentStaff.filter((item) => item !== previousName);

  if (nextName && !updatedStaff.includes(nextName)) {
    updatedStaff.push(nextName);
  }

  upsertSetting(db, 'rosterStaff', JSON.stringify(normalizeRosterStaff(updatedStaff)));

  if (previousName && nextName && previousName !== nextName) {
    db.prepare('UPDATE roster_assignments SET analyst = ? WHERE analyst = ?').run(nextName, previousName);
  }
}

function normalizeRosterStaff(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  const unique = new Set();
  value.forEach((item) => {
    const next = text(item);
    if (next) {
      unique.add(next);
    }
  });
  return Array.from(unique);
}

function normalizeWorkforceChannelOrder(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  const unique = new Set();
  value.forEach((item) => {
    const next = text(item);
    if (next) {
      unique.add(next);
    }
  });
  return Array.from(unique);
}

function normalizeRosterLabels(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  const normalized = value.map((item) => ({
    code: text(item?.code).slice(0, 8),
    label: text(item?.label),
    hours: text(item?.hours),
    status: text(item?.status, 'Planned'),
    health: text(item?.health, 'healthy'),
    fill: text(item?.fill, '#32b7c6'),
    textColor: text(item?.textColor, '#ffffff'),
  })).filter((item) => item.code && item.label);

  return normalized;
}

function upsertSetting(db, key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
}

function ensureSetting(db, key, value) {
  db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').run(key, value);
}

function ensureColumn(db, tableName, columnName, definition) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
  if (!columns.some((column) => column.name === columnName)) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }
}

function splitObjectiveText(value) {
  const source = text(value);
  const separatorIndex = source.indexOf(':');
  if (separatorIndex < 1) {
    return { title: source, summary: '' };
  }
  return {
    title: source.slice(0, separatorIndex).trim(),
    summary: source.slice(separatorIndex + 1).trim(),
  };
}

function text(value, fallback = '') {
  return String(value ?? fallback).trim();
}

function normalizeContactPhone(value) {
  const normalized = text(value);
  if (!normalized) {
    return '';
  }

  const digitsOnly = normalized.replace(/\D/g, '');
  if (/^05\d{8}$/.test(digitsOnly)) {
    return `+971${digitsOnly.slice(1)}`;
  }
  if (/^5\d{8}$/.test(digitsOnly)) {
    return `+971${digitsOnly}`;
  }
  if (/^9715\d{8}$/.test(digitsOnly)) {
    return `+${digitsOnly}`;
  }
  if (/^009715\d{8}$/.test(digitsOnly)) {
    return `+${digitsOnly.slice(2)}`;
  }

  return normalized;
}

function integer(value) {
  const parsed = Number.parseInt(String(value ?? '0'), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function maturity(value) {
  return Math.max(0, Math.min(5, integer(value)));
}

function bool(value) {
  if (typeof value === 'boolean') {
    return value ? 1 : 0;
  }
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase()) ? 1 : 0;
}

function noteDate(value) {
  const normalized = text(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : isoDate(0);
}

function inferIssueStatus(progress) {
  const normalized = integer(progress);
  if (normalized >= 100) {
    return 'Closed';
  }
  if (normalized > 0) {
    return 'In Progress';
  }
  return 'Open';
}

function normalizeIssueStatus(value, fallback = 'Open') {
  const normalized = text(value, fallback);
  if (normalized === 'Closed') {
    return 'Closed';
  }
  if (normalized === 'In Progress') {
    return 'In Progress';
  }
  return 'Open';
}

function normalizeMatrixStatus(value, fallback = 'Not Completed') {
  const normalized = text(value, fallback);
  return normalized === 'Completed' || normalized === 'Closed' ? 'Completed' : 'Not Completed';
}

function resolveQuadrant(urgency, importance) {
  if (urgency && importance) {
    return 'Do';
  }
  if (urgency && !importance) {
    return 'Delegate';
  }
  if (!urgency && importance) {
    return 'Delay';
  }
  return 'Discard';
}

function isoDate(offsetDays) {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + offsetDays);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function buildFallbackBrief(snapshot, targetDate = isoDate(0)) {
  const today = noteDate(targetDate);
  const windowStart = addDaysIso(today, -6);
  const inWindow = (value) => typeof value === 'string' && value >= windowStart && value <= today;
  const isOverdue = (value) => typeof value === 'string' && value !== '' && value < today;

  const healthyKpis = snapshot.kpis.filter((item) => item.health === 'healthy' || item.trend === 'up');
  const riskKpis = snapshot.kpis.filter((item) => item.health === 'risk' || item.trend === 'down');
  const strongObjectives = snapshot.objectives.filter((item) => item.health === 'healthy' && Number(item.progress) >= 70);
  const riskObjectives = snapshot.objectives.filter((item) => item.health === 'risk' || item.health === 'watch' || isOverdue(item.due));
  const openIssues = snapshot.issues.filter((item) => item.health !== 'healthy');
  const riskProjects = snapshot.projects.filter((item) => item.health === 'risk' || item.health === 'watch');
  const completedThisWeek = snapshot.matrixTasks.filter((item) => item.status === 'Completed' && inWindow(item.taskDate));
  const upcomingGaps = snapshot.rosterAssignments.filter((item) => item.rosterDate >= today && item.status === 'Gap');
  const agingFollowUps = snapshot.followUps.filter((item) => item.health !== 'healthy');
  const todaysNotes = snapshot.notes.filter((item) => item.noteDate === today);

  const wins = [];
  if (completedThisWeek.length) wins.push(`- ${completedThisWeek.length} planned task(s) completed over the past week.`);
  healthyKpis.slice(0, 3).forEach((item) => wins.push(`- ${item.name} on track (${item.actual} vs target ${item.target}).`));
  strongObjectives.slice(0, 2).forEach((item) => wins.push(`- Objective advancing: ${item.title} (${item.progress}%).`));
  if (!wins.length) wins.push('- No material wins to report this period.');

  const concerns = [];
  riskKpis.slice(0, 3).forEach((item) => concerns.push(`- ${item.name} off target (${item.actual} vs ${item.target}).`));
  riskObjectives.slice(0, 2).forEach((item) => concerns.push(`- Objective at risk: ${item.title}.`));
  openIssues.slice(0, 3).forEach((item) => concerns.push(`- Open issue: ${item.title}.`));
  riskProjects.slice(0, 2).forEach((item) => concerns.push(`- Project needs attention: ${item.name} (${item.phase}).`));
  if (upcomingGaps.length) concerns.push(`- ${upcomingGaps.length} upcoming roster coverage gap(s).`);
  if (agingFollowUps.length) concerns.push(`- ${agingFollowUps.length} follow-up(s) ageing without closure.`);
  if (!concerns.length) concerns.push('- No material concerns to report this period.');

  const decisions = [];
  todaysNotes.forEach((item) => decisions.push(`- From manager notes: ${item.text}`));
  if (!decisions.length) decisions.push('- No executive decisions required at this time.');

  const notesSummary = [];
  todaysNotes.forEach((item) => notesSummary.push(`- ${item.text}`));
  if (!notesSummary.length) notesSummary.push('- No manager notes were recorded for today.');

  const bottomLine = `As of ${today}, the SOC recorded ${completedThisWeek.length} completion(s) this week with ${openIssues.length} open issue(s) and ${upcomingGaps.length} upcoming coverage gap(s) on the roster.`;
  const forwardLook = `Priorities for the coming period are closing the ${openIssues.length} open issue(s) and securing coverage for the ${upcomingGaps.length} outstanding roster gap(s).`;

  return [
    '## Bottom Line',
    bottomLine,
    '',
    '## Notes of the Day',
    notesSummary.join('\n'),
    '',
    '## Wins & Progress',
    wins.join('\n'),
    '',
    '## Concerns & Risks',
    concerns.join('\n'),
    '',
    '## Decisions & Support Needed',
    decisions.join('\n'),
    '',
    '## Forward Look',
    forwardLook,
  ].join('\n');
}

async function generateAdvisorWithLlm(snapshot, env, targetDate = isoDate(0)) {
  const apiKey = env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('LLM provider is not configured. Set OPENAI_API_KEY.');
  }
  const model = env.OPENAI_MODEL || 'gpt-4o-mini';
  const baseUrl = (env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const llmUrl = `${baseUrl}/chat/completions`;
  const today = noteDate(targetDate);
  const windowStart = addDaysIso(today, -6);
  const inWindow = (value) => typeof value === 'string' && value >= windowStart && value <= today;

  const todaysNotes = snapshot.notes.filter((item) => item.noteDate === today);
  const recentNotes = snapshot.notes
    .filter((item) => inWindow(item.noteDate) && item.noteDate !== today)
    .sort((left, right) => (left.noteDate < right.noteDate ? 1 : -1));
  const completedThisWeek = snapshot.matrixTasks.filter((item) => item.status === 'Completed' && inWindow(item.taskDate));
  const upcomingGaps = snapshot.rosterAssignments.filter((item) => item.rosterDate >= today && item.status === 'Gap');

  const advisorContext = {
    date: today,
    lookbackWindow: { start: windowStart, end: today, note: 'Use this 7-day window to identify wins and emerging concerns; KPIs/objectives/issues/projects reflect current state.' },
    primarySignal: 'todaysManagerNotes',
    todaysNotesSummary: {
      note: 'Summarize the same-day manager notes in a dedicated section before wins and risks. Every substantive note from today must be represented; do not omit any. You may merge closely related notes into a single bullet, but no distinct point raised today may be dropped.',
      count: todaysNotes.length,
    },
    todaysManagerNotes: todaysNotes.map((item) => ({ noteDate: item.noteDate, text: item.text, pinned: item.pinned })),
    recentManagerNotes: recentNotes.map((item) => ({ noteDate: item.noteDate, text: item.text, pinned: item.pinned })),
    completedThisWeek: {
      note: 'Evidence of delivery over the past week. Use to support Wins, not to enumerate tasks.',
      count: completedThisWeek.length,
      titles: completedThisWeek.map((item) => item.title),
    },
    upcomingCoverageGaps: upcomingGaps.map((item) => ({ rosterDate: item.rosterDate, shiftName: item.shiftName, role: item.role })),
    kpis: snapshot.kpis.map((item) => ({ code: item.code, name: item.name, actual: item.actual, target: item.target, trend: item.trend, health: item.health })),
    objectives: snapshot.objectives.map((item) => ({ title: item.title, summary: item.summary, owner: item.owner, due: item.due, progress: item.progress, health: item.health })),
    issues: snapshot.issues.map((item) => ({ title: item.title, summary: item.summary, owner: item.owner, due: item.due, progress: item.progress, health: item.health })),
    projects: snapshot.projects.map((item) => ({ name: item.name, owner: item.owner, phase: item.phase, due: item.due, progress: item.progress, health: item.health })),
    followUps: snapshot.followUps.map((item) => ({ ref: item.ref, title: item.title, owner: item.owner, age: item.age, health: item.health })),
  };
  const response = await fetchWithContext(llmUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'system',
          content: [
            'You are a SOC chief of staff preparing a concise executive update that the SOC manager will forward, unedited, to executive management.',
            'The audience is C-level and senior leadership. They want outcomes, wins, risks, and decisions — not daily task-by-task detail.',
            'Write in the third person so the update can be forwarded verbatim. Refer to "the SOC" or "the team"; never address the reader as "you".',
            'Use British English. Be professional, direct, and factual. Every sentence must earn its place; no filler and no generic management-speak.',
            'Produce exactly these six sections, in this order, each as a level-two markdown heading: "## Bottom Line", "## Notes of the Day", "## Wins & Progress", "## Concerns & Risks", "## Decisions & Support Needed", "## Forward Look".',
            'Bottom Line: 2 to 3 sentences giving the overall posture plus the single most important item leadership should register.',
            'Notes of the Day: one concise single-sentence bullet for each substantive same-day manager note. Include every note recorded today; do not drop or skip any. You may merge two closely related notes into one bullet, but no distinct point may be lost. Preserve named operational, customer, vendor, scope, or governance points. If there were no notes today, state that plainly.',
            'Wins & Progress: 2 to 4 single-sentence bullets of concrete positive movement (KPIs on or above target or trending up, objectives and projects advancing, issues resolved or de-risked, delivery completed this week). If there are genuinely none, state "No material wins to report this period." Never invent a win.',
            'Concerns & Risks: 2 to 4 single-sentence bullets, highest impact first. Every material scope, contract, vendor, governance, staffing, or financial point raised in the manager notes must appear here or under Decisions & Support Needed.',
            'Decisions & Support Needed: explicit asks that require executive action, escalation, budget, or a decision. If none, state that plainly.',
            'Forward Look: 1 to 2 sentences on what is coming next and what leadership should watch.',
            'Keep the entire update to roughly 250 to 350 words, with one exception: never drop a same-day manager note to stay within the word budget. If today has many notes, let Notes of the Day run longer as needed while keeping every other section tight. Bullets must be single, scannable sentences.',
            'Do not create any other sections. Do not enumerate individual standup tasks or roster rows; use them only as evidence behind a stated win or concern.',
            'Each fact belongs to exactly one section. Do not restate the same point across multiple sections.',
            'The manager notes are the most authoritative signal for Notes of the Day, Concerns & Risks, and Decisions & Support Needed. Lead those sections with their substantive points, not with routine execution detail.',
            'Use Notes of the Day to summarize today\'s notes once; do not duplicate the same note wording in later sections unless it is necessary to frame a concrete risk or decision.',
            'Preserve names, vendor names, product names, and customer names exactly as written in the notes. Do not normalise, correct, or substitute spellings; if a term looks inconsistent, use the exact note wording.',
            'If a note says a service is outside SOC scope or contract, lacks process or governance, or needs a management decision, surface that explicitly under Concerns or Decisions.',
            'Only make time or capacity claims when the data states them explicitly. Do not invent progress, spare bandwidth, ownership, process maturity, or automation readiness.',
          ].join(' '),
        },
        {
          role: 'user',
          content: [
            'Build the executive SOC update from the snapshot below, using the exact six sections defined in your instructions.',
            'Sourcing guidance:',
            '- Notes of the Day: represent every note in todaysManagerNotes as a concise bullet before moving to wins and risks; do not omit any today note.',
            '- Wins & Progress: draw from KPIs on or above target or trending up, objectives and projects with strong progress or healthy status, issues resolved or de-risked, and completedThisWeek.',
            '- Concerns & Risks: draw from KPIs below target or trending down, at-risk or overdue objectives, issues, and projects, ageing follow-ups, upcomingCoverageGaps, and problems raised in the manager notes.',
            '- Decisions & Support Needed: draw from strategic, contractual, vendor, governance, staffing, or financial points in the manager notes that need an executive decision or escalation.',
            '- todaysManagerNotes are the primary strategic signal; recentManagerNotes give the week\'s context.',
            'Rules:',
            '- Do not let routine execution detail dilute or outweigh the headline wins and concerns.',
            '- Use Notes of the Day as the concise summary of same-day notes; do not repeat the same note content in later sections unless it directly drives a concrete risk or decision.',
            '- Keep each fact in a single section; do not repeat.',
            '- If wins or decisions are genuinely absent, say so rather than padding.',
            '- Preserve entity spellings from the notes exactly.',
            '- Stay within roughly 250 to 350 words, but do not sacrifice any same-day note to hit that target; Notes of the Day may expand to cover them all.',
            '',
            JSON.stringify(advisorContext, null, 2),
          ].join('\n'),
        },
      ],
      temperature: 0.25,
      max_tokens: 1400,
    }),
  }, 'LLM provider');

  if (!response.ok) {
    throw new Error(`LLM call failed with status ${response.status}`);
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content?.trim();
  if (!content) {
    const finishReason = data?.choices?.[0]?.finish_reason ?? 'unknown';
    throw new Error(`Unexpected LLM response structure (finish_reason: ${finishReason}).`);
  }

  return content;
}

function buildAssistantContext(snapshot) {
  const today = isoDate(0);
  const thirtyDaysAgo = isoDate(-30);
  const clip = (value, max = 600) => {
    const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
    return text.length > max ? `${text.slice(0, max)}\u2026` : text;
  };

  // Roster window: previous month through +2 months (covers current + near-future planning) to bound size.
  const base = new Date(`${today}T00:00:00`);
  const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const windowStart = fmt(new Date(base.getFullYear(), base.getMonth() - 1, 1));
  const windowEnd = fmt(new Date(base.getFullYear(), base.getMonth() + 3, 0));
  const rosterLabels = snapshot.settings?.rosterLabels ?? [];
  const rosterLegend = rosterLabels.map((l) => ({ code: l.code, label: l.label, hours: l.hours, status: l.status }));
  // A code is "worked" unless its legend status marks it as absent (Leave = DO/PL/EL, Gap = SCK).
  const NON_WORKING_STATUS = new Set(['Leave', 'Gap']);
  const workingByCode = new Map(rosterLabels.map((l) => [l.code, !NON_WORKING_STATUS.has(l.status)]));
  const WEEKEND_DOW = new Set([0, 6]); // 0 = Sun, 6 = Sat
  const isWeekendIso = (iso) => WEEKEND_DOW.has(new Date(`${iso}T00:00:00`).getDay());

  // Precomputed weekday/weekend counts per calendar month in the window so the model never infers days-of-week itself.
  const monthKeys = [];
  for (let cur = new Date(base.getFullYear(), base.getMonth() - 1, 1); cur <= new Date(windowEnd); cur.setMonth(cur.getMonth() + 1)) {
    monthKeys.push(`${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}`);
  }
  const calendar = monthKeys.map((mk) => {
    const [yy, mm] = mk.split('-').map(Number);
    const totalDays = new Date(yy, mm, 0).getDate();
    let weekdays = 0;
    for (let d = 1; d <= totalDays; d++) {
      if (!isWeekendIso(`${mk}-${String(d).padStart(2, '0')}`)) weekdays += 1;
    }
    return { month: mk, totalDays, weekdays, weekends: totalDays - weekdays };
  });

  const contactChannel = new Map(snapshot.contacts.map((c) => [c.name, c.channel]));
  const rosterByAnalyst = new Map();
  for (const item of snapshot.rosterAssignments) {
    if (item.rosterDate < windowStart || item.rosterDate > windowEnd) continue;
    if (!rosterByAnalyst.has(item.analyst)) rosterByAnalyst.set(item.analyst, {});
    rosterByAnalyst.get(item.analyst)[item.rosterDate] = item.shiftName;
  }
  const roster = [...rosterByAnalyst.entries()].map(([analyst, shiftsByDate]) => {
    const byMonth = new Map();
    for (const [iso, code] of Object.entries(shiftsByDate)) {
      const mk = iso.slice(0, 7);
      if (!byMonth.has(mk)) byMonth.set(mk, { month: mk, byCode: {}, worked: 0, workedWeekday: 0, workedWeekend: 0, offOrLeave: 0 });
      const s = byMonth.get(mk);
      s.byCode[code] = (s.byCode[code] || 0) + 1;
      if (workingByCode.get(code) ?? true) {
        s.worked += 1;
        if (isWeekendIso(iso)) s.workedWeekend += 1;
        else s.workedWeekday += 1;
      } else {
        s.offOrLeave += 1;
      }
    }
    const summary = [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month));
    return { analyst, team: contactChannel.get(analyst) || '', shiftsByDate, summary };
  });

  return {
    today,
    counts: {
      staff: new Set(snapshot.rosterAssignments.map((r) => r.analyst)).size,
      openIssues: (snapshot.issues || []).filter((i) => i.health !== 'healthy').length,
      objectives: snapshot.objectives.length,
      projects: snapshot.projects.length,
    },
    kpis: snapshot.kpis.map((k) => ({ code: k.code, name: k.name, actual: k.actual, target: k.target, trend: k.trend, health: k.health })),
    rosterLegend,
    rosterWindow: { start: windowStart, end: windowEnd, note: 'The full rotation planner for this date range, per analyst, keyed by date. Shift codes are defined in rosterLegend (e.g. DO = day off, PL = paid leave). Each analyst also has a precomputed `summary` (per-month worked/workedWeekday/workedWeekend/offOrLeave and byCode counts) — use it for counting instead of tallying dates yourself.' },
    calendar,
    roster,
    rosterToday: snapshot.rosterAssignments
      .filter((item) => item.rosterDate === today)
      .map((item) => ({ analyst: item.analyst, shift: item.shiftName, role: item.role, status: item.status, health: item.health })),
    issues: (snapshot.issues || []).map((i) => ({ id: i.id, scope: i.scope, title: i.title, summary: clip(i.summary), owner: i.owner, assignedTo: i.assignedTo, due: i.due, progress: i.progress, health: i.health })),
    objectives: snapshot.objectives.map((o) => ({ id: o.id, scope: o.scope, title: o.title, summary: clip(o.summary), owner: o.owner, assignedTo: o.assignedTo, due: o.due, progress: o.progress, health: o.health })),
    projects: snapshot.projects.map((p) => ({ code: p.code, name: p.name, owner: p.owner, phase: p.phase, due: p.due, progress: p.progress, health: p.health })),
    followUps: snapshot.followUps.map((f) => ({ ref: f.ref, title: f.title, owner: f.owner, age: f.age, health: f.health })),
    processes: (snapshot.processes || []).map((p) => ({ code: p.code, name: p.name, owner: p.owner, cadence: p.cadence, maturity: p.maturity, health: p.health })),
    recentStandupTasks: snapshot.matrixTasks
      .filter((t) => t.taskDate >= thirtyDaysAgo)
      .map((t) => ({ date: t.taskDate, title: t.title, lead: t.lead, assignee: t.assignee, quadrant: t.quadrant, urgent: Boolean(t.urgency), important: Boolean(t.importance), disposition: t.disposition, dueTime: t.dueTime, status: t.status, minutes: t.durationMinutes, notes: t.notes })),
    recentNotes: snapshot.notes
      .filter((n) => n.noteDate >= thirtyDaysAgo)
      .map((n) => ({ date: n.noteDate, createdAt: n.createdAt, pinned: n.pinned, text: n.text })),
    contacts: snapshot.contacts.map((c) => ({ name: c.name, role: c.role, channel: c.channel, scope: c.scope, isLead: c.isLead, email: c.email, phone: c.phone })),
  };
}

function tryAnswerStandupTaskQuestion(snapshot, history) {
  const latestQuestion = Array.isArray(history)
    ? [...history].reverse().find((item) => item && item.role === 'user' && typeof item.content === 'string')?.content.trim()
    : '';
  if (!latestQuestion) {
    return '';
  }

  const normalized = latestQuestion.toLowerCase();
  const mentionsStandup = /standup|eisenhower|matrix/.test(normalized);
  const asksForCounts = /how many|count|summary|summar|recorded|completed|incomplete|not completed/.test(normalized);
  if (!mentionsStandup || !asksForCounts) {
    return '';
  }

  const period = parseTaskSummaryPeriod(latestQuestion);
  const tasks = (snapshot.matrixTasks || []).filter((task) => {
    if (!period) {
      return true;
    }
    return task.taskDate >= period.start && task.taskDate <= period.end;
  });

  if (!tasks.length) {
    if (!period) {
      return 'No standup tasks are recorded in the cockpit data.';
    }
    return `No standup tasks are recorded for ${period.label}.`;
  }

  const completed = tasks.filter((task) => task.status === 'Completed').length;
  const incomplete = tasks.length - completed;
  const firstDate = tasks.reduce((min, task) => (task.taskDate < min ? task.taskDate : min), tasks[0].taskDate);
  const lastDate = tasks.reduce((max, task) => (task.taskDate > max ? task.taskDate : max), tasks[0].taskDate);
  const standupDays = new Set(tasks.map((task) => task.taskDate)).size;
  const rate = ((completed / tasks.length) * 100).toFixed(1);
  const periodLabel = period ? period.label : 'all recorded data';

  return [
    `### Standup Task Summary: ${periodLabel}`,
    '',
    '| Metric | Count |',
    '| --- | ---: |',
    `| Total tasks recorded | ${tasks.length} |`,
    `| Tasks marked Completed | ${completed} |`,
    `| Tasks not completed | ${incomplete} |`,
    `| Completion rate | ${rate}% |`,
    '',
    `Recorded across ${standupDays} standup day(s), from ${firstDate} to ${lastDate}.`,
  ].join('\n');
}

function parseTaskSummaryPeriod(question) {
  const normalized = question.toLowerCase();
  const monthNames = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
  const monthIndex = monthNames.findIndex((name) => normalized.includes(name));
  const yearMatch = normalized.match(/\b(20\d{2})\b/);

  if (monthIndex >= 0) {
    const year = Number(yearMatch?.[1] || isoDate(0).slice(0, 4));
    const month = monthIndex + 1;
    const start = `${year}-${String(month).padStart(2, '0')}-01`;
    const endDate = new Date(year, month, 0);
    const end = `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, '0')}-${String(endDate.getDate()).padStart(2, '0')}`;
    return {
      start,
      end,
      label: `${monthNames[monthIndex][0].toUpperCase()}${monthNames[monthIndex].slice(1)} ${year}`,
    };
  }

  if (/\bthis month\b/.test(normalized)) {
    const today = isoDate(0);
    const year = Number(today.slice(0, 4));
    const month = Number(today.slice(5, 7));
    const monthName = monthNames[month - 1];
    const start = `${today.slice(0, 7)}-01`;
    const endDate = new Date(year, month, 0);
    const end = `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, '0')}-${String(endDate.getDate()).padStart(2, '0')}`;
    return {
      start,
      end,
      label: `${monthName[0].toUpperCase()}${monthName.slice(1)} ${year}`,
    };
  }

  return null;
}

async function answerQuestionWithLlm(snapshot, history, env) {
  const apiKey = env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('LLM provider is not configured. Set OPENAI_API_KEY.');
  }
  const model = env.OPENAI_MODEL || 'gpt-4o-mini';
  const baseUrl = (env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const llmUrl = `${baseUrl}/chat/completions`;
  const context = buildAssistantContext(snapshot);

  const systemPrompt = [
    "You are the SOC Cockpit assistant, embedded in a SOC manager's command dashboard.",
    "Answer the question using ONLY the JSON data context below, which is the current live state of the cockpit (KPIs, the rotation planner/roster for a multi-month window, today's roster, issues, objectives, projects, follow-ups, processes, standup/Eisenhower tasks and daily notes from the last 30 days, and contacts).",
    'The roster is in `roster` (per analyst, `shiftsByDate` maps each date to a shift code) and covers `rosterWindow` (start to end). Shift codes are defined in `rosterLegend` (e.g. DO = day off, PL = paid leave, GEN/FS/SS/NS = shift types). Use these to analyse coverage, leave, gaps, and workload for any date or month within the window.',
    'For counting questions ("how many days did X work", leave taken, coverage), READ the precomputed numbers instead of tallying or classifying dates yourself: each analyst has a `summary` array (per month: `worked`, `workedWeekday`, `workedWeekend`, `offOrLeave`, and `byCode` counts), and `calendar` gives `weekdays`/`weekends`/`totalDays` for each month. Never infer which dates fall on weekends or how many weekdays a month has — take those figures from `calendar`.',
    'Definition of "worked": a day is worked if its shift code is a working code (any legend code whose `status` is NOT "Leave" or "Gap"). WFH, GEN, FS, SS and NS count as worked; DO (day off), PL (paid leave), SCK (sick) and EL (emergency leave) do NOT. This is already applied in each analyst summary\'s `worked` count, so do not re-classify codes yourself.',
    'Use British English. Be concise, factual, and direct. Prefer short answers, bullet points, or small markdown tables. No filler.',
    'If the answer is not present in the data, say you do not have that information rather than guessing. Never invent numbers, names, dates, or statuses. Preserve names and spellings exactly.',
    '',
    'DATA CONTEXT (JSON):',
    JSON.stringify(context),
  ].join('\n');

  const conversation = (Array.isArray(history) ? history : [])
    .filter((item) => item && typeof item.content === 'string' && (item.role === 'user' || item.role === 'assistant'))
    .slice(-12)
    .map((item) => ({ role: item.role, content: item.content.slice(0, 2000) }));

  if (conversation.length === 0) {
    throw new Error('No question provided.');
  }

  const response = await fetchWithContext(llmUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'system', content: systemPrompt }, ...conversation],
      temperature: 0.2,
      max_tokens: 900,
    }),
  }, 'LLM provider');

  if (!response.ok) {
    throw new Error(`LLM call failed with status ${response.status}`);
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content?.trim();
  if (!content) {
    const finishReason = data?.choices?.[0]?.finish_reason ?? 'unknown';
    throw new Error(`Unexpected LLM response structure (finish_reason: ${finishReason}).`);
  }
  return content;
}

async function fetchWithContext(url, init, label) {
  try {
    return await fetch(url, init);
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error(`Could not reach ${label}. Check network connectivity and try again.`);
    }
    throw error;
  }
}

module.exports = {
  createStore,
};