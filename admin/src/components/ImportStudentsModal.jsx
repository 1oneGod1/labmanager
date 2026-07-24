import { useState, useEffect, useRef } from 'react';
import {
  X, FileSpreadsheet, Download, Upload, CheckCircle2, AlertCircle,
  FileText, Loader2, RefreshCw, Check, AlertTriangle, Layers,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { adminJsonRequest, API_BASE } from '../apiConfig.js';
import { downloadStudentTemplateLocal } from '../utils/templateGenerator.js';

/**
 * Modal Import Data Siswa dari Berkas Excel (.xlsx, .xls) atau CSV
 * Props:
 *   onClose    - Callback untuk menutup modal
 *   onImported - Callback ketika import data siswa berhasil
 *   showToast  - Callback untuk menampilkan notifikasi toast
 */
export default function ImportStudentsModal({ onClose, onImported, showToast }) {
  const fileInputRef = useRef(null);
  const [file, setFile] = useState(null);
  const [parsedRows, setParsedRows] = useState([]);
  const [overwriteExisting, setOverwriteExisting] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [loading, setLoading] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState('');

  // Tutup dengan tombol Escape
  useEffect(() => {
    const handler = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  // Fungsi untuk mengunduh template Excel / CSV (100% lokal & instan)
  const handleDownloadTemplate = (format = 'xlsx') => {
    try {
      downloadStudentTemplateLocal(format);
      showToast?.(`Template ${format.toUpperCase()} berhasil diunduh!`);
    } catch {
      showToast?.('Gagal mengunduh template.', 'error');
    }
  };

  // Fungsi parsing berkas Excel/CSV
  const processFile = async (selectedFile) => {
    if (!selectedFile) return;

    const fileName = selectedFile.name.toLowerCase();
    if (!fileName.endsWith('.xlsx') && !fileName.endsWith('.xls') && !fileName.endsWith('.csv')) {
      setError('Format berkas tidak didukung. Silakan gunakan .xlsx, .xls, atau .csv.');
      return;
    }

    setParsing(true);
    setError('');
    setFile(selectedFile);

    try {
      const dataBuffer = await selectedFile.arrayBuffer();
      const workbook = XLSX.read(dataBuffer, { type: 'array' });
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];

      const rawJson = XLSX.utils.sheet_to_json(worksheet, { defval: '' });

      if (rawJson.length === 0) {
        setError('Berkas Excel/CSV kosong atau tidak berisi data.');
        setParsedRows([]);
        setParsing(false);
        return;
      }

      // Normalisasi nama kolom & deteksi duplikat NIS internal
      const nisSeen = new Set();
      const processed = rawJson.map((row, index) => {
        const nis = String(row.nis ?? row.NIS ?? row.nisn ?? row.username ?? row['No. Induk'] ?? '').trim();
        const nama_lengkap = String(row.nama_lengkap ?? row.Nama ?? row.nama ?? row.name ?? row['Nama Lengkap'] ?? '').trim();
        const kelas = String(row.kelas ?? row.Kelas ?? row.class ?? row['Kelas/Rombel'] ?? '').trim();
        const password = String(row.password ?? row.Password ?? row.pass ?? '').trim();

        const rowNumber = index + 2; // header di baris 1
        const missingFields = [];
        if (!nis) missingFields.push('NIS');
        if (!nama_lengkap) missingFields.push('Nama');
        if (!password) missingFields.push('Password');

        let status = 'valid';
        let statusText = 'Siap diimpor';

        if (missingFields.length > 0) {
          status = 'invalid';
          statusText = `${missingFields.join(', ')} kosong`;
        } else if (nisSeen.has(nis)) {
          status = 'duplicate_file';
          statusText = 'NIS duplikat di berkas ini';
        } else {
          nisSeen.add(nis);
        }

        return {
          rowNumber,
          nis,
          nama_lengkap,
          kelas,
          password,
          status,
          statusText,
        };
      });

      setParsedRows(processed);
    } catch (err) {
      console.error('[IMPORT-EXCEL] Gagal membaca berkas:', err);
      setError(`Gagal membaca berkas Excel/CSV: ${err.message}`);
      setParsedRows([]);
    } finally {
      setParsing(false);
    }
  };

  const handleFileChange = (e) => {
    const selected = e.target.files[0];
    if (selected) processFile(selected);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragOver(false);
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile) processFile(droppedFile);
  };

  const resetFile = () => {
    setFile(null);
    setParsedRows([]);
    setError('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // Submit data valid ke server
  const handleSubmitImport = async () => {
    const validRows = parsedRows.filter((r) => r.status === 'valid' || r.status === 'duplicate_file');

    if (validRows.length === 0) {
      return setError('Tidak ada baris data siswa yang valid untuk diimpor.');
    }

    setLoading(true);
    setError('');

    try {
      const payload = {
        students: validRows.map((r) => ({
          nis: r.nis,
          nama_lengkap: r.nama_lengkap,
          kelas: r.kelas,
          password: r.password,
        })),
        overwriteExisting,
      };

      const { response, data } = await adminJsonRequest('/api/students/import', {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      if (!response.ok || !data.success) {
        setError(data.message || 'Gagal memproses import data siswa.');
      } else {
        showToast?.(data.message || 'Import data siswa berhasil!');
        onImported();
      }
    } catch (err) {
      setError(err.message || 'Koneksi ke server backend gagal.');
    } finally {
      setLoading(false);
    }
  };

  const validCount = parsedRows.filter((r) => r.status === 'valid').length;
  const invalidCount = parsedRows.filter((r) => r.status !== 'valid').length;

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl overflow-hidden flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-300">
        
        {/* Header */}
        <div className="bg-slate-900 text-white p-5 flex justify-between items-center shrink-0">
          <div className="flex items-center space-x-3">
            <FileSpreadsheet className="w-6 h-6 text-emerald-400" />
            <div>
              <h3 className="font-bold text-lg leading-tight">Import Data Login Siswa</h3>
              <p className="text-xs text-slate-400 mt-0.5">Unggah berkas Excel (.xlsx) atau CSV data akun login siswa</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors p-1 rounded-lg">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 overflow-y-auto space-y-5 flex-1">
          
          {/* Download Template Bar */}
          <div className="bg-blue-50/80 border border-blue-200 rounded-xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div className="flex items-center space-x-3">
              <div className="p-2 bg-blue-500/10 text-blue-600 rounded-lg">
                <FileText className="w-5 h-5" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-slate-800">Format Template Data Siswa</h4>
                <p className="text-xs text-slate-500">Gunakan format kolom: <code className="bg-blue-100/70 text-blue-800 px-1 py-0.5 rounded font-mono">nis</code>, <code className="bg-blue-100/70 text-blue-800 px-1 py-0.5 rounded font-mono">nama_lengkap</code>, <code className="bg-blue-100/70 text-blue-800 px-1 py-0.5 rounded font-mono">kelas</code>, <code className="bg-blue-100/70 text-blue-800 px-1 py-0.5 rounded font-mono">password</code></p>
              </div>
            </div>
            <div className="flex items-center space-x-2 shrink-0">
              <button
                type="button"
                onClick={() => handleDownloadTemplate('xlsx')}
                className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition-colors shadow-sm"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Template Excel (.xlsx)</span>
              </button>
              <button
                type="button"
                onClick={() => handleDownloadTemplate('csv')}
                className="px-3 py-1.5 bg-slate-700 hover:bg-slate-800 text-white rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition-colors shadow-sm"
              >
                <Download className="w-3.5 h-3.5" />
                <span>CSV</span>
              </button>
            </div>
          </div>

          {/* Upload Drop Zone / Selected File View */}
          {!file ? (
            <div
              onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
              onDragLeave={() => setIsDragOver(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-all flex flex-col items-center justify-center space-y-3 ${
                isDragOver ? 'border-blue-500 bg-blue-50/50 scale-[0.99]' : 'border-slate-300 hover:border-blue-400 hover:bg-slate-50'
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx, .xls, .csv"
                onChange={handleFileChange}
                className="hidden"
              />
              <div className="w-14 h-14 bg-emerald-50 text-emerald-600 rounded-2xl flex items-center justify-center border border-emerald-200 shadow-sm">
                <Upload className="w-7 h-7" />
              </div>
              <div>
                <p className="text-sm font-bold text-slate-800">Tarik & lepas berkas Excel / CSV di sini</p>
                <p className="text-xs text-slate-400 mt-1">atau klik untuk memilih berkas (.xlsx, .xls, .csv)</p>
              </div>
            </div>
          ) : (
            <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <div className="p-2.5 bg-emerald-100 text-emerald-700 rounded-xl font-bold text-xs uppercase">
                  {file.name.split('.').pop()}
                </div>
                <div>
                  <h4 className="text-sm font-bold text-slate-800">{file.name}</h4>
                  <p className="text-xs text-slate-400">{(file.size / 1024).toFixed(1)} KB • {parsedRows.length} baris terdeteksi</p>
                </div>
              </div>
              <button
                type="button"
                onClick={resetFile}
                className="px-3 py-1.5 border border-slate-300 hover:bg-white text-slate-600 rounded-xl text-xs font-medium transition-colors flex items-center space-x-1"
              >
                <RefreshCw className="w-3.5 h-3.5 text-slate-400" />
                <span>Ganti Berkas</span>
              </button>
            </div>
          )}

          {/* Parsing Spinner */}
          {parsing && (
            <div className="flex items-center justify-center py-8 space-x-2 text-slate-500">
              <Loader2 className="w-5 h-5 animate-spin text-blue-500" />
              <span className="text-sm">Membaca berkas data siswa...</span>
            </div>
          )}

          {/* Preview Statistics & Table */}
          {parsedRows.length > 0 && (
            <div className="space-y-3 animate-in fade-in duration-300">
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center space-x-2">
                  <span className="font-semibold text-slate-700">Preview Data ({parsedRows.length} Baris):</span>
                  <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 font-bold rounded-md flex items-center space-x-1">
                    <CheckCircle2 className="w-3 h-3" />
                    <span>{validCount} Siap</span>
                  </span>
                  {invalidCount > 0 && (
                    <span className="px-2 py-0.5 bg-amber-100 text-amber-800 font-bold rounded-md flex items-center space-x-1">
                      <AlertTriangle className="w-3 h-3" />
                      <span>{invalidCount} Dilewati/Peringatan</span>
                    </span>
                  )}
                </div>
              </div>

              {/* Table */}
              <div className="border border-slate-200 rounded-xl overflow-hidden max-h-56 overflow-y-auto text-xs">
                <table className="w-full text-left border-collapse">
                  <thead className="bg-slate-100 text-slate-600 sticky top-0 border-b border-slate-200 font-semibold">
                    <tr>
                      <th className="p-2.5 w-12 text-center">#</th>
                      <th className="p-2.5">NIS</th>
                      <th className="p-2.5">Nama Lengkap</th>
                      <th className="p-2.5">Kelas</th>
                      <th className="p-2.5">Password</th>
                      <th className="p-2.5 text-right">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {parsedRows.map((row) => (
                      <tr key={row.rowNumber} className={row.status !== 'valid' ? 'bg-amber-50/40' : 'hover:bg-slate-50'}>
                        <td className="p-2.5 text-center text-slate-400 font-mono">{row.rowNumber}</td>
                        <td className="p-2.5 font-bold text-slate-800">{row.nis || '—'}</td>
                        <td className="p-2.5 text-slate-700">{row.nama_lengkap || '—'}</td>
                        <td className="p-2.5 text-slate-500">{row.kelas || '—'}</td>
                        <td className="p-2.5 text-slate-500 font-mono">{row.password ? '••••••••' : '—'}</td>
                        <td className="p-2.5 text-right">
                          <span
                            className={`px-2 py-0.5 rounded-full font-medium text-[11px] inline-flex items-center space-x-1 ${
                              row.status === 'valid'
                                ? 'bg-emerald-100 text-emerald-700'
                                : row.status === 'duplicate_file'
                                ? 'bg-amber-100 text-amber-700'
                                : 'bg-red-100 text-red-700'
                            }`}
                          >
                            {row.status === 'valid' ? <Check className="w-3 h-3 mr-0.5" /> : <AlertCircle className="w-3 h-3 mr-0.5" />}
                            <span>{row.statusText}</span>
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Overwrite Checkbox Option */}
              <div className="pt-1">
                <label className="flex items-center space-x-2 text-xs text-slate-700 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={overwriteExisting}
                    onChange={(e) => setOverwriteExisting(e.target.checked)}
                    className="w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500"
                  />
                  <span>Timpa / perbarui data nama & kelas jika NIS siswa sudah pernah terdaftar</span>
                </label>
              </div>
            </div>
          )}

          {/* Error Banner */}
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 p-3.5 rounded-xl text-xs flex items-start space-x-2 animate-in fade-in">
              <AlertCircle className="w-4 h-4 shrink-0 text-red-500 mt-0.5" />
              <span>{error}</span>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="bg-slate-50 p-4 border-t border-slate-200 flex justify-end space-x-3 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2.5 border border-slate-300 text-slate-700 hover:bg-white rounded-xl text-sm font-medium transition-colors"
          >
            Batal
          </button>
          <button
            type="button"
            disabled={loading || parsedRows.length === 0 || validCount === 0}
            onClick={handleSubmitImport}
            className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-300 text-white rounded-xl text-sm font-semibold transition-colors flex items-center space-x-2 shadow-sm"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            <span>{loading ? 'Memproses Import...' : `Proses Import (${validCount} Siswa)`}</span>
          </button>
        </div>

      </div>
    </div>
  );
}
