const dataService = require('../services/dataService');
const { DEFAULT_BRANDING, sanitizeBranding, toPublicBranding } = require('../services/brandingService');
const { logAdminAction } = require('../services/adminAuditService');

async function readBranding() {
  const stored = await dataService.branding.get();
  return toPublicBranding(stored || DEFAULT_BRANDING);
}

async function getBranding(_req, res) {
  try {
    return res.json({ success: true, data: await readBranding() });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Identitas aplikasi tidak dapat dibaca.' });
  }
}

async function updateBranding(req, res) {
  try {
    const current = await readBranding();
    const next = sanitizeBranding(req.body || {}, current);
    const stored = await dataService.branding.update(next);
    const publicBranding = toPublicBranding(stored);
    req.app.get('realtimeHub')?.emit('branding:updated', publicBranding);
    logAdminAction(req, {
      action: 'ADMIN_UPDATE_BRANDING',
      statusCode: 200,
      success: true,
      metadata: {
        product_name: publicBranding.product_name,
        school_name: publicBranding.school_name,
        has_logo: Boolean(publicBranding.logo_data_url),
      },
    }).catch(() => {});
    return res.json({ success: true, message: 'Identitas aplikasi berhasil disimpan.', data: publicBranding });
  } catch (error) {
    logAdminAction(req, { action: 'ADMIN_UPDATE_BRANDING', statusCode: 400, success: false }).catch(() => {});
    return res.status(400).json({ success: false, message: error.message || 'Identitas aplikasi tidak valid.' });
  }
}

module.exports = { getBranding, updateBranding, readBranding };
