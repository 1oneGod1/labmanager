import React from 'react';
import { AlertTriangle, HardDrive, Loader2, RefreshCw, Snowflake, Unlock } from 'lucide-react';

const STATE_LABELS = {
  unsupported_platform: 'Bukan Windows',
  unsupported_edition: 'Tidak didukung',
  feature_not_installed: 'Belum disiapkan',
  feature_pending_restart: 'Perlu restart',
  frozen: 'Beku aktif',
  open: 'Mode terbuka',
  pending_freeze: 'Beku setelah restart',
  pending_unfreeze: 'Terbuka setelah restart',
  partial: 'Perlu diperbaiki',
  configuring: 'Memproses',
  busy: 'Sedang sibuk',
  error: 'Gagal dibaca',
};

function getTone(status) {
  if (!status) return 'text-slate-400 bg-slate-500/10 border-slate-500/20';
  if (status.success === false || ['error', 'partial'].includes(status.state)) {
    return 'text-red-300 bg-red-500/10 border-red-500/25';
  }
  if (['frozen', 'pending_freeze'].includes(status.state)) {
    return 'text-cyan-300 bg-cyan-500/10 border-cyan-500/25';
  }
  if (['open', 'pending_unfreeze'].includes(status.state)) {
    return 'text-emerald-300 bg-emerald-500/10 border-emerald-500/25';
  }
  return 'text-amber-300 bg-amber-500/10 border-amber-500/25';
}

export default function DeepFreezeControls({
  pcName,
  status,
  offline = false,
  busy = false,
  onRequest,
  onRefresh,
}) {
  const state = status?.state || 'unknown';
  const isBusy = busy || ['configuring', 'busy'].includes(state);
  const unsupported = ['unsupported_platform', 'unsupported_edition'].includes(state);
  const nextFrozen = status?.next_frozen === true;
  const action = nextFrozen ? 'unfreeze' : 'freeze';
  const overlayUsed = Number(status?.overlay_consumption_mb) || 0;
  const overlayFree = Number(status?.overlay_available_mb) || 0;

  return (
    <section className="mx-3 mb-3 rounded-xl border border-slate-700/70 bg-slate-950/40 p-3 text-left">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <div className="rounded-lg bg-cyan-500/10 p-2 text-cyan-300"><HardDrive className="h-4 w-4" /></div>
          <div>
            <strong className="block text-xs text-slate-100">Deep Freeze drive sistem</strong>
            <span className="block text-[10px] text-slate-400">{pcName}</span>
          </div>
        </div>
        <span className={`rounded-full border px-2 py-1 text-[9px] font-semibold ${getTone(status)}`}>
          {STATE_LABELS[state] || 'Belum diperiksa'}
        </span>
      </div>

      <p className="mt-3 text-[10px] leading-4 text-slate-400">
        {status?.message || 'Periksa dukungan UWF sebelum mengaktifkan mode beku.'}
      </p>

      {status?.product_name && (
        <p className="mt-2 truncate text-[9px] text-slate-500" title={status.product_name}>{status.product_name}</p>
      )}

      {(overlayUsed > 0 || overlayFree > 0) && (
        <div className="mt-2 grid grid-cols-2 gap-2 text-[9px] text-slate-400">
          <span>Overlay terpakai <strong className="block text-slate-200">{overlayUsed} MB</strong></span>
          <span>Overlay tersedia <strong className="block text-slate-200">{overlayFree} MB</strong></span>
        </div>
      )}

      {status?.requires_admin && (
        <div className="mt-2 flex gap-2 rounded-lg bg-amber-500/10 p-2 text-[9px] leading-4 text-amber-200">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
          Client harus dijalankan dengan hak Administrator.
        </div>
      )}

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={onRefresh}
          disabled={offline || isBusy}
          className="inline-flex h-9 items-center justify-center gap-1 rounded-lg border border-slate-600 px-3 text-[10px] text-slate-300 hover:bg-slate-800 disabled:opacity-40"
        >
          {isBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          Status
        </button>
        <button
          type="button"
          onClick={() => onRequest?.(action)}
          disabled={offline || isBusy || unsupported}
          className={`inline-flex h-9 flex-1 items-center justify-center gap-1 rounded-lg px-3 text-[10px] font-semibold disabled:opacity-40 ${
            nextFrozen
              ? 'bg-emerald-500 text-slate-950 hover:bg-emerald-400'
              : 'bg-cyan-500 text-slate-950 hover:bg-cyan-400'
          }`}
        >
          {nextFrozen ? <Unlock className="h-3 w-3" /> : <Snowflake className="h-3 w-3" />}
          {nextFrozen ? 'Buka setelah restart' : 'Bekukan setelah restart'}
        </button>
      </div>
    </section>
  );
}
