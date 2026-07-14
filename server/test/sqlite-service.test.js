const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

test('SQLite lokal mempertahankan kontrak seluruh layanan LabKom', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'labkom-sqlite-test-'));
  process.env.NODE_ENV = 'test';
  process.env.LABKOM_DATA_DIR = tempDir;
  process.env.LABKOM_BACKUP_DIR = path.join(tempDir, 'backups');

  const modulePath = require.resolve('../src/services/sqliteService');
  delete require.cache[modulePath];
  const service = require(modulePath);

  try {
    const initialStatus = service.initialize({ scheduleBackups: false });
    assert.equal(initialStatus.provider, 'sqlite');
    assert.equal(initialStatus.available, true);

    const student = await service.students.create({
      nis: '1001',
      nama_lengkap: 'Siswa Test',
      kelas: 'X RPL 1',
      password_hash: '$2b$10$test-hash',
      is_active: 1,
    });
    assert.equal(student.nis, '1001');
    assert.equal('password_hash' in student, false);
    assert.equal((await service.students.getByNis('1001')).password_hash, '$2b$10$test-hash');
    await assert.rejects(() => service.students.create({
      nis: '1001', nama_lengkap: 'Duplikat', password_hash: 'x',
    }), /NIS sudah terdaftar/);

    const computer = await service.computers.create({ pc_name: 'PC-01', label: 'Meja 1' });
    assert.equal(computer.pc_name, 'PC-01');
    const assigned = await service.computers.assignDevice({
      targetPcName: 'PC-01', sourcePcName: 'DESKTOP-TEST', sourceMac: 'AA:BB:CC:DD:EE:FF', sourceIp: '192.168.1.21',
    });
    assert.equal(assigned.bound_hostname, 'DESKTOP-TEST');

    const session = await service.sessions.create({
      student_id: student.id,
      pc_name: 'PC-01',
      nis: '1001',
      nama_lengkap: 'Siswa Test',
    });
    assert.equal((await service.sessions.getActive()).length, 1);

    const check = await service.checks.create({
      session_id: session.id,
      nis: '1001',
      nama_lengkap: 'Siswa Test',
      pc_name: 'PC-01',
      check_type: 'pre',
      keyboard_status: 'bad',
    });
    assert.ok(check.id);
    assert.equal((await service.checks.getSummary({}))[0].issue_count, 1);

    await service.control.set('blocked_sites', ['example.com']);
    assert.deepEqual(await service.control.get('blocked_sites'), ['example.com']);

    const activity = await service.activities.create({
      pc_name: 'PC-01',
      student_id: student.id,
      session_id: session.id,
      activity_type: 'browser_url',
      url_domain: 'example.com',
      duration_seconds: 12,
    });
    assert.ok(activity.id);
    assert.equal((await service.activities.getTopSites({}))[0].url_domain, 'example.com');

    await service.chat.create({ type: 'client_reply', pc_name: 'PC-01', message: 'Tes' });
    assert.equal((await service.chat.getRecent()).length, 1);

    await service.audit.create({ action: 'TEST', success: true });
    const ended = await service.sessions.endSession(session.id);
    assert.equal(ended.status, 'finished');

    const backup = await service.createBackup('test');
    assert.equal(fs.existsSync(backup.path), true);
    assert.ok(backup.size_bytes > 0);
    assert.ok(service.getStorageStatus().last_backup_at);
  } finally {
    await service.shutdown({ backup: false });
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
