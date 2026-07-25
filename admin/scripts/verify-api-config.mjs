import assert from 'node:assert/strict';
import { getApiBase } from '../src/apiConfig.js';
import { parseStudentCsv, spreadsheetRowsToRecords } from '../src/utils/studentImportParser.js';
import { readSheet } from 'read-excel-file/universal';
import { downloadStudentTemplateLocal } from '../src/utils/templateGenerator.js';
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

const parsedCsvStudents = parseStudentCsv(
  '\uFEFFnis,nama_lengkap,kelas,password\r\n1001,"Siswa, Satu",X TKJ 1,pass123\r\n',
);
assert.equal(parsedCsvStudents.length, 1);
assert.equal(parsedCsvStudents[0].nis, '1001');
assert.equal(parsedCsvStudents[0].nama_lengkap, 'Siswa, Satu');
assert.deepEqual(
  spreadsheetRowsToRecords([
    ['nis', 'nama_lengkap', 'kelas', 'password'],
    [1002, 'Siswa Dua', 'X TKJ 2', 'pass456'],
  ])[0],
  { nis: 1002, nama_lengkap: 'Siswa Dua', kelas: 'X TKJ 2', password: 'pass456' },
);
assert.throws(
  () => parseStudentCsv('nis,nama_lengkap\r\n1001,"Nama tanpa penutup'),
  /tanda kutip belum ditutup/,
);

let savedTemplatePayload;
globalThis.window = {
  btoa: globalThis.btoa,
  electronAPI: {
    saveTemplateFile: async (payload) => {
      savedTemplatePayload = payload;
      return { success: true, filePath: 'C:/Temp/Template_Import_Siswa_LabKom.xlsx' };
    },
  },
};
const generatedTemplate = await downloadStudentTemplateLocal('xlsx');
assert.equal(generatedTemplate.success, true);
assert.equal(savedTemplatePayload.format, 'xlsx');
const templateBytes = Uint8Array.from(Buffer.from(savedTemplatePayload.base64Data, 'base64'));
const templateRows = await readSheet(templateBytes.buffer);
assert.deepEqual(templateRows[0], ['nis', 'nama_lengkap', 'kelas', 'password']);
assert.equal(templateRows[1][0], '1001');
delete globalThis.window;

console.log('Admin desktop API routing, student import, and template generation: PASS');
