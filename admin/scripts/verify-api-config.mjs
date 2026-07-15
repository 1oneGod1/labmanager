import assert from 'node:assert/strict';
import { getApiBase } from '../src/apiConfig.js';

assert.equal(getApiBase('file:'), 'http://localhost:3001');
assert.equal(
  getApiBase('labkom:'),
  'http://localhost:3001',
  'Protokol desktop aman harus diarahkan ke backend lokal.',
);
assert.equal(getApiBase('http:'), '');
assert.equal(getApiBase('https:'), '');

console.log('Admin desktop API routing: PASS');
