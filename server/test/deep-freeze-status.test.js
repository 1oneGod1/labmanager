const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeDeepFreezeStatusPayload } = require('../src/realtimeHub');

test('normalizes Deep Freeze status to an explicit safe schema', () => {
  const status = normalizeDeepFreezeStatusPayload({
    success: true,
    state: 'pending_freeze',
    action: 'freeze',
    provider: 'faronics',
    provider_label: 'Faronics Deep Freeze Enterprise',
    credential_configured: true,
    command_id: 'freeze_12345678_abcd12',
    supported: true,
    feature_installed: true,
    current_frozen: false,
    next_frozen: true,
    uwf_conflict: true,
    uwf_conflict_detected: true,
    uwf_deactivation_scheduled: true,
    uwf_current_enabled: true,
    uwf_next_enabled: false,
    uwf_current_protected: true,
    uwf_next_protected: false,
    faronics_state_known: true,
    overlay_consumption_mb: 2048,
    message: 'Siap\u0000 setelah restart',
    unexpected: { admin: true },
  });

  assert.equal(status.state, 'pending_freeze');
  assert.equal(status.action, 'freeze');
  assert.equal(status.provider, 'faronics');
  assert.equal(status.provider_label, 'Faronics Deep Freeze Enterprise');
  assert.equal(status.credential_configured, true);
  assert.equal(status.next_frozen, true);
  assert.equal(status.uwf_conflict, true);
  assert.equal(status.uwf_conflict_detected, true);
  assert.equal(status.uwf_deactivation_scheduled, true);
  assert.equal(status.uwf_current_enabled, true);
  assert.equal(status.uwf_next_enabled, false);
  assert.equal(status.uwf_current_protected, true);
  assert.equal(status.uwf_next_protected, false);
  assert.equal(status.faronics_state_known, true);
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
