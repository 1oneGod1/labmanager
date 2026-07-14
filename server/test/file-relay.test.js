const test = require('node:test');
const assert = require('node:assert/strict');

const {
  MAX_FILE_BYTES,
  sanitizeFileName,
  validateDistributionPayload,
  normalizeFileStatus,
} = require('../src/services/fileRelayService');

test('file relay sanitizes names and accepts a small base64 payload', () => {
  const result = validateDistributionPayload({
    id: 'dist_12345678',
    name: '../Latihan: Praktikum?.pdf',
    data: `data:application/pdf;base64,${Buffer.from('demo').toString('base64')}`,
  });

  assert.equal(result.ok, true);
  assert.equal(result.payload.name, 'Latihan_ Praktikum_.pdf');
  assert.equal(result.payload.size, 4);
});

test('file relay rejects malformed and oversized payloads', () => {
  assert.equal(validateDistributionPayload({ id: 'dist_12345678', data: 'not-a-data-url' }).ok, false);

  const oversized = Buffer.alloc(MAX_FILE_BYTES + 1, 1).toString('base64');
  assert.equal(validateDistributionPayload({
    id: 'dist_12345678',
    name: 'large.bin',
    data: `data:application/octet-stream;base64,${oversized}`,
  }).ok, false);
});

test('file status normalization only allows known states', () => {
  assert.equal(normalizeFileStatus('Delivered'), 'delivered');
  assert.equal(normalizeFileStatus('submitted'), 'submitted');
  assert.equal(normalizeFileStatus('unknown'), null);
});
