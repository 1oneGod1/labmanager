const firebaseService = require('../services/dataService');

// ── POST /api/checks ──────────────────────────────────────────────────────
// Catat hasil checklist fasilitas dari klien (pre atau post sesi)
async function submitCheck(req, res) {
  const {
    session_id, nis, nama_lengkap, pc_name, check_type,
    // Pre-check
    cpu_status, cpu_note,
    monitor_status, monitor_note,
    keyboard_status, keyboard_note,
    mouse_status, mouse_note,
    headset_status, headset_note,
    desk_status, desk_note,
    // Post-check
    hw_status, hw_note,
    cleanliness_status, cleanliness_note,
    account_status, account_note,
    system_status, system_note,
    file_status, file_note,
  } = req.body;

  if (!nis || !nama_lengkap || !pc_name || !check_type) {
    return res.status(400).json({ success: false, message: 'Field wajib tidak lengkap.' });
  }
  if (!['pre', 'post'].includes(check_type)) {
    return res.status(400).json({ success: false, message: 'check_type harus pre atau post.' });
  }

  try {
    const claimedPcName = req.actor?.role === 'client' ? req.actor.pc_name : pc_name;
    if (req.actor?.role === 'client' && session_id) {
      const session = await firebaseService.sessions.getById(session_id);
      const ownsSession = session && (session.device_id
        ? session.device_id === req.actor.device_id
        : [session.pc_name, session.actual_pc_name].some((name) => String(name || '').toUpperCase() === claimedPcName));
      if (!ownsSession) {
        return res.status(403).json({ success: false, message: 'Sesi checklist bukan milik perangkat ini.' });
      }
    }

    const result = await firebaseService.checks.create({
      session_id, nis, nama_lengkap, pc_name: claimedPcName, check_type,
      cpu_status, cpu_note,
      monitor_status, monitor_note,
      keyboard_status, keyboard_note,
      mouse_status, mouse_note,
      headset_status, headset_note,
      desk_status, desk_note,
      hw_status, hw_note,
      cleanliness_status, cleanliness_note,
      account_status, account_note,
      system_status, system_note,
      file_status, file_note,
    });

    res.json({ success: true, id: result.id, message: 'Checklist berhasil dicatat.' });
  } catch (err) {
    console.error('[CHECKS] submitCheck error:', err);
    res.status(500).json({ success: false, message: 'Gagal menyimpan checklist.' });
  }
}

// ── GET /api/checks?date=YYYY-MM-DD&type=pre|post&page=1&limit=50 ──────────
// Ambil log pengecekan untuk Admin Dashboard
async function getChecks(req, res) {
  const { date, type, pc, page = 1, limit = 50 } = req.query;

  try {
    const result = await firebaseService.checks.getChecks({ date, type, pc, page, limit });

    res.json({
      success: true,
      data:  result.data,
      total: result.total,
      page:  result.page,
      limit: result.limit,
    });
  } catch (err) {
    console.error('[CHECKS] getChecks error:', err);
    res.status(500).json({ success: false, message: 'Gagal mengambil data checklist.' });
  }
}

// ── GET /api/checks/summary?date=YYYY-MM-DD ───────────────────────────────
// Ringkasan jumlah issue per PC untuk banner di dashboard
async function getChecksSummary(req, res) {
  const { date } = req.query;

  try {
    const rows = await firebaseService.checks.getSummary({ date });
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Gagal mengambil ringkasan.' });
  }
}

module.exports = { submitCheck, getChecks, getChecksSummary };
