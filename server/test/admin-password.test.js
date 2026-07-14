const test = require('node:test');
const assert = require('node:assert/strict');
const {
  compareAdminPassword,
  DEFAULT_ADMIN_PASSWORD_HASH,
} = require('../src/controllers/adminController');

test('default admin password accepts kepalalab123', async () => {
  assert.equal(await compareAdminPassword('kepalalab123', DEFAULT_ADMIN_PASSWORD_HASH), true);
});

test('default admin password rejects an incorrect password', async () => {
  assert.equal(await compareAdminPassword('password-salah', DEFAULT_ADMIN_PASSWORD_HASH), false);
});
