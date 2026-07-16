import assert from 'node:assert/strict';
import { getApiBase } from '../src/apiConfig.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

assert.equal(getApiBase('file:'), 'http://localhost:3001');
assert.equal(
  getApiBase('labkom:'),
  'http://localhost:3001',
  'Protokol desktop aman harus diarahkan ke backend lokal.',
);
assert.equal(getApiBase('http:'), '');
assert.equal(getApiBase('https:'), '');

const scriptRoot = path.dirname(fileURLToPath(import.meta.url));
const adminRoot = path.resolve(scriptRoot, '..');
const electronSource = fs.readFileSync(path.join(adminRoot, 'electron', 'main.js'), 'utf8');
const dashboardSource = fs.readFileSync(path.join(adminRoot, 'src', 'AdminDashboard.jsx'), 'utf8');
assert.match(electronSource, /CLIENT_PAIRING_CODE/, 'Admin harus mempertahankan kode pairing pendek.');
assert.match(electronSource, /randomInt\(0, 1_000_000\)/, 'Kode pairing harus dibuat sebagai 6 digit acak.');
assert.match(dashboardSource, /pairing_code/, 'Dashboard harus membaca kode pairing dari backend.');
const labPcOptionDeclarations = dashboardSource.match(/const labPcOptions\s*=/g) || [];
assert.equal(
  labPcOptionDeclarations.length,
  1,
  'labPcOptions harus didefinisikan satu kali pada cakupan dashboard.',
);
assert.ok(
  dashboardSource.indexOf('const labPcOptions') < dashboardSource.indexOf('const renderDesignSelectedPanel'),
  'Panel detail monitoring harus dapat mengakses labPcOptions tanpa ReferenceError.',
);
assert.match(dashboardSource, /status === 'sleeping'/, 'Dashboard harus membedakan status sleep dari offline.');
assert.match(
  electronSource,
  /permission === 'media'[\s\S]*details\.mediaTypes\.length === 0/,
  'Tangkap layar Electron harus mengizinkan permission media tanpa kamera/mikrofon.',
);
assert.match(
  electronSource,
  /setDisplayMediaRequestHandler[\s\S]*callback\(\{ video: selected \}\)/,
  'Admin harus memilih dan memberikan sumber layar ke getDisplayMedia.',
);
assert.match(
  electronSource,
  /configureAdminDisplayCapture\(mainWindow\)/,
  'Handler tangkap layar harus dipasang pada session BrowserWindow Admin.',
);

assert.match(dashboardSource, /Kode Pairing PC Siswa/, 'Dashboard harus menampilkan kode pairing pendek.');

console.log('Admin desktop API routing: PASS');
