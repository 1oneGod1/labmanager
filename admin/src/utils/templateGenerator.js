import * as XLSX from 'xlsx';

/**
 * Mengunduh berkas template data login siswa (.xlsx atau .csv) secara otomatis.
 * Jika berjalan di Electron App, berkas ditulis langsung ke C:\Users\<user>\Downloads\
 * dan otomatis membuka lokasi berkas di File Explorer.
 */
export async function downloadStudentTemplateLocal(format = 'xlsx') {
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

    worksheet['!cols'] = [
      { wch: 15 }, // nis
      { wch: 30 }, // nama_lengkap
      { wch: 15 }, // kelas
      { wch: 20 }, // password
    ];

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Data Siswa');

    // 1. Jalur Utama: Jika di Electron App, gunakan IPC saveTemplateFile ke folder Downloads bawaan OS
    if (typeof window !== 'undefined' && window.electronAPI?.saveTemplateFile) {
      const base64Data = XLSX.write(workbook, {
        type: 'base64',
        bookType: isCsv ? 'csv' : 'xlsx',
      });
      const result = await window.electronAPI.saveTemplateFile({
        fileName,
        format: fileExt,
        base64Data,
      });
      if (!result.success) throw new Error(result.message || 'Gagal menyimpan file ke Downloads.');
      return { success: true, fileName, filePath: result.filePath };
    }

    // 2. Jalur Fallback: Jika dibuka di browser web biasa
    XLSX.writeFile(workbook, fileName, { bookType: isCsv ? 'csv' : 'xlsx' });
    return { success: true, fileName };
  } catch (error) {
    console.error('[TEMPLATE GENERATOR] Gagal mengunduh template:', error);
    throw error;
  }
}
