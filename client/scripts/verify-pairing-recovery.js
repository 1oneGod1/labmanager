const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const mainSource = fs.readFileSync(path.join(root, 'electron', 'main.js'), 'utf8');
const preloadSource = fs.readFileSync(path.join(root, 'electron', 'preload.js'), 'utf8');
const appSource = fs.readFileSync(path.join(root, 'src', 'App.jsx'), 'utf8');

assert.match(mainSource, /get-client-pairing-status/, 'Main process harus mengecek pairing sebelum login.');
assert.match(mainSource, /pair-client-device/, 'Main process harus menyediakan pemulihan pairing langsung.');
assert.match(mainSource, /lastRejectedRegistrationCredential/, 'Pairing yang ditolak tidak boleh dicoba tanpa henti.');
assert.match(mainSource, /api\/auth\/device-status/, 'Token tersimpan harus divalidasi proaktif ke server.');
assert.match(preloadSource, /getClientPairingStatus/, 'Renderer harus dapat membaca status pairing dengan IPC aman.');
assert.match(preloadSource, /pairClientDevice/, 'Renderer harus dapat mengirim kode pairing dengan IPC aman.');
assert.match(appSource, /Hubungkan PC ke Admin/, 'Layar siswa harus menampilkan pemulihan pairing.');
assert.match(appSource, /Kode Pairing 6 Digit/, 'Layar siswa harus meminta kode pendek dari Admin.');
assert.match(appSource, /pairingStatus\.state === 'ready'/, 'Form login hanya boleh muncul setelah device siap.');

console.log('Student pairing recovery flow: PASS');