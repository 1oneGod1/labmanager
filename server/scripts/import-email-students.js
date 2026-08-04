const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

function normalizeEmail(value) {
  return String(value ?? '').trim().toLowerCase();
}

function normalizeNis(value) {
  return String(value ?? '').trim().replace(/\.0$/, '');
}

function validateSource(payload) {
  if (!Array.isArray(payload?.students) || payload.students.length === 0) {
    throw new Error('Data siswa hasil ekstraksi Excel kosong.');
  }

  const nisSeen = new Set();
  const emailSeen = new Set();
  return payload.students.map((item, index) => {
    const student = {
      nis: normalizeNis(item.nis),
      email: normalizeEmail(item.email),
      nama_lengkap: String(item.nama_lengkap ?? '').trim().replace(/\s+/g, ' '),
      kelas: String(item.kelas ?? '').trim() || null,
    };
    if (!student.nis || !student.email || !student.nama_lengkap) {
      throw new Error(`Baris data ${index + 1} tidak lengkap.`);
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(student.email)) {
      throw new Error(`Format email baris data ${index + 1} tidak valid.`);
    }
    if (nisSeen.has(student.nis)) throw new Error(`NIS duplikat: ${student.nis}`);
    if (emailSeen.has(student.email)) throw new Error(`Email duplikat: ${student.email}`);
    nisSeen.add(student.nis);
    emailSeen.add(student.email);
    return student;
  });
}

async function hashStudents(students, password) {
  const prepared = [];
  const concurrency = 8;
  for (let offset = 0; offset < students.length; offset += concurrency) {
    const batch = students.slice(offset, offset + concurrency);
    const hashedBatch = await Promise.all(batch.map(async (student) => ({
      ...student,
      password_hash: await bcrypt.hash(password, 10),
    })));
    prepared.push(...hashedBatch);
  }
  return prepared;
}

async function main() {
  const inputPath = path.resolve(process.argv[2] || '');
  const databasePath = path.resolve(process.env.LABKOM_DATABASE_FILE || '');
  const password = String(process.env.LABKOM_IMPORT_PASSWORD || '');

  if (!process.argv[2] || !fs.existsSync(inputPath)) {
    throw new Error('Berkas JSON hasil ekstraksi Excel tidak ditemukan.');
  }
  if (!process.env.LABKOM_DATABASE_FILE || !fs.existsSync(databasePath)) {
    throw new Error('Database LabKom aktif tidak ditemukan.');
  }
  if (!password) {
    throw new Error('LABKOM_IMPORT_PASSWORD wajib diisi.');
  }

  const payload = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  const students = validateSource(payload);
  process.env.LABKOM_BACKUP_DIR = process.env.LABKOM_BACKUP_DIR
    || path.join(path.dirname(databasePath), '..', 'backups');

  const servicePath = require.resolve('../src/services/sqliteService');
  delete require.cache[servicePath];
  const service = require(servicePath);
  service.initialize({ scheduleBackups: false });

  try {
    for (const student of students) {
      const existing = await service.students.getByNis(student.nis);
      const emailOwner = await service.students.getByEmail(student.email);
      if (emailOwner && emailOwner.id !== existing?.id) {
        throw new Error(`Email ${student.email} sudah terhubung ke NIS lain di database.`);
      }
    }

    const prepared = await hashStudents(students, password);
    const backup = await service.createBackup('before-email-import');
    let createdCount = 0;
    let updatedCount = 0;

    for (const student of prepared) {
      const existing = await service.students.getByNis(student.nis);
      const data = {
        nis: student.nis,
        email: student.email,
        nama_lengkap: student.nama_lengkap,
        kelas: student.kelas,
        password_hash: student.password_hash,
        is_active: 1,
      };
      if (existing) {
        await service.students.update(existing.id, data);
        updatedCount += 1;
      } else {
        await service.students.create(data);
        createdCount += 1;
      }
    }

    for (const student of prepared) {
      const stored = await service.students.getByNis(student.nis);
      if (!stored || stored.email !== student.email || stored.password_hash !== student.password_hash) {
        throw new Error(`Verifikasi database gagal untuk NIS ${student.nis}.`);
      }
    }

    console.log(JSON.stringify({
      success: true,
      databasePath,
      backupPath: backup.path,
      total: prepared.length,
      createdCount,
      updatedCount,
      verifiedCount: prepared.length,
    }, null, 2));
  } finally {
    await service.shutdown({ backup: false });
  }
}

main().catch((error) => {
  console.error(`[IMPORT EMAIL SISWA] ${error.message}`);
  process.exitCode = 1;
});

