const clientTokenService = require('../services/clientTokenService');
const { validateToken: validateAdminToken } = require('../services/adminSessionService');

/**
 * Middleware: butuh client token (Bearer) ATAU admin token.
 * Admin token lulus juga supaya endpoint sama bisa dipanggil dari dashboard
 * (mis. cleanup/test). Reject kalau dua-duanya invalid.
 */
function requireClient(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  const token = match ? match[1] : null;

  if (!token) {
    return res.status(401).json({ success: false, message: 'Token client/admin diperlukan.' });
  }

  // Admin token lulus
  if (validateAdminToken(token)) {
    req.actor = { role: 'admin' };
    return next();
  }

  // Client token
  const claim = clientTokenService.validateToken(token);
  if (!claim) {
    return res.status(401).json({ success: false, message: 'Token client invalid atau telah dicabut.' });
  }

  req.actor = { role: 'client', device_id: claim.device_id, pc_name: claim.pc_name };
  return next();
}

/**
 * Middleware khusus endpoint milik PC siswa. Berbeda dengan requireClient,
 * token admin tidak diterima agar identitas PC selalu tersedia dan dapat
 * digunakan untuk membatasi akses ke resource milik perangkat tersebut.
 */
function requireDevice(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  const token = match ? match[1] : null;
  const claim = clientTokenService.validateToken(token);

  if (!claim) {
    return res.status(401).json({ success: false, message: 'Token perangkat invalid atau telah dicabut.' });
  }

  req.actor = { role: 'client', device_id: claim.device_id, pc_name: claim.pc_name };
  return next();
}

module.exports = { requireClient, requireDevice };
