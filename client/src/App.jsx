import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Monitor, User, Key, Wifi, WifiOff, AlertCircle, Server, ArrowRight, RefreshCw, Download, Upload, X, Settings } from 'lucide-react';
import { io } from 'socket.io-client';
import LogoutWidget from './LogoutWidget.jsx';
import AdminExitDialog from './AdminExitDialog.jsx';
import CheckConditionForm from './CheckConditionForm.jsx';
import PostSessionCheck from './PostSessionCheck.jsx';
import AttentionModeOverlay from './AttentionModeOverlay.jsx';
import ChatBubble from './ChatBubble.jsx';
import AdminScreenShare from './AdminScreenShare.jsx';
import { ClientSettingsModal, ClientUpdateNotice } from './ClientSettingsPanel.jsx';
import { apiCall, settleWithin } from './api.js';
import BrandLogo from './BrandLogo.jsx';
import { cacheBranding, loadCachedBranding } from './branding.js';

// ── Mode layar ──────────────────────────────────────────────────────
// 'loading'   → menunggu load konfigurasi server dari storage
// 'setup'     → belum ada server URL, tampilkan form konfigurasi
// 'login'     → form login kiosk fullscreen
// 'precheck'  → form checklist kondisi fasilitas sebelum sesi (setelah login)
// 'widget'    → widget logout kecil pojok layar
// 'postcheck' → form checklist akhir sesi sebelum logout
const MODE_LOADING   = 'loading';
const MODE_SETUP     = 'setup';
const MODE_LOGIN     = 'login';
const MODE_PRECHECK  = 'precheck';
const MODE_WIDGET    = 'widget';
const MODE_POSTCHECK = 'postcheck';
const PREVIEW_SCREEN = import.meta.env.DEV
  ? new URLSearchParams(window.location.search).get('preview')
  : null;
const PREVIEW_STUDENT = {
  nis: 'DEMO-231412',
  nama_lengkap: 'Maya Putri',
  kelas: 'X RPL 1',
  pc_name: 'PC-LAB-13',
};

async function saveFileInBrowser(payload) {
  try {
    const response = await fetch(payload.data);
    const blob = await response.blob();
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = href;
    anchor.download = payload.name || 'file-kelas';
    anchor.click();
    URL.revokeObjectURL(href);
    return { success: true, file_name: anchor.download, size: blob.size };
  } catch {
    return { success: false, message: 'File tidak dapat disimpan.' };
  }
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('File tidak dapat dibaca.'));
    reader.readAsDataURL(file);
  });
}

export default function App() {
  const [mode,           setMode]           = useState(MODE_LOADING);
  const [serverUrl,      setServerUrl]      = useState('');
  const [setupInput,     setSetupInput]     = useState('');
  const [setupError,     setSetupError]     = useState('');
  const [setupChecking,  setSetupChecking]  = useState(false);
  const [nis,            setNis]            = useState('');
  const [password,       setPassword]       = useState('');
  const [time,           setTime]           = useState(new Date());
  const [isLoading,      setIsLoading]      = useState(false);
  const [error,          setError]          = useState('');
  const [serverOnline,   setServerOnline]   = useState(false);
  const [pcName,         setPcName]         = useState('PC-LAB-??');
  const [studentData,    setStudentData]    = useState(null);
  const [showAdminDialog, setShowAdminDialog] = useState(false);
  const [cornerClicks,   setCornerClicks]   = useState(0);
  const [discoveredServers, setDiscoveredServers] = useState([]);
  const [attentionMode,  setAttentionMode]  = useState({ enabled: false, message: '' });
  const [receivedFile, setReceivedFile] = useState(null);
  const [collectionRequest, setCollectionRequest] = useState(null);
  const [submissionBusy, setSubmissionBusy] = useState(false);
  const [loginWallpaper, setLoginWallpaper] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [clientSettings, setClientSettings] = useState({
    autoUpdate: true,
    openAtLogin: true,
    notifyUpdates: true,
    registrationKey: '',
    appVersion: '1.2.0',
  });
  const [updateStatus, setUpdateStatus] = useState({ state: 'idle', currentVersion: '1.2.0' });
  const [deepFreezeStatus, setDeepFreezeStatus] = useState({
    state: 'loading',
    message: 'Memeriksa status perlindungan komputer...',
  });
  const [deepFreezeBusy, setDeepFreezeBusy] = useState(false);
  const [branding, setBranding] = useState(loadCachedBranding);
  const autoSwitchingServerRef = useRef(false);
  const serverCheckInFlightRef = useRef(false);
  const socketRef = useRef(null);

  // Fail-open startup handshake. Main process hanya boleh mengaktifkan kiosk
  // setelah layar login/setup benar-benar ada, berukuran layar, dan terlihat.
  // Heartbeat berikutnya memastikan jendela transparan tidak pernah diam-diam
  // menutup desktop ketika UI React hilang atau macet.
  useEffect(() => {
    if (![MODE_SETUP, MODE_LOGIN].includes(mode)) return undefined;

    let cancelled = false;
    let frameOne = 0;
    let frameTwo = 0;

    const reportPaintedScreen = () => {
      if (cancelled) return;
      const marker = document.querySelector(`[data-labkom-screen="${mode}"]`);
      if (!marker) return;

      const rect = marker.getBoundingClientRect();
      const style = window.getComputedStyle(marker);
      const background = String(style.backgroundColor || '').toLowerCase();
      if (
        rect.width < 240
        || rect.height < 240
        || style.display === 'none'
        || style.visibility === 'hidden'
        || Number(style.opacity || 1) <= 0
        || background === 'transparent'
        || background === 'rgba(0, 0, 0, 0)'
      ) return;

      window.electronAPI?.reportRendererReady?.({
        screen: mode,
        width: rect.width,
        height: rect.height,
      });
    };

    // Dua animation frame menjamin React commit + kalkulasi layout sudah selesai.
    frameOne = window.requestAnimationFrame(() => {
      frameTwo = window.requestAnimationFrame(reportPaintedScreen);
    });
    const heartbeat = window.setInterval(reportPaintedScreen, 2_000);

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frameOne);
      window.cancelAnimationFrame(frameTwo);
      window.clearInterval(heartbeat);
    };
  }, [mode]);

  const applyBranding = useCallback((value) => {
    const next = cacheBranding(value);
    setBranding(next);
    window.electronAPI?.setClientBranding?.(next);
  }, []);

  const persistServerUrl = useCallback((nextUrl) => {
    const normalized = nextUrl?.trim().replace(/\/$/, '');
    if (!normalized) return;
    setServerUrl(normalized);
    setSetupInput(normalized);
    window.electronAPI?.saveServerUrl?.(normalized);
  }, []);

  // ── Load konfigurasi server URL dari Electron userData ──────────
  useEffect(() => {
    let cancelled = false;

    async function loadConfig() {
      try {
      if (window.electronAPI?.getClientSettings) {
        const storedSettings = await settleWithin(window.electronAPI.getClientSettings(), 5_000, null);
        if (cancelled) return;
        if (!storedSettings) throw new Error('Konfigurasi lokal tidak merespons.');
        setClientSettings(storedSettings);
        setUpdateStatus(storedSettings.updateStatus || { state: 'idle', currentVersion: storedSettings.appVersion });
        const stored = storedSettings.serverUrl;
        if (stored) {
          setServerUrl(stored);
          setSetupInput(stored);
          setMode(MODE_LOGIN);
        } else {
          setMode(MODE_SETUP);
        }
      } else if (window.electronAPI?.getServerUrl) {
        const stored = await settleWithin(window.electronAPI.getServerUrl(), 5_000, null);
        if (cancelled) return;
        if (stored) {
          setServerUrl(stored);
          setSetupInput(stored);
          setMode(MODE_LOGIN);
        } else {
          setMode(MODE_SETUP);
        }
      } else {
        // Berjalan di browser biasa (dev tanpa Electron) → pakai localhost
        persistServerUrl('http://localhost:3001');
        setMode(MODE_LOGIN);
      }
      } catch (loadError) {
        console.error('[Startup] Konfigurasi gagal dimuat:', loadError);
        if (!cancelled) {
          setSetupError('Konfigurasi tidak dapat dimuat. Aplikasi tetap aktif; periksa alamat server.');
          setMode(MODE_SETUP);
        }
      }
    }
    loadConfig();
    return () => { cancelled = true; };
  }, [persistServerUrl]);

  useEffect(() => {
    if (!serverUrl) return;
    let cancelled = false;
    apiCall(`${serverUrl}/api/branding`).then((result) => {
      if (!cancelled && result.ok && result.data?.success) applyBranding(result.data.data);
    });
    return () => { cancelled = true; };
  }, [serverUrl, applyBranding]);

  useEffect(() => {
    document.title = `${branding.product_name} Siswa · ${branding.school_name}`;
    window.electronAPI?.setClientBranding?.(branding);
  }, [branding]);

  // ── Ambil nama PC via Electron IPC ──────────────────────────────
  useEffect(() => {
    if (window.electronAPI?.getPcName) {
      window.electronAPI.getPcName().then(setPcName);
    } else {
      setPcName('PC-BROWSER-DEV');
    }
  }, []);

  useEffect(() => {
    const applyRendererPolicy = (policy = {}) => {
      const target = policy.wallpaper_target || 'both';
      const url = /^https?:\/\//i.test(String(policy.wallpaper_url || '')) ? policy.wallpaper_url : '';
      setLoginWallpaper(['login', 'both'].includes(target) ? url : '');
    };
    window.electronAPI?.getControlPolicy?.().then((policy) => {
      if (policy) applyRendererPolicy(policy);
    });
    window.electronAPI?.onControlSettings?.(applyRendererPolicy);
    return () => window.electronAPI?.removeAllListeners?.('control-settings');
  }, []);

  // ── Update jam setiap detik ─────────────────────────────────────
  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // ── Cek status server setiap 5 detik ───────────────────────────
  const checkServer = useCallback(async () => {
    if (!serverUrl || serverCheckInFlightRef.current) return;
    serverCheckInFlightRef.current = true;
    try {
      // Gunakan IPC (Node.js http) — lebih andal dari fetch di kiosk file://
      if (window.electronAPI?.verifyServer) {
        const result = await settleWithin(
          window.electronAPI.verifyServer(serverUrl),
          5_000,
          { ok: false },
        );
        setServerOnline(Boolean(result?.ok));
      } else {
        // Fallback dev/browser
        const res = await fetch(`${serverUrl}/`, { signal: AbortSignal.timeout(3000) });
        setServerOnline(res.ok);
      }
    } catch {
      setServerOnline(false);
    } finally {
      serverCheckInFlightRef.current = false;
    }
  }, [serverUrl]);

  useEffect(() => {
    checkServer();
    const interval = setInterval(checkServer, 5000);
    return () => clearInterval(interval);
  }, [checkServer]);

  // ── Listener IPC dari Electron ──────────────────────────────────
  useEffect(() => {
    window.electronAPI?.onKioskOff((data) => {
      setStudentData(data);
      setMode(MODE_PRECHECK);  // ← tampilkan form checklist awal, bukan langsung widget
    });
    window.electronAPI?.onReturnToLogin(() => {
      setMode(MODE_LOGIN);
      setNis('');
      setPassword('');
      setError('');
      setStudentData(null);
    });
    // Dengarkan server yang ditemukan via UDP broadcast
    window.electronAPI?.onServerDiscovered?.((data) => {
      setDiscoveredServers((prev) => {
        if (prev.find(s => s.url === data.url)) return prev; // deduplicate
        return [...prev, data];
      });
    });
    window.electronAPI?.onUpdateStatus?.((status) => setUpdateStatus(status));
    window.electronAPI?.onDeepFreezeStatus?.((status) => {
      setDeepFreezeStatus(status);
      setDeepFreezeBusy(['configuring', 'busy'].includes(status?.state));
    });
    return () => {
      window.electronAPI?.removeAllListeners('kiosk-off');
      window.electronAPI?.removeAllListeners('return-to-login');
      window.electronAPI?.removeAllListeners('server-discovered');
      window.electronAPI?.removeAllListeners('client-update-status');
      window.electronAPI?.removeAllListeners('deep-freeze-status');
    };
  }, []);

  useEffect(() => {
    if (serverOnline || discoveredServers.length === 0 || !window.electronAPI?.verifyServer) return;
    if (autoSwitchingServerRef.current) return;

    let cancelled = false;
    autoSwitchingServerRef.current = true;

    const tryDiscoveredServers = async () => {
      try {
        for (const candidate of discoveredServers) {
          const candidateUrl = candidate?.url?.trim().replace(/\/$/, '');
          if (!candidateUrl || candidateUrl === serverUrl) continue;

          const result = await window.electronAPI.verifyServer(candidateUrl);
          if (cancelled) return;

          if (result.ok && result.labkom) {
            persistServerUrl(candidateUrl);
            setSetupError('');
            setServerOnline(true);
            setMode(MODE_LOGIN);
            return;
          }
        }
      } finally {
        if (!cancelled) {
          autoSwitchingServerRef.current = false;
        }
      }
    };

    tryDiscoveredServers();
    return () => {
      cancelled = true;
      autoSwitchingServerRef.current = false;
    };
  }, [discoveredServers, persistServerUrl, serverOnline, serverUrl]);

  // ── Shortcut Ctrl+Alt+Q → buka dialog admin ─────────────────────
  // Di-handle oleh globalShortcut main.js (lebih andal di kiosk mode)
  // Fallback: window keydown juga tetap aktif
  useEffect(() => {
    // Listener dari main process (globalShortcut)
    window.electronAPI?.onShowAdminDialog?.(() => setShowAdminDialog(true));

    // Fallback keyboard di renderer
    const handler = (e) => {
      if (e.ctrlKey && e.altKey && e.key.toLowerCase() === 'q') {
        e.preventDefault();
        setShowAdminDialog(true);
      }
    };
    window.addEventListener('keydown', handler);
    return () => {
      window.removeEventListener('keydown', handler);
      window.electronAPI?.removeAllListeners('show-admin-dialog');
    };
  }, []);

  // ── Socket.io Connection untuk Attention Mode ──────────────────
  useEffect(() => {
    // Hanya connect socket setelah ada serverUrl dan sudah melewati loading/setup
    if (!serverUrl || mode === MODE_LOADING || mode === MODE_SETUP) {
      // Disconnect socket jika belum siap
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
      return;
    }

    let socket;
    let cancelled = false;
    let tokenRetryTimer = null;

    const attachSocketListeners = (s) => {
      s.on('attention-mode', (payload) => {
        console.log('[Attention Mode] Received:', payload);
        setAttentionMode({
          enabled: payload.enabled,
          message: payload.message || 'Mohon perhatian ke instruktur',
        });
        window.electronAPI?.setAttentionMode?.(Boolean(payload.enabled));
      });

      s.on('branding:updated', applyBranding);

      s.on('classroom:file-received', async (payload = {}) => {
        const result = window.electronAPI?.saveReceivedFile
          ? await window.electronAPI.saveReceivedFile(payload)
          : await saveFileInBrowser(payload);

        s.emit('client:file-status', {
          distribution_id: payload.id,
          status: result.success ? 'delivered' : 'failed',
          size: result.size || payload.size || 0,
        });

        setReceivedFile({
          success: Boolean(result.success),
          name: result.file_name || payload.name || 'File kelas',
          path: result.path || null,
          distributionId: payload.id || null,
          message: result.success
            ? 'Tersimpan di Downloads/LabKom'
            : (result.message || 'File gagal disimpan'),
        });
      });

      s.on('classroom:file-collection-request', (payload = {}) => {
        if (!studentData || !payload.id || !payload.label) return;
        setCollectionRequest(payload);
      });

      s.on('session:force-logout', (payload = {}) => {
        sessionStorage.clear();
        setAttentionMode({ enabled: false, message: '' });
        setCollectionRequest(null);
        setStudentData(null);
        setMode(MODE_LOGIN);
        setNis('');
        setPassword('');
        setError(payload.reason || 'Sesi dihentikan oleh Admin.');
        window.electronAPI?.doLogout?.();
      });

      s.on('connect', () => {
        console.log('[Socket] Connected to server for attention mode');
        setServerOnline(true);
        s.emit('client:hello', {
          pc_name: pcName,
          student_name: studentData?.nama_lengkap || null,
        });
      });

      s.on('disconnect', (reason) => {
        console.log('[Socket] Disconnected from server');
        setAttentionMode({ enabled: false, message: '' });
        if (reason !== 'io client disconnect') setServerOnline(false);
      });

      s.on('connect_error', async (error) => {
        console.error('[Socket] Connection error:', error);
        setServerOnline(false);
        if (String(error?.message || '').toLowerCase().includes('unauthorized')) {
          const freshToken = await settleWithin(
            window.electronAPI?.refreshClientToken?.(),
            7_000,
            null,
          );
          if (freshToken && !cancelled) {
            s.auth = { role: 'client', client_token: freshToken, channel: 'renderer' };
            if (!s.active) s.connect();
          }
        }
      });
    };

    const startSocket = async () => {
      try {
        const clientToken = await settleWithin(
          window.electronAPI?.getClientToken?.(),
          7_000,
          null,
        );
        if (cancelled) return;
        if (!clientToken) {
          console.warn('[Socket] Token belum tersedia; mencoba lagi dalam 5 detik.');
          tokenRetryTimer = setTimeout(startSocket, 5_000);
          return;
        }

        socket = io(serverUrl, {
          transports: ['websocket', 'polling'],
          auth: { role: 'client', client_token: clientToken, channel: 'renderer' },
          reconnection: true,
          reconnectionDelay: 1_000,
          reconnectionDelayMax: 5_000,
          randomizationFactor: 0.5,
          reconnectionAttempts: Infinity,
          timeout: 5_000,
        });

        socketRef.current = socket;
        attachSocketListeners(socket);
      } catch (socketError) {
        console.error('[Socket] Gagal menyiapkan koneksi:', socketError);
        if (!cancelled) tokenRetryTimer = setTimeout(startSocket, 5_000);
      }
    };

    startSocket();

    return () => {
      cancelled = true;
      clearTimeout(tokenRetryTimer);
      if (socket) socket.disconnect();
      socketRef.current = null;
    };
  }, [serverUrl, mode, pcName, studentData?.nama_lengkap, applyBranding]);

  const submitCollectionFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !collectionRequest || submissionBusy) return;
    if (file.size > 1024 * 1024) {
      setReceivedFile({ success: false, kind: 'submission', name: file.name, message: 'Ukuran tugas maksimal 1 MB.' });
      return;
    }
    const socket = socketRef.current;
    if (!socket?.connected) {
      setReceivedFile({ success: false, kind: 'submission', name: file.name, message: 'Server realtime belum terhubung.' });
      return;
    }
    setSubmissionBusy(true);
    try {
      const data = await readFileAsDataUrl(file);
      socket.timeout(10_000).emit('client:file-submission', {
        collection_id: collectionRequest.id,
        name: file.name,
        type: file.type,
        size: file.size,
        data,
        student_name: studentData?.nama_lengkap || '',
      }, (timeoutError, response) => {
        setSubmissionBusy(false);
        if (timeoutError || !response?.success) {
          setReceivedFile({ success: false, kind: 'submission', name: file.name, message: response?.error || 'Tugas gagal dikirim.' });
          return;
        }
        socket.emit('client:file-status', {
          distribution_id: collectionRequest.id,
          status: 'submitted',
          size: file.size,
        });
        setReceivedFile({ success: true, kind: 'submission', name: file.name, message: 'Tugas berhasil dikirim ke Admin.' });
        setCollectionRequest(null);
      });
    } catch (submitError) {
      setSubmissionBusy(false);
      setReceivedFile({ success: false, kind: 'submission', name: file.name, message: submitError.message || 'Tugas gagal dibaca.' });
    }
  };

  // ── Klik 5x pojok kiri bawah → buka dialog admin ────────────────
  const handleCornerClick = useCallback(() => {
    setCornerClicks((n) => {
      const next = n + 1;
      if (next >= 5) {
        setShowAdminDialog(true);
        return 0;
      }
      // Reset counter setelah 3 detik tidak klik lagi
      setTimeout(() => setCornerClicks(0), 3000);
      return next;
    });
  }, []);

  // ── Handler Login ───────────────────────────────────────────────
  const handleLogin = async (e) => {
    e.preventDefault();
    if (!serverOnline) {
      setError('Server tidak dapat dijangkau. Hubungi teknisi lab.');
      return;
    }
    setIsLoading(true);
    setError('');

    try {
      const result = await apiCall(`${serverUrl}/api/auth/login`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ nis, password, pc_name: pcName }),
      });

      if (result.ok && result.data?.success) {
        const data = result.data;
        sessionStorage.setItem('session_id',   data.data.session_id);
        sessionStorage.setItem('student_name', data.data.nama_lengkap);
        if (window.electronAPI?.loginSuccess) {
          window.electronAPI.loginSuccess(data.data);
        } else {
          setStudentData(data.data);
          setMode(MODE_WIDGET);
        }
      } else {
        setError(result.data?.message || 'Login gagal. Coba lagi.');
      }
    } catch (err) {
      setError('Tidak bisa terhubung ke server. Periksa koneksi jaringan.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSaveClientSettings = async (nextSettings) => {
    let normalizedUrl = String(nextSettings.serverUrl || '').trim();
    if (!normalizedUrl) return { success: false, message: 'Alamat server wajib diisi.' };
    if (!/^https?:\/\//i.test(normalizedUrl)) normalizedUrl = `http://${normalizedUrl}`;
    normalizedUrl = normalizedUrl.replace(/\/$/, '');
    try {
      const parsed = new URL(normalizedUrl);
      if (!parsed.port) parsed.port = '3001';
      normalizedUrl = parsed.toString().replace(/\/$/, '');
    } catch {
      return { success: false, message: 'Format alamat server tidak valid.' };
    }

    if (normalizedUrl !== serverUrl && window.electronAPI?.verifyServer) {
      const verification = await window.electronAPI.verifyServer(normalizedUrl);
      if (!verification.ok || !verification.labkom) {
        return { success: false, message: 'Server LabKom tidak dapat dijangkau pada alamat tersebut.' };
      }
    }

    if (!window.electronAPI?.saveClientSettings) {
      const localSettings = { ...nextSettings, serverUrl: normalizedUrl, appVersion: '1.2.0' };
      setClientSettings(localSettings);
      persistServerUrl(normalizedUrl);
      return { success: true, settings: localSettings };
    }

    const result = await window.electronAPI.saveClientSettings({ ...nextSettings, serverUrl: normalizedUrl });
    if (result.success) {
      setClientSettings(result.settings);
      setServerUrl(normalizedUrl);
      setSetupInput(normalizedUrl);
      if (result.settings.updateStatus) setUpdateStatus(result.settings.updateStatus);
    }
    return result;
  };

  const handleCheckUpdate = async () => {
    if (!window.electronAPI?.checkForUpdates) {
      const status = { state: 'dev', message: 'Pemeriksaan update aktif setelah aplikasi diinstal.' };
      setUpdateStatus((current) => ({ ...current, ...status }));
      return { success: false, ...status };
    }
    setUpdateStatus((current) => ({ ...current, state: 'checking', message: null }));
    const result = await window.electronAPI.checkForUpdates();
    if (result && !result.success && result.state) {
      setUpdateStatus((current) => ({ ...current, ...result }));
    }
    return result;
  };

  const handleDownloadUpdate = () => window.electronAPI?.downloadUpdate?.();
  const handleInstallUpdate = () => window.electronAPI?.installUpdate?.();

  const handleRefreshDeepFreeze = useCallback(async () => {
    if (!window.electronAPI?.getDeepFreezeStatus) {
      const result = {
        success: false,
        state: 'unsupported_platform',
        supported: false,
        message: 'Status Deep Freeze hanya tersedia pada aplikasi Windows yang telah diinstal.',
      };
      setDeepFreezeStatus(result);
      return result;
    }

    setDeepFreezeBusy(true);
    try {
      const result = await window.electronAPI.getDeepFreezeStatus();
      setDeepFreezeStatus(result);
      return result;
    } catch (error) {
      const result = { success: false, state: 'error', message: error?.message || 'Status Deep Freeze gagal dibaca.' };
      setDeepFreezeStatus(result);
      return result;
    } finally {
      setDeepFreezeBusy(false);
    }
  }, []);

  const handleConfigureDeepFreeze = useCallback(async (action, adminPassword) => {
    if (!window.electronAPI?.configureDeepFreeze) {
      return { success: false, message: 'Kontrol Deep Freeze tidak tersedia pada mode ini.' };
    }

    setDeepFreezeBusy(true);
    try {
      const result = await window.electronAPI.configureDeepFreeze(action, adminPassword);
      if (result) setDeepFreezeStatus(result);
      return result;
    } catch (error) {
      return { success: false, message: error?.message || 'Konfigurasi Deep Freeze gagal.' };
    } finally {
      setDeepFreezeBusy(false);
    }
  }, []);

  const handleElevateDeepFreeze = useCallback(async (adminPassword) => {
    if (!window.electronAPI?.relaunchAsAdministrator) {
      return { success: false, message: 'Permintaan Administrator tidak tersedia pada mode ini.' };
    }

    setDeepFreezeBusy(true);
    try {
      return await window.electronAPI.relaunchAsAdministrator(adminPassword);
    } catch (error) {
      return { success: false, message: error?.message || 'Aplikasi tidak dapat dijalankan sebagai Administrator.' };
    } finally {
      setDeepFreezeBusy(false);
    }
  }, []);


  const formattedTime = time.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const formattedDate = time.toLocaleDateString('id-ID', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  const settingsLayer = (
    <>
      <ClientSettingsModal
        open={settingsOpen}
        settings={clientSettings}
        serverUrl={serverUrl || setupInput}
        updateStatus={updateStatus}
        deepFreezeStatus={deepFreezeStatus}
        deepFreezeBusy={deepFreezeBusy}
        onClose={() => setSettingsOpen(false)}
        onSave={handleSaveClientSettings}
        onCheck={handleCheckUpdate}
        onDownload={handleDownloadUpdate}
        onInstall={handleInstallUpdate}
        onDeepFreezeRefresh={handleRefreshDeepFreeze}
        onDeepFreezeConfigure={handleConfigureDeepFreeze}
        onDeepFreezeElevate={handleElevateDeepFreeze}
        branding={branding}
      />
      {[MODE_SETUP, MODE_LOGIN].includes(mode) && (
        <ClientUpdateNotice status={updateStatus} onOpen={() => setSettingsOpen(true)} onInstall={handleInstallUpdate} />
      )}
    </>
  );

  // ── Setelah login, simpan serverUrl ke sessionStorage (untuk LogoutWidget) ──
  // dan juga simpan agar tersedia di komponen turunan
  if (PREVIEW_SCREEN === 'precheck') {
    return <CheckConditionForm studentData={PREVIEW_STUDENT} serverUrl="http://localhost:3001" pcName="PC-LAB-13" onComplete={() => {}} />;
  }

  if (PREVIEW_SCREEN === 'postcheck') {
    return <PostSessionCheck studentData={PREVIEW_STUDENT} serverUrl="http://localhost:3001" onLogoutConfirmed={() => {}} />;
  }

  if (mode !== MODE_LOADING) {
    sessionStorage.setItem('server_url', serverUrl);
  }

  // ── Mode Loading ─────────────────────────────────────────────────
  if (mode === MODE_LOADING) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="flex flex-col items-center space-y-4 text-white">
          <Monitor className="w-16 h-16 text-blue-400 animate-pulse" />
          <p className="text-lg text-slate-300">Memuat konfigurasi...</p>
        </div>
      </div>
    );
  }

  // ── Mode Setup (belum ada server URL) ────────────────────────────
  if (mode === MODE_SETUP) {
    const handleSetupConnect = async (e) => {
      e.preventDefault();
      setSetupError('');
      if (!setupInput.trim()) return setSetupError('Masukkan alamat IP server.');
      // Normalkan: tambahkan http:// jika tidak ada
      let url = setupInput.trim();
      if (!url.startsWith('http')) url = `http://${url}`;
      // Hilangkan trailing slash
      url = url.replace(/\/$/, '');
      // Tambah port default jika tidak ada
      if (!/:\d+$/.test(url)) url = `${url}:3001`;

      setSetupChecking(true);
      try {
        // Verifikasi via main process (bypass Chromium fetch restrictions)
        const result = window.electronAPI?.verifyServer
          ? await window.electronAPI.verifyServer(url)
          : { ok: true, labkom: true };

        if (result.ok && result.labkom) {
          window.electronAPI?.saveServerUrl?.(url);
          setServerUrl(url);
          setMode(MODE_LOGIN);
        } else if (result.ok) {
          setSetupError('Server merespons tapi bukan Labkom Server. Periksa IP & port.');
        } else {
          setSetupError(`Tidak bisa terhubung ke ${url}. Pastikan server admin sudah berjalan.`);
        }
      } catch {
        setSetupError(`Tidak bisa terhubung ke ${url}. Pastikan server admin sudah berjalan dan IP benar.`);
      } finally {
        setSetupChecking(false);
      }
    };

    return (
      <div data-labkom-screen="setup" className="min-h-screen bg-slate-900 flex items-center justify-center p-6 font-sans" style={{ '--brand-primary': branding.primary_color, '--brand-accent': branding.accent_color }}>
        {settingsLayer}
        <div className="w-full max-w-md bg-slate-800 border border-slate-700 rounded-3xl shadow-2xl p-10">
          <div className="flex flex-col items-center mb-8">
            <BrandLogo branding={branding} className="w-20 h-20 rounded-2xl object-contain p-1 mb-4 shadow-lg" />
            <h1 className="text-2xl font-bold text-white text-center">Konfigurasi Server</h1>
            <p className="mt-1 text-sm font-semibold" style={{ color: branding.accent_color }}>{branding.product_name} · {branding.school_name}</p>
            <p className="text-slate-400 text-sm text-center mt-2">
              Masukkan alamat IP komputer Admin (tempat aplikasi admin dijalankan)
            </p>
          </div>

          {/* ── Auto-discovered servers ── */}
          {discoveredServers.length > 0 && (
            <div className="mb-5">
              <p className="text-xs font-semibold text-emerald-400 uppercase tracking-wider mb-2 flex items-center space-x-1.5">
                <Wifi className="w-3.5 h-3.5" />
                <span>Server ditemukan di jaringan</span>
              </p>
              <div className="space-y-2">
                {discoveredServers.map((s) => (
                  <button
                    key={s.url}
                    type="button"
                    disabled={setupChecking}
                    onClick={async () => {
                      setSetupError('');
                      setSetupChecking(true);
                      try {
                        // Verifikasi via main process (bypass Chromium fetch restrictions)
                        const result = window.electronAPI?.verifyServer
                          ? await window.electronAPI.verifyServer(s.url)
                          : { ok: true, labkom: true }; // fallback: trust UDP discovery

                        if (result.ok) {
                          window.electronAPI?.saveServerUrl?.(s.url);
                          setServerUrl(s.url);
                          setMode(MODE_LOGIN);
                        } else {
                          setSetupError(`Tidak bisa terhubung ke ${s.url}.`);
                        }
                      } catch {
                        // Jika semua gagal, trust saja server yang ditemukan via UDP
                        window.electronAPI?.saveServerUrl?.(s.url);
                        setServerUrl(s.url);
                        setMode(MODE_LOGIN);
                      } finally {
                        setSetupChecking(false);
                      }
                    }}
                    className="w-full flex items-center justify-between px-4 py-3 bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/40 rounded-xl text-left transition-all group"
                  >
                    <div>
                      <p className="text-sm font-semibold text-emerald-300">{s.name}</p>
                      <p className="text-xs text-emerald-500 font-mono">{s.url}</p>
                    </div>
                    <ArrowRight className="w-4 h-4 text-emerald-400 group-hover:translate-x-1 transition-transform" />
                  </button>
                ))}
              </div>
              <div className="my-4 flex items-center space-x-3">
                <div className="flex-1 h-px bg-slate-700" />
                <span className="text-xs text-slate-500">atau isi manual</span>
                <div className="flex-1 h-px bg-slate-700" />
              </div>
            </div>
          )}
          {discoveredServers.length === 0 && (
            <div className="mb-4 flex items-center space-x-2 text-sm text-slate-500">
              <RefreshCw className="w-4 h-4 animate-spin" />
              <span>Mencari server di jaringan...</span>
            </div>
          )}

          <form onSubmit={handleSetupConnect} className="space-y-4">
            <div>
              <label className="text-sm font-medium text-slate-300 block mb-1.5">Alamat IP Server Admin</label>
              <input
                type="text"
                value={setupInput}
                onChange={e => setSetupInput(e.target.value)}
                placeholder="Contoh: 192.168.1.10"
                className="w-full px-4 py-3.5 bg-slate-700 border border-slate-600 text-white rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all text-lg font-mono"
                autoFocus
                disabled={setupChecking}
              />
              <p className="text-xs text-slate-500 mt-1.5">Port default: 3001 (otomatis ditambahkan)</p>
            </div>

            {setupError && (
              <div className="bg-red-500/20 border border-red-500/50 text-red-300 p-3 rounded-xl flex items-start space-x-2 text-sm">
                <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                <span>{setupError}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={setupChecking}
              className="student-brand-button w-full py-4 disabled:bg-blue-600/40 text-white font-semibold rounded-xl transition-all flex items-center justify-center space-x-2"
            >
              {setupChecking
                ? <><RefreshCw className="w-5 h-5 animate-spin" /><span>Menghubungkan...</span></>
                : <><span>Hubungkan ke Server</span><ArrowRight className="w-5 h-5" /></>
              }
            </button>
          </form>

          <div className="mt-6 p-4 bg-slate-700/50 rounded-xl border border-slate-700">
            <p className="text-xs text-slate-400 font-medium mb-2">Tips:</p>
            <ol className="text-xs text-slate-500 space-y-1 list-decimal list-inside">
              <li>Pastikan aplikasi Admin sudah dibuka di PC kepala lab</li>
              <li>Server akan muncul otomatis di atas dalam beberapa detik</li>
              <li>Klik nama server untuk langsung terhubung</li>
            </ol>
          </div>

          {/* Tombol keluar — hanya di setup screen sebelum login */}
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-slate-700 py-2.5 text-sm font-semibold text-slate-300 transition hover:bg-slate-700 hover:text-white"
          >
            <Settings className="h-4 w-4" /> Pengaturan aplikasi
          </button>

          <button
            type="button"
            onClick={() => window.electronAPI?.exitApp?.()}
            className="mt-4 w-full py-2.5 text-sm text-slate-500 hover:text-slate-300 hover:bg-slate-700 rounded-xl transition-all"
          >
            Keluar Aplikasi
          </button>
        </div>
      </div>
    );
  }

  // ── Overlays shared across all post-setup modes ──────────────────
  const sharedOverlays = (
    <>
      {settingsLayer}
      <AdminScreenShare socket={socketRef.current} />
      <AttentionModeOverlay
        enabled={attentionMode.enabled}
        message={attentionMode.message}
        onAcknowledge={() => socketRef.current?.emit('client:attention-ack', {})}
      />
      {collectionRequest && (
        <div className="fixed inset-0 z-[110] grid place-items-center bg-slate-950/70 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-blue-400/30 bg-slate-900 p-6 text-white shadow-2xl">
            <div className="mb-4 flex items-start gap-3">
              <span className="grid h-11 w-11 flex-none place-items-center rounded-xl bg-blue-400/15 text-blue-300"><Upload className="h-5 w-5" /></span>
              <div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-blue-300">Pengumpulan tugas</p><h3 className="mt-1 text-lg font-bold">{collectionRequest.label}</h3><p className="mt-1 text-xs text-slate-400">Pilih satu file, maksimal 1 MB.</p></div>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setCollectionRequest(null)} disabled={submissionBusy} className="flex-1 rounded-xl border border-slate-600 px-4 py-3 text-sm font-semibold text-slate-300 hover:bg-slate-800 disabled:opacity-50">Nanti</button>
              <label className={`flex-1 cursor-pointer rounded-xl bg-blue-600 px-4 py-3 text-center text-sm font-semibold hover:bg-blue-500 ${submissionBusy ? 'pointer-events-none opacity-50' : ''}`}>
                {submissionBusy ? 'Mengirim…' : 'Pilih & kirim file'}
                <input type="file" className="sr-only" onChange={submitCollectionFile} disabled={submissionBusy} />
              </label>
            </div>
          </div>
        </div>
      )}
      {receivedFile && (
        <div className={`fixed right-5 top-5 z-[100] w-80 rounded-2xl border p-4 shadow-2xl ${receivedFile.success ? 'border-emerald-400/30 bg-slate-900 text-white' : 'border-red-400/40 bg-red-950 text-white'}`}>
          <button onClick={() => setReceivedFile(null)} className="absolute right-3 top-3 text-slate-400 hover:text-white" aria-label="Tutup notifikasi file">
            <X className="h-4 w-4" />
          </button>
          <div className="flex items-start gap-3 pr-6">
            <span className={`grid h-10 w-10 flex-none place-items-center rounded-xl ${receivedFile.success ? 'bg-emerald-400/15 text-emerald-300' : 'bg-red-400/15 text-red-300'}`}>
              <Download className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">{receivedFile.kind === 'submission' ? 'Pengumpulan tugas' : 'File dari pengajar'}</p>
              <p className="mt-1 truncate text-sm font-semibold">{receivedFile.name}</p>
              <p className="mt-1 text-xs text-slate-300">{receivedFile.message}</p>
              {receivedFile.success && receivedFile.path && receivedFile.kind !== 'submission' && (
                <button
                  className="mt-3 rounded-lg bg-emerald-500/15 px-3 py-1.5 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/25"
                  onClick={async () => {
                    const opened = await window.electronAPI?.showReceivedFile?.(receivedFile.path);
                    if (opened && receivedFile.distributionId) {
                      socketRef.current?.emit('client:file-status', { distribution_id: receivedFile.distributionId, status: 'opened' });
                    }
                  }}
                >Tampilkan file</button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );

  // ── Mode Precheck ────────────────────────────────────────────────
  if (mode === MODE_PRECHECK) {
    return (
      <>
        {sharedOverlays}
        <CheckConditionForm
          studentData={studentData}
          serverUrl={serverUrl}
          serverOnline={serverOnline}
          pcName={pcName}
          onComplete={() => setMode(MODE_WIDGET)}
        />
      </>
    );
  }

  // ── Mode Widget (pasca-login) ────────────────────────────────────
  if (mode === MODE_WIDGET) {
    return (
      <>
        {sharedOverlays}
        <LogoutWidget
          studentData={studentData}
          serverOnline={serverOnline}
          onRequestPostCheck={() => {
            window.electronAPI?.resizeWindow('checklist');
            setMode(MODE_POSTCHECK);
          }}
          onLogoutComplete={() => {
            if (!window.electronAPI?.doLogout) {
              setMode(MODE_LOGIN);
              setNis('');
              setPassword('');
              setError('');
              setStudentData(null);
            }
          }}
        />
        <ChatBubble
          socket={socketRef.current}
          studentName={studentData?.nama_lengkap || ''}
          pcName={pcName}
        />
      </>
    );
  }

  // ── Mode Post-Check (form checklist akhir sesi) ──────────────────
  if (mode === MODE_POSTCHECK) {
    return (
      <>
        {sharedOverlays}
        <PostSessionCheck
          studentData={studentData}
          serverUrl={serverUrl}
          serverOnline={serverOnline}
          onLogoutConfirmed={async () => {
            try {
              const sessionId = sessionStorage.getItem('session_id');
              await apiCall(`${serverUrl}/api/auth/logout`, {
                method:  'POST',
                timeoutMs: 2_000,
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({ session_id: sessionId }),
              });
            } catch (_) {}
            sessionStorage.clear();
            window.electronAPI?.doLogout();
            if (!window.electronAPI?.doLogout) {
              setMode(MODE_LOGIN);
              setStudentData(null);
            }
          }}
        />
      </>
    );
  }

  // ── Mode Login (kiosk fullscreen) ────────────────────────────────
  return (
    <>
      {sharedOverlays}

      <div data-labkom-screen="login" className="min-h-screen bg-slate-900 flex items-center justify-center p-4 relative overflow-hidden font-sans" style={{ '--brand-primary': branding.primary_color, '--brand-accent': branding.accent_color }}>

        {/* Dialog Admin (overlay di atas semua) */}
        {showAdminDialog && (
          <AdminExitDialog onClose={() => setShowAdminDialog(false)} />
        )}

      {/* Tombol tersembunyi pojok kiri bawah — klik 5x untuk buka dialog admin */}
      <button
        onClick={handleCornerClick}
        className="absolute bottom-0 left-0 w-12 h-12 z-20 opacity-0"
        tabIndex={-1}
        aria-hidden="true"
      />
      {/* Background */}
      <div className="absolute inset-0 opacity-20">
        <div className="absolute inset-0 bg-gradient-to-br from-blue-600 via-indigo-900 to-slate-900 mix-blend-multiply" />
        <div
          className="w-full h-full bg-cover bg-center"
          style={{ backgroundImage: loginWallpaper ? `url(${JSON.stringify(loginWallpaper)})` : 'none' }}
        />
      </div>

      {/* Top Bar */}
      <div className="absolute top-0 left-0 right-0 p-6 flex justify-between items-start z-10 text-white drop-shadow-md">
        <div className="flex items-center space-x-3">
          <Monitor className="w-8 h-8 text-blue-400" />
          <div>
            <h1 className="text-2xl font-bold tracking-wider">{pcName}</h1>
            <p className="text-sm text-slate-300">{branding.lab_name}</p>
          </div>
        </div>
        <div className="flex flex-col items-end space-y-1">
          <div className={`flex items-center space-x-2 font-medium ${serverOnline ? 'text-green-400' : 'text-red-400'}`}>
            {serverOnline
              ? <><Wifi className="w-5 h-5" /><span>Terhubung ke Server</span></>
              : <><WifiOff className="w-5 h-5" /><span>Server Offline</span></>
            }
          </div>
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            className="mt-2 inline-flex items-center gap-2 rounded-xl border border-white/15 bg-slate-900/50 px-3 py-2 text-xs font-semibold text-slate-200 backdrop-blur transition hover:bg-slate-800"
          >
            <Settings className="h-4 w-4" /> Pengaturan
          </button>
        </div>
      </div>

      {/* Login Card */}
      <div className="relative z-10 w-full max-w-4xl grid grid-cols-1 md:grid-cols-2 rounded-3xl overflow-hidden shadow-2xl bg-white/10 backdrop-blur-md border border-white/20">

        {/* Kiri - Jam & Info */}
        <div className="student-brand-panel p-10 flex flex-col justify-between text-white">
          <div>
            <BrandLogo branding={branding} className="w-24 h-24 rounded-2xl object-contain p-1 mb-6 drop-shadow-lg" />
            <p className="mb-2 text-sm font-semibold uppercase tracking-[0.16em]" style={{ color: branding.accent_color }}>{branding.school_name}</p>
            <h2 className="text-3xl font-bold mb-2">{branding.student_label}</h2>
            <p className="text-blue-200">Silakan login untuk mulai menggunakan komputer ini.</p>
          </div>
          <div className="mt-12">
            <div className="text-6xl font-light tracking-tighter mb-2">{formattedTime}</div>
            <div className="text-lg text-blue-200 font-medium">{formattedDate}</div>
          </div>
        </div>

        {/* Kanan - Form Login */}
        <div className="p-10 bg-slate-900/80 flex flex-col justify-center">
          <div className="text-center mb-8">
            <h3 className="text-2xl font-semibold text-white">Login Siswa</h3>
            <p className="text-slate-400 mt-1">Gunakan NIS yang terdaftar</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-6">
            {/* Error message */}
            {error && (
              <div className="bg-red-500/20 border border-red-500/50 text-red-200 p-3 rounded-xl flex items-center space-x-2 text-sm">
                <AlertCircle className="w-5 h-5 flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {/* Input NIS */}
            <div className="space-y-1">
              <label className="text-sm font-medium text-slate-300 ml-1">Nomor Induk Siswa (NIS)</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                  <User className="h-5 w-5 text-slate-500" />
                </div>
                <input
                  type="text"
                  value={nis}
                  onChange={(e) => setNis(e.target.value)}
                  className="w-full pl-12 pr-4 py-4 bg-slate-800/50 border border-slate-700 text-white rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all"
                  placeholder="Masukkan NIS..."
                  required
                  autoComplete="off"
                  disabled={isLoading}
                />
              </div>
            </div>

            {/* Input Password */}
            <div className="space-y-1">
              <label className="text-sm font-medium text-slate-300 ml-1">Password</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                  <Key className="h-5 w-5 text-slate-500" />
                </div>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-12 pr-4 py-4 bg-slate-800/50 border border-slate-700 text-white rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all"
                  placeholder="Masukkan Password..."
                  required
                  disabled={isLoading}
                />
              </div>
            </div>

            {/* Tombol Login */}
            <button
              type="submit"
              disabled={isLoading || !serverOnline}
              className={`student-brand-button w-full py-4 rounded-xl text-white font-semibold text-lg transition-all shadow-lg ${
                isLoading || !serverOnline
                  ? 'bg-blue-600/40 cursor-not-allowed'
                  : 'active:scale-[0.98]'
              }`}
            >
              {isLoading ? (
                <span className="flex items-center justify-center">
                  <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Memverifikasi...
                </span>
              ) : !serverOnline ? (
                'Server Tidak Tersedia'
              ) : (
                'Masuk ke Komputer'
              )}
            </button>
          </form>

          <div className="mt-8 text-center text-sm text-slate-500">
            <p>{branding.support_text}</p>
            <p className="mt-1">Versi {clientSettings.appVersion || updateStatus.currentVersion || '-'}</p>
          </div>
        </div>
      </div>
    </div>
    </>
  );
}
