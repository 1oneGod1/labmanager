const crypto = require('crypto');

const MIN_REGISTRATION_KEY_LENGTH = 32;
const PAIRING_CODE_PATTERN = /^\d{6}$/;

function constantTimeEqual(left, right) {
  const leftDigest = crypto.createHash('sha256').update(String(left || ''), 'utf8').digest();
  const rightDigest = crypto.createHash('sha256').update(String(right || ''), 'utf8').digest();
  return crypto.timingSafeEqual(leftDigest, rightDigest);
}

function normalizePairingCode(value) {
  const text = String(value || '').trim();
  if (PAIRING_CODE_PATTERN.test(text)) return text;
  const digits = text.replace(/[\s-]/g, '');
  return PAIRING_CODE_PATTERN.test(digits) ? digits : '';
}

function authorizeRegistration({ configuredKey, configuredPairingCode, suppliedKey, isProduction }) {
  const key = typeof configuredKey === 'string' ? configuredKey : '';
  const pairingCode = normalizePairingCode(configuredPairingCode);

  if (isProduction && key.length < MIN_REGISTRATION_KEY_LENGTH) {
    return {
      ok: false,
      status: 503,
      message: `Kunci registrasi server wajib minimal ${MIN_REGISTRATION_KEY_LENGTH} karakter.`,
    };
  }

  const suppliedCode = normalizePairingCode(suppliedKey);
  const longKeyMatches = key && constantTimeEqual(suppliedKey, key);
  const shortCodeMatches = pairingCode && suppliedCode && constantTimeEqual(suppliedCode, pairingCode);

  if (key && !longKeyMatches && !shortCodeMatches) {
    return {
      ok: false,
      status: 403,
      message: 'Kode pairing PC tidak valid. Salin kode 6 digit terbaru dari menu Server di aplikasi Admin.',
    };
  }

  return { ok: true };
}

module.exports = {
  authorizeRegistration,
  normalizePairingCode,
  MIN_REGISTRATION_KEY_LENGTH,
  PAIRING_CODE_PATTERN,
};
