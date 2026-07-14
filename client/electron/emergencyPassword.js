const crypto = require('crypto');

// SHA-256 dari password darurat bawaan. Nilai plaintext tidak disimpan di
// renderer maupun file konfigurasi siswa.
const DEFAULT_EMERGENCY_PASSWORD_SHA256 = '940860015d5d5873b9421750d7c327f8f135237a27648d9685ac6dd848538b03';

function passwordDigest(password) {
  return crypto.createHash('sha256').update(password, 'utf8').digest();
}

function verifyEmergencyPassword(password, overridePassword = process.env.LABKOM_EMERGENCY_PASSWORD) {
  if (typeof password !== 'string' || !password) return false;

  const expected = overridePassword
    ? passwordDigest(overridePassword)
    : Buffer.from(DEFAULT_EMERGENCY_PASSWORD_SHA256, 'hex');
  const actual = passwordDigest(password);

  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

module.exports = {
  DEFAULT_EMERGENCY_PASSWORD_SHA256,
  verifyEmergencyPassword,
};
