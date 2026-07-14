const path = require('path');

const MAX_FILE_BYTES = 1024 * 1024;
const ALLOWED_STATUS = new Set(['delivered', 'opened', 'submitted', 'failed']);

function sanitizeFileName(value) {
  const base = path.basename(String(value || '').trim());
  const sanitized = base
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
    .replace(/\s+/g, ' ')
    .slice(0, 120);
  return sanitized || 'file-kelas';
}

function decodeDataUrl(value) {
  const match = String(value || '').match(/^data:([^;,]{1,120})?;base64,([A-Za-z0-9+/=]+)$/);
  if (!match) return null;

  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.length > MAX_FILE_BYTES) return null;

  return {
    mimeType: match[1] || 'application/octet-stream',
    bytes,
  };
}

function validateDistributionPayload(data = {}) {
  const decoded = decodeDataUrl(data.data);
  if (!decoded) {
    return { ok: false, error: `File tidak valid atau melebihi ${MAX_FILE_BYTES / 1024 / 1024} MB.` };
  }

  const id = String(data.id || '').trim();
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(id)) {
    return { ok: false, error: 'ID distribusi file tidak valid.' };
  }

  return {
    ok: true,
    payload: {
      id,
      name: sanitizeFileName(data.name),
      type: decoded.mimeType,
      size: decoded.bytes.length,
      data: `data:${decoded.mimeType};base64,${decoded.bytes.toString('base64')}`,
      sent_at: new Date().toISOString(),
    },
  };
}

function normalizeFileStatus(value) {
  const status = String(value || '').toLowerCase();
  return ALLOWED_STATUS.has(status) ? status : null;
}

module.exports = {
  MAX_FILE_BYTES,
  sanitizeFileName,
  validateDistributionPayload,
  normalizeFileStatus,
};
