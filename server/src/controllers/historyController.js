const firebaseService = require('../services/dataService');

// ── GET /api/sessions/history?date=YYYY-MM-DD&page=1&limit=50 ───
async function getHistory(req, res) {
  const { date, page = 1, limit = 50 } = req.query;

  try {
    const result = await firebaseService.sessions.getHistory({ date, page, limit });

    const history = result.data.map(r => {
      const loginTime = r.login_time?.toDate ? r.login_time.toDate() : (r.login_time ? new Date(r.login_time) : null);
      const logoutTime = r.logout_time?.toDate ? r.logout_time.toDate() : (r.logout_time ? new Date(r.logout_time) : null);

      // Calculate duration
      let durationMinutes = r.duration_minutes;
      if (!durationMinutes && loginTime) {
        const endTime = logoutTime || new Date();
        durationMinutes = Math.floor((endTime.getTime() - loginTime.getTime()) / 1000 / 60);
      }

      const h = Math.floor((durationMinutes || 0) / 60);
      const m = (durationMinutes || 0) % 60;
      const durStr = h > 0 ? `${h}j ${m}m` : `${m}m`;

      let sessionType = 'Selesai Normal';
      if (r.status === 'active') sessionType = 'Sedang Berlangsung';
      else if (r.status === 'force_ended') sessionType = 'Dipaksa Keluar (Admin)';

      return {
        id:         r.id,
        date:       loginTime ? loginTime.toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' }) : '-',
        pc:         r.pc_name,
        nis:        r.nis,
        name:       r.nama_lengkap,
        kelas:      r.kelas,
        login:      loginTime ? loginTime.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : '-',
        logout:     logoutTime
          ? logoutTime.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })
          : '-',
        duration:   durStr,
        type:       sessionType,
        status:     r.status,
      };
    });

    return res.json({ success: true, data: history, total: result.total, page: result.page, limit: result.limit });
  } catch (err) {
    console.error('[SESSIONS] getHistory error:', err);
    return res.status(500).json({ success: false, message: 'Gagal mengambil riwayat sesi.' });
  }
}

module.exports = { getHistory };
