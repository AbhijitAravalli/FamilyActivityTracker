const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const url = require('url');

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const PUBLIC_DIR = path.join(__dirname, 'public');
const ACTIVITIES_FILE = path.join(DATA_DIR, 'activities.json');
const MEMBERS_FILE = path.join(DATA_DIR, 'members.json');
const CATEGORIES_FILE = path.join(DATA_DIR, 'categories.json');
const TIMERS_FILE = path.join(DATA_DIR, 'timers.json');
const VOICE_INTERACTIONS_FILE = path.join(DATA_DIR, 'voiceInteractions.json');
const { parseVoiceTranscript } = require('./lib/voiceParser');
const { isoToAdtDateStr, nowAdtDateStr } = require('./lib/timezone');

function readJson(file, fallback) {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let chunks = '';
    req.on('data', (chunk) => {
      chunks += chunk;
      if (chunks.length > 1e6) {
        req.destroy();
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      if (!chunks) return resolve({});
      try {
        resolve(JSON.parse(chunks));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function minutesBetween(startIso, endIso) {
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  return Math.max(0, Math.round((end - start) / 60000));
}

function validateActivityInput(input) {
  const errors = [];
  if (!input.memberId || typeof input.memberId !== 'string') errors.push('memberId is required');
  if (!input.name || typeof input.name !== 'string' || !input.name.trim()) errors.push('name is required');
  if (!input.category || typeof input.category !== 'string') errors.push('category is required');
  if (!input.date || typeof input.date !== 'string') errors.push('date is required');
  if (!input.startAt || typeof input.startAt !== 'string') errors.push('startAt is required');
  if (!input.endAt || typeof input.endAt !== 'string') errors.push('endAt is required');
  if (input.startAt && input.endAt && new Date(input.endAt) < new Date(input.startAt)) {
    errors.push('endAt must not be before startAt');
  }
  return errors;
}

const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
};

function serveStatic(req, res) {
  const parsed = url.parse(req.url);
  let filePath = parsed.pathname === '/' ? '/index.html' : parsed.pathname;
  const fullPath = path.normalize(path.join(PUBLIC_DIR, filePath));

  if (!fullPath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }

  fs.readFile(fullPath, (err, content) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Not found');
    }
    const ext = path.extname(fullPath);
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
    res.end(content);
  });
}

async function handleApi(req, res, pathname) {
  // GET /api/members
  if (pathname === '/api/members' && req.method === 'GET') {
    return sendJson(res, 200, readJson(MEMBERS_FILE, []));
  }

  // POST /api/members  { name }
  if (pathname === '/api/members' && req.method === 'POST') {
    const body = await readBody(req);
    if (!body.name || !body.name.trim()) {
      return sendJson(res, 400, { error: 'name is required' });
    }
    const members = readJson(MEMBERS_FILE, []);
    const member = { id: crypto.randomUUID(), name: body.name.trim() };
    members.push(member);
    writeJson(MEMBERS_FILE, members);
    return sendJson(res, 201, member);
  }

  // GET /api/categories
  if (pathname === '/api/categories' && req.method === 'GET') {
    return sendJson(res, 200, readJson(CATEGORIES_FILE, []));
  }

  // POST /api/categories  { name }
  if (pathname === '/api/categories' && req.method === 'POST') {
    const body = await readBody(req);
    const name = body.name ? String(body.name).trim() : '';
    if (!name) return sendJson(res, 400, { error: 'name is required' });

    const categories = readJson(CATEGORIES_FILE, []);
    if (categories.some((c) => c.toLowerCase() === name.toLowerCase())) {
      return sendJson(res, 409, { error: 'Category already exists' });
    }
    categories.push(name);
    writeJson(CATEGORIES_FILE, categories);
    return sendJson(res, 201, categories);
  }

  // POST /api/voice/parse  { transcript, date? }
  if (pathname === '/api/voice/parse' && req.method === 'POST') {
    const body = await readBody(req);
    const transcript = body.transcript ? String(body.transcript).trim() : '';
    if (!transcript) return sendJson(res, 400, { error: 'transcript is required' });

    const nowIso = new Date().toISOString();
    const date = body.date || nowAdtDateStr();
    const result = parseVoiceTranscript(transcript, { date, nowIso });

    const interactions = readJson(VOICE_INTERACTIONS_FILE, []);
    const interaction = {
      id: crypto.randomUUID(),
      transcript,
      extracted: result,
      status: 'PARSED',
      createdAt: nowIso,
    };
    interactions.push(interaction);
    writeJson(VOICE_INTERACTIONS_FILE, interactions);

    return sendJson(res, 200, { ...result, interactionId: interaction.id });
  }

  // GET /api/activities?date=YYYY-MM-DD
  if (pathname === '/api/activities' && req.method === 'GET') {
    const parsed = url.parse(req.url, true);
    const date = parsed.query.date;
    let activities = readJson(ACTIVITIES_FILE, []);
    if (date) {
      activities = activities.filter((a) => a.date === date);
    }
    activities.sort((a, b) => new Date(a.startAt) - new Date(b.startAt));
    return sendJson(res, 200, activities);
  }

  // POST /api/activities
  if (pathname === '/api/activities' && req.method === 'POST') {
    const body = await readBody(req);
    const errors = validateActivityInput(body);
    if (errors.length) {
      return sendJson(res, 400, { error: errors.join(', ') });
    }
    const activities = readJson(ACTIVITIES_FILE, []);
    const now = new Date().toISOString();
    const activity = {
      id: crypto.randomUUID(),
      memberId: body.memberId,
      name: body.name.trim(),
      category: body.category,
      date: body.date,
      startAt: body.startAt,
      endAt: body.endAt,
      durationMinutes: minutesBetween(body.startAt, body.endAt),
      notes: body.notes ? String(body.notes).trim() : '',
      inputMethod: body.inputMethod || 'MANUAL',
      createdAt: now,
      updatedAt: now,
    };
    activities.push(activity);
    writeJson(ACTIVITIES_FILE, activities);
    return sendJson(res, 201, activity);
  }

  // PUT /api/activities/:id
  const putMatch = pathname.match(/^\/api\/activities\/([^/]+)$/);
  if (putMatch && req.method === 'PUT') {
    const id = putMatch[1];
    const body = await readBody(req);
    const activities = readJson(ACTIVITIES_FILE, []);
    const idx = activities.findIndex((a) => a.id === id);
    if (idx === -1) return sendJson(res, 404, { error: 'Activity not found' });

    const merged = { ...activities[idx], ...body };
    const errors = validateActivityInput(merged);
    if (errors.length) return sendJson(res, 400, { error: errors.join(', ') });

    merged.durationMinutes = minutesBetween(merged.startAt, merged.endAt);
    merged.updatedAt = new Date().toISOString();
    activities[idx] = merged;
    writeJson(ACTIVITIES_FILE, activities);
    return sendJson(res, 200, merged);
  }

  // DELETE /api/activities/:id
  const deleteMatch = pathname.match(/^\/api\/activities\/([^/]+)$/);
  if (deleteMatch && req.method === 'DELETE') {
    const id = deleteMatch[1];
    const activities = readJson(ACTIVITIES_FILE, []);
    const idx = activities.findIndex((a) => a.id === id);
    if (idx === -1) return sendJson(res, 404, { error: 'Activity not found' });
    const [removed] = activities.splice(idx, 1);
    writeJson(ACTIVITIES_FILE, activities);
    return sendJson(res, 200, removed);
  }

  // GET /api/timers - list currently running timers
  if (pathname === '/api/timers' && req.method === 'GET') {
    return sendJson(res, 200, readJson(TIMERS_FILE, []));
  }

  // POST /api/timers/start  { memberId, name, category, notes? }
  if (pathname === '/api/timers/start' && req.method === 'POST') {
    const body = await readBody(req);
    const errors = [];
    if (!body.memberId) errors.push('memberId is required');
    if (!body.name || !body.name.trim()) errors.push('name is required');
    if (!body.category) errors.push('category is required');
    if (errors.length) return sendJson(res, 400, { error: errors.join(', ') });

    const timers = readJson(TIMERS_FILE, []);
    const timer = {
      id: crypto.randomUUID(),
      memberId: body.memberId,
      name: body.name.trim(),
      category: body.category,
      notes: body.notes ? String(body.notes).trim() : '',
      startAt: new Date().toISOString(),
    };
    timers.push(timer);
    writeJson(TIMERS_FILE, timers);
    return sendJson(res, 201, timer);
  }

  // POST /api/timers/:id/stop - stop timer and save it as a completed activity
  const stopMatch = pathname.match(/^\/api\/timers\/([^/]+)\/stop$/);
  if (stopMatch && req.method === 'POST') {
    const id = stopMatch[1];
    const timers = readJson(TIMERS_FILE, []);
    const idx = timers.findIndex((t) => t.id === id);
    if (idx === -1) return sendJson(res, 404, { error: 'Timer not found' });
    const [timer] = timers.splice(idx, 1);
    writeJson(TIMERS_FILE, timers);

    const endAt = new Date().toISOString();
    const activities = readJson(ACTIVITIES_FILE, []);
    const now = new Date().toISOString();
    const activity = {
      id: crypto.randomUUID(),
      memberId: timer.memberId,
      name: timer.name,
      category: timer.category,
      date: isoToAdtDateStr(timer.startAt),
      startAt: timer.startAt,
      endAt,
      durationMinutes: minutesBetween(timer.startAt, endAt),
      notes: timer.notes,
      inputMethod: 'TIMER',
      createdAt: now,
      updatedAt: now,
    };
    activities.push(activity);
    writeJson(ACTIVITIES_FILE, activities);
    return sendJson(res, 201, activity);
  }

  // DELETE /api/timers/:id - cancel a running timer without saving it
  const cancelMatch = pathname.match(/^\/api\/timers\/([^/]+)$/);
  if (cancelMatch && req.method === 'DELETE') {
    const id = cancelMatch[1];
    const timers = readJson(TIMERS_FILE, []);
    const idx = timers.findIndex((t) => t.id === id);
    if (idx === -1) return sendJson(res, 404, { error: 'Timer not found' });
    const [removed] = timers.splice(idx, 1);
    writeJson(TIMERS_FILE, timers);
    return sendJson(res, 200, removed);
  }

  // GET /api/reports?from=YYYY-MM-DD&to=YYYY-MM-DD
  if (pathname === '/api/reports' && req.method === 'GET') {
    const parsed = url.parse(req.url, true);
    const from = parsed.query.from;
    const to = parsed.query.to;
    if (!from || !to) return sendJson(res, 400, { error: 'from and to are required (YYYY-MM-DD)' });

    const activities = readJson(ACTIVITIES_FILE, []).filter((a) => a.date >= from && a.date <= to);
    const members = readJson(MEMBERS_FILE, []);

    const memberMinutes = {};
    const categoryMinutes = {};
    const dailyMinutes = {};
    let totalMinutes = 0;

    activities.forEach((a) => {
      memberMinutes[a.memberId] = (memberMinutes[a.memberId] || 0) + a.durationMinutes;
      categoryMinutes[a.category] = (categoryMinutes[a.category] || 0) + a.durationMinutes;
      dailyMinutes[a.date] = (dailyMinutes[a.date] || 0) + a.durationMinutes;
      totalMinutes += a.durationMinutes;
    });

    const memberTotals = members.map((m) => ({
      memberId: m.id,
      memberName: m.name,
      minutes: memberMinutes[m.id] || 0,
    }));

    const categoryTotals = Object.keys(categoryMinutes)
      .map((category) => ({ category, minutes: categoryMinutes[category] }))
      .sort((a, b) => b.minutes - a.minutes);

    const dailyTotals = [];
    for (let d = new Date(`${from}T00:00:00Z`); d <= new Date(`${to}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
      const dateStr = d.toISOString().slice(0, 10);
      dailyTotals.push({ date: dateStr, minutes: dailyMinutes[dateStr] || 0 });
    }

    return sendJson(res, 200, {
      from,
      to,
      totalMinutes,
      activityCount: activities.length,
      avgDurationMinutes: activities.length ? Math.round(totalMinutes / activities.length) : 0,
      memberTotals,
      categoryTotals,
      dailyTotals,
    });
  }

  return sendJson(res, 404, { error: 'Not found' });
}

// All /api/* requests are processed one at a time (even across multiple
// browser sessions hitting this same server) so a read-modify-write on a
// JSON file can never be interleaved with another request's write.
let apiQueue = Promise.resolve();
function serialize(fn) {
  const run = apiQueue.then(fn, fn);
  apiQueue = run.then(() => {}, () => {});
  return run;
}

const server = http.createServer((req, res) => {
  const parsed = url.parse(req.url);
  const pathname = parsed.pathname;

  if (pathname.startsWith('/api/')) {
    serialize(() => handleApi(req, res, pathname)).catch((err) => {
      sendJson(res, 500, { error: 'Internal server error', detail: err.message });
    });
    return;
  }

  serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log(`Family Tracker running at http://localhost:${PORT}`);
});
