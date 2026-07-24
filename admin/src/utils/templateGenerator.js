import * as XLSX from 'xlsx';

/**
 * Mengunduh berkas template data login siswa (.xlsx atau .csv) secara lokal
 * Menggunakan SheetJS (XLSX) yang sudah terintegrasi di frontend Admin.
 * Bekerja 100% di Electron desktop app, browser web, maupun mode offline.
 */
export function downloadStudentTemplateLocal(format = 'xlsx') {
  try {
    const isCsv = String(format).toLowerCase() === 'csv';
    const fileExt = isCsv ? 'csv' : 'xlsx';
    const fileName = `Template_Import_Siswa_LabKom.${fileExt}`;

    const sampleData = [
      { nis: '1001', nama_lengkap: 'Ahmad Fauzi', kelas: 'XII TKJ 1', password: 'siswa123' },
      { nis: '1002', nama_lengkap: 'Budi Santoso', kelas: 'XII TKJ 2', password: 'siswa123' },
      { nis: '1003', nama_lengkap: 'Citra Dewi', kelas: 'XII RPL 1', password: 'siswa123' },
    ];

    const worksheet = XLSX.utils.json_to_sheet(sampleData, {
      header: ['nis', 'nama_lengkap', 'kelas', 'password'],
    });

    // Lebar kolom yang rapi untuk Excel
    worksheet['!cols'] = [
      { wch: 15 }, // nis
      { wch: 30 }, // nama_lengkap
      { wch: 15 }, // kelas
      { wch: 20 }, // password
    ];

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Data Siswa');

    // XLSX.writeFile membuat Blob lokal & memicu dialog unduh secara otomatis
    XLSX.writeFile(workbook, fileName, { bookType: isCsv ? 'csv' : 'xlsx' });
    return { success: true, fileName };
  } catch (error) {
    console.error('[TEMPLATE GENERATOR] Gagal mengunduh template:', error);
    throw new Error('Gagal membuat berkas template Excel/CSV.');
  }
}
