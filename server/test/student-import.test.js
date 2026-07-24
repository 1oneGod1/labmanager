const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const XLSX = require('xlsx');

test('Import data siswa dari Excel/CSV dan pengunduhan template berfungsi dengan benar', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'labkom-import-test-'));
  process.env.NODE_ENV = 'test';
  process.env.LABKOM_DATA_DIR = tempDir;
  process.env.LABKOM_BACKUP_DIR = path.join(tempDir, 'backups');

  const sqlitePath = require.resolve('../src/services/sqliteService');
  delete require.cache[sqlitePath];
  const sqliteService = require(sqlitePath);

  const controllerPath = require.resolve('../src/controllers/studentsController');
  delete require.cache[controllerPath];
  const controller = require(controllerPath);

  try {
    sqliteService.initialize({ scheduleBackups: false });

    // 1. Uji pengunduhan template Excel (.xlsx)
    const mockResXlsx = {
      headers: {},
      setHeader(k, v) { this.headers[k] = v; },
      send(data) { this.body = data; return this; },
    };

    await controller.downloadStudentTemplate({ query: { format: 'xlsx' } }, mockResXlsx);
    assert.equal(mockResXlsx.headers['Content-Type'], 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    assert.ok(mockResXlsx.body instanceof Buffer);
    
    // Verifikasi bahwa buffer template dapat dibaca oleh SheetJS (XLSX)
    const parsedWb = XLSX.read(mockResXlsx.body, { type: 'buffer' });
    assert.equal(parsedWb.SheetNames[0], 'Data Siswa');
    const parsedRows = XLSX.utils.sheet_to_json(parsedWb.Sheets['Data Siswa']);
    assert.equal(parsedRows.length, 3);
    assert.equal(parsedRows[0].nis, '1001');

    // 2. Uji pengunduhan template CSV
    const mockResCsv = {
      headers: {},
      setHeader(k, v) { this.headers[k] = v; },
      send(data) { this.body = data; return this; },
    };

    await controller.downloadStudentTemplate({ query: { format: 'csv' } }, mockResCsv);
    assert.ok(mockResCsv.headers['Content-Type'].includes('text/csv'));
    assert.ok(mockResCsv.body.includes('nis,nama_lengkap,kelas,password'));

    // 3. Uji import batch data siswa
    const importPayload = {
      students: [
        { nis: '2001', nama_lengkap: 'Siswa Import 1', kelas: 'X TKJ 1', password: 'pass123' },
        { nis: '2002', nama_lengkap: 'Siswa Import 2', kelas: 'X TKJ 2', password: 'pass123' },
      ],
      overwriteExisting: false,
    };

    const mockImportRes = {
      statusCode: 200,
      json(data) { this.body = data; return this; },
    };

    await controller.importStudents({ body: importPayload }, mockImportRes);
    assert.equal(mockImportRes.body.success, true);
    assert.equal(mockImportRes.body.createdCount, 2);

    // Pastikan siswa tersimpan di database
    const allStudents = await sqliteService.students.getAll();
    assert.equal(allStudents.length, 2);
    assert.equal(allStudents[0].nis, '2001');

    // 4. Uji import ulang NIS yang sama dengan overwriteExisting = true
    const overwritePayload = {
      students: [
        { nis: '2001', nama_lengkap: 'Siswa Import 1 Update', kelas: 'X TKJ 1 Updated', password: 'pass456' },
      ],
      overwriteExisting: true,
    };

    const mockOverwriteRes = {
      json(data) { this.body = data; return this; },
    };

    await controller.importStudents({ body: overwritePayload }, mockOverwriteRes);
    assert.equal(mockOverwriteRes.body.success, true);
    assert.equal(mockOverwriteRes.body.updatedCount, 1);

    const updatedStudent = await sqliteService.students.getByNis('2001');
    assert.equal(updatedStudent.nama_lengkap, 'Siswa Import 1 Update');
    assert.equal(updatedStudent.kelas, 'X TKJ 1 Updated');

  } finally {
    await sqliteService.shutdown({ backup: false });
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
