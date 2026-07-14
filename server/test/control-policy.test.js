const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeControlSettings,
  normalizeDomainList,
} = require('../src/services/controlPolicyService');

test('control policy normalizes values and rejects unsafe wallpaper protocols', () => {
  const policy = normalizeControlSettings({
    master_volume: '140',
    master_muted: 'true',
    web_filter_enabled: '1',
    web_filter_mode: 'whitelist',
    whitelist: '["https://Classroom.Google.com/path", "*.github.com"]',
    wallpaper_url: 'file:///C:/secret.txt',
    wallpaper_target: 'login',
  });

  assert.equal(policy.master_volume, 100);
  assert.equal(policy.master_muted, true);
  assert.equal(policy.web_filter_enabled, true);
  assert.deepEqual(policy.whitelist, ['classroom.google.com', 'github.com']);
  assert.equal(policy.wallpaper_url, '');
  assert.equal(policy.wallpaper_target, 'login');
});

test('partial control policy only includes supplied known fields', () => {
  const policy = normalizeControlSettings({ master_volume: 42, unknown: 'ignored' }, { partial: true });
  assert.deepEqual(policy, { master_volume: 42 });
});

test('domain lists are deduplicated and invalid entries are removed', () => {
  assert.deepEqual(normalizeDomainList('example.com, https://example.com/a, bad domain'), ['example.com']);
});
