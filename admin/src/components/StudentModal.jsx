import { useState, useEffect } from 'react';
import { X, User, Eye, EyeOff, Loader2 } from 'lucide-react';
import { adminJsonRequest } from '../apiConfig.js';


/**
 * Modal untuk Tambah / Edit Siswa
 * Props:
 *   student  – data siswa yang diedit (null = mode tambah baru)
 *   onClose  – callback tutup modal
 *   onSaved  – callback setelah berhasil simpan
 */
export default function StudentModal({ student, onClose, onSaved }) {
  const isEdit = !!student;

  const [form, setForm] = useState({
    nis:          student?.nis        || '',
    nama_lengkap: student?.nama_lengkap || '',
    kelas:        student?.kelas       || '',
    password:     '',
    is_active:    student ? String(student.is_active) : '1',
  });
  const [showPassword, setShowPassword] = useState(false);
  const [loading,      setLoading]      = useState(false);
  const [error,        setError]        = useState('');

  // Tutup dengan Escape
  useEffect(() => {
    const handler = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const handleChange = (e) => {
    setForm(prev => ({ ...prev, [e.target.name]: e.target.value }));
    setError('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!form.nis || !form.nama_lengkap) {
      return setError('NIS dan Nama Lengkap wajib diisi.');
    }
    if (!isEdit && !form.password) {
      return setError('Password wajib diisi untuk siswa baru.');
    }

    setLoading(true);
    setError('');
    try {
      const requestPath = isEdit ? `/api/students/${student.id}` : '/api/students';
      const method = isEdit ? 'PUT' : 'POST';

      const body = { ...form, is_active: parseInt(form.is_active) };
      if (isEdit && !form.password) delete body.password;

      const { response, data } = await adminJsonRequest(requestPath, {
        method,
        body: JSON.stringify(body),
      });

      if (!response.ok || !data.success) {
        setError(data.message || `Gagal menyimpan data (HTTP ${response.status}).`);
      } else {
        onSaved();
      }
    } catch (requestError) {
      setError(requestError.message || 'Koneksi ke backend Admin gagal.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md animate-in zoom-in-95 duration-500">
        {/* Header */}
        <div className="bg-slate-900 text-white p-5 rounded-t-2xl flex justify-between items-center">
          <div className="flex items-center space-x-3">
            <User className="w-5 h-5 text-blue-400" />
            <h3 className="font-bold text-lg">{isEdit ? 'Edit Data Siswa' : 'Tambah Siswa Baru'}</h3>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* NIS */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">NIS <span className="text-red-500">*</span></label>
            <input
              name="nis" value={form.nis} onChange={handleChange}
              disabled={isEdit}
              placeholder="Masukkan NIS..."
              className="w-full px-4 py-2.5 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none text-sm disabled:bg-slate-100 disabled:cursor-not-allowed"
            />
          </div>

          {/* Nama */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Nama Lengkap <span className="text-red-500">*</span></label>
            <input
              name="nama_lengkap" value={form.nama_lengkap} onChange={handleChange}
              placeholder="Masukkan nama lengkap..."
              className="w-full px-4 py-2.5 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none text-sm"
            />
          </div>

          {/* Kelas */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Kelas</label>
            <input
              name="kelas" value={form.kelas} onChange={handleChange}
              placeholder="Contoh: XII TKJ 1"
              className="w-full px-4 py-2.5 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none text-sm"
            />
          </div>

          {/* Password */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Password {isEdit && <span className="text-slate-400 font-normal">(kosongkan jika tidak diubah)</span>}
              {!isEdit && <span className="text-red-500"> *</span>}
            </label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                name="password" value={form.password} onChange={handleChange}
                placeholder={isEdit ? 'Kosongkan jika tidak diubah...' : 'Masukkan password...'}
                className="w-full px-4 py-2.5 pr-11 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none text-sm"
              />
              <button
                type="button" onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Status – hanya saat edit */}
          {isEdit && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Status Akun</label>
              <select
                name="is_active" value={form.is_active} onChange={handleChange}
                className="w-full px-4 py-2.5 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none text-sm"
              >
                <option value="1">Aktif</option>
                <option value="0">Nonaktif</option>
              </select>
            </div>
          )}

          {/* Error */}
          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-2.5">{error}</p>
          )}

          {/* Actions */}
          <div className="flex space-x-3 pt-2">
            <button
              type="button" onClick={onClose}
              className="flex-1 py-2.5 bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 rounded-xl font-medium transition-colors"
            >
              Batal
            </button>
            <button
              type="submit" disabled={loading}
              className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded-xl font-medium transition-colors flex items-center justify-center space-x-2"
            >
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              <span>{isEdit ? 'Simpan Perubahan' : 'Tambah Siswa'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
