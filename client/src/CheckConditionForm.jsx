import React, { useMemo, useState } from 'react';
import {
  Monitor, Keyboard, MousePointer2, Headphones, Cpu, Armchair,
  Info, Check, AlertTriangle, ArrowRight, Loader2,
} from 'lucide-react';
import { apiCall } from './api.js';

const CHECK_ITEMS = [
  { key: 'monitor', title: 'Monitor & layar', subtitle: 'Layar menyala, tidak retak atau bergaris', icon: Monitor },
  { key: 'keyboard', title: 'Keyboard', subtitle: 'Semua tombol lengkap dan merespons', icon: Keyboard },
  { key: 'mouse', title: 'Mouse', subtitle: 'Pointer bergerak dan tombol berfungsi', icon: MousePointer2 },
  { key: 'headset', title: 'Headset', subtitle: 'Audio kiri dan kanan terdengar normal', icon: Headphones },
  { key: 'cpu', title: 'CPU, unit & internet', subtitle: 'Komputer menyala normal dan jaringan terhubung', icon: Cpu },
  { key: 'desk', title: 'Meja & kursi', subtitle: 'Stabil, bersih, dan tidak rusak', icon: Armchair },
];

const initialChecks = Object.fromEntries(CHECK_ITEMS.map(({ key }) => [key, { status: null, note: '' }]));

export default function CheckConditionForm({ studentData, serverUrl, pcName, onComplete }) {
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
    setChecks((current) => ({
      ...current,
      [key]: { ...current[key], ...patch },
    }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!isFormValid || isSubmitting) return;
    setIsSubmitting(true);
    setSubmitError('');

    try {
      const response = await apiCall(`${serverUrl}/api/checks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: sessionStorage.getItem('session_id') || null,
          nis: studentData?.nis || '-',
          nama_lengkap: studentData?.nama_lengkap || '-',
          pc_name: pcName,
          check_type: 'pre',
          monitor_status: checks.monitor.status,
          monitor_note: checks.monitor.note || null,
          keyboard_status: checks.keyboard.status,
          keyboard_note: checks.keyboard.note || null,
          mouse_status: checks.mouse.status,
          mouse_note: checks.mouse.note || null,
          headset_status: checks.headset.status,
          headset_note: checks.headset.note || null,
          cpu_status: checks.cpu.status,
          cpu_note: checks.cpu.note || null,
          desk_status: checks.desk.status,
          desk_note: checks.desk.note || null,
        }),
      });
      if (!response.ok || !response.data?.success) {
        throw new Error(response.data?.message || 'Gagal menyimpan');
      }
      window.electronAPI?.resizeWindow('regular');
      onComplete();
    } catch (error) {
      setSubmitError('Checklist belum tersimpan. Periksa koneksi atau hubungi teknisi.');
      console.error(error);
    } finally {
      setIsSubmitting(false);
    }
  };

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
          <h1>Kondisi komputer — sebelum digunakan</h1>
          <p>{studentData?.nama_lengkap || 'Siswa'} · {pcName}</p>
        </div>
        <div className="student-steps" aria-label="Progres memulai sesi">
          <span className="student-step is-done"><span className="student-step-number"><Check /></span>Login</span>
          <span className="student-step-separator">›</span>
          <span className="student-step is-active"><span className="student-step-number">2</span>Cek kondisi</span>
          <span className="student-step-separator">›</span>
          <span className="student-step"><span className="student-step-number">3</span>Mulai</span>
        </div>
      </header>

      <main className="student-condition-body">
        <div className="student-info-banner">
          <Info />
          <span>Periksa setiap komponen sebelum mulai. Laporkan masalah yang sudah ada agar guru dan teknisi langsung mengetahuinya, sekaligus melindungimu dari tanggung jawab atas kerusakan sebelumnya.</span>
        </div>

        <form id="pre-condition-form" onSubmit={handleSubmit}>
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
                        placeholder={`Jelaskan masalah pada ${title.toLowerCase()}...`}
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
          <span>Saya sudah memeriksa seluruh perangkat dan informasi di atas benar.</span>
        </label>
        {submitError && <span className="student-error">{submitError}</span>}
        <button className="student-submit" type="submit" form="pre-condition-form" disabled={!isFormValid || isSubmitting}>
          {isSubmitting ? <><Loader2 className="animate-spin" />Menyimpan...</> : <>Mulai sesi<ArrowRight /></>}
        </button>
      </footer>
    </div>
  );
}
