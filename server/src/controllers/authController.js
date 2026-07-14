const bcrypt     = require('bcryptjs');
const os         = require('os');
const firebaseService = require('../services/firebaseService');
const { getClientRegistry, normalizePcName } = require('../services/clientRegistryService');
const { resolveMappedLabPc } = require('../services/labComputerService');
const clientTokenService = require('../services/clientTokenService');
const { authorizeRegistration } = require('../services/registrationKeyService');

const loginLocks = new Set();

// POST /api/auth/device-register
function deviceRegister(req, res) {
  const { device_id, pc_name } = req.body || {};
  const authorization = authorizeRegistration({
    configuredKey: process.env.CLIENT_REGISTRATION_KEY,
    suppliedKey: req.headers['x-labkom-registration-key'],
    isProduction: process.env.NODE_ENV === 'production',
  });
  if (!authorization.ok) {
    return res.status(authorization.status).json({ success: false, message: authorization.message });
  }
  const result = clientTokenService.issueToken({ device_id, pc_name });
  if (!result.ok) {
    return res.status(409).json({ success: false, message: result.message });
  }
  res.json({ success: true, data: { token: result.token } });
}

// POST /api/auth/login
async function login(req, res) {
  const { nis, password } = req.body;

  if (!nis || !password) {
    return res.status(400).json({ success: false, message: 'NIS dan password wajib diisi.' });
  }

  try {
    // 1. Cari siswa berdasarkan NIS
    const student = await firebaseService.students.getByNis(nis);

    if (!student) {
      return res.status(401).json({ success: false, message: 'NIS tidak ditemukan.' });
    }

    // 2. Cek apakah akun aktif
    if (!student.is_active) {
      return res.status(403).json({ success: false, message: 'Akun siswa tidak aktif.' });
    }

    // 3. Verifikasi password sebelum mengubah sesi apa pun.
    // Urutan ini mencegah request ber-password salah menutup sesi PC lain.
    const passwordValid = await bcrypt.compare(password, student.password_hash);
    if (!passwordValid) {
      return res.status(401).json({ success: false, message: 'Password salah.' });
    }

    if (loginLocks.has(student.id)) {
      return res.status(409).json({ success: false, message: 'Login siswa sedang diproses. Silakan coba lagi.' });
    }
    loginLocks.add(student.id);
    try {
    // 4. Identitas PC selalu berasal dari token perangkat, bukan payload renderer.
    const reportedPcName = normalizePcName(req.actor?.pc_name || os.hostname());
    const presenceEntry = getClientRegistry().find(
      (entry) => normalizePcName(entry.pc_name) === reportedPcName
    );
    const mappedLabPc = await resolveMappedLabPc({
      pc_name: reportedPcName,
      mac: presenceEntry?.mac || null,
    });
    const pcName = mappedLabPc?.pc_name || reportedPcName;
    const cleanupPcNames = Array.from(new Set([reportedPcName, pcName].filter(Boolean)));
    await firebaseService.sessions.closeActiveByPcNames(cleanupPcNames);

    // 5. Cek apakah akun ini masih aktif di PC LAIN
    const activeSession = await firebaseService.sessions.getActiveByStudentId(student.id);

    if (activeSession) {
      return res.status(409).json({
        success: false,
        message: `Akun ini masih aktif di ${activeSession.pc_name}. Hubungi guru untuk logout paksa.`,
      });
    }

    // 6. Buat session baru
    const session = await firebaseService.sessions.create({
      student_id: student.id,
      pc_name: pcName,
      actual_pc_name: reportedPcName,
      device_id: req.actor.device_id,
      nis: student.nis,
      nama_lengkap: student.nama_lengkap,
      kelas: student.kelas,
    });

    return res.status(200).json({
      success: true,
      message: `Selamat datang, ${student.nama_lengkap}!`,
      data: {
        session_id:   session.id,
        student_id:   student.id,
        nis:          student.nis,
        nama_lengkap: student.nama_lengkap,
        kelas:        student.kelas,
        pc_name:      pcName,
        actual_pc_name: reportedPcName,
      },
    });
    } finally {
      loginLocks.delete(student.id);
    }

  } catch (err) {
    console.error('[LOGIN ERROR]', err);
    return res.status(500).json({ success: false, message: 'Terjadi kesalahan server.' });
  }
}

// POST /api/auth/logout
async function logout(req, res) {
  const { session_id } = req.body;

  if (!session_id) {
    return res.status(400).json({ success: false, message: 'session_id wajib diisi.' });
  }

  try {
    const session = await firebaseService.sessions.getById(session_id);
    if (!session || session.status !== 'active') {
      return res.status(404).json({ success: false, message: 'Sesi tidak ditemukan atau sudah selesai.' });
    }
    const ownsSession = session.device_id
      ? session.device_id === req.actor?.device_id
      : [session.pc_name, session.actual_pc_name].some((name) =>
          normalizePcName(name) === normalizePcName(req.actor?.pc_name));
    if (!ownsSession) {
      return res.status(403).json({ success: false, message: 'Sesi bukan milik perangkat ini.' });
    }

    const result = await firebaseService.sessions.endSession(session_id, 'finished');

    if (!result) {
      return res.status(404).json({ success: false, message: 'Sesi tidak ditemukan atau sudah selesai.' });
    }

    return res.status(200).json({ success: true, message: 'Logout berhasil.' });

  } catch (err) {
    console.error('[LOGOUT ERROR]', err);
    return res.status(500).json({ success: false, message: 'Terjadi kesalahan server.' });
  }
}

// POST /api/auth/force-logout — paksa logout by student_id (untuk guru/admin)
async function forceLogout(req, res) {
  const { student_id, pc_name } = req.body;

  if (!student_id && !pc_name) {
    return res.status(400).json({ success: false, message: 'student_id atau pc_name wajib diisi.' });
  }

  try {
    let affected = 0;
    if (student_id) {
      affected = await firebaseService.sessions.forceLogoutByStudentId(student_id);
    } else {
      affected = await firebaseService.sessions.forceLogoutByPcName(pc_name);
    }
    return res.status(200).json({
      success: true,
      message: `${affected} sesi berhasil di-logout paksa.`,
    });
  } catch (err) {
    console.error('[FORCE LOGOUT ERROR]', err);
    return res.status(500).json({ success: false, message: 'Terjadi kesalahan server.' });
  }
}

// GET /api/auth/status/:nis — cek real-time apakah siswa sedang login
async function checkStatus(req, res) {
  const { nis } = req.params;
  try {
    const student = await firebaseService.students.getByNis(nis);
    if (!student) {
      return res.status(200).json({ success: true, is_online: false });
    }

    const activeSession = await firebaseService.sessions.getActiveByStudentId(student.id);
    if (!activeSession) {
      return res.status(200).json({ success: true, is_online: false });
    }

    return res.status(200).json({
      success:    true,
      is_online:  true,
      session: {
        id: activeSession.id,
        pc_name: activeSession.pc_name,
        login_time: activeSession.login_time,
        status: activeSession.status,
      },
    });
  } catch (err) {
    console.error('[CHECK STATUS ERROR]', err);
    return res.status(500).json({ success: false, message: 'Terjadi kesalahan server.' });
  }
}

module.exports = { login, logout, forceLogout, checkStatus, deviceRegister };
