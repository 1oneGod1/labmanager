// ─── Firebase Service Layer ─────────────────────────────────────────────────
// Abstraction layer untuk operasi Firestore
// Menyediakan fungsi-fungsi CRUD yang mudah digunakan

const { db, admin } = require('../config/firebase');

// ═══════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Check apakah Firestore sudah terinisialisasi
 */
function isFirestoreAvailable() {
  return db !== null;
}

/**
 * Generate timestamp untuk Firestore
 */
function timestamp() {
  return admin.firestore.Timestamp.now();
}

/**
 * Convert Date ke Firestore Timestamp
 */
function toTimestamp(date) {
  if (!date) return null;
  if (date instanceof admin.firestore.Timestamp) return date;
  return admin.firestore.Timestamp.fromDate(new Date(date));
}

/**
 * Convert Firestore Timestamp ke JS Date
 */
function toDate(ts) {
  if (!ts) return null;
  if (ts.toDate) return ts.toDate();
  return new Date(ts);
}

/**
 * Convert Firestore document ke plain object
 */
function docToObject(doc) {
  if (!doc.exists) return null;
  return { id: doc.id, ...doc.data() };
}

function filterActivityDocsByDate(docs, dateFrom, dateTo) {
  const from = dateFrom ? new Date(dateFrom) : null;
  const to = dateTo ? new Date(dateTo) : null;
  const validFrom = from && !Number.isNaN(from.getTime()) ? from : null;
  const validTo = to && !Number.isNaN(to.getTime()) ? to : null;

  return docs.filter((doc) => {
    const at = toDate(doc.activity_at);
    if (!at || Number.isNaN(at.getTime())) return false;
    if (validFrom && at < validFrom) return false;
    if (validTo && at > validTo) return false;
    return true;
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// STUDENTS COLLECTION
// ═══════════════════════════════════════════════════════════════════════════

const studentsService = {
  /**
   * Get all active students
   */
  async getAll() {
    if (!isFirestoreAvailable()) throw new Error('Firestore not available');
    
    const snapshot = await db.collection('students')
      .where('is_active', '==', 1)
      .orderBy('nis')
      .get();
    return snapshot.docs.map(docToObject);
  },

  /**
   * Get student by NIS
   */
  async getByNis(nis) {
    if (!isFirestoreAvailable()) throw new Error('Firestore not available');
    
    const snapshot = await db.collection('students')
      .where('nis', '==', nis)
      .limit(1)
      .get();
    
    if (snapshot.empty) return null;
    return docToObject(snapshot.docs[0]);
  },

  /**
   * Get student by ID
   */
  async getById(id) {
    if (!isFirestoreAvailable()) throw new Error('Firestore not available');
    
    const doc = await db.collection('students').doc(id).get();
    return docToObject(doc);
  },

  /**
   * Create new student
   */
  async create(studentData) {
    if (!isFirestoreAvailable()) throw new Error('Firestore not available');
    
    // Check if NIS already exists
    const existing = await this.getByNis(studentData.nis);
    if (existing) {
      throw new Error('NIS sudah terdaftar');
    }

    const data = {
      nis: studentData.nis,
      nama_lengkap: studentData.nama_lengkap,
      kelas: studentData.kelas || null,
      password_hash: studentData.password_hash,
      is_active: studentData.is_active !== undefined ? studentData.is_active : 1,
      created_at: timestamp(),
      updated_at: timestamp(),
    };

    const docRef = await db.collection('students').add(data);
    const result = { id: docRef.id, ...data };
    delete result.password_hash;
    return result;
  },

  /**
   * Update student
   */
  async update(id, updateData) {
    if (!isFirestoreAvailable()) throw new Error('Firestore not available');
    
    const data = {
      ...updateData,
      updated_at: timestamp(),
    };

    await db.collection('students').doc(id).update(data);
    const result = await this.getById(id);
    if (result && result.password_hash) {
      delete result.password_hash;
    }
    return result;
  },

  /**
   * Delete student (soft delete - set is_active to 0)
   */
  async delete(id) {
    if (!isFirestoreAvailable()) throw new Error('Firestore not available');
    
    await db.collection('students').doc(id).update({
      is_active: 0,
      updated_at: timestamp(),
    });
    return { success: true };
  },

  /**
   * Hard delete student
   */
  async hardDelete(id) {
    if (!isFirestoreAvailable()) throw new Error('Firestore not available');
    
    await db.collection('students').doc(id).delete();
    return { success: true };
  },

  /**
   * Search students by name or NIS
   */
  async search(query) {
    if (!isFirestoreAvailable()) throw new Error('Firestore not available');
    
    const all = await this.getAll();
    const lowerQuery = query.toLowerCase();
    
    return all.filter(student => 
      student.nis.toLowerCase().includes(lowerQuery) ||
      student.nama_lengkap.toLowerCase().includes(lowerQuery)
    );
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// LAB COMPUTERS COLLECTION
// ═══════════════════════════════════════════════════════════════════════════

const computersService = {
  /**
   * Get all computers
   */
  async getAll() {
    if (!isFirestoreAvailable()) throw new Error('Firestore not available');
    
    const snapshot = await db.collection('lab_computers').orderBy('pc_name').get();
    return snapshot.docs.map(docToObject);
  },

  /**
   * Get computer by ID
   */
  async getById(id) {
    if (!isFirestoreAvailable()) throw new Error('Firestore not available');
    
    const doc = await db.collection('lab_computers').doc(id).get();
    return docToObject(doc);
  },

  /**
   * Get computer by pc_name
   */
  async getByPcName(pcName) {
    if (!isFirestoreAvailable()) throw new Error('Firestore not available');
    
    const snapshot = await db.collection('lab_computers')
      .where('pc_name', '==', pcName)
      .limit(1)
      .get();
    
    if (snapshot.empty) return null;
    return docToObject(snapshot.docs[0]);
  },

  /**
   * Find computer by bound_hostname
   */
  async getByBoundHostname(hostname) {
    if (!isFirestoreAvailable()) throw new Error('Firestore not available');
    if (!hostname) return null;

    const snapshot = await db.collection('lab_computers')
      .where('bound_hostname', '==', hostname)
      .limit(1)
      .get();
    
    if (snapshot.empty) return null;
    return docToObject(snapshot.docs[0]);
  },

  /**
   * Find computer by bound_mac
   */
  async getByBoundMac(mac) {
    if (!isFirestoreAvailable()) throw new Error('Firestore not available');
    if (!mac) return null;

    const snapshot = await db.collection('lab_computers')
      .where('bound_mac', '==', mac)
      .limit(1)
      .get();
    
    if (snapshot.empty) return null;
    return docToObject(snapshot.docs[0]);
  },

  /**
   * Create new computer
   */
  async create(computerData) {
    if (!isFirestoreAvailable()) throw new Error('Firestore not available');
    
    const data = {
      pc_name: computerData.pc_name || computerData.name,
      label: computerData.label || null,
      bound_hostname: computerData.bound_hostname || null,
      bound_mac: computerData.bound_mac || null,
      last_known_ip: computerData.last_known_ip || null,
      mapped_at: computerData.mapped_at || null,
      status: computerData.status || 'active',
      created_at: timestamp(),
      updated_at: timestamp(),
    };

    const docRef = await db.collection('lab_computers').add(data);
    return { id: docRef.id, ...data };
  },

  /**
   * Update computer
   */
  async update(id, updateData) {
    if (!isFirestoreAvailable()) throw new Error('Firestore not available');
    
    const data = {
      ...updateData,
      updated_at: timestamp(),
    };

    await db.collection('lab_computers').doc(id).update(data);
    return this.getById(id);
  },

  /**
   * Assign device to lab computer
   */
  async assignDevice({ targetPcName, sourcePcName, sourceMac, sourceIp }) {
    if (!isFirestoreAvailable()) throw new Error('Firestore not available');

    // Find target
    const target = await this.getByPcName(targetPcName);
    if (!target) throw new Error('PC tujuan tidak ditemukan.');

    // Clear old bindings for this source from other PCs
    const allComputers = await this.getAll();
    const batch = db.batch();

    for (const comp of allComputers) {
      if (comp.pc_name === targetPcName) continue;
      let needsClear = false;
      if (sourcePcName && comp.bound_hostname === sourcePcName) needsClear = true;
      if (sourceMac && comp.bound_mac === sourceMac) needsClear = true;
      if (needsClear) {
        batch.update(db.collection('lab_computers').doc(comp.id), {
          bound_hostname: null,
          bound_mac: null,
          last_known_ip: null,
          mapped_at: null,
          updated_at: timestamp(),
        });
      }
    }

    // Set new binding on target
    batch.update(db.collection('lab_computers').doc(target.id), {
      bound_hostname: sourcePcName || null,
      bound_mac: sourceMac || null,
      last_known_ip: sourceIp || null,
      mapped_at: timestamp(),
      updated_at: timestamp(),
    });

    await batch.commit();
    return this.getByPcName(targetPcName);
  },

  /**
   * Clear device mapping
   */
  async clearMapping(targetPcName) {
    if (!isFirestoreAvailable()) throw new Error('Firestore not available');

    const target = await this.getByPcName(targetPcName);
    if (!target) return null;

    await db.collection('lab_computers').doc(target.id).update({
      bound_hostname: null,
      bound_mac: null,
      last_known_ip: null,
      mapped_at: null,
      updated_at: timestamp(),
    });

    return this.getByPcName(targetPcName);
  },

  /**
   * Delete computer
   */
  async delete(id) {
    if (!isFirestoreAvailable()) throw new Error('Firestore not available');
    
    await db.collection('lab_computers').doc(id).delete();
    return { success: true };
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// SESSIONS COLLECTION
// ═══════════════════════════════════════════════════════════════════════════

const sessionsService = {
  /**
   * Get all sessions (latest)
   */
  async getAll(limit = 100) {
    if (!isFirestoreAvailable()) throw new Error('Firestore not available');
    
    const snapshot = await db.collection('sessions')
      .orderBy('login_time', 'desc')
      .limit(limit)
      .get();
    
    return snapshot.docs.map(docToObject);
  },

  /**
   * Get session by ID
   */
  async getById(id) {
    if (!isFirestoreAvailable()) throw new Error('Firestore not available');
    
    const doc = await db.collection('sessions').doc(id).get();
    return docToObject(doc);
  },

  /**
   * Get active sessions
   */
  async getActive() {
    if (!isFirestoreAvailable()) throw new Error('Firestore not available');
    
    const snapshot = await db.collection('sessions')
      .where('status', '==', 'active')
      .orderBy('login_time', 'desc')
      .get();
    
    return snapshot.docs.map(docToObject);
  },

  /**
   * Get active session by student_id
   */
  async getActiveByStudentId(studentId) {
    if (!isFirestoreAvailable()) throw new Error('Firestore not available');

    const snapshot = await db.collection('sessions')
      .where('student_id', '==', studentId)
      .where('status', '==', 'active')
      .limit(1)
      .get();

    if (snapshot.empty) return null;
    return docToObject(snapshot.docs[0]);
  },

  /**
   * Get active sessions by pc_name (could be multiple if unclean)
   */
  async getActiveByPcName(pcName) {
    if (!isFirestoreAvailable()) throw new Error('Firestore not available');

    const snapshot = await db.collection('sessions')
      .where('pc_name', '==', pcName)
      .where('status', '==', 'active')
      .get();

    return snapshot.docs.map(docToObject);
  },

  /**
   * Get active sessions by multiple pc_names
   */
  async getActiveByPcNames(pcNames) {
    if (!isFirestoreAvailable()) throw new Error('Firestore not available');
    if (!pcNames || pcNames.length === 0) return [];

    // Firestore 'in' supports up to 30 items
    const results = [];
    for (let i = 0; i < pcNames.length; i += 30) {
      const chunk = pcNames.slice(i, i + 30);
      const snapshot = await db.collection('sessions')
        .where('pc_name', 'in', chunk)
        .where('status', '==', 'active')
        .get();
      results.push(...snapshot.docs.map(docToObject));
    }
    return results;
  },

  /**
   * Create new session (login)
   */
  async create(sessionData) {
    if (!isFirestoreAvailable()) throw new Error('Firestore not available');
    
    const now = timestamp();
    const data = {
      student_id: sessionData.student_id,
      pc_name: sessionData.pc_name || sessionData.computer_name,
      actual_pc_name: sessionData.actual_pc_name || null,
      device_id: sessionData.device_id || null,
      login_time: now,
      logout_time: null,
      duration_minutes: null,
      status: 'active',
      // Denormalized student data for faster reads
      nis: sessionData.nis || null,
      nama_lengkap: sessionData.nama_lengkap || null,
      kelas: sessionData.kelas || null,
      created_at: now,
      updated_at: now,
    };

    const docRef = await db.collection('sessions').add(data);
    return { id: docRef.id, ...data };
  },

  /**
   * End session (logout) - by session id
   */
  async endSession(id, status = 'finished') {
    if (!isFirestoreAvailable()) throw new Error('Firestore not available');
    
    const session = await this.getById(id);
    if (!session) return null;

    const now = timestamp();
    const loginTime = session.login_time;
    
    // Calculate duration in minutes
    let durationMinutes = 0;
    if (loginTime) {
      const loginMs = loginTime.toMillis ? loginTime.toMillis() : new Date(loginTime).getTime();
      durationMinutes = Math.floor((now.toMillis() - loginMs) / 1000 / 60);
    }

    await db.collection('sessions').doc(id).update({
      logout_time: now,
      duration_minutes: durationMinutes,
      status,
      updated_at: now,
    });

    return this.getById(id);
  },

  /**
   * Close active sessions by pc_name(s) — ghost session cleanup
   */
  async closeActiveByPcNames(pcNames, status = 'finished') {
    if (!isFirestoreAvailable()) throw new Error('Firestore not available');
    if (!pcNames || pcNames.length === 0) return 0;

    const now = timestamp();
    let affected = 0;
    for (const pcName of pcNames) {
      const sessions = await this.getActiveByPcName(pcName);
      if (sessions.length === 0) continue;

      const batch = db.batch();
      for (const session of sessions) {
        let durationMinutes = 0;
        if (session.login_time) {
          const loginMs = session.login_time.toMillis ? session.login_time.toMillis() : new Date(session.login_time).getTime();
          durationMinutes = Math.floor((now.toMillis() - loginMs) / 1000 / 60);
        }
        batch.update(db.collection('sessions').doc(session.id), {
          logout_time: now,
          duration_minutes: durationMinutes,
          status,
          updated_at: now,
        });
        affected++;
      }
      await batch.commit();
    }
    return affected;
  },

  /**
   * Force logout by pc_name
   */
  async forceLogoutByPcName(pcName) {
    return this.closeActiveByPcNames([pcName], 'force_ended');
  },

  /**
   * Force logout by student_id
   */
  async forceLogoutByStudentId(studentId) {
    if (!isFirestoreAvailable()) throw new Error('Firestore not available');

    const snapshot = await db.collection('sessions')
      .where('student_id', '==', studentId)
      .where('status', '==', 'active')
      .get();

    if (snapshot.empty) return 0;

    const now = timestamp();
    const batch = db.batch();
    let affected = 0;
    for (const doc of snapshot.docs) {
      const session = doc.data();
      let durationMinutes = 0;
      if (session.login_time) {
        const loginMs = session.login_time.toMillis ? session.login_time.toMillis() : new Date(session.login_time).getTime();
        durationMinutes = Math.floor((now.toMillis() - loginMs) / 1000 / 60);
      }
      batch.update(doc.ref, {
        logout_time: now,
        duration_minutes: durationMinutes,
        status: 'force_ended',
        updated_at: now,
      });
      affected++;
    }
    await batch.commit();
    return affected;
  },

  /**
   * Force logout ALL active sessions
   */
  async forceLogoutAll() {
    if (!isFirestoreAvailable()) throw new Error('Firestore not available');

    const snapshot = await db.collection('sessions')
      .where('status', '==', 'active')
      .get();

    if (snapshot.empty) return 0;

    const now = timestamp();
    // Batch writes (max 500 per batch)
    let affected = 0;
    const docs = snapshot.docs;
    for (let i = 0; i < docs.length; i += 500) {
      const batch = db.batch();
      const chunk = docs.slice(i, i + 500);
      for (const doc of chunk) {
        const session = doc.data();
        let durationMinutes = 0;
        if (session.login_time) {
          const loginMs = session.login_time.toMillis ? session.login_time.toMillis() : new Date(session.login_time).getTime();
          durationMinutes = Math.floor((now.toMillis() - loginMs) / 1000 / 60);
        }
        batch.update(doc.ref, {
          logout_time: now,
          duration_minutes: durationMinutes,
          status: 'force_ended',
          updated_at: now,
        });
        affected++;
      }
      await batch.commit();
    }
    return affected;
  },

  /**
   * Get session history with pagination and date filter
   */
  async getHistory({ date, page = 1, limit = 50 } = {}) {
    if (!isFirestoreAvailable()) throw new Error('Firestore not available');

    let query = db.collection('sessions').orderBy('login_time', 'desc');

    if (date) {
      const startOfDay = new Date(date + 'T00:00:00');
      const endOfDay = new Date(date + 'T23:59:59.999');
      query = query
        .where('login_time', '>=', admin.firestore.Timestamp.fromDate(startOfDay))
        .where('login_time', '<=', admin.firestore.Timestamp.fromDate(endOfDay));
    }

    // Get total count (we need to count all matching docs)
    const countSnapshot = await query.get();
    const total = countSnapshot.size;

    // Paginate
    const offset = (parseInt(page) - 1) * parseInt(limit);
    // Firestore doesn't have native offset, so we use startAfter or just slice
    const allDocs = countSnapshot.docs.slice(offset, offset + parseInt(limit));

    const data = allDocs.map(docToObject);
    return { data, total, page: parseInt(page), limit: parseInt(limit) };
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// FACILITY CHECKS COLLECTION
// ═══════════════════════════════════════════════════════════════════════════

const checksService = {
  /**
   * Create facility check
   */
  async create(checkData) {
    if (!isFirestoreAvailable()) throw new Error('Firestore not available');
    
    const now = timestamp();
    const data = {
      session_id: checkData.session_id || null,
      nis: checkData.nis,
      nama_lengkap: checkData.nama_lengkap,
      pc_name: checkData.pc_name,
      check_type: checkData.check_type,
      // Pre-check items
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
      // Post-check items
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
    };

    const docRef = await db.collection('facility_checks').add(data);
    return { id: docRef.id, ...data };
  },

  /**
   * Get checks with filters and pagination
   */
  async getChecks({ date, type, pc, page = 1, limit = 50 } = {}) {
    if (!isFirestoreAvailable()) throw new Error('Firestore not available');

    let query = db.collection('facility_checks').orderBy('created_at', 'desc');

    if (date) {
      const startOfDay = new Date(date + 'T00:00:00');
      const endOfDay = new Date(date + 'T23:59:59.999');
      query = query
        .where('created_at', '>=', admin.firestore.Timestamp.fromDate(startOfDay))
        .where('created_at', '<=', admin.firestore.Timestamp.fromDate(endOfDay));
    }

    // Get all matching docs first for count + type/pc filtering
    const allSnapshot = await query.get();
    let allDocs = allSnapshot.docs.map(docToObject);

    // Firestore can't combine multiple inequality/range filters, so filter in-memory
    if (type && ['pre', 'post'].includes(type)) {
      allDocs = allDocs.filter(d => d.check_type === type);
    }
    if (pc) {
      const lowerPc = pc.toLowerCase();
      allDocs = allDocs.filter(d => d.pc_name && d.pc_name.toLowerCase().includes(lowerPc));
    }

    const total = allDocs.length;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const paginated = allDocs.slice(offset, offset + parseInt(limit));

    const statusKeys = [
      'cpu_status', 'monitor_status', 'keyboard_status', 'mouse_status', 'headset_status', 'desk_status',
      'hw_status', 'cleanliness_status', 'account_status',
      'system_status', 'file_status',
    ];

    const data = paginated.map(r => {
      const createdAt = toDate(r.created_at);
      const hasIssue = statusKeys.some(k => r[k] === 'bad');
      return {
        ...r,
        has_issue: hasIssue,
        date_str: createdAt ? createdAt.toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' }) : '',
        time_str: createdAt ? createdAt.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : '',
      };
    });

    return { data, total, page: parseInt(page), limit: parseInt(limit) };
  },

  /**
   * Get checks summary by PC
   */
  async getSummary({ date } = {}) {
    if (!isFirestoreAvailable()) throw new Error('Firestore not available');

    let query = db.collection('facility_checks');

    if (date) {
      const startOfDay = new Date(date + 'T00:00:00');
      const endOfDay = new Date(date + 'T23:59:59.999');
      query = query
        .where('created_at', '>=', admin.firestore.Timestamp.fromDate(startOfDay))
        .where('created_at', '<=', admin.firestore.Timestamp.fromDate(endOfDay));
    }

    const snapshot = await query.get();
    const docs = snapshot.docs.map(docToObject);

    const statusKeys = [
      'cpu_status', 'monitor_status', 'keyboard_status', 'mouse_status', 'headset_status', 'desk_status',
      'hw_status', 'cleanliness_status', 'account_status',
      'system_status', 'file_status',
    ];

    // Group by pc_name
    const byPc = {};
    for (const d of docs) {
      if (!byPc[d.pc_name]) {
        byPc[d.pc_name] = { pc_name: d.pc_name, pre_count: 0, post_count: 0, issue_count: 0 };
      }
      if (d.check_type === 'pre') byPc[d.pc_name].pre_count++;
      if (d.check_type === 'post') byPc[d.pc_name].post_count++;
      if (statusKeys.some(k => d[k] === 'bad')) byPc[d.pc_name].issue_count++;
    }

    const result = Object.values(byPc).sort((a, b) => b.issue_count - a.issue_count);
    return result;
  },

  /**
   * Get checks by session
   */
  async getBySession(sessionId) {
    if (!isFirestoreAvailable()) throw new Error('Firestore not available');
    
    const snapshot = await db.collection('facility_checks')
      .where('session_id', '==', sessionId)
      .orderBy('created_at', 'desc')
      .get();
    
    return snapshot.docs.map(docToObject);
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// CONTROL SETTINGS COLLECTION (key-value pairs in a single document)
// ═══════════════════════════════════════════════════════════════════════════

const controlService = {
  /**
   * Get all control settings as key-value object
   */
  async getAll() {
    if (!isFirestoreAvailable()) throw new Error('Firestore not available');
    
    const doc = await db.collection('control_settings').doc('global').get();
    if (!doc.exists) {
      // Return empty settings
      return {};
    }
    const data = doc.data();
    // Parse JSON strings back to objects/arrays
    const settings = {};
    for (const [key, value] of Object.entries(data)) {
      if (key === 'updated_at' || key === 'updated_by') continue;
      try { settings[key] = JSON.parse(value); }
      catch { settings[key] = value; }
    }
    return settings;
  },

  /**
   * Update control settings (key-value pairs)
   */
  async updateAll(updates) {
    if (!isFirestoreAvailable()) throw new Error('Firestore not available');

    const data = { ...updates, updated_at: timestamp(), updated_by: 'admin' };
    await db.collection('control_settings').doc('global').set(data, { merge: true });
    return { success: true };
  },

  /**
   * Get single setting value
   */
  async get(key) {
    const all = await this.getAll();
    return all[key] !== undefined ? all[key] : null;
  },

  /**
   * Set single setting
   */
  async set(key, value) {
    if (!isFirestoreAvailable()) throw new Error('Firestore not available');

    const strValue = typeof value === 'object' ? JSON.stringify(value) : String(value);
    await db.collection('control_settings').doc('global').set({
      [key]: strValue,
      updated_at: timestamp(),
      updated_by: 'admin',
    }, { merge: true });
    return { success: true };
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// ACTIVITY LOGS COLLECTION
// ═══════════════════════════════════════════════════════════════════════════

const activitiesService = {
  /**
   * Create activity log entry
   */
  async create(activityData) {
    if (!isFirestoreAvailable()) throw new Error('Firestore not available');

    const data = {
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
    };

    const docRef = await db.collection('activity_logs').add(data);
    return { id: docRef.id, ...data };
  },

  /**
   * Get activities with filters
   */
  async getActivities({ pc_name, student_id, session_id, limit = 100, offset = 0 } = {}) {
    if (!isFirestoreAvailable()) throw new Error('Firestore not available');

    let query = db.collection('activity_logs').orderBy('activity_at', 'desc');

    if (pc_name) query = query.where('pc_name', '==', pc_name);
    else if (student_id) query = query.where('student_id', '==', student_id);
    else if (session_id) query = query.where('session_id', '==', session_id);

    const snapshot = await query.limit(parseInt(limit) + parseInt(offset)).get();
    const docs = snapshot.docs.slice(parseInt(offset)).map(docToObject);
    return docs;
  },

  /**
   * Get activities by session
   */
  async getBySession(sessionId) {
    if (!isFirestoreAvailable()) throw new Error('Firestore not available');

    const snapshot = await db.collection('activity_logs')
      .where('session_id', '==', sessionId)
      .orderBy('activity_at', 'asc')
      .get();

    return snapshot.docs.map(docToObject);
  },

  /**
   * Get activities by student
   */
  async getByStudent(studentId, { limit = 100, offset = 0 } = {}) {
    if (!isFirestoreAvailable()) throw new Error('Firestore not available');

    const snapshot = await db.collection('activity_logs')
      .where('student_id', '==', studentId)
      .orderBy('activity_at', 'desc')
      .limit(parseInt(limit) + parseInt(offset))
      .get();

    return snapshot.docs.slice(parseInt(offset)).map(docToObject);
  },

  /**
   * Get activity stats
   */
  async getStats({ student_id, date_from, date_to } = {}) {
    if (!isFirestoreAvailable()) throw new Error('Firestore not available');

    let query = db.collection('activity_logs');

    if (student_id) {
      query = query.where('student_id', '==', student_id);
    }

    const snapshot = await query.get();
    let docs = snapshot.docs.map(d => d.data());

    // Filter by date in memory (Firestore limits multiple range queries)
    if (date_from) {
      const fromDate = new Date(date_from);
      docs = docs.filter(d => {
        const at = toDate(d.activity_at);
        return at && at >= fromDate;
      });
    }
    if (date_to) {
      const toDateVal = new Date(date_to);
      docs = docs.filter(d => {
        const at = toDate(d.activity_at);
        return at && at <= toDateVal;
      });
    }

    // Group by activity_type
    const stats = {};
    for (const doc of docs) {
      const type = doc.activity_type || 'unknown';
      if (!stats[type]) stats[type] = { activity_type: type, count: 0, total_duration: 0 };
      stats[type].count++;
      stats[type].total_duration += (doc.duration_seconds || 0);
    }

    return Object.values(stats);
  },

  /**
   * Get top visited sites
   */
  async getTopSites({ student_id, limit = 10, date_from, date_to } = {}) {
    if (!isFirestoreAvailable()) throw new Error('Firestore not available');

    let query = db.collection('activity_logs')
      .where('activity_type', '==', 'browser_url');

    if (student_id) {
      query = query.where('student_id', '==', student_id);
    }

    const snapshot = await query.get();
    const docs = filterActivityDocsByDate(snapshot.docs.map(d => d.data()), date_from, date_to);

    // Group by url_domain
    const domains = {};
    for (const doc of docs) {
      if (!doc.url_domain) continue;
      if (!domains[doc.url_domain]) {
        domains[doc.url_domain] = { url_domain: doc.url_domain, visit_count: 0, blocked_attempts: 0, blocked: false, last_visit: null };
      }
      domains[doc.url_domain].visit_count++;
      if (doc.blocked === true) {
        domains[doc.url_domain].blocked = true;
        domains[doc.url_domain].blocked_attempts++;
      }
      const at = toDate(doc.activity_at);
      if (!domains[doc.url_domain].last_visit || (at && at > domains[doc.url_domain].last_visit)) {
        domains[doc.url_domain].last_visit = at;
      }
    }

    return Object.values(domains)
      .sort((a, b) => b.visit_count - a.visit_count)
      .slice(0, parseInt(limit));
  },

  /**
   * Get top used apps
   */
  async getTopApps({ student_id, limit = 10, date_from, date_to } = {}) {
    if (!isFirestoreAvailable()) throw new Error('Firestore not available');

    let query = db.collection('activity_logs')
      .where('activity_type', '==', 'window_change');

    if (student_id) {
      query = query.where('student_id', '==', student_id);
    }

    const snapshot = await query.get();
    const docs = filterActivityDocsByDate(snapshot.docs.map(d => d.data()), date_from, date_to);

    // Group by process_name
    const apps = {};
    for (const doc of docs) {
      if (!doc.process_name) continue;
      if (!apps[doc.process_name]) {
        apps[doc.process_name] = { process_name: doc.process_name, usage_count: 0, total_duration: 0, last_used: null };
      }
      apps[doc.process_name].usage_count++;
      apps[doc.process_name].total_duration += (doc.duration_seconds || 0);
      const at = toDate(doc.activity_at);
      if (!apps[doc.process_name].last_used || (at && at > apps[doc.process_name].last_used)) {
        apps[doc.process_name].last_used = at;
      }
    }

    return Object.values(apps)
      .sort((a, b) => b.usage_count - a.usage_count)
      .slice(0, parseInt(limit));
  },

  /**
   * Aggregate activity counts into evenly sized time buckets for reports.
   */
  async getTimeline({ date_from, date_to, bucket_count = 7 } = {}) {
    if (!isFirestoreAvailable()) throw new Error('Firestore not available');

    const end = date_to ? new Date(date_to) : new Date();
    const start = date_from ? new Date(date_from) : new Date(end.getTime() - (24 * 60 * 60 * 1000));
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
      throw new Error('Invalid activity timeline date range');
    }

    const bucketCount = Math.min(24, Math.max(2, Number.parseInt(bucket_count, 10) || 7));
    const span = end.getTime() - start.getTime();
    const bucketMs = span / bucketCount;
    const snapshot = await db.collection('activity_logs').get();
    const docs = filterActivityDocsByDate(snapshot.docs.map((doc) => doc.data()), start, end);
    const counts = Array.from({ length: bucketCount }, () => 0);

    for (const doc of docs) {
      const at = toDate(doc.activity_at);
      const index = Math.min(bucketCount - 1, Math.floor((at.getTime() - start.getTime()) / bucketMs));
      if (index >= 0) counts[index] += 1;
    }

    return counts.map((activity_count, index) => ({
      start_at: new Date(start.getTime() + (index * bucketMs)).toISOString(),
      end_at: new Date(start.getTime() + ((index + 1) * bucketMs)).toISOString(),
      activity_count,
    }));
  },

  /**
   * Cleanup old activities
   */
  async cleanup(days = 30) {
    if (!isFirestoreAvailable()) throw new Error('Firestore not available');

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - parseInt(days));
    const cutoffTs = admin.firestore.Timestamp.fromDate(cutoff);

    const snapshot = await db.collection('activity_logs')
      .where('activity_at', '<', cutoffTs)
      .get();

    if (snapshot.empty) return 0;

    let deleted = 0;
    const docs = snapshot.docs;
    for (let i = 0; i < docs.length; i += 500) {
      const batch = db.batch();
      const chunk = docs.slice(i, i + 500);
      for (const doc of chunk) {
        batch.delete(doc.ref);
        deleted++;
      }
      await batch.commit();
    }
    return deleted;
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// CHAT MESSAGES COLLECTION
// ═══════════════════════════════════════════════════════════════════════════

const chatService = {
  /**
   * Create chat message entry
   */
  async create(messageData) {
    if (!isFirestoreAvailable()) throw new Error('Firestore not available');

    const data = {
      message_id: messageData.id || null,
      type: messageData.type || 'unknown', // 'admin_broadcast' | 'client_reply'
      from: messageData.from || null,
      pc_name: messageData.pc_name || null,
      student_name: messageData.student_name || null,
      message: messageData.message || '',
      delivered_to: messageData.delivered_to || null,
      timestamp: messageData.timestamp ? toTimestamp(messageData.timestamp) : timestamp(),
      created_at: timestamp(),
    };

    const docRef = await db.collection('chat_messages').add(data);
    return { id: docRef.id, ...data };
  },

  /**
   * Get recent chat messages (for loading history)
   */
  async getRecent(limit = 50) {
    if (!isFirestoreAvailable()) throw new Error('Firestore not available');

    const snapshot = await db.collection('chat_messages')
      .orderBy('created_at', 'desc')
      .limit(parseInt(limit))
      .get();

    return snapshot.docs.map(docToObject).reverse(); // oldest first
  },

  /**
   * Get chat messages for today
   */
  async getToday() {
    if (!isFirestoreAvailable()) throw new Error('Firestore not available');

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const snapshot = await db.collection('chat_messages')
      .where('created_at', '>=', admin.firestore.Timestamp.fromDate(startOfDay))
      .orderBy('created_at', 'asc')
      .get();

    return snapshot.docs.map(docToObject);
  },

  /**
   * Cleanup old chat messages (older than N days)
   */
  async cleanup(days = 7) {
    if (!isFirestoreAvailable()) throw new Error('Firestore not available');

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - parseInt(days));
    const cutoffTs = admin.firestore.Timestamp.fromDate(cutoff);

    const snapshot = await db.collection('chat_messages')
      .where('created_at', '<', cutoffTs)
      .get();

    if (snapshot.empty) return 0;

    let deleted = 0;
    const docs = snapshot.docs;
    for (let i = 0; i < docs.length; i += 500) {
      const batch = db.batch();
      const chunk = docs.slice(i, i + 500);
      for (const doc of chunk) {
        batch.delete(doc.ref);
        deleted++;
      }
      await batch.commit();
    }
    return deleted;
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

module.exports = {
  isFirestoreAvailable,
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
};
