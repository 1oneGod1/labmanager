import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckCircle2, Download, FileText, FolderOpen, MoreVertical,
  Paperclip, Search, Send, Upload, Users,
} from 'lucide-react';

const MAX_FILE_BYTES = 1024 * 1024;

function pcName(pc) {
  return pc.actual_pc_name || pc.pc_name || pc.id || 'PC';
}

function studentName(pc) {
  return pc.student?.nama_lengkap || pc.student?.name || pc.student_name || 'Belum login';
}

function initials(value) {
  return String(value || 'S')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
}

function formatBytes(bytes) {
  if (!Number(bytes)) return '—';
  if (bytes < 1024) return `${bytes} B`;
  return `${Math.round(bytes / 1024)} KB`;
}

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('File tidak dapat dibaca.'));
    reader.readAsDataURL(file);
  });
}

export default function FilesWorkspace({ pcs = [], socket, demo = false, onToast }) {
  const fileInputRef = useRef(null);
  const demoTimersRef = useRef([]);
  const [mode, setMode] = useState('distribute');
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [distributionId, setDistributionId] = useState(null);
  const [collectionLabel, setCollectionLabel] = useState('Tugas praktikum');
  const [sizeByPc, setSizeByPc] = useState({});
  const [selectedFile, setSelectedFile] = useState(demo ? {
    name: 'Latihan_Praktikum_3.pdf',
    size: 248 * 1024,
    type: 'application/pdf',
    demo: true,
  } : null);
  const [statusByPc, setStatusByPc] = useState(() => Object.fromEntries(
    pcs.map((pc, index) => [pcName(pc), demo
      ? (index % 5 === 0 ? 'in-progress' : index % 3 === 0 ? 'submitted' : 'delivered')
      : 'ready']),
  ));

  useEffect(() => () => demoTimersRef.current.forEach(clearTimeout), []);

  useEffect(() => {
    if (!socket) return undefined;
    const statusHandler = (payload = {}) => {
      if (!payload.pc_name || payload.distribution_id !== distributionId) return;
      setStatusByPc((previous) => ({ ...previous, [payload.pc_name]: payload.status }));
      if (payload.size) setSizeByPc((previous) => ({ ...previous, [payload.pc_name]: payload.size }));
    };
    const submissionHandler = async (payload = {}) => {
      if (!payload.pc_name || payload.collection_id !== distributionId) return;
      let result = { success: true, size: payload.size || 0 };
      if (window.electronAPI?.saveCollectedFile) {
        result = await window.electronAPI.saveCollectedFile(payload);
      } else {
        try {
          const response = await fetch(payload.data);
          const blob = await response.blob();
          const href = URL.createObjectURL(blob);
          const anchor = document.createElement('a');
          anchor.href = href;
          anchor.download = `${payload.pc_name}_${payload.name}`;
          anchor.click();
          URL.revokeObjectURL(href);
          result = { success: true, size: blob.size };
        } catch {
          result = { success: false, size: 0 };
        }
      }
      setStatusByPc((previous) => ({ ...previous, [payload.pc_name]: result.success ? 'submitted' : 'failed' }));
      setSizeByPc((previous) => ({ ...previous, [payload.pc_name]: result.size || payload.size || 0 }));
    };
    socket.on('client:file-status', statusHandler);
    socket.on('client:file-submission', submissionHandler);
    return () => {
      socket.off('client:file-status', statusHandler);
      socket.off('client:file-submission', submissionHandler);
    };
  }, [socket, distributionId]);

  useEffect(() => {
    setStatusByPc((previous) => {
      const next = { ...previous };
      pcs.forEach((pc) => {
        const key = pcName(pc);
        if (!next[key]) next[key] = 'ready';
      });
      return next;
    });
  }, [pcs]);

  const rows = useMemo(() => pcs.filter((pc) => {
    const query = search.trim().toLowerCase();
    if (!query) return true;
    return `${pcName(pc)} ${studentName(pc)}`.toLowerCase().includes(query);
  }), [pcs, search]);

  const statusCounts = useMemo(() => Object.values(statusByPc).reduce((counts, status) => {
    counts[status] = (counts[status] || 0) + 1;
    return counts;
  }, {}), [statusByPc]);

  const chooseFile = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      onToast?.('Ukuran file maksimal 1 MB untuk distribusi realtime.', 'error');
      event.target.value = '';
      return;
    }
    setSelectedFile(file);
    setDistributionId(null);
    setSizeByPc({});
    setStatusByPc(Object.fromEntries(pcs.map((pc) => [pcName(pc), 'ready'])));
  };

  const simulateDistribution = (id) => {
    setDistributionId(id);
    const initial = Object.fromEntries(pcs.map((pc) => [pcName(pc), 'in-progress']));
    setStatusByPc(initial);
    pcs.forEach((pc, index) => {
      const timer = setTimeout(() => {
        setStatusByPc((previous) => ({
          ...previous,
          [pcName(pc)]: index % 6 === 0 ? 'opened' : index % 4 === 0 ? 'submitted' : 'delivered',
        }));
      }, 180 + index * 35);
      demoTimersRef.current.push(timer);
    });
  };

  const distribute = async () => {
    if (!selectedFile) {
      onToast?.('Pilih file terlebih dahulu.', 'error');
      return;
    }
    const id = `dist_${Date.now().toString(36)}`;
    if (demo || selectedFile.demo) {
      simulateDistribution(id);
      onToast?.('Simulasi distribusi file dimulai.');
      return;
    }
    if (!socket?.connected) {
      onToast?.('Server realtime belum terhubung.', 'error');
      return;
    }

    setBusy(true);
    setDistributionId(id);
    setStatusByPc(Object.fromEntries(pcs.map((pc) => [pcName(pc), 'in-progress'])));
    try {
      const data = await readAsDataUrl(selectedFile);
      socket.timeout(10_000).emit('admin:file-distribute', {
        id,
        name: selectedFile.name,
        type: selectedFile.type,
        size: selectedFile.size,
        data,
      }, (error, response) => {
        setBusy(false);
        if (error || !response?.success) {
          setStatusByPc(Object.fromEntries(pcs.map((pc) => [pcName(pc), 'failed'])));
          onToast?.(response?.error || 'Distribusi file gagal.', 'error');
          return;
        }
        onToast?.(`File dikirim ke ${response.count} PC.`);
      });
    } catch (error) {
      setBusy(false);
      onToast?.(error.message || 'File tidak dapat dibaca.', 'error');
    }
  };

  const collect = () => {
    if (mode !== 'collect') {
      setMode('collect');
      return;
    }
    if (!collectionLabel.trim()) {
      onToast?.('Masukkan nama tugas yang akan dikumpulkan.', 'error');
      return;
    }
    const id = `collect_${Date.now().toString(36)}`;
    if (demo) {
      setDistributionId(id);
      setStatusByPc(Object.fromEntries(pcs.map((pc) => [pcName(pc), 'in-progress'])));
      pcs.forEach((pc, index) => {
        const timer = setTimeout(() => setStatusByPc((previous) => ({ ...previous, [pcName(pc)]: index % 4 ? 'submitted' : 'in-progress' })), 220 + index * 40);
        demoTimersRef.current.push(timer);
      });
      onToast?.('Simulasi pengumpulan tugas dimulai.');
      return;
    }
    if (!socket?.connected) {
      onToast?.('Server realtime belum terhubung.', 'error');
      return;
    }
    setBusy(true);
    setDistributionId(id);
    setSizeByPc({});
    setStatusByPc(Object.fromEntries(pcs.map((pc) => [pcName(pc), 'in-progress'])));
    socket.timeout(10_000).emit('admin:file-collection-request', {
      id,
      label: collectionLabel.trim(),
    }, (error, response) => {
      setBusy(false);
      if (error || !response?.success) {
        setStatusByPc(Object.fromEntries(pcs.map((pc) => [pcName(pc), 'failed'])));
        onToast?.(response?.error || 'Permintaan pengumpulan gagal.', 'error');
        return;
      }
      onToast?.(`Permintaan pengumpulan dikirim ke ${response.count} PC.`);
    });
  };

  return (
    <section className="labkom-files-view">
      <input ref={fileInputRef} type="file" className="sr-only" onChange={chooseFile} />

      <div className="labkom-file-toolbar">
        <div className="labkom-segmented">
          <button className={mode === 'distribute' ? 'is-active' : ''} onClick={() => setMode('distribute')}><Upload />Distribusikan</button>
          <button className={mode === 'collect' ? 'is-active' : ''} onClick={() => setMode('collect')}><Download />Kumpulkan</button>
        </div>

        {mode === 'distribute' ? (
          <button className="labkom-file-pill" onClick={() => fileInputRef.current?.click()}>
            <FileText />
            <span><strong>{selectedFile?.name || 'Pilih file kelas'}</strong><small>{selectedFile ? `${formatBytes(selectedFile.size)} · maksimal 1 MB` : 'PDF, DOCX, ZIP, atau file materi lain'}</small></span>
          </button>
        ) : (
          <label className="labkom-file-pill">
            <Download />
            <span><strong>Nama pengumpulan</strong><input value={collectionLabel} onChange={(event) => setCollectionLabel(event.target.value)} maxLength={120} aria-label="Nama pengumpulan tugas" /></span>
          </label>
        )}

        <span className="labkom-file-arrow">→</span>
        <div className="labkom-target-pill"><Users /><span>Ke: X RPL 1 · {pcs.length || 30}</span></div>
        <div className="labkom-file-toolbar-actions">
          {mode === 'distribute' && <button className="labkom-action" onClick={() => fileInputRef.current?.click()}><Paperclip />Tambah file</button>}
          <button className="labkom-primary" onClick={mode === 'distribute' ? distribute : collect} disabled={busy || (mode === 'distribute' ? !selectedFile : !collectionLabel.trim())}>
            <Send />{busy ? 'Mengirim…' : mode === 'distribute' ? 'Kirim ke semua' : 'Kumpulkan tugas'}
          </button>
        </div>
      </div>

      <div className="labkom-file-summary">
        <div className="labkom-file-metrics">
          <span className="is-green"><CheckCircle2 />Terkirim <strong>{statusCounts.delivered || 0}</strong></span>
          <span className="is-yellow"><FolderOpen />Dibuka <strong>{statusCounts.opened || 0}</strong></span>
          <span className="is-green"><Upload />Dikumpulkan <strong>{statusCounts.submitted || 0}</strong></span>
        </div>
        <label className="labkom-search"><Search /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Cari PC atau siswa…" /></label>
        <button className="labkom-action" onClick={collect}><Download />Kumpulkan yang selesai</button>
      </div>

      <div className="labkom-file-table-wrap">
        <table className="labkom-data-table labkom-file-table">
          <thead><tr><th>PC</th><th>Siswa</th><th>Status</th><th>Progress</th><th>Ukuran</th><th aria-label="Aksi" /></tr></thead>
          <tbody>
            {rows.map((pc, index) => {
              const key = pcName(pc);
              const status = statusByPc[key] || 'ready';
              const progress = status === 'delivered' || status === 'opened' || status === 'submitted' ? 100 : status === 'failed' ? 18 : status === 'ready' ? 0 : 22 + ((index * 13) % 68);
              return (
                <tr key={key}>
                  <td className="labkom-mono">{key}</td>
                  <td><span className="labkom-student-cell"><b>{initials(studentName(pc))}</b><strong>{studentName(pc)}</strong></span></td>
                  <td><span className={`labkom-status is-${status}`}>{status === 'submitted' ? 'Dikumpulkan' : status === 'in-progress' ? 'Mengirim' : status === 'delivered' ? 'Terkirim' : status === 'opened' ? 'Dibuka' : status === 'failed' ? 'Gagal' : 'Siap'}</span></td>
                  <td><div className="labkom-progress"><div><span style={{ width: `${progress}%` }} /></div><small>{progress}%</small></div></td>
                  <td className="labkom-mono">{status === 'submitted' ? formatBytes(sizeByPc[key]) : progress === 100 ? formatBytes(selectedFile?.size) : '—'}</td>
                  <td><button className="labkom-icon-button" aria-label={`Aksi ${key}`}><MoreVertical /></button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
