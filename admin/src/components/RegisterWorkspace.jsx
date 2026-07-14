import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, CalendarDays, Check, Clock3, Cpu, Download,
  Headphones, Keyboard, Monitor, MousePointer2, Search, StickyNote, Wifi,
} from 'lucide-react';

const CONDITION_ITEMS = [
  { key: 'monitor_status', note: 'monitor_note', label: 'Monitor & layar', normal: 'Normal, tidak ada dead pixel', icon: Monitor },
  { key: 'keyboard_status', note: 'keyboard_note', label: 'Keyboard', normal: 'Semua tombol bekerja', icon: Keyboard },
  { key: 'mouse_status', note: 'mouse_note', label: 'Mouse', normal: 'Pointer dan klik normal', icon: MousePointer2 },
  { key: 'headset_status', note: 'headset_note', label: 'Headset', normal: 'Audio kiri dan kanan normal', icon: Headphones },
  { key: 'cpu_status', note: 'cpu_note', label: 'CPU / unit & internet', normal: 'Boot dan koneksi LAN normal', icon: Cpu },
  { key: 'desk_status', note: 'desk_note', label: 'Meja & kursi', normal: 'Kondisi baik dan rapi', icon: Wifi },
];

function pcName(pc) {
  return pc.actual_pc_name || pc.pc_name || pc.id || 'PC';
}

function student(pc) {
  return pc.student || {};
}

function csvEscape(value) {
  return `"${String(value ?? '').replaceAll('"', '""')}"`;
}

export default function RegisterWorkspace({ pcs = [], checks = [], loading = false, onRefresh }) {
  const [search, setSearch] = useState('');
  const [selectedPcName, setSelectedPcName] = useState('');

  const rows = useMemo(() => {
    const source = pcs.length ? pcs : checks.map((check) => ({
      id: check.pc_name,
      actual_pc_name: check.pc_name,
      status: 'offline',
      student: {
        nama_lengkap: check.nama_lengkap,
        nis: check.nis,
        kelas: check.kelas,
      },
      loginTime: check.time_str,
      duration: '—',
    }));

    const unique = new Map();
    source.forEach((pc) => unique.set(pcName(pc), pc));

    return [...unique.values()].map((pc) => {
      const key = pcName(pc);
      const related = checks.filter((check) => check.pc_name === key);
      const pre = related.find((check) => check.check_type === 'pre') || null;
      const post = related.find((check) => check.check_type === 'post') || null;
      return { pc, key, pre, post };
    });
  }, [pcs, checks]);

  const filteredRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return rows;
    return rows.filter(({ pc, key }) => `${key} ${student(pc).nama_lengkap || student(pc).name || ''} ${student(pc).nis || ''}`.toLowerCase().includes(query));
  }, [rows, search]);

  useEffect(() => {
    if (!rows.length) return;
    if (rows.some((row) => row.key === selectedPcName)) return;
    const issue = rows.find((row) => row.pre?.has_issue || row.post?.has_issue);
    setSelectedPcName((issue || rows[0]).key);
  }, [rows, selectedPcName]);

  const selected = rows.find((row) => row.key === selectedPcName) || rows[0] || null;
  const selectedCheck = selected?.pre || selected?.post || null;
  const issueNotes = selectedCheck
    ? CONDITION_ITEMS.filter((item) => selectedCheck[item.key] === 'bad').map((item) => selectedCheck[item.note]).filter(Boolean)
    : [];

  const exportCsv = () => {
    const header = ['PC', 'Siswa', 'NIS', 'Login', 'Durasi', 'Pre-use', 'Post-use'];
    const body = rows.map(({ pc, key, pre, post }) => [
      key,
      student(pc).nama_lengkap || student(pc).name || '',
      student(pc).nis || '',
      pc.loginTime || pre?.time_str || '',
      pc.duration || '',
      pre ? (pre.has_issue ? 'Masalah' : 'Normal') : 'Belum ada',
      post ? (post.has_issue ? 'Masalah' : 'Normal') : 'Dalam sesi',
    ]);
    const csv = [header, ...body].map((row) => row.map(csvEscape).join(',')).join('\r\n');
    const href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = href;
    anchor.download = `register-lab-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(href);
  };

  return (
    <section className="labkom-register-view">
      <div className="labkom-register-main">
        <div className="labkom-page-heading">
          <div><h2>Daftar Kehadiran & Kondisi</h2><p>Kelas X RPL 1 · {new Date().toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</p></div>
          <div className="labkom-page-actions">
            <label className="labkom-search"><Search /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Cari…" /></label>
            <button className="labkom-action" onClick={onRefresh}><CalendarDays />Hari ini</button>
            <button className="labkom-action" onClick={exportCsv}><Download />Ekspor</button>
          </div>
        </div>

        <div className="labkom-register-table-wrap">
          {loading ? <div className="labkom-empty"><Clock3 />Memuat data register…</div> : (
            <table className="labkom-data-table labkom-register-table">
              <thead><tr><th>PC</th><th>Siswa</th><th>Login</th><th>Durasi</th><th>Pre-use</th><th>Post-use</th></tr></thead>
              <tbody>
                {filteredRows.map(({ pc, key, pre, post }) => {
                  const selectedRow = key === selected?.key;
                  return (
                    <tr key={key} className={selectedRow ? 'is-selected' : ''} onClick={() => setSelectedPcName(key)}>
                      <td className="labkom-mono">{key}</td>
                      <td><span className="labkom-register-student"><i className={pre?.has_issue ? 'is-issue' : 'is-online'} /><span><strong>{student(pc).nama_lengkap || student(pc).name || 'Belum login'}</strong><small>{student(pc).nis || '—'}</small></span></span></td>
                      <td className="labkom-mono">{pc.loginTime || pre?.time_str || '—'}</td>
                      <td className="labkom-mono">{pc.duration || '—'}</td>
                      <td><span className={`labkom-status ${pre?.has_issue ? 'is-failed' : pre ? 'is-delivered' : 'is-ready'}`}>{pre ? (pre.has_issue ? 'Masalah' : 'Normal') : 'Belum ada'}</span></td>
                      <td><span className={`labkom-status ${post?.has_issue ? 'is-failed' : post ? 'is-delivered' : 'is-ready'}`}>{post ? (post.has_issue ? 'Masalah' : 'Normal') : 'Dalam sesi'}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <aside className="labkom-register-detail">
        {selected ? (
          <>
            <div className="labkom-register-profile">
              <b>{String(student(selected.pc).nama_lengkap || student(selected.pc).name || 'S').slice(0, 2).toUpperCase()}</b>
              <span><strong>{student(selected.pc).nama_lengkap || student(selected.pc).name || 'Belum login'}</strong><small>{student(selected.pc).nis || '—'} · {selected.key}</small></span>
              <em className={selectedCheck?.has_issue ? 'is-issue' : ''}>{selectedCheck?.has_issue ? 'Masalah' : 'Normal'}</em>
            </div>
            <p className="labkom-detail-kicker">Kondisi pre-use · dikirim {selected.pre?.time_str || '—'}</p>
            <div className="labkom-condition-list">
              {CONDITION_ITEMS.map(({ key, note, label, normal, icon: Icon }) => {
                const bad = selectedCheck?.[key] === 'bad';
                return (
                  <div className={bad ? 'is-bad' : ''} key={key}>
                    <span>{bad ? <AlertTriangle /> : <Check />}</span>
                    <Icon className="labkom-condition-icon" />
                    <p><strong>{label}</strong><small>{bad ? (selectedCheck?.[note] || 'Perlu diperiksa') : normal}</small></p>
                  </div>
                );
              })}
            </div>

            <div className="labkom-student-note">
              <h3><StickyNote />Catatan siswa</h3>
              <p>{issueNotes.join(' ') || 'Tidak ada catatan masalah dari siswa.'}</p>
            </div>

            <p className="labkom-detail-kicker">Kondisi post-use</p>
            <div className="labkom-post-status"><Clock3 />{selected.post ? (selected.post.has_issue ? 'Ada masalah setelah sesi' : 'Selesai · kondisi normal') : 'Menunggu — sesi masih aktif'}</div>
          </>
        ) : <div className="labkom-empty"><Monitor />Belum ada data sesi.</div>}
      </aside>
    </section>
  );
}
