import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Monitor, MonitorOff, Users, Loader2, AlertCircle } from 'lucide-react';

/**
 * Berbagi layar Admin ke seluruh renderer siswa melalui Socket.IO.
 * Electron memilih layar utama setelah permintaan getDisplayMedia berasal dari klik pengguna.
 */
export default function ScreenShareAdmin({ socket, onlineCount: externalOnlineCount = null }) {
  const [sharing, setSharing] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');
  const [observedClientCount, setObservedClientCount] = useState(0);
  const [socketConnected, setSocketConnected] = useState(Boolean(socket?.connected));
  const streamRef = useRef(null);
  const captureVideoRef = useRef(null);
  const canvasRef = useRef(null);
  const intervalRef = useRef(null);
  const previewRef = useRef(null);
  const onlineClientsRef = useRef(new Map());
  const sharingRef = useRef(false);

  const clientCount = Number.isFinite(externalOnlineCount)
    ? externalOnlineCount
    : observedClientCount;

  const stopSharing = useCallback((notifyClients = true) => {
    clearInterval(intervalRef.current);
    intervalRef.current = null;

    if (captureVideoRef.current) {
      captureVideoRef.current.pause();
      captureVideoRef.current.srcObject = null;
      captureVideoRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (previewRef.current) previewRef.current.srcObject = null;

    if (notifyClients && socket?.connected) {
      socket.emit('admin:screen-share-stop', {});
    }
    sharingRef.current = false;
    setStarting(false);
    setSharing(false);
  }, [socket]);

  useEffect(() => {
    if (!socket) {
      setSocketConnected(false);
      return undefined;
    }

    const handleConnect = () => {
      setSocketConnected(true);
      if (sharingRef.current) socket.emit('admin:screen-share-start', {});
    };
    const handleDisconnect = () => {
      setSocketConnected(false);
      if (sharingRef.current) setError('Koneksi realtime terputus. Berbagi akan dilanjutkan otomatis saat server tersambung.');
    };
    const handlePresence = (data = {}) => {
      if (!data.pc_name) return;
      if (data.is_online) {
        onlineClientsRef.current.set(data.pc_name, true);
        if (sharingRef.current) socket.emit('admin:screen-share-start', {});
      }
      else onlineClientsRef.current.delete(data.pc_name);
      setObservedClientCount(onlineClientsRef.current.size);
    };

    setSocketConnected(socket.connected);
    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);
    socket.on('presence:update', handlePresence);
    return () => {
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
      socket.off('presence:update', handlePresence);
    };
  }, [socket]);

  useEffect(() => {
    if (sharing && previewRef.current && streamRef.current) {
      previewRef.current.srcObject = streamRef.current;
      previewRef.current.play().catch(() => {});
    }
  }, [sharing]);

  useEffect(() => () => stopSharing(), [stopSharing]);

  const startSharing = async () => {
    if (starting || sharing) return;
    setError('');
    if (!socket?.connected) {
      setError('Server realtime belum terhubung. Tunggu indikator koneksi aktif lalu coba lagi.');
      return;
    }
    if (clientCount <= 0) {
      setError('Belum ada komputer siswa online untuk menerima layar.');
      return;
    }
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setError('Versi Electron ini tidak menyediakan fitur tangkap layar.');
      return;
    }

    setStarting(true);
    let stream = null;
    let serverStarted = false;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 5, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      const track = stream.getVideoTracks()[0];
      if (!track) throw new Error('Sumber layar tidak tersedia.');

      const response = await new Promise((resolve, reject) => {
        socket.timeout(5_000).emit('admin:screen-share-start', {}, (timeoutError, result) => {
          if (timeoutError) reject(new Error('Server tidak mengonfirmasi sesi berbagi layar.'));
          else resolve(result);
        });
      });
      if (!response?.success || response.count <= 0) {
        throw new Error('Tidak ada aplikasi siswa yang menerima sesi berbagi layar.');
      }
      serverStarted = true;

      streamRef.current = stream;
      const video = document.createElement('video');
      video.srcObject = stream;
      video.muted = true;
      video.playsInline = true;
      await video.play();
      captureVideoRef.current = video;

      track.addEventListener('ended', () => stopSharing(), { once: true });
      sharingRef.current = true;
      setSharing(true);
      setStarting(false);

      const canvas = canvasRef.current;
      intervalRef.current = setInterval(() => {
        if (!canvas || !video.videoWidth || !socket.connected) return;
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const context = canvas.getContext('2d');
        if (!context) return;
        context.drawImage(video, 0, 0);
        const frame = canvas.toDataURL('image/jpeg', 0.6);
        socket.emit('admin:screen-share-frame', { image: frame });
      }, 200);
    } catch (captureError) {
      if (stream && stream !== streamRef.current) stream.getTracks().forEach((track) => track.stop());
      stopSharing(serverStarted);
      if (captureError?.name === 'NotAllowedError') {
        setError('Tangkap layar ditolak oleh sistem. Tutup dan buka kembali Admin, lalu pastikan aplikasi sudah memakai versi terbaru.');
      } else {
        setError(`Gagal memulai berbagi layar: ${captureError?.message || 'kesalahan tidak diketahui'}`);
      }
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-3">
            <div className={`p-2 rounded-xl ${sharing ? 'bg-red-100 text-red-600' : 'bg-blue-100 text-blue-600'}`}>
              <Monitor className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-slate-800">Berbagi Layar Admin</h3>
              <p className="text-sm text-slate-500">Tampilkan layar utama Admin ke semua siswa yang sedang online</p>
            </div>
          </div>
          <div className="flex items-center space-x-2 text-sm text-slate-500">
            <Users className="w-4 h-4" />
            <span>{clientCount} siswa online</span>
          </div>
        </div>

        {error && (
          <div className="mb-4 flex items-center space-x-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="flex items-center space-x-4">
          {!sharing ? (
            <button
              onClick={startSharing}
              disabled={!socketConnected || clientCount === 0 || starting}
              className="flex items-center space-x-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white rounded-xl font-medium transition-colors"
            >
              {starting ? <Loader2 className="w-5 h-5 animate-spin" /> : <Monitor className="w-5 h-5" />}
              <span>{starting ? 'Memulai...' : 'Mulai Berbagi Layar'}</span>
            </button>
          ) : (
            <button
              onClick={() => stopSharing()}
              className="flex items-center space-x-2 px-6 py-3 bg-red-600 hover:bg-red-700 text-white rounded-xl font-medium transition-colors animate-pulse"
            >
              <MonitorOff className="w-5 h-5" />
              <span>Hentikan Berbagi</span>
            </button>
          )}

          {sharing && (
            <div className="flex items-center space-x-2 text-sm text-emerald-600 font-medium">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
              <span>Sedang berbagi ke {clientCount} siswa</span>
            </div>
          )}
          {!socketConnected && <p className="text-sm text-slate-400">Menunggu koneksi realtime...</p>}
          {socketConnected && clientCount === 0 && !sharing && <p className="text-sm text-slate-400">Tidak ada siswa yang sedang online</p>}
        </div>

        {sharing && (
          <div className="mt-6">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Pratinjau Layar Anda</p>
            <div className="relative bg-slate-950 rounded-xl overflow-hidden aspect-video max-w-2xl">
              <video ref={previewRef} autoPlay muted playsInline className="w-full h-full object-contain" />
              <div className="absolute top-2 right-2 flex items-center space-x-1.5 bg-red-600 text-white text-xs font-bold px-2.5 py-1 rounded-full">
                <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                <span>LIVE</span>
              </div>
            </div>
          </div>
        )}

        <canvas ref={canvasRef} className="hidden" />
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-2xl p-5">
        <p className="text-sm font-semibold text-blue-800 mb-2">Cara Kerja:</p>
        <ul className="text-sm text-blue-700 space-y-1 list-disc list-inside">
          <li>Klik "Mulai Berbagi Layar"; aplikasi akan menggunakan layar utama Admin</li>
          <li>Layar tampil secara realtime di semua PC siswa yang terhubung</li>
          <li>Jika jaringan terputus, sesi mencoba tersambung kembali tanpa membekukan PC siswa</li>
          <li>Klik "Hentikan Berbagi" untuk mengakhiri sesi</li>
        </ul>
      </div>
    </div>
  );
}
