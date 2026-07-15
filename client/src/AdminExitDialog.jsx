import React, { useState, useEffect, useRef } from 'react';
import { ShieldCheck, X, Eye, EyeOff, LogOut, AlertCircle } from 'lucide-react';
import { apiCall, settleWithin } from './api.js';

const SERVER_URL = sessionStorage.getItem('server_url') || 'http://localhost:3001';

/**
 * Dialog keluar darurat dari aplikasi kiosk.
 * Dipanggil dengan shortcut Ctrl+Alt+Q atau klik 5x di pojok kiri bawah layar login.
 */
export default function AdminExitDialog({ onClose }) {
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 100);
  }, []);

  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const doExit = async () => {
    const sessionId = sessionStorage.getItem('session_id');
    if (sessionId) {
      await apiCall(`${SERVER_URL}/api/auth/logout`, {
        method: 'POST',
        timeoutMs: 2_000,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId }),
      }).catch(() => {});
    }
    window.electronAPI?.quitApp();
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!password.trim()) return;

    setIsLoading(true);
    setError('');

    // Cek password darurat lokal melalui main process.
    const isLocalMatch = await settleWithin(
      window.electronAPI?.verifyEmergencyPassword?.(password),
      3_000,
      false,
    );
    if (isLocalMatch) {
      await doExit();
      return;
    }

    // Jika bukan password lokal, coba verifikasi ke server
    try {
      const result = await apiCall(`${SERVER_URL}/api/admin/verify-password`, {
        method: 'POST',
        timeoutMs: 6_000,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });

      if (result.ok && result.data?.success) {
        await doExit();
      } else {
        setError(result.data?.message || 'Password salah.');
        setPassword('');
        inputRef.current?.focus();
      }
    } catch {
      setError('Server tidak dapat dijangkau. Gunakan password keluar darurat PC siswa.');
      setPassword('');
      inputRef.current?.focus();
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-sm mx-4 overflow-hidden">
        <div className="bg-gradient-to-r from-slate-800 to-slate-700 px-6 py-4 flex items-center justify-between border-b border-slate-700">
          <div className="flex items-center space-x-3">
            <div className="bg-amber-500/20 p-2 rounded-lg">
              <ShieldCheck className="w-5 h-5 text-amber-400" />
            </div>
            <div>
              <h2 className="text-white font-bold text-sm">Keluar Darurat</h2>
              <p className="text-slate-400 text-xs">Hanya untuk kondisi mendesak</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="flex items-center space-x-2 bg-red-500/15 border border-red-500/40 text-red-300 text-sm px-3 py-2.5 rounded-xl">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-400">Password keluar darurat</label>
            <div className="relative">
              <input
                ref={inputRef}
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Masukkan password..."
                className="w-full bg-slate-800 border border-slate-700 text-white rounded-xl px-4 py-3 pr-11 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent transition-all"
                disabled={isLoading}
                autoComplete="off"
              />
              <button
                type="button"
                onClick={() => setShowPassword((s) => !s)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors"
                tabIndex={-1}
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={!password.trim() || isLoading}
            className={`w-full py-3 rounded-xl font-semibold text-sm flex items-center justify-center space-x-2 transition-all ${
              !password.trim() || isLoading
                ? 'bg-amber-600/30 text-amber-600/50 cursor-not-allowed'
                : 'bg-amber-600 hover:bg-amber-500 text-white shadow-lg shadow-amber-500/20 active:scale-[0.98]'
            }`}
          >
            {isLoading ? (
              <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            ) : (
              <LogOut className="w-4 h-4" />
            )}
            <span>{isLoading ? 'Memverifikasi...' : 'Keluar Aplikasi'}</span>
          </button>

          <p className="text-center text-xs text-slate-600">
            Tekan <kbd className="bg-slate-800 rounded px-1 py-0.5 text-slate-400">Esc</kbd> untuk batal
          </p>
        </form>
      </div>
    </div>
  );
}
