const test = require('node:test');
const assert = require('node:assert/strict');

const {
  authorizeRegistration,
  normalizePairingCode,
  MIN_REGISTRATION_KEY_LENGTH,
} = require('../src/services/registrationKeyService');

test('production requires a registration key of at least 32 characters', () => {
  const missing = authorizeRegistration({
    configuredKey: '',
    suppliedKey: '',
    isProduction: true,
  });
  assert.equal(missing.ok, false);
  assert.equal(missing.status, 503);

  const tooShort = authorizeRegistration({
    configuredKey: 'short-key',
    suppliedKey: 'short-key',
    isProduction: true,
  });
  assert.equal(tooShort.ok, false);
  assert.equal(tooShort.status, 503);
});

test('configured registration key must match exactly', () => {
  const configuredKey = 'a'.repeat(MIN_REGISTRATION_KEY_LENGTH);

  const rejected = authorizeRegistration({
    configuredKey,
    suppliedKey: `${configuredKey}x`,
    isProduction: true,
  });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.status, 403);

  const accepted = authorizeRegistration({
    configuredKey,
    suppliedKey: configuredKey,
    isProduction: true,
  });
  assert.deepEqual(accepted, { ok: true });
});

test('six digit pairing code is accepted with copy-friendly formatting', () => {
  const configuredKey = 'b'.repeat(MIN_REGISTRATION_KEY_LENGTH);
  for (const suppliedKey of ['042731', '042 731', '042-731']) {
    assert.deepEqual(authorizeRegistration({
      configuredKey,
      configuredPairingCode: '042731',
      suppliedKey,
      isProduction: true,
    }), { ok: true });
  }
  assert.equal(normalizePairingCode(' 042-731 '), '042731');

  const rejected = authorizeRegistration({
    configuredKey,
    configuredPairingCode: '042731',
    suppliedKey: '042732',
    isProduction: true,
  });
  assert.equal(rejected.status, 403);
  assert.match(rejected.message, /6 digit/i);
});
test('development may run without a registration key', () => {
  assert.deepEqual(authorizeRegistration({
    configuredKey: '',
    suppliedKey: '',
    isProduction: false,
  }), { ok: true });
});
