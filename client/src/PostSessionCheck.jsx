import React, { useMemo, useState } from 'react';
import {
  MonitorSmartphone, Sparkles, UserRoundCheck, Settings, FolderLock,
  Info, Check, AlertTriangle, LogOut, Loader2,
} from 'lucide-react';
import { apiCall } from './api.js';

const CHECK_ITEMS = [
  { key: 'hw', title: 'Perangkat keras', subtitle: 'PC, monitor, keyboard, dan mouse tetap utuh', icon: MonitorSmartphone },
  { key: 'clean', title: 'Kebersihan & kerapian', subtitle: 'Meja bersih dan kursi sudah dirapikan', icon: Sparkles },
  { key: 'account', title: 'Akun pribadi', subtitle: 'Email, WhatsApp Web, dan akun lain sudah logout', icon: UserRoundCheck },
  { key: 'system', title: 'Sistem & desktop', subtitle: 'Tidak ada aplikasi atau pengaturan yang diubah tanpa izin', icon: Settings },
  { key: 'file', title: 'File & riwayat browser', subtitle: 'Tidak ada file pribadi atau data sensitif tertinggal', icon: FolderLock },
];

const initialChecks = Object.fromEntries(CHECK_ITEMS.map(({ key }) => [key, { status: null, note: '' }]));

export default function PostSessionCheck({ studentData, serverUrl, serverOnline = true, onLogoutConfirmed }) {
  const [checks, setChecks] = useState(initialChecks);
  const [confirmed, setConfirmed] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  const isFormValid = useMemo(() => (
    confirmed && CHECK_ITEMS.every(({ key }) => {
      const item = checks[key];
      return item.status && (item.status !== 'bad' || item.note.trim());
    })
  ), [checks, confirmed]);

  const updateCheck = (key, patch) => {
    setChecks((current) => ({ ...current, [key]: { ...current[key], ...patch } }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!isFormValid || isSubmitting) return;
    setIsSubmitting(true);
    setSubmitError('');
    if (!serverOnline) {
      setSubmitError('Server terputus; sesi akan ditutup secara lokal.');
      setTimeout(() => onLogoutConfirmed(), 500);
      return;
    }

    try {
      const response = await apiCall(`${serverUrl}/api/checks`, {
        method: 'POST',
        timeoutMs: 6_000,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: sessionStorage.getItem('session_id') || null,
          nis: studentData?.nis || '-',
          nama_lengkap: studentData?.nama_lengkap || '-',
          pc_name: studentData?.pc_name || sessionStorage.getItem('pc_name') || '-',
          check_type: 'post',
          hw_status: checks.hw.status,
          hw_note: checks.hw.note || null,
          cleanliness_status: checks.clean.status,
          cleanliness_note: checks.clean.note || null,
          account_status: checks.account.status,
          account_note: checks.account.note || null,
          system_status: checks.system.status,
          system_note: checks.system.note || null,
          file_status: checks.file.status,
          file_note: checks.file.note || null,
        }),
      });
      if (!response.ok || !response.data?.success) {
        throw new Error(response.data?.message || 'Gagal menyimpan');
      }
      onLogoutConfirmed();
    } catch (error) {
      setSubmitError('Checklist gagal tersimpan; proses keluar tetap dilanjutkan.');
      console.error(error);
      setTimeout(() => onLogoutConfirmed(), 1500);
    } finally {
      setIsSubmitting(false);
    }
  };

  const pcName = studentData?.pc_name || sessionStorage.getItem('pc_name') || 'PC Lab';
  const initials = (studentData?.nama_lengkap || 'Siswa')
    .split(' ')
    .slice(0, 2)
    .map((word) => word[0])
    .join('')
    .toUpperCase();

  return (
    <div className="student-condition-page">
      <header className="student-condition-header">
        <div className="student-condition-avatar">{initials}</div>
        <div className="student-condition-title">
          <h1>Kondisi komputer — setelah digunakan</h1>
          <p>{studentData?.nama_lengkap || 'Siswa'} · {pcName} · mengakhiri sesi</p>
        </div>
        <div className="student-steps" aria-label="Progres mengakhiri sesi">
          <span className="student-step is-done"><span className="student-step-number"><Check /></span>Digunakan</span>
          <span className="student-step-separator">›</span>
          <span className="student-step is-active"><span className="student-step-number">2</span>Cek kondisi</span>
          <span className="student-step-separator">›</span>
          <span className="student-step"><span className="student-step-number">3</span>Keluar</span>
        </div>
      </header>

      <main className="student-condition-body">
        <section className="student-summary">
          <div className="student-summary-header">Ringkasan sesi <span>{new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}</span></div>
          <div className="student-summary-grid">
            <div><span>Siswa</span><strong>{studentData?.nis || '—'}</strong></div>
            <div><span>Kelas</span><strong>{studentData?.kelas || '—'}</strong></div>
            <div><span>Komputer</span><strong>{pcName}</strong></div>
            <div><span>Status</span><strong style={{ color: 'var(--student-green)' }}>Selesai</strong></div>
          </div>
        </section>

        <div className="student-info-banner">
          <Info />
          <span>Pastikan komputer tetap dalam kondisi yang sama seperti saat kamu mulai. Laporkan kerusakan baru sekarang agar catatan sesi tetap jelas dan adil.</span>
        </div>

        <form id="post-condition-form" onSubmit={handleSubmit}>
          <div className="student-checklist">
            {CHECK_ITEMS.map(({ key, title, subtitle, icon: Icon }) => {
              const item = checks[key];
              return (
                <div key={key} className={`student-check-row ${item.status === 'bad' ? 'is-issue' : ''}`}>
                  <div className="student-check-main">
                    <div className="student-check-icon"><Icon /></div>
                    <div className="student-check-copy">
                      <strong>{title}</strong>
                      <span>{subtitle}</span>
                    </div>
                    <div className="student-segment" aria-label={`Kondisi ${title}`}>
                      <button type="button" className={item.status === 'ok' ? 'is-good' : ''} onClick={() => updateCheck(key, { status: 'ok', note: '' })}>
                        <Check />Baik
                      </button>
                      <button type="button" className={item.status === 'bad' ? 'is-issue' : ''} onClick={() => updateCheck(key, { status: 'bad' })}>
                        <AlertTriangle />Masalah
                      </button>
                    </div>
                  </div>
                  {item.status === 'bad' && (
                    <div className="student-check-note">
                      <input
                        value={item.note}
                        onChange={(event) => updateCheck(key, { note: event.target.value })}
                        placeholder={`Jelaskan perubahan atau masalah pada ${title.toLowerCase()}...`}
                        autoFocus
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </form>
      </main>

      <footer className="student-condition-footer">
        <label className="student-confirm">
          <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
          <span>Saya sudah memeriksa seluruh perangkat dan siap mengakhiri sesi.</span>
        </label>
        {submitError && <span className="student-error">{submitError}</span>}
        {!serverOnline && (
          <span className="student-error">Server terputus. Proses keluar tetap akan diselesaikan secara lokal.</span>
        )}
        <button className="student-submit" type="submit" form="post-condition-form" disabled={!isFormValid || isSubmitting}>
          {isSubmitting ? <><Loader2 className="animate-spin" />Menyimpan...</> : <>Konfirmasi & keluar<LogOut /></>}
        </button>
      </footer>
    </div>
  );
}
