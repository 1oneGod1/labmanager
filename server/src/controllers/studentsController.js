const bcrypt = require('bcryptjs');
const writeExcelFile = require('write-excel-file/node');
const firebaseService = require('../services/dataService');

const TEMPLATE_HEADERS = ['nis', 'email', 'nama_lengkap', 'kelas', 'password'];
const TEMPLATE_ROWS = [
  ['1001', 'ahmad.fauzi@student.sekolah.sch.id', 'Ahmad Fauzi', 'XII TKJ 1', 'siswa123'],
  ['1002', 'budi.santoso@student.sekolah.sch.id', 'Budi Santoso', 'XII TKJ 2', 'siswa123'],
  ['1003', 'citra.dewi@student.sekolah.sch.id', 'Citra Dewi', 'XII RPL 1', 'siswa123'],
];

function csvEscape(value) {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function normalizeEmail(value) {
  return String(value ?? '').trim().toLowerCase();
}

function isValidEmail(value) {
  return !value || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

// ══════════════════════════════════════════════════════════════════════════
// STUDENTS CONTROLLER - STORAGE PROVIDER INDEPENDENT
// ══════════════════════════════════════════════════════════════════════════

// ── GET /api/students ────────────────────────────────────────────
async function getStudents(_req, res) {
  try {
    if (!firebaseService.isStorageAvailable()) {
      return res.status(503).json({ 
        success: false, 
        message: 'Database lokal tidak tersedia. Periksa folder data aplikasi Admin.'
      });
    }

    const students = await firebaseService.students.getAll();
    
    // Remove password_hash dari response
    const sanitized = students.map(s => {
      const { password_hash, ...rest } = s;
      return rest;
    });

    return res.json({ success: true, data: sanitized });
  } catch (err) {
    console.error('[STUDENTS] getStudents error:', err);
    return res.status(500).json({ success: false, message: 'Gagal mengambil data siswa.' });
  }
}

// ── GET /api/students/template ───────────────────────────────────
async function downloadStudentTemplate(req, res) {
  try {
    const format = String(req.query.format || 'xlsx').toLowerCase();

    if (format === 'csv') {
      const csvOutput = [TEMPLATE_HEADERS, ...TEMPLATE_ROWS]
        .map((row) => row.map(csvEscape).join(','))
        .join('\r\n');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename=Template_Import_Siswa_LabKom.csv');
      return res.send(`\uFEFF${csvOutput}\r\n`);
    }

    const buffer = await writeExcelFile(
      [TEMPLATE_HEADERS, ...TEMPLATE_ROWS],
      {
        sheet: 'Data Siswa',
        columns: [{ width: 15 }, { width: 42 }, { width: 30 }, { width: 15 }, { width: 20 }],
      },
    ).toBuffer();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=Template_Import_Siswa_LabKom.xlsx');
    return res.send(buffer);
  } catch (err) {
    console.error('[STUDENTS] downloadStudentTemplate error:', err);
    return res.status(500).json({ success: false, message: 'Gagal mengunduh template import data siswa.' });
  }
}

// ── POST /api/students/import ────────────────────────────────────
async function importStudents(req, res) {
  const { students, overwriteExisting } = req.body;

  if (!Array.isArray(students) || students.length === 0) {
    return res.status(400).json({ success: false, message: 'Data siswa untuk diimpor tidak boleh kosong.' });
  }

  try {
    if (!firebaseService.isStorageAvailable()) {
      return res.status(503).json({
        success: false,
        message: 'Database lokal tidak tersedia. Periksa folder data aplikasi Admin.',
      });
    }

    let createdCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;
    const errors = [];

    for (let index = 0; index < students.length; index++) {
      const item = students[index];
      const nis = String(item.nis ?? item.NIS ?? item.nisn ?? item.username ?? '').trim();
      const hasEmail = ['email', 'Email', 'EMAIL']
        .some((key) => Object.prototype.hasOwnProperty.call(item, key));

      const email = normalizeEmail(item.email ?? item.Email ?? item.EMAIL);
      const nama_lengkap = String(item.nama_lengkap ?? item.Nama ?? item.nama ?? item.name ?? '').trim();
      const kelas = String(item.kelas ?? item.Kelas ?? item.class ?? '').trim() || null;
      const rawPassword = String(item.password ?? item.Password ?? item.pass ?? '').trim();

      if (!nis || !nama_lengkap) {
        errors.push(`Baris ${index + 1}: NIS dan Nama Lengkap wajib diisi.`);
        skippedCount++;
        continue;
      }

      if (!isValidEmail(email)) {
        errors.push(`Baris ${index + 1}: Format email tidak valid.`);
        skippedCount++;
        continue;
      }

      const existing = await firebaseService.students.getByNis(nis);
      const emailOwner = email ? await firebaseService.students.getByEmail(email) : null;
      if (emailOwner && emailOwner.id !== existing?.id) {
        errors.push(`Baris ${index + 1}: Email sudah digunakan oleh NIS lain.`);
        skippedCount++;
        continue;
      }

      if (existing) {
        if (overwriteExisting) {
          const updateData = {
            nis,
            ...(hasEmail ? { email: email || null } : {}),
            nama_lengkap,
            kelas,
            is_active: 1,
          };
          if (rawPassword) {
            updateData.password_hash = await bcrypt.hash(rawPassword, 10);
          }
          await firebaseService.students.update(existing.id, updateData);
          updatedCount++;
        } else {
          skippedCount++;
          errors.push(`Baris ${index + 1}: NIS ${nis} (${nama_lengkap}) sudah terdaftar (dilewati).`);
        }
      } else {
        if (!rawPassword) {
          errors.push(`Baris ${index + 1}: Password wajib diisi untuk siswa baru (NIS ${nis}).`);
          skippedCount++;
          continue;
        }

        const password_hash = await bcrypt.hash(rawPassword, 10);
        await firebaseService.students.create({
          nis,
          email: email || null,
          nama_lengkap,
          kelas,
          password_hash,
          is_active: 1,
        });
        createdCount++;
      }
    }

    return res.json({
      success: true,
      message: `Import selesai. ${createdCount} siswa baru ditambahkan, ${updatedCount} diperbarui, ${skippedCount} dilewati.`,
      createdCount,
      updatedCount,
      skippedCount,
      totalProcessed: createdCount + updatedCount,
      errors: errors.slice(0, 50),
    });
  } catch (err) {
    console.error('[STUDENTS] importStudents error:', err);
    return res.status(500).json({ success: false, message: 'Gagal memproses import data siswa.' });
  }
}

// ── POST /api/students ───────────────────────────────────────────
async function createStudent(req, res) {
  const { nis, email, nama_lengkap, kelas, password } = req.body;

  if (!nis || !nama_lengkap || !password) {
    return res.status(400).json({ success: false, message: 'NIS, nama, dan password wajib diisi.' });
  }

  if (!isValidEmail(normalizeEmail(email))) {
    return res.status(400).json({ success: false, message: 'Format email tidak valid.' });
  }
  try {
    if (!firebaseService.isStorageAvailable()) {
      return res.status(503).json({ 
        success: false, 
        message: 'Database lokal tidak tersedia. Periksa folder data aplikasi Admin.'
      });
    }

    // Hash password
    const password_hash = await bcrypt.hash(password, 10);

    // Create student via active storage provider.
    const newStudent = await firebaseService.students.create({
      nis,
      email: normalizeEmail(email) || null,
      nama_lengkap,
      kelas: kelas || null,
      password_hash,
      is_active: 1,
    });

    return res.status(201).json({
      success: true,
      message: 'Siswa berhasil ditambahkan.',
      data: newStudent,
    });
  } catch (err) {
    console.error('[STUDENTS] createStudent error:', err);
    
    // Handle specific errors
    if (['NIS sudah terdaftar', 'Email sudah terdaftar'].includes(err.message)) {
      return res.status(409).json({ success: false, message: err.message });
    }
    
    return res.status(500).json({ success: false, message: 'Gagal menambahkan siswa.' });
  }
}

// ── PUT /api/students/:id ────────────────────────────────────────
async function updateStudent(req, res) {
  const { id } = req.params;
  const { nis, email, nama_lengkap, kelas, is_active, password } = req.body;

  if (Object.prototype.hasOwnProperty.call(req.body, 'email') && !isValidEmail(normalizeEmail(email))) {
    return res.status(400).json({ success: false, message: 'Format email tidak valid.' });
  }

  try {
    if (!firebaseService.isStorageAvailable()) {
      return res.status(503).json({ 
        success: false, 
        message: 'Database lokal tidak tersedia. Periksa folder data aplikasi Admin.'
      });
    }

    // Check if student exists
    const existing = await firebaseService.students.getById(id);
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Siswa tidak ditemukan.' });
    }

    // Prepare update data
    const updateData = {
      nis,
      nama_lengkap,
      kelas,
      is_active,
    };

    if (Object.prototype.hasOwnProperty.call(req.body, 'email')) {
      updateData.email = normalizeEmail(email) || null;
    }
    // If password is provided, hash it
    if (password) {
      updateData.password_hash = await bcrypt.hash(password, 10);
    }

    // Update via active storage provider.
    await firebaseService.students.update(id, updateData);

    return res.json({ success: true, message: 'Data siswa berhasil diperbarui.' });
  } catch (err) {
    console.error('[STUDENTS] updateStudent error:', err);
    if (['NIS sudah terdaftar', 'Email sudah terdaftar'].includes(err.message)) {
      return res.status(409).json({ success: false, message: err.message });
    }
    return res.status(500).json({ success: false, message: 'Gagal memperbarui data siswa.' });
  }
}

// ── DELETE /api/students/:id ─────────────────────────────────────
// Soft delete - set is_active to 0
async function deleteStudent(req, res) {
  const { id } = req.params;

  try {
    if (!firebaseService.isStorageAvailable()) {
      return res.status(503).json({ 
        success: false, 
        message: 'Database lokal tidak tersedia. Periksa folder data aplikasi Admin.'
      });
    }

    // Check if student exists
    const existing = await firebaseService.students.getById(id);
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Siswa tidak ditemukan.' });
    }

    // Soft delete via active storage provider.
    await firebaseService.students.delete(id);

    return res.json({ success: true, message: 'Akun siswa berhasil dinonaktifkan.' });
  } catch (err) {
    console.error('[STUDENTS] deleteStudent error:', err);
    return res.status(500).json({ success: false, message: 'Gagal menonaktifkan siswa.' });
  }
}

module.exports = {
  getStudents,
  downloadStudentTemplate,
  importStudents,
  createStudent,
  updateStudent,
  deleteStudent,
};
