const state = {
  members: [],
  categories: [],
  activities: [],
  timers: [],
  viewDate: todayStr(),
};

let timerTickHandle = null;

function todayStr() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

function formatMinutes(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}

function formatTime(iso) {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function formatHMS(totalSeconds) {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

async function api(path, options) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function memberName(id) {
  const m = state.members.find((x) => x.id === id);
  return m ? m.name : id;
}

function populateSelect(select, items, { valueKey, labelKey } = {}) {
  select.innerHTML = '';
  items.forEach((item) => {
    const opt = document.createElement('option');
    if (valueKey) {
      opt.value = item[valueKey];
      opt.textContent = item[labelKey];
    } else {
      opt.value = item;
      opt.textContent = item;
    }
    select.appendChild(opt);
  });
}

function dateTimeToIso(dateStr, timeStr) {
  return new Date(`${dateStr}T${timeStr}:00`).toISOString();
}

function isoToDateInput(iso) {
  return iso.slice(0, 10);
}

function isoToTimeInput(iso) {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/* ---------------- Tabs ---------------- */

function setupTabs() {
  const buttons = document.querySelectorAll('.tab-btn');
  buttons.forEach((btn) => {
    btn.addEventListener('click', () => {
      buttons.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('.tab-panel').forEach((p) => p.classList.add('hidden'));
      document.getElementById(`tab-${btn.dataset.tab}`).classList.remove('hidden');
      if (btn.dataset.tab === 'reports') loadReport();
      if (btn.dataset.tab === 'settings') renderSettings();
    });
  });
}

/* ---------------- Members / Categories ---------------- */

async function loadMembersAndCategories() {
  const [members, categories] = await Promise.all([
    api('/api/members'),
    api('/api/categories'),
  ]);
  state.members = members;
  state.categories = categories;
  populateSelect(document.getElementById('f-member'), members, { valueKey: 'id', labelKey: 'name' });
  populateSelect(document.getElementById('f-category'), categories);
  populateSelect(document.getElementById('t-member'), members, { valueKey: 'id', labelKey: 'name' });
  populateSelect(document.getElementById('t-category'), categories);
  populateSelect(document.getElementById('v-member'), members, { valueKey: 'id', labelKey: 'name' });
}

function setupCategoryForm() {
  const form = document.getElementById('category-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errorEl = document.getElementById('category-error');
    errorEl.textContent = '';
    const input = document.getElementById('c-name');
    const name = input.value.trim();
    if (!name) return;
    try {
      await api('/api/categories', { method: 'POST', body: JSON.stringify({ name }) });
      input.value = '';
      await loadMembersAndCategories();
      renderSettings();
    } catch (err) {
      errorEl.textContent = err.message;
    }
  });
}

function renderSettings() {
  const memberList = document.getElementById('settings-member-list');
  memberList.innerHTML = state.members.map((m) => `<li>${escapeHtml(m.name)}</li>`).join('');
  const categoryList = document.getElementById('settings-category-list');
  categoryList.innerHTML = state.categories.map((c) => `<li>${escapeHtml(c)}</li>`).join('');
}

function setupMemberForm() {
  const form = document.getElementById('member-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = document.getElementById('m-name');
    const name = input.value.trim();
    if (!name) return;
    await api('/api/members', { method: 'POST', body: JSON.stringify({ name }) });
    input.value = '';
    await loadMembersAndCategories();
    renderSettings();
  });
}

/* ---------------- Activities (Today) ---------------- */

async function loadActivities() {
  state.activities = await api(`/api/activities?date=${state.viewDate}`);
  renderActivities();
  renderTotals();
}

function renderActivities() {
  const list = document.getElementById('activity-list');
  list.innerHTML = '';
  if (!state.activities.length) {
    list.innerHTML = '<p class="empty-state">No activities recorded for this day yet.</p>';
    return;
  }
  state.activities.forEach((a) => {
    const item = document.createElement('div');
    item.className = 'activity-item';
    item.innerHTML = `
      <div class="meta">
        <span class="name">${escapeHtml(a.name)}</span>
        <span class="sub">${escapeHtml(memberName(a.memberId))} · ${escapeHtml(a.category)} · ${formatTime(a.startAt)}&ndash;${formatTime(a.endAt)}</span>
      </div>
      <div class="duration">${formatMinutes(a.durationMinutes)}</div>
      <div class="actions">
        <button data-action="edit" data-id="${a.id}" title="Edit">✎</button>
        <button data-action="delete" data-id="${a.id}" title="Delete">✕</button>
      </div>
    `;
    list.appendChild(item);
  });
}

function renderTotals() {
  const totals = {};
  let familyTotal = 0;
  state.activities.forEach((a) => {
    totals[a.memberId] = (totals[a.memberId] || 0) + a.durationMinutes;
    familyTotal += a.durationMinutes;
  });

  const container = document.getElementById('member-totals');
  container.innerHTML = '';
  state.members.forEach((m) => {
    const mins = totals[m.id] || 0;
    const row = document.createElement('div');
    row.className = 'member-total-row';
    row.innerHTML = `<span>${escapeHtml(m.name)}</span><span>${formatMinutes(mins)}</span>`;
    container.appendChild(row);
  });

  document.getElementById('family-total').textContent = formatMinutes(familyTotal);
}

function startEditing(activity) {
  document.getElementById('activity-form-title').textContent = 'Edit Activity';
  document.getElementById('f-editing-id').value = activity.id;
  document.getElementById('f-name').value = activity.name;
  document.getElementById('f-member').value = activity.memberId;
  document.getElementById('f-category').value = activity.category;
  document.getElementById('f-date').value = activity.date;
  document.getElementById('f-start').value = isoToTimeInput(activity.startAt);
  document.getElementById('f-end').value = isoToTimeInput(activity.endAt);
  document.getElementById('f-notes').value = activity.notes || '';
  document.getElementById('f-submit-btn').textContent = 'Update Activity';
  document.getElementById('f-cancel-btn').classList.remove('hidden');
  document.getElementById('activity-form').scrollIntoView({ behavior: 'smooth' });
}

function stopEditing() {
  document.getElementById('activity-form-title').textContent = '+ Add Activity';
  document.getElementById('f-editing-id').value = '';
  document.getElementById('f-submit-btn').textContent = 'Save Activity';
  document.getElementById('f-cancel-btn').classList.add('hidden');
  document.getElementById('activity-form').reset();
  document.getElementById('f-date').value = state.viewDate;
}

function setupForm() {
  const form = document.getElementById('activity-form');
  const dateInput = document.getElementById('f-date');
  dateInput.value = state.viewDate;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errorEl = document.getElementById('form-error');
    errorEl.textContent = '';

    const editingId = document.getElementById('f-editing-id').value;
    const name = document.getElementById('f-name').value.trim();
    const memberId = document.getElementById('f-member').value;
    const category = document.getElementById('f-category').value;
    const date = document.getElementById('f-date').value;
    const startTime = document.getElementById('f-start').value;
    const endTime = document.getElementById('f-end').value;
    const notes = document.getElementById('f-notes').value.trim();

    if (!name || !memberId || !category || !date || !startTime || !endTime) {
      errorEl.textContent = 'Please fill in all required fields.';
      return;
    }

    const startAt = dateTimeToIso(date, startTime);
    const endAt = dateTimeToIso(date, endTime);

    if (new Date(endAt) < new Date(startAt)) {
      errorEl.textContent = 'End time must be after start time.';
      return;
    }

    const payload = {
      name, memberId, category, date, startAt, endAt, notes,
    };

    try {
      if (editingId) {
        await api(`/api/activities/${editingId}`, { method: 'PUT', body: JSON.stringify(payload) });
      } else {
        await api('/api/activities', { method: 'POST', body: JSON.stringify({ ...payload, inputMethod: 'MANUAL' }) });
      }
      stopEditing();
      await loadActivities();
    } catch (err) {
      errorEl.textContent = err.message;
    }
  });

  document.getElementById('f-cancel-btn').addEventListener('click', stopEditing);

  document.getElementById('activity-list').addEventListener('click', async (e) => {
    const editBtn = e.target.closest('button[data-action="edit"]');
    if (editBtn) {
      const activity = state.activities.find((a) => a.id === editBtn.dataset.id);
      if (activity) startEditing(activity);
      return;
    }
    const delBtn = e.target.closest('button[data-action="delete"]');
    if (delBtn) {
      if (!confirm('Delete this activity?')) return;
      await api(`/api/activities/${delBtn.dataset.id}`, { method: 'DELETE' });
      if (document.getElementById('f-editing-id').value === delBtn.dataset.id) stopEditing();
      await loadActivities();
    }
  });
}

function setupViewDate() {
  const viewDate = document.getElementById('view-date');
  viewDate.value = state.viewDate;
  viewDate.addEventListener('change', async () => {
    state.viewDate = viewDate.value;
    await loadActivities();
  });
}

/* ---------------- Timer ---------------- */

async function loadTimers() {
  state.timers = await api('/api/timers');
  renderTimers();
}

function renderTimers() {
  const container = document.getElementById('active-timers');
  container.innerHTML = '';
  if (!state.timers.length) {
    if (timerTickHandle) { clearInterval(timerTickHandle); timerTickHandle = null; }
    return;
  }
  state.timers.forEach((t) => {
    const item = document.createElement('div');
    item.className = 'timer-item';
    item.dataset.id = t.id;
    item.dataset.start = t.startAt;
    item.innerHTML = `
      <div class="meta">
        <span class="name">${escapeHtml(t.name)}</span>
        <span class="sub">${escapeHtml(memberName(t.memberId))} · ${escapeHtml(t.category)}</span>
      </div>
      <div class="elapsed">00:00</div>
      <div class="actions">
        <button class="stop-btn" data-action="stop" data-id="${t.id}">Stop</button>
        <button class="cancel-btn" data-action="cancel" data-id="${t.id}">Cancel</button>
      </div>
    `;
    container.appendChild(item);
  });
  tickTimers();
  if (!timerTickHandle) timerTickHandle = setInterval(tickTimers, 1000);
}

function tickTimers() {
  document.querySelectorAll('.timer-item').forEach((item) => {
    const start = new Date(item.dataset.start).getTime();
    const seconds = Math.max(0, Math.floor((Date.now() - start) / 1000));
    item.querySelector('.elapsed').textContent = formatHMS(seconds);
  });
}

function setupTimerForm() {
  const form = document.getElementById('timer-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('t-name').value.trim();
    const memberId = document.getElementById('t-member').value;
    const category = document.getElementById('t-category').value;
    if (!name || !memberId || !category) return;
    await api('/api/timers/start', { method: 'POST', body: JSON.stringify({ name, memberId, category }) });
    form.reset();
    await loadTimers();
  });

  document.getElementById('active-timers').addEventListener('click', async (e) => {
    const stopBtn = e.target.closest('button[data-action="stop"]');
    if (stopBtn) {
      await api(`/api/timers/${stopBtn.dataset.id}/stop`, { method: 'POST' });
      await loadTimers();
      if (state.viewDate === todayStr()) await loadActivities();
      return;
    }
    const cancelBtn = e.target.closest('button[data-action="cancel"]');
    if (cancelBtn) {
      if (!confirm('Cancel this timer without saving?')) return;
      await api(`/api/timers/${cancelBtn.dataset.id}`, { method: 'DELETE' });
      await loadTimers();
    }
  });
}

/* ---------------- Voice input ---------------- */

let voiceDraftSeq = 0;
const voiceDrafts = new Map();

function getSpeechRecognition() {
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

function setupVoice() {
  const btn = document.getElementById('voice-btn');
  const statusEl = document.getElementById('voice-status');
  const errorEl = document.getElementById('voice-error');
  const SpeechRecognitionCtor = getSpeechRecognition();

  if (!SpeechRecognitionCtor) {
    statusEl.textContent = 'Voice input is not supported in this browser. Try Chrome or Edge.';
    btn.disabled = true;
    return;
  }

  const recognition = new SpeechRecognitionCtor();
  recognition.lang = 'en-US';
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;
  let listening = false;

  recognition.addEventListener('start', () => {
    listening = true;
    btn.textContent = '⏹ Stop Recording';
    btn.classList.add('recording');
    statusEl.textContent = 'Listening...';
    errorEl.textContent = '';
  });

  recognition.addEventListener('result', (event) => {
    let transcript = '';
    for (let i = 0; i < event.results.length; i++) {
      transcript += event.results[i][0].transcript;
    }
    statusEl.textContent = `"${transcript}"`;
    if (event.results[event.results.length - 1].isFinal) {
      handleTranscript(transcript.trim());
    }
  });

  recognition.addEventListener('error', (event) => {
    errorEl.textContent = `Voice recognition error: ${event.error}`;
  });

  recognition.addEventListener('end', () => {
    listening = false;
    btn.textContent = '🎤 Start Recording';
    btn.classList.remove('recording');
  });

  btn.addEventListener('click', () => {
    if (listening) {
      recognition.stop();
    } else {
      recognition.start();
    }
  });
}

async function handleTranscript(transcript) {
  const statusEl = document.getElementById('voice-status');
  const errorEl = document.getElementById('voice-error');
  if (!transcript) return;

  try {
    const memberId = document.getElementById('v-member').value;
    const result = await api('/api/voice/parse', {
      method: 'POST',
      body: JSON.stringify({ transcript, date: state.viewDate }),
    });

    if (result.clarification) {
      statusEl.textContent = result.clarification;
    } else {
      statusEl.textContent = `Heard: "${transcript}"`;
    }

    result.activities.forEach((draft) => addVoiceDraft({ ...draft, memberId }));
  } catch (err) {
    errorEl.textContent = err.message;
  }
}

function addVoiceDraft(draft) {
  const id = `vd-${voiceDraftSeq++}`;
  voiceDrafts.set(id, draft);
  renderVoiceDrafts();
}

function renderVoiceDrafts() {
  const container = document.getElementById('voice-drafts');
  container.innerHTML = '';
  voiceDrafts.forEach((draft, id) => {
    const card = document.createElement('div');
    card.className = 'voice-draft-card';
    card.dataset.id = id;
    card.innerHTML = `
      <div class="draft-title">${escapeHtml(draft.name)}</div>
      <div class="draft-sub">
        ${escapeHtml(memberName(draft.memberId))} · ${escapeHtml(draft.category)} ·
        ${formatTime(draft.startAt)}&ndash;${formatTime(draft.endAt)} · ${formatMinutes(draft.durationMinutes)}
        ${draft.notes ? `<br/>${escapeHtml(draft.notes)}` : ''}
      </div>
      <div class="draft-actions">
        <button class="save-btn" data-action="save">Save</button>
        <button class="edit-btn" data-action="edit">Edit</button>
        <button class="cancel-btn" data-action="cancel">Cancel</button>
      </div>
    `;
    container.appendChild(card);
  });
}

async function setupVoiceDraftActions() {
  document.getElementById('voice-drafts').addEventListener('click', async (e) => {
    const card = e.target.closest('.voice-draft-card');
    if (!card) return;
    const id = card.dataset.id;
    const draft = voiceDrafts.get(id);
    const action = e.target.dataset.action;
    if (!action) return;

    if (action === 'cancel') {
      voiceDrafts.delete(id);
      renderVoiceDrafts();
      return;
    }

    if (action === 'save') {
      await api('/api/activities', {
        method: 'POST',
        body: JSON.stringify({ ...draft, inputMethod: 'VOICE' }),
      });
      voiceDrafts.delete(id);
      renderVoiceDrafts();
      if (draft.date === state.viewDate) await loadActivities();
      return;
    }

    if (action === 'edit') {
      voiceDrafts.delete(id);
      renderVoiceDrafts();
      document.getElementById('f-name').value = draft.name;
      document.getElementById('f-member').value = draft.memberId;
      document.getElementById('f-category').value = draft.category;
      document.getElementById('f-date').value = draft.date;
      document.getElementById('f-start').value = isoToTimeInput(draft.startAt);
      document.getElementById('f-end').value = isoToTimeInput(draft.endAt);
      document.getElementById('f-notes').value = draft.notes || '';
      document.getElementById('activity-form-title').textContent = 'Confirm Voice Activity';
      document.getElementById('f-submit-btn').textContent = 'Save Activity';
      document.getElementById('f-cancel-btn').classList.remove('hidden');
      document.getElementById('activity-form').scrollIntoView({ behavior: 'smooth' });
    }
  });
}

/* ---------------- Reports ---------------- */

function startOfWeek(d) {
  const date = new Date(d);
  const day = date.getDay();
  const diff = (day === 0 ? -6 : 1) - day; // Monday as start
  date.setDate(date.getDate() + diff);
  return date;
}

function setReportRange(range) {
  const today = new Date();
  let from, to;
  if (range === 'week') {
    from = startOfWeek(today);
    to = new Date(from);
    to.setDate(to.getDate() + 6);
  } else {
    from = new Date(today.getFullYear(), today.getMonth(), 1);
    to = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  }
  document.getElementById('r-from').value = from.toISOString().slice(0, 10);
  document.getElementById('r-to').value = to.toISOString().slice(0, 10);
  loadReport();
}

async function loadReport() {
  const from = document.getElementById('r-from').value;
  const to = document.getElementById('r-to').value;
  if (!from || !to) return;
  const report = await api(`/api/reports?from=${from}&to=${to}`);
  renderReport(report);
}

function renderReport(report) {
  document.getElementById('r-total').textContent = formatMinutes(report.totalMinutes);
  document.getElementById('r-count').textContent = report.activityCount;
  document.getElementById('r-avg').textContent = formatMinutes(report.avgDurationMinutes);

  const memberList = document.getElementById('r-member-list');
  memberList.innerHTML = report.memberTotals
    .map((m) => `<div class="member-total-row"><span>${escapeHtml(m.memberName)}</span><span>${formatMinutes(m.minutes)}</span></div>`)
    .join('');

  drawBarChart('chart-members', report.memberTotals.map((m) => ({ label: m.memberName, value: m.minutes })));
  drawBarChart('chart-categories', report.categoryTotals.map((c) => ({ label: c.category, value: c.minutes })));
  drawLineChart('chart-daily', report.dailyTotals.map((d) => ({ label: d.date.slice(5), value: d.minutes })));
}

function setupReportControls() {
  document.querySelectorAll('[data-range]').forEach((btn) => {
    btn.addEventListener('click', () => setReportRange(btn.dataset.range));
  });
  document.getElementById('r-refresh').addEventListener('click', loadReport);
}

/* ---------------- Canvas charts (no external libraries) ---------------- */

function setupCanvasSize(canvas) {
  const ratio = window.devicePixelRatio || 1;
  const cssWidth = canvas.clientWidth || canvas.width;
  const cssHeight = canvas.height;
  canvas.width = cssWidth * ratio;
  canvas.height = cssHeight * ratio;
  const ctx = canvas.getContext('2d');
  ctx.scale(ratio, ratio);
  return { ctx, width: cssWidth, height: cssHeight };
}

function drawBarChart(canvasId, data) {
  const canvas = document.getElementById(canvasId);
  const { ctx, width, height } = setupCanvasSize(canvas);
  ctx.clearRect(0, 0, width, height);

  if (!data.length) {
    ctx.fillStyle = '#9aa0ab';
    ctx.font = '13px sans-serif';
    ctx.fillText('No data for this range', 10, height / 2);
    return;
  }

  const padding = { top: 16, right: 10, bottom: 36, left: 10 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const maxVal = Math.max(1, ...data.map((d) => d.value));
  const barGap = 10;
  const barWidth = Math.max(16, chartWidth / data.length - barGap);

  data.forEach((d, i) => {
    const x = padding.left + i * (barWidth + barGap);
    const barHeight = (d.value / maxVal) * chartHeight;
    const y = padding.top + (chartHeight - barHeight);

    ctx.fillStyle = '#4f6df5';
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(x, y, barWidth, barHeight, 4) : ctx.rect(x, y, barWidth, barHeight);
    ctx.fill();

    ctx.fillStyle = '#1f2430';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(formatMinutes(d.value), x + barWidth / 2, y - 4);

    ctx.fillStyle = '#6b7280';
    ctx.font = '10px sans-serif';
    const label = d.label.length > 10 ? `${d.label.slice(0, 9)}…` : d.label;
    ctx.fillText(label, x + barWidth / 2, height - padding.bottom + 14);
  });
  ctx.textAlign = 'left';
}

function drawLineChart(canvasId, data) {
  const canvas = document.getElementById(canvasId);
  const { ctx, width, height } = setupCanvasSize(canvas);
  ctx.clearRect(0, 0, width, height);

  if (!data.length) {
    ctx.fillStyle = '#9aa0ab';
    ctx.font = '13px sans-serif';
    ctx.fillText('No data for this range', 10, height / 2);
    return;
  }

  const padding = { top: 16, right: 12, bottom: 28, left: 12 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const maxVal = Math.max(1, ...data.map((d) => d.value));
  const stepX = data.length > 1 ? chartWidth / (data.length - 1) : 0;

  ctx.strokeStyle = '#4f6df5';
  ctx.lineWidth = 2;
  ctx.beginPath();
  data.forEach((d, i) => {
    const x = padding.left + i * stepX;
    const y = padding.top + (chartHeight - (d.value / maxVal) * chartHeight);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  ctx.fillStyle = '#4f6df5';
  data.forEach((d, i) => {
    const x = padding.left + i * stepX;
    const y = padding.top + (chartHeight - (d.value / maxVal) * chartHeight);
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fill();
  });

  ctx.fillStyle = '#6b7280';
  ctx.font = '10px sans-serif';
  ctx.textAlign = 'center';
  const labelEvery = Math.ceil(data.length / 8);
  data.forEach((d, i) => {
    if (i % labelEvery === 0) {
      const x = padding.left + i * stepX;
      ctx.fillText(d.label, x, height - padding.bottom + 14);
    }
  });
  ctx.textAlign = 'left';
}

/* ---------------- Init ---------------- */

async function init() {
  await loadMembersAndCategories();
  setupTabs();
  setupViewDate();
  setupForm();
  setupMemberForm();
  setupCategoryForm();
  setupTimerForm();
  setupVoice();
  setupVoiceDraftActions();
  setupReportControls();
  await loadActivities();
  await loadTimers();
  setReportRange('week');
}

init();
