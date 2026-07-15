import React, { useEffect, useState } from 'react';
import {
  Bell,
  CheckCircle2,
  DownloadCloud,
  Loader2,
  Power,
  RefreshCw,
  Save,
  Server,
  KeyRound,
  Settings,
  X,
} from 'lucide-react';
import DeepFreezePanel from './DeepFreezePanel.jsx';

const STATUS_COPY = {
  idle: ['Belum diperiksa', 'Gunakan tombol di bawah untuk memeriksa versi terbaru.'],
  checking: ['Memeriksa pembaruan', 'Menghubungi GitHub Releases...'],
  available: ['Pembaruan tersedia', 'Versi baru siap diunduh.'],
  downloading: ['Mengunduh pembaruan', 'Aplikasi tetap dapat digunakan selama proses ini.'],
  downloaded: ['Pembaruan siap dipasang', 'Pasang sekarang atau tutup aplikasi untuk memasangnya otomatis.'],
  latest: ['Sudah versi terbaru', 'Tidak ada pembaruan yang perlu dipasang.'],
  error: ['Pemeriksaan gagal', 'Periksa koneksi internet lalu coba kembali.'],
  dev: ['Mode pengembangan', 'Pemeriksaan update aktif setelah aplikasi diinstal.'],
};

function Toggle({ checked, onChange, icon: Icon, title, description }) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-slate-700 bg-slate-800/70 p-4 transition hover:border-slate-600">
      <span className="mt-0.5 grid h-9 w-9 flex-none place-items-center rounded-xl bg-blue-500/10 text-blue-300">
        <Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-white">{title}</span>
        <span className="mt-1 block text-xs leading-5 text-slate-400">{description}</span>
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="peer sr-only"
      />
      <span className="relative mt-1 h-6 w-11 flex-none rounded-full bg-slate-600 transition peer-checked:bg-blue-600 after:absolute after:left-1 after:top-1 after:h-4 after:w-4 after:rounded-full after:bg-white after:transition-transform peer-checked:after:translate-x-5" />
    </label>
  );
}

function UpdateStatus({ status = {}, autoUpdate, onCheck, onDownload, onInstall }) {
  const state = status.state || 'idle';
  const [title, description] = STATUS_COPY[state] || STATUS_COPY.idle;
  const busy = state === 'checking' || state === 'downloading';

  return (
    <div className="rounded-2xl border border-blue-400/20 bg-blue-500/5 p-4">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 flex-none place-items-center rounded-xl bg-blue-500/15 text-blue-300">
          {state === 'latest' || state === 'downloaded'
            ? <CheckCircle2 className="h-5 w-5" />
            : busy
              ? <Loader2 className="h-5 w-5 animate-spin" />
              : <DownloadCloud className="h-5 w-5" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold text-white">{title}</p>
            {status.version && <span className="rounded-full bg-blue-400/10 px-2.5 py-1 font-mono text-[11px] text-blue-300">v{status.version}</span>}
          </div>
          <p className="mt-1 text-xs leading-5 text-slate-400">{state === 'error' && status.message ? status.message : description}</p>
          {state === 'downloading' && (
            <div className="mt-3">
              <div className="h-2 overflow-hidden rounded-full bg-slate-700">
                <div className="h-full rounded-full bg-blue-500 transition-all" style={{ width: `${Math.max(0, Math.min(100, status.percent || 0))}%` }} />
              </div>
              <p className="mt-1.5 text-right font-mono text-[11px] text-slate-400">{status.percent || 0}%</p>
            </div>
          )}
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onCheck}
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-xl border border-slate-600 px-3.5 py-2 text-xs font-semibold text-slate-200 transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${state === 'checking' ? 'animate-spin' : ''}`} />
          Periksa sekarang
        </button>
        {state === 'available' && !autoUpdate && (
          <button type="button" onClick={onDownload} className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-blue-500">
            <DownloadCloud className="h-3.5 w-3.5" /> Unduh
          </button>
        )}
        {state === 'downloaded' && (
          <button type="button" onClick={onInstall} className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-emerald-500">
            <Power className="h-3.5 w-3.5" /> Pasang & mulai ulang
          </button>
        )}
      </div>
    </div>
  );
}

export function ClientSettingsModal({
  open,
  settings = {},
  serverUrl,
  updateStatus,
  deepFreezeStatus,
  deepFreezeBusy,
  onClose,
  onSave,
  onCheck,
  onDownload,
  onInstall,
  onDeepFreezeRefresh,
  onDeepFreezeConfigure,
  onDeepFreezeElevate,
  branding = {},
}) {
  const [draft, setDraft] = useState({ autoUpdate: true, openAtLogin: true, notifyUpdates: true, serverUrl: '', registrationKey: '' });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);

  useEffect(() => {
    if (!open) return;
    setDraft({
      autoUpdate: settings.autoUpdate !== false,
      openAtLogin: settings.openAtLogin !== false,
      notifyUpdates: settings.notifyUpdates !== false,
      serverUrl: serverUrl || settings.serverUrl || '',
      registrationKey: settings.registrationKey || '',
    });
    setMessage(null);
  }, [open, serverUrl, settings]);

  useEffect(() => {
    if (open) onDeepFreezeRefresh?.();
  }, [open, onDeepFreezeRefresh]);

  if (!open) return null;

  const save = async () => {
    setSaving(true);
    setMessage(null);
    const result = await onSave(draft);
    setSaving(false);
    if (result?.success) setMessage({ ok: true, text: 'Pengaturan tersimpan untuk PC ini.' });
    else setMessage({ ok: false, text: result?.message || 'Pengaturan tidak dapat disimpan.' });
  };

  return (
    <div className="fixed inset-0 z-[150] grid place-items-center overflow-y-auto bg-slate-950/80 p-4 backdrop-blur-sm">
      <div className="my-6 w-full max-w-2xl overflow-hidden rounded-3xl border border-slate-700 bg-slate-900 text-white shadow-2xl">
        <div className="flex items-start justify-between border-b border-slate-800 px-6 py-5">
          <div className="flex items-center gap-3">
            <span className="grid h-11 w-11 place-items-center rounded-2xl bg-blue-600 text-white"><Settings className="h-5 w-5" /></span>
            <div>
              <h2 className="text-xl font-bold">Pengaturan {branding.product_name || 'LabKom'} Siswa</h2>
              <p className="mt-0.5 text-xs text-slate-400">PC ini · Versi {settings.appVersion || updateStatus?.currentVersion || '-'}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="rounded-xl p-2 text-slate-400 hover:bg-slate-800 hover:text-white" aria-label="Tutup pengaturan"><X className="h-5 w-5" /></button>
        </div>

        <div className="max-h-[72vh] space-y-5 overflow-y-auto px-6 py-5">
          <div>
            <label className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-200"><Server className="h-4 w-4 text-blue-300" /> Alamat server Admin</label>
            <input
              value={draft.serverUrl}
              onChange={(event) => setDraft((current) => ({ ...current, serverUrl: event.target.value }))}
              placeholder="http://192.168.1.10:3001"
              className="w-full rounded-xl border border-slate-700 bg-slate-800 px-4 py-3 font-mono text-sm text-white outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
            />
            <p className="mt-1.5 text-xs text-slate-500">Hanya alamat HTTP pada jaringan lokal yang diterima.</p>
          </div>

          <div>
            <label className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-200"><KeyRound className="h-4 w-4 text-amber-300" /> Kode pairing PC</label>
            <input
              type="password"
              inputMode="numeric"
              value={draft.registrationKey}
              onChange={(event) => setDraft((current) => ({ ...current, registrationKey: event.target.value }))}
              placeholder="Contoh: 123456"
              autoComplete="off"
              maxLength={256}
              className="w-full rounded-xl border border-slate-700 bg-slate-800 px-4 py-3 font-mono text-sm text-white outline-none transition focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20"
            />
            <p className="mt-1.5 text-xs text-slate-500">Gunakan kode 6 digit dari menu Server di Admin. Client lama masih dapat memakai kunci panjang.</p>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <Toggle checked={draft.openAtLogin} onChange={(value) => setDraft((current) => ({ ...current, openAtLogin: value }))} icon={Power} title="Mulai bersama Windows" description="Buka mode login siswa otomatis saat PC dinyalakan." />
            <Toggle checked={draft.autoUpdate} onChange={(value) => setDraft((current) => ({ ...current, autoUpdate: value }))} icon={DownloadCloud} title="Update otomatis" description="Periksa dan unduh rilis terbaru dari GitHub." />
            <div className="md:col-span-2">
              <Toggle checked={draft.notifyUpdates} onChange={(value) => setDraft((current) => ({ ...current, notifyUpdates: value }))} icon={Bell} title="Notifikasi pembaruan" description="Tampilkan pemberitahuan Windows dan status di layar saat versi baru tersedia." />
            </div>
          </div>

          <UpdateStatus status={updateStatus} autoUpdate={draft.autoUpdate} onCheck={onCheck} onDownload={onDownload} onInstall={onInstall} />

          <DeepFreezePanel
            status={deepFreezeStatus}
            busy={deepFreezeBusy}
            onRefresh={onDeepFreezeRefresh}
            onConfigure={onDeepFreezeConfigure}
            onElevate={onDeepFreezeElevate}
          />
          {message && <div className={`rounded-xl border px-4 py-3 text-sm ${message.ok ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' : 'border-red-500/30 bg-red-500/10 text-red-300'}`}>{message.text}</div>}
        </div>

        <div className="flex justify-end gap-3 border-t border-slate-800 bg-slate-950/40 px-6 py-4">
          <button type="button" onClick={onClose} className="rounded-xl border border-slate-700 px-4 py-2.5 text-sm font-semibold text-slate-300 hover:bg-slate-800">Tutup</button>
          <button type="button" onClick={save} disabled={saving} className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Simpan pengaturan
          </button>
        </div>
      </div>
    </div>
  );
}

export function ClientUpdateNotice({ status = {}, onOpen, onInstall }) {
  if (!['available', 'downloading', 'downloaded'].includes(status.state)) return null;
  const downloaded = status.state === 'downloaded';
  return (
    <div className="fixed right-5 top-5 z-[120] w-[min(22rem,calc(100vw-2.5rem))] rounded-2xl border border-blue-400/30 bg-slate-900 p-4 text-white shadow-2xl">
      <div className="flex items-start gap-3">
        <span className={`grid h-10 w-10 flex-none place-items-center rounded-xl ${downloaded ? 'bg-emerald-500/15 text-emerald-300' : 'bg-blue-500/15 text-blue-300'}`}>
          {status.state === 'downloading' ? <Loader2 className="h-5 w-5 animate-spin" /> : downloaded ? <CheckCircle2 className="h-5 w-5" /> : <DownloadCloud className="h-5 w-5" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-blue-300">Pembaruan aplikasi</p>
          <p className="mt-1 text-sm font-semibold">{downloaded ? 'Versi baru siap dipasang' : status.state === 'downloading' ? `Mengunduh versi ${status.version || 'baru'} · ${status.percent || 0}%` : `Versi ${status.version || 'baru'} tersedia`}</p>
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={onOpen} className="rounded-lg border border-slate-600 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-800">Lihat detail</button>
            {downloaded && <button type="button" onClick={onInstall} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500">Pasang sekarang</button>}
          </div>
        </div>
      </div>
    </div>
  );
}
