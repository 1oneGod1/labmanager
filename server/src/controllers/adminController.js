const bcrypt = require('bcryptjs');
const {
  issueToken,
  validateToken,
  getTokenExpiry,
  rotateToken,
  revokeToken,
  TOKEN_TTL_MS,
} = require('../services/adminSessionService');
const { checkAllowed, registerFailure, clearFailures } = require('../services/adminRateLimitService');
const { logAdminAction } = require('../services/adminAuditService');
const dataService = require('../services/dataService');

// Hash bcrypt untuk password admin awal pada instalasi baru.
const DEFAULT_ADMIN_PASSWORD_HASH = '$2b$10$x7A71CHObExmQ7nqG0/pduYE1ye3TjjQqeMGa5qtWsA9q.ALnu6Te';

function getRequestIp(req) {
  // Express tidak dikonfigurasi trust proxy; jangan percaya X-Forwarded-For dari client.
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

function readAdminPassword() {
  return process.env.ADMIN_PASSWORD || DEFAULT_ADMIN_PASSWORD_HASH;
}

/**
 * Compare input password with admin password.
 * Supports both bcrypt hash ($2b$...) and plain-text in .env (backward compat).
 */
async function compareAdminPassword(input, stored) {
  if (stored.startsWith('$2b$') || stored.startsWith('$2a$')) {
    return bcrypt.compare(input, stored);
  }
  // Plain-text hanya ditoleransi saat development agar produksi wajib memakai bcrypt.
  if (process.env.NODE_ENV === 'production') return false;
  return input === stored;
}

// POST /api/admin/verify-password
async function verifyPassword(req, res) {
  const { password } = req.body;

  if (!password) {
    return res.status(400).json({ success: false, message: 'Password wajib diisi.' });
  }

  const adminPassword = readAdminPassword();
  if (!adminPassword) {
    return res.status(500).json({ success: false, message: 'Admin password belum dikonfigurasi di server.' });
  }

  const ipKey = getRequestIp(req);
  const rate = checkAllowed(ipKey);
  if (!rate.allowed) {
    return res.status(429).json({
      success: false,
      message: 'Terlalu banyak percobaan. Coba lagi nanti.',
    });
  }

  const match = await compareAdminPassword(password, adminPassword);
  if (match) {
    clearFailures(ipKey);
    console.log(`[ADMIN] Akses admin berhasil pada ${new Date().toLocaleString('id-ID')}`);
    logAdminAction(req, { action: 'ADMIN_VERIFY_PASSWORD', statusCode: 200, success: true }).catch(() => {});
    return res.status(200).json({ success: true, message: 'Password benar.' });
  }

  registerFailure(ipKey);
  console.warn(`[ADMIN] Percobaan akses admin gagal pada ${new Date().toLocaleString('id-ID')}`);
  logAdminAction(req, { action: 'ADMIN_VERIFY_PASSWORD', statusCode: 401, success: false }).catch(() => {});
  return res.status(401).json({ success: false, message: 'Password salah.' });
}

// POST /api/admin/login
async function login(req, res) {
  const { password } = req.body;
  if (!password) {
    return res.status(400).json({ success: false, message: 'Password wajib diisi.' });
  }

  const adminPassword = readAdminPassword();
  if (!adminPassword) {
    return res.status(500).json({ success: false, message: 'Admin password belum dikonfigurasi di server.' });
  }

  const ipKey = getRequestIp(req);
  const rate = checkAllowed(ipKey);
  if (!rate.allowed) {
    logAdminAction(req, {
      action: 'ADMIN_LOGIN_RATE_LIMITED',
      statusCode: 429,
      success: false,
      metadata: { ip: ipKey, retry_after_sec: rate.retryAfterSec },
    }).catch(() => {});
    return res.status(429).json({
      success: false,
      message: `Terlalu banyak percobaan login. Coba lagi dalam ${rate.retryAfterSec} detik.`,
    });
  }

  const match = await compareAdminPassword(password, adminPassword);
  if (!match) {
    registerFailure(ipKey);
    logAdminAction(req, {
      action: 'ADMIN_LOGIN',
      statusCode: 401,
      success: false,
      metadata: { ip: ipKey },
    }).catch(() => {});
    return res.status(401).json({ success: false, message: 'Password admin salah.' });
  }

  clearFailures(ipKey);
  const token = issueToken();
  logAdminAction(req, {
    action: 'ADMIN_LOGIN',
    statusCode: 200,
    success: true,
    metadata: { ip: ipKey, token_ttl_ms: TOKEN_TTL_MS },
  }).catch(() => {});
  return res.status(200).json({
    success: true,
    message: 'Login admin berhasil.',
    token,
    expires_in_ms: TOKEN_TTL_MS,
  });
}

// GET /api/admin/me
function me(req, res) {
  const authHeader = req.headers.authorization || '';
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  const token = match ? match[1] : null;

  if (!validateToken(token)) {
    logAdminAction(req, { action: 'ADMIN_ME', statusCode: 401, success: false }).catch(() => {});
    return res.status(401).json({ success: false, message: 'Token admin tidak valid.' });
  }

  return res.status(200).json({
    success: true,
    expires_at: getTokenExpiry(token),
  });
}

// POST /api/admin/logout
function logout(req, res) {
  const authHeader = req.headers.authorization || '';
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  const token = match ? match[1] : null;
  revokeToken(token);
  logAdminAction(req, { action: 'ADMIN_LOGOUT', statusCode: 200, success: true }).catch(() => {});
  return res.status(200).json({ success: true, message: 'Logout admin berhasil.' });
}

// POST /api/admin/refresh
function refreshToken(req, res) {
  const token = req.adminToken;
  const nextToken = rotateToken(token);
  if (!nextToken) {
    return res.status(401).json({ success: false, message: 'Token tidak valid atau kedaluwarsa.' });
  }
  logAdminAction(req, { action: 'ADMIN_REFRESH_TOKEN', statusCode: 200, success: true }).catch(() => {});
  return res.status(200).json({
    success: true,
    token: nextToken,
    expires_in_ms: TOKEN_TTL_MS,
  });
}

// ── Device Claim Management ─────────────────────────────────────
const clientTokenService = require('../services/clientTokenService');

function listDeviceClaims(_req, res) {
  res.json({ success: true, data: clientTokenService.listClaims() });
}

function revokeDeviceClaim(req, res) {
  const { pc_name } = req.body || {};
  if (!pc_name) {
    return res.status(400).json({ success: false, message: 'pc_name wajib diisi.' });
  }
  const removed = clientTokenService.revokePcClaim(pc_name);
  if (!removed) {
    return res.status(404).json({ success: false, message: 'Claim untuk PC tersebut tidak ditemukan.' });
  }
  res.json({ success: true, message: `Claim untuk ${pc_name} telah dihapus. Device akan otomatis register ulang.` });
}

// GET /api/admin/storage/status
function storageStatus(_req, res) {
  try {
    return res.json({ success: true, data: dataService.getStorageStatus() });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: `Status penyimpanan tidak dapat dibaca: ${error.message}`,
    });
  }
}

// POST /api/admin/storage/backup
async function createStorageBackup(req, res) {
  try {
    const backup = await dataService.createBackup('manual');
    logAdminAction(req, {
      action: 'ADMIN_CREATE_LOCAL_BACKUP',
      statusCode: 201,
      success: true,
      metadata: { size_bytes: backup.size_bytes },
    }).catch(() => {});
    return res.status(201).json({
      success: true,
      message: 'Backup database lokal berhasil dibuat.',
      data: backup,
    });
  } catch (error) {
    logAdminAction(req, {
      action: 'ADMIN_CREATE_LOCAL_BACKUP',
      statusCode: 500,
      success: false,
    }).catch(() => {});
    return res.status(500).json({
      success: false,
      message: `Backup gagal dibuat: ${error.message}`,
    });
  }
}

// GET /api/admin/pairing-key
function getPairingKey(_req, res) {
  const pairingKey = String(process.env.CLIENT_REGISTRATION_KEY || '').trim();
  if (pairingKey.length < 32) {
    return res.status(503).json({
      success: false,
      message: 'Kunci pairing belum tersedia. Buka ulang aplikasi Admin untuk membuatnya.',
    });
  }
  return res.json({ success: true, data: { pairing_key: pairingKey } });
}

module.exports = {
  verifyPassword,
  login,
  me,
  logout,
  refreshToken,
  listDeviceClaims,
  revokeDeviceClaim,
  storageStatus,
  createStorageBackup,
  getPairingKey,
  compareAdminPassword,
  DEFAULT_ADMIN_PASSWORD_HASH,
};
