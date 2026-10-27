// SPDX-FileCopyrightText: 2026 Cisco Systems, Inc.
// SPDX-License-Identifier: Apache-2.0

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const dotenv = require('dotenv');
const helmet = require('helmet');
const multer = require('multer');
const { createStore } = require('./db.cjs');
const { createAuth } = require('./auth.cjs');
const { buildStandupTemplate, parseStandupWorkbook } = require('./standup-xlsx.cjs');

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const app = express();
const port = Number(process.env.PORT || 3001);
const isProduction = process.env.NODE_ENV === 'production';
const uploadsPath = path.join(__dirname, '..', 'uploads');
const processUploadsPath = path.join(uploadsPath, 'process-docs');
const objectiveUploadsPath = path.join(uploadsPath, 'objective-docs');
const dbPath = path.join(__dirname, '..', 'data', 'soc-cockpit.sqlite');
const MAX_DOCUMENT_UPLOAD_BYTES = 20 * 1024 * 1024;
const ALLOWED_DOCUMENT_EXTENSIONS = new Set([
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.csv', '.txt', '.md', '.rtf', '.png', '.jpg', '.jpeg', '.gif', '.webp',
]);
// Text formats have no reliable magic number, so signature validation is skipped for them.
const TEXT_DOCUMENT_EXTENSIONS = new Set(['.txt', '.md', '.csv']);
const ZIP_DOCUMENT_EXTENSIONS = new Set(['.docx', '.xlsx', '.pptx']);
const OLE_DOCUMENT_EXTENSIONS = new Set(['.doc', '.xls', '.ppt']);
const ZIP_SIGNATURE = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const ZIP_EMPTY_SIGNATURE = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
const OLE_SIGNATURE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const DOCUMENT_SIGNATURE_CHECKS = {
  '.pdf': (header) => header.slice(0, 4).toString('latin1') === '%PDF',
  '.rtf': (header) => header.slice(0, 5).toString('latin1') === '{\\rtf',
  '.png': (header) => header.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  '.gif': (header) => header.slice(0, 4).toString('latin1') === 'GIF8',
  '.jpg': (header) => header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff,
  '.jpeg': (header) => header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff,
  '.webp': (header) => header.slice(0, 4).toString('latin1') === 'RIFF' && header.slice(8, 12).toString('latin1') === 'WEBP',
};
const store = createStore({
  dbPath,
  env: process.env,
});
const auth = createAuth({ dbPath, env: process.env, isProduction });
// Viewers may ask the assistant questions even though it is a POST.
const VIEWER_ALLOWED_WRITES = new Set(['/assistant/chat']);

fs.mkdirSync(processUploadsPath, { recursive: true });
fs.mkdirSync(objectiveUploadsPath, { recursive: true });

class HttpError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

function validateDocumentUpload(_req, file, callback) {
  const extension = path.extname(file.originalname || '').toLowerCase();
  if (!ALLOWED_DOCUMENT_EXTENSIONS.has(extension)) {
    callback(new HttpError(400, `Unsupported document type: ${extension || 'unknown'}`));
    return;
  }
  callback(null, true);
}

// Verify the file's magic number matches its extension so a renamed file cannot slip past the allowlist.
function validateFileSignature(filePath, extension) {
  if (TEXT_DOCUMENT_EXTENSIONS.has(extension)) {
    return;
  }
  const header = Buffer.alloc(12);
  const fileDescriptor = fs.openSync(filePath, 'r');
  try {
    fs.readSync(fileDescriptor, header, 0, 12, 0);
  } finally {
    fs.closeSync(fileDescriptor);
  }
  let valid;
  if (DOCUMENT_SIGNATURE_CHECKS[extension]) {
    valid = DOCUMENT_SIGNATURE_CHECKS[extension](header);
  } else if (ZIP_DOCUMENT_EXTENSIONS.has(extension)) {
    valid = header.slice(0, 4).equals(ZIP_SIGNATURE) || header.slice(0, 4).equals(ZIP_EMPTY_SIGNATURE);
  } else if (OLE_DOCUMENT_EXTENSIONS.has(extension)) {
    valid = header.slice(0, 8).equals(OLE_SIGNATURE);
  } else {
    valid = true;
  }
  if (!valid) {
    throw new HttpError(400, `File content does not match its ${extension} extension.`);
  }
}

function logUploadActivity(kind, req) {
  console.log(
    `[upload] ${new Date().toISOString()} kind=${kind} id=${req.params.id} `
    + `name=${JSON.stringify(req.file.originalname)} stored=${req.file.filename} `
    + `size=${req.file.size} ip=${req.ip || 'unknown'}`,
  );
}

function createUpload(destination) {
  return multer({
    storage: multer.diskStorage({
      destination: (_req, _file, callback) => callback(null, destination),
      filename: (_req, file, callback) => {
        const extension = path.extname(file.originalname || '').toLowerCase();
        callback(null, `${Date.now()}-${crypto.randomUUID()}${extension}`);
      },
    }),
    limits: { fileSize: MAX_DOCUMENT_UPLOAD_BYTES, files: 1 },
    fileFilter: validateDocumentUpload,
  });
}

const processUpload = createUpload(processUploadsPath);
const objectiveUpload = createUpload(objectiveUploadsPath);
const workbookUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
}));
app.use(express.json());
app.use('/api', auth.requireCsrfHeader);

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'soc-cockpit-api' });
});

app.use('/api/auth', auth.router);
app.use('/api', auth.requireAuth);
app.use('/api/admin', auth.requireRole('Admin'), auth.adminRouter);
app.use('/api', (req, res, next) => {
  if (['GET', 'HEAD'].includes(req.method) || VIEWER_ALLOWED_WRITES.has(req.path)) {
    next();
    return;
  }
  auth.requireRole('Operator', 'Admin')(req, res, next);
});
app.use('/uploads', auth.requireAuth, express.static(uploadsPath, {
  index: false,
  dotfiles: 'deny',
  setHeaders: (res, filePath) => {
    const fileName = path.basename(filePath).replace(/\"/g, '');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  },
}));

app.get('/api/snapshot', (_req, res) => {
  res.json(store.getSnapshot());
});

app.post('/api/settings/clocks', auth.requireRole('Admin'), (req, res) => {
  res.json(store.updateClockZones(req.body.zones));
});

app.post('/api/settings/roster-planner', (req, res, next) => {
  try {
    res.json(store.updateRosterPlannerSettings(req.body));
  } catch (error) {
    next(error);
  }
});

app.post('/api/roster/planner', (req, res, next) => {
  try {
    res.json(store.upsertRosterPlan(req.body.changes));
  } catch (error) {
    next(error);
  }
});

app.patch('/api/roster/staff/:name', (req, res, next) => {
  try {
    res.json(store.renameRosterStaff(req.params.name, req.body.nextName));
  } catch (error) {
    next(error);
  }
});

app.patch('/api/roster/label/:code', (req, res, next) => {
  try {
    res.json(store.updateRosterLabelDefinition(req.params.code, req.body));
  } catch (error) {
    next(error);
  }
});

app.post('/api/advisor/generate', async (req, res, next) => {
  try {
    res.json(await store.generateAdvisorBrief(req.body?.date));
  } catch (error) {
    next(error);
  }
});

app.post('/api/assistant/chat', async (req, res, next) => {
  try {
    res.json(await store.answerQuestion(req.body.messages));
  } catch (error) {
    next(error);
  }
});

app.post('/api/objective/:id/document', objectiveUpload.single('document'), (req, res, next) => {
  try {
    if (!req.file) {
      throw new Error('No document uploaded.');
    }

    validateFileSignature(req.file.path, path.extname(req.file.filename).toLowerCase());
    const result = store.attachObjectiveDocument(req.params.id, {
      name: req.file.originalname,
      path: `/uploads/objective-docs/${req.file.filename}`,
    });
    logUploadActivity('objective', req);
    res.json(result);
  } catch (error) {
    if (req.file?.path && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    next(error);
  }
});

app.post('/api/process/:id/document', processUpload.single('document'), (req, res, next) => {
  try {
    if (!req.file) {
      throw new Error('No document uploaded.');
    }

    validateFileSignature(req.file.path, path.extname(req.file.filename).toLowerCase());
    const result = store.attachProcessDocument(req.params.id, {
      name: req.file.originalname,
      path: `/uploads/process-docs/${req.file.filename}`,
    });
    logUploadActivity('process', req);
    res.json(result);
  } catch (error) {
    if (req.file?.path && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    next(error);
  }
});

app.post('/api/:kind', (req, res, next) => {
  try {
    res.json(store.createRecord(req.params.kind, req.body));
  } catch (error) {
    next(error);
  }
});

app.patch('/api/matrixTask/:id', (req, res, next) => {
  try {
    res.json(store.updateMatrixTask(req.params.id, req.body));
  } catch (error) {
    next(error);
  }
});

app.post('/api/matrix/carry-over', (req, res, next) => {
  try {
    res.json(store.carryOverMatrixTasks(req.body?.toDate, req.body?.fromDate));
  } catch (error) {
    next(error);
  }
});

app.get('/api/standup/template', async (_req, res, next) => {
  try {
    const buffer = await buildStandupTemplate();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="soc-standup-template.xlsx"');
    res.send(buffer);
  } catch (error) {
    next(error);
  }
});

app.post('/api/standup/import', workbookUpload.single('workbook'), async (req, res, next) => {
  try {
    if (!req.file) {
      throw new Error('No workbook uploaded.');
    }
    const { rows, errors } = await parseStandupWorkbook(req.file.buffer);
    const result = store.importStandupTasks(rows);
    res.json({
      snapshot: result.snapshot,
      added: result.added,
      updated: result.updated,
      skipped: result.skipped,
      objectivesCreated: result.objectivesCreated,
      tasksLinked: result.tasksLinked,
      createdObjectives: result.createdObjectives,
      ambiguousObjectives: result.ambiguousObjectives,
      errors,
    });
  } catch (error) {
    next(error);
  }
});

app.patch('/api/:kind/:id', (req, res, next) => {
  try {
    res.json(store.updateRecord(req.params.kind, req.params.id, req.body));
  } catch (error) {
    next(error);
  }
});

app.delete('/api/:kind/:id', (req, res, next) => {
  try {
    res.json(store.deleteRecord(req.params.kind, req.params.id));
  } catch (error) {
    next(error);
  }
});

if (isProduction) {
  const distPath = path.join(__dirname, '..', 'dist');
  app.use(express.static(distPath));
  // Express 5 (path-to-regexp v8) requires a named wildcard; bare '*' throws at startup.
  app.get('/{*splat}', (_req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

app.use((error, _req, res, _next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      res.status(400).json({ error: `File too large. Max size is ${MAX_DOCUMENT_UPLOAD_BYTES / (1024 * 1024)}MB.` });
      return;
    }
    res.status(400).json({ error: error.message });
    return;
  }

  const statusCode = Number(error?.statusCode) || 500;
  if (statusCode >= 500) {
    console.error(error);
  }

  const errorMessage = statusCode >= 500
    ? 'Unexpected server error'
    : (error instanceof Error ? error.message : 'Request failed');

  res.status(statusCode).json({ error: errorMessage });
});

app.listen(port, () => {
  console.log(`SOC Cockpit API listening on http://127.0.0.1:${port}`);
});