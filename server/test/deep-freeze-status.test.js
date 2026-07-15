const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeDeepFreezeStatusPayload } = require('../src/realtimeHub');

test('normalizes Deep Freeze status to an explicit safe schema', () => {
  const status = normalizeDeepFreezeStatusPayload({
    success: true,
    state: 'pending_freeze',
    action: 'freeze',
    command_id: 'freeze_12345678_abcd12',
    supported: true,
    feature_installed: true,
    current_frozen: false,
    next_frozen: true,
    overlay_consumption_mb: 2048,
    message: 'Siap\u0000 setelah restart',
    unexpected: { admin: true },
  });

  assert.equal(status.state, 'pending_freeze');
  assert.equal(status.action, 'freeze');
  assert.equal(status.next_frozen, true);
  assert.equal(status.message, 'Siap  setelah restart');
  assert.equal('unexpected' in status, false);
});

test('rejects invalid state, action, command id, and unbounded numbers', () => {
  const status = normalizeDeepFreezeStatusPayload({
    state: '<script>',
    action: 'format',
    command_id: '../../bad',
    overlay_consumption_mb: Number.MAX_SAFE_INTEGER,
  });

  assert.equal(status.state, 'error');
  assert.equal(status.action, 'status');
  assert.equal(status.command_id, null);
  assert.equal(status.overlay_consumption_mb, 1_000_000);
});
