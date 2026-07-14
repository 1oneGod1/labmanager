const fs = require('fs');
const path = require('path');
const { SqliteDocumentStore } = require('./sqliteStore');

const COLLECTIONS = {
  students: 'students',
  computers: 'lab_computers',
  sessions: 'sessions',
  checks: 'facility_checks',
  control: 'control_settings',
  activities: 'activity_logs',
  chat: 'chat_messages',
  audit: 'admin_audit_logs',
  branding: 'app_branding',
};

const dataDir = path.resolve(
  process.env.LABKOM_DATA_DIR || path.resolve(__dirname, '..', '..', 'data'),
);
const databasePath = path.resolve(
  process.env.LABKOM_DATABASE_FILE || path.join(dataDir, 'labkom.db'),
);
const backupDir = path.resolve(
  process.env.LABKOM_BACKUP_DIR || path.join(dataDir, 'backups'),
);
const backupRetentionDays = Math.min(
  365,
  Math.max(1, Number.parseInt(process.env.LABKOM_BACKUP_RETENTION_DAYS || '30', 10) || 30),
);
const backupIntervalHours = Math.min(
  168,
  Math.max(1, Number.parseInt(process.env.LABKOM_BACKUP_INTERVAL_HOURS || '24', 10) || 24),
);

const store = new SqliteDocumentStore(databasePath);
let backupTimer = null;
let backupPromise = null;

function timestamp() {
  return new Date();
}

function toTimestamp(value) {
  if (!value) return null;
  const converted = value instanceof Date ? value : new Date(value);
  return Number.isNaN(converted.getTime()) ? null : converted;
}

function toDate(value) {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate();
  if (typeof value.toMillis === 'function') return new Date(value.toMillis());
  const converted = value instanceof Date ? value : new Date(value);
  return Number.isNaN(converted.getTime()) ? null : converted;
}

function timeMs(value) {
  return toDate(value)?.getTime() ?? 0;
}

function compareText(left, right) {
  return String(left || '').localeCompare(String(right || ''), 'id', {
    numeric: true,
    sensitivity: 'base',
  });
}

function sortByDate(rows, key, direction = 'desc') {
  const multiplier = direction === 'asc' ? 1 : -1;
  return [...rows].sort((left, right) => (timeMs(left[key]) - timeMs(right[key])) * multiplier);
}

function filterByDateRange(rows, key, dateFrom, dateTo) {
  const from = dateFrom ? toDate(dateFrom) : null;
  const to = dateTo ? toDate(dateTo) : null;
  return rows.filter((row) => {
    const at = toDate(row[key]);
    if (!at) return false;
    if (from && at < from) return false;
    if (to && at > to) return false;
    return true;
  });
}

function filterByDay(rows, key, date) {
  if (!date) return rows;
  const start = new Date(`${date}T00:00:00`);
  const end = new Date(`${date}T23:59:59.999`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return rows;
  return filterByDateRange(rows, key, start, end);
}

function calculateDurationMinutes(loginTime, endTime = new Date()) {
  const loginMs = timeMs(loginTime);
  if (!loginMs) return 0;
  return Math.max(0, Math.floor((timeMs(endTime) - loginMs) / 60_000));
}

function isStorageAvailable() {
  try {
    store.open();
    return true;
  } catch (error) {
    console.error('[SQLITE] Database lokal tidak tersedia:', error.message);
    return false;
  }
}

const studentsService = {
  async getAll() {
    return store.list(COLLECTIONS.students)
      .filter((student) => Number(student.is_active) === 1)
      .sort((left, right) => compareText(left.nis, right.nis));
  },

  async getByNis(nis) {
    return store.list(COLLECTIONS.students).find((student) => student.nis === nis) || null;
  },

  async getById(id) {
    return store.get(COLLECTIONS.students, id);
  },

  async create(studentData) {
    if (await this.getByNis(studentData.nis)) throw new Error('NIS sudah terdaftar');
    const now = timestamp();
    const created = store.insert(COLLECTIONS.students, {
      nis: studentData.nis,
      nama_lengkap: studentData.nama_lengkap,
      kelas: studentData.kelas || null,
      password_hash: studentData.password_hash,
      is_active: studentData.is_active !== undefined ? studentData.is_active : 1,
      created_at: now,
      updated_at: now,
    });
    const { password_hash: _passwordHash, ...safeStudent } = created;
    return safeStudent;
  },

  async update(id, updateData) {
    const existing = store.get(COLLECTIONS.students, id);
    if (!existing) throw new Error('Siswa tidak ditemukan.');
    if (updateData.nis && updateData.nis !== existing.nis) {
      const duplicate = await this.getByNis(updateData.nis);
      if (duplicate && duplicate.id !== id) throw new Error('NIS sudah terdaftar');
    }
    const result = store.update(COLLECTIONS.students, id, {
      ...updateData,
      updated_at: timestamp(),
    });
    delete result.password_hash;
    return result;
  },

  async delete(id) {
    store.update(COLLECTIONS.students, id, { is_active: 0, updated_at: timestamp() });
    return { success: true };
  },

  async hardDelete(id) {
    store.remove(COLLECTIONS.students, id);
    return { success: true };
  },

  async search(query) {
    const needle = String(query || '').toLowerCase();
    return (await this.getAll()).filter((student) =>
      String(student.nis || '').toLowerCase().includes(needle)
      || String(student.nama_lengkap || '').toLowerCase().includes(needle));
  },
};

const computersService = {
  async getAll() {
    return store.list(COLLECTIONS.computers)
      .sort((left, right) => compareText(left.pc_name, right.pc_name));
  },

  async getById(id) {
    return store.get(COLLECTIONS.computers, id);
  },

  async getByPcName(pcName) {
    return store.list(COLLECTIONS.computers).find((computer) => computer.pc_name === pcName) || null;
  },

  async getByBoundHostname(hostname) {
    if (!hostname) return null;
    return store.list(COLLECTIONS.computers)
      .find((computer) => computer.bound_hostname === hostname) || null;
  },

  async getByBoundMac(mac) {
    if (!mac) return null;
    return store.list(COLLECTIONS.computers).find((computer) => computer.bound_mac === mac) || null;
  },

  async create(computerData) {
    const now = timestamp();
    return store.insert(COLLECTIONS.computers, {
      pc_name: computerData.pc_name || computerData.name,
      label: computerData.label || null,
      bound_hostname: computerData.bound_hostname || null,
      bound_mac: computerData.bound_mac || null,
      last_known_ip: computerData.last_known_ip || null,
      mapped_at: computerData.mapped_at || null,
      status: computerData.status || 'active',
      created_at: now,
      updated_at: now,
    });
  },

  async update(id, updateData) {
    return store.update(COLLECTIONS.computers, id, {
      ...updateData,
      updated_at: timestamp(),
    });
  },

  async assignDevice({ targetPcName, sourcePcName, sourceMac, sourceIp }) {
    const target = await this.getByPcName(targetPcName);
    if (!target) throw new Error('PC tujuan tidak ditemukan.');
    const now = timestamp();
    store.transaction(() => {
      for (const computer of store.list(COLLECTIONS.computers)) {
        if (computer.id === target.id) continue;
        if ((sourcePcName && computer.bound_hostname === sourcePcName)
          || (sourceMac && computer.bound_mac === sourceMac)) {
          store.update(COLLECTIONS.computers, computer.id, {
            bound_hostname: null,
            bound_mac: null,
            last_known_ip: null,
            mapped_at: null,
            updated_at: now,
          });
        }
      }
      store.update(COLLECTIONS.computers, target.id, {
        bound_hostname: sourcePcName || null,
        bound_mac: sourceMac || null,
        last_known_ip: sourceIp || null,
        mapped_at: now,
        updated_at: now,
      });
    });
    return this.getByPcName(targetPcName);
  },

  async clearMapping(targetPcName) {
    const target = await this.getByPcName(targetPcName);
    if (!target) return null;
    store.update(COLLECTIONS.computers, target.id, {
      bound_hostname: null,
      bound_mac: null,
      last_known_ip: null,
      mapped_at: null,
      updated_at: timestamp(),
    });
    return this.getByPcName(targetPcName);
  },

  async delete(id) {
    store.remove(COLLECTIONS.computers, id);
    return { success: true };
  },
};

function activeSessions() {
  return store.list(COLLECTIONS.sessions).filter((session) => session.status === 'active');
}

function finishSessions(rows, status) {
  if (!rows.length) return 0;
  const now = timestamp();
  store.transaction(() => {
    for (const session of rows) {
      store.update(COLLECTIONS.sessions, session.id, {
        logout_time: now,
        duration_minutes: calculateDurationMinutes(session.login_time, now),
        status,
        updated_at: now,
      });
    }
  });
  return rows.length;
}

const sessionsService = {
  async getAll(limit = 100) {
    return sortByDate(store.list(COLLECTIONS.sessions), 'login_time')
      .slice(0, Number.parseInt(limit, 10) || 100);
  },

  async getById(id) {
    return store.get(COLLECTIONS.sessions, id);
  },

  async getActive() {
    return sortByDate(activeSessions(), 'login_time');
  },

  async getActiveByStudentId(studentId) {
    return sortByDate(
      activeSessions().filter((session) => session.student_id === studentId),
      'login_time',
    )[0] || null;
  },

  async getActiveByPcName(pcName) {
    return activeSessions().filter((session) => session.pc_name === pcName);
  },

  async getActiveByPcNames(pcNames) {
    const names = new Set(pcNames || []);
    return activeSessions().filter((session) => names.has(session.pc_name));
  },

  async create(sessionData) {
    const now = timestamp();
    return store.insert(COLLECTIONS.sessions, {
      student_id: sessionData.student_id,
      pc_name: sessionData.pc_name || sessionData.computer_name,
      actual_pc_name: sessionData.actual_pc_name || null,
      device_id: sessionData.device_id || null,
      login_time: now,
      logout_time: null,
      duration_minutes: null,
      status: 'active',
      nis: sessionData.nis || null,
      nama_lengkap: sessionData.nama_lengkap || null,
      kelas: sessionData.kelas || null,
      created_at: now,
      updated_at: now,
    });
  },

  async endSession(id, status = 'finished') {
    const session = await this.getById(id);
    if (!session) return null;
    finishSessions([session], status);
    return this.getById(id);
  },

  async closeActiveByPcNames(pcNames, status = 'finished') {
    const names = new Set(pcNames || []);
    return finishSessions(activeSessions().filter((session) => names.has(session.pc_name)), status);
  },

  async forceLogoutByPcName(pcName) {
    return this.closeActiveByPcNames([pcName], 'force_ended');
  },

  async forceLogoutByStudentId(studentId) {
    return finishSessions(
      activeSessions().filter((session) => session.student_id === studentId),
      'force_ended',
    );
  },

  async forceLogoutAll() {
    return finishSessions(activeSessions(), 'force_ended');
  },

  async getHistory({ date, page = 1, limit = 50 } = {}) {
    const pageNumber = Math.max(1, Number.parseInt(page, 10) || 1);
    const pageLimit = Math.max(1, Number.parseInt(limit, 10) || 50);
    const rows = sortByDate(filterByDay(store.list(COLLECTIONS.sessions), 'login_time', date), 'login_time');
    const offset = (pageNumber - 1) * pageLimit;
    return { data: rows.slice(offset, offset + pageLimit), total: rows.length, page: pageNumber, limit: pageLimit };
  },
};

const CHECK_STATUS_KEYS = [
  'cpu_status', 'monitor_status', 'keyboard_status', 'mouse_status', 'headset_status', 'desk_status',
  'hw_status', 'cleanliness_status', 'account_status', 'system_status', 'file_status',
];

const checksService = {
  async create(checkData) {
    const now = timestamp();
    return store.insert(COLLECTIONS.checks, {
      session_id: checkData.session_id || null,
      nis: checkData.nis,
      nama_lengkap: checkData.nama_lengkap,
      pc_name: checkData.pc_name,
      check_type: checkData.check_type,
      cpu_status: checkData.cpu_status || null,
      cpu_note: checkData.cpu_note || null,
      monitor_status: checkData.monitor_status || null,
      monitor_note: checkData.monitor_note || null,
      keyboard_status: checkData.keyboard_status || null,
      keyboard_note: checkData.keyboard_note || null,
      mouse_status: checkData.mouse_status || null,
      mouse_note: checkData.mouse_note || null,
      headset_status: checkData.headset_status || null,
      headset_note: checkData.headset_note || null,
      desk_status: checkData.desk_status || null,
      desk_note: checkData.desk_note || null,
      hw_status: checkData.hw_status || null,
      hw_note: checkData.hw_note || null,
      cleanliness_status: checkData.cleanliness_status || null,
      cleanliness_note: checkData.cleanliness_note || null,
      account_status: checkData.account_status || null,
      account_note: checkData.account_note || null,
      system_status: checkData.system_status || null,
      system_note: checkData.system_note || null,
      file_status: checkData.file_status || null,
      file_note: checkData.file_note || null,
      created_at: now,
      updated_at: now,
    });
  },

  async getChecks({ date, type, pc, page = 1, limit = 50 } = {}) {
    const pageNumber = Math.max(1, Number.parseInt(page, 10) || 1);
    const pageLimit = Math.max(1, Number.parseInt(limit, 10) || 50);
    let rows = filterByDay(store.list(COLLECTIONS.checks), 'created_at', date);
    if (type && ['pre', 'post'].includes(type)) rows = rows.filter((row) => row.check_type === type);
    if (pc) {
      const needle = String(pc).toLowerCase();
      rows = rows.filter((row) => String(row.pc_name || '').toLowerCase().includes(needle));
    }
    rows = sortByDate(rows, 'created_at');
    const offset = (pageNumber - 1) * pageLimit;
    const data = rows.slice(offset, offset + pageLimit).map((row) => {
      const createdAt = toDate(row.created_at);
      return {
        ...row,
        has_issue: CHECK_STATUS_KEYS.some((key) => row[key] === 'bad'),
        date_str: createdAt?.toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' }) || '',
        time_str: createdAt?.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) || '',
      };
    });
    return { data, total: rows.length, page: pageNumber, limit: pageLimit };
  },

  async getSummary({ date } = {}) {
    const grouped = {};
    for (const row of filterByDay(store.list(COLLECTIONS.checks), 'created_at', date)) {
      if (!grouped[row.pc_name]) {
        grouped[row.pc_name] = { pc_name: row.pc_name, pre_count: 0, post_count: 0, issue_count: 0 };
      }
      if (row.check_type === 'pre') grouped[row.pc_name].pre_count += 1;
      if (row.check_type === 'post') grouped[row.pc_name].post_count += 1;
      if (CHECK_STATUS_KEYS.some((key) => row[key] === 'bad')) grouped[row.pc_name].issue_count += 1;
    }
    return Object.values(grouped).sort((left, right) => right.issue_count - left.issue_count);
  },

  async getBySession(sessionId) {
    return sortByDate(
      store.list(COLLECTIONS.checks).filter((row) => row.session_id === sessionId),
      'created_at',
    );
  },
};

function parseControlValue(value) {
  try { return JSON.parse(value); } catch { return value; }
}

const controlService = {
  async getAll() {
    const document = store.get(COLLECTIONS.control, 'global');
    if (!document) return {};
    const settings = {};
    for (const [key, value] of Object.entries(document)) {
      if (['id', 'updated_at', 'updated_by'].includes(key)) continue;
      settings[key] = parseControlValue(value);
    }
    return settings;
  },

  async updateAll(updates) {
    store.set(COLLECTIONS.control, 'global', {
      ...updates,
      updated_at: timestamp(),
      updated_by: 'admin',
    }, { merge: true });
    return { success: true };
  },

  async get(key) {
    const settings = await this.getAll();
    return settings[key] !== undefined ? settings[key] : null;
  },

  async set(key, value) {
    const stringValue = typeof value === 'object' ? JSON.stringify(value) : String(value);
    store.set(COLLECTIONS.control, 'global', {
      [key]: stringValue,
      updated_at: timestamp(),
      updated_by: 'admin',
    }, { merge: true });
    return { success: true };
  },
};

const brandingService = {
  async get() {
    return store.get(COLLECTIONS.branding, 'global');
  },

  async update(branding) {
    return store.set(COLLECTIONS.branding, 'global', {
      ...branding,
      updated_at: timestamp(),
    });
  },
};

function activityRows() {
  return store.list(COLLECTIONS.activities);
}

const activitiesService = {
  async create(activityData) {
    return store.insert(COLLECTIONS.activities, {
      pc_name: activityData.pc_name,
      student_id: activityData.student_id || null,
      student_name: activityData.student_name || null,
      session_id: activityData.session_id || null,
      activity_type: activityData.activity_type,
      window_title: activityData.window_title || null,
      process_name: activityData.process_name || null,
      process_path: activityData.process_path || null,
      browser_name: activityData.browser_name || null,
      url: activityData.url || null,
      url_domain: activityData.url_domain || null,
      page_title: activityData.page_title || null,
      blocked: activityData.blocked === true,
      running_apps: activityData.running_apps || null,
      duration_seconds: activityData.duration_seconds || 0,
      activity_at: activityData.activity_at ? toTimestamp(activityData.activity_at) : timestamp(),
      created_at: timestamp(),
    });
  },

  async getActivities({ pc_name, student_id, session_id, limit = 100, offset = 0 } = {}) {
    let rows = activityRows();
    if (pc_name) rows = rows.filter((row) => row.pc_name === pc_name);
    else if (student_id) rows = rows.filter((row) => row.student_id === student_id);
    else if (session_id) rows = rows.filter((row) => row.session_id === session_id);
    return sortByDate(rows, 'activity_at')
      .slice(Number.parseInt(offset, 10) || 0, (Number.parseInt(offset, 10) || 0) + (Number.parseInt(limit, 10) || 100));
  },

  async getBySession(sessionId) {
    return sortByDate(activityRows().filter((row) => row.session_id === sessionId), 'activity_at', 'asc');
  },

  async getByStudent(studentId, { limit = 100, offset = 0 } = {}) {
    const start = Number.parseInt(offset, 10) || 0;
    return sortByDate(activityRows().filter((row) => row.student_id === studentId), 'activity_at')
      .slice(start, start + (Number.parseInt(limit, 10) || 100));
  },

  async getStats({ student_id, date_from, date_to } = {}) {
    let rows = activityRows();
    if (student_id) rows = rows.filter((row) => row.student_id === student_id);
    rows = filterByDateRange(rows, 'activity_at', date_from, date_to);
    const stats = {};
    for (const row of rows) {
      const type = row.activity_type || 'unknown';
      if (!stats[type]) stats[type] = { activity_type: type, count: 0, total_duration: 0 };
      stats[type].count += 1;
      stats[type].total_duration += Number(row.duration_seconds || 0);
    }
    return Object.values(stats);
  },

  async getTopSites({ student_id, limit = 10, date_from, date_to } = {}) {
    let rows = activityRows().filter((row) => row.activity_type === 'browser_url');
    if (student_id) rows = rows.filter((row) => row.student_id === student_id);
    rows = filterByDateRange(rows, 'activity_at', date_from, date_to);
    const domains = {};
    for (const row of rows) {
      if (!row.url_domain) continue;
      if (!domains[row.url_domain]) {
        domains[row.url_domain] = { url_domain: row.url_domain, visit_count: 0, blocked_attempts: 0, blocked: false, last_visit: null };
      }
      const summary = domains[row.url_domain];
      summary.visit_count += 1;
      if (row.blocked === true) {
        summary.blocked = true;
        summary.blocked_attempts += 1;
      }
      const at = toDate(row.activity_at);
      if (!summary.last_visit || (at && at > summary.last_visit)) summary.last_visit = at;
    }
    return Object.values(domains).sort((left, right) => right.visit_count - left.visit_count)
      .slice(0, Number.parseInt(limit, 10) || 10);
  },

  async getTopApps({ student_id, limit = 10, date_from, date_to } = {}) {
    let rows = activityRows().filter((row) => row.activity_type === 'window_change');
    if (student_id) rows = rows.filter((row) => row.student_id === student_id);
    rows = filterByDateRange(rows, 'activity_at', date_from, date_to);
    const apps = {};
    for (const row of rows) {
      if (!row.process_name) continue;
      if (!apps[row.process_name]) {
        apps[row.process_name] = { process_name: row.process_name, usage_count: 0, total_duration: 0, last_used: null };
      }
      const summary = apps[row.process_name];
      summary.usage_count += 1;
      summary.total_duration += Number(row.duration_seconds || 0);
      const at = toDate(row.activity_at);
      if (!summary.last_used || (at && at > summary.last_used)) summary.last_used = at;
    }
    return Object.values(apps).sort((left, right) => right.usage_count - left.usage_count)
      .slice(0, Number.parseInt(limit, 10) || 10);
  },

  async getTimeline({ date_from, date_to, bucket_count = 7 } = {}) {
    const end = date_to ? new Date(date_to) : new Date();
    const start = date_from ? new Date(date_from) : new Date(end.getTime() - 86_400_000);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
      throw new Error('Invalid activity timeline date range');
    }
    const bucketCount = Math.min(24, Math.max(2, Number.parseInt(bucket_count, 10) || 7));
    const bucketMs = (end.getTime() - start.getTime()) / bucketCount;
    const counts = Array.from({ length: bucketCount }, () => 0);
    for (const row of filterByDateRange(activityRows(), 'activity_at', start, end)) {
      const at = timeMs(row.activity_at);
      const index = Math.min(bucketCount - 1, Math.floor((at - start.getTime()) / bucketMs));
      if (index >= 0) counts[index] += 1;
    }
    return counts.map((activity_count, index) => ({
      start_at: new Date(start.getTime() + (index * bucketMs)).toISOString(),
      end_at: new Date(start.getTime() + ((index + 1) * bucketMs)).toISOString(),
      activity_count,
    }));
  },

  async cleanup(days = 30) {
    const cutoff = Date.now() - ((Number.parseInt(days, 10) || 30) * 86_400_000);
    const expired = activityRows().filter((row) => timeMs(row.activity_at) < cutoff);
    store.transaction(() => expired.forEach((row) => store.remove(COLLECTIONS.activities, row.id)));
    return expired.length;
  },
};

const chatService = {
  async create(messageData) {
    return store.insert(COLLECTIONS.chat, {
      message_id: messageData.id || null,
      type: messageData.type || 'unknown',
      from: messageData.from || null,
      pc_name: messageData.pc_name || null,
      student_name: messageData.student_name || null,
      message: messageData.message || '',
      delivered_to: messageData.delivered_to || null,
      timestamp: messageData.timestamp ? toTimestamp(messageData.timestamp) : timestamp(),
      created_at: timestamp(),
    });
  },

  async getRecent(limit = 50) {
    return sortByDate(store.list(COLLECTIONS.chat), 'created_at')
      .slice(0, Number.parseInt(limit, 10) || 50)
      .reverse();
  },

  async getToday() {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    return sortByDate(
      store.list(COLLECTIONS.chat).filter((row) => timeMs(row.created_at) >= start.getTime()),
      'created_at',
      'asc',
    );
  },

  async cleanup(days = 7) {
    const cutoff = Date.now() - ((Number.parseInt(days, 10) || 7) * 86_400_000);
    const expired = store.list(COLLECTIONS.chat).filter((row) => timeMs(row.created_at) < cutoff);
    store.transaction(() => expired.forEach((row) => store.remove(COLLECTIONS.chat, row.id)));
    return expired.length;
  },
};

const auditService = {
  async create(auditData) {
    return store.insert(COLLECTIONS.audit, {
      ...auditData,
      created_at: auditData.created_at || timestamp(),
    });
  },
};

function cleanupBackups() {
  fs.mkdirSync(backupDir, { recursive: true });
  const cutoff = Date.now() - (backupRetentionDays * 86_400_000);
  for (const entry of fs.readdirSync(backupDir, { withFileTypes: true })) {
    if (!entry.isFile() || !/^labkom-backup-.*\.db$/i.test(entry.name)) continue;
    const candidate = path.join(backupDir, entry.name);
    try {
      if (fs.statSync(candidate).mtimeMs < cutoff) fs.rmSync(candidate, { force: true });
    } catch (error) {
      console.warn('[SQLITE] Gagal membersihkan backup:', error.message);
    }
  }
}

async function createBackup(reason = 'manual') {
  if (backupPromise) return backupPromise;
  backupPromise = (async () => {
    store.open();
    cleanupBackups();
    const safeReason = String(reason || 'manual').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').slice(0, 30);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const destination = path.join(backupDir, `labkom-backup-${stamp}-${safeReason}.db`);
    await store.backupTo(destination);
    const completedAt = new Date().toISOString();
    store.setMetadata('last_backup_at', completedAt);
    store.setMetadata('last_backup_path', destination);
    cleanupBackups();
    console.log('[SQLITE] Backup database selesai:', destination);
    return { path: destination, created_at: completedAt, size_bytes: fs.statSync(destination).size };
  })().finally(() => { backupPromise = null; });
  return backupPromise;
}

function getStorageStatus() {
  store.open();
  let sizeBytes = 0;
  try { sizeBytes = fs.statSync(databasePath).size; } catch {}
  return {
    provider: 'sqlite',
    mode: 'local',
    available: true,
    database_path: databasePath,
    backup_path: backupDir,
    size_bytes: sizeBytes,
    last_backup_at: store.getMetadata('last_backup_at'),
    last_backup_path: store.getMetadata('last_backup_path'),
    backup_retention_days: backupRetentionDays,
    backup_interval_hours: backupIntervalHours,
  };
}

function initialize({ scheduleBackups = true } = {}) {
  store.open();
  fs.mkdirSync(backupDir, { recursive: true });
  console.log('[SQLITE] Database lokal aktif:', databasePath);
  if (scheduleBackups && !backupTimer) {
    const intervalMs = backupIntervalHours * 60 * 60 * 1000;
    const lastBackup = toDate(store.getMetadata('last_backup_at'));
    if (!lastBackup || (Date.now() - lastBackup.getTime()) >= intervalMs) {
      setTimeout(() => createBackup('startup').catch((error) => {
        console.warn('[SQLITE] Backup awal gagal:', error.message);
      }), 1500).unref();
    }
    backupTimer = setInterval(() => createBackup('automatic').catch((error) => {
      console.warn('[SQLITE] Backup otomatis gagal:', error.message);
    }), intervalMs);
    backupTimer.unref();
  }
  return getStorageStatus();
}

async function shutdown({ backup = true } = {}) {
  if (backupTimer) clearInterval(backupTimer);
  backupTimer = null;
  if (backup) {
    try { await createBackup('shutdown'); } catch (error) {
      console.warn('[SQLITE] Backup saat shutdown gagal:', error.message);
    }
  }
  store.close();
}

module.exports = {
  providerName: 'sqlite',
  initialize,
  shutdown,
  isStorageAvailable,
  getStorageStatus,
  createBackup,
  timestamp,
  toTimestamp,
  toDate,
  students: studentsService,
  computers: computersService,
  sessions: sessionsService,
  checks: checksService,
  control: controlService,
  activities: activitiesService,
  chat: chatService,
  audit: auditService,
  branding: brandingService,
};
