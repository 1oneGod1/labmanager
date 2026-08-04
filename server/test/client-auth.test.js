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

test('shutdown logout is idempotent and copies the initial checklist once', async () => {
  const deviceId = '77777777777777777777777777777777';
  const session = await dataService.sessions.create({
    student_id: 'student-shutdown-test',
    pc_name: 'PC-TEST-SHUTDOWN',
    actual_pc_name: 'PC-TEST-SHUTDOWN',
    device_id: deviceId,
    nis: '7001',
    nama_lengkap: 'Siswa Shutdown',
  });
  const initial = await dataService.checks.create({
    session_id: session.id,
    nis: '7001',
    nama_lengkap: 'Siswa Shutdown',
    pc_name: 'PC-TEST-SHUTDOWN',
    check_type: 'pre',
    monitor_status: 'ok',
    keyboard_status: 'bad',
    keyboard_note: 'Tombol A lepas',
  });

  const { logout } = require('../src/controllers/authController');
  const makeRequest = () => ({
    body: {
      session_id: session.id,
      reason: 'system_shutdown',
      reuse_initial_check: true,
    },
    actor: { role: 'client', device_id: deviceId, pc_name: 'PC-TEST-SHUTDOWN' },
  });

  const firstResponse = responseRecorder();
  await logout(makeRequest(), firstResponse);
  assert.equal(firstResponse.statusCode, 200);
  assert.equal(firstResponse.body.success, true);
  assert.equal(firstResponse.body.data.automatic_check.created, true);

  const secondResponse = responseRecorder();
  await logout(makeRequest(), secondResponse);
  assert.equal(secondResponse.statusCode, 200);
  assert.equal(secondResponse.body.data.already_finished, true);
  assert.equal(secondResponse.body.data.automatic_check.reason, 'post_exists');

  const checks = await dataService.checks.getBySession(session.id);
  const posts = checks.filter((check) => check.check_type === 'post');
  assert.equal(posts.length, 1);
  assert.equal(posts[0].keyboard_status, 'bad');
  assert.equal(posts[0].keyboard_note, 'Tombol A lepas');
  assert.equal(posts[0].copied_from_check_id, initial.id);
  assert.equal((await dataService.sessions.getById(session.id)).status, 'finished');
});
