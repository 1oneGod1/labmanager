const bcrypt = require('bcryptjs');
const XLSX = require('xlsx');
const firebaseService = require('../services/dataService');

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

    const sampleData = [
      { nis: '1001', nama_lengkap: 'Ahmad Fauzi', kelas: 'XII TKJ 1', password: 'siswa123' },
      { nis: '1002', nama_lengkap: 'Budi Santoso', kelas: 'XII TKJ 2', password: 'siswa123' },
      { nis: '1003', nama_lengkap: 'Citra Dewi', kelas: 'XII RPL 1', password: 'siswa123' },
    ];

    const worksheet = XLSX.utils.json_to_sheet(sampleData, {
      header: ['nis', 'nama_lengkap', 'kelas', 'password'],
    });

    worksheet['!cols'] = [
      { wch: 15 },
      { wch: 30 },
      { wch: 15 },
      { wch: 20 },
    ];

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Data Siswa');

    if (format === 'csv') {
      const csvOutput = XLSX.utils.sheet_to_csv(worksheet);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename=Template_Import_Siswa_LabKom.csv');
      return res.send('\uFEFF' + csvOutput);
    }

    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
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
      const nama_lengkap = String(item.nama_lengkap ?? item.Nama ?? item.nama ?? item.name ?? '').trim();
      const kelas = String(item.kelas ?? item.Kelas ?? item.class ?? '').trim() || null;
      const rawPassword = String(item.password ?? item.Password ?? item.pass ?? '').trim();

      if (!nis || !nama_lengkap) {
        errors.push(`Baris ${index + 1}: NIS dan Nama Lengkap wajib diisi.`);
        skippedCount++;
        continue;
      }

      const existing = await firebaseService.students.getByNis(nis);

      if (existing) {
        if (overwriteExisting) {
          const updateData = {
            nis,
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
  const { nis, nama_lengkap, kelas, password } = req.body;

  if (!nis || !nama_lengkap || !password) {
    return res.status(400).json({ success: false, message: 'NIS, nama, dan password wajib diisi.' });
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
    if (err.message === 'NIS sudah terdaftar') {
      return res.status(409).json({ success: false, message: err.message });
    }
    
    return res.status(500).json({ success: false, message: 'Gagal menambahkan siswa.' });
  }
}

// ── PUT /api/students/:id ────────────────────────────────────────
async function updateStudent(req, res) {
  const { id } = req.params;
  const { nis, nama_lengkap, kelas, is_active, password } = req.body;

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

    // If password is provided, hash it
    if (password) {
      updateData.password_hash = await bcrypt.hash(password, 10);
    }

    // Update via active storage provider.
    await firebaseService.students.update(id, updateData);

    return res.json({ success: true, message: 'Data siswa berhasil diperbarui.' });
  } catch (err) {
    console.error('[STUDENTS] updateStudent error:', err);
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
