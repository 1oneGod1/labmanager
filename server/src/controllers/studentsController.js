const bcrypt = require('bcryptjs');
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

module.exports = { getStudents, createStudent, updateStudent, deleteStudent };
