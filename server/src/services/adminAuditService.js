const dataService = require('./dataService');

function getIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.trim()) {
    return xff.split(',')[0].trim();
  }
  return req.ip || req.socket?.remoteAddress || null;
}

async function logAdminAction(req, payload = {}) {
  const {
    action = `${req.method} ${req.originalUrl}`,
    statusCode = null,
    success = null,
    metadata = null,
  } = payload;

  try {
    if (!dataService.isStorageAvailable()) {
      console.warn('[AUDIT] Penyimpanan tidak tersedia, log audit dilewati.');
      return;
    }

    if (!dataService.audit?.create) {
      console.warn('[AUDIT] Provider penyimpanan tidak mendukung audit log.');
      return;
    }

    await dataService.audit.create({
      action,
      method: req.method,
      path: req.originalUrl,
      status_code: statusCode,
      success,
      ip_address: getIp(req),
      user_agent: req.headers['user-agent'] || null,
      metadata: metadata || null,
      created_at: new Date(),
    });
  } catch (err) {
    console.warn('[AUDIT] Gagal simpan log admin:', err.message);
  }
}

module.exports = { logAdminAction };
