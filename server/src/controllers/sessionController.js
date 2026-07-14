const firebaseService = require('../services/dataService');

// GET /api/sessions — semua sesi (untuk dashboard admin)
async function getAllSessions(req, res) {
  try {
    const rows = await firebaseService.sessions.getAll(100);
    const data = rows.map(r => ({
      id: r.id,
      pc_name: r.pc_name,
      login_time: r.login_time,
      logout_time: r.logout_time,
      status: r.status,
      nis: r.nis,
      nama_lengkap: r.nama_lengkap,
      kelas: r.kelas,
    }));
    return res.status(200).json({ success: true, data });
  } catch (err) {
    console.error('[GET SESSIONS ERROR]', err);
    return res.status(500).json({ success: false, message: 'Terjadi kesalahan server.' });
  }
}

// GET /api/sessions/active — hanya sesi yang sedang aktif
async function getActiveSessions(req, res) {
  try {
    const rows = await firebaseService.sessions.getActive();
    const data = rows.map(r => ({
      id: r.id,
      pc_name: r.pc_name,
      login_time: r.login_time,
      nis: r.nis,
      nama_lengkap: r.nama_lengkap,
      kelas: r.kelas,
    }));
    return res.status(200).json({ success: true, data });
  } catch (err) {
    console.error('[GET ACTIVE SESSIONS ERROR]', err);
    return res.status(500).json({ success: false, message: 'Terjadi kesalahan server.' });
  }
}

module.exports = { getAllSessions, getActiveSessions };
