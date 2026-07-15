import React, { useState, useEffect } from 'react';
import { Eye, EyeOff, X, Send } from 'lucide-react';

/**
 * AttentionModeButton - Floating button untuk admin trigger Attention Mode.
 * Saat aktif, semua client menampilkan overlay fullscreen yang block input.
 */
export default function AttentionModeButton({ socket }) {
  const [open, setOpen]       = useState(false);
  const [active, setActive]   = useState(false);
  const [message, setMessage] = useState('Mohon perhatian ke instruktur');
  const [ackCount, setAckCount] = useState(0);

  useEffect(() => {
    const openPanel = () => setOpen(true);
    window.addEventListener('labkom:open-attention', openPanel);
    return () => window.removeEventListener('labkom:open-attention', openPanel);
  }, []);

  useEffect(() => {
    if (!socket) return undefined;
    const onAck = () => setAckCount((n) => n + 1);
    const onDisconnect = () => setActive(false);
    socket.on('client:attention-ack', onAck);
    socket.on('disconnect', onDisconnect);
    return () => {
      socket.off('client:attention-ack', onAck);
      socket.off('disconnect', onDisconnect);
    };
  }, [socket]);

  const enable = () => {
    if (!socket?.connected || !message.trim()) return;
    setAckCount(0);
    socket.timeout(5000).emit('admin:attention-mode', {
      enabled: true,
      message: message.trim(),
      target: 'all',
    }, (error, response) => {
      if (error || !response?.success) {
        setActive(false);
        return;
      }
      setActive(true);
    });
  };

  const disable = () => {
    setActive(false);
    if (!socket?.connected) return;
    socket.timeout(5000).emit('admin:attention-mode', {
      enabled: false,
      target: 'all',
    });
  };

  if (!open) {
    return null;
  }

  return (
    <div className="fixed bottom-24 right-6 z-50 w-80 bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden">
      <div className={`px-4 py-3 flex items-center justify-between text-white ${
        active ? 'bg-gradient-to-r from-red-500 to-red-600' : 'bg-gradient-to-r from-amber-500 to-amber-600'
      }`}>
        <div className="flex items-center space-x-2">
          {active ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
          <h3 className="font-bold text-sm">Attention Mode</h3>
          {active && (
            <span className="text-xs bg-white/20 px-2 py-0.5 rounded-full">
              {ackCount} ack
            </span>
          )}
        </div>
        <button onClick={() => setOpen(false)} className="p-1 hover:bg-white/20 rounded-lg">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="p-4 space-y-3">
        <div>
          <label className="text-xs font-semibold text-slate-600 uppercase tracking-wider">Pesan</label>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            disabled={active}
            rows={3}
            className="mt-1 w-full px-3 py-2 border border-slate-300 rounded-lg text-sm resize-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none disabled:bg-slate-50"
            placeholder="Pesan untuk siswa..."
          />
        </div>

        {!active ? (
          <button
            onClick={enable}
            disabled={!socket?.connected || !message.trim()}
            className="w-full py-2.5 bg-amber-500 hover:bg-amber-600 disabled:bg-slate-300 text-white rounded-lg font-medium text-sm flex items-center justify-center space-x-2 transition-colors"
          >
            <Send className="w-4 h-4" />
            <span>Kunci Layar Semua Siswa</span>
          </button>
        ) : (
          <button
            onClick={disable}
            className="w-full py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium text-sm flex items-center justify-center space-x-2 transition-colors"
          >
            <EyeOff className="w-4 h-4" />
            <span>Lepaskan Kunci Layar</span>
          </button>
        )}

        <p className="text-[11px] text-slate-500 leading-relaxed">
          Saat aktif, layar semua siswa terkunci dan keyboard/mouse mereka diblokir sampai Anda lepaskan.
        </p>
      </div>
    </div>
  );
}
