import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  User, Monitor, Clock, LogOut, ChevronDown, ChevronUp,
  Send, X, MessageCircle, AlertTriangle, Flag, BellRing, Wifi, WifiOff,
} from 'lucide-react';
import { apiCall } from './api.js';

// Ambil serverUrl dari sessionStorage (diset oleh App.jsx setelah setup)
const SERVER_URL = sessionStorage.getItem('server_url') || 'http://localhost:3001';

// Resize Electron window sesuai mode
function resizeElectron(mode) {
  window.electronAPI?.resizeWindow(mode);
}

export default function LogoutWidget({ studentData, serverOnline = true, onRequestPostCheck, onLogoutComplete }) {
  const [sessionTime,      setSessionTime]      = useState(0);
  const [isMinimized,      setIsMinimized]      = useState(false);
  const [isTeacherMode,    setIsTeacherMode]    = useState(false);
  const [isReportMode,     setIsReportMode]     = useState(false);
  const [isViolationMode,  setIsViolationMode]  = useState(false);

  // Chat guru
  const [teacherPrompt,    setTeacherPrompt]    = useState('');
  const [isTeacherTyping,  setIsTeacherTyping]  = useState(false);
  const [chatHistory,      setChatHistory]      = useState([
    { sender: 'teacher', text: 'Halo! Ada kendala dengan komputermu atau materi hari ini?' },
  ]);

  // Lapor kendala
  const [reportCategory,   setReportCategory]   = useState('Hardware');
  const [reportDetail,     setReportDetail]     = useState('');

  // Lapor pelanggaran
  const [violationCategory, setViolationCategory] = useState('Menyontek');
  const [violationDetail,   setViolationDetail]   = useState('');

  const [isLoggingOut,  setIsLoggingOut]  = useState(false);
  const chatEndRef = useRef(null);

  // ── Timer sesi ─────────────────────────────────────────────────
  // Pastikan ukuran window benar saat widget pertama muncul
  useEffect(() => {
    resizeElectron('regular');
  }, []);

  useEffect(() => {
    const t = setInterval(() => setSessionTime((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const formatTime = (sec) => {
    const h = Math.floor(sec / 3600).toString().padStart(2, '0');
    const m = Math.floor((sec % 3600) / 60).toString().padStart(2, '0');
    const s = (sec % 60).toString().padStart(2, '0');
    return `${h}:${m}:${s}`;
  };

  // ── Auto-scroll chat ────────────────────────────────────────────
  useEffect(() => {
    if (isTeacherMode && chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chatHistory, isTeacherMode, isTeacherTyping]);

  // ── Helpers buka mode & resize Electron ─────────────────────────
  const openRegular = useCallback(() => {
    setIsMinimized(false);
    setIsTeacherMode(false);
    setIsReportMode(false);
    setIsViolationMode(false);
    resizeElectron('regular');
  }, []);

  const openTeacher = useCallback(() => {
    setIsMinimized(false);
    setIsReportMode(false);
    setIsViolationMode(false);
    setIsTeacherMode(true);
    resizeElectron('expanded');
  }, []);

  const openReport = useCallback(() => {
    setIsMinimized(false);
    setIsTeacherMode(false);
    setIsViolationMode(false);
    setIsReportMode(true);
    resizeElectron('expanded');
  }, []);

  const openViolation = useCallback(() => {
    setIsMinimized(false);
    setIsTeacherMode(false);
    setIsReportMode(false);
    setIsViolationMode(true);
    resizeElectron('expanded');
  }, []);

  const toggleMinimize = useCallback(() => {
    const next = !isMinimized;
    setIsMinimized(next);
    if (next) {
      setIsTeacherMode(false);
      setIsReportMode(false);
      setIsViolationMode(false);
      resizeElectron('minimized');
    } else {
      resizeElectron('regular');
    }
  }, [isMinimized]);

  // ── Logout ─────────────────────────────────────────────────────
  const handleLogout = useCallback(async () => {
    if (isLoggingOut) return;
    setIsLoggingOut(true);
    try {
      const sessionId = sessionStorage.getItem('session_id');
      const res = await apiCall(`${SERVER_URL}/api/auth/logout`, {
        method:  'POST',
        timeoutMs: 3_000,
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ session_id: sessionId }),
      });
      if (!res.ok) {
        console.warn('Logout server returned non-success; continuing local logout.');
      }
    } catch (err) {
      // Tetap lanjut logout UI meski jaringan putus
      console.error('Logout error:', err);
    } finally {
      sessionStorage.clear();
      window.electronAPI?.doLogout();
      onLogoutComplete?.();
      setIsLoggingOut(false);
    }
  }, [onLogoutComplete, studentData, isLoggingOut]);

  // ── Chat Guru ──────────────────────────────────────────────────
  const handleAskTeacher = (e) => {
    e.preventDefault();
    if (!teacherPrompt.trim()) return;
    setChatHistory((prev) => [...prev, { sender: 'student', text: teacherPrompt }]);
    setTeacherPrompt('');
    setIsTeacherTyping(true);
    setTimeout(() => {
      setChatHistory((prev) => [
        ...prev,
        { sender: 'teacher', text: 'Baik, bapak sudah menerima pesanmu. Tunggu sebentar ya, bapak akan mengeceknya.' },
      ]);
      setIsTeacherTyping(false);
    }, 2000);
  };

  // ── Lapor Kendala ──────────────────────────────────────────────
  const handleSubmitReport = (e) => {
    e.preventDefault();
    if (!reportDetail.trim()) return;
    const msg = `🚨 [LAPORAN KENDALA: ${reportCategory.toUpperCase()}]\n${reportDetail}`;
    setChatHistory((prev) => [...prev, { sender: 'student', text: msg }]);
    setReportDetail('');
    setIsReportMode(false);
    setIsTeacherMode(true);
    setIsTeacherTyping(true);
    setTimeout(() => {
      setChatHistory((prev) => [
        ...prev,
        { sender: 'teacher', text: 'Laporan kerusakan sudah masuk. Mohon tunggu di tempatmu, teknisi akan segera datang.' },
      ]);
      setIsTeacherTyping(false);
    }, 2000);
  };

  // ── Lapor Pelanggaran ──────────────────────────────────────────
  const handleSubmitViolation = (e) => {
    e.preventDefault();
    if (!violationDetail.trim()) return;
    const msg = `🛑 [LAPORAN PELANGGARAN: ${violationCategory.toUpperCase()}]\n${violationDetail}`;
    setChatHistory((prev) => [...prev, { sender: 'student', text: msg }]);
    setViolationDetail('');
    setIsViolationMode(false);
    setIsTeacherMode(true);
    setIsTeacherTyping(true);
    setTimeout(() => {
      setChatHistory((prev) => [
        ...prev,
        { sender: 'teacher', text: 'Terima kasih atas laporanmu. Identitasmu dirahasiakan. Bapak/Ibu guru akan segera mengawasi area tersebut.' },
      ]);
      setIsTeacherTyping(false);
    }, 2000);
  };

  // ── Apakah konten body tampil ──────────────────────────────────
  const isExpanded = isTeacherMode || isReportMode || isViolationMode;

  return (
    // Container transparan — window Electron sudah diposisikan di pojok kanan bawah
    <div className="w-full h-full flex items-start justify-end bg-transparent p-0">
      <div className="w-full h-full bg-slate-900/90 backdrop-blur-xl border border-slate-700/50 rounded-2xl shadow-2xl overflow-hidden flex flex-col">

        {/* ── Header ──────────────────────────────────────────── */}
        <div className="bg-gradient-to-r from-blue-600 to-indigo-600 px-4 py-3 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center space-x-3">
            <div className="bg-white/20 p-1.5 rounded-lg">
              <Monitor className="w-4 h-4 text-white" />
            </div>
            <div>
              <h3 className="flex items-center gap-1.5 text-white font-bold text-sm leading-tight">
                {studentData?.pc_name || 'PC-LAB'}
                {serverOnline ? <Wifi className="h-3.5 w-3.5 text-emerald-200" /> : <WifiOff className="h-3.5 w-3.5 text-amber-200" />}
              </h3>
              {isMinimized ? (
                <p className="text-blue-100 text-xs font-mono">{formatTime(sessionTime)}</p>
              ) : (
                <p className="text-blue-100 text-xs">{serverOnline ? 'Sesi Aktif' : 'Server terputus - mencoba lagi'}</p>
              )}
            </div>
          </div>

          <div className="flex items-center space-x-1.5">
            {/* Lapor Pelanggaran */}
            <button onClick={openViolation} title="Lapor Pelanggaran"
              className="p-1.5 bg-purple-500/20 hover:bg-purple-500/40 rounded-lg text-purple-300 transition-colors">
              <Flag className="w-4 h-4" />
            </button>
            {/* Lapor Kendala */}
            <button onClick={openReport} title="Lapor Kendala Teknis"
              className="p-1.5 bg-red-500/20 hover:bg-red-500/40 rounded-lg text-red-300 transition-colors">
              <AlertTriangle className="w-4 h-4" />
            </button>
            {/* Chat Guru */}
            <button onClick={openTeacher} title="Chat Guru" className="relative p-1.5 bg-amber-500/20 hover:bg-amber-500/40 rounded-lg text-amber-300 transition-colors">
              <MessageCircle className="w-4 h-4" />
              <span className="absolute top-1 right-1 w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" />
            </button>
            {/* Minimize */}
            <button onClick={toggleMinimize} title={isMinimized ? 'Perbesar' : 'Kecilkan'}
              className="p-1.5 bg-white/10 hover:bg-white/20 rounded-lg text-white transition-colors">
              {isMinimized ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {/* ── Body (tersembunyi saat minimized) ───────────────── */}
        {!isMinimized && (
          <div className="flex-1 overflow-hidden p-4 flex flex-col space-y-3">

            {/* ── Mode Regular ── */}
            {!isExpanded && (
              <>
                <div className="flex items-center space-x-3 bg-slate-800/50 p-3 rounded-xl border border-slate-700/50">
                  <div className="bg-slate-700 p-2 rounded-full flex-shrink-0">
                    <User className="w-4 h-4 text-slate-300" />
                  </div>
                  <div className="overflow-hidden">
                    <p className="text-sm font-semibold text-white truncate">{studentData?.nama_lengkap}</p>
                    <p className="text-xs text-slate-400">NIS: {studentData?.nis} · {studentData?.kelas}</p>
                  </div>
                </div>

                <div className="flex items-center justify-between px-1">
                  <div className="flex items-center space-x-2 text-slate-300">
                    <Clock className="w-4 h-4 text-blue-400" />
                    <span className="text-xs font-medium">Durasi Sesi:</span>
                  </div>
                  <span className="text-lg font-mono font-bold text-white tracking-wider">
                    {formatTime(sessionTime)}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <button onClick={openTeacher}
                    className="py-2.5 px-3 bg-amber-500/10 hover:bg-amber-500 hover:text-white text-amber-400 border border-amber-500/20 hover:border-amber-500 rounded-xl flex items-center justify-center space-x-2 transition-all text-xs font-medium">
                    <BellRing className="w-4 h-4" /><span>Chat Guru</span>
                  </button>
                  <button onClick={openReport}
                    className="py-2.5 px-3 bg-red-500/10 hover:bg-red-500 hover:text-white text-red-400 border border-red-500/20 hover:border-red-500 rounded-xl flex items-center justify-center space-x-2 transition-all text-xs font-medium">
                    <AlertTriangle className="w-4 h-4" /><span>Lapor Kendala</span>
                  </button>
                  <button onClick={openViolation}
                    className="col-span-2 py-2.5 px-3 bg-purple-500/10 hover:bg-purple-500 hover:text-white text-purple-400 border border-purple-500/20 hover:border-purple-500 rounded-xl flex items-center justify-center space-x-2 transition-all text-xs font-medium">
                    <Flag className="w-4 h-4" /><span>Lapor Pelanggaran (Anonim)</span>
                  </button>
                  <button onClick={() => onRequestPostCheck ? onRequestPostCheck() : handleLogout()} disabled={isLoggingOut}
                    className="col-span-2 py-2.5 px-3 bg-slate-700/30 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 rounded-xl flex items-center justify-center space-x-2 transition-all text-xs font-medium disabled:opacity-50">
                    {isLoggingOut
                      ? <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
                      : <LogOut className="w-4 h-4" />}
                    <span>{isLoggingOut ? 'Logging out...' : 'Selesai Praktikum'}</span>
                  </button>
                </div>
              </>
            )}

            {/* ── Mode Chat Guru ── */}
            {isTeacherMode && (
              <div className="flex flex-col flex-1 space-y-3 overflow-hidden">
                <div className="flex items-center justify-between pb-2 border-b border-slate-700 flex-shrink-0">
                  <div className="flex items-center space-x-2 text-amber-400">
                    <MessageCircle className="w-4 h-4" />
                    <span className="text-sm font-semibold">Bantuan Guru</span>
                  </div>
                  <button onClick={openRegular} className="text-slate-400 hover:text-white">
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <div className="flex-1 bg-slate-800/50 rounded-lg p-3 overflow-y-auto border border-slate-700/50 flex flex-col space-y-2 min-h-0">
                  {chatHistory.map((msg, i) => (
                    <div key={i} className={`flex ${msg.sender === 'student' ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[80%] rounded-lg p-2.5 text-xs whitespace-pre-wrap ${
                        msg.sender === 'student'
                          ? 'bg-blue-600 text-white rounded-tr-none'
                          : 'bg-slate-700 text-slate-200 rounded-tl-none'
                      }`}>{msg.text}</div>
                    </div>
                  ))}
                  {isTeacherTyping && (
                    <div className="flex justify-start">
                      <div className="bg-slate-700 rounded-lg rounded-tl-none p-2.5 flex items-center space-x-1">
                        {[0, 0.2, 0.4].map((d, i) => (
                          <span key={i} className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: `${d}s` }} />
                        ))}
                      </div>
                    </div>
                  )}
                  <div ref={chatEndRef} />
                </div>
                <form onSubmit={handleAskTeacher} className="flex items-center space-x-2 flex-shrink-0">
                  <input type="text" value={teacherPrompt} onChange={(e) => setTeacherPrompt(e.target.value)}
                    placeholder="Ketik pesan untuk guru..." autoComplete="off"
                    className="flex-1 bg-slate-800 border border-slate-700 text-white text-xs rounded-lg px-3 py-2.5 focus:outline-none focus:border-amber-500" />
                  <button type="submit" disabled={!teacherPrompt.trim()}
                    className="bg-amber-600 hover:bg-amber-500 disabled:bg-slate-700 text-white p-2.5 rounded-lg transition-colors">
                    <Send className="w-4 h-4" />
                  </button>
                </form>
              </div>
            )}

            {/* ── Mode Lapor Kendala ── */}
            {isReportMode && (
              <div className="flex flex-col flex-1 space-y-3 overflow-hidden">
                <div className="flex items-center justify-between pb-2 border-b border-slate-700 flex-shrink-0">
                  <div className="flex items-center space-x-2 text-red-400">
                    <AlertTriangle className="w-4 h-4" />
                    <span className="text-sm font-semibold">Lapor Kendala Teknis</span>
                  </div>
                  <button onClick={openRegular} className="text-slate-400 hover:text-white"><X className="w-4 h-4" /></button>
                </div>
                <form onSubmit={handleSubmitReport} className="flex flex-col flex-1 space-y-3 overflow-y-auto">
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-slate-400">Kategori Kendala</label>
                    <select value={reportCategory} onChange={(e) => setReportCategory(e.target.value)}
                      className="w-full bg-slate-800 border border-slate-700 text-white text-xs rounded-lg px-3 py-2.5 focus:outline-none focus:border-red-500">
                      <option value="Hardware">Hardware (Keyboard/Mouse rusak, dsb)</option>
                      <option value="Software">Software (Aplikasi error/tidak bisa dibuka)</option>
                      <option value="Jaringan">Jaringan (Internet mati, tidak bisa login)</option>
                      <option value="Lainnya">Lainnya</option>
                    </select>
                  </div>
                  <div className="space-y-1 flex-1">
                    <label className="text-xs font-medium text-slate-400">Detail Kendala</label>
                    <textarea value={reportDetail} onChange={(e) => setReportDetail(e.target.value)} required
                      placeholder="Deskripsikan masalah yang terjadi..."
                      className="w-full h-28 bg-slate-800 border border-slate-700 text-white text-xs rounded-lg px-3 py-2.5 focus:outline-none focus:border-red-500 resize-none" />
                  </div>
                  <button type="submit" disabled={!reportDetail.trim()}
                    className="w-full py-2.5 bg-red-600 hover:bg-red-500 disabled:bg-slate-700 disabled:text-slate-500 text-white rounded-lg text-xs font-semibold transition-all">
                    Kirim Laporan Kerusakan
                  </button>
                </form>
              </div>
            )}

            {/* ── Mode Lapor Pelanggaran ── */}
            {isViolationMode && (
              <div className="flex flex-col flex-1 space-y-3 overflow-hidden">
                <div className="flex items-center justify-between pb-2 border-b border-slate-700 flex-shrink-0">
                  <div className="flex items-center space-x-2 text-purple-400">
                    <Flag className="w-4 h-4" />
                    <span className="text-sm font-semibold">Lapor Pelanggaran</span>
                  </div>
                  <button onClick={openRegular} className="text-slate-400 hover:text-white"><X className="w-4 h-4" /></button>
                </div>
                <form onSubmit={handleSubmitViolation} className="flex flex-col flex-1 space-y-3 overflow-y-auto">
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-slate-400">Kategori Pelanggaran</label>
                    <select value={violationCategory} onChange={(e) => setViolationCategory(e.target.value)}
                      className="w-full bg-slate-800 border border-slate-700 text-white text-xs rounded-lg px-3 py-2.5 focus:outline-none focus:border-purple-500">
                      <option value="Menyontek">Menyontek / Buka Web Terlarang</option>
                      <option value="Bermain Game">Bermain Game Saat Praktikum</option>
                      <option value="Merusak Alat">Tindakan Merusak Komputer</option>
                      <option value="Mengganggu">Mengganggu Teman / Berisik</option>
                    </select>
                  </div>
                  <div className="space-y-1 flex-1">
                    <label className="text-xs font-medium text-slate-400">Detail (Opsional / Beri Tahu Posisi)</label>
                    <textarea value={violationDetail} onChange={(e) => setViolationDetail(e.target.value)} required
                      placeholder="Contoh: Siswa di PC-12 sedang bermain game online."
                      className="w-full h-28 bg-slate-800 border border-slate-700 text-white text-xs rounded-lg px-3 py-2.5 focus:outline-none focus:border-purple-500 resize-none" />
                  </div>
                  <button type="submit" disabled={!violationDetail.trim()}
                    className="w-full py-2.5 bg-purple-600 hover:bg-purple-500 disabled:bg-slate-700 disabled:text-slate-500 text-white rounded-lg text-xs font-semibold transition-all">
                    Kirim Laporan (Anonim)
                  </button>
                </form>
              </div>
            )}

          </div>
        )}
      </div>
    </div>
  );
}

