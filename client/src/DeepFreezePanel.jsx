import React, { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  KeyRound,
  Loader2,
  RefreshCw,
  ShieldOff,
  Snowflake,
} from 'lucide-react';

const STATE_META = {
  loading: ['Memeriksa', 'border-slate-600 bg-slate-800 text-slate-300'],
  configuring: ['Memproses', 'border-blue-400/30 bg-blue-500/10 text-blue-300'],
  busy: ['Sedang digunakan', 'border-blue-400/30 bg-blue-500/10 text-blue-300'],
  frozen: ['Perlindungan aktif', 'border-cyan-400/30 bg-cyan-500/10 text-cyan-200'],
  pending_freeze: ['Aktif setelah restart', 'border-amber-400/30 bg-amber-500/10 text-amber-200'],
  pending_unfreeze: ['Terbuka setelah restart', 'border-amber-400/30 bg-amber-500/10 text-amber-200'],
  open: ['Mode terbuka', 'border-emerald-400/30 bg-emerald-500/10 text-emerald-200'],
  feature_not_installed: ['Belum diaktifkan', 'border-slate-500/30 bg-slate-700/30 text-slate-300'],
  feature_pending_restart: ['Instalasi menunggu restart', 'border-amber-400/30 bg-amber-500/10 text-amber-200'],
  unsupported_edition: ['Windows tidak didukung', 'border-red-400/30 bg-red-500/10 text-red-200'],
  unsupported_platform: ['Sistem tidak didukung', 'border-red-400/30 bg-red-500/10 text-red-200'],
  partial: ['Konfigurasi belum lengkap', 'border-amber-400/30 bg-amber-500/10 text-amber-200'],
  error: ['Status gagal dibaca', 'border-red-400/30 bg-red-500/10 text-red-200'],
};

export default function DeepFreezePanel({
  status = {},
  busy = false,
  onRefresh,
  onConfigure,
  onElevate,
}) {
  const [confirmation, setConfirmation] = useState(null);
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState(null);
  const state = status.state || 'loading';
  const [stateLabel, stateClass] = STATE_META[state] || STATE_META.error;
  const supported = status.supported !== false
    && !['unsupported_edition', 'unsupported_platform'].includes(state);
  const isAdmin = status.is_admin === true;
  const currentlyFrozen = status.current_frozen === true;
  const nextFrozen = status.next_frozen === true;

  const begin = (action) => {
    setConfirmation(action);
    setPassword('');
    setMessage(null);
  };

  const submit = async () => {
    if (!password) {
      setMessage({ ok: false, text: 'Masukkan password Kepala Lab.' });
      return;
    }
    const action = confirmation;
    const result = action === 'elevate'
      ? await onElevate?.(password)
      : await onConfigure?.(action, password);
    if (result?.success) {
      setMessage({ ok: true, text: result.message || 'Perintah berhasil diproses.' });
      setPassword('');
      if (action !== 'elevate') setConfirmation(null);
    } else {
      setMessage({ ok: false, text: result?.message || 'Perintah tidak dapat diproses.' });
    }
  };

  const confirmationCopy = confirmation === 'freeze'
    ? {
        title: 'Aktifkan perlindungan?',
        text: 'Perubahan pada drive sistem akan dibuang setelah restart. Windows Update dan instalasi aplikasi sebaiknya dilakukan saat mode terbuka.',
        button: 'Izinkan & aktifkan',
      }
    : confirmation === 'unfreeze'
      ? {
          title: 'Buka perlindungan?',
          text: 'Mode terbuka berlaku setelah restart. Perubahan pada sesi beku yang sedang berjalan tetap akan dibuang.',
          button: 'Izinkan mode terbuka',
        }
      : {
          title: 'Minta izin Administrator?',
          text: 'Aplikasi akan dijalankan ulang dan Windows menampilkan dialog UAC. Gunakan akun Administrator komputer.',
          button: 'Lanjutkan ke UAC',
        };

  return (
    <section className="rounded-2xl border border-cyan-400/20 bg-cyan-500/5 p-4">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 flex-none place-items-center rounded-xl bg-cyan-400/15 text-cyan-200">
          <Snowflake className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-sm font-semibold text-white">Izin Deep Freeze PC</p>
              <p className="mt-0.5 text-xs text-slate-400">Microsoft Unified Write Filter pada drive {status.system_drive || 'C:'}</p>
            </div>
            <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${stateClass}`}>
              {busy && state !== 'configuring' ? 'Memproses' : stateLabel}
            </span>
          </div>

          <p className="mt-3 text-xs leading-5 text-slate-300">
            {status.message || 'Memeriksa dukungan dan status perlindungan komputer ini.'}
          </p>

          <div className="mt-3 grid gap-2 text-[11px] text-slate-400 sm:grid-cols-2">
            <div className="rounded-xl border border-slate-700 bg-slate-900/60 px-3 py-2">
              Windows: <span className="font-semibold text-slate-200">{status.product_name || 'Sedang diperiksa'}</span>
            </div>
            <div className="rounded-xl border border-slate-700 bg-slate-900/60 px-3 py-2">
              Izin proses: <span className={`font-semibold ${isAdmin ? 'text-emerald-300' : 'text-amber-300'}`}>{isAdmin ? 'Administrator' : 'Standar'}</span>
            </div>
          </div>

          {status.restart_required && (
            <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-400/20 bg-amber-500/10 px-3 py-2 text-xs leading-5 text-amber-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 flex-none" /> Restart diperlukan untuk menerapkan perubahan mode. Aplikasi tidak akan restart otomatis.
            </div>
          )}

          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" onClick={onRefresh} disabled={busy} className="inline-flex items-center gap-2 rounded-xl border border-slate-600 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-800 disabled:opacity-50">
              <RefreshCw className={`h-3.5 w-3.5 ${busy ? 'animate-spin' : ''}`} /> Periksa status
            </button>
            {supported && !isAdmin && (
              <button type="button" onClick={() => begin('elevate')} disabled={busy} className="inline-flex items-center gap-2 rounded-xl bg-amber-600 px-3 py-2 text-xs font-semibold text-white hover:bg-amber-500 disabled:opacity-50">
                <KeyRound className="h-3.5 w-3.5" /> Izinkan Administrator
              </button>
            )}
            {supported && isAdmin && !nextFrozen && (
              <button type="button" onClick={() => begin('freeze')} disabled={busy} className="inline-flex items-center gap-2 rounded-xl bg-cyan-600 px-3 py-2 text-xs font-semibold text-white hover:bg-cyan-500 disabled:opacity-50">
                <Snowflake className="h-3.5 w-3.5" /> Aktifkan setelah restart
              </button>
            )}
            {supported && isAdmin && (currentlyFrozen || nextFrozen) && (
              <button type="button" onClick={() => begin('unfreeze')} disabled={busy} className="inline-flex items-center gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs font-semibold text-amber-200 hover:bg-amber-500/20 disabled:opacity-50">
                <ShieldOff className="h-3.5 w-3.5" /> Buka setelah restart
              </button>
            )}
          </div>

          {confirmation && (
            <div className="mt-4 rounded-2xl border border-slate-600 bg-slate-900 p-4">
              <p className="text-sm font-semibold text-white">{confirmationCopy.title}</p>
              <p className="mt-1 text-xs leading-5 text-slate-400">{confirmationCopy.text}</p>
              <label className="mt-3 block text-xs font-semibold text-slate-300">Password Kepala Lab</label>
              <input type="password" value={password} onChange={(event) => { setPassword(event.target.value); setMessage(null); }} onKeyDown={(event) => { if (event.key === 'Enter') submit(); }} autoComplete="off" className="mt-1.5 w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2.5 text-sm text-white outline-none focus:border-cyan-500" />
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" onClick={() => { setConfirmation(null); setMessage(null); }} disabled={busy} className="rounded-xl border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-800">Batal</button>
                <button type="button" onClick={submit} disabled={busy} className="inline-flex items-center gap-2 rounded-xl bg-cyan-600 px-3 py-2 text-xs font-semibold text-white hover:bg-cyan-500 disabled:opacity-50">
                  {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />} {confirmationCopy.button}
                </button>
              </div>
            </div>
          )}

          {message && <div className={`mt-3 rounded-xl border px-3 py-2 text-xs ${message.ok ? 'border-emerald-400/20 bg-emerald-500/10 text-emerald-200' : 'border-red-400/20 bg-red-500/10 text-red-200'}`}>{message.text}</div>}
        </div>
      </div>
    </section>
  );
}
