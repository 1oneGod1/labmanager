const firebaseService = require('../services/dataService');
const { normalizeControlSettings } = require('../services/controlPolicyService');

// ── GET /api/control/settings ────────────────────────────────────
async function getSettings(_req, res) {
  try {
    const settings = normalizeControlSettings(await firebaseService.control.getAll());
    return res.json({ success: true, data: settings });
  } catch (err) {
    console.error('[CONTROL] getSettings error:', err);
    return res.status(500).json({ success: false, message: 'Gagal mengambil pengaturan.' });
  }
}

// ── POST /api/control/settings ───────────────────────────────────
// body: objek key-value pengaturan yang akan diupdate
async function updateSettings(req, res) {
  const updates = normalizeControlSettings(req.body, { partial: true });
  if (!updates || typeof updates !== 'object') {
    return res.status(400).json({ success: false, message: 'Body tidak valid.' });
  }
  if (!Object.keys(updates).length) {
    return res.status(400).json({ success: false, message: 'Tidak ada pengaturan valid untuk disimpan.' });
  }

  try {
    // Simpan nilai dalam format string agar kontrak pengaturan tetap konsisten.
    const data = {};
    for (const [key, value] of Object.entries(updates)) {
      data[key] = typeof value === 'object' ? JSON.stringify(value) : String(value);
    }
    await firebaseService.control.updateAll(data);
    const policy = normalizeControlSettings(await firebaseService.control.getAll());
    const io = req.app.get('realtimeHub');
    const pushedTo = io?.sockets?.adapter?.rooms?.get('clients-main')?.size || 0;
    io?.to('clients-main').emit('control:settings', policy);
    return res.json({
      success: true,
      message: 'Pengaturan berhasil disimpan dan dikirim ke client.',
      pushed_to: pushedTo,
      data: policy,
    });
  } catch (err) {
    console.error('[CONTROL] updateSettings error:', err);
    return res.status(500).json({ success: false, message: 'Gagal menyimpan pengaturan.' });
  }
}

module.exports = { getSettings, updateSettings };
