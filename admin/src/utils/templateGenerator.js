import writeExcelFile from 'write-excel-file/universal';

const TEMPLATE_HEADERS = ['nis', 'nama_lengkap', 'kelas', 'password'];
const TEMPLATE_ROWS = [
  ['1001', 'Ahmad Fauzi', 'XII TKJ 1', 'siswa123'],
  ['1002', 'Budi Santoso', 'XII TKJ 2', 'siswa123'],
  ['1003', 'Citra Dewi', 'XII RPL 1', 'siswa123'],
];

function csvEscape(value) {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

async function blobToBase64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 32_768) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 32_768));
  }
  return window.btoa(binary);
}

function downloadBlob(blob, fileName) {
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = fileName;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000);
}

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
    const blob = isCsv
      ? new Blob(
        [`\uFEFF${[TEMPLATE_HEADERS, ...TEMPLATE_ROWS].map((row) => row.map(csvEscape).join(',')).join('\r\n')}\r\n`],
        { type: 'text/csv;charset=utf-8' },
      )
      : await writeExcelFile(
        [TEMPLATE_HEADERS, ...TEMPLATE_ROWS],
        {
          sheet: 'Data Siswa',
          columns: [{ width: 15 }, { width: 30 }, { width: 15 }, { width: 20 }],
        },
      ).toBlob();

    // Jalur utama Electron: tulis melalui IPC ke folder Downloads bawaan OS.
    if (typeof window !== 'undefined' && window.electronAPI?.saveTemplateFile) {
      const base64Data = await blobToBase64(blob);
      const result = await window.electronAPI.saveTemplateFile({
        fileName,
        format: fileExt,
        base64Data,
      });
      if (!result.success) throw new Error(result.message || 'Gagal menyimpan file ke Downloads.');
      return { success: true, fileName, filePath: result.filePath };
    }

    // Fallback saat dashboard dijalankan di browser biasa.
    downloadBlob(blob, fileName);
    return { success: true, fileName };
  } catch (error) {
    console.error('[TEMPLATE GENERATOR] Gagal mengunduh template:', error);
    throw error;
  }
}
