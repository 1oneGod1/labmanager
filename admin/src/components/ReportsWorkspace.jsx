import React, { useMemo, useState } from 'react';
import {
  AppWindow, BarChart3, Clock3, Download, Flag, Globe2,
  Hand, ShieldAlert, Users,
} from 'lucide-react';

const DEMO_APPS = [
  { process_name: 'Google Chrome', usage_count: 32 },
  { process_name: 'Visual Studio Code', usage_count: 21 },
  { process_name: 'Microsoft Word', usage_count: 15 },
  { process_name: 'Microsoft Excel', usage_count: 11 },
  { process_name: 'Scratch', usage_count: 9 },
];

const DEMO_SITES = [
  { url_domain: 'Education', visit_count: 64 },
  { url_domain: 'Reference', visit_count: 18 },
  { url_domain: 'Coding / tools', visit_count: 12 },
  { url_domain: 'Percobaan diblokir', visit_count: 6, blocked: true },
];

function activePc(pc) {
  return pc.status === 'active' || pc.status === 'locked';
}

function minutesFrom(value) {
  const match = String(value || '').match(/(\d+)/);
  return match ? Number(match[1]) : 0;
}

export default function ReportsWorkspace({ pcs = [], checks = [], history = [], topApps = [], topSites = [], timeline = [], demo = false, onRefresh, onToast }) {
  const [period, setPeriod] = useState('today');
  const present = pcs.filter(activePc).length;
  const total = pcs.length || 30;
  const attendance = Math.round((present / total) * 1000) / 10;
  const issueChecks = checks.filter((check) => check.has_issue);

  const averageMinutes = useMemo(() => {
    const values = pcs.map((pc) => minutesFrom(pc.duration)).filter(Boolean);
    if (!values.length) return demo ? 78 : 0;
    return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
  }, [pcs, demo]);

  const apps = (topApps.length ? topApps : demo ? DEMO_APPS : []).slice(0, 5);
  const sites = (topSites.length ? topSites : demo ? DEMO_SITES : []).slice(0, 4);
  const maxApp = Math.max(1, ...apps.map((item) => Number(item.usage_count) || 0));
  const maxSite = Math.max(1, ...sites.map((item) => Number(item.visit_count) || 0));
  const demoHourValues = period === 'today' ? [46, 78, 86, 84, 85, 84, 63] : period === 'week' ? [52, 73, 68, 89, 76, 44, 18] : [61, 75, 82, 70, 91, 66, 58];
  const demoHourLabels = period === 'today' ? ['07:00', '07:30', '08:00', '08:30', '09:00', '09:30', '10:00'] : period === 'week' ? ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'] : ['W1', 'W2', 'W3', 'W4', 'W5', 'W6', 'W7'];
  const maxTimeline = Math.max(1, ...timeline.map((item) => Number(item.activity_count) || 0));
  const hourValues = demo ? demoHourValues : timeline.map((item) => Math.max(3, Math.round(((Number(item.activity_count) || 0) / maxTimeline) * 100)));
  const hourLabels = demo ? demoHourLabels : timeline.map((item) => {
    const date = new Date(item.start_at);
    if (period === 'today') return date.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
    if (period === 'week') return date.toLocaleDateString('id-ID', { weekday: 'short' });
    return date.toLocaleDateString('id-ID', { day: '2-digit', month: '2-digit' });
  });
  const demoFlagged = [
    { id: 'demo-flag-1', pc_name: 'PC-LAB-09', mouse_note: 'mouse tidak responsif' },
    { id: 'demo-flag-2', pc_name: 'PC-LAB-14', mouse_note: 'percobaan situs diblokir ×4' },
    { id: 'demo-flag-3', pc_name: 'PC-LAB-07', mouse_note: 'USB eksternal terpasang' },
  ];
  const flagged = (demo
    ? [...issueChecks, ...demoFlagged.filter((item) => !issueChecks.some((check) => check.pc_name === item.pc_name))]
    : issueChecks).slice(0, 3);

  const exportReport = async () => {
    document.body.dataset.printView = 'reports';
    try {
      if (window.electronAPI?.exportReportsPdf) {
        const result = await window.electronAPI.exportReportsPdf();
        if (result?.success) onToast?.('Laporan PDF berhasil disimpan.');
        else if (!result?.canceled) onToast?.(result?.message || 'Laporan PDF gagal dibuat.', 'error');
      } else {
        window.print();
      }
    } finally {
      delete document.body.dataset.printView;
    }
  };

  return (
    <section className="labkom-reports-view">
      <div className="labkom-page-heading">
        <div><h2>Laporan Aktivitas & Penggunaan</h2><p>Kelas X RPL 1 · sesi berjalan</p></div>
        <div className="labkom-page-actions">
          <div className="labkom-segmented labkom-period-tabs">
            {['today', 'week', 'month'].map((value) => <button key={value} className={period === value ? 'is-active' : ''} onClick={() => { setPeriod(value); onRefresh?.(value); }}>{value === 'today' ? 'Hari ini' : value === 'week' ? 'Minggu' : 'Bulan'}</button>)}
          </div>
          <button className="labkom-action" onClick={exportReport}><Download />Ekspor PDF</button>
        </div>
      </div>

      <div className="labkom-report-stats">
        <article><span>Tingkat kehadiran</span><strong>{Number.isFinite(attendance) ? attendance : 0}%</strong><small className="is-good">▲ {present} dari {total} masuk</small><Users /></article>
        <article><span>Rata-rata waktu sesi</span><strong>{averageMinutes ? `${Math.floor(averageMinutes / 60)}j ${averageMinutes % 60}m` : '—'}</strong><small>per siswa hari ini</small><Clock3 /></article>
        <article><span>Permintaan bantuan</span><strong className="is-yellow">{demo ? 14 : issueChecks.length}</strong><small>rata-rata respons 1m 40d</small><Hand /></article>
        <article><span>Pelanggaran kebijakan</span><strong className="is-red">{demo ? 23 : topSites.reduce((sum, site) => sum + (Number(site.blocked_attempts) || 0), 0)}</strong><small>berdasarkan log situs diblokir</small><ShieldAlert /></article>
      </div>

      <div className="labkom-report-grid">
        <article className="labkom-report-panel">
          <h3>Aplikasi paling sering digunakan <AppWindow /></h3>
          <div className="labkom-report-bars">
            {apps.length ? apps.map((item, index) => {
              const value = Number(item.usage_count) || 0;
              return <div key={item.process_name || index}><b>{String(item.process_name || 'Aplikasi').slice(0, 1).toUpperCase()}</b><span>{item.process_name || 'Aplikasi'}</span><progress max={maxApp} value={value} /><strong>{Math.round((value / maxApp) * 32)}%</strong></div>;
            }) : <p className="labkom-report-empty">Belum ada log penggunaan aplikasi.</p>}
          </div>
        </article>

        <article className="labkom-report-panel labkom-hour-panel">
          <h3>Aktivitas lab per jam <Clock3 /></h3>
          <div className="labkom-hour-chart">
            {hourValues.length ? hourValues.map((value, index) => <div key={`${hourLabels[index]}-${index}`} title={`${timeline[index]?.activity_count ?? value} aktivitas`}><span style={{ height: `${value}%` }} /><small>{hourLabels[index]}</small></div>) : <p className="labkom-report-empty">Belum ada aktivitas pada periode ini.</p>}
          </div>
        </article>

        <article className="labkom-report-panel">
          <h3>Kategori website <Globe2 /></h3>
          <div className="labkom-report-bars labkom-site-bars">
            {sites.length ? sites.map((item, index) => {
              const value = Number(item.visit_count) || 0;
              return <div className={item.blocked ? 'is-blocked' : ''} key={item.url_domain || index}><span>{item.url_domain || 'Situs'}</span><progress max={maxSite} value={value} /><strong>{Math.round((value / maxSite) * 64)}%</strong></div>;
            }) : <p className="labkom-report-empty">Belum ada data website.</p>}
          </div>
        </article>

        <article className="labkom-report-panel labkom-attendance-panel">
          <h3>Kehadiran & tanda <Flag /></h3>
          <div className="labkom-attendance-summary">
            <div><strong>{present}<small>/{total}</small></strong><span>hadir</span></div>
            <ul>
              {flagged.map((check, index) => (
                <li key={check.id || index}><AlertDot index={index} /><span><strong>{check.pc_name || 'PC'}</strong> · {check.mouse_note || check.monitor_note || check.headset_note || 'perlu ditinjau'}</span></li>
              ))}
              {!flagged.length && !demo && <li className="labkom-report-empty">Tidak ada PC bertanda.</li>}
            </ul>
          </div>
        </article>
      </div>

      <p className="labkom-report-footnote"><BarChart3 />Data laporan menggabungkan sesi, pengecekan fasilitas, dan log aktivitas yang tersedia.</p>
    </section>
  );
}

function AlertDot({ index }) {
  return <i className={`is-${index % 3}`} aria-hidden="true" />;
}
