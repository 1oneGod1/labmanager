const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'labkom-client-auth-'));
process.env.LABKOM_DATABASE_FILE = path.join(testDataDir, 'labkom.db');
process.env.CLIENT_TOKEN_SECRET = 'test-client-token-secret-0123456789abcdef';

const clientTokens = require('../src/services/clientTokenService');
const dataService = require('../src/services/dataService');
const { requireDevice } = require('../src/middleware/requireClient');
const adminSessions = require('../src/services/adminSessionService');

function responseRecorder() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

test.after(async () => {
  await dataService.shutdown({ backup: false });
  fs.rmSync(testDataDir, { recursive: true, force: true });
});

test('device registration validates identifiers and prevents a second device claiming a PC', () => {
  assert.equal(clientTokens.issueToken({ device_id: 'bad', pc_name: 'PC-01' }).ok, false);

  const first = clientTokens.issueToken({
    device_id: '11111111111111111111111111111111',
    pc_name: 'PC-TEST-01',
  });
  assert.equal(first.ok, true);
  assert.equal(clientTokens.validateToken(first.token).pc_name, 'PC-TEST-01');

  const conflict = clientTokens.issueToken({
    device_id: '22222222222222222222222222222222',
    pc_name: 'PC-TEST-01',
  });
  assert.equal(conflict.ok, false);
});

test('concurrent registration for the same device returns the same durable token', () => {
  const identity = {
    device_id: '22222222222222222222222222222222',
    pc_name: 'PC-TEST-CONCURRENT',
  };
  const first = clientTokens.issueToken(identity);
  const second = clientTokens.issueToken(identity);

  assert.equal(first.ok, true);
  assert.equal(second.token, first.token);
  assert.equal(clientTokens.listClaims().find((claim) => claim.pc_name === identity.pc_name).expires_at, null);
});

test('signed device token remains valid after the backend database is closed and reopened', async () => {
  const issued = clientTokens.issueToken({
    device_id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    pc_name: 'PC-TEST-PERSIST',
  });
  assert.equal(issued.ok, true);

  await dataService.shutdown({ backup: false });
  dataService.initialize({ scheduleBackups: false });

  const modulePath = require.resolve('../src/services/clientTokenService');
  delete require.cache[modulePath];
  const reloadedTokens = require('../src/services/clientTokenService');
  assert.equal(reloadedTokens.validateToken(issued.token).pc_name, 'PC-TEST-PERSIST');
});

test('requireDevice binds actor identity to the token claim', () => {
  const issued = clientTokens.issueToken({
    device_id: '33333333333333333333333333333333',
    pc_name: 'pc-test-02',
  });
  const req = { headers: { authorization: `Bearer ${issued.token}` } };
  const res = responseRecorder();
  let called = false;

  requireDevice(req, res, () => { called = true; });

  assert.equal(called, true);
  assert.deepEqual(req.actor, {
    role: 'client',
    device_id: '33333333333333333333333333333333',
    pc_name: 'PC-TEST-02',
  });
});

test('requireDevice rejects invalid or tampered tokens', () => {
  const req = { headers: { authorization: 'Bearer invalid' } };
  const res = responseRecorder();
  let called = false;

  requireDevice(req, res, () => { called = true; });

  assert.equal(called, false);
  assert.equal(res.statusCode, 401);

  const issued = clientTokens.issueToken({
    device_id: '44444444444444444444444444444444',
    pc_name: 'PC-TEST-TAMPER',
  });
  assert.equal(clientTokens.validateToken(issued.token + 'x'), null);
});

test('revoked device token is rejected and releases its PC claim', () => {
  const first = clientTokens.issueToken({
    device_id: '55555555555555555555555555555555',
    pc_name: 'PC-TEST-03',
  });
  assert.equal(first.ok, true);
  assert.equal(clientTokens.revokePcClaim('PC-TEST-03'), true);
  assert.equal(clientTokens.validateToken(first.token), null);

  const replacement = clientTokens.issueToken({
    device_id: '66666666666666666666666666666666',
    pc_name: 'PC-TEST-03',
  });
  assert.equal(replacement.ok, true);
});

test('requireDevice does not accept an admin session token', () => {
  const adminToken = adminSessions.issueToken();
  const req = { headers: { authorization: `Bearer ${adminToken}` } };
  const res = responseRecorder();
  let called = false;

  try {
    requireDevice(req, res, () => { called = true; });
    assert.equal(called, false);
    assert.equal(res.statusCode, 401);
  } finally {
    adminSessions.revokeToken(adminToken);
  }
});