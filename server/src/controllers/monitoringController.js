const firebaseService = require('../services/dataService');
const {
  normalizePcName,
  normalizeMac,
  getClientRegistry,
} = require('../services/clientRegistryService');
const {
  getLabComputers,
  assignDeviceToLabComputer,
  clearDeviceMapping,
} = require('../services/labComputerService');

function formatDuration(minutes) {
  if (!minutes || minutes < 0) return '0m';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}j` : `${h}j ${m}m`;
}

function toLocaleTime(value) {
  if (!value) return null;
  // Handle Firestore Timestamps
  const date = value.toDate ? value.toDate() : new Date(value);
  return date.toLocaleTimeString('id-ID', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function buildPcCard({
  pcName,
  label = null,
  session = null,
  presence = null,
  binding = null,
  isUnmapped = false,
}) {
  const online = Boolean(presence?.is_online);
  const sleeping = presence?.power_state === 'sleeping';
  let status = 'offline';
  if (sleeping) status = 'sleeping';
  else if (session && online) status = 'active';
  else if (online) status = 'locked';

  const boundHostname = normalizePcName(binding?.bound_hostname) || null;
  const boundMac = normalizeMac(binding?.bound_mac) || null;
  const actualPcName =
    presence?.pc_name ||
    (session?.pc_name && normalizePcName(session.pc_name) !== normalizePcName(pcName) ? session.pc_name : null) ||
    boundHostname ||
    pcName;

  // Calculate duration if session is active
  let durationMinutes = session?.duration_minutes || 0;
  if (session && !durationMinutes && session.login_time) {
    const loginTime = session.login_time.toDate ? session.login_time.toDate() : new Date(session.login_time);
    durationMinutes = Math.floor((Date.now() - loginTime.getTime()) / 1000 / 60);
  }

  return {
    id: pcName,
    label,
    status,
    is_unmapped: isUnmapped,
    actual_pc_name: actualPcName,
    ip: presence?.ip || binding?.last_known_ip || null,
    mac: presence?.mac || boundMac || null,
    last_seen: presence?.last_seen || null,
    is_online: online,
    power_state: presence?.power_state || 'awake',
    power_state_changed_at: presence?.power_state_changed_at || null,
    session_state: presence?.session_state || (session ? 'active' : 'login'),
    binding_hostname: boundHostname,
    binding_mac: boundMac,
    binding_ip: binding?.last_known_ip || null,
    mapped_at: binding?.mapped_at || null,
    student: session
      ? {
          id: session.student_id,
          nis: session.nis,
          name: session.nama_lengkap,
          kelas: session.kelas,
        }
      : null,
    loginTime: toLocaleTime(session?.login_time),
    duration: formatDuration(durationMinutes),
    session_id: session?.id || session?.session_id || null,
  };
}

async function getPcs(_req, res) {
  try {
    const labRows = await getLabComputers();

    // Get active sessions from Firebase
    const sessionRows = await firebaseService.sessions.getActive();

    const presenceRows = getClientRegistry();
    const sessionByPc = new Map(sessionRows.map((row) => [normalizePcName(row.pc_name), row]));
    const presenceByPc = new Map(presenceRows.map((row) => [normalizePcName(row.pc_name), row]));
    const presenceByMac = new Map(
      presenceRows
        .filter((row) => row.mac)
        .map((row) => [normalizeMac(row.mac), row])
    );
    const consumedSessionKeys = new Set();
    const consumedPresenceKeys = new Set();
    const knownPcNames = new Set();

    const pcs = labRows.map((row) => {
      const normalizedPcName = normalizePcName(row.pc_name);
      knownPcNames.add(normalizedPcName);

      let session = sessionByPc.get(normalizedPcName) || null;
      if (!session && row.bound_hostname) {
        session = sessionByPc.get(normalizePcName(row.bound_hostname)) || null;
      }

      let presence = presenceByPc.get(normalizedPcName) || null;
      if (!presence && row.bound_hostname) {
        presence = presenceByPc.get(normalizePcName(row.bound_hostname)) || null;
      }
      if (!presence && row.bound_mac) {
        presence = presenceByMac.get(normalizeMac(row.bound_mac)) || null;
      }

      if (session) consumedSessionKeys.add(normalizePcName(session.pc_name));
      if (presence) consumedPresenceKeys.add(normalizePcName(presence.pc_name));

      return buildPcCard({
        pcName: row.pc_name,
        label: row.label,
        session,
        presence,
        binding: row,
      });
    });

    for (const session of sessionRows) {
      const normalizedPcName = normalizePcName(session.pc_name);
      if (knownPcNames.has(normalizedPcName) || consumedSessionKeys.has(normalizedPcName)) continue;

      const presence = presenceByPc.get(normalizedPcName) || null;
      if (presence) consumedPresenceKeys.add(normalizePcName(presence.pc_name));

      pcs.push(buildPcCard({
        pcName: session.pc_name,
        label: 'Client Tidak Dipetakan',
        session,
        presence,
        isUnmapped: true,
      }));
      knownPcNames.add(normalizedPcName);
    }

    for (const presence of presenceRows) {
      const normalizedPcName = normalizePcName(presence.pc_name);
      if (knownPcNames.has(normalizedPcName)) continue;
      if (consumedPresenceKeys.has(normalizedPcName)) continue;
      if (!presence.is_online) continue;

      pcs.push(buildPcCard({
        pcName: presence.pc_name,
        label: 'Client Tidak Dipetakan',
        presence,
        isUnmapped: true,
      }));
      knownPcNames.add(normalizedPcName);
    }

    pcs.sort((a, b) => {
      if (a.is_unmapped !== b.is_unmapped) return a.is_unmapped ? 1 : -1;
      return a.id.localeCompare(b.id);
    });

    return res.json({ success: true, data: pcs });
  } catch (err) {
    console.error('[MONITORING] getPcs error:', err);
    return res.status(500).json({ success: false, message: 'Gagal mengambil data monitoring.' });
  }
}

async function mapDevice(req, res) {
  const {
    target_pc_name,
    source_pc_name,
    source_mac,
    source_ip,
  } = req.body || {};

  try {
    const row = await assignDeviceToLabComputer({
      target_pc_name,
      source_pc_name,
      source_mac,
      source_ip,
    });

    return res.json({
      success: true,
      message: `Perangkat ${source_pc_name || source_mac} dipetakan ke ${row.pc_name}.`,
      data: row,
    });
  } catch (err) {
    const status = /wajib|tidak ditemukan/i.test(err.message) ? 400 : 500;
    if (status === 500) {
      console.error('[MONITORING] mapDevice error:', err);
    }
    return res.status(status).json({
      success: false,
      message: err.message || 'Gagal memetakan perangkat.',
    });
  }
}

async function clearMapping(req, res) {
  const { target_pc_name } = req.body || {};

  try {
    const row = await clearDeviceMapping(target_pc_name);
    return res.json({
      success: true,
      message: `Mapping perangkat untuk ${row?.pc_name || target_pc_name} dilepas.`,
      data: row,
    });
  } catch (err) {
    const status = /wajib/i.test(err.message) ? 400 : 500;
    if (status === 500) {
      console.error('[MONITORING] clearMapping error:', err);
    }
    return res.status(status).json({
      success: false,
      message: err.message || 'Gagal melepas mapping perangkat.',
    });
  }
}

async function forceLogoutPc(req, res) {
  const { pc_name } = req.body;
  if (!pc_name) return res.status(400).json({ success: false, message: 'pc_name wajib diisi.' });

  try {
    const affected = await firebaseService.sessions.forceLogoutByPcName(pc_name);
    const normalizedPcName = normalizePcName(pc_name);
    const io = req.app.get('realtimeHub');
    if (normalizedPcName) {
      io?.to(`client:${normalizedPcName}`).emit('session:force-logout', {
        reason: 'Sesi dihentikan oleh Admin.',
        requested_at: Date.now(),
      });
    }

    return res.json({
      success: true,
      message: affected > 0
        ? `Sesi di ${pc_name} berhasil dihentikan.`
        : `Tidak ada sesi aktif di ${pc_name}.`,
      affected,
      notified: Boolean(normalizedPcName),
    });
  } catch (err) {
    console.error('[MONITORING] forceLogoutPc error:', err);
    return res.status(500).json({ success: false, message: 'Gagal force logout.' });
  }
}

async function forceLogoutAll(req, res) {
  try {
    const affected = await firebaseService.sessions.forceLogoutAll();
    const io = req.app.get('realtimeHub');
    const notified = io?.sockets?.adapter?.rooms?.get('clients-renderer')?.size || 0;
    io?.to('clients-renderer').emit('session:force-logout', {
      reason: 'Semua sesi dihentikan oleh Admin.',
      requested_at: Date.now(),
    });
    return res.json({
      success: true,
      message: `${affected} sesi aktif dihentikan.`,
      affected,
      notified,
    });
  } catch (err) {
    console.error('[MONITORING] forceLogoutAll error:', err);
    return res.status(500).json({ success: false, message: 'Gagal force logout semua.' });
  }
}

module.exports = {
  getPcs,
  mapDevice,
  clearMapping,
  forceLogoutPc,
  forceLogoutAll,
  buildPcCard,
};
